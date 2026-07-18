import {
  TrialActionSchema,
  TrialStateSchema,
  type TrialAction,
  type TrialActionType,
  type TrialPhase,
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

function ensureActive(state: TrialState, action: TrialAction): ActionValidationResult | null {
  const permittedWhileInactive = new Set<TrialActionType>([
    "RESUME_TRIAL",
    "RECOVER_STEP",
    "GENERATE_DEBRIEF",
  ]);
  if (state.status !== "active" && !permittedWhileInactive.has(action.type)) {
    return invalid("TRIAL_NOT_ACTIVE", `Action ${action.type} is not allowed while trial status is ${state.status}`);
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
      return null;
    }
    case "CALL_WITNESS":
    case "RECALL_WITNESS": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", `${action.type} requires case_in_chief`);
      const witness = state.witnesses[action.payload.witnessId];
      if (!witness) return invalid("UNKNOWN_WITNESS", `Unknown witness ${action.payload.witnessId}`);
      const allowed = action.type === "CALL_WITNESS" ? witness.status === "available" : witness.status === "released";
      if (!allowed) return invalid("WITNESS_NOT_AVAILABLE", `Witness ${witness.witnessId} cannot be ${action.type.toLowerCase()}`);
      if (state.activeWitnessId !== null) return invalid("WITNESS_NOT_AVAILABLE", "Release the active witness before calling another");
      if (action.actor.side !== action.payload.calledBySide) {
        return invalid("ACTOR_NOT_PERMITTED", "Counsel may call a witness only for their own side");
      }
      return null;
    }
    case "SWEAR_WITNESS": {
      const witness = state.witnesses[action.payload.witnessId];
      if (!witness) return invalid("UNKNOWN_WITNESS", `Unknown witness ${action.payload.witnessId}`);
      if (state.activeWitnessId !== witness.witnessId || witness.status !== "called") {
        return invalid("WITNESS_NOT_ACTIVE", "Only the called active witness may be sworn");
      }
      return null;
    }
    case "ASK_QUESTION":
    case "REPHRASE_QUESTION": {
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", `${action.type} requires case_in_chief`);
      const witnessId = action.type === "ASK_QUESTION" ? action.payload.witnessId : state.activeWitnessId;
      if (!witnessId || state.activeWitnessId !== witnessId) return invalid("WITNESS_NOT_ACTIVE", "Question must target the active witness");
      const witness = state.witnesses[witnessId];
      if (!witness || (witness.status !== "sworn" && witness.status !== "testifying")) {
        return invalid("WITNESS_NOT_ACTIVE", "The active witness must be sworn before questioning");
      }
      if (action.type === "REPHRASE_QUESTION") {
        const sustained = Object.values(state.objections).some(
          (objection) => objection.questionId === action.payload.originalQuestionId && objection.status === "sustained" && objection.remedy === "rephrase",
        );
        if (!sustained) return invalid("INVALID_OBJECTION_STATUS", "Rephrasing requires a sustained rephrase ruling");
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
      const pending = state.pendingResponses[action.payload.responseId];
      if (!pending) return invalid("UNKNOWN_RESPONSE", `Unknown response ${action.payload.responseId}`);
      if (pending.actorId !== action.actor.actorId) {
        return invalid("ACTOR_NOT_PERMITTED", `Response ${pending.responseId} belongs to actor ${pending.actorId}`);
      }
      if ((pending.status !== "pending" && pending.status !== "streaming") || pending.expectedStateVersion !== state.version) {
        return invalid("STALE_RESPONSE", `Response ${pending.responseId} is cancelled, committed, or stale`);
      }
      for (const factId of action.payload.factIds) {
        const fact = state.facts[factId];
        if (!fact) return invalid("UNKNOWN_FACT", `Answer cites unknown fact ${factId}`);
        if (fact.status === "hidden") return invalid("INVALID_FACT_STATUS", `Answer cannot expose hidden fact ${factId} without revelation`);
      }
      for (const evidenceId of action.payload.evidenceIds) {
        if (!state.evidence[evidenceId]) return invalid("UNKNOWN_EVIDENCE", `Answer cites unknown evidence ${evidenceId}`);
      }
      return null;
    }
    case "END_EXAMINATION":
    case "RELEASE_WITNESS": {
      if (state.activeWitnessId !== action.payload.witnessId) return invalid("WITNESS_NOT_ACTIVE", "Action must target the active witness");
      return null;
    }
    case "OBJECT": {
      if (state.activeQuestionId !== action.payload.questionId) return invalid("INVALID_OBJECTION_STATUS", "Objection must target the active question");
      if (state.objections[action.payload.objectionId]) return invalid("DUPLICATE_ENTITY_ID", `Duplicate objection ${action.payload.objectionId}`);
      if (action.payload.interruptedResponseId && !state.pendingResponses[action.payload.interruptedResponseId]) {
        return invalid("UNKNOWN_RESPONSE", `Unknown interrupted response ${action.payload.interruptedResponseId}`);
      }
      return null;
    }
    case "RULE_ON_OBJECTION": {
      const objection = state.objections[action.payload.objectionId];
      if (!objection) return invalid("UNKNOWN_OBJECTION", `Unknown objection ${action.payload.objectionId}`);
      if (objection.status !== "pending") return invalid("INVALID_OBJECTION_STATUS", "Objection has already been resolved");
      return null;
    }
    case "MOVE_TO_STRIKE":
    case "STRIKE_TESTIMONY": {
      for (const testimonyId of action.payload.testimonyIds) {
        const testimony = state.testimony[testimonyId];
        if (!testimony) return invalid("UNKNOWN_TESTIMONY", `Unknown testimony ${testimonyId}`);
        if (action.type === "STRIKE_TESTIMONY" && testimony.status !== "active") {
          return invalid("INVALID_FACT_STATUS", `Testimony ${testimonyId} is already stricken`);
        }
      }
      return null;
    }
    case "OFFER_EVIDENCE": {
      const evidence = state.evidence[action.payload.evidenceId];
      if (!evidence) return invalid("UNKNOWN_EVIDENCE", `Unknown evidence ${action.payload.evidenceId}`);
      if (evidence.status !== "uploaded" && evidence.status !== "indexed") {
        return invalid("INVALID_EVIDENCE_STATUS", `Evidence ${evidence.evidenceId} cannot be offered from ${evidence.status}`);
      }
      if (action.actor.side !== action.payload.offeredBySide) return invalid("ACTOR_NOT_PERMITTED", "Counsel may offer evidence only for their side");
      for (const testimonyId of action.payload.foundationTestimonyIds) {
        if (!state.testimony[testimonyId]) return invalid("UNKNOWN_TESTIMONY", `Unknown foundation testimony ${testimonyId}`);
      }
      return null;
    }
    case "RULE_ON_EVIDENCE": {
      const evidence = state.evidence[action.payload.evidenceId];
      if (!evidence) return invalid("UNKNOWN_EVIDENCE", `Unknown evidence ${action.payload.evidenceId}`);
      if (evidence.status !== "offered") return invalid("INVALID_EVIDENCE_STATUS", "Only offered evidence may be ruled on");
      return null;
    }
    case "WITHDRAW_EVIDENCE": {
      const evidence = state.evidence[action.payload.evidenceId];
      if (!evidence) return invalid("UNKNOWN_EVIDENCE", `Unknown evidence ${action.payload.evidenceId}`);
      if (evidence.status !== "offered") return invalid("INVALID_EVIDENCE_STATUS", "Only a pending offered exhibit may be withdrawn");
      if (evidence.offeredBySide !== action.actor.side) return invalid("ACTOR_NOT_PERMITTED", "Only offering counsel may withdraw evidence");
      return null;
    }
    case "REVEAL_HIDDEN_FACT": {
      const fact = state.facts[action.payload.factId];
      if (!fact) return invalid("UNKNOWN_FACT", `Unknown fact ${action.payload.factId}`);
      if (fact.status !== "hidden") return invalid("INVALID_FACT_STATUS", "Only a hidden fact may be revealed");
      return null;
    }
    case "PROPOSE_ASSERTION":
      return state.facts[action.payload.factId]
        ? invalid("DUPLICATE_ENTITY_ID", `Fact ${action.payload.factId} already exists`)
        : null;
    case "VERIFY_ASSERTION":
    case "DISPUTE_ASSERTION": {
      const fact = state.facts[action.payload.factId];
      if (!fact) return invalid("UNKNOWN_FACT", `Unknown fact ${action.payload.factId}`);
      if (fact.status !== "proposed" && fact.status !== "disputed") {
        return invalid("INVALID_FACT_STATUS", `${action.type} cannot operate on ${fact.status} fact`);
      }
      return null;
    }
    case "RULE_ON_ASSERTION": {
      const fact = state.facts[action.payload.factId];
      if (!fact) return invalid("UNKNOWN_FACT", `Unknown fact ${action.payload.factId}`);
      if (fact.status !== "verified" && fact.status !== "disputed") {
        return invalid("INVALID_FACT_STATUS", `Only a verified or disputed assertion may receive a courtroom ruling`);
      }
      return null;
    }
    case "REQUEST_RESPONSE": {
      if (state.pendingResponses[action.payload.responseId]) {
        return invalid("DUPLICATE_ENTITY_ID", `Response ${action.payload.responseId} already exists`);
      }
      const responseActor = state.actors[action.payload.actorId];
      if (!responseActor) return invalid("UNKNOWN_ACTOR", `Unknown response actor ${action.payload.actorId}`);
      if (
        state.activeQuestionId !== null &&
        (responseActor.role !== "witness" || responseActor.witnessId !== state.activeWitnessId)
      ) {
        return invalid("ACTOR_NOT_PERMITTED", "A question response must be assigned to the active witness");
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
      return null;
    }
    case "RESOLVE_INTERRUPTION": {
      if (!state.activeInterruption || state.activeInterruption.interruptId !== action.payload.interruptId) {
        return invalid("UNKNOWN_INTERRUPTION", `Unknown active interruption ${action.payload.interruptId}`);
      }
      if (state.activeInterruption.status !== "active") return invalid("INVALID_INTERRUPTION_STATUS", "Interruption is not active");
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
    case "REQUEST_RECESS":
      return state.phase === "recess" ? invalid("WRONG_PHASE", "Trial is already in recess") : null;
    case "RESUME_TRIAL":
      return state.status === "paused" || state.phase === "recess"
        ? null
        : invalid("TRIAL_NOT_ACTIVE", "Only a paused trial or recess may resume");
    case "PROPOSE_SETTLEMENT":
    case "COUNTER_SETTLEMENT": {
      if (!["pretrial", "opening", "case_in_chief", "recess", "pre_closing"].includes(state.phase)) {
        return invalid("WRONG_PHASE", "Settlement is closed in the current phase");
      }
      if (action.payload.expiresAtSequence <= state.lastSequence) return invalid("INVALID_SETTLEMENT_STATUS", "Settlement offer must expire in the future");
      if (state.settlementOffers[action.payload.offerId]) return invalid("DUPLICATE_ENTITY_ID", `Offer ${action.payload.offerId} already exists`);
      if (action.type === "COUNTER_SETTLEMENT") {
        const parent = action.payload.parentOfferId ? state.settlementOffers[action.payload.parentOfferId] : undefined;
        if (!parent) return invalid("UNKNOWN_SETTLEMENT_OFFER", "Counteroffer requires an existing parent offer");
        if (parent.status !== "open") return invalid("INVALID_SETTLEMENT_STATUS", "Only an open offer may be countered");
        if (parent.proposedBySide === action.actor.side) {
          return invalid("ACTOR_NOT_PERMITTED", "A counteroffer must come from the counterparty");
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
      if (
        (action.type === "ACCEPT_SETTLEMENT" || action.type === "REJECT_SETTLEMENT") &&
        offer.proposedBySide === action.actor.side
      ) {
        return invalid("ACTOR_NOT_PERMITTED", `The proposing side cannot ${action.type === "ACCEPT_SETTLEMENT" ? "accept" : "reject"} its own offer`);
      }
      if (action.type === "WITHDRAW_SETTLEMENT" && offer.proposedBySide !== action.actor.side) {
        return invalid("ACTOR_NOT_PERMITTED", "Only the proposing side may withdraw an offer");
      }
      if (action.type === "EXPIRE_SETTLEMENT" && state.lastSequence < offer.expiresAtSequence) {
        return invalid("INVALID_SETTLEMENT_STATUS", "Offer has not reached its expiry sequence");
      }
      return null;
    }
    case "REST_CASE":
      if (state.phase !== "case_in_chief") return invalid("WRONG_PHASE", "A side may rest only during case_in_chief");
      if (action.actor.side !== action.payload.side) return invalid("ACTOR_NOT_PERMITTED", "Counsel may rest only their side");
      if (state.restedSides.includes(action.payload.side)) return invalid("DUPLICATE_ENTITY_ID", `${action.payload.side} side has already rested`);
      return null;
    case "GIVE_CLOSING":
      if (state.phase !== "closing") return invalid("WRONG_PHASE", "Closing argument requires closing phase");
      if (action.actor.side !== action.payload.side) return invalid("ACTOR_NOT_PERMITTED", "Counsel may close only for their side");
      return null;
    case "INSTRUCT_JURY":
      return state.phase === "jury_instructions" ? null : invalid("WRONG_PHASE", "Jury instructions require jury_instructions phase");
    case "DELIBERATE":
      return state.phase === "deliberation" ? null : invalid("WRONG_PHASE", "Deliberation requires deliberation phase");
    case "RENDER_VERDICT":
      return state.phase === "verdict" ? null : invalid("WRONG_PHASE", "Verdict requires verdict phase");
    case "GENERATE_DEBRIEF":
      return state.phase === "debrief" ? null : invalid("WRONG_PHASE", "Debrief generation requires debrief phase");
    case "FAIL_STEP":
      return null;
    case "RECOVER_STEP":
      return state.status === "failed" && state.failure?.stepId === action.payload.stepId
        ? null
        : invalid("TRIAL_NOT_ACTIVE", "Recovery must match the failed step");
  }
}

export function validateAction(stateInput: TrialState | null, actionInput: unknown): ActionValidationResult {
  const parsedAction = TrialActionSchema.safeParse(actionInput);
  if (!parsedAction.success) return invalid("INVALID_ACTION", parsedAction.error.issues.map((issue) => issue.message).join("; "));
  const action = parsedAction.data;
  if (action.source === "ai" && action.modelMetadata === null) {
    return invalid("AI_METADATA_REQUIRED", "AI actions require model, prompt, and schema metadata", "modelMetadata");
  }

  if (stateInput === null) {
    if (action.type !== "START_TRIAL") return invalid("TRIAL_NOT_STARTED", "The first action must be START_TRIAL");
    if (action.expectedStateVersion !== 0) return invalid("STALE_STATE_VERSION", "START_TRIAL expects state version 0");
    if (action.actor.role !== "system") return invalid("ACTOR_NOT_PERMITTED", "START_TRIAL requires the system actor");
    const ids = [
      ...action.payload.actors.map((actor) => `actor:${actor.actorId}`),
      ...action.payload.witnessIds.map((id) => `witness:${id}`),
      ...action.payload.initialFacts.map((fact) => `fact:${fact.factId}`),
      ...action.payload.initialEvidence.map((evidence) => `evidence:${evidence.evidenceId}`),
    ];
    if (new Set(ids).size !== ids.length) return invalid("DUPLICATE_ENTITY_ID", "START_TRIAL contains duplicate entity IDs");
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
