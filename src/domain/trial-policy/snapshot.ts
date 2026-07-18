import { parseCaseGraphV1, type CaseGraphV1 } from "../case-graph/schema";
import {
  JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V1,
  JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2,
  JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V1,
  JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2,
  JudgeTrialPolicyViewV1Schema,
  JudgeTrialPolicyViewV2Schema,
  JuryTrialPolicyViewV1Schema,
  JuryTrialPolicyViewV2Schema,
  SettlementAuthorityRequestSchema,
  TrialPolicyActorBindingInputSchema,
  TrialPolicySnapshotV1Schema,
  TrialPolicySnapshotV2Schema,
  TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V1,
  TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V2,
  type JudgeTrialPolicyView,
  type JudgeTrialPolicyViewV1,
  type JudgeTrialPolicyViewV2,
  type JuryTrialPolicyView,
  type JuryTrialPolicyViewV1,
  type JuryTrialPolicyViewV2,
  type SettlementAuthorityRequest,
  type SettlementOpenPhase,
  type SettlementPartyAuthorityRule,
  type TrialPolicyActorBinding,
  type TrialPolicyActorBindingInput,
  type TrialPolicyActorRole,
  type TrialPolicyObjectionGround,
  type TrialPolicySide,
  type TrialPolicySnapshot,
  type TrialPolicySnapshotV1,
  type TrialPolicySnapshotV2,
} from "./schema";

export type TrialPolicyPhase =
  | SettlementOpenPhase
  | "closing"
  | "jury_instructions"
  | "deliberation"
  | "verdict"
  | "debrief"
  | "complete";

const TRIAL_SIDES = ["user", "opposing", "neutral"] as const satisfies readonly TrialPolicySide[];

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

function isCounselRole(role: TrialPolicyActorRole): boolean {
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
): TrialPolicySide[] {
  const included = new Set(partyIds);
  return TRIAL_SIDES.filter((side) =>
    graph.parties.some(
      (party) => included.has(party.partyId) && party.simulationSide === side,
    ),
  );
}

function proceduralSettlementV1(
  policy: TrialPolicySnapshotV1["settlement"],
): Omit<TrialPolicySnapshotV1["settlement"], "partyAuthorities"> {
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

function proceduralSettlementV2(
  policy: TrialPolicySnapshotV2["settlement"],
): Omit<TrialPolicySnapshotV2["settlement"], "partyAuthorities"> {
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

function derivePolicyContext(
  input: CreateTrialPolicySnapshotInput,
): {
  graph: CaseGraphV1;
  actors: TrialPolicyActorBinding[];
  mappings: TrialPolicySnapshotV1["mappings"];
  witnessActor: ReadonlyMap<string, string>;
  openPhases: SettlementOpenPhase[];
} {
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

  return { graph, actors, mappings, witnessActor, openPhases };
}

function deriveWitnessCallability(
  graph: CaseGraphV1,
  actors: readonly TrialPolicyActorBinding[],
) {
  return byId(
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
  );
}

function deriveSettlement(
  graph: CaseGraphV1,
  openPhases: readonly SettlementOpenPhase[],
) {
  return {
    enabled: graph.settlement.enabled,
    currency: graph.settlement.currency,
    opensAtPhase: graph.settlement.opensAtPhase,
    openPhases: [...openPhases],
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
  };
}

/** Rebuilds the exact trial-policy-snapshot.v1 contract committed at b0fb9d3. */
export function createTrialPolicySnapshotV1(
  input: CreateTrialPolicySnapshotInput,
): TrialPolicySnapshotV1 {
  const { graph, actors, mappings, witnessActor, openPhases } =
    derivePolicyContext(input);

  return TrialPolicySnapshotV1Schema.parse({
    schemaVersion: TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V1,
    caseId: graph.caseId,
    caseVersion: graph.version,
    jurisdictionProfileId: graph.jurisdictionProfile.profileId,
    jurisdictionRulesVersion: graph.jurisdictionProfile.rulesVersion,
    mappings,
    witnessCallability: deriveWitnessCallability(graph, actors),
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
    settlement: deriveSettlement(graph, openPhases),
  });
}

export function createTrialPolicySnapshotV2(
  input: CreateTrialPolicySnapshotInput,
): TrialPolicySnapshotV2 {
  const { graph, actors, mappings, witnessActor, openPhases } =
    derivePolicyContext(input);

  return TrialPolicySnapshotV2Schema.parse({
    schemaVersion: TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V2,
    caseId: graph.caseId,
    caseVersion: graph.version,
    jurisdictionProfileId: graph.jurisdictionProfile.profileId,
    jurisdictionRulesVersion: graph.jurisdictionProfile.rulesVersion,
    mappings,
    witnessCallability: deriveWitnessCallability(graph, actors),
    witnessKnowledge: byId(
      graph.witnesses.map((witness) => ({
        witnessId: witness.witnessId,
        knownFactIds: sortedUnique(
          witness.knowledgeBoundary.knownFactIds,
        ),
        perceivedFactIds: sortedUnique(
          witness.knowledgeBoundary.perceivedFactIds,
        ),
        seenEvidenceIds: sortedUnique(
          witness.knowledgeBoundary.seenEvidenceIds,
        ),
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
        relatedFactIds: sortedUnique(evidence.relatedFactIds),
      })),
      (rule) => rule.evidenceId,
    ),
    permittedObjectionGrounds: sortedUnique(
      graph.jurisdictionProfile.permittedObjectionGrounds,
    ),
    settlement: deriveSettlement(graph, openPhases),
  });
}

export function createTrialPolicySnapshot(
  input: CreateTrialPolicySnapshotInput,
): TrialPolicySnapshot {
  return createTrialPolicySnapshotV2(input);
}

export function parseTrialPolicySnapshotV1(
  input: unknown,
): TrialPolicySnapshotV1 {
  return TrialPolicySnapshotV1Schema.parse(input);
}

export function parseTrialPolicySnapshotV2(
  input: unknown,
): TrialPolicySnapshotV2 {
  return TrialPolicySnapshotV2Schema.parse(input);
}

export function parseTrialPolicySnapshot(input: unknown): TrialPolicySnapshot {
  return parseTrialPolicySnapshotV2(input);
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

/**
 * Returns whether the pinned CaseGraph permits this witness to testify to the
 * fact. Known facts include the stricter perceived-fact subset.
 */
export function canWitnessRevealFact(
  snapshot: TrialPolicySnapshot,
  witnessId: string,
  factId: string,
): boolean {
  return (
    snapshot.witnessKnowledge
      .find((rule) => rule.witnessId === witnessId)
      ?.knownFactIds.includes(factId) ?? false
  );
}

/** Returns whether the witness may reference an exhibit they have seen. */
export function canWitnessReferenceEvidence(
  snapshot: TrialPolicySnapshot,
  witnessId: string,
  evidenceId: string,
): boolean {
  return (
    snapshot.witnessKnowledge
      .find((rule) => rule.witnessId === witnessId)
      ?.seenEvidenceIds.includes(evidenceId) ?? false
  );
}

/** Returns whether an exhibit is authoring-grounded to the requested fact. */
export function canEvidenceRevealFact(
  snapshot: TrialPolicySnapshot,
  evidenceId: string,
  factId: string,
): boolean {
  return (
    snapshot.evidencePermissions
      .find((rule) => rule.evidenceId === evidenceId)
      ?.relatedFactIds.includes(factId) ?? false
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
  phase: TrialPolicyPhase,
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
  if (!actor || !isCounselRole(actor.role)) return false;
  return (
    actor.representedPartyIds.filter((partyId) =>
      snapshot.settlement.participantPartyIds.includes(partyId),
    ).length === 1
  );
}

export function canActorProposeSettlement(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  phase: TrialPolicyPhase,
): boolean {
  return (
    isSettlementOpenInPhase(snapshot, phase) &&
    actorRepresentsSettlementParticipant(snapshot, actorId)
  );
}

export function canActorCounterSettlement(
  snapshot: TrialPolicySnapshot,
  actorId: string,
  phase: TrialPolicyPhase,
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

/** Builds the exact judge-trial-policy-view.v1 contract from policy v1. */
export function buildJudgeTrialPolicyViewV1(
  snapshotInput: TrialPolicySnapshotV1,
): JudgeTrialPolicyViewV1 {
  const snapshot = parseTrialPolicySnapshotV1(snapshotInput);
  return JudgeTrialPolicyViewV1Schema.parse({
    schemaVersion: JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V1,
    sourcePolicySchemaVersion: snapshot.schemaVersion,
    caseId: snapshot.caseId,
    caseVersion: snapshot.caseVersion,
    jurisdictionProfileId: snapshot.jurisdictionProfileId,
    jurisdictionRulesVersion: snapshot.jurisdictionRulesVersion,
    mappings: snapshot.mappings,
    witnessCallability: snapshot.witnessCallability,
    evidencePermissions: snapshot.evidencePermissions,
    permittedObjectionGrounds: snapshot.permittedObjectionGrounds,
    settlement: proceduralSettlementV1(snapshot.settlement),
  });
}

/** Builds the exact jury-trial-policy-view.v1 contract from policy v1. */
export function buildJuryTrialPolicyViewV1(
  snapshotInput: TrialPolicySnapshotV1,
): JuryTrialPolicyViewV1 {
  const snapshot = parseTrialPolicySnapshotV1(snapshotInput);
  return JuryTrialPolicyViewV1Schema.parse({
    schemaVersion: JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V1,
    sourcePolicySchemaVersion: snapshot.schemaVersion,
    caseId: snapshot.caseId,
    caseVersion: snapshot.caseVersion,
    jurisdictionProfileId: snapshot.jurisdictionProfileId,
    jurisdictionRulesVersion: snapshot.jurisdictionRulesVersion,
    permittedObjectionGrounds: snapshot.permittedObjectionGrounds,
  });
}

export function buildJudgeTrialPolicyViewV2(
  snapshotInput: TrialPolicySnapshotV2,
): JudgeTrialPolicyViewV2 {
  const snapshot = parseTrialPolicySnapshotV2(snapshotInput);
  return JudgeTrialPolicyViewV2Schema.parse({
    schemaVersion: JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2,
    sourcePolicySchemaVersion: snapshot.schemaVersion,
    caseId: snapshot.caseId,
    caseVersion: snapshot.caseVersion,
    jurisdictionProfileId: snapshot.jurisdictionProfileId,
    jurisdictionRulesVersion: snapshot.jurisdictionRulesVersion,
    mappings: snapshot.mappings,
    witnessCallability: snapshot.witnessCallability,
    evidencePermissions: snapshot.evidencePermissions.map((rule) => ({
      evidenceId: rule.evidenceId,
      offerableByPartyIds: [...rule.offerableByPartyIds],
      offerableBySides: [...rule.offerableBySides],
      offerableByActorIds: [...rule.offerableByActorIds],
      custodianWitnessIds: [...rule.custodianWitnessIds],
      authenticatingWitnessIds: [...rule.authenticatingWitnessIds],
      authenticatingActorIds: [...rule.authenticatingActorIds],
    })),
    permittedObjectionGrounds: snapshot.permittedObjectionGrounds,
    settlement: proceduralSettlementV2(snapshot.settlement),
  });
}

export function buildJudgeTrialPolicyView(
  snapshotInput: TrialPolicySnapshot,
): JudgeTrialPolicyView {
  return buildJudgeTrialPolicyViewV2(snapshotInput);
}

export function buildJuryTrialPolicyViewV2(
  snapshotInput: TrialPolicySnapshotV2,
): JuryTrialPolicyViewV2 {
  const snapshot = parseTrialPolicySnapshotV2(snapshotInput);
  return JuryTrialPolicyViewV2Schema.parse({
    schemaVersion: JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2,
    sourcePolicySchemaVersion: snapshot.schemaVersion,
    caseId: snapshot.caseId,
    caseVersion: snapshot.caseVersion,
    jurisdictionProfileId: snapshot.jurisdictionProfileId,
    jurisdictionRulesVersion: snapshot.jurisdictionRulesVersion,
    permittedObjectionGrounds: snapshot.permittedObjectionGrounds,
  });
}

export function buildJuryTrialPolicyView(
  snapshotInput: TrialPolicySnapshot,
): JuryTrialPolicyView {
  return buildJuryTrialPolicyViewV2(snapshotInput);
}

export function partySideForPolicy(
  snapshot: TrialPolicySnapshot,
  partyId: string,
): TrialPolicySide | null {
  return (
    snapshot.mappings.parties.find((binding) => binding.partyId === partyId)
      ?.side ?? null
  );
}

export function actorSideForPolicy(
  snapshot: TrialPolicySnapshot,
  actorId: string,
): TrialPolicySide | null {
  return (
    snapshot.mappings.actors.find((binding) => binding.actorId === actorId)
      ?.side ?? null
  );
}

export function partySideMapForPolicy(
  snapshot: TrialPolicySnapshot,
): ReadonlyMap<string, TrialPolicySide> {
  return new Map(
    snapshot.mappings.parties.map((binding) => [binding.partyId, binding.side]),
  );
}
