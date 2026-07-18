import {
  collectCaseGraphProvenanceIds,
  computeCaseGraphContentHash,
  type CaseGraph,
} from "../case-graph";
import {
  createTrialPolicySnapshot,
  type TrialPolicyActorBindingInput,
} from "../trial-policy";
import {
  EMPTY_CITATIONS,
  TRIAL_ACTION_SCHEMA_VERSION,
  TRIAL_EVENT_SCHEMA_VERSION,
  TrialEventSchema,
  type ActorRef,
  type CitationSet,
  type EventSource,
  type ModelMetadata,
  type TrialAction,
  type TrialEvent,
  type TrialState,
} from "./schemas";
import { applyTrialEvent, initializeTrialFromEvent } from "./reducer";
import { assertValidAction, TrialEngineError, type TrialEngineIssue, validateAction } from "./validator";

export type CommitResult = {
  action: TrialAction;
  event: TrialEvent;
  state: TrialState;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function citationsFor(action: TrialAction): CitationSet {
  const payload = action.payload as unknown as Record<string, unknown>;
  const nested = payload.citations;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    const parsed = nested as CitationSet;
    return {
      factIds: unique(parsed.factIds ?? []),
      evidenceIds: unique(parsed.evidenceIds ?? []),
      testimonyIds: unique(parsed.testimonyIds ?? []),
      eventIds: unique(parsed.eventIds ?? []),
      sourceSegmentIds: unique(parsed.sourceSegmentIds ?? []),
    };
  }
  const strings = (key: string): string[] => {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    return typeof value === "string" ? [value] : [];
  };
  const basis =
    typeof payload.basis === "object" &&
    payload.basis !== null &&
    !Array.isArray(payload.basis)
      ? payload.basis as Record<string, unknown>
      : null;
  const basisId = (kind: string, key: string): string[] =>
    basis?.kind === kind && typeof basis[key] === "string"
      ? [basis[key]]
      : [];
  return {
    factIds: unique([...strings("factId"), ...strings("factIds")]),
    evidenceIds: unique([
      ...strings("evidenceId"),
      ...strings("evidenceIds"),
      ...strings("presentedEvidenceIds"),
      ...strings("evidencePriorityIds"),
      ...basisId("evidence", "evidenceId"),
    ]),
    testimonyIds: unique([
      ...strings("testimonyIds"),
      ...strings("foundationTestimonyIds"),
      ...basisId("testimony", "testimonyId"),
    ]),
    eventIds: [],
    sourceSegmentIds: [],
  };
}

export function eventIdForAction(actionId: string): string {
  return `event:${actionId}`;
}

export function eventFromAction(state: TrialState | null, action: TrialAction): TrialEvent {
  return TrialEventSchema.parse({
    schemaVersion: TRIAL_EVENT_SCHEMA_VERSION,
    eventId: eventIdForAction(action.actionId),
    trialId: action.trialId,
    sequence: (state?.lastSequence ?? 0) + 1,
    stateVersion: (state?.version ?? 0) + 1,
    actionId: action.actionId,
    actor: action.actor,
    source: action.source,
    occurredAt: action.requestedAt,
    causationId: action.causationId,
    correlationId: action.correlationId,
    responseId: action.responseId,
    interruptId: action.interruptId,
    modelMetadata: action.modelMetadata,
    citations: citationsFor(action),
    type: action.type,
    payload: action.payload,
  });
}

export function commitAction(state: TrialState | null, actionInput: unknown): CommitResult {
  const action = assertValidAction(state, actionInput);
  const event = eventFromAction(state, action);
  const nextState = state === null ? initializeTrialFromEvent(event) : applyTrialEvent(state, event);
  return { action, event, state: nextState };
}

function actionFromEvent(event: TrialEvent): TrialAction {
  return {
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
    actionId: event.actionId,
    trialId: event.trialId,
    expectedStateVersion: event.stateVersion - 1,
    actor: event.actor,
    source: event.source,
    requestedAt: event.occurredAt,
    causationId: event.causationId,
    correlationId: event.correlationId,
    responseId: event.responseId,
    interruptId: event.interruptId,
    modelMetadata: event.modelMetadata,
    type: event.type,
    payload: event.payload,
  } as TrialAction;
}

export function reduceTrial(eventInputs: readonly unknown[]): TrialState {
  if (eventInputs.length === 0) throw new Error("TRIAL_NOT_STARTED: Event stream is empty");
  let state: TrialState | null = null;
  for (const eventInput of eventInputs) {
    const event = TrialEventSchema.parse(eventInput);
    const reconstructedAction = actionFromEvent(event);
    const validation = validateAction(state, reconstructedAction);
    if (!validation.ok) throw new TrialEngineError(validation.issue);
    const expectedEvent = eventFromAction(state, validation.action);
    if (JSON.stringify(event) !== JSON.stringify(expectedEvent)) {
      throw new Error(`EVENT_ENVELOPE_MISMATCH:${event.eventId}`);
    }
    state = state === null ? initializeTrialFromEvent(event) : applyTrialEvent(state, event);
  }
  if (state === null) throw new Error("TRIAL_NOT_STARTED");
  return state;
}

export type StartTrialActionInput = {
  trialId: string;
  actionId: string;
  requestedAt: string;
  graph: CaseGraph;
  actors: ActorRef[];
  actorBindings: readonly TrialPolicyActorBindingInput[];
  userSide?: "user" | "opposing";
  source?: EventSource;
  modelMetadata?: ModelMetadata | null;
};

export function createStartTrialAction(input: StartTrialActionInput): TrialAction {
  const systemActor = input.actors.find((actor) => actor.role === "system");
  if (!systemActor) throw new Error("START_TRIAL requires a system actor in the roster");
  const policySnapshot = createTrialPolicySnapshot({
    graph: input.graph,
    actorBindings: input.actorBindings,
  });
  return assertValidAction(null, {
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
    actionId: input.actionId,
    trialId: input.trialId,
    expectedStateVersion: 0,
    actor: systemActor,
    source: input.source ?? "system",
    requestedAt: input.requestedAt,
    causationId: null,
    correlationId: input.trialId,
    responseId: null,
    interruptId: null,
    modelMetadata: input.modelMetadata ?? null,
    type: "START_TRIAL",
    payload: {
      caseId: input.graph.caseId,
      caseVersion: input.graph.version,
      caseGraphHash: input.graph.compilerMetadata.sourceContentHash,
      caseGraphContentHash: computeCaseGraphContentHash(input.graph),
      juryInstructionIds: input.graph.juryInstructions.map(
        (instruction) => instruction.instructionId,
      ),
      caseProvenanceIds: collectCaseGraphProvenanceIds(input.graph),
      sourceSegmentIds: input.graph.sourceSegments.map(
        (segment) => segment.sourceSegmentId,
      ),
      actors: input.actors,
      witnessIds: input.graph.witnesses.map((witness) => witness.witnessId),
      initialFacts: input.graph.facts.map((fact) => ({
        factId: fact.factId,
        proposition: fact.proposition,
        status: fact.initialStatus,
        visibility: fact.visibility,
        provenanceIds: fact.provenance.map((entry) => entry.provenanceId),
      })),
      initialEvidence: input.graph.evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        name: evidence.name,
        status: evidence.initialStatus,
      })),
      policySnapshot,
      userSide: input.userSide ?? "user",
    },
  });
}

export function tryCommitAction(
  state: TrialState | null,
  actionInput: unknown,
): { ok: true; result: CommitResult } | { ok: false; issue: TrialEngineIssue } {
  const validation = validateAction(state, actionInput);
  if (!validation.ok) return validation;
  return { ok: true, result: commitAction(state, validation.action) };
}

export const NO_CITATIONS = EMPTY_CITATIONS;
