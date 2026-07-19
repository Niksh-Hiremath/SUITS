import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
  sha256Utf8,
} from "../src/domain/case-graph";
import {
  COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DebriefGeneratorModelOutputSchema,
  JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JudgeRoleResponseModelOutputSchema,
  JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JuryRoleResponseModelOutputSchema,
  NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
  NegotiationAgentModelOutputSchema,
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  ObjectionRulingModelOutputSchema,
  CounselRoleResponseModelOutputSchema,
  CourtroomModelCallTraceSchema,
  OpponentPlannerModelOutputSchema,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WitnessAnswerModelOutputSchema,
  type CounselResponseRequest,
  type DebriefCitationSet,
  type DebriefGeneratorRequest,
  type JudgeResponseRequest,
  type JuryRoleResponseModelOutput,
  type JuryResponseRequest,
  type NegotiationAgentRequest,
  type ObjectionRulingRequest,
  type OpponentPlannerRequest,
} from "../src/domain/courtroom-ai";
import {
  HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
  HEARING_JUDGE_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HearingCounselResponsePrecommitSchema,
  HearingCommandPreparationSchema,
  HearingDebriefGeneratorPrecommitSchema,
  HearingJudgeResponsePrecommitSchema,
  HearingJuryResponsePrecommitSchema,
  HearingNegotiationPrecommitSchema,
  HearingObjectionRulingPrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  counselResponseOutputCitations,
  debriefGeneratorOutputCitations,
  hashCounselResponseModelOutput,
  hashDebriefGeneratorModelOutput,
  hashJudgeResponseModelOutput,
  hashJuryResponseModelOutput,
  hashOpponentPlannerModelOutput,
  hashWitnessAnswerModelOutput,
  isHearingCounselResponseModelRequiredPreparation,
  isHearingDebriefGeneratorModelRequiredPreparation,
  isHearingJudgeResponseModelRequiredPreparation,
  isHearingJuryResponseModelRequiredPreparation,
  isHearingNegotiationModelRequiredPreparation,
  isHearingObjectionRulingModelRequiredPreparation,
  isHearingOpponentPlanModelRequiredPreparation,
  isHearingWitnessModelRequiredPreparation,
  juryResponseOutputCitations,
  judgeResponseOutputCitations,
  hashNegotiationAgentModelOutput,
  hashObjectionRulingModelOutput,
  negotiationAgentOutputCitations,
  negotiationAgentProposedCitationCount,
  objectionRulingOutputCitations,
  opponentPlannerOutputCitations,
  witnessAnswerOutputCitations,
  type HearingCounselResponsePrecommit,
  type HearingCommandPreparation,
  type HearingDebriefGeneratorPrecommit,
  type HearingJudgeResponsePrecommit,
  type HearingJuryResponsePrecommit,
  type HearingNegotiationPrecommit,
  type HearingObjectionRulingPrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingPlayerIntent,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionV3Schema,
  TrialStateV3Schema,
} from "../src/domain/trial-engine";
import { derivePublishedGraphId } from "./caseServiceBoundary";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./hearingRuntime.ts": () => import("./hearingRuntime"),
  "./courtroomModelCalls.ts": () => import("./courtroomModelCalls"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

type TestBackend = TestConvex<typeof schema>;

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";
const START_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const startReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; requestJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:start");
const commandReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; commandJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:command");
const prepareCommandReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; commandJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:prepareCommand");
const prepareContinuationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string }>,
  HearingCommandPreparation
>("hearingRuntime:prepareContinuation");
const commitWitnessGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:commitWitnessGeneration");
const commitOpponentPlanGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:commitOpponentPlanGeneration");
const commitCounselGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:commitCounselGeneration");
const commitJudgeGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:commitJudgeGeneration");
const commitObjectionRulingGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:commitObjectionRulingGeneration");
const commitNegotiationGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:commitNegotiationGeneration");
const commitJuryGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:commitJuryGeneration");
const commitDebriefGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:commitDebriefGeneration");
const recordTerminalModelCallReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; traceJson: string }>,
  Readonly<{ callId: string; attemptCount: number; replayed: boolean }>
>("courtroomModelCalls:recordTerminalForOwner");
const readReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:read");
const appendPlayerForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; actionJson: string }>,
  Readonly<{ committedStateVersion: number; replayed: boolean }>
>("trialEvents:appendPlayerForOwner");
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
    requestId: START_REQUEST_ID,
    requestedAt: "2026-07-19T03:00:00.000Z",
    case: { kind: "seeded", slug: "redwood-signal-retaliation" },
    userSide: "user",
  } as const;
}

function playerCommand(
  view: HearingRuntimeViewV1,
  requestId: string,
  requestedAt: string,
  intent: HearingPlayerIntent,
) {
  return {
    schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
    requestId,
    requestedAt,
    expectedStateVersion: view.trial.version,
    expectedLastEventId: view.trial.lastEventId,
    intent,
  } as const;
}

function stableTestRuntimeId(prefix: string, material: unknown): string {
  return `${prefix}:${sha256Utf8(JSON.stringify(material))}`;
}

function stableTestRequestId(material: unknown): string {
  const digest = sha256Utf8(JSON.stringify(material));
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function continueOpposingResponse(
  backend: TestBackend,
  preparation: HearingCommandPreparation,
  requestedAt: string,
): Promise<HearingCommandPreparation> {
  if (
    preparation.status !== "completed" ||
    !preparation.view.capabilities.canContinueResponse
  ) {
    throw new Error("Expected an opposing-response decision window");
  }
  const responseId = preparation.view.activeQuestion?.pendingResponseId;
  if (!responseId) {
    throw new Error("Expected a projected pending response ID");
  }
  const request = playerCommand(
    preparation.view,
    stableTestRequestId({
      trialId: preparation.view.trial.trialId,
      responseId,
      requestedAt,
    }),
    requestedAt,
    { type: "continue_response", responseId },
  );
  return HearingCommandPreparationSchema.parse(
    await backend.action(prepareCommandReference, {
      ownerId: OWNER_ID,
      trialId: preparation.view.trial.trialId,
      commandJson: JSON.stringify(request),
    }),
  );
}

async function start(backend: TestBackend) {
  return HearingRuntimeViewV1Schema.parse(
    await backend.action(startReference, {
      ownerId: OWNER_ID,
      requestJson: JSON.stringify(startRequest()),
    }),
  );
}

async function command(
  backend: TestBackend,
  view: HearingRuntimeViewV1,
  requestId: string,
  requestedAt: string,
  intent: HearingPlayerIntent,
  juryRecommendation?: JuryRoleResponseModelOutput["recommendation"],
) {
  const request = playerCommand(view, requestId, requestedAt, intent);
  const preparation = HearingCommandPreparationSchema.parse(
    await backend.action(prepareCommandReference, {
      ownerId: OWNER_ID,
      trialId: view.trial.trialId,
      commandJson: JSON.stringify(request),
    }),
  );
  let current = preparation;
  for (let step = 0; current.status === "model_required"; step += 1) {
    if (step >= 12) throw new Error("Fixture model loop exceeded 12 steps");
    current = await commitModelPreparation(
      backend,
      current,
      new Date(Date.parse(requestedAt) + 2_000 + step * 1_000).toISOString(),
      "end",
      juryRecommendation,
    );
  }
  const committedView = current.view;
  return {
    request,
    view: committedView,
  };
}

async function prepare(
  backend: TestBackend,
  view: HearingRuntimeViewV1,
  requestId: string,
  requestedAt: string,
  intent: HearingPlayerIntent,
) {
  const request = playerCommand(view, requestId, requestedAt, intent);
  return {
    request,
    preparation: HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(request),
      }),
    ),
  };
}

async function fakeWitnessGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
): Promise<HearingWitnessGenerationPrecommit> {
  if (!isHearingWitnessModelRequiredPreparation(preparation)) {
    throw new Error("Expected witness model preparation");
  }
  const fact = preparation.request.knowledgeView.witness.facts[0];
  if (!fact)
    throw new Error("Fixture witness requires at least one known fact");
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
        text: "I personally observed the event described in my statement.",
        factIds: [fact.factId],
        evidenceIds: [],
        priorStatementIds: [],
      },
    ],
  });
  const request = preparation.request;
  const completedAt = new Date(Date.parse(startedAt) + 250).toISOString();
  const outputHash = hashWitnessAnswerModelOutput(output);
  const acceptedCitations = witnessAnswerOutputCitations(output);
  const outputCharacterCount = JSON.stringify(output).length;
  const proposedCitationCount = output.segments.reduce(
    (total, segment) =>
      total +
      segment.factIds.length +
      segment.evidenceIds.length +
      segment.priorStatementIds.length,
    0,
  );
  const sourceSegmentCount = new Set([
    ...request.knowledgeView.publicRecord.facts.flatMap(
      (entry) => entry.sourceSegmentIds,
    ),
    ...request.knowledgeView.publicRecord.evidence.flatMap(
      (entry) => entry.sourceSegmentIds,
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
          (evidence) => evidence.evidenceId,
        ),
        ...request.knowledgeView.presentedEvidence.map(
          (evidence) => evidence.evidenceId,
        ),
      ]).size,
      testimonyCount: request.knowledgeView.publicRecord.testimony.length,
      priorStatementCount: request.knowledgeView.witness.priorStatements.length,
      sourceSegmentCount,
      publicRecordEventCount: new Set(
        request.knowledgeView.publicRecord.testimony.map(
          (testimony) => testimony.transcriptEventId,
        ),
      ).size,
      currentExchangeCount:
        request.knowledgeView.currentExchange === null ? 0 : 1,
    },
    promptAudit: {
      stablePrefixHash: sha256Utf8("fake-stable-prefix"),
      trustedContextHash: sha256Utf8("fake-trusted-context"),
      untrustedInputHash: sha256Utf8("fake-untrusted-input"),
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
        providerRequestId: "request:convex-witness:001",
        providerResponseId: "response:convex-witness:001",
        startedAt,
        completedAt,
        latencyMs: 250,
        firstStructuredDeltaMs: 25,
        streamEventCount: 3,
        structuredDeltaCount: 1,
        streamedCharacterCount: outputCharacterCount,
        outputHash,
        proposedCitationCount,
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
      requestId: "request:convex-witness:001",
      promptVersion: trace.promptVersion,
      schemaVersion: trace.outputSchemaVersion,
      latencyMs: trace.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: trace.estimatedCostUsd,
      retryCount: trace.retryCount,
      validationFailureCount: trace.validationFailureCount,
    },
    trace,
  });
}

function proposedCitationCount(
  groups: ReadonlyArray<Readonly<Record<string, readonly string[]>>>,
): number {
  return groups.reduce(
    (total, group) =>
      total +
      Object.values(group).reduce(
        (groupTotal, identifiers) => groupTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function counselKnowledgeScope(
  request:
    | OpponentPlannerRequest
    | CounselResponseRequest
    | NegotiationAgentRequest,
) {
  const view = request.knowledgeView;
  return {
    knowledgeSchemaVersion: view.schemaVersion,
    knowledgeViewHash: sha256Utf8(JSON.stringify(view)),
    stateVersion: view.stateVersion,
    factCount: new Set([
      ...view.counsel.facts.map((fact) => fact.factId),
      ...view.publicRecord.facts.map((fact) => fact.factId),
      ...(view.currentExchange?.factIds ?? []),
    ]).size,
    evidenceCount: new Set([
      ...view.counsel.evidence.map((evidence) => evidence.evidenceId),
      ...view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
      ...(view.currentExchange?.evidenceIds ?? []),
    ]).size,
    testimonyCount: view.publicRecord.testimony.length,
    priorStatementCount: 0,
    sourceSegmentCount: new Set([
      ...view.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
      ...view.publicRecord.evidence.flatMap(
        (evidence) => evidence.sourceSegmentIds,
      ),
    ]).size,
    publicRecordEventCount: new Set(
      view.publicRecord.testimony.map(
        (testimony) => testimony.transcriptEventId,
      ),
    ).size,
    currentExchangeCount: view.currentExchange === null ? 0 : 1,
  };
}

function acceptedCounselTrace(
  input: Readonly<{
    request:
      | OpponentPlannerRequest
      | CounselResponseRequest
      | NegotiationAgentRequest;
    outputHash: string;
    outputCharacterCount: number;
    proposedCitationCount: number;
    acceptedCitations: ReturnType<typeof opponentPlannerOutputCitations>;
    startedAt: string;
    callClass: "opponent_planner" | "role_responder" | "negotiation_agent";
    task: "plan_opponent" | "counsel_response" | "evaluate_settlement";
    promptVersion:
      | "opponent-planner.prompt.v2"
      | "role-responder.counsel.prompt.v2"
      | "negotiation-agent.prompt.v1";
    outputSchemaVersion:
      | typeof OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION
      | typeof COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION
      | typeof NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION;
    estimatedCostUsd?: number | null;
  }>,
) {
  const completedAt = new Date(Date.parse(input.startedAt) + 250).toISOString();
  const usage = {
    inputTokens: 130,
    outputTokens: 35,
    totalTokens: 165,
    cachedInputTokens: 40,
    cacheWriteTokens: 0,
    reasoningTokens: 5,
  };
  const providerRequestId = `request:test:${sha256Utf8(input.request.callId).slice(0, 24)}`;
  const trace = CourtroomModelCallTraceSchema.parse({
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: input.request.callId,
    trialId: input.request.trialId,
    responseId: null,
    actorId: input.request.actorId,
    actorRole: "counsel",
    callClass: input.callClass,
    task: input.task,
    inputEventIds: [input.request.expectedLastEventId],
    expectedStateVersion: input.request.expectedStateVersion,
    expectedLastEventId: input.request.expectedLastEventId,
    provider: "scripted-courtroom-model",
    model: "gpt-5.6-luna",
    providerProtocolVersion: "courtroom-model-provider.v1",
    promptVersion: input.promptVersion,
    outputSchemaVersion: input.outputSchemaVersion,
    knowledgeScope: counselKnowledgeScope(input.request),
    promptAudit: {
      stablePrefixHash: sha256Utf8("fake-counsel-stable-prefix"),
      trustedContextHash: sha256Utf8("fake-counsel-trusted-context"),
      untrustedInputHash: sha256Utf8("fake-counsel-untrusted-input"),
      inputCharacterCount: 80,
    },
    status: "accepted",
    startedAt: input.startedAt,
    completedAt,
    latencyMs: 250,
    firstStructuredDeltaMs: 25,
    firstAcceptedSegmentMs: 50,
    retryCount: 0,
    validationFailureCount: 0,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    usage,
    acceptedAttempt: 1,
    acceptedCitations: input.acceptedCitations,
    acceptedCitationCount: Object.values(input.acceptedCitations).reduce(
      (total, identifiers) => total + identifiers.length,
      0,
    ),
    outputHash: input.outputHash,
    outputCharacterCount: input.outputCharacterCount,
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
        providerResponseId: `response:test:${sha256Utf8(input.request.callId).slice(0, 24)}`,
        startedAt: input.startedAt,
        completedAt,
        latencyMs: 250,
        firstStructuredDeltaMs: 25,
        streamEventCount: 3,
        structuredDeltaCount: 1,
        streamedCharacterCount: input.outputCharacterCount,
        outputHash: input.outputHash,
        proposedCitationCount: input.proposedCitationCount,
        usage,
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  });
  return {
    trace,
    modelMetadata: {
      model: "gpt-5.6-luna" as const,
      requestId: providerRequestId,
      promptVersion: trace.promptVersion,
      schemaVersion: trace.outputSchemaVersion,
      latencyMs: trace.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: trace.estimatedCostUsd,
      retryCount: 0,
      validationFailureCount: 0,
    },
  };
}

async function fakeOpponentPlanGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
  move: "question" | "strike" | "end" = "end",
): Promise<HearingOpponentPlanPrecommit> {
  if (!isHearingOpponentPlanModelRequiredPreparation(preparation)) {
    throw new Error("Expected opponent planner preparation");
  }
  const request = preparation.request;
  const isClosing = request.opportunities.canClose;
  const factId = isClosing
    ? request.knowledgeView.publicRecord.facts[0]?.factId
    : (request.knowledgeView.counsel.facts[0]?.factId ??
      request.knowledgeView.publicRecord.facts[0]?.factId);
  const evidenceId = isClosing
    ? request.knowledgeView.publicRecord.evidence[0]?.evidenceId
    : request.opportunities.presentableEvidenceIds[0];
  const testimonyId =
    move === "strike"
      ? request.opportunities.strikeableTestimonyIds[0]
      : request.knowledgeView.publicRecord.testimony[0]?.testimonyId;
  if (move === "strike" && !testimonyId) {
    throw new Error("Fixture requires strikeable public testimony");
  }
  if ((move === "question" || isClosing) && !factId && !evidenceId && !testimonyId) {
    throw new Error("Fixture requires grounding for an opponent question");
  }
  const citations = {
    factIds: factId ? [factId] : [],
    evidenceIds: evidenceId ? [evidenceId] : [],
    testimonyIds: testimonyId ? [testimonyId] : [],
    transcriptTurnIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
    issueIds: [],
    instructionIds: [],
    ruleIds: [],
    settlementOfferIds: [],
  };
  const output = OpponentPlannerModelOutputSchema.parse({
    schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
    objectives: [
      "Test the active witness without exceeding the permitted record.",
    ],
    witnessPriorityIds:
      request.procedure.activeWitnessId === null
        ? []
        : [request.procedure.activeWitnessId],
    evidencePriorityIds: [],
    settlementPosture: "avoid",
    privateNotes: ["Keep this examination grounded in the scoped record."],
    proposedMoves: isClosing
      ? [
          {
            kind: "give_closing",
            rationale: "A record-grounded closing completes the defense case.",
            citations,
          },
        ]
      : move === "question"
        ? [
            {
              kind: "question_witness",
              witnessId: request.procedure.activeWitnessId,
              goal: "Test the witness's account against the scoped record.",
              presentedEvidenceIds: evidenceId ? [evidenceId] : [],
              rationale: "One focused question advances the active cross.",
              citations,
            },
          ]
        : move === "strike"
          ? [
              {
                kind: "move_to_strike",
                testimonyIds: [testimonyId],
                rationale:
                  "The identified answer lacks adequate foundation and should leave the active record.",
                citations,
              },
            ]
        : [
            {
              kind: "no_action",
              rationale:
                "No further question is needed on this examination leg.",
              citations: {
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
              },
            },
          ],
  });
  const outputHash = hashOpponentPlannerModelOutput(output);
  const acceptedCitations = opponentPlannerOutputCitations(output);
  const audit = acceptedCounselTrace({
    request,
    outputHash,
    outputCharacterCount: JSON.stringify(output).length,
    proposedCitationCount: proposedCitationCount(
      output.proposedMoves.map((candidate) => candidate.citations),
    ),
    acceptedCitations,
    startedAt,
    callClass: "opponent_planner",
    task: "plan_opponent",
    promptVersion: "opponent-planner.prompt.v2",
    outputSchemaVersion: output.schemaVersion,
  });
  return HearingOpponentPlanPrecommitSchema.parse({
    schemaVersion: HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    output,
    modelMetadata: audit.modelMetadata,
    trace: audit.trace,
  });
}

async function fakeCounselGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
): Promise<HearingCounselResponsePrecommit> {
  if (!isHearingCounselResponseModelRequiredPreparation(preparation)) {
    throw new Error("Expected counsel response preparation");
  }
  const request = preparation.request;
  const directive = request.directive;
  const citations = {
    factIds:
      directive.kind === "question_witness" || directive.kind === "give_closing"
        ? directive.permittedFactIds.slice(0, 1)
        : [],
    evidenceIds:
      directive.kind === "question_witness" || directive.kind === "give_closing"
        ? directive.permittedEvidenceIds.slice(0, 1)
        : [],
    testimonyIds:
      directive.kind === "question_witness" ||
      directive.kind === "move_to_strike" ||
      directive.kind === "give_closing"
        ? directive.permittedTestimonyIds.slice(0, 1)
        : [],
    transcriptTurnIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
    issueIds: [],
    instructionIds: [],
    ruleIds: [],
    settlementOfferIds: [],
  };
  const output = CounselRoleResponseModelOutputSchema.parse({
    schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    speechSegments: [
      {
        text:
          directive.kind === "question_witness"
            ? "That account is the one you ask this court to accept, correct?"
            : directive.kind === "move_to_strike"
              ? "Move to strike that answer for lack of foundation."
            : directive.kind === "give_closing"
              ? "The jury-considerable testimony does not carry the user's burden."
            : "No further questions, Your Honor.",
        citations,
      },
    ],
    proposedAction: directive.kind === "question_witness"
        ? {
            kind: "ask_question",
            presentedEvidenceIds: directive.presentedEvidenceIds,
          }
        : directive.kind === "move_to_strike"
          ? {
              kind: "move_to_strike",
              testimonyIds: directive.testimonyIds,
              reason: directive.basis,
            }
        : directive.kind === "give_closing"
          ? { kind: "give_closing" }
        : {
            kind: "end_examination",
            disposition: directive.disposition,
          },
    performance: {
      activity:
        directive.kind === "move_to_strike" ? "standing" : "speaking",
      emotion: "confident",
      intensity: 0.5,
      gazeTarget: directive.kind === "give_closing" ? "jury" : "witness",
      gesture: "open_palm",
      speakingStyle: "firm",
    },
  });
  const outputHash = hashCounselResponseModelOutput(output);
  const acceptedCitations = counselResponseOutputCitations(output);
  const audit = acceptedCounselTrace({
    request,
    outputHash,
    outputCharacterCount: JSON.stringify(output).length,
    proposedCitationCount: proposedCitationCount(
      output.speechSegments.map((segment) => segment.citations),
    ),
    acceptedCitations,
    startedAt,
    callClass: "role_responder",
    task: "counsel_response",
    promptVersion: "role-responder.counsel.prompt.v2",
    outputSchemaVersion: output.schemaVersion,
  });
  return HearingCounselResponsePrecommitSchema.parse({
    schemaVersion: HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    planBinding: request.planBinding,
    output,
    modelMetadata: audit.modelMetadata,
    trace: audit.trace,
  });
}

function emptyCourtroomCitations() {
  return {
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
}

function judgeKnowledgeScope(
  request: ObjectionRulingRequest | JudgeResponseRequest,
) {
  const record = request.knowledgeView.publicRecord;
  return {
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
    currentExchangeCount: request.knowledgeView.currentExchange === null ? 0 : 1,
  };
}

function acceptedObjectionTrace(
  request: ObjectionRulingRequest,
  output: ReturnType<typeof ObjectionRulingModelOutputSchema.parse>,
  startedAt: string,
) {
  const completedAt = new Date(Date.parse(startedAt) + 250).toISOString();
  const outputHash = hashObjectionRulingModelOutput(output);
  const outputCharacterCount = JSON.stringify(output).length;
  const proposedCount = proposedCitationCount([output.citations]);
  const acceptedCitations = objectionRulingOutputCitations(output, {
    turnId: request.question.turnId,
    sourceEventId: request.question.eventId,
  });
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
    responseId: request.interruption?.interruptedResponseId ?? null,
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
    knowledgeScope: judgeKnowledgeScope(request),
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
        providerRequestId,
        providerResponseId: `response:test:${sha256Utf8(request.callId).slice(0, 24)}`,
        startedAt,
        completedAt,
        latencyMs: 250,
        firstStructuredDeltaMs: 25,
        streamEventCount: 3,
        structuredDeltaCount: 1,
        streamedCharacterCount: outputCharacterCount,
        outputHash,
        proposedCitationCount: proposedCount,
        usage,
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  });
  return {
    trace,
    modelMetadata: {
      model: "gpt-5.6-luna" as const,
      requestId: providerRequestId,
      promptVersion: trace.promptVersion,
      schemaVersion: trace.outputSchemaVersion,
      latencyMs: trace.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: trace.estimatedCostUsd,
      retryCount: trace.retryCount,
      validationFailureCount: trace.validationFailureCount,
    },
  };
}

function fakeObjectionRulingGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
  ruling: "sustained" | "overruled",
): HearingObjectionRulingPrecommit {
  if (!isHearingObjectionRulingModelRequiredPreparation(preparation)) {
    throw new Error("Expected objection-ruling model preparation");
  }
  const request = preparation.request;
  if (request.interruption === null) {
    throw new Error("Fixture objection requires an interrupted response");
  }
  const output = ObjectionRulingModelOutputSchema.parse({
    schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
    ruling,
    remedy: ruling === "sustained" ? "cancel_response" : "resume_response",
    reason:
      ruling === "sustained"
        ? "The question calls for an inadmissible out-of-court statement."
        : "The question may be answered from the witness's personal knowledge.",
    citations: {
      ...emptyCourtroomCitations(),
      transcriptTurnIds: [request.question.turnId],
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
  const audit = acceptedObjectionTrace(request, output, startedAt);
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
    modelMetadata: audit.modelMetadata,
    trace: audit.trace,
  });
}

function negotiationUtilityBand(
  amount: number | null,
  authority: Readonly<{ reservationValue: number; targetValue: number }>,
) {
  if (amount === null) return "non_monetary_tradeoff" as const;
  if (authority.targetValue > authority.reservationValue) {
    if (amount >= authority.targetValue) return "at_or_above_target" as const;
    if (amount < authority.reservationValue) return "below_reservation" as const;
    return "within_authority" as const;
  }
  if (authority.targetValue < authority.reservationValue) {
    if (amount <= authority.targetValue) return "at_or_above_target" as const;
    if (amount > authority.reservationValue) return "below_reservation" as const;
    return "within_authority" as const;
  }
  return amount === authority.targetValue
    ? ("at_or_above_target" as const)
    : ("within_authority" as const);
}

function fakeNegotiationGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
  recommendation: "counter" | "accept" | "reject",
  counterAmount = 60_000,
): HearingNegotiationPrecommit {
  if (!isHearingNegotiationModelRequiredPreparation(preparation)) {
    throw new Error("Expected negotiation model preparation");
  }
  const request = preparation.request;
  const settlement = request.knowledgeView.counsel.privateSettlement;
  const targetOfferId = request.offerBinding.targetOfferId;
  if (settlement === null || targetOfferId === null) {
    throw new Error("Fixture negotiation requires a bound private offer");
  }
  const targetOffer = settlement.offers.find(
    (offer) => offer.offerId === targetOfferId,
  );
  if (targetOffer === undefined) {
    throw new Error("Fixture target offer is absent from private scope");
  }
  const amount = recommendation === "counter" ? counterAmount : targetOffer.amount;
  const output = NegotiationAgentModelOutputSchema.parse({
    schemaVersion: NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
    recommendation,
    utilityBand: negotiationUtilityBand(amount, settlement.authority),
    terms:
      recommendation === "counter"
        ? {
            amount: counterAmount,
            currency: settlement.currency,
            nonMonetaryTerms: [],
            summary: "Resolve the fictional matter for the counter amount.",
          }
        : null,
    decisionSummary:
      recommendation === "counter"
        ? "A bounded counteroffer better matches the represented party's authority."
        : recommendation === "accept"
          ? "The offer falls within the represented party's settlement authority."
          : "The offer falls outside the represented party's acceptable range.",
    citations: {
      ...emptyCourtroomCitations(),
      settlementOfferIds: [targetOfferId],
    },
    performance: {
      activity: "thinking",
      emotion: "neutral",
      intensity: 0.3,
      gazeTarget: "none",
      gesture: "none",
      speakingStyle: "deliberative",
    },
  });
  const audit = acceptedCounselTrace({
    request,
    outputHash: hashNegotiationAgentModelOutput(output),
    outputCharacterCount: JSON.stringify(output).length,
    proposedCitationCount: negotiationAgentProposedCitationCount(output),
    acceptedCitations: negotiationAgentOutputCitations(output),
    startedAt,
    callClass: "negotiation_agent",
    task: "evaluate_settlement",
    promptVersion: "negotiation-agent.prompt.v1",
    outputSchemaVersion: output.schemaVersion,
    estimatedCostUsd: 0.001,
  });
  return HearingNegotiationPrecommitSchema.parse({
    schemaVersion: HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    output,
    modelMetadata: audit.modelMetadata,
    trace: audit.trace,
  });
}

function juryKnowledgeScope(request: JuryResponseRequest) {
  const record = request.knowledgeView.publicRecord;
  return {
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
    currentExchangeCount: 0,
  };
}

function uniqueFinalCount(...lists: readonly string[][]): number {
  return new Set(lists.flat()).size;
}

function debriefKnowledgeScope(request: DebriefGeneratorRequest) {
  const { strata } = request.knowledgeView;
  const admitted = strata.admittedRecord.record;
  const proceduralEventIds = [
    ...request.transcript.map(({ sourceEventId }) => sourceEventId),
    ...request.procedure.objections.flatMap((objection) => [
      objection.sourceEventId,
      ...(objection.rulingEventId === null ? [] : [objection.rulingEventId]),
    ]),
    ...request.procedure.settlementOffers.flatMap((offer) => [
      offer.sourceEventId,
      offer.lastEventId,
    ]),
    ...(request.procedure.verdict === null
      ? []
      : [request.procedure.verdict.sourceEventId]),
  ];
  return {
    knowledgeSchemaVersion: request.knowledgeView.schemaVersion,
    knowledgeViewHash: sha256Utf8(JSON.stringify(request.knowledgeView)),
    stateVersion: request.knowledgeView.stateVersion,
    factCount: uniqueFinalCount(
      admitted.facts.map(({ factId }) => factId),
      strata.unadmittedRecord.facts.map(({ factId }) => factId),
      strata.excludedOrStricken.facts.map(({ factId }) => factId),
      strata.hiddenAuthoringTruth.facts.map(({ factId }) => factId),
    ),
    evidenceCount: uniqueFinalCount(
      admitted.evidence.map(({ evidenceId }) => evidenceId),
      strata.unadmittedRecord.evidence.map(({ evidenceId }) => evidenceId),
      strata.excludedOrStricken.evidence.map(
        ({ evidenceId }) => evidenceId,
      ),
    ),
    testimonyCount: uniqueFinalCount(
      admitted.testimony.map(({ testimonyId }) => testimonyId),
      strata.excludedOrStricken.testimony.map(
        ({ testimonyId }) => testimonyId,
      ),
    ),
    priorStatementCount: 0,
    sourceSegmentCount: new Set([
      ...admitted.facts.flatMap(({ sourceSegmentIds }) => sourceSegmentIds),
      ...admitted.evidence.flatMap(
        ({ sourceSegmentIds }) => sourceSegmentIds,
      ),
      ...strata.hiddenAuthoringTruth.facts.flatMap(
        ({ sourceSegmentIds }) => sourceSegmentIds,
      ),
    ]).size,
    publicRecordEventCount: new Set(proceduralEventIds).size,
    currentExchangeCount: 0,
  };
}

function acceptedFinalTrace(input: Readonly<{
  request: JudgeResponseRequest | JuryResponseRequest | DebriefGeneratorRequest;
  actorRole: "judge" | "jury" | "debrief";
  callClass: "role_responder" | "debrief_generator";
  task: "judge_response" | "jury_deliberation" | "generate_debrief";
  model: "gpt-5.6-luna" | "gpt-5.6-terra";
  promptVersion:
    | "role-responder.judge.prompt.v1"
    | "role-responder.jury.prompt.v1"
    | "debrief-generator.prompt.v1";
  outputSchemaVersion: string;
  outputHash: string;
  outputCharacterCount: number;
  proposedCitationCount: number;
  acceptedCitations: ReturnType<typeof juryResponseOutputCitations>;
  knowledgeScope: ReturnType<typeof juryKnowledgeScope>;
  startedAt: string;
}>) {
  const completedAt = new Date(Date.parse(input.startedAt) + 250).toISOString();
  const usage = {
    inputTokens: 150,
    outputTokens: 45,
    totalTokens: 195,
    cachedInputTokens: 40,
    cacheWriteTokens: 0,
    reasoningTokens: 8,
  };
  const providerRequestId = `request:test:${sha256Utf8(input.request.callId).slice(0, 24)}`;
  const trace = CourtroomModelCallTraceSchema.parse({
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: input.request.callId,
    trialId: input.request.trialId,
    responseId: null,
    actorId: input.request.actorId,
    actorRole: input.actorRole,
    callClass: input.callClass,
    task: input.task,
    inputEventIds: [input.request.expectedLastEventId],
    expectedStateVersion: input.request.expectedStateVersion,
    expectedLastEventId: input.request.expectedLastEventId,
    provider: "scripted-courtroom-model",
    model: input.model,
    providerProtocolVersion: "courtroom-model-provider.v1",
    promptVersion: input.promptVersion,
    outputSchemaVersion: input.outputSchemaVersion,
    knowledgeScope: input.knowledgeScope,
    promptAudit: {
      stablePrefixHash: sha256Utf8("fake-final-stable-prefix"),
      trustedContextHash: sha256Utf8("fake-final-trusted-context"),
      untrustedInputHash: sha256Utf8("fake-final-untrusted-input"),
      inputCharacterCount: 90,
    },
    status: "accepted",
    startedAt: input.startedAt,
    completedAt,
    latencyMs: 250,
    firstStructuredDeltaMs: 25,
    firstAcceptedSegmentMs: null,
    retryCount: 0,
    validationFailureCount: 0,
    estimatedCostUsd: null,
    usage,
    acceptedAttempt: 1,
    acceptedCitations: input.acceptedCitations,
    acceptedCitationCount: Object.values(input.acceptedCitations).reduce(
      (total, identifiers) => total + identifiers.length,
      0,
    ),
    outputHash: input.outputHash,
    outputCharacterCount: input.outputCharacterCount,
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
        providerResponseId: `response:test:${sha256Utf8(input.request.callId).slice(0, 24)}`,
        startedAt: input.startedAt,
        completedAt,
        latencyMs: 250,
        firstStructuredDeltaMs: 25,
        streamEventCount: 3,
        structuredDeltaCount: 1,
        streamedCharacterCount: input.outputCharacterCount,
        outputHash: input.outputHash,
        proposedCitationCount: input.proposedCitationCount,
        usage,
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  });
  return {
    trace,
    modelMetadata: {
      model: input.model,
      requestId: providerRequestId,
      promptVersion: input.promptVersion,
      schemaVersion: input.outputSchemaVersion,
      latencyMs: 250,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: null,
      retryCount: 0,
      validationFailureCount: 0,
    },
  };
}

function fakeJudgeGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
  ruling: "granted" | "denied",
): HearingJudgeResponsePrecommit {
  if (!isHearingJudgeResponseModelRequiredPreparation(preparation)) {
    throw new Error("Expected generic judge-response preparation");
  }
  const request = preparation.request;
  if (request.directive.kind !== "rule_on_strike_motion") {
    throw new Error("Fixture judge response requires a pending strike motion");
  }
  const citations = {
    ...emptyCourtroomCitations(),
    testimonyIds: [...request.directive.testimonyIds],
  };
  const output = JudgeRoleResponseModelOutputSchema.parse({
    schemaVersion: JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    speechSegments: [
      {
        text:
          ruling === "granted"
            ? "The motion is granted, and the identified testimony is stricken."
            : "The motion is denied; the identified testimony remains in the record.",
        citations,
      },
    ],
    proposedAction: {
      kind: "rule_on_strike_motion",
      ruling,
      reason:
        ruling === "granted"
          ? "The answer lacks an adequate foundation."
          : "The witness supplied an adequate personal-knowledge foundation.",
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
  const audit = acceptedFinalTrace({
    request,
    actorRole: "judge",
    callClass: "role_responder",
    task: "judge_response",
    model: "gpt-5.6-luna",
    promptVersion: "role-responder.judge.prompt.v1",
    outputSchemaVersion: output.schemaVersion,
    outputHash: hashJudgeResponseModelOutput(output),
    outputCharacterCount: JSON.stringify(output).length,
    proposedCitationCount: proposedCitationCount(
      output.speechSegments.map((segment) => segment.citations),
    ),
    acceptedCitations: judgeResponseOutputCitations(output),
    knowledgeScope: judgeKnowledgeScope(request),
    startedAt,
  });
  return HearingJudgeResponsePrecommitSchema.parse({
    schemaVersion: HEARING_JUDGE_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    output,
    modelMetadata: audit.modelMetadata,
    trace: audit.trace,
  });
}

async function fakeJuryGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
  recommendation: JuryRoleResponseModelOutput["recommendation"] = {
    outcome: "user_prevails",
    decision: "The jury finds for the user on the jury-considerable record.",
    confidence: 0.76,
  },
): Promise<HearingJuryResponsePrecommit> {
  if (!isHearingJuryResponseModelRequiredPreparation(preparation)) {
    throw new Error("Expected jury response preparation");
  }
  const request = preparation.request;
  const record = request.knowledgeView.publicRecord;
  const instructionIds = record.instructions.map(
    ({ instructionId }) => instructionId,
  );
  const citations = {
    factIds: record.facts.slice(0, 1).map(({ factId }) => factId),
    evidenceIds: record.evidence
      .slice(0, 1)
      .map(({ evidenceId }) => evidenceId),
    testimonyIds: record.testimony
      .slice(0, 1)
      .map(({ testimonyId }) => testimonyId),
    transcriptTurnIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
    issueIds: [],
    instructionIds,
    ruleIds: [],
    settlementOfferIds: [],
  };
  const output = JuryRoleResponseModelOutputSchema.parse({
    schemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    deliberationSegments: [
      {
        text: "The admitted testimony and instructions support a verdict on the record.",
        citations,
      },
    ],
    findings: [
      {
        conclusion: "The user carried the fictional burden on the admitted record.",
        weight: "strong",
        citations,
      },
    ],
    recommendation,
    performance: {
      activity: "speaking",
      emotion: "neutral",
      intensity: 0.45,
      gazeTarget: "judge",
      gesture: "none",
      speakingStyle: "deliberative",
    },
  });
  const outputHash = hashJuryResponseModelOutput(output);
  const audit = acceptedFinalTrace({
    request,
    actorRole: "jury",
    callClass: "role_responder",
    task: "jury_deliberation",
    model: "gpt-5.6-luna",
    promptVersion: "role-responder.jury.prompt.v1",
    outputSchemaVersion: output.schemaVersion,
    outputHash,
    outputCharacterCount: JSON.stringify(output).length,
    proposedCitationCount: proposedCitationCount([
      ...output.deliberationSegments.map((segment) => segment.citations),
      ...output.findings.map((finding) => finding.citations),
    ]),
    acceptedCitations: juryResponseOutputCitations(output),
    knowledgeScope: juryKnowledgeScope(request),
    startedAt,
  });
  return HearingJuryResponsePrecommitSchema.parse({
    schemaVersion: HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    output,
    modelMetadata: audit.modelMetadata,
    trace: audit.trace,
  });
}

function emptyDebriefCitations(
  overrides: Partial<DebriefCitationSet> = {},
): DebriefCitationSet {
  return {
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
    ...overrides,
  };
}

async function fakeDebriefGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
): Promise<HearingDebriefGeneratorPrecommit> {
  if (!isHearingDebriefGeneratorModelRequiredPreparation(preparation)) {
    throw new Error("Expected debrief generation preparation");
  }
  const request = preparation.request;
  const admitted = request.knowledgeView.strata.admittedRecord.record;
  const citations = emptyDebriefCitations({
    admittedFactIds: admitted.facts.slice(0, 1).map(({ factId }) => factId),
    admittedEvidenceIds: admitted.evidence
      .slice(0, 1)
      .map(({ evidenceId }) => evidenceId),
    activeTestimonyIds: admitted.testimony
      .slice(0, 2)
      .map(({ testimonyId }) => testimonyId),
    transcriptTurnIds: request.transcript.map(({ turnId }) => turnId),
  });
  const output = DebriefGeneratorModelOutputSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    overallAssessment: {
      text: "The examination created a coherent record for this fictional hearing.",
      basis: "admitted_record",
      citations,
    },
    strengths: [
      {
        title: "Coherent examination",
        assessment: "The transcript shows a focused witness sequence.",
        recommendation: "Keep the same disciplined structure.",
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
    improvedClosing: {
      segments: [
        {
          text: "The admitted testimony supports the requested fictional result.",
          citations,
        },
      ],
    },
    limitations: [
      "This fictional educational coaching is not legal advice or a real-case prediction.",
    ],
  });
  const sourceEventIdByTurnId = new Map(
    request.transcript.map(({ turnId, sourceEventId }) => [
      turnId,
      sourceEventId,
    ]),
  );
  const transcriptEventBindings = [...citations.transcriptTurnIds]
    .sort((left, right) => left.localeCompare(right))
    .map((turnId) => {
      const sourceEventId = sourceEventIdByTurnId.get(turnId);
      if (!sourceEventId) throw new Error("Fixture debrief turn is unbound");
      return { turnId, sourceEventId };
    });
  const outputHash = hashDebriefGeneratorModelOutput(output);
  const citationGroups = [
    output.overallAssessment.citations,
    ...output.strengths.map((point) => point.citations),
    ...output.weakQuestions.map((point) => point.citations),
    ...output.missedEvidence.map((point) => point.citations),
    ...output.contradictions.map((point) => point.citations),
    ...output.objectionAccuracy.map((point) => point.citations),
    ...output.witnessStrategy.map((point) => point.citations),
    ...output.settlementChoices.map((point) => point.citations),
    ...output.juryMovement.map((point) => point.citations),
    ...output.improvedClosing.segments.map((segment) => segment.citations),
  ];
  const audit = acceptedFinalTrace({
    request,
    actorRole: "debrief",
    callClass: "debrief_generator",
    task: "generate_debrief",
    model: "gpt-5.6-terra",
    promptVersion: "debrief-generator.prompt.v1",
    outputSchemaVersion: output.schemaVersion,
    outputHash,
    outputCharacterCount: JSON.stringify(output).length,
    proposedCitationCount: proposedCitationCount(citationGroups),
    acceptedCitations: debriefGeneratorOutputCitations(
      output,
      transcriptEventBindings,
    ),
    knowledgeScope: debriefKnowledgeScope(request),
    startedAt,
  });
  return HearingDebriefGeneratorPrecommitSchema.parse({
    schemaVersion: HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    transcriptEventBindings,
    output,
    modelMetadata: audit.modelMetadata,
    trace: audit.trace,
  });
}

async function commitModelPreparation(
  backend: TestBackend,
  preparation: HearingCommandPreparation,
  startedAt: string,
  opponentMove: "question" | "strike" | "end" = "end",
  juryRecommendation?: JuryRoleResponseModelOutput["recommendation"],
): Promise<HearingCommandPreparation> {
  if (isHearingWitnessModelRequiredPreparation(preparation)) {
    const generation = await fakeWitnessGeneration(preparation, startedAt);
    return HearingCommandPreparationSchema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  if (isHearingOpponentPlanModelRequiredPreparation(preparation)) {
    const generation = await fakeOpponentPlanGeneration(
      preparation,
      startedAt,
      opponentMove,
    );
    return HearingCommandPreparationSchema.parse(
      await backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  if (isHearingCounselResponseModelRequiredPreparation(preparation)) {
    const generation = await fakeCounselGeneration(preparation, startedAt);
    return HearingCommandPreparationSchema.parse(
      await backend.action(commitCounselGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  if (isHearingJudgeResponseModelRequiredPreparation(preparation)) {
    const generation = fakeJudgeGeneration(preparation, startedAt, "denied");
    return HearingCommandPreparationSchema.parse(
      await backend.action(commitJudgeGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  if (isHearingObjectionRulingModelRequiredPreparation(preparation)) {
    const generation = await fakeObjectionRulingGeneration(
      preparation,
      startedAt,
      "overruled",
    );
    return HearingCommandPreparationSchema.parse(
      await backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  if (isHearingNegotiationModelRequiredPreparation(preparation)) {
    const generation = await fakeNegotiationGeneration(
      preparation,
      startedAt,
      "reject",
    );
    return HearingCommandPreparationSchema.parse(
      await backend.action(commitNegotiationGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  if (isHearingJuryResponseModelRequiredPreparation(preparation)) {
    const generation = await fakeJuryGeneration(
      preparation,
      startedAt,
      juryRecommendation,
    );
    return HearingCommandPreparationSchema.parse(
      await backend.action(commitJuryGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  if (isHearingDebriefGeneratorModelRequiredPreparation(preparation)) {
    const generation = await fakeDebriefGeneration(preparation, startedAt);
    return HearingCommandPreparationSchema.parse(
      await backend.action(commitDebriefGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  return preparation;
}

async function prepareInitialOpponentCross(
  backend: TestBackend,
): Promise<Extract<HearingCommandPreparation, { status: "model_required" }>> {
  const started = await start(backend);
  const called = await command(
    backend,
    started,
    "81818181-8181-4181-8181-818181818181",
    "2026-07-19T04:00:00.000Z",
    { type: "call_witness", witnessId: "witness_rina_shah" },
  );
  const question = await prepare(
    backend,
    called.view,
    "82828282-8282-4282-8282-828282828282",
    "2026-07-19T04:01:00.000Z",
    {
      type: "ask_question",
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
      text: "What did you personally observe?",
      presentedEvidenceIds: [],
    },
  );
  const directAnswer = await commitModelPreparation(
    backend,
    question.preparation,
    "2026-07-19T04:01:02.000Z",
  );
  if (directAnswer.status !== "completed") {
    throw new Error("Expected player control after direct answer");
  }
  const ending = await prepare(
    backend,
    directAnswer.view,
    "83838383-8383-4383-8383-838383838383",
    "2026-07-19T04:02:00.000Z",
    {
      type: "finish_witness",
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
    },
  );
  if (ending.preparation.status !== "model_required") {
    throw new Error("Expected opponent plan after completed direct");
  }
  return ending.preparation;
}

async function prepareSettlementNegotiation(
  backend: TestBackend,
  amount: number,
): Promise<{
  preparation: Extract<HearingCommandPreparation, { status: "model_required" }>;
  offerId: string;
}> {
  let view = await start(backend);
  ({ view } = await command(
    backend,
    view,
    "86868686-8686-4686-8686-868686868686",
    "2026-07-19T03:41:00.000Z",
    { type: "call_witness", witnessId: "witness_rina_shah" },
  ));
  ({ view } = await command(
    backend,
    view,
    "87878787-8787-4787-8787-878787878787",
    "2026-07-19T03:42:00.000Z",
    {
      type: "ask_question",
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
      text: "What did you personally observe?",
      presentedEvidenceIds: [],
    },
  ));
  ({ view } = await command(
    backend,
    view,
    "88888888-8888-4888-8888-888888888887",
    "2026-07-19T03:43:00.000Z",
    {
      type: "finish_witness",
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
    },
  ));
  if (view.activeAppearance?.stage === "redirect") {
    ({ view } = await command(
      backend,
      view,
      "89898989-8989-4989-8989-898989898989",
      "2026-07-19T03:44:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_rina_shah",
        examinationKind: "redirect",
      },
    ));
  }
  if (!view.capabilities.canProposeSettlement) {
    throw new Error("Fixture must reach a settlement-capable record");
  }
  const requestId = "90909090-9090-4090-8090-909090909091";
  const offer = playerCommand(
    view,
    requestId,
    "2026-07-19T03:45:00.000Z",
    {
      type: "propose_settlement",
      terms: {
        amount,
        nonMonetaryTerms: ["Neutral reference"],
        summary: "Resolve the fictional matter on these terms.",
      },
    },
  );
  const preparation = HearingCommandPreparationSchema.parse(
    await backend.action(prepareCommandReference, {
      ownerId: OWNER_ID,
      trialId: view.trial.trialId,
      commandJson: JSON.stringify(offer),
    }),
  );
  if (!isHearingNegotiationModelRequiredPreparation(preparation)) {
    throw new Error("A user offer should require opposing settlement review");
  }
  return { preparation, offerId: `offer:${requestId}` };
}

async function prepareUserObjectionRuling(
  backend: TestBackend,
): Promise<Extract<HearingCommandPreparation, { status: "model_required" }>> {
  const planPreparation = await prepareInitialOpponentCross(backend);
  const planGeneration = await fakeOpponentPlanGeneration(
    planPreparation,
    "2026-07-19T03:50:00.000Z",
    "question",
  );
  const counselPreparation = HearingCommandPreparationSchema.parse(
    await backend.action(commitOpponentPlanGenerationReference, {
      ownerId: OWNER_ID,
      trialId: planPreparation.request.trialId,
      generationJson: JSON.stringify(planGeneration),
    }),
  );
  const counselGeneration = await fakeCounselGeneration(
    counselPreparation,
    "2026-07-19T03:50:01.000Z",
  );
  const responseWindow = HearingCommandPreparationSchema.parse(
    await backend.action(commitCounselGenerationReference, {
      ownerId: OWNER_ID,
      trialId: planPreparation.request.trialId,
      generationJson: JSON.stringify(counselGeneration),
    }),
  );
  if (responseWindow.status !== "completed") {
    throw new Error("Expected an objection decision window");
  }
  const activeQuestion = responseWindow.view.activeQuestion;
  if (!activeQuestion?.pendingResponseId) {
    throw new Error("Expected an interruptible pending response");
  }
  const preparation = HearingCommandPreparationSchema.parse(
    await backend.action(prepareCommandReference, {
      ownerId: OWNER_ID,
      trialId: responseWindow.view.trial.trialId,
      commandJson: JSON.stringify(
        playerCommand(
          responseWindow.view,
          "92929292-9292-4292-8292-929292929290",
          "2026-07-19T03:50:02.000Z",
          {
            type: "object",
            questionId: activeQuestion.questionId,
            responseId: activeQuestion.pendingResponseId,
            ground: "hearsay",
          },
        ),
      ),
    }),
  );
  if (!isHearingObjectionRulingModelRequiredPreparation(preparation)) {
    throw new Error("Expected judge ruling preparation");
  }
  return preparation;
}

describe("V3 hearing runtime facade", () => {
  it("idempotently starts a seeded case without writing any legacy trial rows", async () => {
    const backend = convexTest({ schema, modules });
    const first = await start(backend);
    const second = await start(backend);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: "hearing-runtime-view.v1",
      case: { caseId: "case_redwood_signal_v1" },
      trial: {
        phase: "case_in_chief",
        status: "active",
        version: 3,
        sequence: 3,
        userSide: "user",
      },
    });
    expect(first.witnesses).toHaveLength(3);
    expect(JSON.stringify(first.player.facts)).not.toContain('"hidden"');

    const stored = await backend.run(async (ctx) => ({
      graphs: await ctx.db.query("caseGraphs").collect(),
      projections: await ctx.db.query("trialProjections").collect(),
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", first.trial.trialId),
        )
        .collect(),
      legacyTrials: await ctx.db.query("trials").collect(),
      legacyTurns: await ctx.db.query("turns").collect(),
    }));
    expect(stored.graphs).toHaveLength(1);
    expect(stored.graphs[0]).toMatchObject({
      lifecycle: "published",
      visibility: "seeded_public",
      createdBy: "system",
    });
    expect(stored.projections).toHaveLength(1);
    expect(stored.events.map((event) => event.eventType)).toEqual([
      "START_TRIAL",
      "BEGIN_PHASE",
      "BEGIN_PHASE",
    ]);
    expect(stored.legacyTrials).toEqual([]);
    expect(stored.legacyTurns).toEqual([]);
  });

  it("starts only the caller's immutable published private case", async () => {
    const backend = convexTest({ schema, modules });
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const uploadId = `upload:${"a".repeat(48)}`;
    const graphId = await derivePublishedGraphId(OWNER_ID, uploadId);
    await backend.run(async (ctx) => {
      await ctx.db.insert("caseGraphs", {
        graphId,
        caseId: graph.caseId,
        version: 2,
        lifecycle: "published",
        visibility: "private",
        ownerId: OWNER_ID,
        uploadId,
        title: graph.title,
        graphJson: JSON.stringify(graph),
        graphSchemaVersion: graph.schemaVersion,
        compilerMetadataJson: JSON.stringify(graph.compilerMetadata),
        sourceDigest: graph.compilerMetadata.sourceContentHash,
        createdBy: "user",
        createdAt: Date.parse("2026-07-19T03:00:00.000Z"),
      });
    });
    const request = {
      schemaVersion: HEARING_START_SCHEMA_VERSION,
      requestId: "19191919-1919-4919-8919-191919191919",
      requestedAt: "2026-07-19T03:00:00.000Z",
      case: { kind: "owned", uploadId },
      userSide: "user",
    } as const;

    const view = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(request),
      }),
    );
    expect(view.case).toMatchObject({
      caseId: graph.caseId,
      title: graph.title,
    });
    await expect(
      backend.action(startReference, {
        ownerId: OTHER_OWNER_ID,
        requestJson: JSON.stringify({
          ...request,
          requestId: "18181818-1818-4818-8818-181818181818",
        }),
      }),
    ).rejects.toThrow("HEARING_CASE_NOT_FOUND");
  });

  it.each([
    ["user", "RUNTIME_USER_COUNSEL_AMBIGUOUS"],
    ["opposing", "RUNTIME_OPPOSING_COUNSEL_AMBIGUOUS"],
  ] as const)(
    "rejects an ambiguous %s counsel roster before creating a trial",
    async (side, errorCode) => {
      const backend = convexTest({ schema, modules });
      const graph = createThreeWitnessCaseGraphV1Fixture();
      const sourceParty = graph.parties.find(
        (party) => party.simulationSide === side,
      );
      if (!sourceParty) throw new Error(`Fixture requires a ${side} party`);
      graph.parties.push({
        ...sourceParty,
        partyId: `party_extra_${side}`,
        name: `Additional ${side} party`,
        proceduralRole: "third_party",
        counselName: `Additional ${side} counsel`,
        provenance: sourceParty.provenance.map((entry, index) => ({
          ...entry,
          provenanceId: `prov_party_extra_${side}_${index}`,
        })),
      });
      const parsedGraph = CaseGraphV1Schema.parse(graph);
      const uploadId = `upload:${(side === "user" ? "b" : "c").repeat(48)}`;
      const graphId = await derivePublishedGraphId(OWNER_ID, uploadId);
      await backend.run(async (ctx) => {
        await ctx.db.insert("caseGraphs", {
          graphId,
          caseId: parsedGraph.caseId,
          version: 2,
          lifecycle: "published",
          visibility: "private",
          ownerId: OWNER_ID,
          uploadId,
          title: parsedGraph.title,
          graphJson: JSON.stringify(parsedGraph),
          graphSchemaVersion: parsedGraph.schemaVersion,
          compilerMetadataJson: JSON.stringify(parsedGraph.compilerMetadata),
          sourceDigest: parsedGraph.compilerMetadata.sourceContentHash,
          createdBy: "user",
          createdAt: Date.parse("2026-07-19T03:00:00.000Z"),
        });
      });

      await expect(
        backend.action(startReference, {
          ownerId: OWNER_ID,
          requestJson: JSON.stringify({
            ...startRequest(),
            requestId:
              side === "user"
                ? "17171717-1717-4717-8717-171717171717"
                : "16161616-1616-4616-8616-161616161616",
            case: { kind: "owned", uploadId },
          }),
        }),
      ).rejects.toThrow(errorCode);
      const persisted = await backend.run(async (ctx) => ({
        projections: await ctx.db.query("trialProjections").collect(),
        events: await ctx.db.query("trialEvents").collect(),
      }));
      expect(persisted).toEqual({ projections: [], events: [] });
    },
  );

  it("continues a partially appended command when the exact request is retried", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const request = playerCommand(
      started,
      "21212121-2121-4121-8121-212121212121",
      "2026-07-19T03:00:30.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const actionId = `action:${started.trial.trialId}:${request.requestId}:call-witness`;
    const partialAction = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId,
      trialId: started.trial.trialId,
      expectedStateVersion: request.expectedStateVersion,
      actor: {
        actorId: started.player.actorId,
        role: started.player.actorRole,
        side: started.player.side,
        witnessId: null,
      },
      source: "user",
      requestedAt: request.requestedAt,
      causationId: request.expectedLastEventId,
      correlationId: started.trial.trialId,
      responseId: null,
      interruptId: null,
      modelMetadata: null,
      type: "CALL_WITNESS",
      payload: {
        witnessId: "witness_rina_shah",
        calledBySide: started.trial.userSide,
      },
    });
    await expect(
      backend.mutation(appendPlayerForOwnerReference, {
        ownerId: OWNER_ID,
        actionJson: JSON.stringify(partialAction),
      }),
    ).resolves.toMatchObject({ committedStateVersion: 4, replayed: false });

    const partialView = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: started.trial.trialId,
      }),
    );
    expect(partialView.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "awaiting_oath",
    });

    const recovered = HearingRuntimeViewV1Schema.parse(
      await backend.action(commandReference, {
        ownerId: OWNER_ID,
        trialId: started.trial.trialId,
        commandJson: JSON.stringify(request),
      }),
    );
    expect(recovered.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "direct",
    });
    expect(recovered.trial.version).toBe(5);

    const events = await backend.run(async (ctx) =>
      ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", started.trial.trialId),
        )
        .collect(),
    );
    expect(
      events.filter((event) => event.eventType === "CALL_WITNESS"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === "SWEAR_WITNESS"),
    ).toHaveLength(1);
  });

  it("prepares only a fresh witness-scoped model request and never fabricates testimony", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const called = await command(
      backend,
      started,
      "23232323-2323-4232-8232-232323232323",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const question = await prepare(
      backend,
      called.view,
      "24242424-2424-4242-8242-242424242424",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "When did you send the battery safety complaint?",
        presentedEvidenceIds: [],
      },
    );
    expect(question.preparation.status).toBe("model_required");
    if (!isHearingWitnessModelRequiredPreparation(question.preparation)) {
      throw new Error("Expected witness model preparation");
    }
    const preparedRequest = question.preparation.request;
    expect(preparedRequest).toMatchObject({
      trialId: called.view.trial.trialId,
      actorId: "actor:witness:witness_rina_shah",
      witnessId: "witness_rina_shah",
      expectedStateVersion: called.view.trial.version + 2,
      question: {
        text: "When did you send the battery safety complaint?",
        presentedEvidenceIds: [],
      },
      knowledgeView: {
        actorRole: "witness",
        witness: { witnessId: "witness_rina_shah" },
      },
    });
    expect(preparedRequest.callId).toMatch(
      /^call:witness:[a-f0-9]{64}:[a-f0-9-]{36}$/,
    );

    const serialized = JSON.stringify(question.preparation);
    const seededGraph = await backend.run(async (ctx) => {
      const record = await ctx.db.query("caseGraphs").first();
      if (!record) throw new Error("Expected seeded graph");
      return CaseGraphV1Schema.parse(JSON.parse(record.graphJson));
    });
    const otherWitnessHiddenFact = seededGraph.facts.find(
      (fact) =>
        fact.initialStatus === "hidden" &&
        !fact.witnessIds.includes("witness_rina_shah"),
    );
    if (!otherWitnessHiddenFact) {
      throw new Error("Fixture requires another witness's hidden fact");
    }
    expect(serialized).not.toContain(OWNER_ID);
    expect(serialized).not.toContain("stateJson");
    expect(serialized).not.toContain("graphJson");
    expect(serialized).not.toContain("policySnapshot");
    expect(serialized).not.toContain(otherWitnessHiddenFact.factId);
    expect(serialized).not.toContain(otherWitnessHiddenFact.proposition);
    for (const witness of called.view.witnesses) {
      if (witness.witnessId !== "witness_rina_shah") {
        expect(serialized).not.toContain(witness.witnessId);
      }
    }

    const retry = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        commandJson: JSON.stringify(question.request),
      }),
    );
    expect(retry.status).toBe("model_required");
    if (!isHearingWitnessModelRequiredPreparation(retry)) {
      throw new Error("Expected retry model preparation");
    }
    expect(retry.request.responseId).toBe(preparedRequest.responseId);
    expect(retry.request.callId).not.toBe(preparedRequest.callId);

    await expect(
      backend.action(commandReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        commandJson: JSON.stringify(question.request),
      }),
    ).rejects.toThrow("MODEL_REQUIRED");
    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", called.view.trial.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
    }));
    expect(
      stored.events.filter((event) => event.eventType === "ASK_QUESTION"),
    ).toHaveLength(1);
    expect(
      stored.events.filter((event) => event.eventType === "REQUEST_RESPONSE"),
    ).toHaveLength(1);
    expect(
      stored.events.filter((event) => event.eventType === "ANSWER_QUESTION"),
    ).toEqual([]);
    expect(stored.events.some((event) => event.source === "ai")).toBe(false);
    expect(stored.calls).toEqual([]);
  });

  it("atomically commits and exactly replays one validated AI answer and model audit", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const called = await command(
      backend,
      started,
      "25252525-2525-4252-8252-252525252525",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const question = await prepare(
      backend,
      called.view,
      "26262626-2626-4262-8262-262626262626",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did you personally observe?",
        presentedEvidenceIds: [],
      },
    );
    if (!isHearingWitnessModelRequiredPreparation(question.preparation)) {
      throw new Error("Expected witness model preparation");
    }
    const generation = await fakeWitnessGeneration(
      question.preparation,
      "2026-07-19T03:02:02.000Z",
    );
    const committedPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    if (committedPreparation.status !== "completed") {
      throw new Error("Direct witness answer should return player control");
    }
    const committed = committedPreparation.view;
    expect(committed.trial.version).toBe(called.view.trial.version + 3);
    expect(committed.activeQuestion).toBeNull();
    expect(committed.transcript.map((turn) => turn.actor.role)).toEqual([
      "user_counsel",
      "witness",
    ]);

    const exactCommitReplay = HearingCommandPreparationSchema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    expect(exactCommitReplay).toEqual(committedPreparation);
    const exactPrepareReplay = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        commandJson: JSON.stringify(question.request),
      }),
    );
    expect(exactPrepareReplay).toEqual({
      schemaVersion: "hearing-command-preparation.v1",
      status: "completed",
      view: committed,
    });

    const stored = await backend.run(async (ctx) => ({
      answerEvents: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", called.view.trial.trialId),
          )
          .collect()
      ).filter((event) => event.eventType === "ANSWER_QUESTION"),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
    }));
    expect(stored.answerEvents).toHaveLength(1);
    expect(stored.answerEvents[0]).toMatchObject({
      source: "ai",
      model: "gpt-5.6-luna",
      responseId: generation.responseId,
      promptVersion: generation.modelMetadata.promptVersion,
    });
    expect(stored.calls).toHaveLength(1);
    expect(stored.calls[0]).toMatchObject({
      ownerId: OWNER_ID,
      trialId: called.view.trial.trialId,
      callId: generation.callId,
      status: "accepted",
      attemptCount: 1,
    });
    expect(stored.attempts).toHaveLength(1);
    expect(stored.attempts[0]).toMatchObject({
      ownerId: OWNER_ID,
      callId: generation.callId,
      attempt: 1,
      status: "accepted",
    });
    expect(JSON.parse(stored.calls[0]!.traceJson)).toMatchObject({
      committedActionId: stored.answerEvents[0]!.actionId,
      committedEventId: stored.answerEvents[0]!.eventId,
    });
  });

  it("rejects foreign, cross-owner, and stale witness generations without an answer or trace", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const called = await command(
      backend,
      started,
      "27272727-2727-4272-8272-272727272727",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const question = await prepare(
      backend,
      called.view,
      "28282828-2828-4282-8282-282828282828",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did you personally observe?",
        presentedEvidenceIds: [],
      },
    );
    if (!isHearingWitnessModelRequiredPreparation(question.preparation)) {
      throw new Error("Expected witness model preparation");
    }
    const generation = await fakeWitnessGeneration(
      question.preparation,
      "2026-07-19T03:02:02.000Z",
    );

    const graph = await backend.run(async (ctx) => {
      const record = await ctx.db.query("caseGraphs").first();
      if (!record) throw new Error("Expected seeded graph");
      return CaseGraphV1Schema.parse(JSON.parse(record.graphJson));
    });
    const allowedFactIds = new Set(
      question.preparation.request.knowledgeView.witness.facts.map(
        (fact) => fact.factId,
      ),
    );
    const foreignFact = graph.facts.find(
      (fact) => !allowedFactIds.has(fact.factId),
    );
    if (!foreignFact)
      throw new Error("Fixture requires a foreign witness fact");
    const foreignOutput = WitnessAnswerModelOutputSchema.parse({
      ...generation.output,
      segments: generation.output.segments.map((segment, index) =>
        index === 0 ? { ...segment, factIds: [foreignFact.factId] } : segment,
      ),
    });
    const foreignHash = hashWitnessAnswerModelOutput(foreignOutput);
    const foreignCitations = witnessAnswerOutputCitations(foreignOutput);
    const foreignGeneration = HearingWitnessGenerationPrecommitSchema.parse({
      ...generation,
      output: foreignOutput,
      trace: {
        ...generation.trace,
        acceptedCitations: foreignCitations,
        acceptedCitationCount: Object.values(foreignCitations).reduce(
          (count, identifiers) => count + identifiers.length,
          0,
        ),
        outputHash: foreignHash,
        outputCharacterCount: JSON.stringify(foreignOutput).length,
        attempts: generation.trace.attempts.map((attempt) => ({
          ...attempt,
          outputHash: foreignHash,
          proposedCitationCount: 1,
        })),
      },
    });
    await expect(
      backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(foreignGeneration),
      }),
    ).rejects.toThrow("WITNESS_GENERATION_INVALID");

    await expect(
      backend.action(commitWitnessGenerationReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");

    const pendingState = await backend.run(async (ctx) => {
      const projection = await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", called.view.trial.trialId),
        )
        .unique();
      if (!projection) throw new Error("Expected trial projection");
      return TrialStateV3Schema.parse(JSON.parse(projection.stateJson));
    });
    const systemActor = Object.values(pendingState.actors).find(
      (actor) => actor.role === "system",
    );
    const lastEventId = pendingState.eventIds.at(-1);
    if (!systemActor || !lastEventId) {
      throw new Error("Expected system actor and pending head");
    }
    const cancel = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId: `action:${called.view.trial.trialId}:cancel-stale-witness-response`,
      trialId: called.view.trial.trialId,
      expectedStateVersion: pendingState.version,
      actor: systemActor,
      source: "system",
      requestedAt: "2026-07-19T03:02:03.000Z",
      causationId: lastEventId,
      correlationId: called.view.trial.trialId,
      responseId: generation.responseId,
      interruptId: null,
      modelMetadata: null,
      type: "CANCEL_RESPONSE",
      payload: { responseId: generation.responseId },
    });
    await backend.mutation(appendTrustedForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify(cancel),
    });
    await expect(
      backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    ).rejects.toThrow("WITNESS_GENERATION_STALE");

    const rejectedWrites = await backend.run(async (ctx) => ({
      answers: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", called.view.trial.trialId),
          )
          .collect()
      ).filter((event) => event.eventType === "ANSWER_QUESTION"),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
    }));
    expect(rejectedWrites.answers).toEqual([]);
    expect(rejectedWrites.calls).toEqual([]);
    expect(rejectedWrites.attempts).toEqual([]);
  });

  it("resumes the private opponent plan, public counsel question, witness answer, and examination end without auto-waiving", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const called = await command(
      backend,
      started,
      "91919191-9191-4191-8191-919191919191",
      "2026-07-19T03:10:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const directQuestion = await prepare(
      backend,
      called.view,
      "92929292-9292-4292-8292-929292929292",
      "2026-07-19T03:11:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did you personally observe?",
        presentedEvidenceIds: [],
      },
    );
    const directAnswer = await commitModelPreparation(
      backend,
      directQuestion.preparation,
      "2026-07-19T03:11:02.000Z",
    );
    if (directAnswer.status !== "completed") {
      throw new Error("Direct answer should restore player control");
    }

    const finishRequest = playerCommand(
      directAnswer.view,
      "93939393-9393-4393-8393-939393939393",
      "2026-07-19T03:12:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
      },
    );
    const firstPlan = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        commandJson: JSON.stringify(finishRequest),
      }),
    );
    if (!isHearingOpponentPlanModelRequiredPreparation(firstPlan)) {
      throw new Error("Completed direct should require an opponent plan");
    }
    expect(firstPlan.request.procedure).toMatchObject({
      trigger: "player_examination_completed",
      activeWitnessId: "witness_rina_shah",
      activeExaminationKind: "cross",
      answeredQuestionCount: 0,
    });
    const directTestimonyIds =
      firstPlan.request.knowledgeView.publicRecord.testimony.map(
        ({ testimonyId }) => testimonyId,
      );
    expect(directTestimonyIds).toHaveLength(1);
    expect(firstPlan.request.opportunities).toMatchObject({
      callableWitnessIds: [],
      questionableWitnessIds: ["witness_rina_shah"],
      offerableEvidenceIds: [],
      foundationTestimonyIds: [],
      strikeableTestimonyIds: directTestimonyIds,
      permittedObjectionGrounds: [],
      canObject: false,
      canRequestNegotiation: false,
      canRest: false,
      canClose: false,
    });
    const serializedPlan = JSON.stringify(firstPlan);
    expect(serializedPlan).not.toContain(OWNER_ID);
    expect(serializedPlan).not.toContain("stateJson");
    expect(serializedPlan).not.toContain("graphJson");
    expect(serializedPlan).not.toContain("policySnapshot");
    expect(serializedPlan).not.toContain("pendingDirectiveJson");
    expect(serializedPlan).not.toContain("integrityHash");

    const afterDirect = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
      }),
    );
    expect(afterDirect.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "cross",
    });
    const afterDirectEvents = await backend.run(async (ctx) =>
      ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", directAnswer.view.trial.trialId),
        )
        .collect(),
    );
    expect(
      afterDirectEvents.filter(
        (event) =>
          event.eventType === "END_EXAMINATION" &&
          event.actorRole === "opposing_counsel",
      ),
    ).toEqual([]);
    expect(
      afterDirectEvents.filter(
        (event) => event.eventType === "RELEASE_WITNESS",
      ),
    ).toEqual([]);

    const retriedPlan = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        commandJson: JSON.stringify(finishRequest),
      }),
    );
    if (!isHearingOpponentPlanModelRequiredPreparation(retriedPlan)) {
      throw new Error("Exact END retry should resume opponent planning");
    }
    expect(retriedPlan.request.decisionId).toBe(firstPlan.request.decisionId);
    expect(retriedPlan.request.callId).not.toBe(firstPlan.request.callId);

    const planGeneration = await fakeOpponentPlanGeneration(
      retriedPlan,
      "2026-07-19T03:12:02.000Z",
      "question",
    );
    await expect(
      backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(planGeneration),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    const counselPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(planGeneration),
      }),
    );
    if (!isHearingCounselResponseModelRequiredPreparation(counselPreparation)) {
      throw new Error("Accepted plan should resume at public counsel speech");
    }
    expect(counselPreparation.request.directive).toMatchObject({
      kind: "question_witness",
      witnessId: "witness_rina_shah",
    });
    expect(counselPreparation.request.knowledgeView.counsel).toMatchObject({
      strategyMemory: [],
      privateSettlement: null,
    });
    const serializedCounsel = JSON.stringify(counselPreparation);
    expect(serializedCounsel).not.toContain(OWNER_ID);
    expect(serializedCounsel).not.toContain("pendingDirectiveJson");
    expect(serializedCounsel).not.toContain("privateNotes");

    const exactPlanReplay = HearingCommandPreparationSchema.parse(
      await backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(planGeneration),
      }),
    );
    if (!isHearingCounselResponseModelRequiredPreparation(exactPlanReplay)) {
      throw new Error("Exact plan replay should resume counsel generation");
    }
    expect(exactPlanReplay.request.decisionId).toBe(
      counselPreparation.request.decisionId,
    );
    expect(exactPlanReplay.request.callId).not.toBe(
      counselPreparation.request.callId,
    );

    const counselGeneration = await fakeCounselGeneration(
      counselPreparation,
      "2026-07-19T03:12:03.000Z",
    );
    await expect(
      backend.action(commitCounselGenerationReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(counselGeneration),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    const responseWindow = HearingCommandPreparationSchema.parse(
      await backend.action(commitCounselGenerationReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(counselGeneration),
      }),
    );
    if (responseWindow.status !== "completed") {
      throw new Error("Counsel question should yield a player decision window");
    }
    expect(responseWindow.view.capabilities).toMatchObject({
      canObject: true,
      canContinueResponse: true,
    });
    expect(responseWindow.view.activeQuestion).toMatchObject({
      examinationKind: "cross",
      pendingResponseId: expect.any(String),
    });

    const exactCounselReplay = HearingCommandPreparationSchema.parse(
      await backend.action(commitCounselGenerationReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(counselGeneration),
      }),
    );
    if (exactCounselReplay.status !== "completed") {
      throw new Error("Exact counsel replay should restore the decision window");
    }
    expect(exactCounselReplay.view).toEqual(responseWindow.view);

    const witnessPreparation = await continueOpposingResponse(
      backend,
      responseWindow,
      "2026-07-19T03:12:03.500Z",
    );
    if (!isHearingWitnessModelRequiredPreparation(witnessPreparation)) {
      throw new Error("Continuing should require witness generation");
    }
    expect(witnessPreparation.request.question).toMatchObject({
      examinationKind: "cross",
    });
    expect(witnessPreparation.request.witnessId).toBe("witness_rina_shah");

    const exactContinueReplay = await continueOpposingResponse(
      backend,
      exactCounselReplay,
      "2026-07-19T03:12:03.500Z",
    );
    if (!isHearingWitnessModelRequiredPreparation(exactContinueReplay)) {
      throw new Error("Exact continue replay should resume witness generation");
    }
    expect(exactContinueReplay.request.responseId).toBe(
      witnessPreparation.request.responseId,
    );
    expect(exactContinueReplay.request.callId).not.toBe(
      witnessPreparation.request.callId,
    );

    const witnessGeneration = await fakeWitnessGeneration(
      witnessPreparation,
      "2026-07-19T03:12:04.000Z",
    );
    const nextPlan = HearingCommandPreparationSchema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(witnessGeneration),
      }),
    );
    if (!isHearingOpponentPlanModelRequiredPreparation(nextPlan)) {
      throw new Error("Cross answer should resume at a fresh opponent plan");
    }
    expect(nextPlan.request.procedure).toMatchObject({
      trigger: "opponent_turn_continues",
      answeredQuestionCount: 1,
    });

    const exactWitnessReplay = HearingCommandPreparationSchema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(witnessGeneration),
      }),
    );
    if (!isHearingOpponentPlanModelRequiredPreparation(exactWitnessReplay)) {
      throw new Error("Exact witness replay should resume opponent planning");
    }
    expect(exactWitnessReplay.request.decisionId).toBe(
      nextPlan.request.decisionId,
    );
    expect(exactWitnessReplay.request.callId).not.toBe(nextPlan.request.callId);

    const endPlanGeneration = await fakeOpponentPlanGeneration(
      nextPlan,
      "2026-07-19T03:12:05.000Z",
      "end",
    );
    const endCounselPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(endPlanGeneration),
      }),
    );
    if (
      !isHearingCounselResponseModelRequiredPreparation(endCounselPreparation)
    ) {
      throw new Error(
        "Ending plan should still require durable counsel speech",
      );
    }
    expect(endCounselPreparation.request.directive).toEqual({
      kind: "end_examination",
      disposition: "completed",
    });
    const endCounselGeneration = await fakeCounselGeneration(
      endCounselPreparation,
      "2026-07-19T03:12:06.000Z",
    );
    const redirect = HearingCommandPreparationSchema.parse(
      await backend.action(commitCounselGenerationReference, {
        ownerId: OWNER_ID,
        trialId: directAnswer.view.trial.trialId,
        generationJson: JSON.stringify(endCounselGeneration),
      }),
    );
    if (redirect.status !== "completed") {
      throw new Error("Completed cross should yield player redirect");
    }
    expect(redirect.view.activeAppearance).toMatchObject({ stage: "redirect" });

    const redirectWaiver = await prepare(
      backend,
      redirect.view,
      "94949494-9494-4494-8494-949494949494",
      "2026-07-19T03:13:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_rina_shah",
        examinationKind: "redirect",
      },
    );
    expect(redirectWaiver.preparation.status).toBe("completed");
    if (redirectWaiver.preparation.status !== "completed") {
      throw new Error("Waived redirect should release the witness");
    }
    expect(redirectWaiver.preparation.view.activeAppearance).toBeNull();

    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", directAnswer.view.trial.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
    }));
    expect(
      stored.events.filter(
        (event) => event.eventType === "UPDATE_OPPOSING_STRATEGY",
      ),
    ).toHaveLength(2);
    expect(
      stored.events.filter(
        (event) => event.eventType === "ASK_QUESTION" && event.source === "ai",
      ),
    ).toHaveLength(1);
    expect(
      stored.events.filter(
        (event) =>
          event.eventType === "REQUEST_RESPONSE" && event.source === "system",
      ),
    ).toHaveLength(2);
    expect(
      stored.events.filter(
        (event) =>
          event.eventType === "END_EXAMINATION" &&
          event.actorRole === "opposing_counsel",
      ),
    ).toHaveLength(1);
    expect(
      stored.events.filter((event) => event.eventType === "RELEASE_WITNESS"),
    ).toHaveLength(1);
    expect(
      stored.calls.filter((call) => call.status === "accepted"),
    ).toHaveLength(6);
  });

  it.each(["granted", "denied"] as const)(
    "persists an AI strike motion, atomically commits a %s judge ruling, and resumes planning",
    async (ruling) => {
      const backend = convexTest({ schema, modules });
      const planPreparation = await prepareInitialOpponentCross(backend);
      if (!isHearingOpponentPlanModelRequiredPreparation(planPreparation)) {
        throw new Error("Expected opponent planner preparation");
      }
      const publicTestimonyIds =
        planPreparation.request.knowledgeView.publicRecord.testimony.map(
          ({ testimonyId }) => testimonyId,
        );
      expect(publicTestimonyIds).toHaveLength(1);
      expect(
        planPreparation.request.opportunities.strikeableTestimonyIds,
      ).toEqual(publicTestimonyIds);
      const testimonyId = publicTestimonyIds[0];
      if (!testimonyId) throw new Error("Expected strikeable testimony");

      const planGeneration = await fakeOpponentPlanGeneration(
        planPreparation,
        "2026-07-19T03:15:00.000Z",
        "strike",
      );
      const counselPreparation = HearingCommandPreparationSchema.parse(
        await backend.action(commitOpponentPlanGenerationReference, {
          ownerId: OWNER_ID,
          trialId: planPreparation.request.trialId,
          generationJson: JSON.stringify(planGeneration),
        }),
      );
      if (!isHearingCounselResponseModelRequiredPreparation(counselPreparation)) {
        throw new Error("A selected strike must require public counsel speech");
      }
      expect(counselPreparation.request.directive).toEqual({
        kind: "move_to_strike",
        testimonyIds: [testimonyId],
        basis:
          "The identified answer lacks adequate foundation and should leave the active record.",
        permittedFactIds: [],
        permittedEvidenceIds: [],
        permittedTestimonyIds: [testimonyId],
      });

      const persistedPlan = HearingCommandPreparationSchema.parse(
        await backend.action(commitOpponentPlanGenerationReference, {
          ownerId: OWNER_ID,
          trialId: planPreparation.request.trialId,
          generationJson: JSON.stringify(planGeneration),
        }),
      );
      if (!isHearingCounselResponseModelRequiredPreparation(persistedPlan)) {
        throw new Error("Exact plan replay must restore the strike directive");
      }
      expect(persistedPlan.request.directive).toEqual(
        counselPreparation.request.directive,
      );
      expect(persistedPlan.request.callId).not.toBe(
        counselPreparation.request.callId,
      );

      const counselGeneration = await fakeCounselGeneration(
        counselPreparation,
        "2026-07-19T03:15:01.000Z",
      );
      const judgePreparation = HearingCommandPreparationSchema.parse(
        await backend.action(commitCounselGenerationReference, {
          ownerId: OWNER_ID,
          trialId: planPreparation.request.trialId,
          generationJson: JSON.stringify(counselGeneration),
        }),
      );
      if (!isHearingJudgeResponseModelRequiredPreparation(judgePreparation)) {
        throw new Error("Committed strike speech must require a judge ruling");
      }
      const judgeDirective = judgePreparation.request.directive;
      if (judgeDirective.kind !== "rule_on_strike_motion") {
        throw new Error("Expected a strike-motion judge directive");
      }
      expect(judgeDirective).toMatchObject({
        kind: "rule_on_strike_motion",
        triggerEventId: judgePreparation.request.expectedLastEventId,
        testimonyIds: [testimonyId],
        permittedRulings: ["granted", "denied"],
      });
      expect(
        judgePreparation.request.knowledgeView.publicRecord.testimony.map(
          (testimony) => testimony.testimonyId,
        ),
      ).toContain(testimonyId);
      expect([
        ...judgePreparation.request.knowledgeView.publicRecord.facts.flatMap(
          ({ sourceSegmentIds }) => sourceSegmentIds,
        ),
        ...judgePreparation.request.knowledgeView.publicRecord.evidence.flatMap(
          ({ sourceSegmentIds }) => sourceSegmentIds,
        ),
      ]).toEqual([]);
      expect(judgePreparation.request.knowledgeView.currentExchange).toMatchObject({
        speakerActorId: counselPreparation.request.actorId,
        text: "Move to strike that answer for lack of foundation.",
        factIds: [],
        evidenceIds: [],
      });

      const beforeRuling = await backend.run(async (ctx) => ({
        events: await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", planPreparation.request.trialId),
          )
          .collect(),
        calls: await ctx.db.query("courtroomModelCalls").collect(),
      }));
      const motionEvent = beforeRuling.events.at(-1);
      expect(motionEvent).toMatchObject({
        eventType: "MOVE_TO_STRIKE",
        actorRole: "opposing_counsel",
        source: "ai",
      });
      expect(JSON.parse(motionEvent?.payloadJson ?? "null")).toMatchObject({
        motionId: judgeDirective.motionId,
        testimonyIds: [testimonyId],
        speech: {
          text: "Move to strike that answer for lack of foundation.",
          citations: { testimonyIds: [testimonyId] },
        },
      });

      const pendingView = HearingRuntimeViewV1Schema.parse(
        await backend.action(readReference, {
          ownerId: OWNER_ID,
          trialId: planPreparation.request.trialId,
        }),
      );
      await expect(
        backend.action(prepareCommandReference, {
          ownerId: OWNER_ID,
          trialId: planPreparation.request.trialId,
          commandJson: JSON.stringify(
            playerCommand(
              pendingView,
              "94949494-9494-4494-8494-949494949494",
              "2026-07-19T03:15:01.500Z",
              {
                type: "finish_witness",
                witnessId: "witness_rina_shah",
                examinationKind: "cross",
              },
            ),
          ),
        }),
      ).rejects.toThrow("STRIKE_RULING_PENDING");
      const afterRejectedCommand = await backend.run(async (ctx) => ({
        events: (await ctx.db.query("trialEvents").collect()).length,
        calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
      }));
      expect(afterRejectedCommand).toEqual({
        events: beforeRuling.events.length,
        calls: beforeRuling.calls.length,
      });

      const judgeGeneration = fakeJudgeGeneration(
        judgePreparation,
        "2026-07-19T03:15:02.000Z",
        ruling,
      );
      const continuation = HearingCommandPreparationSchema.parse(
        await backend.action(commitJudgeGenerationReference, {
          ownerId: OWNER_ID,
          trialId: planPreparation.request.trialId,
          generationJson: JSON.stringify(judgeGeneration),
        }),
      );
      if (!isHearingOpponentPlanModelRequiredPreparation(continuation)) {
        throw new Error("A resolved strike motion must resume opponent planning");
      }
      expect(continuation.request.procedure).toMatchObject({
        activeWitnessId: "witness_rina_shah",
        activeExaminationKind: "cross",
        answeredQuestionCount: 0,
      });
      expect(continuation.request.opportunities.strikeableTestimonyIds).toEqual(
        [],
      );

      const afterRuling = await backend.run(async (ctx) => {
        const projection = await ctx.db
          .query("trialProjections")
          .withIndex("by_trial", (index) =>
            index.eq("trialId", planPreparation.request.trialId),
          )
          .unique();
        if (!projection) throw new Error("Expected trial projection");
        return {
          state: TrialStateV3Schema.parse(JSON.parse(projection.stateJson)),
          events: await ctx.db
            .query("trialEvents")
            .withIndex("by_trial_sequence", (index) =>
              index.eq("trialId", planPreparation.request.trialId),
            )
            .collect(),
          calls: await ctx.db.query("courtroomModelCalls").collect(),
        };
      });
      expect(afterRuling.events).toHaveLength(beforeRuling.events.length + 1);
      expect(afterRuling.calls).toHaveLength(beforeRuling.calls.length + 1);
      const rulingEvent = afterRuling.events.at(-1);
      expect(rulingEvent).toMatchObject({
        eventType:
          ruling === "granted" ? "STRIKE_TESTIMONY" : "DENY_STRIKE_MOTION",
        actorRole: "judge",
        source: "ai",
      });
      expect(
        afterRuling.state.strikeMotions[judgeDirective.motionId],
      ).toMatchObject({
        testimonyIds: [testimonyId],
        status: ruling,
        rulingEventId: rulingEvent?.eventId,
      });
      const testimony = afterRuling.state.testimony[testimonyId];
      expect(testimony.status).toBe(
        ruling === "granted" ? "stricken" : "active",
      );
      expect(afterRuling.state.transcriptTurns[testimony.turnId].status).toBe(
        ruling === "granted" ? "stricken" : "active",
      );
      const judgeCall = afterRuling.calls.find(
        ({ callId }) => callId === judgeGeneration.callId,
      );
      expect(judgeCall).toMatchObject({
        status: "accepted",
        task: "judge_response",
      });
      expect(JSON.parse(judgeCall?.traceJson ?? "null")).toMatchObject({
        committedActionId: rulingEvent?.actionId,
        committedEventId: rulingEvent?.eventId,
      });

      const exactReplay = HearingCommandPreparationSchema.parse(
        await backend.action(commitJudgeGenerationReference, {
          ownerId: OWNER_ID,
          trialId: planPreparation.request.trialId,
          generationJson: JSON.stringify(judgeGeneration),
        }),
      );
      if (!isHearingOpponentPlanModelRequiredPreparation(exactReplay)) {
        throw new Error("Exact ruling replay must resume opponent planning");
      }
      expect(exactReplay.request.decisionId).toBe(
        continuation.request.decisionId,
      );
      expect(exactReplay.request.callId).not.toBe(
        continuation.request.callId,
      );
      const replayCounts = await backend.run(async (ctx) => ({
        events: (await ctx.db.query("trialEvents").collect()).length,
        calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
      }));
      expect(replayCounts).toEqual({
        events: afterRuling.events.length,
        calls: afterRuling.calls.length,
      });
    },
  );

  it("returns the current view without generic continuation during an active interruption", async () => {
    const backend = convexTest({ schema, modules });
    const rulingPreparation = await prepareUserObjectionRuling(backend);
    const currentView = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: rulingPreparation.request.trialId,
      }),
    );
    const before = await backend.run(async (ctx) => ({
      events: (await ctx.db.query("trialEvents").collect()).length,
      calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
    }));

    const continuation = HearingCommandPreparationSchema.parse(
      await backend.action(prepareContinuationReference, {
        ownerId: OWNER_ID,
        trialId: rulingPreparation.request.trialId,
      }),
    );

    expect(continuation).toEqual({
      schemaVersion: "hearing-command-preparation.v1",
      status: "completed",
      view: currentView,
    });
    expect(
      await backend.run(async (ctx) => ({
        events: (await ctx.db.query("trialEvents").collect()).length,
        calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
      })),
    ).toEqual(before);
  });

  it("uses canonical continuation when no active interruption exists", async () => {
    const backend = convexTest({ schema, modules });
    const initial = await prepareInitialOpponentCross(backend);
    if (!isHearingOpponentPlanModelRequiredPreparation(initial)) {
      throw new Error("Expected initial opponent planner preparation");
    }

    const continuation = HearingCommandPreparationSchema.parse(
      await backend.action(prepareContinuationReference, {
        ownerId: OWNER_ID,
        trialId: initial.request.trialId,
      }),
    );
    if (!isHearingOpponentPlanModelRequiredPreparation(continuation)) {
      throw new Error("Canonical continuation should resume opponent planning");
    }
    expect(continuation.request.decisionId).toBe(initial.request.decisionId);
    expect(continuation.request.callId).not.toBe(initial.request.callId);
  });

  it("recovers an existing counsel question whose response continuation is missing", async () => {
    const backend = convexTest({ schema, modules });
    const planPreparation = await prepareInitialOpponentCross(backend);
    if (!isHearingOpponentPlanModelRequiredPreparation(planPreparation)) {
      throw new Error("Expected opponent plan preparation");
    }
    const planGeneration = await fakeOpponentPlanGeneration(
      planPreparation,
      "2026-07-19T03:20:00.000Z",
      "question",
    );
    const counselPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OWNER_ID,
        trialId: planPreparation.request.trialId,
        generationJson: JSON.stringify(planGeneration),
      }),
    );
    if (!isHearingCounselResponseModelRequiredPreparation(counselPreparation)) {
      throw new Error("Expected counsel response preparation");
    }
    const generation = await fakeCounselGeneration(
      counselPreparation,
      "2026-07-19T03:20:01.000Z",
    );
    if (
      generation.output.proposedAction.kind !== "ask_question" ||
      generation.trace.completedAt === null
    ) {
      throw new Error("Fixture requires a completed counsel question");
    }
    const request = counselPreparation.request;
    if (request.appearance === null) {
      throw new Error("Fixture requires a counsel examination appearance");
    }
    const material = {
      trialId: request.trialId,
      decisionId: request.decisionId,
    };
    const actor = await backend.run(async (ctx) => {
      const projection = await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", request.trialId))
        .unique();
      if (!projection) throw new Error("Expected trial projection");
      const state = TrialStateV3Schema.parse(JSON.parse(projection.stateJson));
      const counsel = state.actors[request.actorId];
      if (!counsel) throw new Error("Expected opposing counsel actor");
      return counsel;
    });
    const citations = counselResponseOutputCitations(generation.output);
    const primary = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId: stableTestRuntimeId("action:counsel-turn", material),
      trialId: request.trialId,
      expectedStateVersion: request.expectedStateVersion,
      actor,
      source: "ai",
      requestedAt: generation.trace.completedAt,
      causationId: request.expectedLastEventId,
      correlationId: request.trialId,
      responseId: null,
      interruptId: null,
      modelMetadata: generation.modelMetadata,
      type: "ASK_QUESTION",
      payload: {
        questionId: stableTestRuntimeId("question:counsel", material),
        witnessId: request.appearance.witnessId,
        examinationKind: request.appearance.examinationKind,
        text: generation.output.speechSegments
          .map((segment) => segment.text)
          .join(" "),
        turnId: stableTestRuntimeId("turn:counsel-question", material),
        presentedEvidenceIds:
          generation.output.proposedAction.presentedEvidenceIds,
        factIds: citations.factIds,
        evidenceIds: citations.evidenceIds,
        testimonyIds: citations.testimonyIds,
      },
    });
    if (primary.type !== "ASK_QUESTION") {
      throw new Error("Fixture primary action must be a question");
    }
    const primaryQuestionId = primary.payload.questionId;
    await backend.mutation(appendTrustedForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify(primary),
    });

    const partial = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: request.trialId,
      }),
    );
    expect(partial.activeQuestion).toMatchObject({
      questionId: primaryQuestionId,
      status: "open",
    });

    const recoveredWindow = HearingCommandPreparationSchema.parse(
      await backend.action(commitCounselGenerationReference, {
        ownerId: OWNER_ID,
        trialId: request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    if (recoveredWindow.status !== "completed") {
      throw new Error("Recovered question should yield a decision window");
    }
    expect(recoveredWindow.view.activeQuestion).toMatchObject({
      questionId: primaryQuestionId,
      pendingResponseId: expect.any(String),
    });
    const recovered = await continueOpposingResponse(
      backend,
      recoveredWindow,
      "2026-07-19T03:20:01.500Z",
    );
    if (!isHearingWitnessModelRequiredPreparation(recovered)) {
      throw new Error("Recovered question should require witness generation");
    }
    expect(recovered.request.question.questionId).toBe(primaryQuestionId);

    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", request.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
    }));
    expect(
      stored.events.filter(
        (event) => event.eventType === "ASK_QUESTION" && event.source === "ai",
      ),
    ).toHaveLength(1);
    expect(
      stored.events.filter(
        (event) =>
          event.eventType === "REQUEST_RESPONSE" && event.source === "system",
      ),
    ).toHaveLength(2);
    expect(
      stored.calls.filter(
        (call) =>
          call.callId === generation.callId && call.status === "accepted",
      ),
    ).toHaveLength(1);
  });

  it("pauses an opposing response and binds a user objection to the judge request", async () => {
    const backend = convexTest({ schema, modules });
    const planPreparation = await prepareInitialOpponentCross(backend);
    const planGeneration = await fakeOpponentPlanGeneration(
      planPreparation,
      "2026-07-19T03:30:00.000Z",
      "question",
    );
    const counselPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OWNER_ID,
        trialId: planPreparation.request.trialId,
        generationJson: JSON.stringify(planGeneration),
      }),
    );
    const counselGeneration = await fakeCounselGeneration(
      counselPreparation,
      "2026-07-19T03:30:01.000Z",
    );
    const responseWindow = HearingCommandPreparationSchema.parse(
      await backend.action(commitCounselGenerationReference, {
        ownerId: OWNER_ID,
        trialId: planPreparation.request.trialId,
        generationJson: JSON.stringify(counselGeneration),
      }),
    );
    if (responseWindow.status !== "completed") {
      throw new Error("Expected a player objection window");
    }
    const activeQuestion = responseWindow.view.activeQuestion;
    if (!activeQuestion?.pendingResponseId) {
      throw new Error("Expected a projected pending response");
    }
    expect(responseWindow.view.capabilities).toMatchObject({
      canObject: true,
      canContinueResponse: true,
    });
    const objectionCommand = playerCommand(
      responseWindow.view,
      "84848484-8484-4484-8484-848484848484",
      "2026-07-19T03:30:02.000Z",
      {
        type: "object",
        questionId: activeQuestion.questionId,
        responseId: activeQuestion.pendingResponseId,
        ground: "hearsay",
      },
    );
    const rulingPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        commandJson: JSON.stringify(objectionCommand),
      }),
    );
    if (!isHearingObjectionRulingModelRequiredPreparation(rulingPreparation)) {
      throw new Error("A committed interruption should require a judge ruling");
    }
    expect(rulingPreparation.request).toMatchObject({
      trialId: responseWindow.view.trial.trialId,
      actorId: expect.any(String),
      objection: {
        questionId: activeQuestion.questionId,
        objectorActorId: responseWindow.view.player.actorId,
        ground: "hearsay",
        interruptedResponseId: activeQuestion.pendingResponseId,
      },
      question: {
        questionId: activeQuestion.questionId,
        turnId: activeQuestion.questionTurnId,
        eventId: expect.any(String),
      },
      interruption: {
        interruptedResponseId: activeQuestion.pendingResponseId,
        sourceEventId: expect.any(String),
      },
      permittedOutcomes: [
        { ruling: "sustained", remedy: "cancel_response" },
        { ruling: "overruled", remedy: "resume_response" },
      ],
      knowledgeView: { actorRole: "judge" },
    });
    expect(rulingPreparation.request.expectedLastEventId).toBe(
      rulingPreparation.request.interruption?.sourceEventId,
    );

    const replay = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        commandJson: JSON.stringify(objectionCommand),
      }),
    );
    if (!isHearingObjectionRulingModelRequiredPreparation(replay)) {
      throw new Error("Exact objection replay should restore the judge request");
    }
    expect(replay.request.decisionId).toBe(rulingPreparation.request.decisionId);
    expect(replay.request.callId).not.toBe(rulingPreparation.request.callId);

    const events = await backend.run(async (ctx) =>
      ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", responseWindow.view.trial.trialId),
        )
        .collect(),
    );
    expect(events.slice(-2).map(({ eventType }) => eventType)).toEqual([
      "OBJECT",
      "BEGIN_INTERRUPTION",
    ]);
    expect(events.slice(-2).map(({ actorRole }) => actorRole)).toEqual([
      "user_counsel",
      "system",
    ]);
    expect(events.at(-1)?.eventId).toBe(rulingPreparation.request.expectedLastEventId);

    const generation = await fakeObjectionRulingGeneration(
      rulingPreparation,
      "2026-07-19T03:30:03.000Z",
      "overruled",
    );
    const callsBeforeRuling = await backend.run(async (ctx) =>
      (await ctx.db.query("courtroomModelCalls").collect()).length,
    );
    await expect(
      backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        generationJson: JSON.stringify({
          ...generation,
          output: {
            ...generation.output,
            reason: "A tampered ruling must fail its output-hash binding.",
          },
        }),
      }),
    ).rejects.toThrow("OBJECTION_RULING_GENERATION_INVALID");
    const rejectedCounts = await backend.run(async (ctx) => ({
      events: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", responseWindow.view.trial.trialId),
          )
          .collect()
      ).length,
      calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
    }));
    expect(rejectedCounts).toEqual({
      events: events.length,
      calls: callsBeforeRuling,
    });

    const witnessPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    if (!isHearingWitnessModelRequiredPreparation(witnessPreparation)) {
      throw new Error("An overruled objection should resume witness generation");
    }
    expect(witnessPreparation.request.responseId).toBe(
      activeQuestion.pendingResponseId,
    );

    const exactReplay = HearingCommandPreparationSchema.parse(
      await backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    if (!isHearingWitnessModelRequiredPreparation(exactReplay)) {
      throw new Error("An exact ruling replay should preserve witness generation");
    }
    expect(exactReplay.request.responseId).toBe(
      witnessPreparation.request.responseId,
    );

    const committed = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", responseWindow.view.trial.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
    }));
    expect(committed.events.slice(-5).map(({ eventType }) => eventType)).toEqual([
      "OBJECT",
      "BEGIN_INTERRUPTION",
      "RULE_ON_OBJECTION",
      "RESOLVE_INTERRUPTION",
      "RESUME_INTERRUPTED_SPEECH",
    ]);
    expect(committed.events.slice(-3).map(({ source }) => source)).toEqual([
      "ai",
      "deterministic",
      "deterministic",
    ]);
    expect(
      committed.events.slice(-3).every(
        ({ responseId }) => responseId === activeQuestion.pendingResponseId,
      ),
    ).toBe(true);
    expect(
      committed.calls.filter(({ callId }) => callId === generation.callId),
    ).toHaveLength(1);

    const answerGeneration = await fakeWitnessGeneration(
      witnessPreparation,
      "2026-07-19T03:30:04.000Z",
    );
    const continued = HearingCommandPreparationSchema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        generationJson: JSON.stringify(answerGeneration),
      }),
    );
    expect(continued).toMatchObject({ status: "model_required" });
    if (
      continued.status !== "model_required" ||
      !isHearingOpponentPlanModelRequiredPreparation(continued)
    ) {
      throw new Error("The answered cross should return control to opposing counsel");
    }
    expect(
      continued.request.knowledgeView.publicRecord.testimony.some(
        ({ speakerActorId }) =>
          speakerActorId === witnessPreparation.request.actorId,
      ),
    ).toBe(true);
  });

  it("atomically sustains an objection, cancels speech, and skips witness generation", async () => {
    const backend = convexTest({ schema, modules });
    const planPreparation = await prepareInitialOpponentCross(backend);
    const planGeneration = await fakeOpponentPlanGeneration(
      planPreparation,
      "2026-07-19T03:35:00.000Z",
      "question",
    );
    const counselPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OWNER_ID,
        trialId: planPreparation.request.trialId,
        generationJson: JSON.stringify(planGeneration),
      }),
    );
    const counselGeneration = await fakeCounselGeneration(
      counselPreparation,
      "2026-07-19T03:35:01.000Z",
    );
    const responseWindow = HearingCommandPreparationSchema.parse(
      await backend.action(commitCounselGenerationReference, {
        ownerId: OWNER_ID,
        trialId: planPreparation.request.trialId,
        generationJson: JSON.stringify(counselGeneration),
      }),
    );
    if (responseWindow.status !== "completed") {
      throw new Error("Expected an objection decision window");
    }
    const activeQuestion = responseWindow.view.activeQuestion;
    if (!activeQuestion?.pendingResponseId) {
      throw new Error("Expected an interruptible pending response");
    }
    const objection = playerCommand(
      responseWindow.view,
      "85858585-8585-4585-8585-858585858580",
      "2026-07-19T03:35:02.000Z",
      {
        type: "object",
        questionId: activeQuestion.questionId,
        responseId: activeQuestion.pendingResponseId,
        ground: "hearsay",
      },
    );
    const rulingPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        commandJson: JSON.stringify(objection),
      }),
    );
    const generation = await fakeObjectionRulingGeneration(
      rulingPreparation,
      "2026-07-19T03:35:03.000Z",
      "sustained",
    );
    const next = HearingCommandPreparationSchema.parse(
      await backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    if (!isHearingOpponentPlanModelRequiredPreparation(next)) {
      throw new Error("A sustained objection should return to opponent planning");
    }

    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", responseWindow.view.trial.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
    }));
    expect(stored.events.slice(-4).map(({ eventType }) => eventType)).toEqual([
      "OBJECT",
      "BEGIN_INTERRUPTION",
      "RULE_ON_OBJECTION",
      "RESOLVE_INTERRUPTION",
    ]);
    expect(
      stored.events.some(
        ({ eventType, responseId }) =>
          eventType === "RESUME_INTERRUPTED_SPEECH" &&
          responseId === activeQuestion.pendingResponseId,
      ),
    ).toBe(false);
    expect(
      stored.events.some(
        ({ eventType, responseId }) =>
          eventType === "ANSWER_QUESTION" &&
          responseId === activeQuestion.pendingResponseId,
      ),
    ).toBe(false);
    expect(
      stored.calls.filter(({ callId }) => callId === generation.callId),
    ).toHaveLength(1);

    const eventCount = stored.events.length;
    const exactReplay = HearingCommandPreparationSchema.parse(
      await backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    expect(isHearingOpponentPlanModelRequiredPreparation(exactReplay)).toBe(
      true,
    );
    expect(
      await backend.run(async (ctx) =>
        (
          await ctx.db
            .query("trialEvents")
            .withIndex("by_trial_sequence", (index) =>
              index.eq("trialId", responseWindow.view.trial.trialId),
            )
            .collect()
        ).length,
      ),
    ).toBe(eventCount);

    await expect(
      backend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: responseWindow.view.trial.trialId,
        generationJson: JSON.stringify({
          ...generation,
          decisionId: "decision:objection:stale",
        }),
      }),
    ).rejects.toThrow("OBJECTION_RULING_GENERATION_STALE");
  });

  it("derives a private user offer and binds the opposing negotiation request", async () => {
    const backend = convexTest({ schema, modules });
    const initial = await start(backend);
    expect(initial.capabilities.canProposeSettlement).toBe(false);
    await expect(
      backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: initial.trial.trialId,
        commandJson: JSON.stringify(
          playerCommand(
            initial,
            "85858585-8585-4585-8585-858585858585",
            "2026-07-19T03:40:00.000Z",
            {
              type: "propose_settlement",
              terms: {
                amount: 100_000,
                nonMonetaryTerms: ["Neutral reference"],
                summary: "Resolve the fictional matter after the record develops.",
              },
            },
          ),
        ),
      }),
    ).rejects.toThrow("SETTLEMENT_DEBRIEF_RECORD_REQUIRED");

    let view = initial;
    ({ view } = await command(
      backend,
      view,
      "86868686-8686-4686-8686-868686868686",
      "2026-07-19T03:41:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    ));
    ({ view } = await command(
      backend,
      view,
      "87878787-8787-4787-8787-878787878787",
      "2026-07-19T03:42:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did you personally observe?",
        presentedEvidenceIds: [],
      },
    ));
    ({ view } = await command(
      backend,
      view,
      "88888888-8888-4888-8888-888888888887",
      "2026-07-19T03:43:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
      },
    ));
    if (view.activeAppearance?.stage === "redirect") {
      ({ view } = await command(
        backend,
        view,
        "89898989-8989-4989-8989-898989898989",
        "2026-07-19T03:44:00.000Z",
        {
          type: "finish_witness",
          witnessId: "witness_rina_shah",
          examinationKind: "redirect",
        },
      ));
    }
    expect(view.activeAppearance).toBeNull();
    expect(view.capabilities.canProposeSettlement).toBe(true);

    const offerCommand = playerCommand(
      view,
      "90909090-9090-4090-8090-909090909091",
      "2026-07-19T03:45:00.000Z",
      {
        type: "propose_settlement",
        terms: {
          amount: 100_000,
          nonMonetaryTerms: ["Neutral reference"],
          summary: "Resolve the fictional matter on these terms.",
        },
      },
    );
    const negotiation = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(offerCommand),
      }),
    );
    if (!isHearingNegotiationModelRequiredPreparation(negotiation)) {
      throw new Error("A user offer should require opposing settlement review");
    }
    expect(negotiation.request).toMatchObject({
      actorId: expect.any(String),
      representedPartyId: "party_redwood_signal",
      counterpartyPartyId: "party_rina_shah",
      offerBinding: {
        mode: "respond_to_offer",
        targetOfferId: `offer:${offerCommand.requestId}`,
        proposedOfferId: expect.any(String),
        counterParentOfferId: `offer:${offerCommand.requestId}`,
        allowedRecommendations: ["counter", "accept", "reject"],
      },
      knowledgeView: {
        actorRole: "opposing_counsel",
        counsel: { partyId: "party_redwood_signal" },
      },
    });
    expect(negotiation.request.knowledgeView.counsel.privateSettlement).not.toBeNull();
    const serialized = JSON.stringify(negotiation);
    expect(serialized).not.toContain(OWNER_ID);

    const replay = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(offerCommand),
      }),
    );
    if (!isHearingNegotiationModelRequiredPreparation(replay)) {
      throw new Error("Exact offer replay should restore negotiation review");
    }
    expect(replay.request.decisionId).toBe(negotiation.request.decisionId);
    expect(replay.request.callId).not.toBe(negotiation.request.callId);

    const settlementEvents = await backend.run(async (ctx) =>
      (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", view.trial.trialId),
          )
          .collect()
      ).filter(({ eventType }) => eventType === "PROPOSE_SETTLEMENT"),
    );
    expect(settlementEvents).toHaveLength(1);
    expect(JSON.parse(settlementEvents[0]?.payloadJson ?? "null")).toMatchObject({
      offerId: `offer:${offerCommand.requestId}`,
      parentOfferId: null,
      proposedByPartyId: "party_rina_shah",
      recipientPartyIds: ["party_redwood_signal"],
      terms: {
        amount: 100_000,
        currency: "USD",
        nonMonetaryTerms: ["Neutral reference"],
      },
    });

    const generation = await fakeNegotiationGeneration(
      negotiation,
      "2026-07-19T03:45:01.000Z",
      "reject",
    );
    const countsBeforeCommit = await backend.run(async (ctx) => ({
      events: (await ctx.db.query("trialEvents").collect()).length,
      calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
    }));
    await expect(
      backend.action(commitNegotiationGenerationReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.action(commitNegotiationGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify({
          ...generation,
          output: {
            ...generation.output,
            decisionSummary: "Tampered after generation.",
          },
        }),
      }),
    ).rejects.toThrow("NEGOTIATION_GENERATION_INVALID");
    expect(
      await backend.run(async (ctx) => ({
        events: (await ctx.db.query("trialEvents").collect()).length,
        calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
      })),
    ).toEqual(countsBeforeCommit);

    const rejected = HearingCommandPreparationSchema.parse(
      await backend.action(commitNegotiationGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    if (rejected.status !== "completed") {
      throw new Error("A rejected offer should return active trial control");
    }
    expect(rejected.view.trial).toMatchObject({ status: "active" });
    expect(rejected.view.player.settlement?.offers).toContainEqual(
      expect.objectContaining({ offerId: `offer:${offerCommand.requestId}`, status: "rejected" }),
    );
    const exactReplay = HearingCommandPreparationSchema.parse(
      await backend.action(commitNegotiationGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    expect(exactReplay).toEqual(rejected);
    const committed = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", view.trial.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
    }));
    expect(committed.events.at(-1)?.eventType).toBe("REJECT_SETTLEMENT");
    expect(committed.events.at(-1)?.source).toBe("ai");
    expect(
      committed.calls.filter(({ callId }) => callId === generation.callId),
    ).toHaveLength(1);
  });

  it("commits an AI counteroffer and lets the player settle into Terra coaching", async () => {
    const backend = convexTest({ schema, modules });
    const { preparation, offerId } = await prepareSettlementNegotiation(
      backend,
      75_000,
    );
    const generation = await fakeNegotiationGeneration(
      preparation,
      "2026-07-19T03:46:00.000Z",
      "counter",
      60_000,
    );
    const countered = HearingCommandPreparationSchema.parse(
      await backend.action(commitNegotiationGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    if (countered.status !== "completed") {
      throw new Error("An AI counteroffer should return player control");
    }
    const [counterOfferId] =
      countered.view.capabilities.acceptableSettlementOfferIds;
    if (!counterOfferId) {
      throw new Error("The player should be able to accept the AI counteroffer");
    }
    expect(countered.view.player.settlement?.offers).toContainEqual(
      expect.objectContaining({
        offerId: counterOfferId,
        proposerPartyId: "party_redwood_signal",
        recipientPartyIds: ["party_rina_shah"],
        amount: 60_000,
        status: "open",
      }),
    );

    const exactReplay = HearingCommandPreparationSchema.parse(
      await backend.action(commitNegotiationGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    expect(exactReplay).toEqual(countered);

    const accepted = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        commandJson: JSON.stringify(
          playerCommand(
            countered.view,
            "91919191-9191-4191-8191-919191919190",
            "2026-07-19T03:46:01.000Z",
            { type: "accept_settlement", offerId: counterOfferId },
          ),
        ),
      }),
    );
    if (!isHearingDebriefGeneratorModelRequiredPreparation(accepted)) {
      throw new Error("Accepted settlement should require Terra coaching");
    }
    expect(accepted.request).toMatchObject({
      knowledgeView: {
        actorRole: "debrief",
      },
      procedure: {
        verdict: null,
      },
    });
    expect(accepted.request.procedure.settlementOffers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offerId, status: "countered" }),
        expect.objectContaining({ offerId: counterOfferId, status: "accepted" }),
      ]),
    );

    const debriefGeneration = await fakeDebriefGeneration(
      accepted,
      "2026-07-19T03:46:02.000Z",
    );
    expect(debriefGeneration.trace.model).toBe("gpt-5.6-terra");
    const completed = HearingCommandPreparationSchema.parse(
      await backend.action(commitDebriefGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(debriefGeneration),
      }),
    );
    expect(completed).toMatchObject({
      status: "completed",
      view: { trial: { phase: "complete", status: "complete" } },
    });
    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", preparation.request.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
    }));
    expect(
      stored.events.filter(({ eventType }) => eventType === "ACCEPT_SETTLEMENT"),
    ).toHaveLength(1);
    expect(
      stored.calls
        .filter(({ trialId }) => trialId === preparation.request.trialId)
        .map(({ task }) => task),
    ).toEqual(expect.arrayContaining(["evaluate_settlement", "generate_debrief"]));
  });

  it("allows the AI to accept an in-authority offer and requires a verdict-free debrief", async () => {
    const backend = convexTest({ schema, modules });
    const { preparation, offerId } = await prepareSettlementNegotiation(
      backend,
      75_000,
    );
    const generation = await fakeNegotiationGeneration(
      preparation,
      "2026-07-19T03:47:00.000Z",
      "accept",
    );
    const debrief = HearingCommandPreparationSchema.parse(
      await backend.action(commitNegotiationGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    if (!isHearingDebriefGeneratorModelRequiredPreparation(debrief)) {
      throw new Error("AI settlement acceptance should require Terra coaching");
    }
    expect(debrief.request.procedure).toMatchObject({ verdict: null });
    expect(debrief.request.procedure.settlementOffers).toContainEqual(
      expect.objectContaining({ offerId, status: "accepted" }),
    );
    const acceptedEvent = await backend.run(async (ctx) =>
      (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", preparation.request.trialId),
          )
          .collect()
      ).find(({ eventType }) => eventType === "ACCEPT_SETTLEMENT"),
    );
    expect(acceptedEvent).toMatchObject({ source: "ai", model: "gpt-5.6-luna" });
  });

  it("rolls back objection and negotiation events when their accepted audit conflicts", async () => {
    const objectionBackend = convexTest({ schema, modules });
    const objectionPreparation = await prepareUserObjectionRuling(
      objectionBackend,
    );
    const objectionGeneration = await fakeObjectionRulingGeneration(
      objectionPreparation,
      "2026-07-19T03:50:03.000Z",
      "overruled",
    );
    const objectionEventCount = await objectionBackend.run(async (ctx) =>
      (await ctx.db.query("trialEvents").collect()).length,
    );
    await objectionBackend.mutation(recordTerminalModelCallReference, {
      ownerId: OWNER_ID,
      traceJson: JSON.stringify(
        CourtroomModelCallTraceSchema.parse({
          ...objectionGeneration.trace,
          committedActionId: "action:foreign-objection-ruling",
          committedEventId: "event:action:foreign-objection-ruling",
        }),
      ),
    });
    await expect(
      objectionBackend.action(commitObjectionRulingGenerationReference, {
        ownerId: OWNER_ID,
        trialId: objectionPreparation.request.trialId,
        generationJson: JSON.stringify(objectionGeneration),
      }),
    ).rejects.toThrow("OBJECTION_RULING_GENERATION_INVALID");
    const objectionPersisted = await objectionBackend.run(async (ctx) => ({
      events: await ctx.db.query("trialEvents").collect(),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", objectionGeneration.callId),
        )
        .collect(),
    }));
    expect(objectionPersisted.events).toHaveLength(objectionEventCount);
    expect(
      objectionPersisted.events.some(
        ({ eventType }) => eventType === "RULE_ON_OBJECTION",
      ),
    ).toBe(false);
    expect(objectionPersisted.calls).toHaveLength(1);

    const negotiationBackend = convexTest({ schema, modules });
    const { preparation: negotiationPreparation } =
      await prepareSettlementNegotiation(negotiationBackend, 100_000);
    const negotiationGeneration = await fakeNegotiationGeneration(
      negotiationPreparation,
      "2026-07-19T03:51:00.000Z",
      "reject",
    );
    const negotiationEventCount = await negotiationBackend.run(async (ctx) =>
      (await ctx.db.query("trialEvents").collect()).length,
    );
    await negotiationBackend.mutation(recordTerminalModelCallReference, {
      ownerId: OWNER_ID,
      traceJson: JSON.stringify(
        CourtroomModelCallTraceSchema.parse({
          ...negotiationGeneration.trace,
          committedActionId: "action:foreign-negotiation",
          committedEventId: "event:action:foreign-negotiation",
        }),
      ),
    });
    await expect(
      negotiationBackend.action(commitNegotiationGenerationReference, {
        ownerId: OWNER_ID,
        trialId: negotiationPreparation.request.trialId,
        generationJson: JSON.stringify(negotiationGeneration),
      }),
    ).rejects.toThrow("NEGOTIATION_GENERATION_INVALID");
    const negotiationPersisted = await negotiationBackend.run(async (ctx) => ({
      events: await ctx.db.query("trialEvents").collect(),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", negotiationGeneration.callId),
        )
        .collect(),
    }));
    expect(negotiationPersisted.events).toHaveLength(negotiationEventCount);
    expect(negotiationPersisted.events.at(-1)?.eventType).toBe(
      "PROPOSE_SETTLEMENT",
    );
    expect(negotiationPersisted.calls).toHaveLength(1);
  });

  it("caps one AI examination at three questions and completes its model loop in eleven steps", async () => {
    const backend = convexTest({ schema, modules });
    let preparation: HearingCommandPreparation =
      await prepareInitialOpponentCross(backend);
    let modelSteps = 0;
    const baseTime = Date.parse("2026-07-19T04:03:00.000Z");

    for (let questionIndex = 0; questionIndex < 3; questionIndex += 1) {
      if (!isHearingOpponentPlanModelRequiredPreparation(preparation)) {
        throw new Error(
          "Expected opponent planning before each capped question",
        );
      }
      expect(preparation.request.procedure.answeredQuestionCount).toBe(
        questionIndex,
      );
      expect(preparation.request.opportunities.questionableWitnessIds).toEqual([
        "witness_rina_shah",
      ]);
      preparation = await commitModelPreparation(
        backend,
        preparation,
        new Date(baseTime + modelSteps * 1_000).toISOString(),
        "question",
      );
      modelSteps += 1;
      if (!isHearingCounselResponseModelRequiredPreparation(preparation)) {
        throw new Error("Question plan should require counsel speech");
      }
      preparation = await commitModelPreparation(
        backend,
        preparation,
        new Date(baseTime + modelSteps * 1_000).toISOString(),
      );
      modelSteps += 1;
      preparation = await continueOpposingResponse(
        backend,
        preparation,
        new Date(baseTime + modelSteps * 1_000 - 500).toISOString(),
      );
      if (!isHearingWitnessModelRequiredPreparation(preparation)) {
        throw new Error("Counsel question should require witness speech");
      }
      preparation = await commitModelPreparation(
        backend,
        preparation,
        new Date(baseTime + modelSteps * 1_000).toISOString(),
      );
      modelSteps += 1;
    }

    if (!isHearingOpponentPlanModelRequiredPreparation(preparation)) {
      throw new Error("Third answer should reach one final capped plan");
    }
    expect(preparation.request.procedure.answeredQuestionCount).toBe(3);
    expect(preparation.request.opportunities.questionableWitnessIds).toEqual(
      [],
    );
    const cappedQuestionGeneration = await fakeOpponentPlanGeneration(
      preparation,
      new Date(baseTime + modelSteps * 1_000).toISOString(),
      "question",
    );
    await expect(
      backend.action(commitOpponentPlanGenerationReference, {
        ownerId: OWNER_ID,
        trialId: preparation.request.trialId,
        generationJson: JSON.stringify(cappedQuestionGeneration),
      }),
    ).rejects.toThrow("OPPONENT_PLAN_GENERATION_INVALID");

    preparation = await commitModelPreparation(
      backend,
      preparation,
      new Date(baseTime + modelSteps * 1_000).toISOString(),
      "end",
    );
    modelSteps += 1;
    if (!isHearingCounselResponseModelRequiredPreparation(preparation)) {
      throw new Error("Capped plan should require durable ending speech");
    }
    expect(preparation.request.directive).toEqual({
      kind: "end_examination",
      disposition: "completed",
    });
    preparation = await commitModelPreparation(
      backend,
      preparation,
      new Date(baseTime + modelSteps * 1_000).toISOString(),
    );
    modelSteps += 1;
    expect(modelSteps).toBe(11);
    expect(preparation.status).toBe("completed");
    if (preparation.status !== "completed") {
      throw new Error("Capped examination should return player redirect");
    }
    expect(preparation.view.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "redirect",
    });

    const events = await backend.run(async (ctx) =>
      ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", preparation.view.trial.trialId),
        )
        .collect(),
    );
    expect(
      events.filter(
        (event) => event.eventType === "ASK_QUESTION" && event.source === "ai",
      ),
    ).toHaveLength(3);
    expect(
      events.filter(
        (event) =>
          event.eventType === "END_EXAMINATION" &&
          event.actorRole === "opposing_counsel",
      ),
    ).toHaveLength(1);
  });

  it("rejects the unsupported userSide before creating durable hearing state", async () => {
    const backend = convexTest({ schema, modules });
    await expect(
      backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify({
          ...startRequest(),
          userSide: "opposing",
        }),
      }),
    ).rejects.toThrow("RUNTIME_AI_USER_SIDE_UNSUPPORTED");
    const persisted = await backend.run(async (ctx) => ({
      graphs: await ctx.db.query("caseGraphs").collect(),
      projections: await ctx.db.query("trialProjections").collect(),
      events: await ctx.db.query("trialEvents").collect(),
    }));
    expect(persisted).toEqual({ graphs: [], projections: [], events: [] });
  });

  it("rejects a closing workflow with no jury-considerable support", async () => {
    const backend = convexTest(schema, modules);
    const view = await start(backend);
    const request = playerCommand(
      view,
      "90909090-9090-4090-8090-909090909090",
      "2026-07-19T02:59:00.000Z",
      {
        type: "finish_trial",
        closingText: "There is no record to submit.",
      },
    );
    await expect(
      backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(request),
      }),
    ).rejects.toThrow("JURY_CONSIDERABLE_RECORD_REQUIRED");
    const unchanged = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
      }),
    );
    expect(unchanged).toEqual(view);
  });

  it("preserves an unable-to-reach jury recommendation without inventing a winner", async () => {
    const backend = convexTest({ schema, modules });
    let view = await start(backend);
    ({ view } = await command(
      backend,
      view,
      "91919191-9191-4191-8191-919191919191",
      "2026-07-19T02:51:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    ));
    ({ view } = await command(
      backend,
      view,
      "92929292-9292-4292-8292-929292929292",
      "2026-07-19T02:52:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did you personally observe?",
        presentedEvidenceIds: [],
      },
    ));
    ({ view } = await command(
      backend,
      view,
      "93939393-9393-4393-8393-939393939393",
      "2026-07-19T02:53:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
      },
    ));

    const hungJuryDecision =
      "The jury is unable to reach a verdict on this fictional record.";
    ({ view } = await command(
      backend,
      view,
      "94949494-9494-4494-8494-949494949494",
      "2026-07-19T02:54:00.000Z",
      {
        type: "finish_trial",
        closingText: "The admitted testimony should be weighed under the instructions.",
      },
      {
        outcome: "unable_to_reach",
        decision: hungJuryDecision,
        confidence: 0.41,
      },
    ));
    expect(view.trial).toMatchObject({ phase: "complete", status: "complete" });

    const stored = await backend.run(async (ctx) => ({
      verdict: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", view.trial.trialId),
          )
          .collect()
      ).find(({ eventType }) => eventType === "RENDER_VERDICT"),
      juryArtifact: (
        await ctx.db
          .query("courtroomGeneratedArtifacts")
          .withIndex("by_owner_trial_kind", (index) =>
            index
              .eq("ownerId", OWNER_ID)
              .eq("trialId", view.trial.trialId)
              .eq("artifactKind", "jury_deliberation"),
          )
          .collect()
      )[0],
    }));
    expect(JSON.parse(stored.verdict?.payloadJson ?? "null")).toMatchObject({
      decision: hungJuryDecision,
    });
    expect(
      JuryRoleResponseModelOutputSchema.parse(
        JSON.parse(stored.juryArtifact?.artifactJson ?? "null"),
      ).recommendation,
    ).toEqual({
      outcome: "unable_to_reach",
      decision: hungJuryDecision,
      confidence: 0.41,
    });
  });

  it("calls, questions, releases, switches witnesses, completes, and resumes only from V3 events", async () => {
    const backend = convexTest({ schema, modules });
    let view = await start(backend);

    ({ view } = await command(
      backend,
      view,
      "22222222-2222-4222-8222-222222222222",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    ));
    expect(view.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "direct",
    });
    expect(view.trial.version).toBe(5);

    const asked = await command(
      backend,
      view,
      "33333333-3333-4333-8333-333333333333",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "When did you send the battery safety complaint?",
        presentedEvidenceIds: [],
      },
    );
    view = asked.view;
    expect(view.trial.version).toBe(8);
    expect(view.activeQuestion).toBeNull();
    expect(view.transcript).toHaveLength(2);
    expect(view.transcript.map((turn) => turn.actor.role)).toEqual([
      "user_counsel",
      "witness",
    ]);
    const replayedQuestion = HearingRuntimeViewV1Schema.parse(
      await backend.action(commandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(asked.request),
      }),
    );
    expect(replayedQuestion).toEqual(view);

    ({ view } = await command(
      backend,
      view,
      "44444444-4444-4444-8444-444444444444",
      "2026-07-19T03:03:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
      },
    ));
    expect(view.activeAppearance).toBeNull();
    expect(
      view.witnesses.find(
        (witness) => witness.witnessId === "witness_rina_shah",
      ),
    ).toMatchObject({ status: "released", callCount: 1 });

    ({ view } = await command(
      backend,
      view,
      "55555555-5555-4555-8555-555555555555",
      "2026-07-19T03:04:00.000Z",
      { type: "call_witness", witnessId: "witness_theo_morgan" },
    ));
    ({ view } = await command(
      backend,
      view,
      "66666666-6666-4666-8666-666666666666",
      "2026-07-19T03:05:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_theo_morgan",
        examinationKind: "direct",
        text: "When was the termination draft created?",
        presentedEvidenceIds: [],
      },
    ));
    ({ view } = await command(
      backend,
      view,
      "77777777-7777-4777-8777-777777777777",
      "2026-07-19T03:06:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_theo_morgan",
        examinationKind: "direct",
      },
    ));
    expect(view.transcript).toHaveLength(6);
    expect(
      new Set(
        view.transcript
          .filter((turn) => turn.actor.role === "witness")
          .map((turn) => turn.actor.witnessId),
      ),
    ).toEqual(new Set(["witness_rina_shah", "witness_theo_morgan"]));

    ({ view } = await command(
      backend,
      view,
      "88888888-8888-4888-8888-888888888888",
      "2026-07-19T03:07:00.000Z",
      {
        type: "finish_trial",
        closingText:
          "The testimony shows why the admitted record warrants relief.",
      },
    ));
    expect(view.trial).toMatchObject({ phase: "complete", status: "complete" });
    expect(view.transcript).toHaveLength(8);

    const resumed = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
      }),
    );
    expect(resumed).toEqual(view);
    await expect(
      backend.action(readReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: view.trial.trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");

    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", view.trial.trialId),
        )
        .collect(),
      artifacts: await ctx.db
        .query("courtroomGeneratedArtifacts")
        .withIndex("by_owner_trial_kind", (index) =>
          index.eq("ownerId", OWNER_ID).eq("trialId", view.trial.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      legacyTrials: await ctx.db.query("trials").collect(),
      legacyTurns: await ctx.db.query("turns").collect(),
    }));
    expect(stored.events).toHaveLength(view.trial.sequence);
    expect(stored.events.slice(-16).map(({ eventType }) => eventType)).toEqual([
      "REST_CASE",
      "REST_CASE",
      "BEGIN_PHASE",
      "BEGIN_PHASE",
      "GIVE_CLOSING",
      "UPDATE_OPPOSING_STRATEGY",
      "GIVE_CLOSING",
      "BEGIN_PHASE",
      "INSTRUCT_JURY",
      "BEGIN_PHASE",
      "DELIBERATE",
      "BEGIN_PHASE",
      "RENDER_VERDICT",
      "BEGIN_PHASE",
      "GENERATE_DEBRIEF",
      "BEGIN_PHASE",
    ]);
    expect(
      stored.events
        .slice(-16)
        .filter(({ source }) => source === "ai")
        .map(({ eventType }) => eventType),
    ).toEqual([
      "UPDATE_OPPOSING_STRATEGY",
      "GIVE_CLOSING",
      "DELIBERATE",
      "GENERATE_DEBRIEF",
    ]);
    expect(stored.events.map(({ payloadJson }) => payloadJson).join("\n")).not
      .toContain("deterministic development jury");
    expect(stored.artifacts.map(({ artifactKind }) => artifactKind).sort()).toEqual(
      ["final_debrief", "jury_deliberation"],
    );
    const juryArtifact = stored.artifacts.find(
      ({ artifactKind }) => artifactKind === "jury_deliberation",
    );
    const debriefArtifact = stored.artifacts.find(
      ({ artifactKind }) => artifactKind === "final_debrief",
    );
    expect(juryArtifact).toMatchObject({
      ownerId: OWNER_ID,
      trialId: view.trial.trialId,
      model: "gpt-5.6-luna",
      artifactSchemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    });
    expect(debriefArtifact).toMatchObject({
      ownerId: OWNER_ID,
      trialId: view.trial.trialId,
      model: "gpt-5.6-terra",
      artifactSchemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    });
    expect(
      JuryRoleResponseModelOutputSchema.parse(
        JSON.parse(juryArtifact?.artifactJson ?? "null"),
      ).recommendation.decision,
    ).toBe("The jury finds for the user on the jury-considerable record.");
    expect(
      DebriefGeneratorModelOutputSchema.parse(
        JSON.parse(debriefArtifact?.artifactJson ?? "null"),
      ).limitations[0],
    ).toContain("not legal advice");
    const juryEvent = stored.events.find(
      ({ eventType }) => eventType === "DELIBERATE",
    );
    const juryCall = stored.calls.find(
      ({ callId }) => callId === juryArtifact?.callId,
    );
    if (
      !juryArtifact ||
      juryArtifact.decisionId === null ||
      !juryEvent ||
      !juryCall
    ) {
      throw new Error("Expected a complete stored jury generation");
    }
    const committedJuryTrace = CourtroomModelCallTraceSchema.parse(
      JSON.parse(juryCall.traceJson),
    );
    const replayGeneration = HearingJuryResponsePrecommitSchema.parse({
      schemaVersion: HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
      trialId: view.trial.trialId,
      callId: juryArtifact.callId,
      decisionId: juryArtifact.decisionId,
      expectedStateVersion: juryArtifact.sourceStateVersion,
      expectedLastEventId: juryArtifact.sourceLastEventId,
      output: JSON.parse(juryArtifact.artifactJson),
      modelMetadata: {
        model: juryEvent.model,
        requestId: juryEvent.modelRequestId ?? null,
        promptVersion: juryEvent.promptVersion,
        schemaVersion: juryEvent.modelSchemaVersion,
        latencyMs: juryEvent.modelLatencyMs ?? null,
        inputTokens: juryEvent.inputTokens ?? null,
        outputTokens: juryEvent.outputTokens ?? null,
        estimatedCostUsd: juryEvent.estimatedCostUsd ?? null,
        retryCount: juryEvent.retryCount,
        validationFailureCount: juryEvent.validationFailureCount,
      },
      trace: {
        ...committedJuryTrace,
        committedActionId: null,
        committedEventId: null,
      },
    });
    const replayPreparation = HearingCommandPreparationSchema.parse(
      await backend.action(commitJuryGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(replayGeneration),
      }),
    );
    expect(replayPreparation).toMatchObject({
      status: "completed",
      view,
    });
    await expect(
      backend.action(commitJuryGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify({
          ...replayGeneration,
          output: {
            ...replayGeneration.output,
            recommendation: {
              ...replayGeneration.output.recommendation,
              decision: "A conflicting replay must not overwrite the artifact.",
            },
          },
        }),
      }),
    ).rejects.toThrow("JURY_GENERATION_INVALID");
    const replayCounts = await backend.run(async (ctx) => ({
      artifacts: (await ctx.db.query("courtroomGeneratedArtifacts").collect())
        .length,
      calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
      events: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", view.trial.trialId),
          )
          .collect()
      ).length,
    }));
    expect(replayCounts).toEqual({
      artifacts: stored.artifacts.length,
      calls: stored.calls.length,
      events: stored.events.length,
    });
    expect(
      stored.calls
        .filter(({ trialId }) => trialId === view.trial.trialId)
        .map(({ task }) => task),
    ).toEqual(
      expect.arrayContaining(["jury_deliberation", "generate_debrief"]),
    );
    expect(JSON.stringify(view)).not.toContain("hiddenAuthoringTruth");
    expect(JSON.stringify(view)).not.toContain("overallAssessment");
    expect(stored.legacyTrials).toEqual([]);
    expect(stored.legacyTurns).toEqual([]);
  });
});
