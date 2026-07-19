import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../src/domain/case-graph";
import {
  COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  CounselRoleResponseModelOutputSchema,
  OpponentPlannerModelOutputSchema,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  type CounselRoleResponseModelOutput,
  type OpponentPlannerModelOutput,
  type WitnessAnswerModelOutput,
} from "../src/domain/courtroom-ai";
import {
  HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  PERSISTED_OPPONENT_DIRECTIVE_SCHEMA_VERSION,
  HearingCounselResponsePrecommitSchema,
  HearingCommittedPerformanceSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingWitnessGenerationPrecommitSchema,
  PersistedOpponentDirectiveSchema,
  counselResponseOutputCitations,
  hashCounselResponseModelOutput,
  hashOpponentPlannerModelOutput,
  hashWitnessAnswerModelOutput,
  opponentPlannerOutputCitations,
  serializePersistedOpponentDirective,
  witnessAnswerOutputCitations,
  type HearingCounselResponsePrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime";
import { sha256Utf8 } from "../src/domain/case-graph/hash";
import type { TrialPolicyActorBindingInput } from "../src/domain/trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  type ActorRef,
  type TrialActionV3,
} from "../src/domain/trial-engine";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./courtroomModelCalls.ts": () => import("./courtroomModelCalls"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

type TestBackend = TestConvex<typeof schema>;

type Receipt = Readonly<{
  receiptId: string;
  trialId: string;
  actionId: string;
  committedStateVersion: number;
  firstSequence: number;
  lastSequence: number;
  eventIds: string[];
  replayed: boolean;
}>;

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174001";
const GRAPH_ID = "graph:trial-events-generated";
const TRIAL_ID = "trial:generated-witness-answer";
const RESPONSE_ID = "response:generated-witness-answer";
const QUESTION_ID = "question:generated-witness-answer";
const CALL_ID = "call:generated-witness-answer";
const STARTED_AT = Date.parse("2026-07-19T06:00:00.000Z");

const ACTORS = {
  system: {
    actorId: "actor_system",
    role: "system",
    side: "neutral",
    witnessId: null,
  },
  judge: {
    actorId: "actor_judge",
    role: "judge",
    side: "neutral",
    witnessId: null,
  },
  userCounsel: {
    actorId: "actor_user_counsel",
    role: "user_counsel",
    side: "user",
    witnessId: null,
  },
  opposingCounsel: {
    actorId: "actor_opposing_counsel",
    role: "opposing_counsel",
    side: "opposing",
    witnessId: null,
  },
  jury: {
    actorId: "actor_jury",
    role: "jury",
    side: "neutral",
    witnessId: null,
  },
  rina: {
    actorId: "actor_witness_rina",
    role: "witness",
    side: "user",
    witnessId: "witness_rina_shah",
  },
  theo: {
    actorId: "actor_witness_theo",
    role: "witness",
    side: "opposing",
    witnessId: "witness_theo_morgan",
  },
  maya: {
    actorId: "actor_witness_maya",
    role: "witness",
    side: "neutral",
    witnessId: "witness_maya_ortiz",
  },
} as const satisfies Record<string, ActorRef>;

function actorBindings(): TrialPolicyActorBindingInput[] {
  return Object.values(ACTORS).map((actor) => ({
    actor,
    representedPartyIds:
      actor.role === "user_counsel"
        ? ["party_rina_shah"]
        : actor.role === "opposing_counsel"
          ? ["party_redwood_signal"]
          : [],
  }));
}

const createForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    trialId: string;
    graphId: string;
    actionId: string;
    requestedAt: number;
    actorBindings: TrialPolicyActorBindingInput[];
  }>,
  Receipt
>("trialEvents:createForOwner");

const appendTrustedForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; actionJson: string }>,
  Receipt
>("trialEvents:appendTrustedForOwner");

const appendGeneratedForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    generationJson: string;
    writeSnapshot?: boolean;
  }>,
  Receipt
>("trialEvents:appendGeneratedForOwner");

const appendOpponentPlanForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    generationJson: string;
    writeSnapshot?: boolean;
  }>,
  Receipt
>("trialEvents:appendOpponentPlanForOwner");

const appendCounselTurnForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    continuationActionJson: string | null;
    generationJson: string;
    writeSnapshot?: boolean;
  }>,
  Receipt
>("trialEvents:appendCounselTurnForOwner");

const readCommittedPerformanceForOwnerHeadReference = makeFunctionReference<
  "query",
  Readonly<{
    ownerId: string;
    trialId: string;
    stateVersion: number;
    lastEventId: string;
  }>,
  string | null
>("trialEvents:readCommittedPerformanceForOwnerHead");

const recordTerminalForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; traceJson: string }>,
  Readonly<{ callId: string; attemptCount: number; replayed: boolean }>
>("courtroomModelCalls:recordTerminalForOwner");

function eventId(actionId: string): string {
  return `event:${actionId}`;
}

function action(
  input: Readonly<{
    actionId: string;
    expectedStateVersion: number;
    actor: ActorRef;
    source: "user" | "ai" | "deterministic" | "system";
    causationId: string;
    type: TrialActionV3["type"];
    payload: unknown;
    responseId?: string;
    modelMetadata?: TrialActionV3["modelMetadata"];
  }>,
): TrialActionV3 {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: input.actionId,
    trialId: TRIAL_ID,
    expectedStateVersion: input.expectedStateVersion,
    actor: input.actor,
    source: input.source,
    requestedAt: new Date(
      STARTED_AT + (input.expectedStateVersion + 1) * 1_000,
    ).toISOString(),
    causationId: input.causationId,
    correlationId: TRIAL_ID,
    responseId: input.responseId ?? null,
    interruptId: null,
    modelMetadata: input.modelMetadata ?? null,
    type: input.type,
    payload: input.payload,
  });
}

async function appendTrusted(
  backend: TestBackend,
  trialAction: TrialActionV3,
): Promise<Receipt> {
  return await backend.mutation(appendTrustedForOwnerReference, {
    ownerId: OWNER_ID,
    actionJson: JSON.stringify(trialAction),
  });
}

async function setupPendingWitnessResponse(): Promise<TestBackend> {
  const backend = convexTest({ schema, modules });
  const graph = createThreeWitnessCaseGraphV1Fixture();
  await backend.run(async (ctx) => {
    await ctx.db.insert("caseGraphs", {
      graphId: GRAPH_ID,
      caseId: graph.caseId,
      version: 2,
      lifecycle: "published",
      visibility: "private",
      ownerId: OWNER_ID,
      uploadId: "upload:trial-events-generated",
      title: graph.title,
      graphJson: JSON.stringify(graph),
      graphSchemaVersion: graph.schemaVersion,
      compilerMetadataJson: undefined,
      sourceDigest: graph.compilerMetadata.sourceContentHash,
      createdBy: "user",
      createdAt: STARTED_AT,
    });
  });

  const startActionId = "action:generated:start";
  await backend.mutation(createForOwnerReference, {
    ownerId: OWNER_ID,
    trialId: TRIAL_ID,
    graphId: GRAPH_ID,
    actionId: startActionId,
    requestedAt: STARTED_AT,
    actorBindings: actorBindings(),
  });

  const phaseActionId = "action:generated:case-in-chief";
  await appendTrusted(
    backend,
    action({
      actionId: phaseActionId,
      expectedStateVersion: 1,
      actor: ACTORS.judge,
      source: "deterministic",
      causationId: eventId(startActionId),
      type: "BEGIN_PHASE",
      payload: { phase: "case_in_chief" },
    }),
  );
  const callActionId = "action:generated:call-rina";
  await appendTrusted(
    backend,
    action({
      actionId: callActionId,
      expectedStateVersion: 2,
      actor: ACTORS.userCounsel,
      source: "user",
      causationId: eventId(phaseActionId),
      type: "CALL_WITNESS",
      payload: { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
    }),
  );
  const swearActionId = "action:generated:swear-rina";
  await appendTrusted(
    backend,
    action({
      actionId: swearActionId,
      expectedStateVersion: 3,
      actor: ACTORS.judge,
      source: "deterministic",
      causationId: eventId(callActionId),
      type: "SWEAR_WITNESS",
      payload: { witnessId: ACTORS.rina.witnessId },
    }),
  );
  const questionActionId = "action:generated:ask-rina";
  await appendTrusted(
    backend,
    action({
      actionId: questionActionId,
      expectedStateVersion: 4,
      actor: ACTORS.userCounsel,
      source: "user",
      causationId: eventId(swearActionId),
      type: "ASK_QUESTION",
      payload: {
        questionId: QUESTION_ID,
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "Did you send the complaint email shown to you?",
        turnId: "turn:generated:question",
        presentedEvidenceIds: ["evidence_complaint_email"],
      },
    }),
  );
  const responseActionId = "action:generated:request-response";
  await appendTrusted(
    backend,
    action({
      actionId: responseActionId,
      expectedStateVersion: 5,
      actor: ACTORS.system,
      source: "system",
      causationId: eventId(questionActionId),
      type: "REQUEST_RESPONSE",
      payload: {
        responseId: RESPONSE_ID,
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      responseId: RESPONSE_ID,
    }),
  );
  return backend;
}

function witnessOutput(): WitnessAnswerModelOutput {
  return {
    schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    disposition: "substantive",
    performance: {
      emotion: "confident",
      intensity: 0.4,
      delivery: "measured",
      gesture: "indicate_evidence",
      gazeTarget: "questioning_counsel",
    },
    segments: [
      {
        text: "Yes. I sent that safety complaint email that morning.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: ["evidence_complaint_email"],
        priorStatementIds: ["statement_rina_interview"],
      },
    ],
  };
}

function generation(): HearingWitnessGenerationPrecommit {
  const output = witnessOutput();
  const outputHash = hashWitnessAnswerModelOutput(output);
  const citations = witnessAnswerOutputCitations(output);
  const usage = {
    inputTokens: 480,
    outputTokens: 72,
    totalTokens: 552,
    cachedInputTokens: 200,
    cacheWriteTokens: 0,
    reasoningTokens: 12,
  };
  return HearingWitnessGenerationPrecommitSchema.parse({
    schemaVersion: HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
    trialId: TRIAL_ID,
    callId: CALL_ID,
    responseId: RESPONSE_ID,
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId: "request:generated-witness-answer",
      promptVersion: "role-responder.witness-answer.prompt.v1",
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      latencyMs: 640,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: 0.0012,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId: CALL_ID,
      trialId: TRIAL_ID,
      responseId: RESPONSE_ID,
      actorId: ACTORS.rina.actorId,
      actorRole: "witness",
      callClass: "role_responder",
      task: "witness_answer",
      inputEventIds: [eventId("action:generated:ask-rina")],
      expectedStateVersion: 6,
      expectedLastEventId: eventId("action:generated:request-response"),
      provider: "openai",
      model: "gpt-5.6-luna",
      providerProtocolVersion: "responses-api.v1",
      promptVersion: "role-responder.witness-answer.prompt.v1",
      outputSchemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: "a".repeat(64),
        stateVersion: 6,
        factCount: 2,
        evidenceCount: 1,
        testimonyCount: 0,
        priorStatementCount: 1,
        sourceSegmentCount: 0,
        publicRecordEventCount: 0,
        currentExchangeCount: 1,
      },
      promptAudit: {
        stablePrefixHash: "b".repeat(64),
        trustedContextHash: "c".repeat(64),
        untrustedInputHash: "d".repeat(64),
        inputCharacterCount: 1_200,
      },
      status: "accepted",
      startedAt: "2026-07-19T06:00:06.000Z",
      completedAt: "2026-07-19T06:00:06.640Z",
      latencyMs: 640,
      firstStructuredDeltaMs: 220,
      firstAcceptedSegmentMs: 430,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd: 0.0012,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: citations,
      acceptedCitationCount: Object.values(citations).reduce(
        (total, identifiers) => total + identifiers.length,
        0,
      ),
      outputHash,
      outputCharacterCount: output.segments[0]?.text.length ?? 0,
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
      attempts: [
        {
          schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
          attempt: 1,
          mode: "initial",
          status: "accepted",
          providerRequestId: "request:generated-witness-answer",
          providerResponseId: "response:openai:generated-witness-answer",
          startedAt: "2026-07-19T06:00:06.000Z",
          completedAt: "2026-07-19T06:00:06.640Z",
          latencyMs: 640,
          firstStructuredDeltaMs: 220,
          streamEventCount: 10,
          structuredDeltaCount: 3,
          streamedCharacterCount: 320,
          outputHash,
          proposedCitationCount: 3,
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

function generatedAction(
  generationInput = generation(),
): Extract<TrialActionV3, { type: "ANSWER_QUESTION" }> {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: "action:generated:answer-rina",
    trialId: TRIAL_ID,
    expectedStateVersion: 6,
    actor: ACTORS.rina,
    source: "ai",
    requestedAt: "2026-07-19T06:00:07.000Z",
    causationId: eventId("action:generated:request-response"),
    correlationId: TRIAL_ID,
    responseId: RESPONSE_ID,
    interruptId: null,
    modelMetadata: generationInput.modelMetadata,
    type: "ANSWER_QUESTION",
    payload: {
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      witnessId: ACTORS.rina.witnessId,
      testimonyId: "testimony:generated:answer-rina",
      turnId: "turn:generated:answer-rina",
      text: generationInput.output.segments
        .map((segment) => segment.text)
        .join(" "),
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    },
  }) as Extract<TrialActionV3, { type: "ANSWER_QUESTION" }>;
}

async function appendGenerated(
  backend: TestBackend,
  trialAction: TrialActionV3,
  generationInput: HearingWitnessGenerationPrecommit,
  writeSnapshot = true,
): Promise<Receipt> {
  return await backend.mutation(appendGeneratedForOwnerReference, {
    ownerId: OWNER_ID,
    actionJson: JSON.stringify(trialAction),
    generationJson: JSON.stringify(generationInput),
    writeSnapshot,
  });
}

const END_DIRECT_ACTION_ID = "action:generated:end-direct";
const PLAN_ACTION_ID = "action:generated:opponent-plan";
const STRATEGY_ID = "strategy:generated:opposing";
const DECISION_ID = "decision:generated:cross";
const PLAN_CALL_ID = "call:generated:opponent-plan";
const COUNSEL_CALL_ID = "call:generated:counsel-question";
const APPEARANCE_ID = "appearance:action:generated:call-rina";
const DIRECT_TESTIMONY_ID = "testimony:generated:answer-rina";
const COUNSEL_QUESTION_ID = "question:generated:opponent-cross";
const COUNSEL_TURN_ID = "turn:generated:opponent-cross";
const COUNSEL_RESPONSE_ID = "response:generated:opponent-cross";

function emptyModelCitations() {
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

async function setupOpponentCross(): Promise<TestBackend> {
  const backend = await setupPendingWitnessResponse();
  await appendTrusted(backend, generatedAction());
  await appendTrusted(
    backend,
    action({
      actionId: END_DIRECT_ACTION_ID,
      expectedStateVersion: 7,
      actor: ACTORS.userCounsel,
      source: "user",
      causationId: eventId("action:generated:answer-rina"),
      type: "END_EXAMINATION",
      payload: {
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        disposition: "completed",
      },
    }),
  );
  return backend;
}

function opponentPlanOutput(
  mode: "question" | "end",
): OpponentPlannerModelOutput {
  const citations = {
    ...emptyModelCitations(),
    factIds: ["fact_complaint_sent"],
    evidenceIds: ["evidence_complaint_email"],
    testimonyIds: [DIRECT_TESTIMONY_ID],
  };
  return OpponentPlannerModelOutputSchema.parse({
    schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
    objectives: ["Test the timing and authorship of the complaint."],
    witnessPriorityIds: [ACTORS.rina.witnessId],
    evidencePriorityIds: ["evidence_complaint_email"],
    settlementPosture: "counter",
    privateNotes: ["Keep the cross focused on the authored email."],
    proposedMoves:
      mode === "question"
        ? [
            {
              kind: "question_witness",
              witnessId: ACTORS.rina.witnessId,
              goal: "Confirm the timing and authorship of the complaint email.",
              presentedEvidenceIds: ["evidence_complaint_email"],
              rationale: "The active cross may test the complaint chronology.",
              citations,
            },
          ]
        : [
            {
              kind: "no_action",
              rationale:
                "Waive cross because no additional question is needed.",
              citations,
            },
          ],
  });
}

function proposedCitationCount(
  output: OpponentPlannerModelOutput | CounselRoleResponseModelOutput,
): number {
  if ("proposedMoves" in output) {
    return output.proposedMoves.reduce(
      (total, move) =>
        total +
        Object.values(move.citations).reduce(
          (moveTotal, identifiers) => moveTotal + identifiers.length,
          0,
        ),
      0,
    );
  }
  return output.speechSegments.reduce(
    (total, segment) =>
      total +
      Object.values(segment.citations).reduce(
        (segmentTotal, identifiers) => segmentTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function planGeneration(
  output = opponentPlanOutput("question"),
): HearingOpponentPlanPrecommit {
  const outputHash = hashOpponentPlannerModelOutput(output);
  const citations = opponentPlannerOutputCitations(output);
  const usage = {
    inputTokens: 620,
    outputTokens: 140,
    totalTokens: 760,
    cachedInputTokens: 200,
    cacheWriteTokens: 0,
    reasoningTokens: 20,
  };
  const requestId = "request:generated:opponent-plan";
  return HearingOpponentPlanPrecommitSchema.parse({
    schemaVersion: HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
    trialId: TRIAL_ID,
    callId: PLAN_CALL_ID,
    decisionId: DECISION_ID,
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId,
      promptVersion: "opponent-planner.prompt.v2",
      schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
      latencyMs: 720,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: 0.002,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId: PLAN_CALL_ID,
      trialId: TRIAL_ID,
      responseId: null,
      actorId: ACTORS.opposingCounsel.actorId,
      actorRole: "counsel",
      callClass: "opponent_planner",
      task: "plan_opponent",
      inputEventIds: [eventId(END_DIRECT_ACTION_ID)],
      expectedStateVersion: 8,
      expectedLastEventId: eventId(END_DIRECT_ACTION_ID),
      provider: "openai-responses",
      model: "gpt-5.6-luna",
      providerProtocolVersion: "courtroom-model-provider.v1",
      promptVersion: "opponent-planner.prompt.v2",
      outputSchemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.opponent-planner.v1",
        knowledgeViewHash: "a".repeat(64),
        stateVersion: 8,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 1,
        priorStatementCount: 0,
        sourceSegmentCount: 0,
        publicRecordEventCount: 1,
        currentExchangeCount: 0,
      },
      promptAudit: {
        stablePrefixHash: "b".repeat(64),
        trustedContextHash: "c".repeat(64),
        untrustedInputHash: "d".repeat(64),
        inputCharacterCount: 1_600,
      },
      status: "accepted",
      startedAt: "2026-07-19T06:00:08.000Z",
      completedAt: "2026-07-19T06:00:08.720Z",
      latencyMs: 720,
      firstStructuredDeltaMs: 240,
      firstAcceptedSegmentMs: null,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd: 0.002,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: citations,
      acceptedCitationCount: Object.values(citations).reduce(
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
          providerRequestId: requestId,
          providerResponseId: "response:generated:opponent-plan",
          startedAt: "2026-07-19T06:00:08.000Z",
          completedAt: "2026-07-19T06:00:08.720Z",
          latencyMs: 720,
          firstStructuredDeltaMs: 240,
          streamEventCount: 12,
          structuredDeltaCount: 4,
          streamedCharacterCount: 560,
          outputHash,
          proposedCitationCount: proposedCitationCount(output),
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

function persistedDirective(output: OpponentPlannerModelOutput): string {
  const selectedMoveIndex =
    output.proposedMoves[0]?.kind === "question_witness" ? 0 : null;
  const selectedMove =
    selectedMoveIndex === null ? null : output.proposedMoves[selectedMoveIndex];
  const directive =
    selectedMove?.kind === "question_witness"
      ? {
          kind: "question_witness" as const,
          witnessId: selectedMove.witnessId,
          goal: selectedMove.goal,
          presentedEvidenceIds: selectedMove.presentedEvidenceIds,
          permittedFactIds: selectedMove.citations.factIds,
          permittedEvidenceIds: selectedMove.citations.evidenceIds,
          permittedTestimonyIds: selectedMove.citations.testimonyIds,
        }
      : {
          kind: "end_examination" as const,
          disposition: "waived" as const,
        };
  const payload = {
    schemaVersion: PERSISTED_OPPONENT_DIRECTIVE_SCHEMA_VERSION,
    decisionId: DECISION_ID,
    plannerCallId: PLAN_CALL_ID,
    plannerOutputHash: hashOpponentPlannerModelOutput(output),
    selectedMoveIndex,
    strategyId: STRATEGY_ID,
    strategyRevision: 1,
    strategyEventId: eventId(PLAN_ACTION_ID),
    trialHead: {
      trialId: TRIAL_ID,
      stateVersion: 8,
      lastEventId: eventId(END_DIRECT_ACTION_ID),
    },
    actorId: ACTORS.opposingCounsel.actorId,
    appearance: {
      appearanceId: APPEARANCE_ID,
      witnessId: ACTORS.rina.witnessId,
      examinationKind: "cross" as const,
      answeredQuestionCount: 0,
    },
    directive,
  };
  return serializePersistedOpponentDirective(
    PersistedOpponentDirectiveSchema.parse({
      ...payload,
      integrityHash: sha256Utf8(JSON.stringify(payload)),
    }),
  );
}

function generatedPlanAction(
  generationInput = planGeneration(),
): Extract<TrialActionV3, { type: "UPDATE_OPPOSING_STRATEGY" }> {
  const output = generationInput.output;
  return action({
    actionId: PLAN_ACTION_ID,
    expectedStateVersion: 8,
    actor: ACTORS.opposingCounsel,
    source: "ai",
    causationId: eventId(END_DIRECT_ACTION_ID),
    type: "UPDATE_OPPOSING_STRATEGY",
    payload: {
      strategyId: STRATEGY_ID,
      revision: 1,
      objectives: output.objectives,
      witnessPriorityIds: output.witnessPriorityIds,
      evidencePriorityIds: output.evidencePriorityIds,
      settlementPosture: output.settlementPosture,
      privateNotes: output.privateNotes,
      pendingDirectiveJson: persistedDirective(output),
    },
    modelMetadata: generationInput.modelMetadata,
  }) as Extract<TrialActionV3, { type: "UPDATE_OPPOSING_STRATEGY" }>;
}

async function appendOpponentPlan(
  backend: TestBackend,
  trialAction: TrialActionV3,
  generationInput: HearingOpponentPlanPrecommit,
): Promise<Receipt> {
  return await backend.mutation(appendOpponentPlanForOwnerReference, {
    ownerId: OWNER_ID,
    actionJson: JSON.stringify(trialAction),
    generationJson: JSON.stringify(generationInput),
    writeSnapshot: true,
  });
}

function counselOutput(
  mode: "question" | "end",
): CounselRoleResponseModelOutput {
  return CounselRoleResponseModelOutputSchema.parse({
    schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    speechSegments: [
      {
        text:
          mode === "question"
            ? "You sent the complaint email that morning, correct?"
            : "No questions, Your Honor.",
        citations:
          mode === "question"
            ? {
                ...emptyModelCitations(),
                factIds: ["fact_complaint_sent"],
                evidenceIds: ["evidence_complaint_email"],
                testimonyIds: [DIRECT_TESTIMONY_ID],
              }
            : emptyModelCitations(),
      },
    ],
    proposedAction:
      mode === "question"
        ? {
            kind: "ask_question",
            presentedEvidenceIds: ["evidence_complaint_email"],
          }
        : { kind: "end_examination", disposition: "waived" },
    performance: {
      activity: "speaking",
      emotion: "confident",
      intensity: 0.5,
      gazeTarget: mode === "question" ? "witness" : "judge",
      gesture: "open_palm",
      speakingStyle: "firm",
    },
  });
}

function counselGeneration(
  plan: HearingOpponentPlanPrecommit,
  mode: "question" | "end",
): HearingCounselResponsePrecommit {
  const output = counselOutput(mode);
  const outputHash = hashCounselResponseModelOutput(output);
  const citations = counselResponseOutputCitations(output);
  const usage = {
    inputTokens: 540,
    outputTokens: 96,
    totalTokens: 636,
    cachedInputTokens: 180,
    cacheWriteTokens: 0,
    reasoningTokens: 12,
  };
  const requestId =
    mode === "question"
      ? "request:generated:counsel-question"
      : "request:generated:counsel-end";
  const callId =
    mode === "question" ? COUNSEL_CALL_ID : "call:generated:counsel-end";
  return HearingCounselResponsePrecommitSchema.parse({
    schemaVersion: HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: TRIAL_ID,
    callId,
    decisionId: DECISION_ID,
    expectedStateVersion: 9,
    expectedLastEventId: eventId(PLAN_ACTION_ID),
    planBinding: {
      plannerCallId: plan.callId,
      plannerOutputHash: hashOpponentPlannerModelOutput(plan.output),
      strategyId: STRATEGY_ID,
      strategyRevision: 1,
    },
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId,
      promptVersion: "role-responder.counsel.prompt.v2",
      schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      latencyMs: 680,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: 0.0018,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId,
      trialId: TRIAL_ID,
      responseId: null,
      actorId: ACTORS.opposingCounsel.actorId,
      actorRole: "counsel",
      callClass: "role_responder",
      task: "counsel_response",
      inputEventIds: [eventId(PLAN_ACTION_ID)],
      expectedStateVersion: 9,
      expectedLastEventId: eventId(PLAN_ACTION_ID),
      provider: "openai-responses",
      model: "gpt-5.6-luna",
      providerProtocolVersion: "courtroom-model-provider.v1",
      promptVersion: "role-responder.counsel.prompt.v2",
      outputSchemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.opponent-counsel-public.v1",
        knowledgeViewHash: "e".repeat(64),
        stateVersion: 9,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 1,
        priorStatementCount: 0,
        sourceSegmentCount: 0,
        publicRecordEventCount: 1,
        currentExchangeCount: 0,
      },
      promptAudit: {
        stablePrefixHash: "f".repeat(64),
        trustedContextHash: "1".repeat(64),
        untrustedInputHash: "2".repeat(64),
        inputCharacterCount: 1_400,
      },
      status: "accepted",
      startedAt: "2026-07-19T06:00:09.000Z",
      completedAt: "2026-07-19T06:00:09.680Z",
      latencyMs: 680,
      firstStructuredDeltaMs: 210,
      firstAcceptedSegmentMs: null,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd: 0.0018,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: citations,
      acceptedCitationCount: Object.values(citations).reduce(
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
          providerRequestId: requestId,
          providerResponseId: `response:${callId}`,
          startedAt: "2026-07-19T06:00:09.000Z",
          completedAt: "2026-07-19T06:00:09.680Z",
          latencyMs: 680,
          firstStructuredDeltaMs: 210,
          streamEventCount: 11,
          structuredDeltaCount: 4,
          streamedCharacterCount: 460,
          outputHash,
          proposedCitationCount: proposedCitationCount(output),
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

function generatedCounselAction(
  generationInput: HearingCounselResponsePrecommit,
): Extract<TrialActionV3, { type: "ASK_QUESTION" | "END_EXAMINATION" }> {
  const output = generationInput.output;
  const text = output.speechSegments.map((segment) => segment.text).join(" ");
  const citations = counselResponseOutputCitations(output);
  if (output.proposedAction.kind === "ask_question") {
    return action({
      actionId: "action:generated:counsel-question",
      expectedStateVersion: 9,
      actor: ACTORS.opposingCounsel,
      source: "ai",
      causationId: eventId(PLAN_ACTION_ID),
      type: "ASK_QUESTION",
      payload: {
        questionId: COUNSEL_QUESTION_ID,
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "cross",
        text,
        turnId: COUNSEL_TURN_ID,
        presentedEvidenceIds: output.proposedAction.presentedEvidenceIds,
        factIds: citations.factIds,
        evidenceIds: citations.evidenceIds,
        testimonyIds: citations.testimonyIds,
      },
      modelMetadata: generationInput.modelMetadata,
    }) as Extract<TrialActionV3, { type: "ASK_QUESTION" }>;
  }
  if (output.proposedAction.kind !== "end_examination") {
    throw new Error("Counsel test output must ask or end the examination");
  }
  return action({
    actionId: "action:generated:counsel-end",
    expectedStateVersion: 9,
    actor: ACTORS.opposingCounsel,
    source: "ai",
    causationId: eventId(PLAN_ACTION_ID),
    type: "END_EXAMINATION",
    payload: {
      witnessId: ACTORS.rina.witnessId,
      examinationKind: "cross",
      disposition: output.proposedAction.disposition,
      turnId: "turn:generated:counsel-end",
      text,
      citations: {
        factIds: citations.factIds,
        evidenceIds: citations.evidenceIds,
        testimonyIds: citations.testimonyIds,
        eventIds: citations.eventIds,
        sourceSegmentIds: citations.sourceSegmentIds,
      },
    },
    modelMetadata: generationInput.modelMetadata,
  }) as Extract<TrialActionV3, { type: "END_EXAMINATION" }>;
}

function counselQuestionContinuation(): TrialActionV3 {
  return action({
    actionId: "action:generated:counsel-request-response",
    expectedStateVersion: 10,
    actor: ACTORS.system,
    source: "system",
    causationId: eventId("action:generated:counsel-question"),
    type: "REQUEST_RESPONSE",
    payload: {
      responseId: COUNSEL_RESPONSE_ID,
      actorId: ACTORS.rina.actorId,
      purpose: "answer_question",
    },
    responseId: COUNSEL_RESPONSE_ID,
  });
}

function counselReleaseContinuation(): TrialActionV3 {
  return action({
    actionId: "action:generated:release-after-waiver",
    expectedStateVersion: 10,
    actor: ACTORS.userCounsel,
    source: "deterministic",
    causationId: eventId("action:generated:counsel-end"),
    type: "RELEASE_WITNESS",
    payload: { witnessId: ACTORS.rina.witnessId },
  });
}

async function appendCounselTurn(
  backend: TestBackend,
  primary: TrialActionV3,
  continuation: TrialActionV3 | null,
  generationInput: HearingCounselResponsePrecommit,
): Promise<Receipt> {
  return await backend.mutation(appendCounselTurnForOwnerReference, {
    ownerId: OWNER_ID,
    actionJson: JSON.stringify(primary),
    continuationActionJson:
      continuation === null ? null : JSON.stringify(continuation),
    generationJson: JSON.stringify(generationInput),
    writeSnapshot: true,
  });
}

describe("atomic generated trial-event append", () => {
  it("commits one AI answer and its terminal trace atomically, then replays exactly", async () => {
    const backend = await setupPendingWitnessResponse();
    const generationInput = generation();
    const trialAction = generatedAction(generationInput);

    const first = await appendGenerated(backend, trialAction, generationInput);
    expect(first).toMatchObject({
      actionId: trialAction.actionId,
      committedStateVersion: 7,
      firstSequence: 7,
      lastSequence: 7,
      replayed: false,
    });
    const second = await appendGenerated(backend, trialAction, generationInput);
    expect(second).toEqual({ ...first, replayed: true });

    const persisted = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", TRIAL_ID),
        )
        .collect(),
      receipts: await ctx.db
        .query("actionReceipts")
        .withIndex("by_trial_version", (index) => index.eq("trialId", TRIAL_ID))
        .collect(),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) => index.eq("callId", CALL_ID))
        .collect(),
      attempts: await ctx.db
        .query("courtroomModelCallAttempts")
        .withIndex("by_call_attempt", (index) => index.eq("callId", CALL_ID))
        .collect(),
      performances: await ctx.db
        .query("courtroomCommittedPerformances")
        .withIndex("by_performance_id", (index) =>
          index.eq("performanceId", first.eventIds[0] ?? "missing"),
        )
        .collect(),
      snapshots: await ctx.db
        .query("trialSnapshots")
        .withIndex("by_trial_version", (index) => index.eq("trialId", TRIAL_ID))
        .collect(),
    }));
    expect(persisted.events).toHaveLength(7);
    expect(persisted.receipts).toHaveLength(7);
    expect(persisted.calls).toHaveLength(1);
    expect(persisted.attempts).toHaveLength(1);
    expect(persisted.performances).toHaveLength(1);
    expect(persisted.snapshots).toHaveLength(2);
    expect(persisted.snapshots.at(-1)).toMatchObject({ stateVersion: 7 });
    const answerEvent = persisted.events.at(-1);
    expect(answerEvent).toMatchObject({
      eventId: first.eventIds[0],
      actionId: trialAction.actionId,
      eventType: "ANSWER_QUESTION",
      source: "ai",
      actorId: ACTORS.rina.actorId,
      responseId: RESPONSE_ID,
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    });
    expect(
      CourtroomModelCallTraceSchema.parse(
        JSON.parse(persisted.calls[0]?.traceJson ?? "null"),
      ),
    ).toMatchObject({
      callId: CALL_ID,
      committedActionId: trialAction.actionId,
      committedEventId: first.eventIds[0],
    });
    expect(
      HearingCommittedPerformanceSchema.parse(
        JSON.parse(persisted.performances[0]?.performanceJson ?? "null"),
      ),
    ).toMatchObject({
      kind: "witness_answer",
      context: "courtroom",
      head: {
        trialId: TRIAL_ID,
        stateVersion: 7,
        lastEventId: first.eventIds[0],
      },
      source: {
        callId: CALL_ID,
        actionId: trialAction.actionId,
        eventId: first.eventIds[0],
        turnId: trialAction.payload.turnId,
        responseId: RESPONSE_ID,
      },
      actor: ACTORS.rina,
      evidenceIds: ["evidence_complaint_email"],
      semantic: {
        activity: "speaking",
        emotion: "confident",
        intensity: 0.4,
        gazeTarget: "questioning_counsel",
        gesture: "indicate_evidence",
        speakingStyle: "measured",
      },
    });
  });

  it("returns a cue only at its exact owner-bound head", async () => {
    const backend = await setupPendingWitnessResponse();
    const generationInput = generation();
    const trialAction = generatedAction(generationInput);
    const receipt = await appendGenerated(backend, trialAction, generationInput);
    const cueJson = await backend.query(
      readCommittedPerformanceForOwnerHeadReference,
      {
        ownerId: OWNER_ID,
        trialId: TRIAL_ID,
        stateVersion: receipt.committedStateVersion,
        lastEventId: receipt.eventIds[0] ?? "missing",
      },
    );
    expect(
      HearingCommittedPerformanceSchema.parse(JSON.parse(cueJson ?? "null"))
        .source.turnId,
    ).toBe(trialAction.payload.turnId);
    await expect(
      backend.query(readCommittedPerformanceForOwnerHeadReference, {
        ownerId: "owner:123e4567-e89b-42d3-a456-426614174099",
        trialId: TRIAL_ID,
        stateVersion: receipt.committedStateVersion,
        lastEventId: receipt.eventIds[0] ?? "missing",
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");

    const nextAction = action({
      actionId: "action:generated:end-after-answer",
      expectedStateVersion: receipt.committedStateVersion,
      actor: ACTORS.userCounsel,
      source: "user",
      causationId: receipt.eventIds[0] ?? "missing",
      type: "END_EXAMINATION",
      payload: {
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        disposition: "completed",
      },
    });
    const nextReceipt = await appendTrusted(backend, nextAction);
    expect(
      await backend.query(readCommittedPerformanceForOwnerHeadReference, {
        ownerId: OWNER_ID,
        trialId: TRIAL_ID,
        stateVersion: nextReceipt.committedStateVersion,
        lastEventId: nextReceipt.eventIds[0] ?? "missing",
      }),
    ).toBeNull();
    await expect(
      backend.query(readCommittedPerformanceForOwnerHeadReference, {
        ownerId: OWNER_ID,
        trialId: TRIAL_ID,
        stateVersion: receipt.committedStateVersion,
        lastEventId: receipt.eventIds[0] ?? "missing",
      }),
    ).rejects.toThrow("COURTROOM_COMMITTED_PERFORMANCE_HEAD_STALE");
  });

  it("rejects non-strict, cross-boundary, stale-head, model, and citation mismatches", async () => {
    const backend = await setupPendingWitnessResponse();
    const generationInput = generation();
    const trialAction = generatedAction(generationInput);

    const invalidCases: Array<
      Readonly<{
        action: unknown;
        generation: unknown;
        error: string;
      }>
    > = [
      {
        action: { ...trialAction, source: "deterministic" },
        generation: generationInput,
        error: "WITNESS_GENERATION_INVALID",
      },
      {
        action: trialAction,
        generation: {
          ...generationInput,
          trace: { ...generationInput.trace, actorId: ACTORS.theo.actorId },
        },
        error: "WITNESS_GENERATION_INVALID",
      },
      {
        action: trialAction,
        generation: {
          ...generationInput,
          trace: {
            ...generationInput.trace,
            expectedLastEventId: "event:wrong-head",
          },
        },
        error: "WITNESS_GENERATION_STALE",
      },
      {
        action: {
          ...trialAction,
          modelMetadata: {
            ...trialAction.modelMetadata,
            estimatedCostUsd: 0.2,
          },
        },
        generation: generationInput,
        error: "WITNESS_GENERATION_INVALID",
      },
      {
        action: {
          ...trialAction,
          payload: { ...trialAction.payload, evidenceIds: [] },
        },
        generation: generationInput,
        error: "WITNESS_GENERATION_INVALID",
      },
      {
        action: trialAction,
        generation: { ...generationInput, ownerId: OWNER_ID },
        error: "WITNESS_GENERATION_INVALID",
      },
    ];

    for (const invalidCase of invalidCases) {
      await expect(
        backend.mutation(appendGeneratedForOwnerReference, {
          ownerId: OWNER_ID,
          actionJson: JSON.stringify(invalidCase.action),
          generationJson: JSON.stringify(invalidCase.generation),
        }),
      ).rejects.toThrow(invalidCase.error);
    }

    const counts = await backend.run(async (ctx) => ({
      events: (await ctx.db.query("trialEvents").collect()).length,
      receipts: (await ctx.db.query("actionReceipts").collect()).length,
      calls: (await ctx.db.query("courtroomModelCalls").collect()).length,
      performances: (
        await ctx.db.query("courtroomCommittedPerformances").collect()
      ).length,
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
    }));
    expect(counts).toMatchObject({
      events: 6,
      receipts: 6,
      calls: 0,
      performances: 0,
    });
    expect(counts.projection).toMatchObject({
      stateVersion: 6,
      lastSequence: 6,
    });
  });

  it("rolls back a newly appended event when the terminal trace conflicts", async () => {
    const backend = await setupPendingWitnessResponse();
    const generationInput = generation();
    const trialAction = generatedAction(generationInput);
    const conflictingTrace = CourtroomModelCallTraceSchema.parse({
      ...generationInput.trace,
      committedActionId: "action:foreign-generated-answer",
      committedEventId: "event:action:foreign-generated-answer",
    });
    await backend.mutation(recordTerminalForOwnerReference, {
      ownerId: OWNER_ID,
      traceJson: JSON.stringify(conflictingTrace),
    });

    await expect(
      appendGenerated(backend, trialAction, generationInput),
    ).rejects.toThrow("COURTROOM_MODEL_CALL_CONFLICT");

    const persisted = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", TRIAL_ID),
        )
        .collect(),
      receipts: await ctx.db
        .query("actionReceipts")
        .withIndex("by_trial_version", (index) => index.eq("trialId", TRIAL_ID))
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
      snapshots: await ctx.db
        .query("trialSnapshots")
        .withIndex("by_trial_version", (index) => index.eq("trialId", TRIAL_ID))
        .collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
    }));
    expect(persisted.events).toHaveLength(6);
    expect(
      persisted.events.some((event) => event.actionId === trialAction.actionId),
    ).toBe(false);
    expect(persisted.receipts).toHaveLength(6);
    expect(
      persisted.receipts.some(
        (receipt) => receipt.actionId === trialAction.actionId,
      ),
    ).toBe(false);
    expect(persisted.calls).toHaveLength(1);
    expect(persisted.attempts).toHaveLength(1);
    expect(persisted.snapshots).toHaveLength(1);
    expect(persisted.projection).toMatchObject({
      stateVersion: 6,
      lastSequence: 6,
    });
  });
});

describe("atomic opponent-plan and counsel-turn append", () => {
  it("commits an exact private opponent plan with its trace and fully replays", async () => {
    const backend = await setupOpponentCross();
    const generationInput = planGeneration();
    const trialAction = generatedPlanAction(generationInput);

    const first = await appendOpponentPlan(
      backend,
      trialAction,
      generationInput,
    );
    expect(first).toMatchObject({
      actionId: PLAN_ACTION_ID,
      committedStateVersion: 9,
      firstSequence: 9,
      lastSequence: 9,
      replayed: false,
    });
    const second = await appendOpponentPlan(
      backend,
      trialAction,
      generationInput,
    );
    expect(second).toEqual({ ...first, replayed: true });

    const persisted = await backend.run(async (ctx) => ({
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
      event: await ctx.db
        .query("trialEvents")
        .withIndex("by_event_id", (index) =>
          index.eq("eventId", eventId(PLAN_ACTION_ID)),
        )
        .unique(),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) => index.eq("callId", PLAN_CALL_ID))
        .collect(),
      attempts: await ctx.db
        .query("courtroomModelCallAttempts")
        .withIndex("by_call_attempt", (index) =>
          index.eq("callId", PLAN_CALL_ID),
        )
        .collect(),
    }));
    expect(persisted.projection).toMatchObject({
      stateVersion: 9,
      lastSequence: 9,
    });
    expect(persisted.event).toMatchObject({
      eventType: "UPDATE_OPPOSING_STRATEGY",
      actionId: PLAN_ACTION_ID,
      actorId: ACTORS.opposingCounsel.actorId,
      source: "ai",
    });
    const payload = JSON.parse(persisted.event?.payloadJson ?? "null") as {
      pendingDirectiveJson?: string;
    };
    expect(
      serializePersistedOpponentDirective(
        PersistedOpponentDirectiveSchema.parse(
          JSON.parse(
            (payload.pendingDirectiveJson ?? "").replace(
              "SUITS_OPPONENT_DIRECTIVE_V1:",
              "",
            ),
          ),
        ),
      ),
    ).toBe(payload.pendingDirectiveJson);
    expect(persisted.calls).toHaveLength(1);
    expect(persisted.attempts).toHaveLength(1);
    expect(
      CourtroomModelCallTraceSchema.parse(
        JSON.parse(persisted.calls[0]?.traceJson ?? "null"),
      ),
    ).toMatchObject({
      committedActionId: PLAN_ACTION_ID,
      committedEventId: eventId(PLAN_ACTION_ID),
    });
  });

  it("recovers an existing plan event by adding only its missing audit", async () => {
    const backend = await setupOpponentCross();
    const generationInput = planGeneration();
    const trialAction = generatedPlanAction(generationInput);
    await appendTrusted(backend, trialAction);

    const recovered = await appendOpponentPlan(
      backend,
      trialAction,
      generationInput,
    );
    expect(recovered.replayed).toBe(true);
    const persisted = await backend.run(async (ctx) => ({
      planEvents: (await ctx.db.query("trialEvents").collect()).filter(
        (event) => event.actionId === PLAN_ACTION_ID,
      ),
      planReceipts: (await ctx.db.query("actionReceipts").collect()).filter(
        (receipt) => receipt.actionId === PLAN_ACTION_ID,
      ),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) => index.eq("callId", PLAN_CALL_ID))
        .collect(),
    }));
    expect(persisted.planEvents).toHaveLength(1);
    expect(persisted.planReceipts).toHaveLength(1);
    expect(persisted.calls).toHaveLength(1);
  });

  it("commits a cited counsel question, response request, and primary-bound trace, then replays", async () => {
    const backend = await setupOpponentCross();
    const plan = planGeneration();
    await appendOpponentPlan(backend, generatedPlanAction(plan), plan);
    const generationInput = counselGeneration(plan, "question");
    const primary = generatedCounselAction(generationInput);
    const continuation = counselQuestionContinuation();

    const first = await appendCounselTurn(
      backend,
      primary,
      continuation,
      generationInput,
    );
    expect(first).toMatchObject({
      actionId: primary.actionId,
      committedStateVersion: 10,
      firstSequence: 10,
      lastSequence: 10,
      replayed: false,
    });
    const second = await appendCounselTurn(
      backend,
      primary,
      continuation,
      generationInput,
    );
    expect(second).toEqual({ ...first, replayed: true });

    const persisted = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", TRIAL_ID),
        )
        .collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", generationInput.callId),
        )
        .collect(),
    }));
    expect(persisted.projection).toMatchObject({
      stateVersion: 11,
      lastSequence: 11,
    });
    const question = persisted.events.find(
      (event) => event.actionId === primary.actionId,
    );
    expect(question).toMatchObject({
      eventType: "ASK_QUESTION",
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
      testimonyIds: [DIRECT_TESTIMONY_ID],
    });
    expect(
      persisted.events.filter(
        (event) => event.actionId === continuation.actionId,
      ),
    ).toHaveLength(1);
    expect(
      CourtroomModelCallTraceSchema.parse(
        JSON.parse(persisted.calls[0]?.traceJson ?? "null"),
      ),
    ).toMatchObject({
      committedActionId: primary.actionId,
      committedEventId: eventId(primary.actionId),
    });
  });

  it("recovers a pre-existing counsel primary by adding its continuation and audit once", async () => {
    const backend = await setupOpponentCross();
    const plan = planGeneration();
    await appendOpponentPlan(backend, generatedPlanAction(plan), plan);
    const generationInput = counselGeneration(plan, "question");
    const primary = generatedCounselAction(generationInput);
    const continuation = counselQuestionContinuation();
    await appendTrusted(backend, primary);

    const recovered = await appendCounselTurn(
      backend,
      primary,
      continuation,
      generationInput,
    );
    expect(recovered.replayed).toBe(true);
    const persisted = await backend.run(async (ctx) => ({
      primaryEvents: (await ctx.db.query("trialEvents").collect()).filter(
        (event) => event.actionId === primary.actionId,
      ),
      continuationEvents: (await ctx.db.query("trialEvents").collect()).filter(
        (event) => event.actionId === continuation.actionId,
      ),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", generationInput.callId),
        )
        .collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
    }));
    expect(persisted.primaryEvents).toHaveLength(1);
    expect(persisted.continuationEvents).toHaveLength(1);
    expect(persisted.calls).toHaveLength(1);
    expect(persisted.projection).toMatchObject({ stateVersion: 11 });
  });

  it("durably commits examination-ending speech and a legal deterministic release", async () => {
    const backend = await setupOpponentCross();
    const plan = planGeneration(opponentPlanOutput("end"));
    await appendOpponentPlan(backend, generatedPlanAction(plan), plan);
    const generationInput = counselGeneration(plan, "end");
    const primary = generatedCounselAction(generationInput);
    const continuation = counselReleaseContinuation();

    const first = await appendCounselTurn(
      backend,
      primary,
      continuation,
      generationInput,
    );
    const second = await appendCounselTurn(
      backend,
      primary,
      continuation,
      generationInput,
    );
    expect(second).toEqual({ ...first, replayed: true });

    const persisted = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", TRIAL_ID),
        )
        .collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
    }));
    const endEvent = persisted.events.find(
      (event) => event.actionId === primary.actionId,
    );
    expect(endEvent).toMatchObject({ eventType: "END_EXAMINATION" });
    expect(JSON.parse(endEvent?.payloadJson ?? "null")).toMatchObject({
      turnId: "turn:generated:counsel-end",
      text: "No questions, Your Honor.",
      citations: {
        factIds: [],
        evidenceIds: [],
        testimonyIds: [],
        eventIds: [],
        sourceSegmentIds: [],
      },
    });
    expect(
      persisted.events.filter(
        (event) => event.actionId === continuation.actionId,
      ),
    ).toHaveLength(1);
    expect(persisted.projection).toMatchObject({
      stateVersion: 11,
      lastSequence: 11,
    });
  });

  it("rejects plan, counsel materialization, and continuation tampering without partial writes", async () => {
    const backend = await setupOpponentCross();
    const plan = planGeneration();
    const planAction = generatedPlanAction(plan);
    await expect(
      appendOpponentPlan(
        backend,
        {
          ...planAction,
          payload: {
            ...planAction.payload,
            privateNotes: ["tampered private objective"],
          },
        } as TrialActionV3,
        plan,
      ),
    ).rejects.toThrow("OPPONENT_PLAN_GENERATION_INVALID");

    await appendOpponentPlan(backend, planAction, plan);
    const generationInput = counselGeneration(plan, "question");
    const primary = generatedCounselAction(generationInput);
    const continuation = counselQuestionContinuation();
    await expect(
      appendCounselTurn(
        backend,
        {
          ...primary,
          payload: { ...primary.payload, text: "Tampered question?" },
        } as TrialActionV3,
        continuation,
        generationInput,
      ),
    ).rejects.toThrow("COUNSEL_GENERATION_INVALID");
    await expect(
      appendCounselTurn(
        backend,
        primary,
        {
          ...continuation,
          expectedStateVersion: 11,
        } as TrialActionV3,
        generationInput,
      ),
    ).rejects.toThrow("COUNSEL_GENERATION_INVALID");

    const persisted = await backend.run(async (ctx) => ({
      events: await ctx.db.query("trialEvents").collect(),
      receipts: await ctx.db.query("actionReceipts").collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
      counselCalls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", generationInput.callId),
        )
        .collect(),
    }));
    expect(
      persisted.events.some((event) => event.actionId === primary.actionId),
    ).toBe(false);
    expect(
      persisted.receipts.some(
        (receipt) => receipt.actionId === primary.actionId,
      ),
    ).toBe(false);
    expect(persisted.projection).toMatchObject({ stateVersion: 9 });
    expect(persisted.counselCalls).toHaveLength(0);
  });

  it("rolls back the counsel event and continuation when its accepted trace conflicts", async () => {
    const backend = await setupOpponentCross();
    const plan = planGeneration();
    await appendOpponentPlan(backend, generatedPlanAction(plan), plan);
    const generationInput = counselGeneration(plan, "question");
    const primary = generatedCounselAction(generationInput);
    const continuation = counselQuestionContinuation();
    const conflictingTrace = CourtroomModelCallTraceSchema.parse({
      ...generationInput.trace,
      committedActionId: "action:foreign-counsel-question",
      committedEventId: "event:action:foreign-counsel-question",
    });
    await backend.mutation(recordTerminalForOwnerReference, {
      ownerId: OWNER_ID,
      traceJson: JSON.stringify(conflictingTrace),
    });

    await expect(
      appendCounselTurn(backend, primary, continuation, generationInput),
    ).rejects.toThrow("COURTROOM_MODEL_CALL_CONFLICT");

    const persisted = await backend.run(async (ctx) => ({
      events: await ctx.db.query("trialEvents").collect(),
      receipts: await ctx.db.query("actionReceipts").collect(),
      snapshots: await ctx.db.query("trialSnapshots").collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
    }));
    expect(
      persisted.events.some((event) => event.actionId === primary.actionId),
    ).toBe(false);
    expect(
      persisted.events.some(
        (event) => event.actionId === continuation.actionId,
      ),
    ).toBe(false);
    expect(
      persisted.receipts.some(
        (receipt) =>
          receipt.actionId === primary.actionId ||
          receipt.actionId === continuation.actionId,
      ),
    ).toBe(false);
    expect(persisted.projection).toMatchObject({
      stateVersion: 9,
      lastSequence: 9,
    });
    expect(
      persisted.snapshots.some(
        (snapshot) =>
          snapshot.stateVersion === 10 || snapshot.stateVersion === 11,
      ),
    ).toBe(false);
  });
});
