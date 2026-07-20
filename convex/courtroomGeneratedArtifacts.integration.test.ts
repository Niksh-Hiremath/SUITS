import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
  sha256Utf8,
} from "../src/domain/case-graph";
import {
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DebriefGeneratorModelOutputSchema,
  JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JuryRoleResponseModelOutputSchema,
  type DebriefGeneratorModelOutput,
  type JuryRoleResponseModelOutput,
} from "../src/domain/courtroom-ai/call-contracts";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallTrace,
} from "../src/domain/courtroom-ai/model-call-trace";
import {
  actorFromBindings,
  deriveTrialActorBindings,
} from "../src/domain/hearing-runtime/actors";
import {
  hashDebriefGeneratorModelOutput,
  hashJuryResponseModelOutput,
} from "../src/domain/hearing-runtime/model-boundary";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  TrialEventV3Schema,
  TrialStateV3Schema,
  commitAction,
  createStartTrialAction,
  type ActorRef,
  type ModelMetadata,
  type TrialActionByType,
  type TrialActionType,
  type TrialEventV3,
  type TrialStateV3,
} from "../src/domain/trial-engine";
import type { Doc } from "./_generated/dataModel";
import type { InternalCourtroomGeneratedArtifactList } from "./courtroomGeneratedArtifacts";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./courtroomGeneratedArtifacts.ts": () =>
    import("./courtroomGeneratedArtifacts"),
};

type TestBackend = TestConvex<typeof schema>;
type StoredEvent = Omit<Doc<"trialEvents">, "_id" | "_creationTime">;
type StoredCall = Omit<
  Doc<"courtroomModelCalls">,
  "_id" | "_creationTime"
>;
type StoredAttempt = Omit<
  Doc<"courtroomModelCallAttempts">,
  "_id" | "_creationTime"
>;
type StoredArtifact = Omit<
  Doc<"courtroomGeneratedArtifacts">,
  "_id" | "_creationTime"
>;

type SeededTrial = Readonly<{
  trialId: string;
  activeState: TrialStateV3;
  deliberatedState: TrialStateV3;
  completedState: TrialStateV3;
  juryOutput: JuryRoleResponseModelOutput;
  debriefOutput: DebriefGeneratorModelOutput;
  juryArtifact: StoredArtifact;
  debriefArtifact: StoredArtifact;
  juryEventId: string;
  debriefEventId: string;
  juryCallId: string;
  debriefCallId: string;
}>;

type SeedLifecycle = "active" | "deliberated" | "completed";

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";
const BASE_TIME = Date.parse("2026-07-20T06:00:00.000Z");
const EMPTY_EVENT_CITATIONS = {
  factIds: [],
  evidenceIds: [],
  testimonyIds: [],
  eventIds: [],
  sourceSegmentIds: [],
};
const EMPTY_MODEL_CITATIONS = {
  factIds: [],
  evidenceIds: [],
  testimonyIds: [],
  eventIds: [],
  sourceSegmentIds: [],
  priorStatementIds: [],
};

const listReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  InternalCourtroomGeneratedArtifactList
>("courtroomGeneratedArtifacts:listForOwnerTrial");

// Mirrors the current writers in trialEvents.ts and courtroomModelCalls.ts:
// both serialize schema-parsed values with JSON.stringify before insertion.
function canonicalStorageJson(value: unknown): string {
  return JSON.stringify(value);
}

function emptyDebriefOutput(): DebriefGeneratorModelOutput {
  const citations = {
    admittedFactIds: [],
    admittedEvidenceIds: [],
    activeTestimonyIds: [],
    transcriptTurnIds: [],
    unadmittedFactIds: [],
    unadmittedEvidenceIds: [],
    excludedFactIds: [],
    excludedEvidenceIds: [],
    strickenTestimonyIds: [],
    hiddenFactIds: [],
    hiddenSourceSegmentIds: [],
    coachingInferenceIds: [],
  };
  return DebriefGeneratorModelOutputSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    overallAssessment: {
      text: "The fictional hearing maintained a clear record.",
      basis: "admitted_record",
      citations,
    },
    strengths: [
      {
        title: "Clear record",
        assessment: "The courtroom sequence stayed focused.",
        recommendation: "Keep tying each question to the admitted record.",
        basis: "admitted_record",
        citations,
      },
    ],
    weakQuestions: [],
    missedEvidence: [],
    contradictions: [],
    objectionAccuracy: [],
    witnessStrategy: [],
    settlementChoices: [],
    juryMovement: [],
    improvedClosing: { segments: [] },
    limitations: [
      "This fictional educational coaching is not legal advice.",
    ],
  });
}

function emptyJuryOutput(): JuryRoleResponseModelOutput {
  const citations = {
    factIds: [],
    evidenceIds: [],
    testimonyIds: [],
    transcriptTurnIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
    issueIds: [],
    instructionIds: [],
    ruleIds: [],
    settlementOfferIds: [],
  };
  return JuryRoleResponseModelOutputSchema.parse({
    schemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    deliberationSegments: [
      {
        text: "The jury applies the instructions only to the admitted record.",
        citations,
      },
    ],
    findings: [
      {
        conclusion: "The fictional burden is satisfied on this record.",
        weight: "moderate",
        citations,
      },
    ],
    recommendation: {
      outcome: "user_prevails",
      decision: "The jury finds for the user in this fictional hearing.",
      confidence: 0.7,
    },
    performance: {
      activity: "speaking",
      emotion: "neutral",
      intensity: 0.4,
      gazeTarget: "judge",
      gesture: "none",
      speakingStyle: "deliberative",
    },
  });
}

function createHarness(suffix: string) {
  const graph = CaseGraphV1Schema.parse(
    createThreeWitnessCaseGraphV1Fixture(),
  );
  const bindings = deriveTrialActorBindings(graph);
  const trialId = `trial:generated-artifacts:${suffix}`;
  const started = commitAction(
    null,
    createStartTrialAction({
      trialId,
      actionId: `action:generated-artifacts:${suffix}:start`,
      requestedAt: new Date(BASE_TIME).toISOString(),
      graph,
      actors: bindings.map(({ actor }) => actor),
      actorBindings: bindings,
      userSide: "user",
    }),
  );
  let state = TrialStateV3Schema.parse(started.state);
  const events: TrialEventV3[] = [TrialEventV3Schema.parse(started.event)];
  let identity = 0;

  function actor(
    predicate: (candidate: ActorRef) => boolean,
    code: string,
  ): ActorRef {
    return actorFromBindings(bindings, predicate, code);
  }

  function commit<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actionActor: ActorRef,
    options: Readonly<{
      actionId?: string;
      requestedAt?: string;
      source?: "user" | "ai" | "deterministic" | "speech" | "system";
      modelMetadata?: ModelMetadata | null;
    }> = {},
  ): TrialEventV3 {
    identity += 1;
    const action = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
      actionId:
        options.actionId ??
        `action:generated-artifacts:${suffix}:${identity}:${type.toLowerCase()}`,
      trialId,
      expectedStateVersion: state.version,
      actor: actionActor,
      source: options.source ?? "deterministic",
      requestedAt:
        options.requestedAt ??
        new Date(BASE_TIME + identity * 100).toISOString(),
      causationId: state.eventIds.at(-1) ?? null,
      correlationId: trialId,
      responseId: null,
      interruptId: null,
      modelMetadata: options.modelMetadata ?? null,
      type,
      payload,
    });
    const committed = commitAction(state, action);
    state = TrialStateV3Schema.parse(committed.state);
    const event = TrialEventV3Schema.parse(committed.event);
    events.push(event);
    return event;
  }

  return {
    graph,
    bindings,
    trialId,
    events,
    actor,
    commit,
    get state(): TrialStateV3 {
      return state;
    },
  };
}

function acceptedTrace(input: Readonly<{
  callId: string;
  trialId: string;
  actorId: string;
  actorRole: "jury" | "debrief";
  callClass: "role_responder" | "debrief_generator";
  task: "jury_deliberation" | "generate_debrief";
  model: "gpt-5.6-luna" | "gpt-5.6-terra";
  promptVersion:
    | "role-responder.jury.prompt.v1"
    | "debrief-generator.prompt.v1";
  outputSchemaVersion: string;
  outputHash: string;
  outputCharacterCount: number;
  sourceStateVersion: number;
  sourceLastEventId: string;
  actionId: string;
  eventId: string;
  startedAt: string;
  providerIdsAvailable?: boolean;
}>): CourtroomModelCallTrace {
  const completedAt = new Date(
    Date.parse(input.startedAt) + 100,
  ).toISOString();
  const providerRequestId =
    input.providerIdsAvailable === false ? null : `request:${input.task}`;
  const providerResponseId =
    input.providerIdsAvailable === false ? null : `response:${input.task}`;
  return CourtroomModelCallTraceSchema.parse({
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: input.callId,
    trialId: input.trialId,
    responseId: null,
    actorId: input.actorId,
    actorRole: input.actorRole,
    callClass: input.callClass,
    task: input.task,
    inputEventIds: [input.sourceLastEventId],
    expectedStateVersion: input.sourceStateVersion,
    expectedLastEventId: input.sourceLastEventId,
    provider: "scripted-courtroom-model",
    model: input.model,
    providerProtocolVersion: "courtroom-model-provider.v1",
    promptVersion: input.promptVersion,
    outputSchemaVersion: input.outputSchemaVersion,
    knowledgeScope: {
      knowledgeSchemaVersion: "knowledge-view.v2",
      knowledgeViewHash: sha256Utf8(
        `${input.trialId}:${input.sourceStateVersion}:${input.task}`,
      ),
      stateVersion: input.sourceStateVersion,
      factCount: 0,
      evidenceCount: 0,
      testimonyCount: 0,
      priorStatementCount: 0,
      sourceSegmentCount: 0,
      publicRecordEventCount: input.sourceStateVersion,
      currentExchangeCount: 0,
    },
    promptAudit: {
      stablePrefixHash: sha256Utf8(`${input.task}:stable`),
      trustedContextHash: sha256Utf8(`${input.task}:trusted`),
      untrustedInputHash: sha256Utf8(`${input.task}:untrusted`),
      inputCharacterCount: 128,
    },
    status: "accepted",
    startedAt: input.startedAt,
    completedAt,
    latencyMs: 100,
    firstStructuredDeltaMs: 20,
    firstAcceptedSegmentMs: null,
    retryCount: 0,
    validationFailureCount: 0,
    estimatedCostUsd: null,
    usage: null,
    acceptedAttempt: 1,
    acceptedCitations: EMPTY_MODEL_CITATIONS,
    acceptedCitationCount: 0,
    outputHash: input.outputHash,
    outputCharacterCount: input.outputCharacterCount,
    committedActionId: input.actionId,
    committedEventId: input.eventId,
    safeFailureCode: null,
    attempts: [
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 1,
        mode: "initial",
        status: "accepted",
        providerRequestId,
        providerResponseId,
        startedAt: input.startedAt,
        completedAt,
        latencyMs: 100,
        firstStructuredDeltaMs: 20,
        streamEventCount: 3,
        structuredDeltaCount: 1,
        streamedCharacterCount: input.outputCharacterCount,
        outputHash: input.outputHash,
        proposedCitationCount: 0,
        usage: null,
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  });
}

function modelMetadata(trace: CourtroomModelCallTrace): ModelMetadata {
  const attempt = trace.attempts[0];
  if (!attempt) throw new Error("Fixture accepted attempt is missing");
  return {
    model: trace.model,
    requestId: attempt.providerRequestId,
    promptVersion: trace.promptVersion,
    schemaVersion: trace.outputSchemaVersion,
    latencyMs: trace.latencyMs,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: trace.estimatedCostUsd,
    retryCount: trace.retryCount,
    validationFailureCount: trace.validationFailureCount,
  };
}

function eventRecord(event: TrialEventV3): StoredEvent {
  const model = event.modelMetadata;
  return {
    eventId: event.eventId,
    trialId: event.trialId,
    sequence: event.sequence,
    stateVersion: event.stateVersion,
    actionId: event.actionId,
    eventType: event.type,
    actorId: event.actor.actorId,
    actorRole: event.actor.role,
    actorSide: event.actor.side,
    witnessId: event.actor.witnessId ?? undefined,
    source: event.source,
    causationId: event.causationId ?? undefined,
    correlationId: event.correlationId ?? undefined,
    responseId: event.responseId ?? undefined,
    interruptId: event.interruptId ?? undefined,
    payloadJson: canonicalStorageJson(event.payload),
    payloadSchemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    eventSchemaVersion: event.schemaVersion,
    promptVersion: model?.promptVersion,
    model: model?.model,
    modelRequestId: model?.requestId ?? undefined,
    modelSchemaVersion: model?.schemaVersion,
    modelLatencyMs: model?.latencyMs ?? undefined,
    inputTokens: model?.inputTokens ?? undefined,
    outputTokens: model?.outputTokens ?? undefined,
    estimatedCostUsd: model?.estimatedCostUsd ?? undefined,
    retryCount: model?.retryCount,
    validationFailureCount: model?.validationFailureCount,
    factIds: event.citations.factIds,
    evidenceIds: event.citations.evidenceIds,
    testimonyIds: event.citations.testimonyIds,
    citationEventIds: event.citations.eventIds,
    sourceSegmentIds: event.citations.sourceSegmentIds,
    turnIds: [],
    occurredAt: Date.parse(event.occurredAt),
    occurredAtIso: event.occurredAt,
    committedAt: Date.parse(event.occurredAt),
  };
}

function callRecord(ownerId: string, trace: CourtroomModelCallTrace): StoredCall {
  if (
    trace.trialId === null ||
    trace.status !== "accepted" ||
    trace.completedAt === null ||
    trace.latencyMs === null
  ) {
    throw new Error("Fixture trace is not terminal and trial-bound");
  }
  return {
    callId: trace.callId,
    ownerId,
    trialId: trace.trialId,
    responseId: trace.responseId,
    actorId: trace.actorId,
    actorRole: trace.actorRole,
    callClass: trace.callClass,
    task: trace.task,
    status: trace.status,
    provider: trace.provider,
    model: trace.model,
    promptVersion: trace.promptVersion,
    outputSchemaVersion: trace.outputSchemaVersion,
    startedAt: Date.parse(trace.startedAt),
    completedAt: Date.parse(trace.completedAt),
    latencyMs: trace.latencyMs,
    attemptCount: trace.attempts.length,
    retryCount: trace.retryCount,
    validationFailureCount: trace.validationFailureCount,
    acceptedCitationCount: trace.acceptedCitationCount,
    outputCharacterCount: trace.outputCharacterCount,
    traceJson: canonicalStorageJson(trace),
    schemaVersion: trace.schemaVersion,
  };
}

function attemptRecord(
  ownerId: string,
  trialId: string,
  trace: CourtroomModelCallTrace,
): StoredAttempt {
  const attempt = trace.attempts[0];
  if (!attempt) throw new Error("Fixture trace is missing an attempt");
  return {
    callId: trace.callId,
    ownerId,
    trialId,
    attempt: attempt.attempt,
    mode: attempt.mode,
    status: attempt.status,
    providerRequestId: attempt.providerRequestId,
    providerResponseId: attempt.providerResponseId,
    startedAt: Date.parse(attempt.startedAt),
    completedAt: Date.parse(attempt.completedAt),
    latencyMs: attempt.latencyMs,
    firstStructuredDeltaMs: attempt.firstStructuredDeltaMs,
    streamEventCount: attempt.streamEventCount,
    structuredDeltaCount: attempt.structuredDeltaCount,
    streamedCharacterCount: attempt.streamedCharacterCount,
    outputHash: attempt.outputHash,
    proposedCitationCount: attempt.proposedCitationCount,
    inputTokens: attempt.usage?.inputTokens ?? null,
    outputTokens: attempt.usage?.outputTokens ?? null,
    totalTokens: attempt.usage?.totalTokens ?? null,
    cachedInputTokens: attempt.usage?.cachedInputTokens ?? null,
    cacheWriteTokens: attempt.usage?.cacheWriteTokens ?? null,
    reasoningTokens: attempt.usage?.reasoningTokens ?? null,
    safeErrorCode: attempt.safeErrorCode,
    schemaVersion: attempt.schemaVersion,
  };
}

async function seedValidTrial(
  backend: TestBackend,
  suffix: string,
  lifecycle: SeedLifecycle = "completed",
  providerIdsAvailable = true,
): Promise<SeededTrial> {
  const harness = createHarness(suffix);
  const { trialId } = harness;
  const judge = harness.actor(
    ({ role }) => role === "judge",
    "JUDGE_ACTOR_MISSING",
  );
  const userCounsel = harness.actor(
    ({ role }) => role === "user_counsel",
    "USER_COUNSEL_ACTOR_MISSING",
  );
  const opposingCounsel = harness.actor(
    ({ role }) => role === "opposing_counsel",
    "OPPOSING_COUNSEL_ACTOR_MISSING",
  );
  const juryActor = harness.actor(
    ({ role }) => role === "jury",
    "JURY_ACTOR_MISSING",
  );
  const debriefActor = harness.actor(
    ({ role }) => role === "debrief_coach",
    "DEBRIEF_ACTOR_MISSING",
  );
  const activeState = TrialStateV3Schema.parse(harness.state);

  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, judge);
  harness.commit("REST_CASE", { side: "user" }, userCounsel, {
    source: "user",
  });
  harness.commit("REST_CASE", { side: "opposing" }, opposingCounsel, {
    source: "user",
  });
  harness.commit("BEGIN_PHASE", { phase: "pre_closing" }, judge);
  harness.commit("BEGIN_PHASE", { phase: "closing" }, judge);
  harness.commit(
    "GIVE_CLOSING",
    {
      side: "user",
      turnId: `turn:closing:user:${suffix}`,
      text: "The fictional record supports the requested result.",
      citations: EMPTY_EVENT_CITATIONS,
    },
    userCounsel,
    { source: "user" },
  );
  harness.commit(
    "GIVE_CLOSING",
    {
      side: "opposing",
      turnId: `turn:closing:opposing:${suffix}`,
      text: "The fictional record does not satisfy the burden.",
      citations: EMPTY_EVENT_CITATIONS,
    },
    opposingCounsel,
    { source: "user" },
  );
  harness.commit("BEGIN_PHASE", { phase: "jury_instructions" }, judge);
  const instructionId = harness.graph.juryInstructions[0]?.instructionId;
  if (!instructionId) throw new Error("Fixture jury instruction missing");
  harness.commit("INSTRUCT_JURY", { instructionIds: [instructionId] }, judge);
  harness.commit("BEGIN_PHASE", { phase: "deliberation" }, judge);

  const juryOutput = emptyJuryOutput();
  const juryJson = canonicalStorageJson(juryOutput);
  const juryHash = hashJuryResponseModelOutput(juryOutput);
  const decisionId = `decision:generated-artifacts:${suffix}`;
  const juryMaterial = JSON.stringify({ trialId, decisionId });
  const juryMaterialHash = sha256Utf8(juryMaterial);
  const juryArtifactId = `artifact:jury:${juryMaterialHash}`;
  const juryActionId = `action:jury-deliberation:${juryMaterialHash}`;
  const juryEventId = `event:${juryActionId}`;
  const verdictPhaseActionId = `action:phase-verdict:${juryMaterialHash}`;
  const verdictActionId = `action:render-verdict:${juryMaterialHash}`;
  const debriefPhaseActionId = `action:phase-debrief:${juryMaterialHash}`;
  const verdictId = `verdict:jury:${juryMaterialHash}`;
  const juryCallId = `call:jury-deliberation:${suffix}`;
  const juryStartedAt = new Date(BASE_TIME + 1_000).toISOString();
  const jurySourceStateVersion = harness.state.version;
  const jurySourceLastEventId = harness.state.eventIds.at(-1);
  if (!jurySourceLastEventId) throw new Error("Fixture jury source missing");
  const juryTrace = acceptedTrace({
    callId: juryCallId,
    trialId,
    actorId: juryActor.actorId,
    actorRole: "jury",
    callClass: "role_responder",
    task: "jury_deliberation",
    model: "gpt-5.6-luna",
    promptVersion: "role-responder.jury.prompt.v1",
    outputSchemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    outputHash: juryHash,
    outputCharacterCount: juryJson.length,
    sourceStateVersion: jurySourceStateVersion,
    sourceLastEventId: jurySourceLastEventId,
    actionId: juryActionId,
    eventId: juryEventId,
    startedAt: juryStartedAt,
    providerIdsAvailable,
  });
  const juryCompletedAt = juryTrace.completedAt;
  if (!juryCompletedAt) throw new Error("Fixture jury completion missing");
  const juryEvent = harness.commit("DELIBERATE", {}, juryActor, {
    actionId: juryActionId,
    requestedAt: juryCompletedAt,
    source: "ai",
    modelMetadata: modelMetadata(juryTrace),
  });
  harness.commit("BEGIN_PHASE", { phase: "verdict" }, judge, {
    actionId: verdictPhaseActionId,
    requestedAt: new Date(Date.parse(juryCompletedAt) + 1).toISOString(),
  });
  harness.commit(
    "RENDER_VERDICT",
    {
      verdictId,
      decision: juryOutput.recommendation.decision,
      citations: EMPTY_EVENT_CITATIONS,
    },
    judge,
    {
      actionId: verdictActionId,
      requestedAt: new Date(Date.parse(juryCompletedAt) + 2).toISOString(),
    },
  );
  harness.commit("BEGIN_PHASE", { phase: "debrief" }, judge, {
    actionId: debriefPhaseActionId,
    requestedAt: new Date(Date.parse(juryCompletedAt) + 3).toISOString(),
  });
  const deliberatedState = TrialStateV3Schema.parse(harness.state);

  const debriefOutput = emptyDebriefOutput();
  const debriefJson = canonicalStorageJson(debriefOutput);
  const debriefHash = hashDebriefGeneratorModelOutput(debriefOutput);
  const debriefMaterial = JSON.stringify({
    trialId,
    sourceStateVersion: deliberatedState.version,
    sourceLastEventId: deliberatedState.eventIds.at(-1),
  });
  const debriefMaterialHash = sha256Utf8(debriefMaterial);
  const debriefArtifactId = `debrief:final:${debriefMaterialHash}`;
  const debriefActionId = `action:debrief-generation:${debriefMaterialHash}`;
  const debriefEventId = `event:${debriefActionId}`;
  const completePhaseActionId = `action:phase-complete:${sha256Utf8(
    JSON.stringify({ trialId, debriefId: debriefArtifactId }),
  )}`;
  const debriefCallId = `call:debrief-generation:${suffix}`;
  const debriefStartedAt = new Date(BASE_TIME + 2_000).toISOString();
  const debriefTrace = acceptedTrace({
    callId: debriefCallId,
    trialId,
    actorId: debriefActor.actorId,
    actorRole: "debrief",
    callClass: "debrief_generator",
    task: "generate_debrief",
    model: "gpt-5.6-terra",
    promptVersion: "debrief-generator.prompt.v1",
    outputSchemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    outputHash: debriefHash,
    outputCharacterCount: debriefJson.length,
    sourceStateVersion: deliberatedState.version,
    sourceLastEventId: deliberatedState.eventIds.at(-1) ?? "",
    actionId: debriefActionId,
    eventId: debriefEventId,
    startedAt: debriefStartedAt,
    providerIdsAvailable,
  });
  const debriefCompletedAt = debriefTrace.completedAt;
  if (!debriefCompletedAt) throw new Error("Fixture debrief completion missing");
  const debriefEvent = harness.commit(
    "GENERATE_DEBRIEF",
    { debriefId: debriefArtifactId },
    debriefActor,
    {
      actionId: debriefActionId,
      requestedAt: debriefCompletedAt,
      source: "ai",
      modelMetadata: modelMetadata(debriefTrace),
    },
  );
  harness.commit("BEGIN_PHASE", { phase: "complete" }, judge, {
    actionId: completePhaseActionId,
    requestedAt: new Date(Date.parse(debriefCompletedAt) + 1).toISOString(),
  });
  const completedState = TrialStateV3Schema.parse(harness.state);
  const juryArtifact: StoredArtifact = {
    artifactId: juryArtifactId,
    artifactKind: "jury_deliberation",
    ownerId: OWNER_ID,
    trialId,
    callId: juryCallId,
    decisionId,
    actionId: juryActionId,
    eventId: juryEventId,
    sourceStateVersion: jurySourceStateVersion,
    sourceLastEventId: jurySourceLastEventId,
    committedStateVersion: juryEvent.stateVersion,
    artifactJson: juryJson,
    artifactHash: juryHash,
    artifactSchemaVersion: juryOutput.schemaVersion,
    promptVersion: juryTrace.promptVersion,
    model: juryTrace.model,
    createdAt: Date.parse(juryTrace.completedAt ?? ""),
  };
  const debriefArtifact: StoredArtifact = {
    artifactId: debriefArtifactId,
    artifactKind: "final_debrief",
    ownerId: OWNER_ID,
    trialId,
    callId: debriefCallId,
    decisionId: null,
    actionId: debriefActionId,
    eventId: debriefEventId,
    sourceStateVersion: deliberatedState.version,
    sourceLastEventId: deliberatedState.eventIds.at(-1) ?? "",
    committedStateVersion: debriefEvent.stateVersion,
    artifactJson: debriefJson,
    artifactHash: debriefHash,
    artifactSchemaVersion: debriefOutput.schemaVersion,
    promptVersion: debriefTrace.promptVersion,
    model: debriefTrace.model,
    createdAt: Date.parse(debriefTrace.completedAt ?? ""),
  };

  const selectedState =
    lifecycle === "active"
      ? activeState
      : lifecycle === "deliberated"
        ? deliberatedState
        : completedState;
  const selectedEvents = harness.events.slice(0, selectedState.lastSequence);
  const selectedTraces =
    lifecycle === "active"
      ? []
      : lifecycle === "deliberated"
        ? [juryTrace]
        : [juryTrace, debriefTrace];
  const selectedArtifacts =
    lifecycle === "active"
      ? []
      : lifecycle === "deliberated"
        ? [juryArtifact]
        : [juryArtifact, debriefArtifact];
  await backend.run(async (ctx) => {
    await ctx.db.insert("trialProjections", {
      projectionId: `projection:${trialId}`,
      trialId,
      ownerId: OWNER_ID,
      graphId: `graph:${suffix}`,
      caseId: selectedState.caseId,
      caseVersion: selectedState.caseVersion,
      stateVersion: selectedState.version,
      lastSequence: selectedState.lastSequence,
      stateJson: canonicalStorageJson(selectedState),
      stateSchemaVersion: selectedState.schemaVersion,
      eventSchemaVersion: selectedEvents[0]?.schemaVersion ?? "trial-event.v3",
      createdAt: BASE_TIME,
      updatedAt: Date.parse(selectedState.updatedAt),
    });
    for (const event of selectedEvents) {
      await ctx.db.insert("trialEvents", eventRecord(event));
    }
    for (const trace of selectedTraces) {
      await ctx.db.insert(
        "courtroomModelCalls",
        callRecord(OWNER_ID, trace),
      );
      await ctx.db.insert(
        "courtroomModelCallAttempts",
        attemptRecord(OWNER_ID, trialId, trace),
      );
    }
    for (const artifact of selectedArtifacts) {
      await ctx.db.insert("courtroomGeneratedArtifacts", artifact);
    }
  });

  return {
    trialId,
    activeState,
    deliberatedState,
    completedState,
    juryOutput,
    debriefOutput,
    juryArtifact,
    debriefArtifact,
    juryEventId,
    debriefEventId,
    juryCallId,
    debriefCallId,
  };
}

async function seedSettledTrial(
  backend: TestBackend,
  suffix: string,
): Promise<Readonly<{
  trialId: string;
  debriefOutput: DebriefGeneratorModelOutput;
  debriefArtifact: StoredArtifact;
}>> {
  const harness = createHarness(`settled-${suffix}`);
  const { trialId } = harness;
  const userCounsel = harness.actor(
    ({ role }) => role === "user_counsel",
    "USER_COUNSEL_ACTOR_MISSING",
  );
  const opposingCounsel = harness.actor(
    ({ role }) => role === "opposing_counsel",
    "OPPOSING_COUNSEL_ACTOR_MISSING",
  );
  const debriefActor = harness.actor(
    ({ role }) => role === "debrief_coach",
    "DEBRIEF_ACTOR_MISSING",
  );
  const judge = harness.actor(
    ({ role }) => role === "judge",
    "JUDGE_ACTOR_MISSING",
  );
  const offerId = `offer:settled:${suffix}`;
  harness.commit(
    "PROPOSE_SETTLEMENT",
    {
      offerId,
      parentOfferId: null,
      proposedByPartyId: "party_rina_shah",
      recipientPartyIds: ["party_redwood_signal"],
      terms: {
        amount: 75_000,
        currency: "USD",
        nonMonetaryTerms: ["Neutral reference"],
        summary: "Resolve the fictional educational dispute.",
      },
      expiresAtSequence:
        harness.state.lastSequence +
        1 +
        harness.state.policySnapshot.settlement.expiresAfterEventCount,
    },
    userCounsel,
    { source: "user" },
  );
  harness.commit("ACCEPT_SETTLEMENT", { offerId }, opposingCounsel, {
    source: "user",
  });
  if (harness.state.phase !== "debrief" || harness.state.status !== "settled") {
    throw new Error("Fixture settlement did not enter debrief");
  }

  const debriefOutput = emptyDebriefOutput();
  const debriefJson = canonicalStorageJson(debriefOutput);
  const debriefHash = hashDebriefGeneratorModelOutput(debriefOutput);
  const sourceStateVersion = harness.state.version;
  const sourceLastEventId = harness.state.eventIds.at(-1);
  if (!sourceLastEventId) throw new Error("Fixture debrief source missing");
  const material = JSON.stringify({
    trialId,
    sourceStateVersion,
    sourceLastEventId,
  });
  const materialHash = sha256Utf8(material);
  const debriefId = `debrief:final:${materialHash}`;
  const actionId = `action:debrief-generation:${materialHash}`;
  const eventId = `event:${actionId}`;
  const callId = `call:debrief-generation:settled-${suffix}`;
  const trace = acceptedTrace({
    callId,
    trialId,
    actorId: debriefActor.actorId,
    actorRole: "debrief",
    callClass: "debrief_generator",
    task: "generate_debrief",
    model: "gpt-5.6-terra",
    promptVersion: "debrief-generator.prompt.v1",
    outputSchemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    outputHash: debriefHash,
    outputCharacterCount: debriefJson.length,
    sourceStateVersion,
    sourceLastEventId,
    actionId,
    eventId,
    startedAt: new Date(BASE_TIME + 3_000).toISOString(),
  });
  const completedAt = trace.completedAt;
  if (!completedAt) throw new Error("Fixture debrief completion missing");
  const debriefEvent = harness.commit(
    "GENERATE_DEBRIEF",
    { debriefId },
    debriefActor,
    {
      actionId,
      requestedAt: completedAt,
      source: "ai",
      modelMetadata: modelMetadata(trace),
    },
  );
  const completePhaseActionId = `action:phase-complete:${sha256Utf8(
    JSON.stringify({ trialId, debriefId }),
  )}`;
  harness.commit("BEGIN_PHASE", { phase: "complete" }, judge, {
    actionId: completePhaseActionId,
    requestedAt: new Date(Date.parse(completedAt) + 1).toISOString(),
  });
  const state = TrialStateV3Schema.parse(harness.state);
  const debriefArtifact: StoredArtifact = {
    artifactId: debriefId,
    artifactKind: "final_debrief",
    ownerId: OWNER_ID,
    trialId,
    callId,
    decisionId: null,
    actionId,
    eventId,
    sourceStateVersion,
    sourceLastEventId,
    committedStateVersion: debriefEvent.stateVersion,
    artifactJson: debriefJson,
    artifactHash: debriefHash,
    artifactSchemaVersion: debriefOutput.schemaVersion,
    promptVersion: trace.promptVersion,
    model: trace.model,
    createdAt: Date.parse(completedAt),
  };
  await backend.run(async (ctx) => {
    await ctx.db.insert("trialProjections", {
      projectionId: `projection:${trialId}`,
      trialId,
      ownerId: OWNER_ID,
      graphId: `graph:settled-${suffix}`,
      caseId: state.caseId,
      caseVersion: state.caseVersion,
      stateVersion: state.version,
      lastSequence: state.lastSequence,
      stateJson: canonicalStorageJson(state),
      stateSchemaVersion: state.schemaVersion,
      eventSchemaVersion: harness.events[0]?.schemaVersion ?? "trial-event.v3",
      createdAt: BASE_TIME,
      updatedAt: Date.parse(state.updatedAt),
    });
    for (const event of harness.events) {
      await ctx.db.insert("trialEvents", eventRecord(event));
    }
    await ctx.db.insert("courtroomModelCalls", callRecord(OWNER_ID, trace));
    await ctx.db.insert(
      "courtroomModelCallAttempts",
      attemptRecord(OWNER_ID, trialId, trace),
    );
    await ctx.db.insert("courtroomGeneratedArtifacts", debriefArtifact);
  });
  return { trialId, debriefOutput, debriefArtifact };
}

async function readArtifacts(
  backend: TestBackend,
  trialId: string,
  ownerId = OWNER_ID,
) {
  return await backend.query(listReference, { ownerId, trialId });
}

describe("internal courtroom generated-artifact reads", () => {
  it("matches active, deliberated, completed, and settled artifact lifecycles", async () => {
    const activeBackend = convexTest({ schema, modules });
    const active = await seedValidTrial(activeBackend, "lifecycle-active", "active");
    await expect(readArtifacts(activeBackend, active.trialId)).resolves.toEqual(
      [],
    );

    const deliberatedBackend = convexTest({ schema, modules });
    const deliberated = await seedValidTrial(
      deliberatedBackend,
      "lifecycle-deliberated",
      "deliberated",
    );
    await expect(
      readArtifacts(deliberatedBackend, deliberated.trialId),
    ).resolves.toMatchObject([
      {
        artifactKind: "jury_deliberation",
        privacyProjectionRequired: true,
      },
    ]);

    const completedBackend = convexTest({ schema, modules });
    const completed = await seedValidTrial(
      completedBackend,
      "lifecycle-completed",
    );
    await expect(
      readArtifacts(completedBackend, completed.trialId),
    ).resolves.toHaveLength(2);

    const settledBackend = convexTest({ schema, modules });
    const settled = await seedSettledTrial(settledBackend, "lifecycle");
    await expect(
      readArtifacts(settledBackend, settled.trialId),
    ).resolves.toMatchObject([
      {
        artifactKind: "final_debrief",
        privacyProjectionRequired: true,
        artifact: settled.debriefOutput,
      },
    ]);
  });

  it("returns an owner-bound, typed, state-ordered internal list", async () => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(backend, "happy");

    await expect(readArtifacts(backend, seeded.trialId)).resolves.toEqual([
      {
        artifactKind: "jury_deliberation",
        privacyProjectionRequired: true,
        decisionId: seeded.juryArtifact.decisionId,
        metadata: {
          artifactId: seeded.juryArtifact.artifactId,
          trialId: seeded.trialId,
          callId: seeded.juryCallId,
          actionId: seeded.juryArtifact.actionId,
          eventId: seeded.juryEventId,
          sourceStateVersion: seeded.juryArtifact.sourceStateVersion,
          sourceLastEventId: seeded.juryArtifact.sourceLastEventId,
          committedStateVersion: seeded.juryArtifact.committedStateVersion,
          artifactHash: seeded.juryArtifact.artifactHash,
          artifactSchemaVersion: seeded.juryArtifact.artifactSchemaVersion,
          promptVersion: "role-responder.jury.prompt.v1",
          model: "gpt-5.6-luna",
          createdAt: seeded.juryArtifact.createdAt,
        },
        artifact: seeded.juryOutput,
      },
      {
        artifactKind: "final_debrief",
        privacyProjectionRequired: true,
        decisionId: null,
        metadata: {
          artifactId: seeded.debriefArtifact.artifactId,
          trialId: seeded.trialId,
          callId: seeded.debriefCallId,
          actionId: seeded.debriefArtifact.actionId,
          eventId: seeded.debriefEventId,
          sourceStateVersion: seeded.debriefArtifact.sourceStateVersion,
          sourceLastEventId: seeded.debriefArtifact.sourceLastEventId,
          committedStateVersion:
            seeded.debriefArtifact.committedStateVersion,
          artifactHash: seeded.debriefArtifact.artifactHash,
          artifactSchemaVersion: seeded.debriefArtifact.artifactSchemaVersion,
          promptVersion: "debrief-generator.prompt.v1",
          model: "gpt-5.6-terra",
          createdAt: seeded.debriefArtifact.createdAt,
        },
        artifact: seeded.debriefOutput,
      },
    ]);
    await expect(
      readArtifacts(backend, seeded.trialId, OTHER_OWNER_ID),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
  });

  it("accepts exact audits when provider request and response IDs were unavailable", async () => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(
      backend,
      "provider-ids-unavailable",
      "completed",
      false,
    );
    const stored = await backend.run(async (ctx) => ({
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
      generatedEvents: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", seeded.trialId),
          )
          .collect()
      ).filter(({ eventType }) =>
        ["DELIBERATE", "GENERATE_DEBRIEF"].includes(eventType),
      ),
    }));
    expect(stored.attempts).toHaveLength(2);
    expect(stored.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerRequestId: null,
          providerResponseId: null,
        }),
      ]),
    );
    expect(
      stored.generatedEvents.every(
        ({ modelRequestId }) => modelRequestId === undefined,
      ),
    ).toBe(true);
    await expect(readArtifacts(backend, seeded.trialId)).resolves.toHaveLength(
      2,
    );
  });

  it("fails closed when accepted jury trace citations differ from the artifact", async () => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(backend, "trace-citations");
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", seeded.juryCallId),
        )
        .unique();
      if (!row) throw new Error("Fixture jury call missing");
      const trace = CourtroomModelCallTraceSchema.parse(
        JSON.parse(row.traceJson),
      );
      const tampered = CourtroomModelCallTraceSchema.parse({
        ...trace,
        acceptedCitations: {
          ...trace.acceptedCitations,
          factIds: ["fact:tampered"],
        },
        acceptedCitationCount: 1,
      });
      await ctx.db.patch(row._id, {
        acceptedCitationCount: 1,
        traceJson: canonicalStorageJson(tampered),
      });
    });
    await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
      "COURTROOM_GENERATED_ARTIFACT_AUDIT_INVALID",
    );
  });

  it("fails closed when accepted debrief trace citations differ from the artifact", async () => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(backend, "debrief-trace-citations");
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", seeded.debriefCallId),
        )
        .unique();
      if (!row) throw new Error("Fixture debrief call missing");
      const trace = CourtroomModelCallTraceSchema.parse(
        JSON.parse(row.traceJson),
      );
      const tampered = CourtroomModelCallTraceSchema.parse({
        ...trace,
        acceptedCitations: {
          ...trace.acceptedCitations,
          factIds: ["fact:tampered"],
        },
        acceptedCitationCount: 1,
      });
      await ctx.db.patch(row._id, {
        acceptedCitationCount: 1,
        traceJson: canonicalStorageJson(tampered),
      });
    });
    await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
      "COURTROOM_GENERATED_ARTIFACT_AUDIT_INVALID",
    );
  });

  it("fails closed when deterministic verdict citations differ from the jury artifact", async () => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(backend, "verdict-citations");
    await backend.run(async (ctx) => {
      const rows = await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", seeded.trialId),
        )
        .collect();
      const row = rows.find(({ eventType }) => eventType === "RENDER_VERDICT");
      if (!row) throw new Error("Fixture verdict event missing");
      const payload = JSON.parse(row.payloadJson) as {
        verdictId: string;
        decision: string;
        citations: {
          factIds: string[];
          evidenceIds: string[];
          testimonyIds: string[];
          eventIds: string[];
          sourceSegmentIds: string[];
        };
      };
      payload.citations.factIds = ["fact:tampered"];
      await ctx.db.patch(row._id, {
        payloadJson: canonicalStorageJson(payload),
        factIds: ["fact:tampered"],
      });
    });
    await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
      "COURTROOM_GENERATED_ARTIFACT_AUDIT_INVALID",
    );
  });

  it.each([
    {
      name: "artifact JSON",
      patch: { artifactJson: "{}" },
    },
    {
      name: "domain hash",
      patch: { artifactHash: "f".repeat(64) },
    },
    {
      name: "schema version",
      patch: { artifactSchemaVersion: "jury-role-response.output.v999" },
    },
    {
      name: "prompt version",
      patch: { promptVersion: "role-responder.jury.prompt.v999" },
    },
    {
      name: "model",
      patch: { model: "gpt-5.6-terra" as const },
    },
  ])("fails closed on tampered $name", async ({ name, patch }) => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(backend, `artifact-${name.length}`);
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("courtroomGeneratedArtifacts")
        .withIndex("by_artifact_id", (index) =>
          index.eq("artifactId", seeded.juryArtifact.artifactId),
        )
        .unique();
      if (!row) throw new Error("Fixture jury artifact missing");
      await ctx.db.patch(row._id, patch);
    });
    await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
      /COURTROOM_GENERATED_ARTIFACT_/,
    );
  });

  it("rejects semantically equal artifact JSON outside the writer's canonical storage order", async () => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(backend, "artifact-order");
    const parsed = JSON.parse(seeded.juryArtifact.artifactJson) as Record<
      string,
      unknown
    >;
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(parsed).reverse()),
    );
    expect(reordered).not.toBe(seeded.juryArtifact.artifactJson);
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("courtroomGeneratedArtifacts")
        .withIndex("by_artifact_id", (index) =>
          index.eq("artifactId", seeded.juryArtifact.artifactId),
        )
        .unique();
      if (!row) throw new Error("Fixture jury artifact missing");
      await ctx.db.patch(row._id, { artifactJson: reordered });
    });
    await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
      "COURTROOM_GENERATED_ARTIFACT_INVALID",
    );
  });

  it.each([
    {
      name: "event action",
      patch: { actionId: "action:tampered:event-link" },
    },
    {
      name: "event state",
      patch: { stateVersion: 99 },
    },
    {
      name: "event model schema",
      patch: { modelSchemaVersion: "jury-role-response.output.v999" },
    },
  ])("fails closed on tampered $name linkage", async ({ name, patch }) => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(backend, `event-${name.length}`);
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("trialEvents")
        .withIndex("by_event_id", (index) =>
          index.eq("eventId", seeded.juryEventId),
        )
        .unique();
      if (!row) throw new Error("Fixture jury event missing");
      await ctx.db.patch(row._id, patch);
    });
    await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
      "COURTROOM_GENERATED_ARTIFACT_AUDIT_INVALID",
    );
  });

  it("fails closed when a deterministic artifact continuation is tampered", async () => {
    const backend = convexTest({ schema, modules });
    const seeded = await seedValidTrial(backend, "continuation");
    const completeEventId = seeded.completedState.eventIds.at(-1);
    if (!completeEventId) throw new Error("Fixture complete event missing");
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("trialEvents")
        .withIndex("by_event_id", (index) =>
          index.eq("eventId", completeEventId),
        )
        .unique();
      if (!row) throw new Error("Fixture complete event missing");
      await ctx.db.patch(row._id, {
        payloadJson: canonicalStorageJson({ phase: "debrief" }),
      });
    });
    await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
      "COURTROOM_GENERATED_ARTIFACT_AUDIT_INVALID",
    );
  });

  it("fails closed on model-call, attempt, and cross-owner audit tamper", async () => {
    for (const [suffix, table] of [
      ["call", "courtroomModelCalls"],
      ["attempt", "courtroomModelCallAttempts"],
      ["owner", "courtroomModelCalls"],
    ] as const) {
      const backend = convexTest({ schema, modules });
      const seeded = await seedValidTrial(backend, `audit-${suffix}`);
      await backend.run(async (ctx) => {
        if (table === "courtroomModelCalls") {
          const row = await ctx.db
            .query(table)
            .withIndex("by_call_id", (index) =>
              index.eq("callId", seeded.juryCallId),
            )
            .unique();
          if (!row) throw new Error("Fixture jury call missing");
          await ctx.db.patch(
            row._id,
            suffix === "owner"
              ? { ownerId: OTHER_OWNER_ID }
              : { promptVersion: "role-responder.jury.prompt.v999" },
          );
          return;
        }
        const rows = await ctx.db
          .query(table)
          .withIndex("by_call_attempt", (index) =>
            index.eq("callId", seeded.juryCallId),
          )
          .collect();
        const row = rows[0];
        if (!row) throw new Error("Fixture jury attempt missing");
        await ctx.db.patch(row._id, { outputHash: "e".repeat(64) });
      });
      await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
        "COURTROOM_GENERATED_ARTIFACT_AUDIT_INVALID",
      );
    }
  });

  it("rejects missing/cross-owner rows, duplicates, and over-limit sets", async () => {
    {
      const backend = convexTest({ schema, modules });
      const seeded = await seedValidTrial(backend, "owner-row");
      await backend.run(async (ctx) => {
        const row = await ctx.db
          .query("courtroomGeneratedArtifacts")
          .withIndex("by_artifact_id", (index) =>
            index.eq("artifactId", seeded.juryArtifact.artifactId),
          )
          .unique();
        if (!row) throw new Error("Fixture jury artifact missing");
        await ctx.db.patch(row._id, { ownerId: OTHER_OWNER_ID });
      });
      await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
        "COURTROOM_GENERATED_ARTIFACT_SET_INVALID",
      );
    }
    {
      const backend = convexTest({ schema, modules });
      const seeded = await seedValidTrial(backend, "duplicate");
      await backend.run(async (ctx) => {
        const row = await ctx.db
          .query("courtroomGeneratedArtifacts")
          .withIndex("by_artifact_id", (index) =>
            index.eq("artifactId", seeded.debriefArtifact.artifactId),
          )
          .unique();
        if (!row) throw new Error("Fixture debrief artifact missing");
        await ctx.db.patch(row._id, {
          artifactKind: "jury_deliberation",
        });
      });
      await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
        "COURTROOM_GENERATED_ARTIFACT_DUPLICATE",
      );
    }
    {
      const backend = convexTest({ schema, modules });
      const seeded = await seedValidTrial(backend, "limit");
      await backend.run(async (ctx) => {
        await ctx.db.insert("courtroomGeneratedArtifacts", {
          ...seeded.juryArtifact,
          artifactId: "artifact:jury:third",
          callId: "call:jury-deliberation:third",
          actionId: "action:jury-deliberation:third",
          eventId: "event:action:jury-deliberation:third",
        });
      });
      await expect(readArtifacts(backend, seeded.trialId)).rejects.toThrow(
        "COURTROOM_GENERATED_ARTIFACT_LIMIT_EXCEEDED",
      );
    }
  });
});
