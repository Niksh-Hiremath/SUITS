import { v } from "convex/values";
import { z } from "zod";

import { internalMutation } from "./_generated/server";

export const CASE_COMPILE_QUOTA_WINDOW_MS = 10 * 60 * 1_000;
export const CASE_COMPILE_QUOTA_MAX_ATTEMPTS = 5;
export const CASE_COMPILE_QUOTA_RETENTION_MS = CASE_COMPILE_QUOTA_WINDOW_MS * 2;
export const CASE_COMPILE_QUOTA_PRUNE_BATCH_SIZE = 64;

const CLIENT_KEY_HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const CaseCompilePermitRequestSchema = z
  .object({
    clientKeyHash: z.string().regex(CLIENT_KEY_HASH_PATTERN),
  })
  .strict();

export const CaseCompilePermitResponseSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterSeconds: z
      .number()
      .int()
      .min(0)
      .max(Math.ceil(CASE_COMPILE_QUOTA_WINDOW_MS / 1_000)),
  })
  .strict();

const CaseCompileQuotaStateSchema = z
  .object({
    attemptedAt: z
      .array(z.number().int().nonnegative())
      .max(CASE_COMPILE_QUOTA_MAX_ATTEMPTS),
  })
  .strict();

export type CaseCompilePermitRequest = z.infer<typeof CaseCompilePermitRequestSchema>;
export type CaseCompilePermitResponse = z.infer<typeof CaseCompilePermitResponseSchema>;

export type CaseCompileQuotaState = Readonly<{
  attemptedAt: readonly number[];
}>;

export type CaseCompileQuotaTransition = Readonly<{
  response: CaseCompilePermitResponse;
  attemptedAt: readonly number[];
}>;

function parseTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

/**
 * Applies a five-attempt rolling window. Convex mutations are serializable, so
 * persisting this transition in the same mutation makes concurrent permits
 * contend on the indexed client record instead of racing in process memory.
 */
export function evaluateCaseCompilePermit(
  state: CaseCompileQuotaState | null,
  now: number,
): CaseCompileQuotaTransition {
  const currentTime = parseTimestamp(now, "Quota time");
  const parsed = CaseCompileQuotaStateSchema.parse({
    attemptedAt: state?.attemptedAt ?? [],
  });
  const cutoff = currentTime - CASE_COMPILE_QUOTA_WINDOW_MS;
  const attemptedAt = parsed.attemptedAt
    .filter((attemptTime) => attemptTime > cutoff)
    .sort((left, right) => left - right);

  if (attemptedAt.length >= CASE_COMPILE_QUOTA_MAX_ATTEMPTS) {
    const oldestAttempt = attemptedAt[0] ?? currentTime;
    const secondsUntilPermit = Math.ceil(
      (oldestAttempt + CASE_COMPILE_QUOTA_WINDOW_MS - currentTime) / 1_000,
    );
    return {
      response: CaseCompilePermitResponseSchema.parse({
        allowed: false,
        retryAfterSeconds: Math.min(
          Math.ceil(CASE_COMPILE_QUOTA_WINDOW_MS / 1_000),
          Math.max(1, secondsUntilPermit),
        ),
      }),
      attemptedAt,
    };
  }

  const nextAttemptedAt = [...attemptedAt, currentTime].sort((left, right) => left - right);
  return {
    response: CaseCompilePermitResponseSchema.parse({
      allowed: true,
      retryAfterSeconds: 0,
    }),
    attemptedAt: nextAttemptedAt,
  };
}

export function caseCompileQuotaPruneCutoff(now: number): number {
  return Math.max(0, parseTimestamp(now, "Quota prune time") - CASE_COMPILE_QUOTA_RETENTION_MS);
}

/**
 * Consumes a permit using only a pre-hashed client key. This mutation never
 * receives or stores a raw address and emits no client identifiers to logs.
 */
export const consumePermit = internalMutation({
  args: {
    clientKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { clientKeyHash } = CaseCompilePermitRequestSchema.parse(args);
    const now = Date.now();
    const existingRecords = await ctx.db
      .query("caseCompileQuotas")
      .withIndex("by_client_key_hash", (index) => index.eq("clientKeyHash", clientKeyHash))
      .take(2);
    if (existingRecords.length > 1) {
      throw new Error("CASE_COMPILE_QUOTA_DUPLICATE");
    }

    const existing = existingRecords[0] ?? null;
    const transition = evaluateCaseCompilePermit(
      existing ? { attemptedAt: existing.attemptedAt } : null,
      now,
    );
    const recordId = existing
      ? existing._id
      : await ctx.db.insert("caseCompileQuotas", {
        clientKeyHash,
        attemptedAt: [...transition.attemptedAt],
        updatedAt: now,
      });

    if (existing) {
      await ctx.db.patch(existing._id, {
        attemptedAt: [...transition.attemptedAt],
        updatedAt: now,
      });
    }

    const staleRecords = await ctx.db
      .query("caseCompileQuotas")
      .withIndex("by_updated_at", (index) =>
        index.lt("updatedAt", caseCompileQuotaPruneCutoff(now)),
      )
      .order("asc")
      .take(CASE_COMPILE_QUOTA_PRUNE_BATCH_SIZE);
    for (const staleRecord of staleRecords) {
      if (staleRecord._id !== recordId) {
        await ctx.db.delete(staleRecord._id);
      }
    }

    return CaseCompilePermitResponseSchema.parse(transition.response);
  },
});
