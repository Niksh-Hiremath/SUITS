import { parseCaseGraphV1, type CaseGraphV1 } from "../case-graph/schema";
import type { ActorRole, TrialPhase, TrialSide } from "../trial-engine/schemas";
import {
  JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION,
  JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION,
  JudgeTrialPolicyViewSchema,
  JuryTrialPolicyViewSchema,
  SettlementAuthorityRequestSchema,
  TrialPolicyActorBindingInputSchema,
  TrialPolicySnapshotSchema,
  TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION,
  type JudgeTrialPolicyView,
  type JuryTrialPolicyView,
  type SettlementAuthorityRequest,
  type SettlementOpenPhase,
  type SettlementPartyAuthorityRule,
  type TrialPolicyActorBinding,
  type TrialPolicyActorBindingInput,
  type TrialPolicyObjectionGround,
  type TrialPolicySnapshot,
} from "./schema";

const TRIAL_SIDES = ["user", "opposing", "neutral"] as const satisfies readonly TrialSide[];

export const SETTLEMENT_PHASE_SEQUENCE = [
  "pretrial",
  "opening",
  "case_in_chief",
  "recess",
  "pre_closing",
] as const satisfies readonly SettlementOpenPhase[];

export const TRIAL_POLICY_CONFIGURATION_ERROR_CODES = [
  "DUPLICATE_ACTOR",
  "DUPLICATE_WITNESS_ACTOR",
  "UNKNOWN_PARTY",
  "UNKNOWN_WITNESS",
  "ROLE_SIDE_MISMATCH",
  "INVALID_PARTY_REPRESENTATION",
  "MISSING_PARTY_COUNSEL",
  "MISSING_WITNESS_ACTOR",
] as const;

export type TrialPolicyConfigurationErrorCode =
  (typeof TRIAL_POLICY_CONFIGURATION_ERROR_CODES)[number];

export class TrialPolicyConfigurationError extends Error {
  readonly code: TrialPolicyConfigurationErrorCode;

  constructor(code: TrialPolicyConfigurationErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "TrialPolicyConfigurationError";
    this.code = code;
  }
}

export type CreateTrialPolicySnapshotInput = {
  graph: CaseGraphV1;
  actorBindings: readonly TrialPolicyActorBindingInput[];
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function byId<T>(values: readonly T[], getId: (value: T) => string): T[] {
  return [...values].sort((left, right) => compareStrings(getId(left), getId(right)));
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isCounselRole(role: ActorRole): boolean {
  return role === "user_counsel" || role === "opposing_counsel";
}

function assertRoleSide(binding: TrialPolicyActorBindingInput): void {
  const { actor } = binding;
  const expectedSide =
    actor.role === "user_counsel"
      ? "user"
      : actor.role === "opposing_counsel"
        ? "opposing"
        : actor.role === "witness"
          ? null
          : "neutral";

  if (expectedSide !== null && actor.side !== expectedSide) {
    throw new TrialPolicyConfigurationError(
      "ROLE_SIDE_MISMATCH",
      `${actor.role} actor ${actor.actorId} must use side ${expectedSide}`,
    );
  }
}

function canonicalizeActorBindings(
  graph: CaseGraphV1,
  actorBindingInputs: readonly TrialPolicyActorBindingInput[],
): TrialPolicyActorBinding[] {
  const parsed = actorBindingInputs.map((binding) =>
    TrialPolicyActorBindingInputSchema.parse(binding),
  );
  const parties = new Map(graph.parties.map((party) => [party.partyId, party]));
  const witnesses = new Map(
    graph.witnesses.map((witness) => [witness.witnessId, witness]),
  );
  const actorIds = new Set<string>();
  const witnessActorIds = new Map<string, string>();

  const canonical = parsed.map((binding) => {
    const { actor } = binding;
    if (actorIds.has(actor.actorId)) {
      throw new TrialPolicyConfigurationError(
        "DUPLICATE_ACTOR",
        `Actor ${actor.actorId} appears more than once`,
      );
    }
    actorIds.add(actor.actorId);
    assertRoleSide(binding);

    const representedPartyIds = sortedUnique(binding.representedPartyIds);
    if (isCounselRole(actor.role)) {
      if (representedPartyIds.length === 0) {
        throw new TrialPolicyConfigurationError(
          "INVALID_PARTY_REPRESENTATION",
          `Counsel actor ${actor.actorId} must represent at least one party`,
        );
      }
      for (const partyId of representedPartyIds) {
        const party = parties.get(partyId);
        if (!party) {
          throw new TrialPolicyConfigurationError(
            "UNKNOWN_PARTY",
            `Actor ${actor.actorId} references unknown party ${partyId}`,
          );
        }
        if (party.simulationSide !== actor.side) {
          throw new TrialPolicyConfigurationError(
            "INVALID_PARTY_REPRESENTATION",
            `Actor ${actor.actorId} cannot represent ${partyId} on side ${party.simulationSide}`,
          );
        }
      }
    } else if (representedPartyIds.length > 0) {
      throw new TrialPolicyConfigurationError(
        "INVALID_PARTY_REPRESENTATION",
        `Non-counsel actor ${actor.actorId} cannot represent a party`,
      );
    }

    if (actor.role === "witness") {
      if (actor.witnessId === null || !witnesses.has(actor.witnessId)) {
        throw new TrialPolicyConfigurationError(
          "UNKNOWN_WITNESS",
          `Witness actor ${actor.actorId} must reference a CaseGraph witness`,
        );
      }
      const existingActorId = witnessActorIds.get(actor.witnessId);
      if (existingActorId) {
        throw new TrialPolicyConfigurationError(
          "DUPLICATE_WITNESS_ACTOR",
          `Witness ${actor.witnessId} is bound to both ${existingActorId} and ${actor.actorId}`,
        );
      }
      witnessActorIds.set(actor.witnessId, actor.actorId);
      const witness = witnesses.get(actor.witnessId);
      const alignedSide = witness?.alignedPartyId
        ? parties.get(witness.alignedPartyId)?.simulationSide
        : "neutral";
      if (alignedSide !== actor.side) {
        throw new TrialPolicyConfigurationError(
          "ROLE_SIDE_MISMATCH",
          `Witness actor ${actor.actorId} must use aligned side ${alignedSide}`,
        );
      }
    } else if (actor.witnessId !== null) {
      throw new TrialPolicyConfigurationError(
        "UNKNOWN_WITNESS",
        `Non-witness actor ${actor.actorId} cannot bind witness ${actor.witnessId}`,
      );
    }

    return {
      actorId: actor.actorId,
      role: actor.role,
      side: actor.side,
      witnessId: actor.witnessId,
      representedPartyIds,
    };
  });

  for (const party of graph.parties) {
    if (party.simulationSide === "neutral") continue;
    const represented = canonical.some(
      (binding) =>
        isCounselRole(binding.role) &&
        binding.representedPartyIds.includes(party.partyId),
    );
    if (!represented) {
      throw new TrialPolicyConfigurationError(
        "MISSING_PARTY_COUNSEL",
        `Party ${party.partyId} has no counsel actor`,
      );
    }
  }

  for (const witness of graph.witnesses) {
    if (!witnessActorIds.has(witness.witnessId)) {
      throw new TrialPolicyConfigurationError(
        "MISSING_WITNESS_ACTOR",
        `Witness ${witness.witnessId} has no actor binding`,
      );
    }
  }

  return byId(canonical, (binding) => binding.actorId);
}

function actorIdsRepresentingAny(
  bindings: readonly TrialPolicyActorBinding[],
  partyIds: readonly string[],
): string[] {
  const permittedParties = new Set(partyIds);
  return sortedUnique(
    bindings
      .filter(
        (binding) =>
          isCounselRole(binding.role) &&
          binding.representedPartyIds.some((partyId) =>
            permittedParties.has(partyId),
          ),
      )
      .map((binding) => binding.actorId),
  );
}

function sidesForParties(
  graph: CaseGraphV1,
  partyIds: readonly string[],
): TrialSide[] {
  const included = new Set(partyIds);
  return TRIAL_SIDES.filter((side) =>
    graph.parties.some(
      (party) => included.has(party.partyId) && party.simulationSide === side,
    ),
  );
}

function proceduralSettlement(
  policy: TrialPolicySnapshot["settlement"],
): Omit<TrialPolicySnapshot["settlement"], "partyAuthorities"> {
  return {
    enabled: policy.enabled,
    currency: policy.currency,
    opensAtPhase: policy.opensAtPhase,
    openPhases: [...policy.openPhases],
    allowCounteroffers: policy.allowCounteroffers,
    expiresAfterEventCount: policy.expiresAfterEventCount,
    participantPartyIds: [...policy.participantPartyIds],
  };
}

export function createTrialPolicySnapshot(
  input: CreateTrialPolicySnapshotInput,
): TrialPolicySnapshot {
  const graph = parseCaseGraphV1(input.graph);
  const actors = canonicalizeActorBindings(graph, input.actorBindings);
  const witnessActor = new Map(
    actors
      .filter(
        (binding): binding is TrialPolicyActorBinding & { witnessId: string } =>
          binding.role === "witness" && binding.witnessId !== null,
      )
      .map((binding) => [binding.witnessId, binding.actorId]),
  );

  const mappings = {
    actors,
    parties: byId(
      graph.parties.map((party) => ({
        partyId: party.partyId,
        side: party.simulationSide,
        representativeActorIds: sortedUnique(
          actors
            .filter((binding) =>
              binding.representedPartyIds.includes(party.partyId),
            )
            .map((binding) => binding.actorId),
        ),
      })),
      (binding) => binding.partyId,
    ),
    sides: TRIAL_SIDES.map((side) => ({
      side,
      partyIds: sortedUnique(
        graph.parties
          .filter((party) => party.simulationSide === side)
          .map((party) => party.partyId),
      ),
      actorIds: sortedUnique(
        actors
          .filter((binding) => binding.side === side)
          .map((binding) => binding.actorId),
      ),
      counselActorIds: sortedUnique(
        actors
          .filter(
            (binding) =>
              binding.side === side && isCounselRole(binding.role),
          )
          .map((binding) => binding.actorId),
      ),
    })),
  };

  const openPhaseIndex = SETTLEMENT_PHASE_SEQUENCE.indexOf(
    graph.settlement.opensAtPhase,
  );
  const openPhases = graph.settlement.enabled
    ? SETTLEMENT_PHASE_SEQUENCE.slice(openPhaseIndex)
    : [];

  return TrialPolicySnapshotSchema.parse({
    schemaVersion: TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION,
    caseId: graph.caseId,
    caseVersion: graph.version,
    jurisdictionProfileId: graph.jurisdictionProfile.profileId,
    jurisdictionRulesVersion: graph.jurisdictionProfile.rulesVersion,
    mappings,
    witnessCallability: byId(
      graph.witnesses.map((witness) => ({
        witnessId: witness.witnessId,
        alignedPartyId: witness.alignedPartyId,
        callableByPartyIds: sortedUnique(witness.callableByPartyIds),
        callableBySides: sidesForParties(graph, witness.callableByPartyIds),
        callableByActorIds: actorIdsRepresentingAny(
          actors,
          witness.callableByPartyIds,
        ),
        recallPermitted: true,
      })),
      (rule) => rule.witnessId,
    ),
    evidencePermissions: byId(
      graph.evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        offerableByPartyIds: sortedUnique(evidence.offeredByPartyIds),
        offerableBySides: sidesForParties(graph, evidence.offeredByPartyIds),
        offerableByActorIds: actorIdsRepresentingAny(
          actors,
          evidence.offeredByPartyIds,
        ),
        custodianWitnessIds: sortedUnique(evidence.custodianWitnessIds),
        authenticatingWitnessIds: sortedUnique(
          evidence.authenticatingWitnessIds,
        ),
        authenticatingActorIds: sortedUnique(
          evidence.authenticatingWitnessIds.flatMap((witnessId) => {
            const actorId = witnessActor.get(witnessId);
            return actorId ? [actorId] : [];
          }),
        ),
      })),
      (rule) => rule.evidenceId,
    ),
    permittedObjectionGrounds: sortedUnique(
      graph.jurisdictionProfile.permittedObjectionGrounds,
    ),
    settlement: {
      enabled: graph.settlement.enabled,
      currency: graph.settlement.currency,
      opensAtPhase: graph.settlement.opensAtPhase,
      openPhases,
      allowCounteroffers: graph.settlement.allowCounteroffers,
      expiresAfterEventCount: graph.settlement.expiresAfterEventCount,
      participantPartyIds: sortedUnique(
        graph.settlement.participants.map((position) => position.partyId),
      ),
      partyAuthorities: byId(
        graph.settlement.participants.map((position) => ({
          partyId: position.partyId,
          minimumAuthority: position.minimumAuthority,
          maximumAuthority: position.maximumAuthority,
          reservationValue: position.reservationValue,
          targetValue: position.targetValue,
          confidentialPriorities: [...position.confidentialPriorities].sort(
            compareStrings,
          ),
          permittedNonMonetaryTerms: [
            ...position.permittedNonMonetaryTerms,
          ].sort(compareStrings),
        })),
        (authority) => authority.partyId,
      ),
    },
  });
}

export function parseTrialPolicySnapshot(input: unknown): TrialPolicySnapshot {
  return TrialPolicySnapshotSchema.parse(input);
}

export function canActorCallWitness(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  witnessId: string,
): boolean {
  return (
    snapshot.witnessCallability
      .find((rule) => rule.witnessId === witnessId)
      ?.callableByActorIds.includes(actorId) ?? false
  );
}

export function canActorRecallWitness(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  witnessId: string,
): boolean {
  const rule = snapshot.witnessCallability.find(
    (candidate) => candidate.witnessId === witnessId,
  );
  return Boolean(
    rule?.recallPermitted && rule.callableByActorIds.includes(actorId),
  );
}

export function canActorOfferEvidence(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  evidenceId: string,
): boolean {
  return (
    snapshot.evidencePermissions
      .find((rule) => rule.evidenceId === evidenceId)
      ?.offerableByActorIds.includes(actorId) ?? false
  );
}

export function canActorAuthenticateEvidence(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  evidenceId: string,
): boolean {
  return (
    snapshot.evidencePermissions
      .find((rule) => rule.evidenceId === evidenceId)
      ?.authenticatingActorIds.includes(actorId) ?? false
  );
}

export function isObjectionGroundPermitted(
  snapshot: TrialPolicySnapshot,
  ground: TrialPolicyObjectionGround | string,
): ground is TrialPolicyObjectionGround {
  return snapshot.permittedObjectionGrounds.some(
    (permittedGround) => permittedGround === ground,
  );
}

export function canActorRaiseObjection(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  ground: TrialPolicyObjectionGround | string,
): boolean {
  const actor = snapshot.mappings.actors.find(
    (binding) => binding.actorId === actorId,
  );
  return Boolean(
    actor &&
      isCounselRole(actor.role) &&
      isObjectionGroundPermitted(snapshot, ground),
  );
}

export function isSettlementOpenInPhase(
  snapshot: TrialPolicySnapshot,
  phase: TrialPhase,
): boolean {
  return (
    snapshot.settlement.enabled &&
    snapshot.settlement.openPhases.some((openPhase) => openPhase === phase)
  );
}

function actorRepresentsSettlementParticipant(
  snapshot: TrialPolicySnapshot,
  actorId: string,
): boolean {
  const actor = snapshot.mappings.actors.find(
    (binding) => binding.actorId === actorId,
  );
  return Boolean(
    actor &&
      isCounselRole(actor.role) &&
      actor.representedPartyIds.some((partyId) =>
        snapshot.settlement.participantPartyIds.includes(partyId),
      ),
  );
}

export function canActorProposeSettlement(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  phase: TrialPhase,
): boolean {
  return (
    isSettlementOpenInPhase(snapshot, phase) &&
    actorRepresentsSettlementParticipant(snapshot, actorId)
  );
}

export function canActorCounterSettlement(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  phase: TrialPhase,
): boolean {
  return (
    snapshot.settlement.allowCounteroffers &&
    canActorProposeSettlement(snapshot, actorId, phase)
  );
}

export function settlementExpirySequence(
  snapshot: TrialPolicySnapshot,
  proposedAtSequence: number,
): number {
  if (!Number.isSafeInteger(proposedAtSequence) || proposedAtSequence < 0) {
    throw new RangeError("proposedAtSequence must be a nonnegative safe integer");
  }
  const expiresAt =
    proposedAtSequence + snapshot.settlement.expiresAfterEventCount;
  if (!Number.isSafeInteger(expiresAt)) {
    throw new RangeError("Settlement expiry sequence exceeds safe integer range");
  }
  return expiresAt;
}

export function isSettlementOfferExpired(
  expiresAtSequence: number,
  currentSequence: number,
): boolean {
  if (
    !Number.isSafeInteger(expiresAtSequence) ||
    expiresAtSequence < 1 ||
    !Number.isSafeInteger(currentSequence) ||
    currentSequence < 0
  ) {
    throw new RangeError("Settlement sequences must be valid safe integers");
  }
  return currentSequence >= expiresAtSequence;
}

export function getSettlementAuthorityForActor(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  partyId: string,
): SettlementPartyAuthorityRule | null {
  const actor = snapshot.mappings.actors.find(
    (binding) => binding.actorId === actorId,
  );
  if (
    !actor ||
    !isCounselRole(actor.role) ||
    !actor.representedPartyIds.includes(partyId)
  ) {
    return null;
  }
  return (
    snapshot.settlement.partyAuthorities.find(
      (authority) => authority.partyId === partyId,
    ) ?? null
  );
}

export function canActorAuthorizeSettlement(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  requestInput: SettlementAuthorityRequest,
): boolean {
  if (!snapshot.settlement.enabled) return false;
  const request = SettlementAuthorityRequestSchema.safeParse(requestInput);
  if (!request.success) return false;
  const authority = getSettlementAuthorityForActor(
    snapshot,
    actorId,
    request.data.partyId,
  );
  if (!authority) return false;
  if (
    request.data.amount < authority.minimumAuthority ||
    request.data.amount > authority.maximumAuthority
  ) {
    return false;
  }
  const permittedTerms = new Set(authority.permittedNonMonetaryTerms);
  return request.data.nonMonetaryTerms.every((term) =>
    permittedTerms.has(term),
  );
}

export function buildJudgeTrialPolicyView(
  snapshotInput: TrialPolicySnapshot,
): JudgeTrialPolicyView {
  const snapshot = parseTrialPolicySnapshot(snapshotInput);
  return JudgeTrialPolicyViewSchema.parse({
    schemaVersion: JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION,
    sourcePolicySchemaVersion: snapshot.schemaVersion,
    caseId: snapshot.caseId,
    caseVersion: snapshot.caseVersion,
    jurisdictionProfileId: snapshot.jurisdictionProfileId,
    jurisdictionRulesVersion: snapshot.jurisdictionRulesVersion,
    mappings: snapshot.mappings,
    witnessCallability: snapshot.witnessCallability,
    evidencePermissions: snapshot.evidencePermissions,
    permittedObjectionGrounds: snapshot.permittedObjectionGrounds,
    settlement: proceduralSettlement(snapshot.settlement),
  });
}

export function buildJuryTrialPolicyView(
  snapshotInput: TrialPolicySnapshot,
): JuryTrialPolicyView {
  const snapshot = parseTrialPolicySnapshot(snapshotInput);
  return JuryTrialPolicyViewSchema.parse({
    schemaVersion: JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION,
    sourcePolicySchemaVersion: snapshot.schemaVersion,
    caseId: snapshot.caseId,
    caseVersion: snapshot.caseVersion,
    jurisdictionProfileId: snapshot.jurisdictionProfileId,
    jurisdictionRulesVersion: snapshot.jurisdictionRulesVersion,
    permittedObjectionGrounds: snapshot.permittedObjectionGrounds,
  });
}

export function partySideForPolicy(
  snapshot: TrialPolicySnapshot,
  partyId: string,
): TrialSide | null {
  return (
    snapshot.mappings.parties.find((binding) => binding.partyId === partyId)
      ?.side ?? null
  );
}

export function actorSideForPolicy(
  snapshot: TrialPolicySnapshot,
  actorId: string,
): TrialSide | null {
  return (
    snapshot.mappings.actors.find((binding) => binding.actorId === actorId)
      ?.side ?? null
  );
}

export function partySideMapForPolicy(
  snapshot: TrialPolicySnapshot,
): ReadonlyMap<string, TrialSide> {
  return new Map(
    snapshot.mappings.parties.map((binding) => [binding.partyId, binding.side]),
  );
}
