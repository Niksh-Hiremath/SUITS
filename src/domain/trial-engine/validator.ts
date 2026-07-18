import {
  canActorCallWitness,
  canActorAuthorizeSettlement,
  canActorCounterSettlement,
  canActorOfferEvidence,
  canActorProposeSettlement,
  canActorRaiseObjection,
  canActorRecallWitness,
  canEvidenceRevealFact,
  canWitnessReferenceEvidence,
  canWitnessRevealFact,
  getSettlementAuthorityForActor,
  isSettlementOfferExpired,
  settlementExpirySequence,
} from "../trial-policy";
import {
  TrialActionSchema,
  TrialStateSchema,
  type CitationSet,
  type FactStateEntry,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialPhase,
  type SettlementTerms,
  type TrialState,
} from "./schemas";
import { isActionAllowedForActor } from "./permissions";

export const TRIAL_ENGINE_ERROR_CODES = [
  "INVALID_ACTION",
  "INVALID_STATE",
  "TRIAL_NOT_STARTED",
  "TRIAL_ALREADY_STARTED",
  "TRIAL_ID_MISMATCH",
  "STALE_STATE_VERSION",
  "DUPLICATE_ACTION_ID",
  "UNKNOWN_ACTOR",
  "ACTOR_NOT_PERMITTED",
  "AI_METADATA_REQUIRED",
  "TRIAL_NOT_ACTIVE",
  "ILLEGAL_PHASE_TRANSITION",
  "WRONG_PHASE",
  "UNKNOWN_WITNESS",
  "WITNESS_NOT_AVAILABLE",
  "WITNESS_NOT_ACTIVE",
  "UNKNOWN_EVIDENCE",
  "INVALID_EVIDENCE_STATUS",
  "UNKNOWN_FACT",
  "INVALID_FACT_STATUS",
  "UNKNOWN_TESTIMONY",
  "UNKNOWN_OBJECTION",
  "INVALID_OBJECTION_STATUS",
  "UNKNOWN_SETTLEMENT_OFFER",
  "INVALID_SETTLEMENT_STATUS",
  "UNKNOWN_RESPONSE",
  "STALE_RESPONSE",
  "UNKNOWN_INTERRUPTION",
  "INVALID_INTERRUPTION_STATUS",
  "DUPLICATE_ENTITY_ID",
] as const;

export type TrialEngineErrorCode = (typeof TRIAL_ENGINE_ERROR_CODES)[number];

export type TrialEngineIssue = {
  code: TrialEngineErrorCode;
  message: string;
  path?: string;
};

export type ActionValidationResult =
  | { ok: true; action: TrialAction }
  | { ok: false; issue: TrialEngineIssue };

export class TrialEngineError extends Error {
  readonly code: TrialEngineErrorCode;
  readonly path?: string;

  constructor(issue: TrialEngineIssue) {
    super(`${issue.code}: ${issue.message}`);
    this.name = "TrialEngineError";
    this.code = issue.code;
    this.path = issue.path;
  }
}

const PHASE_TRANSITIONS: Readonly<Record<TrialPhase, readonly TrialPhase[]>> = {
  pretrial: ["opening", "case_in_chief", "recess"],
  opening: ["case_in_chief", "recess"],
  case_in_chief: ["recess", "pre_closing"],
  recess: [],
  pre_closing: ["closing", "recess"],
  closing: ["jury_instructions"],
  jury_instructions: ["deliberation"],
  deliberation: ["verdict"],
  verdict: ["debrief"],
  debrief: ["complete"],
  complete: [],
};

function invalid(code: TrialEngineErrorCode, message: string, path?: string): ActionValidationResult {
  return { ok: false, issue: { code, message, path } };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const remaining = new Map<string, number>();
  for (const id of right) {
    remaining.set(id, (remaining.get(id) ?? 0) + 1);
  }
  for (const id of left) {
    const count = remaining.get(id) ?? 0;
    if (count === 0) return false;
    if (count === 1) remaining.delete(id);
    else remaining.set(id, count - 1);
  }
  return remaining.size === 0;
}

function hasDuplicateIds(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

function hasPendingStrikeMotion(state: TrialState): boolean {
  return Object.values(state.strikeMotions).some(
    (motion) => motion.status === "pending",
  );
}

function validateJuryConsiderableCitations(
  state: TrialState,
  citations: CitationSet,
): ActionValidationResult | null {
  const groups = [
    ["factIds", citations.factIds],
    ["evidenceIds", citations.evidenceIds],
    ["testimonyIds", citations.testimonyIds],
    ["eventIds", citations.eventIds],
    ["sourceSegmentIds", citations.sourceSegmentIds],
  ] as const;
  for (const [field, ids] of groups) {
    if (hasDuplicateIds(ids)) {
      return invalid(
        "DUPLICATE_ENTITY_ID",
        `Citation ${field} must be unique`,
        `payload.citations.${field}`,
      );
    }
  }
  for (const factId of citations.factIds) {
    if (state.facts[factId]?.status !== "admitted") {
      return invalid(
        "INVALID_FACT_STATUS",
        `Jury-considerable citations require admitted fact ${factId}`,
        "payload.citations.factIds",
      );
    }
  }
  for (const evidenceId of citations.evidenceIds) {
    if (state.evidence[evidenceId]?.status !== "admitted") {
      return invalid(
        "INVALID_EVIDENCE_STATUS",
        `Jury-considerable citations require admitted evidence ${evidenceId}`,
        "payload.citations.evidenceIds",
      );
    }
  }
  for (const testimonyId of citations.testimonyIds) {
    const testimony = state.testimony[testimonyId];
    if (
      !testimony ||
      testimony.status !== "active" ||
      state.transcriptTurns[testimony.turnId]?.status !== "active"
    ) {
      return invalid(
        "UNKNOWN_TESTIMONY",
        `Jury-considerable citations require active testimony ${testimonyId}`,
        "payload.citations.testimonyIds",
      );
    }
  }
  if (citations.eventIds.length > 0) {
    return invalid(
      "INVALID_ACTION",
      "Jury-considerable citations must use admitted facts, admitted evidence, or active testimony instead of raw trial events",
      "payload.citations.eventIds",
    );
  }
  if (citations.sourceSegmentIds.length > 0) {
    return invalid(
      "INVALID_ACTION",
      "Jury-considerable citations cannot expose raw source segments",
      "payload.citations.sourceSegmentIds",
    );
  }
  return null;
}

function validateAssertionProvenance(
  state: TrialState,
  provenanceIds: readonly string[],
): ActionValidationResult | null {
  if (hasDuplicateIds(provenanceIds)) {
    return invalid(
      "DUPLICATE_ENTITY_ID",
      "Assertion provenance IDs must be unique",
      "payload.provenanceIds",
    );
  }
  for (const provenanceId of provenanceIds) {
    const testimony = state.testimony[provenanceId];
    const activeTestimony =
      testimony?.status === "active" &&
      state.transcriptTurns[testimony.turnId]?.status === "active";
    const admittedEvidence =
      state.evidence[provenanceId]?.status === "admitted";
    if (Number(activeTestimony) + Number(admittedEvidence) !== 1) {
      return invalid(
        "INVALID_ACTION",
        `Assertion provenance ${provenanceId} must identify exactly one active testimony or admitted exhibit`,
        "payload.provenanceIds",
      );
    }
  }
  return null;
}

function validatePersistedAssertionBasis(
  state: TrialState,
  fact: FactStateEntry,
): ActionValidationResult | null {
  if (fact.sourceEventId === null) {
    if (
      fact.provenanceIds.length === 0 ||
      fact.provenanceIds.some(
        (provenanceId) => !state.caseProvenanceIds.includes(provenanceId),
      )
    ) {
      return invalid(
        "INVALID_ACTION",
        `Authored fact ${fact.factId} does not retain pinned CaseGraph provenance`,
      );
    }
    return null;
  }
  const basisIssue = validateAssertionProvenance(
    state,
    fact.provenanceIds,
  );
  if (!basisIssue) return null;
  if (basisIssue.ok) {
    throw new Error("Assertion provenance validation returned an unexpected success result");
  }
  return invalid(
    basisIssue.issue.code,
    `Assertion ${fact.factId} no longer has an admissible linked basis: ${basisIssue.issue.message}`,
    "payload.factId",
  );
}

function hasOpenCourtroomWork(
  state: TrialState,
  appearanceId: string,
): boolean {
  if (state.activeQuestionId !== null) return true;
  if (
    Object.values(state.pendingResponses).some(
      (response) =>
        response.appearanceId === appearanceId &&
        (response.status === "pending" || response.status === "streaming"),
    )
  ) {
    return true;
  }
  if (
    Object.values(state.objections).some((objection) => {
      const question = state.questions[objection.questionId];
      return question?.appearanceId === appearanceId && objection.status === "pending";
    })
  ) {
    return true;
  }
  if (
    state.activeInterruption &&
    state.activeInterruption.status !== "cancelled" &&
    state.activeInterruption.status !== "resumed"
  ) {
    const response = state.pendingResponses[
      state.activeInterruption.interruptedResponseId
    ];
    return response?.appearanceId === appearanceId;
  }
  return false;
}

function settlementPartyForActor(
  state: TrialState,
  actorId: string,
): string | null {
  const actor = state.policySnapshot.mappings.actors.find(
    (binding) => binding.actorId === actorId,
  );
  if (!actor) return null;
  const participantIds = new Set(
    state.policySnapshot.settlement.participantPartyIds,
  );
  const representedParticipants = actor.representedPartyIds.filter((partyId) =>
    participantIds.has(partyId),
  );
  return representedParticipants.length === 1
    ? representedParticipants[0]
    : null;
}

function partySideForPolicy(
  state: TrialState,
  partyId: string,
): "user" | "opposing" | "neutral" | null {
  return state.policySnapshot.mappings.parties.find(
    (binding) => binding.partyId === partyId,
  )?.side ?? null;
}

function actorCanAuthorizeSettlementTerms(
  state: TrialState,
  actorId: string,
  partyId: string,
  terms: SettlementTerms,
): boolean {
  if ((terms.amount === null) !== (terms.currency === null)) return false;
  if (
    terms.currency !== null &&
    terms.currency !== state.policySnapshot.settlement.currency
  ) {
    return false;
  }
  if (terms.amount !== null) {
    return canActorAuthorizeSettlement(
      state.policySnapshot,
      actorId,
      {
        partyId,
        amount: terms.amount,
        nonMonetaryTerms: terms.nonMonetaryTerms,
      },
    );
  }
  if (terms.nonMonetaryTerms.length === 0) return false;
  const authority = getSettlementAuthorityForActor(
    state.policySnapshot,
    actorId,
    partyId,
  );
  const permittedTerms = new Set(
    authority?.permittedNonMonetaryTerms ?? [],
  );
  return terms.nonMonetaryTerms.every((term) => permittedTerms.has(term));
}

function validateStartTrialPolicy(
  action: TrialActionByType<"START_TRIAL">,
): ActionValidationResult | null {
  const { payload } = action;
  const policy = payload.policySnapshot;
  if (policy.caseId !== payload.caseId || policy.caseVersion !== payload.caseVersion) {
    return invalid(
      "INVALID_ACTION",
      "START_TRIAL policy does not match the pinned case identity",
      "payload.policySnapshot",
    );
  }

  const policyActors = new Map(
    policy.mappings.actors.map((binding) => [binding.actorId, binding]),
  );
  if (policyActors.size !== payload.actors.length) {
    return invalid(
      "INVALID_ACTION",
      "START_TRIAL policy actor roster is incomplete",
      "payload.policySnapshot.mappings.actors",
    );
  }
  for (const actor of payload.actors) {
    const binding = policyActors.get(actor.actorId);
    if (
      !binding ||
      binding.role !== actor.role ||
      binding.side !== actor.side ||
      binding.witnessId !== actor.witnessId
    ) {
      return invalid(
        "INVALID_ACTION",
        `START_TRIAL policy actor binding does not match ${actor.actorId}`,
        "payload.policySnapshot.mappings.actors",
      );
    }
  }

  const policyParties = new Map(
    policy.mappings.parties.map((binding) => [binding.partyId, binding]),
  );
  if (policyParties.size !== policy.mappings.parties.length) {
    return invalid(
      "DUPLICATE_ENTITY_ID",
      "START_TRIAL policy contains duplicate party mappings",
      "payload.policySnapshot.mappings.parties",
    );
  }
  for (const binding of policy.mappings.actors) {
    for (const partyId of binding.representedPartyIds) {
      const party = policyParties.get(partyId);
      if (
        !party ||
        (binding.role !== "user_counsel" && binding.role !== "opposing_counsel") ||
        binding.side === "neutral" ||
        party.side !== binding.side ||
        !party.representativeActorIds.includes(binding.actorId)
      ) {
        return invalid(
          "INVALID_ACTION",
          `START_TRIAL policy has an inconsistent actor/party representation for ${binding.actorId}:${partyId}`,
          "payload.policySnapshot.mappings",
        );
      }
    }
  }
  for (const party of policy.mappings.parties) {
    for (const actorId of party.representativeActorIds) {
      const binding = policyActors.get(actorId);
      if (
        !binding ||
        binding.side !== party.side ||
        !binding.representedPartyIds.includes(party.partyId)
      ) {
        return invalid(
          "INVALID_ACTION",
          `START_TRIAL policy has an inconsistent party/actor representation for ${party.partyId}:${actorId}`,
          "payload.policySnapshot.mappings",
        );
      }
    }
  }
  const mappedSides = new Map(
    policy.mappings.sides.map((binding) => [binding.side, binding]),
  );
  if (mappedSides.size !== 3) {
    return invalid(
      "INVALID_ACTION",
      "START_TRIAL policy must map user, opposing, and neutral exactly once",
      "payload.policySnapshot.mappings.sides",
    );
  }
  for (const side of ["user", "opposing", "neutral"] as const) {
    const sideBinding = mappedSides.get(side);
    if (
      !sideBinding ||
      !sameIds(
        sideBinding.partyIds,
        policy.mappings.parties
          .filter((party) => party.side === side)
          .map((party) => party.partyId),
      ) ||
      !sameIds(
        sideBinding.actorIds,
        policy.mappings.actors
          .filter((actor) => actor.side === side)
          .map((actor) => actor.actorId),
      ) ||
      !sameIds(
        sideBinding.counselActorIds,
        policy.mappings.actors
          .filter(
            (actor) =>
              actor.side === side &&
              (actor.role === "user_counsel" || actor.role === "opposing_counsel"),
          )
          .map((actor) => actor.actorId),
      )
    ) {
      return invalid(
        "INVALID_ACTION",
        `START_TRIAL policy side mapping is inconsistent for ${side}`,
        "payload.policySnapshot.mappings.sides",
      );
    }
  }

  if (
    !sameIds(
      policy.witnessCallability.map((rule) => rule.witnessId),
      payload.witnessIds,
    )
  ) {
    return invalid(
      "INVALID_ACTION",
      "START_TRIAL policy witness roster does not match the case payload",
      "payload.policySnapshot.witnessCallability",
    );
  }
  if (
    !sameIds(
      policy.witnessKnowledge.map((rule) => rule.witnessId),
      payload.witnessIds,
    )
  ) {
    return invalid(
      "INVALID_ACTION",
      "START_TRIAL policy witness knowledge roster does not match the case payload",
      "payload.policySnapshot.witnessKnowledge",
    );
  }
  if (
    !sameIds(
      policy.evidencePermissions.map((rule) => rule.evidenceId),
      payload.initialEvidence.map((evidence) => evidence.evidenceId),
    )
  ) {
    return invalid(
      "INVALID_ACTION",
      "START_TRIAL policy evidence roster does not match the case payload",
      "payload.policySnapshot.evidencePermissions",
    );
  }
  return null;
}

function ensureActive(state: TrialState, action: TrialAction): ActionValidationResult | null {
  const permittedWhileInactive = new Set<TrialActionType>([
    "RESUME_TRIAL",
    "RECOVER_STEP",
    "GENERATE_DEBRIEF",
  ]);
  if (
    state.status === "settled" &&
    action.type === "BEGIN_PHASE" &&
    action.payload.phase === "complete" &&
    state.phase === "debrief"
  ) {
    return null;
  }
  if (state.status !== "active" && !permittedWhileInactive.has(action.type)) {
    return invalid("TRIAL_NOT_ACTIVE", `Action ${action.type} is not allowed while trial status is ${state.status}`);
  }
  const permittedDuringRecess = new Set<TrialActionType>([
    "RESUME_TRIAL",
    "PAUSE_TRIAL",
    "PROPOSE_SETTLEMENT",
    "COUNTER_SETTLEMENT",
    "ACCEPT_SETTLEMENT",
    "REJECT_SETTLEMENT",
    "WITHDRAW_SETTLEMENT",
    "EXPIRE_SETTLEMENT",
    "UPDATE_OPPOSING_STRATEGY",
    "FAIL_STEP",
    "RECOVER_STEP",
  ]);
  if (state.phase === "recess" && !permittedDuringRecess.has(action.type)) {
    return invalid(
      "WRONG_PHASE",
      `Action ${action.type} is suspended during recess`,
    );
  }
  return null;
}

function ensureActorPermission(state: TrialState, action: TrialAction): ActionValidationResult | null {
  const canonical = state.actors[action.actor.actorId];
  if (!canonical) return invalid("UNKNOWN_ACTOR", `Actor ${action.actor.actorId} is not in the trial roster`, "actor.actorId");
  if (
    canonical.role !== action.actor.role ||
    canonical.side !== action.actor.side ||
    canonical.witnessId !== action.actor.witnessId
  ) {
    return invalid("ACTOR_NOT_PERMITTED", `Actor metadata does not match the canonical roster`, "actor");
  }
  if (!isActionAllowedForActor(canonical.role, action.type)) {
    return invalid(
      "ACTOR_NOT_PERMITTED",
      `${canonical.role} actor ${canonical.actorId} may not perform ${action.type}`,
      "type",
    );
  }
  return null;
}

function validateActionPreconditions(state: TrialState, action: TrialAction): ActionValidationResult | null {
  switch (action.type) {
    case "START_TRIAL":
      return invalid("TRIAL_ALREADY_STARTED", "START_TRIAL is valid only without existing state");
    case "BEGIN_PHASE": {
      if (!PHASE_TRANSITIONS[state.phase].includes(action.payload.phase)) {
        return invalid(
          "ILLEGAL_PHASE_TRANSITION",
          `Cannot transition from ${state.phase} to ${action.payload.phase}`,
          "payload.phase",
        );
      }
      if (action.payload.phase === "pre_closing" && state.restedSides.length !== 2) {
        return invalid("ILLEGAL_PHASE_TRANSITION", "Both sides must rest before pre-closing proceedings");
      }
      if (action.payload.phase === "pre_closing" && state.activeAppearanceId !== null) {
        return invalid("ILLEGAL_PHASE_TRANSITION", "Release the active witness before pre-closing proceedings");
      }
      if (
        action.payload.phase === "pre_closing" &&
        hasPendingStrikeMotion(state)
      ) {
        return invalid(
          "ILLEGAL_PHASE_TRANSITION",
          "Resolve every pending strike motion before pre-closing proceedings",
        );
      }
      if (
        action.payload.phase === "jury_instructions" &&
        !sameIds(state.closingSides, ["user", "opposing"])
      ) {
        return invalid(
          "ILLEGAL_PHASE_TRANSITION",
          "Both sides must give closing argument before jury instructions",
        );
      }
      if (
        action.payload.phase === "deliberation" &&
        state.instructionIds.length === 0
      ) {
        return invalid(
          "ILLEGAL_PHASE_TRANSITION",
          "The jury must receive pinned instructions before deliberation",
        );
      }
      if (action.payload.phase === "verdict" && !state.deliberated) {
        return invalid(
          "ILLEGAL_PHASE_TRANSITION",
          "The jury must deliberate before the verdict phase",
        );
      }
      if (action.payload.phase === "debrief" && state.verdictId === null) {
        return invalid(
          "ILLEGAL_PHASE_TRANSITION",
          "A verdict must be rendered before debrief",
        );
      }
      if (action.payload.phase === "complete" && state.debriefId === null) {
        return invalid(
          "ILLEGAL_PHASE_TRANSITION",
          "A debrief must be generated before completion",
        );
      }
      return null;
    }
    case "CALL_WITNESS":
    case "RECALL_WITNESS": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", `${action.type} requires case_in_chief`);
      const witness = state.witnesses[action.payload.witnessId];
      if (!witness) return invalid("UNKNOWN_WITNESS", `Unknown witness ${action.payload.witnessId}`);
      if (state.restedSides.includes(action.payload.calledBySide)) {
        return invalid("ACTOR_NOT_PERMITTED", `${action.payload.calledBySide} has already rested its case`);
      }
      const allowed = action.type === "CALL_WITNESS" ? witness.status === "available" : witness.status === "released";
      if (!allowed) return invalid("WITNESS_NOT_AVAILABLE", `Witness ${witness.witnessId} cannot be ${action.type.toLowerCase()}`);
      if (state.activeWitnessId !== null || state.activeAppearanceId !== null) return invalid("WITNESS_NOT_AVAILABLE", "Release the active witness before calling another");
      if (action.actor.side !== action.payload.calledBySide) {
        return invalid("ACTOR_NOT_PERMITTED", "Counsel may call a witness only for their own side");
      }
      const policyAllows = action.type === "CALL_WITNESS"
        ? canActorCallWitness(state.policySnapshot, action.actor.actorId, action.payload.witnessId)
        : canActorRecallWitness(state.policySnapshot, action.actor.actorId, action.payload.witnessId);
      if (!policyAllows) {
        return invalid(
          "ACTOR_NOT_PERMITTED",
          `${action.actor.actorId} is not authorized to ${action.type === "CALL_WITNESS" ? "call" : "recall"} ${action.payload.witnessId}`,
        );
      }
      return null;
    }
    case "SWEAR_WITNESS": {
      const witness = state.witnesses[action.payload.witnessId];
      if (!witness) return invalid("UNKNOWN_WITNESS", `Unknown witness ${action.payload.witnessId}`);
      if (state.activeWitnessId !== witness.witnessId || witness.status !== "called") {
        return invalid("WITNESS_NOT_ACTIVE", "Only the called active witness may be sworn");
      }
      const appearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      if (
        !appearance ||
        appearance.witnessId !== witness.witnessId ||
        appearance.stage !== "awaiting_oath"
      ) {
        return invalid("WITNESS_NOT_ACTIVE", "The active appearance is not awaiting an oath");
      }
      return null;
    }
    case "ASK_QUESTION": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "ASK_QUESTION requires case_in_chief");
      if (state.activeWitnessId !== action.payload.witnessId) return invalid("WITNESS_NOT_ACTIVE", "Question must target the active witness");
      const witness = state.witnesses[action.payload.witnessId];
      if (!witness || (witness.status !== "sworn" && witness.status !== "testifying")) {
        return invalid("WITNESS_NOT_ACTIVE", "The active witness must be sworn before questioning");
      }
      const appearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      if (!appearance || appearance.witnessId !== action.payload.witnessId) {
        return invalid("WITNESS_NOT_ACTIVE", "Question must target the active witness appearance");
      }
      if (appearance.stage !== action.payload.examinationKind) {
        return invalid(
          "INVALID_ACTION",
          `Cannot conduct ${action.payload.examinationKind} while appearance stage is ${appearance.stage}`,
        );
      }
      const leg = appearance.legs[action.payload.examinationKind];
      if (leg.ownerSide !== action.actor.side) {
        return invalid("ACTOR_NOT_PERMITTED", `${action.actor.side} does not own ${action.payload.examinationKind}`);
      }
      if (state.activeQuestionId !== null) {
        return invalid("INVALID_ACTION", `Question ${state.activeQuestionId} is still active`);
      }
      if (state.questions[action.payload.questionId]) {
        return invalid("DUPLICATE_ENTITY_ID", `Question ${action.payload.questionId} already exists`);
      }
      if (state.transcriptTurns[action.payload.turnId]) {
        return invalid("DUPLICATE_ENTITY_ID", `Transcript turn ${action.payload.turnId} already exists`);
      }
      if (hasDuplicateIds(action.payload.presentedEvidenceIds)) {
        return invalid(
          "DUPLICATE_ENTITY_ID",
          "Presented evidence IDs must be unique",
          "payload.presentedEvidenceIds",
        );
      }
      for (const evidenceId of action.payload.presentedEvidenceIds) {
        const evidence = state.evidence[evidenceId];
        if (!evidence) {
          return invalid("UNKNOWN_EVIDENCE", `Unknown presented evidence ${evidenceId}`);
        }
        if (evidence.status === "excluded" || evidence.status === "withdrawn") {
          return invalid(
            "INVALID_EVIDENCE_STATUS",
            `Cannot present ${evidence.status} evidence ${evidenceId}`,
          );
        }
        if (!canWitnessReferenceEvidence(
          state.policySnapshot,
          action.payload.witnessId,
          evidenceId,
        )) {
          return invalid(
            "ACTOR_NOT_PERMITTED",
            `Witness ${action.payload.witnessId} has not seen ${evidenceId}`,
          );
        }
      }
      return null;
    }
    case "REPHRASE_QUESTION": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "REPHRASE_QUESTION requires case_in_chief");
      const original = state.questions[action.payload.originalQuestionId];
      if (!original) return invalid("INVALID_ACTION", `Unknown question ${action.payload.originalQuestionId}`);
      const sustained = Object.values(state.objections).some(
        (objection) => objection.questionId === original.questionId && objection.status === "sustained" && objection.remedy === "rephrase",
      );
      if (!sustained || original.status !== "sustained") {
        return invalid("INVALID_OBJECTION_STATUS", "Rephrasing requires a sustained rephrase ruling");
      }
      if (original.askedByActorId !== action.actor.actorId) {
        return invalid("ACTOR_NOT_PERMITTED", "Only the original examining counsel may rephrase");
      }
      const appearance = state.appearances[original.appearanceId];
      if (
        !appearance ||
        state.activeAppearanceId !== original.appearanceId ||
        appearance.stage !== original.examinationKind
      ) {
        return invalid("INVALID_ACTION", "Rephrased question does not match the active examination leg");
      }
      if (state.activeQuestionId !== null) {
        return invalid("INVALID_ACTION", `Question ${state.activeQuestionId} is still active`);
      }
      if (state.questions[action.payload.questionId] || state.transcriptTurns[action.payload.turnId]) {
        return invalid("DUPLICATE_ENTITY_ID", "Rephrased question and transcript turn IDs must be unique");
      }
      return null;
    }
    case "ANSWER_QUESTION": {
      if (state.activeWitnessId !== action.payload.witnessId || state.activeQuestionId !== action.payload.questionId) {
        return invalid("WITNESS_NOT_ACTIVE", "Answer does not match the active witness and question");
      }
      if (action.actor.witnessId !== action.payload.witnessId) {
        return invalid("ACTOR_NOT_PERMITTED", "Witness actor does not match answer witnessId");
      }
      const question = state.questions[action.payload.questionId];
      if (
        !question ||
        question.status !== "open" ||
        question.witnessId !== action.payload.witnessId ||
        question.appearanceId !== state.activeAppearanceId
      ) {
        return invalid("INVALID_ACTION", "Answer does not match the active question record");
      }
      const pending = state.pendingResponses[action.payload.responseId];
      if (!pending) return invalid("UNKNOWN_RESPONSE", `Unknown response ${action.payload.responseId}`);
      if (pending.actorId !== action.actor.actorId) {
        return invalid("ACTOR_NOT_PERMITTED", `Response ${pending.responseId} belongs to actor ${pending.actorId}`);
      }
      if ((pending.status !== "pending" && pending.status !== "streaming") || pending.expectedStateVersion !== state.version) {
        return invalid("STALE_RESPONSE", `Response ${pending.responseId} is cancelled, committed, or stale`);
      }
      if (
        pending.appearanceId !== question.appearanceId ||
        pending.questionId !== question.questionId ||
        pending.witnessId !== question.witnessId ||
        question.activeResponseId !== pending.responseId
      ) {
        return invalid("STALE_RESPONSE", `Response ${pending.responseId} is not bound to the active question`);
      }
      if (state.testimony[action.payload.testimonyId]) {
        return invalid("DUPLICATE_ENTITY_ID", `Testimony ${action.payload.testimonyId} already exists`);
      }
      if (state.transcriptTurns[action.payload.turnId]) {
        return invalid("DUPLICATE_ENTITY_ID", `Transcript turn ${action.payload.turnId} already exists`);
      }
      if (
        hasDuplicateIds(action.payload.factIds) ||
        hasDuplicateIds(action.payload.evidenceIds)
      ) {
        return invalid(
          "DUPLICATE_ENTITY_ID",
          "Answer fact and evidence citations must be unique",
        );
      }
      if (
        Object.values(state.objections).some(
          (objection) => objection.questionId === question.questionId && objection.status === "pending",
        ) ||
        (state.activeInterruption &&
          state.activeInterruption.status !== "cancelled" &&
          state.activeInterruption.status !== "resumed")
      ) {
        return invalid("INVALID_OBJECTION_STATUS", "Resolve the objection or interruption before answering");
      }
      for (const factId of action.payload.factIds) {
        const fact = state.facts[factId];
        if (!fact) return invalid("UNKNOWN_FACT", `Answer cites unknown fact ${factId}`);
        if (fact.status === "excluded" || fact.status === "stricken") {
          return invalid(
            "INVALID_FACT_STATUS",
            `Answer cannot rely on ${fact.status} fact ${factId}`,
          );
        }
        if (!canWitnessRevealFact(
          state.policySnapshot,
          action.payload.witnessId,
          factId,
        )) {
          return invalid(
            "ACTOR_NOT_PERMITTED",
            `Witness ${action.payload.witnessId} does not know ${factId}`,
          );
        }
      }
      for (const evidenceId of action.payload.evidenceIds) {
        const evidence = state.evidence[evidenceId];
        if (!evidence) return invalid("UNKNOWN_EVIDENCE", `Answer cites unknown evidence ${evidenceId}`);
        if (evidence.status === "excluded" || evidence.status === "withdrawn") {
          return invalid(
            "INVALID_EVIDENCE_STATUS",
            `Answer cannot rely on ${evidence.status} evidence ${evidenceId}`,
          );
        }
        if (!canWitnessReferenceEvidence(
          state.policySnapshot,
          action.payload.witnessId,
          evidenceId,
        )) {
          return invalid("ACTOR_NOT_PERMITTED", `Witness ${action.payload.witnessId} has not seen ${evidenceId}`);
        }
        if (
          evidence.status !== "admitted" &&
          !question.presentedEvidenceIds.includes(evidenceId)
        ) {
          return invalid(
            "INVALID_EVIDENCE_STATUS",
            `Non-admitted evidence ${evidenceId} must be presented in the active question`,
          );
        }
      }
      return null;
    }
    case "END_EXAMINATION": {
      if (state.activeWitnessId !== action.payload.witnessId) return invalid("WITNESS_NOT_ACTIVE", "Action must target the active witness");
      const appearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      if (!appearance || appearance.witnessId !== action.payload.witnessId) {
        return invalid("WITNESS_NOT_ACTIVE", "Action must target the active witness appearance");
      }
      if (appearance.stage !== action.payload.examinationKind) {
        return invalid("INVALID_ACTION", `Cannot end ${action.payload.examinationKind} during ${appearance.stage}`);
      }
      const leg = appearance.legs[action.payload.examinationKind];
      if (leg.ownerSide !== action.actor.side) {
        return invalid("ACTOR_NOT_PERMITTED", `${action.actor.side} does not own ${action.payload.examinationKind}`);
      }
      if (hasOpenCourtroomWork(state, appearance.appearanceId)) {
        return invalid("INVALID_ACTION", "Resolve the active question, response, objection, or interruption first");
      }
      const disposition = action.payload.disposition ?? "completed";
      if (disposition === "completed" && leg.answeredQuestionCount === 0) {
        return invalid("INVALID_ACTION", "A completed examination leg requires at least one answer");
      }
      if (disposition === "waived" && leg.answeredQuestionCount > 0) {
        return invalid("INVALID_ACTION", "A started examination leg cannot be waived");
      }
      return null;
    }
    case "RELEASE_WITNESS": {
      if (state.activeWitnessId !== action.payload.witnessId) return invalid("WITNESS_NOT_ACTIVE", "Action must target the active witness");
      const appearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      if (!appearance || appearance.witnessId !== action.payload.witnessId) {
        return invalid("WITNESS_NOT_ACTIVE", "Action must target the active witness appearance");
      }
      if (appearance.callingSide !== action.actor.side) {
        return invalid("ACTOR_NOT_PERMITTED", "Only the calling side may release the witness");
      }
      if (appearance.stage !== "ready_for_release") {
        return invalid("INVALID_ACTION", `Witness cannot be released during ${appearance.stage}`);
      }
      if (hasOpenCourtroomWork(state, appearance.appearanceId)) {
        return invalid("INVALID_ACTION", "Resolve open courtroom work before releasing the witness");
      }
      return null;
    }
    case "OBJECT": {
      if (state.phase !== "case_in_chief") {
        return invalid("WRONG_PHASE", "Objections require case_in_chief");
      }
      if (state.activeQuestionId !== action.payload.questionId) return invalid("INVALID_OBJECTION_STATUS", "Objection must target the active question");
      if (state.objections[action.payload.objectionId]) return invalid("DUPLICATE_ENTITY_ID", `Duplicate objection ${action.payload.objectionId}`);
      const question = state.questions[action.payload.questionId];
      if (!question || question.status !== "open") {
        return invalid("INVALID_OBJECTION_STATUS", "Objection must target an open question");
      }
      if (question.askedBySide === action.actor.side) {
        return invalid("ACTOR_NOT_PERMITTED", "Examining counsel cannot object to its own question");
      }
      if (
        Object.values(state.objections).some(
          (objection) =>
            objection.questionId === question.questionId &&
            objection.status === "pending",
        )
      ) {
        return invalid("INVALID_OBJECTION_STATUS", "The active question already has a pending objection");
      }
      if (!canActorRaiseObjection(
        state.policySnapshot,
        action.actor.actorId,
        action.payload.ground,
      )) {
        return invalid(
          "ACTOR_NOT_PERMITTED",
          `Objection ground ${action.payload.ground} is not permitted by the pinned trial policy`,
          "payload.ground",
        );
      }
      if (action.payload.interruptedResponseId) {
        const response = state.pendingResponses[action.payload.interruptedResponseId];
        if (!response) {
          return invalid("UNKNOWN_RESPONSE", `Unknown interrupted response ${action.payload.interruptedResponseId}`);
        }
        if (
          response.questionId !== question.questionId ||
          question.activeResponseId !== response.responseId ||
          (response.status !== "pending" && response.status !== "streaming")
        ) {
          return invalid("STALE_RESPONSE", "Objection response is not active for the targeted question");
        }
      } else if (question.activeResponseId !== null) {
        return invalid("INVALID_OBJECTION_STATUS", "Objection must identify the active response it interrupts");
      }
      return null;
    }
    case "RULE_ON_OBJECTION": {
      if (state.phase !== "case_in_chief") {
        return invalid("WRONG_PHASE", "Objection rulings require case_in_chief");
      }
      const objection = state.objections[action.payload.objectionId];
      if (!objection) return invalid("UNKNOWN_OBJECTION", `Unknown objection ${action.payload.objectionId}`);
      if (objection.status !== "pending") return invalid("INVALID_OBJECTION_STATUS", "Objection has already been resolved");
      const interruptedResponseId = objection.interruptedResponseId;
      if (
        interruptedResponseId &&
        (
          state.activeInterruption?.objectionId !== objection.objectionId ||
          state.activeInterruption.interruptedResponseId !== interruptedResponseId ||
          state.activeInterruption.status !== "active"
        )
      ) {
        return invalid(
          "INVALID_INTERRUPTION_STATUS",
          "An objection to streaming speech must have its matching active interruption before ruling",
        );
      }
      if (action.payload.ruling === "overruled") {
        const expectedRemedy = interruptedResponseId ? "resume_response" : "none";
        if (action.payload.remedy !== expectedRemedy) {
          return invalid(
            "INVALID_OBJECTION_STATUS",
            `An overruled objection requires remedy ${expectedRemedy}`,
          );
        }
      } else {
        const permittedRemedies = interruptedResponseId
          ? new Set(["cancel_response", "rephrase"])
          : new Set(["rephrase"]);
        if (
          action.payload.remedy === null ||
          !permittedRemedies.has(action.payload.remedy)
        ) {
          return invalid(
            "INVALID_OBJECTION_STATUS",
            "A sustained objection requires rephrasing or response cancellation; committed testimony must use a strike motion",
          );
        }
      }
      return null;
    }
    case "MOVE_TO_STRIKE": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Strike motions require case_in_chief");
      if (state.strikeMotions[action.payload.motionId]) {
        return invalid("DUPLICATE_ENTITY_ID", `Strike motion ${action.payload.motionId} already exists`);
      }
      if (hasDuplicateIds(action.payload.testimonyIds)) {
        return invalid(
          "DUPLICATE_ENTITY_ID",
          "A strike motion cannot repeat testimony IDs",
        );
      }
      for (const testimonyId of action.payload.testimonyIds) {
        const testimony = state.testimony[testimonyId];
        if (!testimony) return invalid("UNKNOWN_TESTIMONY", `Unknown testimony ${testimonyId}`);
      }
      return null;
    }
    case "STRIKE_TESTIMONY": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Strike rulings require case_in_chief");
      const motion = state.strikeMotions[action.payload.motionId];
      if (!motion || motion.status !== "pending") {
        return invalid("INVALID_ACTION", `Strike motion ${action.payload.motionId} is not pending`);
      }
      if (!sameIds(motion.testimonyIds, action.payload.testimonyIds)) {
        return invalid("INVALID_ACTION", "Strike ruling must match the pending motion testimony IDs");
      }
      const testimonyFactIds = new Set<string>();
      for (const testimonyId of action.payload.testimonyIds) {
        const testimony = state.testimony[testimonyId];
        if (!testimony) return invalid("UNKNOWN_TESTIMONY", `Unknown testimony ${testimonyId}`);
        if (testimony.status !== "active") {
          return invalid("INVALID_FACT_STATUS", `Testimony ${testimonyId} is already stricken`);
        }
        testimony.factIds.forEach((factId) => testimonyFactIds.add(factId));
      }
      if (!sameIds([...testimonyFactIds], action.payload.factIds)) {
        return invalid(
          "INVALID_ACTION",
          "Strike ruling fact IDs must exactly match the cited facts in the testimony",
        );
      }
      return null;
    }
    case "DENY_STRIKE_MOTION": {
      if (state.phase !== "case_in_chief") {
        return invalid("WRONG_PHASE", "Strike rulings require case_in_chief");
      }
      const motion = state.strikeMotions[action.payload.motionId];
      if (!motion || motion.status !== "pending") {
        return invalid(
          "INVALID_ACTION",
          `Strike motion ${action.payload.motionId} is not pending`,
        );
      }
      return null;
    }
    case "WITHDRAW_STRIKE_MOTION": {
      if (state.phase !== "case_in_chief") {
        return invalid("WRONG_PHASE", "Strike motions require case_in_chief");
      }
      const motion = state.strikeMotions[action.payload.motionId];
      if (!motion || motion.status !== "pending") {
        return invalid(
          "INVALID_ACTION",
          `Strike motion ${action.payload.motionId} is not pending`,
        );
      }
      if (motion.movedByActorId !== action.actor.actorId) {
        return invalid(
          "ACTOR_NOT_PERMITTED",
          "Only the moving counsel may withdraw a strike motion",
        );
      }
      return null;
    }
    case "OFFER_EVIDENCE": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Evidence may be offered only during case_in_chief");
      const evidence = state.evidence[action.payload.evidenceId];
      if (!evidence) return invalid("UNKNOWN_EVIDENCE", `Unknown evidence ${action.payload.evidenceId}`);
      if (evidence.status !== "uploaded" && evidence.status !== "indexed") {
        return invalid("INVALID_EVIDENCE_STATUS", `Evidence ${evidence.evidenceId} cannot be offered from ${evidence.status}`);
      }
      if (action.actor.side !== action.payload.offeredBySide) return invalid("ACTOR_NOT_PERMITTED", "Counsel may offer evidence only for their side");
      if (!canActorOfferEvidence(
        state.policySnapshot,
        action.actor.actorId,
        action.payload.evidenceId,
      )) {
        return invalid(
          "ACTOR_NOT_PERMITTED",
          `${action.actor.actorId} is not authorized to offer ${action.payload.evidenceId}`,
        );
      }
      if (hasDuplicateIds(action.payload.foundationTestimonyIds)) {
        return invalid(
          "DUPLICATE_ENTITY_ID",
          "Evidence foundation testimony IDs must be unique",
        );
      }
      const evidenceRule = state.policySnapshot.evidencePermissions.find(
        (rule) => rule.evidenceId === action.payload.evidenceId,
      );
      if (!evidenceRule) {
        return invalid("UNKNOWN_EVIDENCE", `No pinned evidence rule for ${action.payload.evidenceId}`);
      }
      if (
        evidenceRule.authenticatingWitnessIds.length > 0 &&
        action.payload.foundationTestimonyIds.length === 0
      ) {
        return invalid(
          "INVALID_EVIDENCE_STATUS",
          "Evidence requiring authentication must cite foundation testimony",
        );
      }
      for (const testimonyId of action.payload.foundationTestimonyIds) {
        const testimony = state.testimony[testimonyId];
        if (!testimony) return invalid("UNKNOWN_TESTIMONY", `Unknown foundation testimony ${testimonyId}`);
        if (
          testimony.status !== "active" ||
          !testimony.evidenceIds.includes(action.payload.evidenceId) ||
          !evidenceRule.authenticatingWitnessIds.includes(testimony.witnessId)
        ) {
          return invalid(
            "INVALID_EVIDENCE_STATUS",
            `Testimony ${testimonyId} does not authenticate ${action.payload.evidenceId}`,
          );
        }
      }
      return null;
    }
    case "RULE_ON_EVIDENCE": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Evidence rulings require case_in_chief");
      const evidence = state.evidence[action.payload.evidenceId];
      if (!evidence) return invalid("UNKNOWN_EVIDENCE", `Unknown evidence ${action.payload.evidenceId}`);
      if (evidence.status !== "offered") return invalid("INVALID_EVIDENCE_STATUS", "Only offered evidence may be ruled on");
      const evidenceRule = state.policySnapshot.evidencePermissions.find(
        (rule) => rule.evidenceId === evidence.evidenceId,
      );
      if (!evidenceRule) {
        return invalid("UNKNOWN_EVIDENCE", `No pinned evidence rule for ${evidence.evidenceId}`);
      }
      if (
        action.payload.ruling === "admitted" &&
        evidenceRule.authenticatingWitnessIds.length > 0 &&
        evidence.foundationTestimonyIds.length === 0
      ) {
        return invalid(
          "INVALID_EVIDENCE_STATUS",
          "Evidence cannot be admitted without its recorded foundation",
        );
      }
      if (action.payload.ruling === "admitted") {
        if (hasDuplicateIds(evidence.foundationTestimonyIds)) {
          return invalid(
            "DUPLICATE_ENTITY_ID",
            "Recorded evidence foundation testimony IDs must be unique",
          );
        }
        for (const testimonyId of evidence.foundationTestimonyIds) {
          const testimony = state.testimony[testimonyId];
          if (
            !testimony ||
            testimony.status !== "active" ||
            !testimony.evidenceIds.includes(evidence.evidenceId) ||
            !evidenceRule.authenticatingWitnessIds.includes(testimony.witnessId)
          ) {
            return invalid(
              "INVALID_EVIDENCE_STATUS",
              `Recorded foundation testimony ${testimonyId} is no longer valid for ${evidence.evidenceId}`,
            );
          }
        }
      }
      return null;
    }
    case "WITHDRAW_EVIDENCE": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Evidence may be withdrawn only during case_in_chief");
      const evidence = state.evidence[action.payload.evidenceId];
      if (!evidence) return invalid("UNKNOWN_EVIDENCE", `Unknown evidence ${action.payload.evidenceId}`);
      if (evidence.status !== "offered") return invalid("INVALID_EVIDENCE_STATUS", "Only a pending offered exhibit may be withdrawn");
      if (evidence.offeredBySide !== action.actor.side) return invalid("ACTOR_NOT_PERMITTED", "Only offering counsel may withdraw evidence");
      return null;
    }
    case "REVEAL_HIDDEN_FACT": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Hidden facts may be revealed only during case_in_chief");
      const fact = state.facts[action.payload.factId];
      if (!fact) return invalid("UNKNOWN_FACT", `Unknown fact ${action.payload.factId}`);
      if (fact.status !== "hidden") return invalid("INVALID_FACT_STATUS", "Only a hidden fact may be revealed");
      const evidence = state.evidence[action.payload.basis.evidenceId];
      if (!evidence) {
        return invalid("UNKNOWN_EVIDENCE", `Unknown evidence ${action.payload.basis.evidenceId}`);
      }
      if (evidence.status !== "admitted") {
        return invalid("INVALID_EVIDENCE_STATUS", "Only admitted evidence may reveal a hidden fact");
      }
      if (!canEvidenceRevealFact(
        state.policySnapshot,
        evidence.evidenceId,
        action.payload.factId,
      )) {
        return invalid(
          "ACTOR_NOT_PERMITTED",
          `Evidence ${evidence.evidenceId} is not linked to hidden fact ${action.payload.factId}`,
        );
      }
      return null;
    }
    case "PROPOSE_ASSERTION": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Assertions may be proposed only during case_in_chief");
      if (state.facts[action.payload.factId]) {
        return invalid("DUPLICATE_ENTITY_ID", `Fact ${action.payload.factId} already exists`);
      }
      return validateAssertionProvenance(state, action.payload.provenanceIds);
    }
    case "VERIFY_ASSERTION": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Assertion review requires case_in_chief");
      const fact = state.facts[action.payload.factId];
      if (!fact) return invalid("UNKNOWN_FACT", `Unknown fact ${action.payload.factId}`);
      if (fact.status !== "proposed" && fact.status !== "disputed") {
        return invalid("INVALID_FACT_STATUS", `${action.type} cannot operate on ${fact.status} fact`);
      }
      return validatePersistedAssertionBasis(state, fact);
    }
    case "DISPUTE_ASSERTION": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Assertion review requires case_in_chief");
      const fact = state.facts[action.payload.factId];
      if (!fact) return invalid("UNKNOWN_FACT", `Unknown fact ${action.payload.factId}`);
      if (fact.status !== "proposed" && fact.status !== "disputed") {
        return invalid("INVALID_FACT_STATUS", `${action.type} cannot operate on ${fact.status} fact`);
      }
      return null;
    }
    case "RULE_ON_ASSERTION": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "Assertion rulings require case_in_chief");
      const fact = state.facts[action.payload.factId];
      if (!fact) return invalid("UNKNOWN_FACT", `Unknown fact ${action.payload.factId}`);
      if (fact.status !== "verified" && fact.status !== "disputed") {
        return invalid("INVALID_FACT_STATUS", `Only a verified or disputed assertion may receive a courtroom ruling`);
      }
      return validatePersistedAssertionBasis(state, fact);
    }
    case "REQUEST_RESPONSE": {
      if (state.pendingResponses[action.payload.responseId]) {
        return invalid("DUPLICATE_ENTITY_ID", `Response ${action.payload.responseId} already exists`);
      }
      const responseActor = state.actors[action.payload.actorId];
      if (!responseActor) return invalid("UNKNOWN_ACTOR", `Unknown response actor ${action.payload.actorId}`);
      if (responseActor.role === "witness" && state.activeQuestionId === null) {
        return invalid("INVALID_ACTION", "A witness response requires an active question");
      }
      if (
        state.activeQuestionId !== null &&
        (responseActor.role !== "witness" || responseActor.witnessId !== state.activeWitnessId)
      ) {
        return invalid("ACTOR_NOT_PERMITTED", "A question response must be assigned to the active witness");
      }
      if (state.activeQuestionId !== null) {
        const question = state.questions[state.activeQuestionId];
        if (!question || question.status !== "open") {
          return invalid("INVALID_ACTION", "The active question cannot accept a response");
        }
        if (question.activeResponseId !== null) {
          return invalid("DUPLICATE_ENTITY_ID", `Question ${question.questionId} already has an active response`);
        }
      }
      return null;
    }
    case "CANCEL_RESPONSE":
    case "COMPLETE_RESPONSE": {
      const response = state.pendingResponses[action.payload.responseId];
      if (!response) return invalid("UNKNOWN_RESPONSE", `Unknown response ${action.payload.responseId}`);
      if (response.status !== "pending" && response.status !== "streaming") {
        return invalid("STALE_RESPONSE", `Response ${response.responseId} is already ${response.status}`);
      }
      return null;
    }
    case "BEGIN_INTERRUPTION": {
      if (
        state.activeInterruption?.status === "active" ||
        state.activeInterruption?.status === "resolved"
      ) {
        return invalid("INVALID_INTERRUPTION_STATUS", "An interruption is already active or awaiting resume");
      }
      const response = state.pendingResponses[action.payload.interruptedResponseId];
      if (!response) return invalid("UNKNOWN_RESPONSE", `Unknown response ${action.payload.interruptedResponseId}`);
      if (response.status === "cancelled" || response.status === "committed") return invalid("STALE_RESPONSE", "Cannot interrupt a closed response");
      if (
        response.questionId === null ||
        state.activeQuestionId !== response.questionId ||
        state.questions[response.questionId]?.activeResponseId !== response.responseId
      ) {
        return invalid("STALE_RESPONSE", "Interruption must target the active question response");
      }
      if (action.payload.objectionId) {
        const objection = state.objections[action.payload.objectionId];
        if (
          !objection ||
          objection.status !== "pending" ||
          objection.questionId !== response.questionId ||
          objection.interruptedResponseId !== response.responseId
        ) {
          return invalid("UNKNOWN_OBJECTION", "Interruption objection does not match the active response");
        }
      } else if (action.actor.role !== "system") {
        return invalid("ACTOR_NOT_PERMITTED", "Counsel interruption requires a committed objection");
      }
      return null;
    }
    case "RESOLVE_INTERRUPTION": {
      if (!state.activeInterruption || state.activeInterruption.interruptId !== action.payload.interruptId) {
        return invalid("UNKNOWN_INTERRUPTION", `Unknown active interruption ${action.payload.interruptId}`);
      }
      if (state.activeInterruption.status !== "active") return invalid("INVALID_INTERRUPTION_STATUS", "Interruption is not active");
      if (state.activeInterruption.objectionId) {
        const objection = state.objections[state.activeInterruption.objectionId];
        if (!objection || objection.status === "pending") {
          return invalid("INVALID_OBJECTION_STATUS", "Rule on the objection before resolving its interruption");
        }
        const expectedOutcome = objection.status === "overruled" ? "resume" : "cancel";
        if (action.payload.outcome !== expectedOutcome) {
          return invalid(
            "INVALID_INTERRUPTION_STATUS",
            `Objection ruling requires interruption outcome ${expectedOutcome}`,
          );
        }
      }
      return null;
    }
    case "RESUME_INTERRUPTED_SPEECH": {
      if (!state.activeInterruption || state.activeInterruption.interruptId !== action.payload.interruptId) {
        return invalid("UNKNOWN_INTERRUPTION", `Unknown interruption ${action.payload.interruptId}`);
      }
      if (state.activeInterruption.interruptedResponseId !== action.payload.interruptedResponseId) {
        return invalid("UNKNOWN_RESPONSE", "Resume action does not match the interrupted response");
      }
      const response = state.pendingResponses[action.payload.interruptedResponseId];
      if (!response) return invalid("UNKNOWN_RESPONSE", `Unknown response ${action.payload.interruptedResponseId}`);
      if (
        response.interruptId !== action.payload.interruptId ||
        (response.status !== "pending" && response.status !== "streaming")
      ) {
        return invalid("STALE_RESPONSE", `Response ${response.responseId} was cancelled, committed, or superseded`);
      }
      if (state.activeInterruption.status !== "resolved") return invalid("INVALID_INTERRUPTION_STATUS", "Interruption must resolve before speech resumes");
      return null;
    }
    case "PAUSE_TRIAL":
      return state.status === "active" ? null : invalid("TRIAL_NOT_ACTIVE", "Only an active trial may be paused");
    case "REQUEST_RECESS": {
      if (
        state.activeQuestionId !== null ||
        state.activeInterruption !== null ||
        Object.values(state.pendingResponses).some(
          (response) => response.status === "pending" || response.status === "streaming",
        ) ||
        Object.values(state.objections).some((objection) => objection.status === "pending")
      ) {
        return invalid(
          "INVALID_ACTION",
          "Resolve the active question, response, interruption, and objection before recess",
        );
      }
      return ([
        "pretrial",
        "opening",
        "case_in_chief",
        "pre_closing",
        "closing",
        "jury_instructions",
      ] as const).includes(
        state.phase as "pretrial" | "opening" | "case_in_chief" | "pre_closing" | "closing" | "jury_instructions",
      )
        ? null
        : invalid("WRONG_PHASE", `A recess cannot begin during ${state.phase}`);
    }
    case "RESUME_TRIAL":
      return state.status === "paused" || state.phase === "recess"
        ? null
        : invalid("TRIAL_NOT_ACTIVE", "Only a paused trial or recess may resume");
    case "PROPOSE_SETTLEMENT":
    case "COUNTER_SETTLEMENT": {
      const settlementPartyId = settlementPartyForActor(
        state,
        action.actor.actorId,
      );
      if (!settlementPartyId) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          "Settlement action requires exactly one represented participant party",
        );
      }
      if (action.payload.proposedByPartyId !== settlementPartyId) {
        return invalid(
          "ACTOR_NOT_PERMITTED",
          "Settlement proposer must match the actor's pinned represented party",
          "payload.proposedByPartyId",
        );
      }
      if (!state.policySnapshot.settlement.enabled) {
        return invalid("INVALID_SETTLEMENT_STATUS", "Settlement is disabled by the pinned trial policy");
      }
      const policyAllows = action.type === "PROPOSE_SETTLEMENT"
        ? canActorProposeSettlement(state.policySnapshot, action.actor.actorId, state.phase)
        : canActorCounterSettlement(state.policySnapshot, action.actor.actorId, state.phase);
      if (!state.policySnapshot.settlement.openPhases.includes(
        state.phase as (typeof state.policySnapshot.settlement.openPhases)[number],
      )) {
        return invalid("WRONG_PHASE", "Settlement is closed in the current phase");
      }
      if (!policyAllows) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          action.type === "COUNTER_SETTLEMENT"
            ? "Counteroffers are disabled or the actor lacks settlement authority"
            : "The actor lacks settlement authority",
        );
      }
      const expectedExpiry = settlementExpirySequence(
        state.policySnapshot,
        state.lastSequence + 1,
      );
      if (action.payload.expiresAtSequence !== expectedExpiry) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          `Settlement offer must expire at configured sequence ${expectedExpiry}`,
          "payload.expiresAtSequence",
        );
      }
      if (
        action.payload.terms.currency !== null &&
        action.payload.terms.currency !== state.policySnapshot.settlement.currency
      ) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          `Settlement currency must be ${state.policySnapshot.settlement.currency}`,
          "payload.terms.currency",
        );
      }
      if (
        (action.payload.terms.amount === null) !==
        (action.payload.terms.currency === null)
      ) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          "Settlement amount and currency must be provided together",
        );
      }
      if (!actorCanAuthorizeSettlementTerms(
        state,
        action.actor.actorId,
        settlementPartyId,
        action.payload.terms,
      )) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          "Settlement terms exceed the actor's private authority",
        );
      }
      if (
        hasDuplicateIds(action.payload.recipientPartyIds) ||
        action.payload.recipientPartyIds.length === 0
      ) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          "Settlement recipients must be a nonempty unique party list",
        );
      }
      for (const recipientPartyId of action.payload.recipientPartyIds) {
        const recipientSide = partySideForPolicy(state, recipientPartyId);
        if (
          recipientPartyId === settlementPartyId ||
          !state.policySnapshot.settlement.participantPartyIds.includes(recipientPartyId) ||
          recipientSide === null ||
          recipientSide === action.actor.side ||
          recipientSide === "neutral"
        ) {
          return invalid(
            "ACTOR_NOT_PERMITTED",
            `Invalid settlement recipient ${recipientPartyId}`,
          );
        }
      }
      if (state.settlementOffers[action.payload.offerId]) return invalid("DUPLICATE_ENTITY_ID", `Offer ${action.payload.offerId} already exists`);
      if (
        action.type === "PROPOSE_SETTLEMENT" &&
        state.activeSettlementOfferId !== null
      ) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          `Resolve active offer ${state.activeSettlementOfferId} before opening another negotiation`,
        );
      }
      if (
        action.type === "PROPOSE_SETTLEMENT" &&
        action.payload.parentOfferId !== null
      ) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          "A new settlement proposal cannot name a parent offer",
        );
      }
      if (action.type === "COUNTER_SETTLEMENT") {
        if (action.payload.parentOfferId !== state.activeSettlementOfferId) {
          return invalid(
            "INVALID_SETTLEMENT_STATUS",
            "A counteroffer must target the active settlement offer",
          );
        }
        const parent = action.payload.parentOfferId ? state.settlementOffers[action.payload.parentOfferId] : undefined;
        if (!parent) return invalid("UNKNOWN_SETTLEMENT_OFFER", "Counteroffer requires an existing parent offer");
        if (parent.status !== "open") return invalid("INVALID_SETTLEMENT_STATUS", "Only an open offer may be countered");
        if (isSettlementOfferExpired(parent.expiresAtSequence, state.lastSequence + 1)) {
          return invalid("INVALID_SETTLEMENT_STATUS", "An expired offer cannot be countered");
        }
        if (
          !parent.recipientPartyIds.includes(settlementPartyId) ||
          parent.proposedByPartyId === settlementPartyId ||
          parent.proposedBySide === action.actor.side
        ) {
          return invalid("ACTOR_NOT_PERMITTED", "A counteroffer must come from the counterparty");
        }
        if (!sameIds(
          action.payload.recipientPartyIds,
          [parent.proposedByPartyId],
        )) {
          return invalid(
            "INVALID_SETTLEMENT_STATUS",
            "A counteroffer must be addressed to the parent offer's proposing party",
          );
        }
      }
      return null;
    }
    case "ACCEPT_SETTLEMENT":
    case "REJECT_SETTLEMENT":
    case "WITHDRAW_SETTLEMENT":
    case "EXPIRE_SETTLEMENT": {
      const offer = state.settlementOffers[action.payload.offerId];
      if (!offer) return invalid("UNKNOWN_SETTLEMENT_OFFER", `Unknown offer ${action.payload.offerId}`);
      if (offer.status !== "open") return invalid("INVALID_SETTLEMENT_STATUS", `Offer is already ${offer.status}`);
      if (state.activeSettlementOfferId !== offer.offerId) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          `Offer ${offer.offerId} is not the active settlement offer`,
        );
      }
      const actingPartyId = action.type === "EXPIRE_SETTLEMENT"
        ? null
        : settlementPartyForActor(state, action.actor.actorId);
      if (action.type !== "EXPIRE_SETTLEMENT" && !actingPartyId) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          "Settlement action requires exactly one represented participant party",
        );
      }
      if (
        (action.type === "ACCEPT_SETTLEMENT" || action.type === "REJECT_SETTLEMENT") &&
        (!actingPartyId ||
          !offer.recipientPartyIds.includes(actingPartyId) ||
          offer.proposedByPartyId === actingPartyId ||
          offer.proposedBySide === action.actor.side)
      ) {
        return invalid("ACTOR_NOT_PERMITTED", `The proposing party cannot ${action.type === "ACCEPT_SETTLEMENT" ? "accept" : "reject"} its own offer`);
      }
      if (
        action.type === "WITHDRAW_SETTLEMENT" &&
        offer.proposedByPartyId !== actingPartyId
      ) {
        return invalid("ACTOR_NOT_PERMITTED", "Only the proposing party may withdraw an offer");
      }
      if (
        action.type !== "EXPIRE_SETTLEMENT" &&
        isSettlementOfferExpired(offer.expiresAtSequence, state.lastSequence + 1)
      ) {
        return invalid("INVALID_SETTLEMENT_STATUS", "Offer has expired");
      }
      if (
        action.type === "EXPIRE_SETTLEMENT" &&
        !isSettlementOfferExpired(offer.expiresAtSequence, state.lastSequence + 1)
      ) {
        return invalid("INVALID_SETTLEMENT_STATUS", "Offer has not reached its expiry sequence");
      }
      if (
        action.type === "ACCEPT_SETTLEMENT" &&
        actingPartyId &&
        !actorCanAuthorizeSettlementTerms(
          state,
          action.actor.actorId,
          actingPartyId,
          offer.terms,
        )
      ) {
        return invalid(
          "INVALID_SETTLEMENT_STATUS",
          "Accepting the offer exceeds the actor's private authority",
        );
      }
      return null;
    }
    case "REST_CASE":
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "A side may rest only during case_in_chief");
      if (action.actor.side !== action.payload.side) return invalid("ACTOR_NOT_PERMITTED", "Counsel may rest only their side");
      if (state.restedSides.includes(action.payload.side)) return invalid("DUPLICATE_ENTITY_ID", `${action.payload.side} side has already rested`);
      if (state.activeAppearanceId !== null) return invalid("INVALID_ACTION", "Release the active witness before resting");
      if (hasPendingStrikeMotion(state)) {
        return invalid(
          "INVALID_ACTION",
          "Resolve every pending strike motion before either side rests",
        );
      }
      return null;
    case "GIVE_CLOSING": {
      if (state.phase !== "closing") return invalid("WRONG_PHASE", "Closing argument requires closing phase");
      if (action.actor.side !== action.payload.side) return invalid("ACTOR_NOT_PERMITTED", "Counsel may close only for their side");
      if (state.closingSides.includes(action.payload.side)) {
        return invalid(
          "DUPLICATE_ENTITY_ID",
          `${action.payload.side} side has already given closing argument`,
        );
      }
      if (state.transcriptTurns[action.payload.turnId]) {
        return invalid(
          "DUPLICATE_ENTITY_ID",
          `Transcript turn ${action.payload.turnId} already exists`,
        );
      }
      return validateJuryConsiderableCitations(state, action.payload.citations);
    }
    case "INSTRUCT_JURY": {
      if (state.phase !== "jury_instructions") {
        return invalid("WRONG_PHASE", "Jury instructions require jury_instructions phase");
      }
      if (state.instructionIds.length > 0) {
        return invalid("DUPLICATE_ENTITY_ID", "Jury instructions were already committed");
      }
      if (hasDuplicateIds(action.payload.instructionIds)) {
        return invalid("DUPLICATE_ENTITY_ID", "Jury instruction IDs must be unique");
      }
      for (const instructionId of action.payload.instructionIds) {
        if (!state.juryInstructionIds.includes(instructionId)) {
          return invalid(
            "INVALID_ACTION",
            `Unknown pinned jury instruction ${instructionId}`,
          );
        }
      }
      return null;
    }
    case "DELIBERATE":
      if (state.phase !== "deliberation") {
        return invalid("WRONG_PHASE", "Deliberation requires deliberation phase");
      }
      return state.deliberated
        ? invalid("DUPLICATE_ENTITY_ID", "The jury has already deliberated")
        : null;
    case "RENDER_VERDICT":
      if (state.phase !== "verdict") {
        return invalid("WRONG_PHASE", "Verdict requires verdict phase");
      }
      if (state.verdictId !== null) {
        return invalid("DUPLICATE_ENTITY_ID", "A verdict was already rendered");
      }
      return validateJuryConsiderableCitations(state, action.payload.citations);
    case "GENERATE_DEBRIEF":
      if (state.phase !== "debrief") {
        return invalid("WRONG_PHASE", "Debrief generation requires debrief phase");
      }
      return state.debriefId !== null
        ? invalid("DUPLICATE_ENTITY_ID", "A debrief was already generated")
        : null;
    case "FAIL_STEP":
      return null;
    case "RECOVER_STEP":
      return state.status === "failed" && state.failure?.stepId === action.payload.stepId
        ? null
        : invalid("TRIAL_NOT_ACTIVE", "Recovery must match the failed step");
    case "UPDATE_OPPOSING_STRATEGY": {
      if (![
        "pretrial",
        "opening",
        "case_in_chief",
        "pre_closing",
        "closing",
      ].includes(state.phase)) {
        return invalid("WRONG_PHASE", `Strategy cannot update during ${state.phase}`);
      }
      const current = state.opposingStrategy;
      if (!current) {
        if (action.payload.revision !== 1) {
          return invalid("INVALID_ACTION", "The first strategy revision must be 1");
        }
      } else {
        if (current.ownerActorId !== action.actor.actorId) {
          return invalid(
            "ACTOR_NOT_PERMITTED",
            "Only the strategy owner may revise private strategy state",
          );
        }
        if (
          action.payload.strategyId !== current.strategyId ||
          action.payload.revision !== current.revision + 1
        ) {
          return invalid("INVALID_ACTION", "Strategy updates must keep the strategy ID and increment one revision");
        }
      }
      for (const witnessId of action.payload.witnessPriorityIds) {
        if (!state.witnesses[witnessId]) return invalid("UNKNOWN_WITNESS", `Unknown witness ${witnessId}`);
      }
      for (const evidenceId of action.payload.evidencePriorityIds) {
        if (!state.evidence[evidenceId]) return invalid("UNKNOWN_EVIDENCE", `Unknown evidence ${evidenceId}`);
      }
      return null;
    }
  }
}

export function validateAction(stateInput: TrialState | null, actionInput: unknown): ActionValidationResult {
  const parsedAction = TrialActionSchema.safeParse(actionInput);
  if (!parsedAction.success) return invalid("INVALID_ACTION", parsedAction.error.issues.map((issue) => issue.message).join("; "));
  const action = parsedAction.data;
  if (action.source === "ai" && action.modelMetadata === null) {
    return invalid("AI_METADATA_REQUIRED", "AI actions require model, prompt, and schema metadata", "modelMetadata");
  }
  const payload = action.payload as unknown as Record<string, unknown>;
  if (
    typeof payload.responseId === "string" &&
    action.responseId !== payload.responseId
  ) {
    return invalid(
      "INVALID_ACTION",
      "Action responseId must match payload.responseId",
      "responseId",
    );
  }
  if (
    typeof payload.interruptId === "string" &&
    action.interruptId !== payload.interruptId
  ) {
    return invalid(
      "INVALID_ACTION",
      "Action interruptId must match payload.interruptId",
      "interruptId",
    );
  }
  if (action.correlationId !== action.trialId) {
    return invalid(
      "INVALID_ACTION",
      "Trial actions must use the trial ID as their correlation ID",
      "correlationId",
    );
  }

  if (stateInput === null) {
    if (action.type !== "START_TRIAL") return invalid("TRIAL_NOT_STARTED", "The first action must be START_TRIAL");
    if (action.expectedStateVersion !== 0) return invalid("STALE_STATE_VERSION", "START_TRIAL expects state version 0");
    if (action.actor.role !== "system") return invalid("ACTOR_NOT_PERMITTED", "START_TRIAL requires the system actor");
    if (action.causationId !== null) {
      return invalid("INVALID_ACTION", "START_TRIAL cannot have a causation event", "causationId");
    }
    const ids = [
      ...action.payload.actors.map((actor) => `actor:${actor.actorId}`),
      ...action.payload.witnessIds.map((id) => `witness:${id}`),
      ...action.payload.initialFacts.map((fact) => `fact:${fact.factId}`),
      ...action.payload.initialEvidence.map((evidence) => `evidence:${evidence.evidenceId}`),
    ];
    if (new Set(ids).size !== ids.length) return invalid("DUPLICATE_ENTITY_ID", "START_TRIAL contains duplicate entity IDs");
    const policyIssue = validateStartTrialPolicy(action);
    if (policyIssue) return policyIssue;
    return { ok: true, action };
  }

  const parsedState = TrialStateSchema.safeParse(stateInput);
  if (!parsedState.success) return invalid("INVALID_STATE", parsedState.error.issues.map((issue) => issue.message).join("; "));
  const state = parsedState.data;
  if (action.trialId !== state.trialId) return invalid("TRIAL_ID_MISMATCH", `Action trial ${action.trialId} does not match ${state.trialId}`);
  if (state.committedActionIds.includes(action.actionId)) return invalid("DUPLICATE_ACTION_ID", `Action ${action.actionId} was already committed`);
  if (action.expectedStateVersion !== state.version) {
    return invalid("STALE_STATE_VERSION", `Expected version ${action.expectedStateVersion}; current version is ${state.version}`);
  }
  if (
    action.causationId === null ||
    action.causationId !== state.eventIds.at(-1)
  ) {
    return invalid(
      "INVALID_ACTION",
      "Action causationId must reference the immediately preceding event",
      "causationId",
    );
  }

  const activityIssue = ensureActive(state, action);
  if (activityIssue) return activityIssue;
  const actorIssue = ensureActorPermission(state, action);
  if (actorIssue) return actorIssue;
  const preconditionIssue = validateActionPreconditions(state, action);
  return preconditionIssue ?? { ok: true, action };
}

export function assertValidAction(state: TrialState | null, actionInput: unknown): TrialAction {
  const result = validateAction(state, actionInput);
  if (!result.ok) throw new TrialEngineError(result.issue);
  return result.action;
}
