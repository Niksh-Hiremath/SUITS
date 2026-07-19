import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { sha256Utf8 } from "../src/domain/case-graph";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  ObjectionRulingModelOutputSchema,
  ObjectionRulingRequestSchema,
  WitnessAnswerRequestSchema,
  WitnessAnswerModelOutputSchema,
} from "../src/domain/courtroom-ai";
import {
  HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingObjectionRulingPrecommitSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  hashObjectionRulingModelOutput,
  hashWitnessAnswerModelOutput,
  objectionRulingOutputCitations,
  witnessAnswerOutputCitations,
  type HearingCommandPreparation,
  type HearingRuntimeViewV1,
} from "../src/domain/hearing-runtime";
import {
  FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
  FinalBoundInterruptionRequestSchema,
  type FinalBoundInterruptionRequest,
} from "../src/domain/objections/final-bound-contracts";
import {
  HearingFinalBoundInterruptionPreparationSchema,
  HearingFinalBoundInterruptionClaimResultSchema,
  HearingFinalBoundInterruptionLeaseUpdateResultSchema,
  HearingFinalBoundInterruptionRecoveryPreparationSchema,
  deriveFinalBoundInterruptionPersistenceIds,
  type HearingFinalBoundInterruptionPreparation,
  type HearingFinalBoundInterruptionClaimResult,
  type HearingFinalBoundInterruptionLeaseCredential,
  type HearingFinalBoundInterruptionLeaseUpdateResult,
  type HearingFinalBoundInterruptionRecoveryPreparation,
} from "../src/domain/objections/final-bound-persistence";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  TrialStateV3Schema,
  type ActorRef,
  type TrialActionV3,
} from "../src/domain/trial-engine";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./hearingRuntime.ts": () => import("./hearingRuntime"),
  "./courtroomModelCalls.ts": () => import("./courtroomModelCalls"),
  "./trialEvents.ts": () => import("./trialEvents"),
  "./finalBoundInterruptionClaims.ts": () =>
    import("./finalBoundInterruptionClaims"),
};

type TestBackend = TestConvex<typeof schema>;

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";

const startReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; requestJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:start");
const prepareCommandReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; commandJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:prepareCommand");
const prepareFinalBoundReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; requestJson: string }>,
  HearingFinalBoundInterruptionPreparation
>("hearingRuntime:prepareFinalBoundInterruption");
const readReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:read");
const resumeFinalBoundReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; interruptId?: string }>,
  HearingFinalBoundInterruptionRecoveryPreparation
>("hearingRuntime:resumeFinalBoundInterruption");
const claimFinalBoundReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; interruptId?: string }>,
  HearingFinalBoundInterruptionClaimResult
>("hearingRuntime:claimFinalBoundInterruption");
const renewFinalBoundClaimReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; credentialJson: string }>,
  HearingFinalBoundInterruptionLeaseUpdateResult
>("hearingRuntime:renewFinalBoundInterruptionClaim");
const releaseFinalBoundClaimReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; credentialJson: string }>,
  HearingFinalBoundInterruptionLeaseUpdateResult
>("hearingRuntime:releaseFinalBoundInterruptionClaim");
const authorizeClaimCommitReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    trialId: string;
    interruptId: string;
    decisionId: string;
    leaseGeneration: number;
    leaseTokenHash: string;
    now: number;
  }>,
  Readonly<{ status: "authorized" | "outcome" }>
>("finalBoundInterruptionClaims:authorizeCommit");
const commitObjectionRulingGenerationReference = makeFunctionReference<
  "action",
  Readonly<{
    ownerId: string;
    trialId: string;
    generationJson: string;
    claimCredentialJson?: string;
  }>,
  HearingCommandPreparation
>("hearingRuntime:commitObjectionRulingGeneration");
const commitWitnessGenerationReference = makeFunctionReference<
  "action",
  Readonly<{
    ownerId: string;
    trialId: string;
    generationJson: string;
    claimCredentialJson?: string;
  }>,
  HearingCommandPreparation
>("hearingRuntime:commitWitnessGeneration");
const appendTrustedForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    writeSnapshot?: boolean;
  }>,
  Readonly<{ committedStateVersion: number; replayed: boolean }>
>("trialEvents:appendTrustedForOwner");

function startRequest() {
  return {
    schemaVersion: HEARING_START_SCHEMA_VERSION,
    requestId: "11111111-1111-4111-8111-111111111111",
    requestedAt: "2026-07-19T03:00:00.000Z",
    case: { kind: "seeded", slug: "redwood-signal-retaliation" },
    userSide: "user",
  } as const;
}

async function prepareDirectExamination(
  backend: TestBackend,
): Promise<HearingRuntimeViewV1> {
  const started = HearingRuntimeViewV1Schema.parse(
    await backend.action(startReference, {
      ownerId: OWNER_ID,
      requestJson: JSON.stringify(startRequest()),
    }),
  );
  const command = {
    schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
    requestId: "22222222-2222-4222-8222-222222222222",
    requestedAt: "2026-07-19T03:01:00.000Z",
    expectedStateVersion: started.trial.version,
    expectedLastEventId: started.trial.lastEventId,
    intent: {
      type: "call_witness",
      witnessId: "witness_rina_shah",
    },
  } as const;
  const prepared = HearingCommandPreparationSchema.parse(
    await backend.action(prepareCommandReference, {
      ownerId: OWNER_ID,
      trialId: started.trial.trialId,
      commandJson: JSON.stringify(command),
    }),
  );
  if (prepared.status !== "completed") {
    throw new Error("Expected player-owned direct examination");
  }
  expect(prepared.view.activeAppearance).toMatchObject({
    witnessId: "witness_rina_shah",
    stage: "direct",
  });
  return prepared.view;
}

function interruptionRequest(
  view: HearingRuntimeViewV1,
  suffix = "one",
  text = "You signed the delivery report, correct?",
): FinalBoundInterruptionRequest {
  return FinalBoundInterruptionRequestSchema.parse({
    schemaVersion: FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
    head: {
      trialId: view.trial.trialId,
      stateVersion: view.trial.version,
      lastEventId: view.trial.lastEventId,
    },
    utterance: {
      generation: 1,
      utteranceId: `utterance:${suffix}`,
    },
    trigger: { revision: 4, text, confidence: 0.99 },
    final: { revision: 5, text },
  });
}

async function prepareFinalBound(
  backend: TestBackend,
  request: FinalBoundInterruptionRequest,
  ownerId = OWNER_ID,
): Promise<
  Exclude<
    HearingFinalBoundInterruptionPreparation,
    { phase: "candidate_withdrawn" }
  >
> {
  const result = await prepareFinalBoundResult(backend, request, ownerId);
  if (result.phase === "candidate_withdrawn") {
    throw new Error("Expected a committed interruption prefix");
  }
  return result;
}

async function prepareFinalBoundResult(
  backend: TestBackend,
  request: FinalBoundInterruptionRequest,
  ownerId = OWNER_ID,
): Promise<HearingFinalBoundInterruptionPreparation> {
  return HearingFinalBoundInterruptionPreparationSchema.parse(
    await backend.action(prepareFinalBoundReference, {
      ownerId,
      trialId: request.head.trialId,
      requestJson: JSON.stringify(request),
    }),
  );
}

async function resumeFinalBound(
  backend: TestBackend,
  trialId: string,
  interruptId?: string,
  ownerId = OWNER_ID,
): Promise<HearingFinalBoundInterruptionRecoveryPreparation> {
  return HearingFinalBoundInterruptionRecoveryPreparationSchema.parse(
    await backend.action(resumeFinalBoundReference, {
      ownerId,
      trialId,
      ...(interruptId === undefined ? {} : { interruptId }),
    }),
  );
}

async function claimFinalBound(
  backend: TestBackend,
  trialId: string,
  interruptId?: string,
): Promise<HearingFinalBoundInterruptionClaimResult> {
  return HearingFinalBoundInterruptionClaimResultSchema.parse(
    await backend.action(claimFinalBoundReference, {
      ownerId: OWNER_ID,
      trialId,
      ...(interruptId === undefined ? {} : { interruptId }),
    }),
  );
}

function leaseCredential(
  claim: Extract<HearingFinalBoundInterruptionClaimResult, { status: "claimed" }>,
): HearingFinalBoundInterruptionLeaseCredential {
  return {
    decisionId: claim.decisionId,
    interruptId: claim.interruptId,
    leaseGeneration: claim.leaseGeneration,
    leaseToken: claim.leaseToken,
  };
}

async function updateLease(
  backend: TestBackend,
  operation: "renew" | "release",
  trialId: string,
  credential: HearingFinalBoundInterruptionLeaseCredential,
) {
  return HearingFinalBoundInterruptionLeaseUpdateResultSchema.parse(
    await backend.action(
      operation === "renew"
        ? renewFinalBoundClaimReference
        : releaseFinalBoundClaimReference,
      {
        ownerId: OWNER_ID,
        trialId,
        credentialJson: JSON.stringify(credential),
      },
    ),
  );
}

async function trialState(backend: TestBackend, trialId: string) {
  return await backend.run(async (ctx) => {
    const projection = await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", trialId))
      .unique();
    if (projection === null) throw new Error("Missing trial projection");
    return TrialStateV3Schema.parse(JSON.parse(projection.stateJson));
  });
}

async function storedEvents(backend: TestBackend, trialId: string) {
  return await backend.run(async (ctx) =>
    (
      await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", trialId),
        )
        .collect()
    ).sort((left, right) => left.sequence - right.sequence),
  );
}

function actorByRole(
  state: Awaited<ReturnType<typeof trialState>>,
  role: ActorRef["role"],
): ActorRef {
  const actor = Object.values(state.actors).find(
    (candidate) => candidate.role === role,
  );
  if (actor === undefined) throw new Error(`Missing ${role} actor`);
  return actor;
}

function trustedAction(input: Readonly<{
  actionId: string;
  trialId: string;
  expectedStateVersion: number;
  actor: ActorRef;
  requestedAt: string;
  causationId: string;
  responseId: string;
  interruptId: string;
  type: "RULE_ON_OBJECTION" | "RESOLVE_INTERRUPTION" | "RESUME_INTERRUPTED_SPEECH";
  payload: unknown;
}>): TrialActionV3 {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: input.actionId,
    trialId: input.trialId,
    expectedStateVersion: input.expectedStateVersion,
    actor: input.actor,
    source: "deterministic",
    requestedAt: input.requestedAt,
    causationId: input.causationId,
    correlationId: input.trialId,
    responseId: input.responseId,
    interruptId: input.interruptId,
    modelMetadata: null,
    type: input.type,
    payload: input.payload,
  });
}

async function commitRuling(
  backend: TestBackend,
  prepared: Exclude<
    HearingFinalBoundInterruptionPreparation,
    { phase: "candidate_withdrawn" }
  >,
  ruling: "sustained" | "overruled",
  sustainedRemedy: "cancel_response" | "rephrase" = "cancel_response",
): Promise<void> {
  const state = await trialState(
    backend,
    prepared.interrupt.sourceHead.trialId,
  );
  const judge = actorByRole(state, "judge");
  const system = actorByRole(state, "system");
  const remedy =
    ruling === "overruled" ? "resume_response" : sustainedRemedy;
  const base = prepared.interrupt.committedHead.stateVersion;
  const rulingActionId = `action:test-ruling:${prepared.interrupt.interruptId}`;
  const resolveActionId = `action:test-resolution:${prepared.interrupt.interruptId}`;
  const actions: TrialActionV3[] = [
    trustedAction({
      actionId: rulingActionId,
      trialId: state.trialId,
      expectedStateVersion: base,
      actor: judge,
      requestedAt: "2026-07-19T03:02:00.000Z",
      causationId: prepared.interrupt.interruptionEventId,
      responseId: prepared.interrupt.responseId,
      interruptId: prepared.interrupt.interruptId,
      type: "RULE_ON_OBJECTION",
      payload: {
        objectionId: prepared.interrupt.objectionId,
        ruling,
        remedy,
        reason: "Deterministic integration-test ruling.",
      },
    }),
    trustedAction({
      actionId: resolveActionId,
      trialId: state.trialId,
      expectedStateVersion: base + 1,
      actor: system,
      requestedAt: "2026-07-19T03:02:00.001Z",
      causationId: `event:${rulingActionId}`,
      responseId: prepared.interrupt.responseId,
      interruptId: prepared.interrupt.interruptId,
      type: "RESOLVE_INTERRUPTION",
      payload: {
        interruptId: prepared.interrupt.interruptId,
        outcome: ruling === "overruled" ? "resume" : "cancel",
      },
    }),
  ];
  if (ruling === "overruled") {
    actions.push(
      trustedAction({
        actionId: `action:test-resume:${prepared.interrupt.interruptId}`,
        trialId: state.trialId,
        expectedStateVersion: base + 2,
        actor: system,
        requestedAt: "2026-07-19T03:02:00.002Z",
        causationId: `event:${resolveActionId}`,
        responseId: prepared.interrupt.responseId,
        interruptId: prepared.interrupt.interruptId,
        type: "RESUME_INTERRUPTED_SPEECH",
        payload: {
          interruptId: prepared.interrupt.interruptId,
          interruptedResponseId: prepared.interrupt.responseId,
        },
      }),
    );
  }
  for (const action of actions) {
    await backend.mutation(appendTrustedForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify(action),
    });
  }
}

async function commitRecoveredAnswer(
  backend: TestBackend,
  prepared: Exclude<
    HearingFinalBoundInterruptionPreparation,
    { phase: "candidate_withdrawn" }
  >,
): Promise<Readonly<{ turnId: string; eventId: string }>> {
  const state = await trialState(
    backend,
    prepared.interrupt.sourceHead.trialId,
  );
  const response = state.pendingResponses[prepared.interrupt.responseId];
  if (response?.witnessId === null || response === undefined) {
    throw new Error("Expected target witness response");
  }
  const witness = state.actors[response.actorId];
  if (witness?.role !== "witness") {
    throw new Error("Expected response-bound witness actor");
  }
  const actionId = `action:witness-answer:${sha256Utf8(
    JSON.stringify({
      trialId: state.trialId,
      responseId: prepared.interrupt.responseId,
    }),
  )}`;
  const turnId = `turn:answer:final-bound-test:${prepared.interrupt.responseId}`;
  const action = TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId,
    trialId: state.trialId,
    expectedStateVersion: state.version,
    actor: witness,
    source: "deterministic",
    requestedAt: "2026-07-19T03:02:01.000Z",
    causationId: state.eventIds.at(-1),
    correlationId: state.trialId,
    responseId: prepared.interrupt.responseId,
    interruptId: prepared.interrupt.interruptId,
    modelMetadata: null,
    type: "ANSWER_QUESTION",
    payload: {
      responseId: prepared.interrupt.responseId,
      questionId: prepared.interrupt.questionId,
      witnessId: response.witnessId,
      testimonyId: `testimony:final-bound-test:${prepared.interrupt.responseId}`,
      turnId,
      text: "I signed the fictional delivery report.",
      factIds: [],
      evidenceIds: [],
    },
  });
  await backend.mutation(appendTrustedForOwnerReference, {
    ownerId: OWNER_ID,
    actionJson: JSON.stringify(action),
  });
  return { turnId, eventId: `event:${actionId}` };
}

async function generatedSustainedRuling(
  preparation: HearingCommandPreparation,
) {
  if (preparation.status !== "model_required") {
    throw new Error("Expected a pending objection ruling");
  }
  const request = ObjectionRulingRequestSchema.parse(preparation.request);
  if (request.interruption === null) {
    throw new Error("Expected an interrupted response");
  }
  const output = ObjectionRulingModelOutputSchema.parse({
    schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
    ruling: "sustained",
    remedy: "rephrase",
    reason: "The leading form is not permitted on this direct examination.",
    citations: {
      factIds: [],
      evidenceIds: [],
      testimonyIds: [],
      transcriptTurnIds: [request.question.turnId],
      sourceSegmentIds: [],
      priorStatementIds: [],
      issueIds: [],
      instructionIds: [],
      ruleIds: [],
      settlementOfferIds: [],
    },
    performance: {
      activity: "ruling",
      emotion: "neutral",
      intensity: 0.5,
      gazeTarget: "questioning_counsel",
      gesture: "gavel",
      speakingStyle: "formal",
    },
  });
  const startedAt = "2026-07-19T05:10:00.000Z";
  const completedAt = "2026-07-19T05:10:00.250Z";
  const outputHash = hashObjectionRulingModelOutput(output);
  const acceptedCitations = objectionRulingOutputCitations(output, {
    turnId: request.question.turnId,
    sourceEventId: request.question.eventId,
  });
  const record = request.knowledgeView.publicRecord;
  const usage = {
    inputTokens: 160,
    outputTokens: 35,
    totalTokens: 195,
    cachedInputTokens: 50,
    cacheWriteTokens: 0,
    reasoningTokens: 8,
  };
  const providerRequestId = `request:test:${sha256Utf8(request.callId).slice(0, 24)}`;
  const trace = CourtroomModelCallTraceSchema.parse({
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: request.callId,
    trialId: request.trialId,
    responseId: request.interruption.interruptedResponseId,
    actorId: request.actorId,
    actorRole: "judge",
    callClass: "objection_resolver",
    task: "resolve_objection",
    inputEventIds: [
      ...new Set([
        request.question.eventId,
        request.objection.sourceEventId,
        request.expectedLastEventId,
      ]),
    ].sort((left, right) => left.localeCompare(right)),
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    provider: "scripted-courtroom-model",
    model: "gpt-5.6-luna",
    providerProtocolVersion: "courtroom-model-provider.v1",
    promptVersion: "objection-resolver.ruling.prompt.v1",
    outputSchemaVersion: output.schemaVersion,
    knowledgeScope: {
      knowledgeSchemaVersion: request.knowledgeView.schemaVersion,
      knowledgeViewHash: sha256Utf8(JSON.stringify(request.knowledgeView)),
      stateVersion: request.knowledgeView.stateVersion,
      factCount: record.facts.length,
      evidenceCount: record.evidence.length,
      testimonyCount: record.testimony.length,
      priorStatementCount: 0,
      sourceSegmentCount: new Set([
        ...record.facts.flatMap(({ sourceSegmentIds }) => sourceSegmentIds),
        ...record.evidence.flatMap(({ sourceSegmentIds }) => sourceSegmentIds),
      ]).size,
      publicRecordEventCount: new Set(
        record.testimony.map(({ transcriptEventId }) => transcriptEventId),
      ).size,
      currentExchangeCount:
        request.knowledgeView.currentExchange === null ? 0 : 1,
    },
    promptAudit: {
      stablePrefixHash: sha256Utf8("fake-objection-stable-prefix"),
      trustedContextHash: sha256Utf8("fake-objection-trusted-context"),
      untrustedInputHash: sha256Utf8("fake-objection-untrusted-input"),
      inputCharacterCount: 80,
    },
    status: "accepted",
    startedAt,
    completedAt,
    latencyMs: 250,
    firstStructuredDeltaMs: 25,
    firstAcceptedSegmentMs: 50,
    retryCount: 0,
    validationFailureCount: 0,
    estimatedCostUsd: null,
    usage,
    acceptedAttempt: 1,
    acceptedCitations,
    acceptedCitationCount: Object.values(acceptedCitations).reduce(
      (total, identifiers) => total + identifiers.length,
      0,
    ),
    outputHash,
    outputCharacterCount: JSON.stringify(output).length,
    committedActionId: null,
    committedEventId: null,
    safeFailureCode: null,
    attempts: [
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 1,
        mode: "initial",
        status: "accepted",
        providerRequestId,
        providerResponseId: `response:test:${sha256Utf8(request.callId).slice(0, 24)}`,
        startedAt,
        completedAt,
        latencyMs: 250,
        firstStructuredDeltaMs: 25,
        streamEventCount: 3,
        structuredDeltaCount: 1,
        streamedCharacterCount: JSON.stringify(output).length,
        outputHash,
        proposedCitationCount: Object.values(output.citations).reduce(
          (total, identifiers) => total + identifiers.length,
          0,
        ),
        usage,
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  });
  return HearingObjectionRulingPrecommitSchema.parse({
    schemaVersion: HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    objectionEventId: request.objection.sourceEventId,
    responseId: request.interruption.interruptedResponseId,
    questionEventBinding: {
      turnId: request.question.turnId,
      sourceEventId: request.question.eventId,
    },
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId: providerRequestId,
      promptVersion: trace.promptVersion,
      schemaVersion: trace.outputSchemaVersion,
      latencyMs: trace.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: null,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace,
  });
}

function generatedWitnessAnswer(preparation: HearingCommandPreparation) {
  if (preparation.status !== "model_required") {
    throw new Error("Expected a resumed witness request");
  }
  const request = WitnessAnswerRequestSchema.parse(preparation.request);
  const fact = request.knowledgeView.witness.facts[0];
  if (fact === undefined) throw new Error("Expected witness-scoped grounding");
  const output = WitnessAnswerModelOutputSchema.parse({
    schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    disposition: "substantive",
    performance: {
      emotion: "confident",
      intensity: 0.55,
      delivery: "measured",
      gesture: "small_nod",
      gazeTarget: "questioning_counsel",
    },
    segments: [
      {
        text: "I personally observed the fictional event in my statement.",
        factIds: [fact.factId],
        evidenceIds: [],
        priorStatementIds: [],
      },
    ],
  });
  const startedAt = "2026-07-19T05:20:00.000Z";
  const completedAt = "2026-07-19T05:20:00.250Z";
  const outputHash = hashWitnessAnswerModelOutput(output);
  const acceptedCitations = witnessAnswerOutputCitations(output);
  const outputCharacterCount = JSON.stringify(output).length;
  const sourceSegmentCount = new Set([
    ...request.knowledgeView.publicRecord.facts.flatMap(
      ({ sourceSegmentIds }) => sourceSegmentIds,
    ),
    ...request.knowledgeView.publicRecord.evidence.flatMap(
      ({ sourceSegmentIds }) => sourceSegmentIds,
    ),
  ]).size;
  const usage = {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    cachedInputTokens: 40,
    cacheWriteTokens: 0,
    reasoningTokens: 5,
  };
  const trace = CourtroomModelCallTraceSchema.parse({
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: request.callId,
    trialId: request.trialId,
    responseId: request.responseId,
    actorId: request.actorId,
    actorRole: "witness",
    callClass: "role_responder",
    task: "witness_answer",
    inputEventIds: [
      ...new Set([request.question.eventId, request.expectedLastEventId]),
    ].sort((left, right) => left.localeCompare(right)),
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    provider: "scripted-courtroom-model",
    model: "gpt-5.6-luna",
    providerProtocolVersion: "courtroom-model-provider.v1",
    promptVersion: "role-responder.witness-answer.prompt.v1",
    outputSchemaVersion: output.schemaVersion,
    knowledgeScope: {
      knowledgeSchemaVersion: request.knowledgeView.schemaVersion,
      knowledgeViewHash: sha256Utf8(JSON.stringify(request.knowledgeView)),
      stateVersion: request.knowledgeView.stateVersion,
      factCount: request.knowledgeView.witness.facts.length,
      evidenceCount: new Set([
        ...request.knowledgeView.witness.admittedSeenEvidence.map(
          ({ evidenceId }) => evidenceId,
        ),
        ...request.knowledgeView.presentedEvidence.map(
          ({ evidenceId }) => evidenceId,
        ),
      ]).size,
      testimonyCount: request.knowledgeView.publicRecord.testimony.length,
      priorStatementCount:
        request.knowledgeView.witness.priorStatements.length,
      sourceSegmentCount,
      publicRecordEventCount: new Set(
        request.knowledgeView.publicRecord.testimony.map(
          ({ transcriptEventId }) => transcriptEventId,
        ),
      ).size,
      currentExchangeCount:
        request.knowledgeView.currentExchange === null ? 0 : 1,
    },
    promptAudit: {
      stablePrefixHash: sha256Utf8("fake-witness-stable-prefix"),
      trustedContextHash: sha256Utf8("fake-witness-trusted-context"),
      untrustedInputHash: sha256Utf8("fake-witness-untrusted-input"),
      inputCharacterCount: 60,
    },
    status: "accepted",
    startedAt,
    completedAt,
    latencyMs: 250,
    firstStructuredDeltaMs: 25,
    firstAcceptedSegmentMs: 50,
    retryCount: 0,
    validationFailureCount: 0,
    estimatedCostUsd: null,
    usage,
    acceptedAttempt: 1,
    acceptedCitations,
    acceptedCitationCount: Object.values(acceptedCitations).reduce(
      (total, identifiers) => total + identifiers.length,
      0,
    ),
    outputHash,
    outputCharacterCount,
    committedActionId: null,
    committedEventId: null,
    safeFailureCode: null,
    attempts: [
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 1,
        mode: "initial",
        status: "accepted",
        providerRequestId: "request:final-bound-witness:001",
        providerResponseId: "response:final-bound-witness:001",
        startedAt,
        completedAt,
        latencyMs: 250,
        firstStructuredDeltaMs: 25,
        streamEventCount: 3,
        structuredDeltaCount: 1,
        streamedCharacterCount: outputCharacterCount,
        outputHash,
        proposedCitationCount: output.segments.reduce(
          (total, segment) =>
            total +
            segment.factIds.length +
            segment.evidenceIds.length +
            segment.priorStatementIds.length,
          0,
        ),
        usage,
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  });
  return HearingWitnessGenerationPrecommitSchema.parse({
    schemaVersion: HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    responseId: request.responseId,
    output,
    modelMetadata: {
      model: trace.model,
      requestId: "request:final-bound-witness:001",
      promptVersion: trace.promptVersion,
      schemaVersion: trace.outputSchemaVersion,
      latencyMs: trace.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: null,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace,
  });
}

describe("final-bound interruption persistence", () => {
  it("atomically commits the canonical four-event prefix and exact replay is a no-op", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const request = interruptionRequest(view);
    const before = await storedEvents(backend, view.trial.trialId);

    const first = await prepareFinalBound(backend, request);
    expect(first).toMatchObject({
      phase: "ruling_required",
      outcome: null,
      outcomeReplayed: false,
      interrupt: { prefixReplayed: false, ground: "leading" },
      preparation: { status: "model_required" },
    });
    if (first.preparation.status !== "model_required") {
      throw new Error("Expected a judge ruling request");
    }
    expect(
      ObjectionRulingRequestSchema.parse(first.preparation.request)
        .permittedOutcomes,
    ).toEqual([
      { ruling: "sustained", remedy: "rephrase" },
      { ruling: "overruled", remedy: "resume_response" },
    ]);
    const ids = deriveFinalBoundInterruptionPersistenceIds(request);
    const after = await storedEvents(backend, view.trial.trialId);
    const prefix = after.slice(before.length);
    expect(prefix).toHaveLength(4);
    expect(prefix.map((event) => event.eventType)).toEqual([
      "ASK_QUESTION",
      "REQUEST_RESPONSE",
      "OBJECT",
      "BEGIN_INTERRUPTION",
    ]);
    expect(prefix.map((event) => event.source)).toEqual([
      "speech",
      "system",
      "deterministic",
      "system",
    ]);
    expect(prefix.map((event) => event.stateVersion)).toEqual([
      request.head.stateVersion + 1,
      request.head.stateVersion + 2,
      request.head.stateVersion + 3,
      request.head.stateVersion + 4,
    ]);
    expect(prefix.map((event) => event.actionId)).toEqual([
      ids.questionActionId,
      ids.requestResponseActionId,
      ids.objectionActionId,
      ids.beginInterruptionActionId,
    ]);
    expect(prefix.map((event) => event.causationId ?? null)).toEqual([
      request.head.lastEventId,
      `event:${ids.questionActionId}`,
      `event:${ids.requestResponseActionId}`,
      `event:${ids.objectionActionId}`,
    ]);
    expect(prefix.some((event) => event.eventType === "ANSWER_QUESTION")).toBe(
      false,
    );

    const replay = await prepareFinalBound(backend, request);
    expect(replay).toMatchObject({
      phase: "ruling_required",
      outcome: null,
      outcomeReplayed: false,
      interrupt: {
        prefixReplayed: true,
        interruptId: first.interrupt.interruptId,
      },
    });
    expect(await storedEvents(backend, view.trial.trialId)).toHaveLength(
      after.length,
    );
  });

  it("serializes concurrent exact preparations without duplicate events", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const request = interruptionRequest(view, "concurrent");
    const before = await storedEvents(backend, view.trial.trialId);
    const results = await Promise.all([
      prepareFinalBound(backend, request),
      prepareFinalBound(backend, request),
    ]);
    expect(results.every((result) => result.phase === "ruling_required")).toBe(
      true,
    );
    expect(results.map((result) => result.interrupt.prefixReplayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(new Set(results.map((result) => result.interrupt.interruptId))).toEqual(
      new Set([results[0]?.interrupt.interruptId]),
    );
    const after = await storedEvents(backend, view.trial.trialId);
    expect(after).toHaveLength(before.length + 4);
  });

  it("rejects wrong ownership, stale authority, and browser-forged fields", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const request = interruptionRequest(view, "authority");
    await expect(prepareFinalBound(backend, request, OTHER_OWNER_ID)).rejects.toThrow();

    await prepareFinalBound(backend, request);
    const changed = interruptionRequest(
      view,
      "changed",
      "You personally approved the shipment, correct?",
    );
    await expect(prepareFinalBound(backend, changed)).rejects.toThrow(
      "FINAL_BOUND_INTERRUPTION_STALE",
    );
    await expect(
      backend.action(prepareFinalBoundReference, {
        ownerId: OWNER_ID,
        trialId: request.head.trialId,
        requestJson: JSON.stringify({
          ...request,
          actorId: "actor:forged",
          ground: "leading",
        }),
      }),
    ).rejects.toThrow();
  });

  it("returns an exact replayable no-write withdrawal when the final transcript drops the signal", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const request = FinalBoundInterruptionRequestSchema.parse({
      ...interruptionRequest(view, "mismatch"),
      trigger: {
        revision: 4,
        text: "You signed the delivery report, correct?",
        confidence: 0.99,
      },
      final: { revision: 5, text: "Thank you, no further questions." },
    });
    const before = await storedEvents(backend, view.trial.trialId);
    const receiptsBefore = await backend.run(
      async (ctx) => (await ctx.db.query("actionReceipts").collect()).length,
    );
    const first = await prepareFinalBoundResult(backend, request);
    expect(first).toMatchObject({
      phase: "candidate_withdrawn",
      reason: "final_transcript_withdrew_candidate",
      sourceHead: request.head,
      triggerRevision: request.trigger.revision,
      finalRevision: request.final.revision,
      interrupt: null,
      outcome: null,
      preparation: { status: "completed" },
    });
    const replay = await prepareFinalBoundResult(backend, request);
    expect(replay).toEqual(first);
    expect(await storedEvents(backend, view.trial.trialId)).toHaveLength(
      before.length,
    );
    expect(
      await backend.run(
        async (ctx) => (await ctx.db.query("actionReceipts").collect()).length,
      ),
    ).toBe(receiptsBefore);
    expect((await trialState(backend, view.trial.trialId)).version).toBe(
      view.trial.version,
    );
  });

  it("rolls back the first three events when the fourth stable action conflicts", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const request = interruptionRequest(view, "rollback");
    const ids = deriveFinalBoundInterruptionPersistenceIds(request);
    await backend.run(async (ctx) => {
      await ctx.db.insert("actionReceipts", {
        receiptId: `receipt:${ids.beginInterruptionActionId}`,
        actionId: ids.beginInterruptionActionId,
        trialId: request.head.trialId,
        status: "committed",
        expectedStateVersion: request.head.stateVersion + 99,
        committedStateVersion: request.head.stateVersion + 100,
        firstSequence: 999,
        lastSequence: 999,
        eventIds: ["event:conflicting-fourth-action"],
        requestHash: "conflicting-request-hash",
        resultJson: "{}",
        schemaVersion: "trial-action-receipt.v1",
        createdAt: Date.now(),
      });
    });
    const before = await storedEvents(backend, view.trial.trialId);
    await expect(prepareFinalBound(backend, request)).rejects.toThrow(
      "FINAL_BOUND_INTERRUPTION_CONFLICT",
    );
    expect(await storedEvents(backend, view.trial.trialId)).toHaveLength(
      before.length,
    );
    expect((await trialState(backend, view.trial.trialId)).version).toBe(
      view.trial.version,
    );
  });

  it("replays a stored overruled outcome only into its exact resumed witness response", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const request = interruptionRequest(view, "overruled");
    const pending = await prepareFinalBound(backend, request);
    await commitRuling(backend, pending, "overruled");

    const replay = await prepareFinalBound(backend, request);
    expect(replay).toMatchObject({
      phase: "ruling_committed",
      outcome: { ruling: "overruled", remedy: "resume_response" },
      outcomeReplayed: true,
      interrupt: { prefixReplayed: true },
      preparation: { status: "model_required" },
    });
    if (replay.preparation.status !== "model_required") {
      throw new Error("Expected exact resumed witness response");
    }
    expect(replay.preparation.request).toMatchObject({
      responseId: pending.interrupt.responseId,
      question: {
        questionId: pending.interrupt.questionId,
        eventId: pending.interrupt.questionEventId,
      },
    });
  });

  it("an old sustained retry returns completed state instead of a newer objection model request", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const oldRequest = interruptionRequest(view, "old");
    const oldPending = await prepareFinalBound(backend, oldRequest);
    await commitRuling(backend, oldPending, "sustained");

    const current = await trialState(backend, view.trial.trialId);
    const currentView = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
      }),
    );
    expect(currentView.trial.version).toBe(current.version);
    const newerRequest = interruptionRequest(currentView, "newer");
    const newer = await prepareFinalBound(backend, newerRequest);
    expect(newer.phase).toBe("ruling_required");

    const replay = await prepareFinalBound(backend, oldRequest);
    expect(replay).toMatchObject({
      phase: "ruling_committed",
      outcome: { ruling: "sustained", remedy: "cancel_response" },
      preparation: { status: "completed" },
    });
    if (replay.preparation.status !== "completed") {
      throw new Error("Old sustained retry surfaced an unrelated model request");
    }
    expect(
      (await trialState(backend, view.trial.trialId)).activeInterruption,
    ).toMatchObject({
      interruptId: newer.interrupt.interruptId,
      status: "active",
    });
  });

  it("recovers an aborted canonical prefix without private transcript identity or duplicate writes", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    await expect(
      resumeFinalBound(backend, view.trial.trialId),
    ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_INVALID");

    const pending = await prepareFinalBound(
      backend,
      interruptionRequest(view, "reload"),
    );
    const eventCount = (await storedEvents(backend, view.trial.trialId)).length;
    const recovered = await resumeFinalBound(
      backend,
      view.trial.trialId,
    );
    expect(recovered).toMatchObject({
      phase: "ruling_required",
      outcome: null,
      interrupt: {
        interruptId: pending.interrupt.interruptId,
        objectionId: pending.interrupt.objectionId,
        responseId: pending.interrupt.responseId,
        answerTurnId: null,
        targetCompletionHead: pending.interrupt.committedHead,
      },
      preparation: { status: "model_required" },
    });
    const exact = await resumeFinalBound(
      backend,
      view.trial.trialId,
      pending.interrupt.interruptId,
    );
    expect(exact).toMatchObject({
      phase: "ruling_required",
      interrupt: recovered.interrupt,
      outcome: null,
      preparation: { status: "model_required" },
    });
    if (
      exact.preparation.status !== "model_required" ||
      recovered.preparation.status !== "model_required"
    ) {
      throw new Error("Expected exact recovered ruling preparations");
    }
    const recoveredRuling = ObjectionRulingRequestSchema.parse(
      recovered.preparation.request,
    );
    expect(ObjectionRulingRequestSchema.parse(exact.preparation.request)).toMatchObject({
      decisionId: recoveredRuling.decisionId,
      objection: recoveredRuling.objection,
      interruption: recoveredRuling.interruption,
    });
    expect(await storedEvents(backend, view.trial.trialId)).toHaveLength(
      eventCount,
    );
    await expect(
      resumeFinalBound(
        backend,
        view.trial.trialId,
        "interrupt:final-bound:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ),
    ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_STALE");
    await expect(
      resumeFinalBound(
        backend,
        view.trial.trialId,
        pending.interrupt.interruptId,
        OTHER_OWNER_ID,
      ),
    ).rejects.toThrow();
  });

  it("rejects a malformed current interruption that lacks the durable final-bound chain", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    await prepareFinalBound(backend, interruptionRequest(view, "malformed"));
    await backend.run(async (ctx) => {
      const projection = await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", view.trial.trialId),
        )
        .unique();
      if (projection === null) throw new Error("Missing projection");
      const state = TrialStateV3Schema.parse(JSON.parse(projection.stateJson));
      if (state.activeInterruption === null) {
        throw new Error("Missing active interruption");
      }
      await ctx.db.patch(projection._id, {
        stateJson: JSON.stringify({
          ...state,
          activeInterruption: {
            ...state.activeInterruption,
            interruptId: "interrupt:ordinary-objection",
          },
        }),
      });
    });
    await expect(
      resumeFinalBound(backend, view.trial.trialId),
    ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_INVALID");
  });

  it("recovers sustained and overruled outcomes without requiring another judge call", async () => {
    const sustainedBackend = convexTest({ schema, modules });
    const sustainedView = await prepareDirectExamination(sustainedBackend);
    const sustainedPending = await prepareFinalBound(
      sustainedBackend,
      interruptionRequest(sustainedView, "recover-sustained"),
    );
    await commitRuling(sustainedBackend, sustainedPending, "sustained");
    const sustained = await resumeFinalBound(
      sustainedBackend,
      sustainedView.trial.trialId,
    );
    expect(sustained).toMatchObject({
      phase: "ruling_committed",
      outcome: { ruling: "sustained", remedy: "cancel_response" },
      preparation: { status: "completed" },
      interrupt: { answerTurnId: null },
    });

    const overruledBackend = convexTest({ schema, modules });
    const overruledView = await prepareDirectExamination(overruledBackend);
    const overruledPending = await prepareFinalBound(
      overruledBackend,
      interruptionRequest(overruledView, "recover-overruled"),
    );
    await commitRuling(overruledBackend, overruledPending, "overruled");
    const witnessPending = await resumeFinalBound(
      overruledBackend,
      overruledView.trial.trialId,
    );
    expect(witnessPending).toMatchObject({
      phase: "ruling_committed",
      outcome: { ruling: "overruled", remedy: "resume_response" },
      preparation: {
        status: "model_required",
        request: { responseId: overruledPending.interrupt.responseId },
      },
      interrupt: { answerTurnId: null },
    });
    const answer = await commitRecoveredAnswer(
      overruledBackend,
      overruledPending,
    );
    const completed = await resumeFinalBound(
      overruledBackend,
      overruledView.trial.trialId,
    );
    expect(completed).toMatchObject({
      phase: "ruling_committed",
      outcome: { ruling: "overruled", remedy: "resume_response" },
      preparation: { status: "completed" },
      interrupt: {
        answerTurnId: answer.turnId,
        targetCompletionHead: { lastEventId: answer.eventId },
      },
    });
  });

  it("promotes an outstanding sustained rephrase and exact chained retries without duplicate questions", async () => {
    const backend = convexTest({ schema, modules });
    const initialView = await prepareDirectExamination(backend);
    const first = await prepareFinalBound(
      backend,
      interruptionRequest(initialView, "rephrase-first"),
    );
    await commitRuling(backend, first, "sustained", "rephrase");

    const secondView = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: initialView.trial.trialId,
      }),
    );
    const secondRequest = interruptionRequest(
      secondView,
      "rephrase-second",
      "You approved that delivery report, correct?",
    );
    const beforeSecond = await storedEvents(backend, initialView.trial.trialId);
    const second = await prepareFinalBound(backend, secondRequest);
    const afterSecond = await storedEvents(backend, initialView.trial.trialId);
    const secondQuestion = afterSecond[beforeSecond.length];
    expect(secondQuestion).toMatchObject({ eventType: "REPHRASE_QUESTION" });
    expect(JSON.parse(secondQuestion?.payloadJson ?? "null")).toMatchObject({
      originalQuestionId: first.interrupt.questionId,
      questionId: second.interrupt.questionId,
      text: secondRequest.final.text,
    });
    await prepareFinalBound(backend, secondRequest);
    expect(await storedEvents(backend, initialView.trial.trialId)).toHaveLength(
      afterSecond.length,
    );

    await commitRuling(backend, second, "sustained", "rephrase");
    const thirdView = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: initialView.trial.trialId,
      }),
    );
    const third = await prepareFinalBound(
      backend,
      interruptionRequest(
        thirdView,
        "rephrase-third",
        "You reviewed and approved that report, correct?",
      ),
    );
    const events = await storedEvents(backend, initialView.trial.trialId);
    const thirdQuestion = events.find(
      (event) => event.eventId === third.interrupt.questionEventId,
    );
    expect(thirdQuestion).toMatchObject({ eventType: "REPHRASE_QUESTION" });
    expect(JSON.parse(thirdQuestion?.payloadJson ?? "null")).toMatchObject({
      originalQuestionId: second.interrupt.questionId,
      questionId: third.interrupt.questionId,
    });
  });

  it("single-flights concurrent judge claims, renews safely, and permits one expired or released takeover", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-19T05:00:00.000Z"));
      const backend = convexTest({ schema, modules });
      const view = await prepareDirectExamination(backend);
      const pending = await prepareFinalBound(
        backend,
        interruptionRequest(view, "lease"),
      );
      const claims = await Promise.all(
        Array.from({ length: 5 }, async () =>
          await claimFinalBound(
            backend,
            view.trial.trialId,
            pending.interrupt.interruptId,
          ),
        ),
      );
      const owners = claims.filter(
        (claim): claim is Extract<
          HearingFinalBoundInterruptionClaimResult,
          { status: "claimed" }
        > => claim.status === "claimed",
      );
      expect(owners).toHaveLength(1);
      expect(claims.filter((claim) => claim.status === "wait")).toHaveLength(4);
      const owner = owners[0];
      if (owner === undefined) throw new Error("Missing lease owner");
      const credential = leaseCredential(owner);
      const originalExpiry = owner.leaseExpiresAt;

      vi.setSystemTime(new Date("2026-07-19T05:00:20.000Z"));
      const renewed = await updateLease(
        backend,
        "renew",
        view.trial.trialId,
        credential,
      );
      expect(renewed).toMatchObject({
        status: "renewed",
        leaseExpiresAt: expect.any(Number),
      });
      if (renewed.status !== "renewed") throw new Error("Expected renewal");
      expect(renewed.leaseExpiresAt).toBeGreaterThan(originalExpiry);

      vi.setSystemTime(new Date(originalExpiry + 1_000));
      expect(
        await claimFinalBound(
          backend,
          view.trial.trialId,
          pending.interrupt.interruptId,
        ),
      ).toMatchObject({ status: "wait", leaseGeneration: 1 });

      const staleCredential = {
        ...credential,
        leaseToken: `${credential.leaseToken.slice(0, -1)}${
          credential.leaseToken.endsWith("a") ? "b" : "a"
        }`,
      };
      await expect(
        updateLease(
          backend,
          "renew",
          view.trial.trialId,
          staleCredential,
        ),
      ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_CLAIM_STALE");
      await expect(
        backend.mutation(authorizeClaimCommitReference, {
          ownerId: OWNER_ID,
          trialId: view.trial.trialId,
          interruptId: credential.interruptId,
          decisionId: credential.decisionId,
          leaseGeneration: credential.leaseGeneration,
          leaseTokenHash: sha256Utf8(staleCredential.leaseToken),
          now: Date.now(),
        }),
      ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_CLAIM_STALE");

      expect(
        await updateLease(
          backend,
          "release",
          view.trial.trialId,
          credential,
        ),
      ).toEqual({ status: "released" });
      const takeover = await claimFinalBound(
        backend,
        view.trial.trialId,
        pending.interrupt.interruptId,
      );
      expect(takeover).toMatchObject({
        status: "claimed",
        leaseGeneration: 2,
      });
      if (takeover.status !== "claimed") {
        throw new Error("Expected released-lease takeover");
      }
      await expect(
        updateLease(
          backend,
          "release",
          view.trial.trialId,
          credential,
        ),
      ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_CLAIM_STALE");

      vi.setSystemTime(new Date(takeover.leaseExpiresAt + 1));
      const expiredClaims = await Promise.all(
        Array.from({ length: 3 }, async () =>
          await claimFinalBound(
            backend,
            view.trial.trialId,
            pending.interrupt.interruptId,
          ),
        ),
      );
      expect(
        expiredClaims.filter((claim) => claim.status === "claimed"),
      ).toHaveLength(1);
      expect(
        expiredClaims.find((claim) => claim.status === "claimed"),
      ).toMatchObject({ leaseGeneration: 3 });
      const thirdOwner = expiredClaims.find(
        (claim): claim is Extract<
          HearingFinalBoundInterruptionClaimResult,
          { status: "claimed" }
        > => claim.status === "claimed",
      );
      if (thirdOwner === undefined) throw new Error("Missing third owner");
      expect(
        await updateLease(
          backend,
          "release",
          view.trial.trialId,
          leaseCredential(thirdOwner),
        ),
      ).toEqual({ status: "released" });
      expect(
        await claimFinalBound(
          backend,
          view.trial.trialId,
          pending.interrupt.interruptId,
        ),
      ).toMatchObject({ status: "claimed", leaseGeneration: 4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a stale credential inside the atomic ruling append after takeover", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const pending = await prepareFinalBound(
      backend,
      interruptionRequest(view, "append-race"),
    );
    const first = await claimFinalBound(
      backend,
      view.trial.trialId,
      pending.interrupt.interruptId,
    );
    if (first.status !== "claimed") throw new Error("Missing first owner");
    const staleCredential = leaseCredential(first);
    await updateLease(
      backend,
      "release",
      view.trial.trialId,
      staleCredential,
    );
    const takeover = await claimFinalBound(
      backend,
      view.trial.trialId,
      pending.interrupt.interruptId,
    );
    if (takeover.status !== "claimed") throw new Error("Missing takeover");
    const generation = await generatedSustainedRuling(pending.preparation);
    const before = await storedEvents(backend, view.trial.trialId);

    await expect(
      backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_CLAIM_REQUIRED");
    expect(await storedEvents(backend, view.trial.trialId)).toHaveLength(
      before.length,
    );
    await expect(
      backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(generation),
        claimCredentialJson: JSON.stringify(staleCredential),
      }),
    ).rejects.toThrow("OBJECTION_RULING_GENERATION_STALE");
    expect(await storedEvents(backend, view.trial.trialId)).toHaveLength(
      before.length,
    );
    expect((await trialState(backend, view.trial.trialId)).objections[
      pending.interrupt.objectionId
    ]).toMatchObject({ status: "pending" });
  });

  it("returns the durable outcome to an expired credential on renew and release", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-19T05:30:00.000Z"));
      const backend = convexTest({ schema, modules });
      const view = await prepareDirectExamination(backend);
      const pending = await prepareFinalBound(
        backend,
        interruptionRequest(view, "expired-outcome"),
      );
      const owner = await claimFinalBound(
        backend,
        view.trial.trialId,
        pending.interrupt.interruptId,
      );
      if (owner.status !== "claimed") throw new Error("Missing lease owner");
      const credential = leaseCredential(owner);
      await commitRuling(backend, pending, "sustained", "rephrase");
      vi.setSystemTime(new Date(owner.leaseExpiresAt + 1));

      for (const operation of ["renew", "release"] as const) {
        expect(
          await updateLease(
            backend,
            operation,
            view.trial.trialId,
            credential,
          ),
        ).toMatchObject({
          status: "outcome",
          recovery: {
            outcome: { ruling: "sustained", remedy: "rephrase" },
            preparation: { status: "completed" },
          },
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the lease through an overruled witness, then gives one failed-owner takeover and lets durable completion win", async () => {
    const backend = convexTest({ schema, modules });
    const view = await prepareDirectExamination(backend);
    const pending = await prepareFinalBound(
      backend,
      interruptionRequest(view, "witness-lease"),
    );
    const judgeOwner = await claimFinalBound(
      backend,
      view.trial.trialId,
      pending.interrupt.interruptId,
    );
    if (judgeOwner.status !== "claimed") {
      throw new Error("Expected the judge provider owner");
    }
    const judgeCredential = leaseCredential(judgeOwner);
    await commitRuling(backend, pending, "overruled");

    const waitingWitnesses = await Promise.all(
      Array.from({ length: 4 }, async () =>
        await claimFinalBound(
          backend,
          view.trial.trialId,
          pending.interrupt.interruptId,
        ),
      ),
    );
    expect(
      waitingWitnesses.every((claim) => claim.status === "wait"),
    ).toBe(true);
    expect(
      await updateLease(
        backend,
        "release",
        view.trial.trialId,
        judgeCredential,
      ),
    ).toEqual({ status: "released" });

    const takeoverClaims = await Promise.all(
      Array.from({ length: 4 }, async () =>
        await claimFinalBound(
          backend,
          view.trial.trialId,
          pending.interrupt.interruptId,
        ),
      ),
    );
    const witnessOwners = takeoverClaims.filter(
      (claim): claim is Extract<
        HearingFinalBoundInterruptionClaimResult,
        { status: "claimed" }
      > => claim.status === "claimed",
    );
    expect(witnessOwners).toHaveLength(1);
    expect(witnessOwners[0]).toMatchObject({
      leaseGeneration: 2,
      recovery: {
        phase: "ruling_committed",
        preparation: {
          status: "model_required",
          request: { responseId: pending.interrupt.responseId },
        },
      },
    });

    const witnessOwner = witnessOwners[0];
    if (witnessOwner === undefined) throw new Error("Missing witness owner");
    const witnessGeneration = generatedWitnessAnswer(
      witnessOwner.recovery.preparation,
    );
    const beforeAnswer = await storedEvents(backend, view.trial.trialId);
    await expect(
      backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(witnessGeneration),
      }),
    ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_CLAIM_REQUIRED");
    expect(await storedEvents(backend, view.trial.trialId)).toHaveLength(
      beforeAnswer.length,
    );
    await backend.action(commitWitnessGenerationReference, {
      ownerId: OWNER_ID,
      trialId: view.trial.trialId,
      generationJson: JSON.stringify(witnessGeneration),
      claimCredentialJson: JSON.stringify(leaseCredential(witnessOwner)),
    });
    await expect(
      backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(witnessGeneration),
        claimCredentialJson: JSON.stringify(judgeCredential),
      }),
    ).rejects.toThrow("FINAL_BOUND_INTERRUPTION_CLAIM_STALE");
    expect(
      await updateLease(
        backend,
        "renew",
        view.trial.trialId,
        judgeCredential,
      ),
    ).toMatchObject({
      status: "outcome",
      recovery: { preparation: { status: "completed" } },
    });
    expect(
      await updateLease(
        backend,
        "release",
        view.trial.trialId,
        judgeCredential,
      ),
    ).toMatchObject({
      status: "outcome",
      recovery: { preparation: { status: "completed" } },
    });
    const durable = await claimFinalBound(
      backend,
      view.trial.trialId,
      pending.interrupt.interruptId,
    );
    expect(durable).toMatchObject({
      status: "outcome",
      recovery: {
        phase: "ruling_committed",
        outcome: { ruling: "overruled", remedy: "resume_response" },
        preparation: { status: "completed" },
        interrupt: {
          answerTurnId: expect.stringMatching(/^turn:answer:/u),
          targetCompletionHead: {
            lastEventId: expect.stringMatching(/^event:action:witness-answer:/u),
          },
        },
      },
    });
  });
});
