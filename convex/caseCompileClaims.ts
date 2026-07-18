import { v } from "convex/values";
import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../src/domain/case-graph";
import {
  CaseIngestionEntityIdSchema,
  Sha256DigestSchema,
} from "../src/server/case-ingestion/schema";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  CASE_COMPILE_QUOTA_PRUNE_BATCH_SIZE,
  CaseCompilePermitResponseSchema,
  caseCompileQuotaPruneCutoff,
  evaluateCaseCompilePermit,
} from "./caseCompileQuota";
import {
  reconstructCaseCompileReplay,
  type CaseCompileReplayGraphRecord,
  type CaseCompileReplayUploadRecord,
} from "./caseCompileReplay";
import { CaseServiceOwnerIdSchema } from "./caseServiceBoundary";

export const CASE_COMPILE_CLAIM_LEASE_TTL_MS = 60_000;
export const CASE_COMPILE_CLAIM_HEARTBEAT_INTERVAL_MS = 15_000;

const LEASE_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;
const CLAIM_ID_PATTERN = /^claim:[a-f0-9]{64}$/u;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/u;

const SafeTimestampSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, "Expected a safe integer timestamp");
const GenerationSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const CaseCompileClaimIdSchema = z.string().regex(CLAIM_ID_PATTERN);
export const CaseCompileLeaseTokenSchema = z.string().regex(LEASE_TOKEN_PATTERN);
export const CaseCompileClaimFailureCodeSchema = z.string().regex(FAILURE_CODE_PATTERN);

export const CaseCompileClaimIdentitySchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    caseId: CaseGraphEntityIdSchema,
    contentDigest: Sha256DigestSchema,
  })
  .strict();

export const AcquireCaseCompileClaimRequestSchema = CaseCompileClaimIdentitySchema.extend({
  clientKeyHash: Sha256DigestSchema,
  leaseToken: CaseCompileLeaseTokenSchema,
}).strict();

const CaseCompileClaimFenceSchema = CaseCompileClaimIdentitySchema.extend({
  claimId: CaseCompileClaimIdSchema,
  generation: GenerationSchema,
  leaseToken: CaseCompileLeaseTokenSchema,
}).strict();

export const HeartbeatCaseCompileClaimRequestSchema = CaseCompileClaimFenceSchema;
export const CompleteCaseCompileClaimRequestSchema = CaseCompileClaimFenceSchema;
export const ReleaseCaseCompileClaimRequestSchema = CaseCompileClaimFenceSchema.extend({
  disposition: z.enum(["retryable_failed", "terminal_failed"]),
  failureCode: CaseCompileClaimFailureCodeSchema,
}).strict();

export const CaseCompileClaimStateSchema = z
  .object({
    claimId: CaseCompileClaimIdSchema,
    ownerId: CaseServiceOwnerIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    caseId: CaseGraphEntityIdSchema,
    contentDigest: Sha256DigestSchema,
    clientKeyHash: Sha256DigestSchema,
    status: z.enum(["leased", "retryable_failed", "terminal_failed", "completed"]),
    generation: GenerationSchema,
    leaseToken: CaseCompileLeaseTokenSchema.nullable(),
    leaseExpiresAt: SafeTimestampSchema.nullable(),
    lastHeartbeatAt: SafeTimestampSchema.nullable(),
    failureCode: CaseCompileClaimFailureCodeSchema.nullable(),
    completedAt: SafeTimestampSchema.nullable(),
    quotaConsumedAt: SafeTimestampSchema.nullable(),
    createdAt: SafeTimestampSchema,
    updatedAt: SafeTimestampSchema,
  })
  .strict()
  .superRefine((claim, ctx) => {
    if (claim.updatedAt < claim.createdAt) {
      ctx.addIssue({ code: "custom", path: ["updatedAt"], message: "Claim update predates creation" });
    }
    if (claim.status === "leased") {
      if (
        claim.generation < 1 ||
        claim.leaseToken === null ||
        claim.leaseExpiresAt === null ||
        claim.lastHeartbeatAt === null ||
        claim.quotaConsumedAt === null ||
        claim.failureCode !== null ||
        claim.completedAt !== null
      ) {
        ctx.addIssue({ code: "custom", path: ["status"], message: "Invalid leased claim state" });
      }
      if (
        claim.lastHeartbeatAt !== null &&
        claim.leaseExpiresAt !== null &&
        (
          claim.lastHeartbeatAt < claim.createdAt ||
          claim.updatedAt !== claim.lastHeartbeatAt ||
          claim.leaseExpiresAt !== claim.lastHeartbeatAt + CASE_COMPILE_CLAIM_LEASE_TTL_MS
        )
      ) {
        ctx.addIssue({ code: "custom", path: ["leaseExpiresAt"], message: "Invalid lease timing" });
      }
      return;
    }
    if (claim.leaseExpiresAt !== null) {
      ctx.addIssue({ code: "custom", path: ["leaseExpiresAt"], message: "Inactive claims cannot retain an expiry" });
    }
    if (claim.status === "completed") {
      if (claim.failureCode !== null || claim.completedAt === null) {
        ctx.addIssue({ code: "custom", path: ["status"], message: "Invalid completed claim state" });
      }
      return;
    }
    if (
      claim.failureCode === null ||
      claim.completedAt !== null ||
      claim.leaseToken === null ||
      claim.quotaConsumedAt === null
    ) {
      ctx.addIssue({ code: "custom", path: ["status"], message: "Invalid failed claim state" });
    }
  });

const AcquiredCaseCompileClaimResponseSchema = z
  .object({
    outcome: z.literal("acquired"),
    acquisition: z.enum(["new", "idempotent", "takeover", "retry"]),
    claimId: CaseCompileClaimIdSchema,
    generation: GenerationSchema,
    leaseToken: CaseCompileLeaseTokenSchema,
    leaseExpiresAt: SafeTimestampSchema,
    heartbeatIntervalMs: z.literal(CASE_COMPILE_CLAIM_HEARTBEAT_INTERVAL_MS),
  })
  .strict();

const BusyCaseCompileClaimResponseSchema = z
  .object({
    outcome: z.literal("busy"),
    claimId: CaseCompileClaimIdSchema,
    retryAfterSeconds: z.number().int().min(1).max(CASE_COMPILE_CLAIM_LEASE_TTL_MS / 1_000),
  })
  .strict();

const CompletedCaseCompileClaimResponseSchema = z
  .object({
    outcome: z.literal("completed"),
    claimId: CaseCompileClaimIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    caseId: CaseGraphEntityIdSchema,
    generation: GenerationSchema,
  })
  .strict();

const TerminalCaseCompileClaimResponseSchema = z
  .object({
    outcome: z.literal("terminal_failed"),
    claimId: CaseCompileClaimIdSchema,
    generation: GenerationSchema,
  })
  .strict();

const QuotaCaseCompileClaimResponseSchema = z
  .object({
    outcome: z.literal("quota_exceeded"),
    retryAfterSeconds: z.number().int().min(1).max(600),
  })
  .strict();

export const AcquireCaseCompileClaimResponseSchema = z.discriminatedUnion("outcome", [
  AcquiredCaseCompileClaimResponseSchema,
  BusyCaseCompileClaimResponseSchema,
  CompletedCaseCompileClaimResponseSchema,
  TerminalCaseCompileClaimResponseSchema,
  QuotaCaseCompileClaimResponseSchema,
]);

export const HeartbeatCaseCompileClaimResponseSchema = z
  .object({
    claimId: CaseCompileClaimIdSchema,
    generation: GenerationSchema,
    leaseExpiresAt: SafeTimestampSchema,
    heartbeatIntervalMs: z.literal(CASE_COMPILE_CLAIM_HEARTBEAT_INTERVAL_MS),
  })
  .strict();

export const ReleaseCaseCompileClaimResponseSchema = z
  .object({
    claimId: CaseCompileClaimIdSchema,
    generation: GenerationSchema,
    status: z.enum(["retryable_failed", "terminal_failed"]),
    replayed: z.boolean(),
  })
  .strict();

export const CompleteCaseCompileClaimResponseSchema = CompletedCaseCompileClaimResponseSchema;

export type CaseCompileClaimIdentity = z.infer<typeof CaseCompileClaimIdentitySchema>;
export type AcquireCaseCompileClaimRequest = z.infer<typeof AcquireCaseCompileClaimRequestSchema>;
export type AcquireCaseCompileClaimResponse = z.infer<typeof AcquireCaseCompileClaimResponseSchema>;
export type CaseCompileClaimState = z.infer<typeof CaseCompileClaimStateSchema>;
export type HeartbeatCaseCompileClaimRequest = z.infer<typeof HeartbeatCaseCompileClaimRequestSchema>;
export type ReleaseCaseCompileClaimRequest = z.infer<typeof ReleaseCaseCompileClaimRequestSchema>;
export type CompleteCaseCompileClaimRequest = z.infer<typeof CompleteCaseCompileClaimRequestSchema>;

export type CaseCompileClaimEvaluation = Readonly<{
  quotaRequired: boolean;
  persistence: "insert" | "patch" | "none";
  claim: CaseCompileClaimState;
  response: Exclude<AcquireCaseCompileClaimResponse, { outcome: "quota_exceeded" }>;
}>;

type ClaimMutationTransition<T> = Readonly<{
  persistence: "patch" | "none";
  claim: CaseCompileClaimState;
  response: T;
}>;

function claimConflict(): never {
  throw new Error("CASE_COMPILE_CLAIM_CONFLICT");
}

function claimFenceConflict(): never {
  throw new Error("CASE_COMPILE_CLAIM_FENCE");
}

function parseTimestamp(value: number): number {
  return SafeTimestampSchema.parse(value);
}

function leaseExpiry(now: number): number {
  const expiresAt = now + CASE_COMPILE_CLAIM_LEASE_TTL_MS;
  if (!Number.isSafeInteger(expiresAt)) throw new Error("CASE_COMPILE_CLAIM_TIME_INVALID");
  return expiresAt;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveCaseCompileClaimId(identityInput: unknown): Promise<string> {
  const carrier = CaseCompileClaimIdentitySchema.passthrough().parse(identityInput);
  const identity = CaseCompileClaimIdentitySchema.parse({
    ownerId: carrier.ownerId,
    uploadId: carrier.uploadId,
    caseId: carrier.caseId,
    contentDigest: carrier.contentDigest,
  });
  const digest = await sha256Hex(
    `suits-case-compile-claim.v1\n${identity.ownerId}\n${identity.uploadId}\n${identity.caseId}\n${identity.contentDigest}`,
  );
  return CaseCompileClaimIdSchema.parse(`claim:${digest}`);
}

function completedResponse(claim: CaseCompileClaimState): z.infer<typeof CompletedCaseCompileClaimResponseSchema> {
  return CompleteCaseCompileClaimResponseSchema.parse({
    outcome: "completed",
    claimId: claim.claimId,
    uploadId: claim.uploadId,
    caseId: claim.caseId,
    generation: claim.generation,
  });
}

async function assertClaimIdentity(
  claim: CaseCompileClaimState,
  identity: CaseCompileClaimIdentity,
  suppliedClaimId?: string,
): Promise<void> {
  const expectedClaimId = await deriveCaseCompileClaimId(identity);
  if (
    claim.claimId !== expectedClaimId ||
    (suppliedClaimId !== undefined && suppliedClaimId !== expectedClaimId) ||
    claim.ownerId !== identity.ownerId ||
    claim.uploadId !== identity.uploadId ||
    claim.caseId !== identity.caseId ||
    claim.contentDigest !== identity.contentDigest
  ) {
    claimConflict();
  }
}

function acquiredResponse(
  claim: CaseCompileClaimState,
  acquisition: "new" | "idempotent" | "takeover" | "retry",
): z.infer<typeof AcquiredCaseCompileClaimResponseSchema> {
  if (claim.leaseToken === null || claim.leaseExpiresAt === null) return claimConflict();
  return AcquiredCaseCompileClaimResponseSchema.parse({
    outcome: "acquired",
    acquisition,
    claimId: claim.claimId,
    generation: claim.generation,
    leaseToken: claim.leaseToken,
    leaseExpiresAt: claim.leaseExpiresAt,
    heartbeatIntervalMs: CASE_COMPILE_CLAIM_HEARTBEAT_INTERVAL_MS,
  });
}

function activeLease(
  claim: CaseCompileClaimState,
  generation: number,
  leaseToken: string,
  now: number,
): boolean {
  return claim.status === "leased" &&
    claim.generation === generation &&
    claim.leaseToken === leaseToken &&
    claim.leaseExpiresAt !== null &&
    now < claim.leaseExpiresAt;
}

/** Pure acquisition transition. Only the insert branch requires a quota permit. */
export async function evaluateCaseCompileClaim(
  existingInput: unknown | null,
  requestInput: unknown,
  nowInput: number,
): Promise<CaseCompileClaimEvaluation> {
  const request = AcquireCaseCompileClaimRequestSchema.parse(requestInput);
  const now = parseTimestamp(nowInput);
  const claimId = await deriveCaseCompileClaimId(request);
  if (existingInput === null) {
    const claim = CaseCompileClaimStateSchema.parse({
      claimId,
      ownerId: request.ownerId,
      uploadId: request.uploadId,
      caseId: request.caseId,
      contentDigest: request.contentDigest,
      clientKeyHash: request.clientKeyHash,
      status: "leased",
      generation: 1,
      leaseToken: request.leaseToken,
      leaseExpiresAt: leaseExpiry(now),
      lastHeartbeatAt: now,
      failureCode: null,
      completedAt: null,
      quotaConsumedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return {
      quotaRequired: true,
      persistence: "insert",
      claim,
      response: acquiredResponse(claim, "new"),
    };
  }

  const existing = CaseCompileClaimStateSchema.parse(existingInput);
  await assertClaimIdentity(existing, request);
  if (existing.status === "completed") {
    return { quotaRequired: false, persistence: "none", claim: existing, response: completedResponse(existing) };
  }
  if (existing.status === "terminal_failed") {
    return {
      quotaRequired: false,
      persistence: "none",
      claim: existing,
      response: TerminalCaseCompileClaimResponseSchema.parse({
        outcome: "terminal_failed",
        claimId: existing.claimId,
        generation: existing.generation,
      }),
    };
  }
  if (
    existing.status === "leased" &&
    existing.leaseToken === request.leaseToken &&
    existing.leaseExpiresAt !== null &&
    now < existing.leaseExpiresAt
  ) {
    return {
      quotaRequired: false,
      persistence: "none",
      claim: existing,
      response: acquiredResponse(existing, "idempotent"),
    };
  }
  if (existing.status === "leased" && existing.leaseExpiresAt !== null && now < existing.leaseExpiresAt) {
    return {
      quotaRequired: false,
      persistence: "none",
      claim: existing,
      response: BusyCaseCompileClaimResponseSchema.parse({
        outcome: "busy",
        claimId: existing.claimId,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.leaseExpiresAt - now) / 1_000)),
      }),
    };
  }

  const acquisition = existing.status === "retryable_failed" ? "retry" : "takeover";
  const claim = CaseCompileClaimStateSchema.parse({
    ...existing,
    status: "leased",
    generation: existing.generation + 1,
    leaseToken: request.leaseToken,
    leaseExpiresAt: leaseExpiry(now),
    lastHeartbeatAt: now,
    failureCode: null,
    completedAt: null,
    updatedAt: now,
  });
  return {
    quotaRequired: false,
    persistence: "patch",
    claim,
    response: acquiredResponse(claim, acquisition),
  };
}

async function parseFencedClaim<T extends z.infer<typeof CaseCompileClaimFenceSchema>>(
  existingInput: unknown,
  request: T,
): Promise<CaseCompileClaimState> {
  const existing = CaseCompileClaimStateSchema.parse(existingInput);
  await assertClaimIdentity(existing, request, request.claimId);
  return existing;
}

export async function evaluateCaseCompileHeartbeat(
  existingInput: unknown,
  requestInput: unknown,
  nowInput: number,
): Promise<ClaimMutationTransition<z.infer<typeof HeartbeatCaseCompileClaimResponseSchema>>> {
  const request = HeartbeatCaseCompileClaimRequestSchema.parse(requestInput);
  const now = parseTimestamp(nowInput);
  const existing = await parseFencedClaim(existingInput, request);
  if (!activeLease(existing, request.generation, request.leaseToken, now)) return claimFenceConflict();
  const claim = CaseCompileClaimStateSchema.parse({
    ...existing,
    leaseExpiresAt: leaseExpiry(now),
    lastHeartbeatAt: now,
    updatedAt: now,
  });
  return {
    persistence: "patch",
    claim,
    response: HeartbeatCaseCompileClaimResponseSchema.parse({
      claimId: claim.claimId,
      generation: claim.generation,
      leaseExpiresAt: claim.leaseExpiresAt,
      heartbeatIntervalMs: CASE_COMPILE_CLAIM_HEARTBEAT_INTERVAL_MS,
    }),
  };
}

export async function evaluateCaseCompileRelease(
  existingInput: unknown,
  requestInput: unknown,
  nowInput: number,
): Promise<ClaimMutationTransition<z.infer<typeof ReleaseCaseCompileClaimResponseSchema>>> {
  const request = ReleaseCaseCompileClaimRequestSchema.parse(requestInput);
  const now = parseTimestamp(nowInput);
  const existing = await parseFencedClaim(existingInput, request);
  if (
    existing.status === request.disposition &&
    existing.generation === request.generation &&
    existing.leaseToken === request.leaseToken &&
    existing.failureCode === request.failureCode
  ) {
    return {
      persistence: "none",
      claim: existing,
      response: ReleaseCaseCompileClaimResponseSchema.parse({
        claimId: existing.claimId,
        generation: existing.generation,
        status: existing.status,
        replayed: true,
      }),
    };
  }
  if (!activeLease(existing, request.generation, request.leaseToken, now)) return claimFenceConflict();
  const claim = CaseCompileClaimStateSchema.parse({
    ...existing,
    status: request.disposition,
    leaseExpiresAt: null,
    failureCode: request.failureCode,
    completedAt: null,
    updatedAt: now,
  });
  return {
    persistence: "patch",
    claim,
    response: ReleaseCaseCompileClaimResponseSchema.parse({
      claimId: claim.claimId,
      generation: claim.generation,
      status: claim.status,
      replayed: false,
    }),
  };
}

export async function evaluateCaseCompileCompletion(
  existingInput: unknown,
  requestInput: unknown,
  nowInput: number,
): Promise<ClaimMutationTransition<z.infer<typeof CompleteCaseCompileClaimResponseSchema>>> {
  const request = CompleteCaseCompileClaimRequestSchema.parse(requestInput);
  const now = parseTimestamp(nowInput);
  const existing = await parseFencedClaim(existingInput, request);
  if (existing.status === "completed") {
    return { persistence: "none", claim: existing, response: completedResponse(existing) };
  }
  if (!activeLease(existing, request.generation, request.leaseToken, now)) return claimFenceConflict();
  const claim = CaseCompileClaimStateSchema.parse({
    ...existing,
    status: "completed",
    leaseExpiresAt: null,
    failureCode: null,
    completedAt: now,
    updatedAt: now,
  });
  return { persistence: "patch", claim, response: completedResponse(claim) };
}

function claimStateFromDoc(doc: Doc<"caseCompileClaims">): CaseCompileClaimState {
  return CaseCompileClaimStateSchema.parse({
    claimId: doc.claimId,
    ownerId: doc.ownerId,
    uploadId: doc.uploadId,
    caseId: doc.caseId,
    contentDigest: doc.contentDigest,
    clientKeyHash: doc.clientKeyHash,
    status: doc.status,
    generation: doc.generation,
    leaseToken: doc.leaseToken,
    leaseExpiresAt: doc.leaseExpiresAt,
    lastHeartbeatAt: doc.lastHeartbeatAt,
    failureCode: doc.failureCode,
    completedAt: doc.completedAt,
    quotaConsumedAt: doc.quotaConsumedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
}

async function findClaimDoc(
  ctx: MutationCtx,
  identity: CaseCompileClaimIdentity,
  expectedClaimId: string,
): Promise<Doc<"caseCompileClaims"> | null> {
  const [claimMatches, uploadMatches, caseMatches] = await Promise.all([
    ctx.db.query("caseCompileClaims").withIndex("by_claim_id", (index) =>
      index.eq("claimId", expectedClaimId)).take(2),
    ctx.db.query("caseCompileClaims").withIndex("by_upload_id", (index) =>
      index.eq("uploadId", identity.uploadId)).take(2),
    ctx.db.query("caseCompileClaims").withIndex("by_case_id", (index) =>
      index.eq("caseId", identity.caseId)).take(2),
  ]);
  if (claimMatches.length > 1 || uploadMatches.length > 1 || caseMatches.length > 1) {
    return claimConflict();
  }
  const exact = claimMatches[0] ?? null;
  const indexedMatches = [uploadMatches[0], caseMatches[0]].filter(
    (item): item is Doc<"caseCompileClaims"> => item !== undefined,
  );
  if (indexedMatches.some((item) => item.claimId !== expectedClaimId)) return claimConflict();
  if (exact) await assertClaimIdentity(claimStateFromDoc(exact), identity, expectedClaimId);
  return exact;
}

async function completedReplayExists(
  ctx: MutationCtx,
  identity: CaseCompileClaimIdentity,
): Promise<boolean> {
  const uploadRecords = await ctx.db
    .query("caseUploads")
    .withIndex("by_upload_version", (index) => index.eq("uploadId", identity.uploadId))
    .take(3);
  if (uploadRecords.length === 0) return false;
  if (uploadRecords.some((record) =>
    record.ownerId !== identity.ownerId ||
    record.caseId !== identity.caseId ||
    record.contentDigest !== identity.contentDigest
  )) {
    return claimConflict();
  }
  const indexedUploads = uploadRecords.filter((record) => record.version === 2);
  const upload = indexedUploads[0];
  if (
    uploadRecords.length !== 2 ||
    new Set(uploadRecords.map((record) => record.version)).size !== 2 ||
    !uploadRecords.some((record) => record.version === 1) ||
    indexedUploads.length !== 1 ||
    !upload ||
    upload.status !== "indexed"
  ) {
    return claimConflict();
  }
  const graphs = await ctx.db
    .query("caseGraphs")
    .withIndex("by_case_version", (index) => index.eq("caseId", identity.caseId))
    .take(3);
  try {
    const replay = await reconstructCaseCompileReplay(
      { ownerId: identity.ownerId, uploadId: identity.uploadId },
      upload as CaseCompileReplayUploadRecord,
      graphs as CaseCompileReplayGraphRecord[],
    );
    if (!replay.found) return claimConflict();
    return true;
  } catch {
    return claimConflict();
  }
}

function completedReplayClaim(
  existing: CaseCompileClaimState | null,
  request: AcquireCaseCompileClaimRequest,
  claimId: string,
  now: number,
): CaseCompileClaimState {
  if (existing) {
    return CaseCompileClaimStateSchema.parse({
      ...existing,
      status: "completed",
      leaseExpiresAt: null,
      failureCode: null,
      completedAt: existing.completedAt ?? now,
      updatedAt: now,
    });
  }
  return CaseCompileClaimStateSchema.parse({
    claimId,
    ownerId: request.ownerId,
    uploadId: request.uploadId,
    caseId: request.caseId,
    contentDigest: request.contentDigest,
    clientKeyHash: request.clientKeyHash,
    status: "completed",
    generation: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    failureCode: null,
    completedAt: now,
    quotaConsumedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function persistClaim(
  ctx: MutationCtx,
  persistence: "insert" | "patch" | "none",
  existing: Doc<"caseCompileClaims"> | null,
  claim: CaseCompileClaimState,
): Promise<void> {
  if (persistence === "none") return;
  if (persistence === "insert") {
    if (existing) return claimConflict();
    await ctx.db.insert("caseCompileClaims", claim);
    return;
  }
  if (!existing) return claimConflict();
  await ctx.db.patch(existing._id, claim);
}

async function consumeNewClaimQuota(
  ctx: MutationCtx,
  clientKeyHash: string,
  now: number,
): Promise<z.infer<typeof CaseCompilePermitResponseSchema>> {
  const records = await ctx.db.query("caseCompileQuotas").withIndex("by_client_key_hash", (index) =>
    index.eq("clientKeyHash", clientKeyHash)).take(2);
  if (records.length > 1) throw new Error("CASE_COMPILE_QUOTA_DUPLICATE");
  const existing = records[0] ?? null;
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
  const staleRecords = await ctx.db.query("caseCompileQuotas").withIndex("by_updated_at", (index) =>
    index.lt("updatedAt", caseCompileQuotaPruneCutoff(now))).order("asc")
    .take(CASE_COMPILE_QUOTA_PRUNE_BATCH_SIZE);
  for (const stale of staleRecords) {
    if (stale._id !== recordId) await ctx.db.delete(stale._id);
  }
  return CaseCompilePermitResponseSchema.parse(transition.response);
}

export const acquire = internalMutation({
  args: {
    ownerId: v.string(),
    uploadId: v.string(),
    caseId: v.string(),
    contentDigest: v.string(),
    clientKeyHash: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const request = AcquireCaseCompileClaimRequestSchema.parse(args);
    const now = parseTimestamp(Date.now());
    const claimId = await deriveCaseCompileClaimId(request);
    const existingDoc = await findClaimDoc(ctx, request, claimId);
    const existing = existingDoc ? claimStateFromDoc(existingDoc) : null;

    if (await completedReplayExists(ctx, request)) {
      const claim = completedReplayClaim(existing, request, claimId, now);
      await persistClaim(ctx, existing ? "patch" : "insert", existingDoc, claim);
      return AcquireCaseCompileClaimResponseSchema.parse(completedResponse(claim));
    }
    if (existing?.status === "completed") return claimConflict();

    const evaluation = await evaluateCaseCompileClaim(existing, request, now);
    if (evaluation.quotaRequired) {
      const permit = await consumeNewClaimQuota(ctx, request.clientKeyHash, now);
      if (!permit.allowed) {
        return AcquireCaseCompileClaimResponseSchema.parse({
          outcome: "quota_exceeded",
          retryAfterSeconds: permit.retryAfterSeconds,
        });
      }
    }
    await persistClaim(ctx, evaluation.persistence, existingDoc, evaluation.claim);
    return AcquireCaseCompileClaimResponseSchema.parse(evaluation.response);
  },
});

export const heartbeat = internalMutation({
  args: {
    ownerId: v.string(),
    uploadId: v.string(),
    caseId: v.string(),
    contentDigest: v.string(),
    claimId: v.string(),
    generation: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const request = HeartbeatCaseCompileClaimRequestSchema.parse(args);
    const expectedClaimId = await deriveCaseCompileClaimId(request);
    const existingDoc = await findClaimDoc(ctx, request, expectedClaimId);
    if (!existingDoc) return claimConflict();
    const transition = await evaluateCaseCompileHeartbeat(
      claimStateFromDoc(existingDoc),
      request,
      Date.now(),
    );
    await persistClaim(ctx, transition.persistence, existingDoc, transition.claim);
    return HeartbeatCaseCompileClaimResponseSchema.parse(transition.response);
  },
});

export const release = internalMutation({
  args: {
    ownerId: v.string(),
    uploadId: v.string(),
    caseId: v.string(),
    contentDigest: v.string(),
    claimId: v.string(),
    generation: v.number(),
    leaseToken: v.string(),
    disposition: v.union(v.literal("retryable_failed"), v.literal("terminal_failed")),
    failureCode: v.string(),
  },
  handler: async (ctx, args) => {
    const request = ReleaseCaseCompileClaimRequestSchema.parse(args);
    const expectedClaimId = await deriveCaseCompileClaimId(request);
    const existingDoc = await findClaimDoc(ctx, request, expectedClaimId);
    if (!existingDoc) return claimConflict();
    const transition = await evaluateCaseCompileRelease(
      claimStateFromDoc(existingDoc),
      request,
      Date.now(),
    );
    await persistClaim(ctx, transition.persistence, existingDoc, transition.claim);
    return ReleaseCaseCompileClaimResponseSchema.parse(transition.response);
  },
});

/**
 * Completes a claim inside the same Convex transaction that registered the
 * durable draft. Case registration should call this helper before returning;
 * a stale generation then rolls back both the draft writes and completion.
 */
export async function completeCaseCompileClaimInMutation(
  ctx: MutationCtx,
  requestInput: unknown,
  nowInput = Date.now(),
): Promise<z.infer<typeof CompleteCaseCompileClaimResponseSchema>> {
  const request = CompleteCaseCompileClaimRequestSchema.parse(requestInput);
  const now = parseTimestamp(nowInput);
  const expectedClaimId = await deriveCaseCompileClaimId(request);
  const existingDoc = await findClaimDoc(ctx, request, expectedClaimId);
  if (!existingDoc) return claimConflict();
  if (!(await completedReplayExists(ctx, request))) return claimConflict();
  const transition = await evaluateCaseCompileCompletion(
    claimStateFromDoc(existingDoc),
    request,
    now,
  );
  await persistClaim(ctx, transition.persistence, existingDoc, transition.claim);
  return CompleteCaseCompileClaimResponseSchema.parse(transition.response);
}
