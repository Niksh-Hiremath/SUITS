import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../src/domain/case-graph";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  type WitnessAnswerModelOutput,
} from "../src/domain/courtroom-ai";
import {
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HearingWitnessGenerationPrecommitSchema,
  hashWitnessAnswerModelOutput,
  witnessAnswerOutputCitations,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime";
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

const recordTerminalForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; traceJson: string }>,
  Readonly<{ callId: string; attemptCount: number; replayed: boolean }>
>("courtroomModelCalls:recordTerminalForOwner");

function eventId(actionId: string): string {
  return `event:${actionId}`;
}

function action(input: Readonly<{
  actionId: string;
  expectedStateVersion: number;
  actor: ActorRef;
  source: "user" | "ai" | "deterministic" | "system";
  causationId: string;
  type: TrialActionV3["type"];
  payload: unknown;
  responseId?: string;
  modelMetadata?: TrialActionV3["modelMetadata"];
}>): TrialActionV3 {
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
      text: generationInput.output.segments.map((segment) => segment.text).join(" "),
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
        .withIndex("by_trial_version", (index) =>
          index.eq("trialId", TRIAL_ID),
        )
        .collect(),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) => index.eq("callId", CALL_ID))
        .collect(),
      attempts: await ctx.db
        .query("courtroomModelCallAttempts")
        .withIndex("by_call_attempt", (index) => index.eq("callId", CALL_ID))
        .collect(),
      snapshots: await ctx.db
        .query("trialSnapshots")
        .withIndex("by_trial_version", (index) =>
          index.eq("trialId", TRIAL_ID),
        )
        .collect(),
    }));
    expect(persisted.events).toHaveLength(7);
    expect(persisted.receipts).toHaveLength(7);
    expect(persisted.calls).toHaveLength(1);
    expect(persisted.attempts).toHaveLength(1);
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
  });

  it("rejects non-strict, cross-boundary, stale-head, model, and citation mismatches", async () => {
    const backend = await setupPendingWitnessResponse();
    const generationInput = generation();
    const trialAction = generatedAction(generationInput);

    const invalidCases: Array<Readonly<{
      action: unknown;
      generation: unknown;
      error: string;
    }>> = [
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
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
    }));
    expect(counts).toMatchObject({ events: 6, receipts: 6, calls: 0 });
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
        .withIndex("by_trial_version", (index) =>
          index.eq("trialId", TRIAL_ID),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
      snapshots: await ctx.db
        .query("trialSnapshots")
        .withIndex("by_trial_version", (index) =>
          index.eq("trialId", TRIAL_ID),
        )
        .collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", TRIAL_ID))
        .unique(),
    }));
    expect(persisted.events).toHaveLength(6);
    expect(persisted.events.some((event) => event.actionId === trialAction.actionId)).toBe(false);
    expect(persisted.receipts).toHaveLength(6);
    expect(persisted.receipts.some((receipt) => receipt.actionId === trialAction.actionId)).toBe(false);
    expect(persisted.calls).toHaveLength(1);
    expect(persisted.attempts).toHaveLength(1);
    expect(persisted.snapshots).toHaveLength(1);
    expect(persisted.projection).toMatchObject({
      stateVersion: 6,
      lastSequence: 6,
    });
  });
});
