import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallAttemptTrace,
  type CourtroomModelCallTrace,
} from "../src/domain/courtroom-ai/model-call-trace";
import {
  HEARING_START_SCHEMA_VERSION,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "../src/domain/hearing-runtime";
import type { PersistCourtroomModelCallResult } from "./courtroomModelCalls";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./courtroomModelCalls.ts": () => import("./courtroomModelCalls"),
  "./hearingRuntime.ts": () => import("./hearingRuntime"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

type TestBackend = TestConvex<typeof schema>;
type ReadResult = Readonly<{
  trace: CourtroomModelCallTrace;
  attempts: CourtroomModelCallAttemptTrace[];
}> | null;

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

const startReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; requestJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:start");
const recordReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; traceJson: string }>,
  PersistCourtroomModelCallResult
>("courtroomModelCalls:recordTerminalForOwner");
const readReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; callId: string }>,
  ReadResult
>("courtroomModelCalls:readForOwner");
const listReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  CourtroomModelCallTrace[]
>("courtroomModelCalls:listForOwnerTrial");

async function startTrial(backend: TestBackend): Promise<HearingRuntimeViewV1> {
  return HearingRuntimeViewV1Schema.parse(
    await backend.action(startReference, {
      ownerId: OWNER_ID,
      requestJson: JSON.stringify({
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId: "11111111-1111-4111-8111-111111111111",
        requestedAt: "2026-07-19T04:00:00.000Z",
        case: { kind: "seeded", slug: "redwood-signal-retaliation" },
        userSide: "user",
      }),
    }),
  );
}

function acceptedTrace(
  trialId: string,
  callId = "call:witness-answer:001",
): CourtroomModelCallTrace {
  return CourtroomModelCallTraceSchema.parse({
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId,
    trialId,
    responseId: "response:001",
    actorId: "actor:witness:rina",
    actorRole: "witness",
    callClass: "role_responder",
    task: "witness_answer",
    inputEventIds: ["event:question:001"],
    expectedStateVersion: 3,
    expectedLastEventId: "event:request-response:001",
    provider: "openai",
    model: "gpt-5.6-luna",
    providerProtocolVersion: "responses-api.v1",
    promptVersion: "role-responder.witness.v1",
    outputSchemaVersion: "witness-answer.output.v1",
    knowledgeScope: {
      knowledgeSchemaVersion: "knowledge-view.v2",
      knowledgeViewHash: HASH_A,
      stateVersion: 3,
      factCount: 4,
      evidenceCount: 2,
      testimonyCount: 0,
      priorStatementCount: 1,
      sourceSegmentCount: 0,
      publicRecordEventCount: 3,
      currentExchangeCount: 1,
    },
    promptAudit: {
      stablePrefixHash: HASH_B,
      trustedContextHash: HASH_C,
      untrustedInputHash: HASH_D,
      inputCharacterCount: 2_410,
    },
    status: "accepted",
    startedAt: "2026-07-19T04:00:00.000Z",
    completedAt: "2026-07-19T04:00:01.250Z",
    latencyMs: 1_250,
    firstStructuredDeltaMs: 320,
    firstAcceptedSegmentMs: 610,
    retryCount: 1,
    validationFailureCount: 1,
    estimatedCostUsd: 0.0012,
    usage: {
      inputTokens: 600,
      outputTokens: 120,
      totalTokens: 720,
      cachedInputTokens: 250,
      cacheWriteTokens: 0,
      reasoningTokens: 40,
    },
    acceptedAttempt: 2,
    acceptedCitations: {
      factIds: ["fact:complaint-date"],
      evidenceIds: ["evidence:email"],
      testimonyIds: [],
      eventIds: ["event:question:001"],
      sourceSegmentIds: [],
      priorStatementIds: ["statement:rina:001"],
    },
    acceptedCitationCount: 4,
    outputHash: HASH_A,
    outputCharacterCount: 184,
    committedActionId: "action:answer:001",
    committedEventId: "event:action:answer:001",
    safeFailureCode: null,
    attempts: [
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 1,
        mode: "initial",
        status: "validation_failed",
        providerRequestId: "req_001",
        providerResponseId: "resp_001",
        startedAt: "2026-07-19T04:00:00.000Z",
        completedAt: "2026-07-19T04:00:00.600Z",
        latencyMs: 600,
        firstStructuredDeltaMs: 300,
        streamEventCount: 8,
        structuredDeltaCount: 2,
        streamedCharacterCount: 190,
        outputHash: HASH_B,
        proposedCitationCount: 1,
        usage: {
          inputTokens: 300,
          outputTokens: 60,
          totalTokens: 360,
          cachedInputTokens: 125,
          cacheWriteTokens: 0,
          reasoningTokens: 20,
        },
        validationIssueCodes: ["citation.unknown_fact"],
        safeErrorCode: null,
      },
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 2,
        mode: "repair",
        status: "accepted",
        providerRequestId: "req_002",
        providerResponseId: "resp_002",
        startedAt: "2026-07-19T04:00:00.610Z",
        completedAt: "2026-07-19T04:00:01.250Z",
        latencyMs: 640,
        firstStructuredDeltaMs: 280,
        streamEventCount: 9,
        structuredDeltaCount: 3,
        streamedCharacterCount: 184,
        outputHash: HASH_A,
        proposedCitationCount: 4,
        usage: {
          inputTokens: 300,
          outputTokens: 60,
          totalTokens: 360,
          cachedInputTokens: 125,
          cacheWriteTokens: 0,
          reasoningTokens: 20,
        },
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  });
}

function failedTrace(trialId: string): CourtroomModelCallTrace {
  const accepted = acceptedTrace(trialId, "call:witness-answer:failed");
  return CourtroomModelCallTraceSchema.parse({
    ...accepted,
    responseId: "response:failed",
    status: "failed",
    completedAt: "2026-07-19T04:00:00.900Z",
    latencyMs: 900,
    firstStructuredDeltaMs: null,
    firstAcceptedSegmentMs: null,
    retryCount: 0,
    validationFailureCount: 0,
    estimatedCostUsd: null,
    usage: null,
    acceptedAttempt: null,
    acceptedCitations: {
      factIds: [],
      evidenceIds: [],
      testimonyIds: [],
      eventIds: [],
      sourceSegmentIds: [],
      priorStatementIds: [],
    },
    acceptedCitationCount: 0,
    outputHash: null,
    outputCharacterCount: 0,
    committedActionId: null,
    committedEventId: null,
    safeFailureCode: "provider.timeout",
    attempts: [
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 1,
        mode: "initial",
        status: "provider_failed",
        providerRequestId: "req_failed",
        providerResponseId: null,
        startedAt: "2026-07-19T04:00:00.000Z",
        completedAt: "2026-07-19T04:00:00.900Z",
        latencyMs: 900,
        firstStructuredDeltaMs: null,
        streamEventCount: 1,
        structuredDeltaCount: 0,
        streamedCharacterCount: 0,
        outputHash: null,
        proposedCitationCount: 0,
        usage: null,
        validationIssueCodes: [],
        safeErrorCode: "provider.timeout",
      },
    ],
  });
}

async function storedRows(backend: TestBackend) {
  return await backend.run(async (ctx) => ({
    calls: await ctx.db.query("courtroomModelCalls").collect(),
    attempts: await ctx.db
      .query("courtroomModelCallAttempts")
      .collect(),
  }));
}

describe("courtroom model-call audit persistence", () => {
  it("atomically persists accepted and failed terminal traces with ordered attempts", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const accepted = acceptedTrace(trial.trial.trialId);
    const failed = failedTrace(trial.trial.trialId);

    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        traceJson: JSON.stringify(accepted),
      }),
    ).resolves.toEqual({
      callId: accepted.callId,
      attemptCount: 2,
      replayed: false,
    });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        traceJson: JSON.stringify(failed),
      }),
    ).resolves.toEqual({
      callId: failed.callId,
      attemptCount: 1,
      replayed: false,
    });

    const rows = await storedRows(backend);
    expect(rows.calls).toHaveLength(2);
    expect(rows.calls.map((row) => row.status).sort()).toEqual([
      "accepted",
      "failed",
    ]);
    expect(
      rows.attempts
        .filter((row) => row.callId === accepted.callId)
        .sort((left, right) => left.attempt - right.attempt)
        .map((row) => [row.attempt, row.mode, row.status]),
    ).toEqual([
      [1, "initial", "validation_failed"],
      [2, "repair", "accepted"],
    ]);
    expect(rows.attempts.find((row) => row.attempt === 1)).toMatchObject({
      inputTokens: 300,
      outputTokens: 60,
    });

    const read = await backend.query(readReference, {
      ownerId: OWNER_ID,
      callId: accepted.callId,
    });
    expect(read?.trace).toEqual(accepted);
    expect(read?.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(
      await backend.query(readReference, {
        ownerId: OTHER_OWNER_ID,
        callId: accepted.callId,
      }),
    ).toBeNull();
    await expect(
      backend.query(listReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: trial.trial.trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.query(listReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
      }),
    ).resolves.toEqual([accepted, failed]);
  });

  it("rejects a model-attempt sidecar that no longer matches its trace", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const trace = acceptedTrace(trial.trial.trialId);
    await backend.mutation(recordReference, {
      ownerId: OWNER_ID,
      traceJson: JSON.stringify(trace),
    });
    await backend.run(async (ctx) => {
      const attempt = await ctx.db
        .query("courtroomModelCallAttempts")
        .withIndex("by_call_attempt", (index) =>
          index.eq("callId", trace.callId).eq("attempt", 1),
        )
        .unique();
      if (!attempt) throw new Error("Expected stored attempt");
      await ctx.db.patch(attempt._id, { latencyMs: attempt.latencyMs + 1 });
    });
    await expect(
      backend.query(listReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
      }),
    ).rejects.toThrow("COURTROOM_MODEL_CALL_AUDIT_INVALID");
  });

  it("replays an exact trace without writes and rejects a differing call replay", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const trace = acceptedTrace(trial.trial.trialId);

    await backend.mutation(recordReference, {
      ownerId: OWNER_ID,
      traceJson: JSON.stringify(trace),
    });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        traceJson: JSON.stringify(trace, null, 2),
      }),
    ).resolves.toEqual({
      callId: trace.callId,
      attemptCount: 2,
      replayed: true,
    });

    const conflict = CourtroomModelCallTraceSchema.parse({
      ...trace,
      promptVersion: "role-responder.witness.v2",
    });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        traceJson: JSON.stringify(conflict),
      }),
    ).rejects.toThrow("COURTROOM_MODEL_CALL_CONFLICT");
    const rows = await storedRows(backend);
    expect(rows.calls).toHaveLength(1);
    expect(rows.attempts).toHaveLength(2);
  });

  it("denies cross-owner writes without revealing or changing the owned trial", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);

    await expect(
      backend.mutation(recordReference, {
        ownerId: OTHER_OWNER_ID,
        traceJson: JSON.stringify(acceptedTrace(trial.trial.trialId)),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    expect(await storedRows(backend)).toEqual({ calls: [], attempts: [] });
  });

  it("leaves no trace or attempt records when the trial projection is missing", async () => {
    const backend = convexTest({ schema, modules });

    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        traceJson: JSON.stringify(acceptedTrace("trial:missing")),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    expect(await storedRows(backend)).toEqual({ calls: [], attempts: [] });
  });

  it("rejects raw prompt, KnowledgeView, output, and provider-message fields", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const trace = acceptedTrace(trial.trial.trialId);
    const unsafeTraces = [
      {
        ...trace,
        rawPrompt: "Never persist this prompt",
        knowledgeView: { hiddenFact: "Never persist this fact" },
        rawOutput: "Never persist this model output",
      },
      {
        ...trace,
        callId: "call:witness-answer:unsafe-attempt",
        attempts: trace.attempts.map((attempt, index) =>
          index === 0
            ? { ...attempt, providerMessages: ["Never persist this message"] }
            : attempt,
        ),
      },
    ];

    for (const unsafe of unsafeTraces) {
      await expect(
        backend.mutation(recordReference, {
          ownerId: OWNER_ID,
          traceJson: JSON.stringify(unsafe),
        }),
      ).rejects.toThrow("COURTROOM_MODEL_CALL_TRACE_INVALID");
    }
    expect(await storedRows(backend)).toEqual({ calls: [], attempts: [] });
  });
});
