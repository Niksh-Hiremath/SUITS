import { v } from "convex/values";

import {
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallTrace,
} from "../src/domain/courtroom-ai/model-call-trace";
import {
  TRIAL_EVENT_SCHEMA_VERSION_V3,
  TRIAL_STATE_SCHEMA_VERSION_V3,
  TrialStateV3Schema,
} from "../src/domain/trial-engine";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { CaseServiceOwnerIdSchema } from "./caseServiceBoundary";

const MAX_TRACE_JSON_CHARACTERS = 512_000;

type TerminalCourtroomModelCallTrace = CourtroomModelCallTrace & {
  trialId: string;
  status: "accepted" | "failed" | "cancelled" | "stale";
  completedAt: string;
  latencyMs: number;
};

export type PersistCourtroomModelCallResult = Readonly<{
  callId: string;
  attemptCount: number;
  replayed: boolean;
}>;

function invalidTrace(): never {
  throw new Error("COURTROOM_MODEL_CALL_TRACE_INVALID");
}

function assertTerminalCourtroomTrace(
  trace: CourtroomModelCallTrace,
): asserts trace is TerminalCourtroomModelCallTrace {
  if (
    trace.trialId === null ||
    trace.callClass === "case_compiler" ||
    trace.status === "in_progress" ||
    trace.completedAt === null ||
    trace.latencyMs === null
  ) {
    invalidTrace();
  }
}

function parseTraceJson(traceJson: string): TerminalCourtroomModelCallTrace {
  if (
    traceJson.length === 0 ||
    traceJson.length > MAX_TRACE_JSON_CHARACTERS
  ) {
    return invalidTrace();
  }

  let input: unknown;
  try {
    input = JSON.parse(traceJson) as unknown;
  } catch {
    return invalidTrace();
  }
  const parsed = CourtroomModelCallTraceSchema.safeParse(input);
  if (!parsed.success) return invalidTrace();
  const trace = parsed.data;
  assertTerminalCourtroomTrace(trace);
  return trace;
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) return invalidTrace();
  return result;
}

async function requireOwnedV3Projection(
  ctx: Pick<MutationCtx, "db">,
  ownerId: string,
  trialId: string,
): Promise<void> {
  if (!CaseServiceOwnerIdSchema.safeParse(ownerId).success) {
    throw new Error("COURTROOM_MODEL_CALL_OWNER_INVALID");
  }
  const projection = await ctx.db
    .query("trialProjections")
    .withIndex("by_trial", (index) => index.eq("trialId", trialId))
    .unique();
  if (!projection || projection.ownerId !== ownerId) {
    throw new Error("TRIAL_NOT_FOUND");
  }
  if (
    projection.stateSchemaVersion !== TRIAL_STATE_SCHEMA_VERSION_V3 ||
    projection.eventSchemaVersion !== TRIAL_EVENT_SCHEMA_VERSION_V3
  ) {
    throw new Error("TRIAL_MIGRATION_REQUIRED");
  }
  let stateInput: unknown;
  try {
    stateInput = JSON.parse(projection.stateJson) as unknown;
  } catch {
    throw new Error("TRIAL_PROJECTION_INVALID");
  }
  const state = TrialStateV3Schema.safeParse(stateInput);
  if (
    !state.success ||
    state.data.trialId !== trialId ||
    state.data.version !== projection.stateVersion ||
    state.data.lastSequence !== projection.lastSequence
  ) {
    throw new Error("TRIAL_PROJECTION_INVALID");
  }
}

function canonicalTraceJson(trace: TerminalCourtroomModelCallTrace): string {
  return JSON.stringify(trace);
}

/**
 * Persists a terminal model call inside the caller's existing Convex mutation.
 * Trial-event mutations use this helper so an accepted action and its exact
 * redacted call/attempt audit either commit together or both roll back.
 */
export async function persistTerminalCourtroomModelCallForOwner(
  ctx: MutationCtx,
  input: Readonly<{ ownerId: string; traceJson: string }>,
): Promise<PersistCourtroomModelCallResult> {
  const trace = parseTraceJson(input.traceJson);
  await requireOwnedV3Projection(ctx, input.ownerId, trace.trialId);
  const traceJson = canonicalTraceJson(trace);
  const existing = await ctx.db
    .query("courtroomModelCalls")
    .withIndex("by_call_id", (index) => index.eq("callId", trace.callId))
    .unique();

  if (existing) {
    if (
      existing.ownerId !== input.ownerId ||
      existing.trialId !== trace.trialId ||
      existing.traceJson !== traceJson ||
      existing.attemptCount !== trace.attempts.length
    ) {
      throw new Error("COURTROOM_MODEL_CALL_CONFLICT");
    }
    return {
      callId: trace.callId,
      attemptCount: trace.attempts.length,
      replayed: true,
    };
  }

  await ctx.db.insert("courtroomModelCalls", {
    callId: trace.callId,
    ownerId: input.ownerId,
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
    startedAt: timestamp(trace.startedAt),
    completedAt: timestamp(trace.completedAt),
    latencyMs: trace.latencyMs,
    attemptCount: trace.attempts.length,
    retryCount: trace.retryCount,
    validationFailureCount: trace.validationFailureCount,
    acceptedCitationCount: trace.acceptedCitationCount,
    outputCharacterCount: trace.outputCharacterCount,
    traceJson,
    schemaVersion: trace.schemaVersion,
  });

  for (const attempt of trace.attempts) {
    await ctx.db.insert("courtroomModelCallAttempts", {
      callId: trace.callId,
      ownerId: input.ownerId,
      trialId: trace.trialId,
      attempt: attempt.attempt,
      mode: attempt.mode,
      status: attempt.status,
      providerRequestId: attempt.providerRequestId,
      providerResponseId: attempt.providerResponseId,
      startedAt: timestamp(attempt.startedAt),
      completedAt: timestamp(attempt.completedAt),
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
    });
  }

  return {
    callId: trace.callId,
    attemptCount: trace.attempts.length,
    replayed: false,
  };
}

export const recordTerminalForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    traceJson: v.string(),
  },
  handler: async (ctx, args) =>
    await persistTerminalCourtroomModelCallForOwner(ctx, args),
});

async function readOwnedTrace(
  ctx: Pick<QueryCtx, "db">,
  ownerId: string,
  callId: string,
) {
  if (!CaseServiceOwnerIdSchema.safeParse(ownerId).success) {
    throw new Error("COURTROOM_MODEL_CALL_OWNER_INVALID");
  }
  const record = await ctx.db
    .query("courtroomModelCalls")
    .withIndex("by_call_id", (index) => index.eq("callId", callId))
    .unique();
  if (!record || record.ownerId !== ownerId) return null;

  const trace = parseTraceJson(record.traceJson);
  const attempts = await ctx.db
    .query("courtroomModelCallAttempts")
    .withIndex("by_call_attempt", (index) => index.eq("callId", callId))
    .collect();
  if (
    attempts.length !== trace.attempts.length ||
    attempts.some((attempt, index) => attempt.attempt !== index + 1)
  ) {
    throw new Error("COURTROOM_MODEL_CALL_AUDIT_INVALID");
  }
  return {
    trace,
    attempts: trace.attempts,
  };
}

/** Owner-scoped internal read for server-side Court Records and integration tests. */
export const readForOwner = internalQuery({
  args: {
    ownerId: v.string(),
    callId: v.string(),
  },
  handler: async (ctx, args) =>
    await readOwnedTrace(ctx, args.ownerId, args.callId),
});
