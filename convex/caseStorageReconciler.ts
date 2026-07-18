import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { SUPPORTED_CASE_UPLOAD_MIME_TYPES } from "../src/server/case-ingestion/schema";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { sha256HexToBase64 } from "./storageIntegrity";

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const SHA256_HEX_CASE_INSENSITIVE_PATTERN = /^[a-fA-F0-9]{64}$/u;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SWEEP_SINGLETON_KEY = "case-storage-reconciler.v1";

export const CASE_STORAGE_ORPHAN_GRACE_MS = 7 * DAY_MS;
export const CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS = DAY_MS;
export const CASE_STORAGE_RECONCILE_PAGE_SIZE = 32;
export const CASE_STORAGE_RECONCILE_CONTINUATION_DELAY_MS = 1_000;
export const CASE_STORAGE_RECONCILE_SWEEP_STALE_MS = HOUR_MS;

export type CaseStorageReconcileMode = "dry_run" | "delete";

export type CaseStorageReconcileDecision = Readonly<
  | { deleteStorage: true; reason: "eligible_orphan" }
  | {
    deleteStorage: false;
    reason:
      | "not_old_enough"
      | "unsupported_content_type"
      | "no_matching_claim"
      | "referenced"
      | "dry_run";
  }
>;

export type CaseStorageReconcileCandidate = Readonly<{
  creationTime: number;
  contentType?: string;
  cutoff: number;
  claimAssociated: boolean;
  referenced: boolean;
  deletionEnabled: boolean;
}>;

export type CaseStorageClaimAssociationCandidate = Readonly<{
  storageCreationTime: number;
  storageContentDigest: string;
  claimCreatedAt: number;
  claimUpdatedAt: number;
  claimContentDigest: string;
}>;

export type CaseStorageSweepFenceCandidate = Readonly<{
  expectedSweepId: string;
  expectedGeneration: number;
  expectedCutoff: number;
  expectedCursor: string | null;
  lock: Readonly<{
    activeSweepId: string;
    generation: number;
  }> | null;
  sweep: Readonly<{
    sweepId: string;
    generation: number;
    status: "running" | "completed" | "fenced";
    cutoff: number;
    cursor: string | null;
  }> | null;
}>;

export type CaseStorageSweepStartDecision = "start" | "already_running" | "takeover";

type ReconcilePageArgs = Readonly<{
  sweepId: string;
  generation: number;
  cutoff: number;
  cursor: string | null;
}>;

type SweepPageCounters = Readonly<{
  scanned: number;
  eligible: number;
  deleted: number;
  dryRunRetained: number;
  missing: number;
  retainedTooYoung: number;
  retainedReferenced: number;
  retainedUnsupported: number;
  retainedUnrecognizedDigest: number;
  retainedNoClaim: number;
}>;

const reconcileOrphanStoragePageReference = makeFunctionReference<
  "mutation",
  ReconcilePageArgs
>("caseStorageReconciler:reconcileOrphanStoragePage");

function normalizeStoredContentType(contentType: string | undefined): string | null {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function isCaseUploadStorageContentType(contentType: string | undefined): boolean {
  const normalized = normalizeStoredContentType(contentType);
  return normalized !== null &&
    (SUPPORTED_CASE_UPLOAD_MIME_TYPES as readonly string[]).includes(normalized);
}

export function caseStorageReconcileCutoff(now: number): number {
  if (!Number.isSafeInteger(now) || now < CASE_STORAGE_ORPHAN_GRACE_MS) {
    throw new Error("CASE_STORAGE_RECONCILE_TIME_INVALID");
  }
  return now - CASE_STORAGE_ORPHAN_GRACE_MS;
}

export function resolveCaseStorageReconcileCutoff(
  requestedCutoff: number | undefined,
  now: number,
): number {
  const newestSafeCutoff = caseStorageReconcileCutoff(now);
  if (requestedCutoff === undefined) return newestSafeCutoff;
  if (
    !Number.isSafeInteger(requestedCutoff) ||
    requestedCutoff < 0 ||
    requestedCutoff > newestSafeCutoff
  ) {
    throw new Error("CASE_STORAGE_RECONCILE_CUTOFF_INVALID");
  }
  return requestedCutoff;
}

export function caseStorageReconcileMode(
  deleteEnabledValue: string | undefined,
): CaseStorageReconcileMode {
  return deleteEnabledValue === "1" ? "delete" : "dry_run";
}

function decodeBase64Sha256(value: string): number[] | null {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard.length === 43 ? `${standard}=` : standard;
  if (padded.length !== 44 || !/^[A-Za-z0-9+/]{43}=$/u.test(padded)) return null;

  const bytes: number[] = [];
  for (let offset = 0; offset < padded.length; offset += 4) {
    const first = BASE64_ALPHABET.indexOf(padded.charAt(offset));
    const second = BASE64_ALPHABET.indexOf(padded.charAt(offset + 1));
    const thirdCharacter = padded.charAt(offset + 2);
    const fourthCharacter = padded.charAt(offset + 3);
    const third = BASE64_ALPHABET.indexOf(thirdCharacter);
    const fourth = fourthCharacter === "=" ? 0 : BASE64_ALPHABET.indexOf(fourthCharacter);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) return null;

    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    bytes.push((combined >>> 16) & 0xff);
    bytes.push((combined >>> 8) & 0xff);
    if (fourthCharacter !== "=") bytes.push(combined & 0xff);
  }
  return bytes.length === 32 ? bytes : null;
}

/** Normalizes Convex's documented hex and observed base64 SHA-256 encodings. */
export function storedStorageSha256ToHex(value: string): string | null {
  if (SHA256_HEX_CASE_INSENSITIVE_PATTERN.test(value)) return value.toLowerCase();
  const bytes = decodeBase64Sha256(value);
  if (!bytes) return null;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const canonicalBase64 = sha256HexToBase64(hex);
  const canonicalUnpadded = canonicalBase64.replace(/=+$/u, "");
  const canonicalBase64Url = canonicalUnpadded.replaceAll("+", "-").replaceAll("/", "_");
  return value === canonicalBase64 || value === canonicalUnpadded || value === canonicalBase64Url
    ? hex
    : null;
}

export function caseStorageClaimActivityRange(storageCreationTime: number): Readonly<{
  lowerBound: number;
  upperBound: number;
}> {
  if (!Number.isFinite(storageCreationTime) || storageCreationTime < 0) {
    throw new Error("CASE_STORAGE_RECONCILE_TIME_INVALID");
  }
  return {
    lowerBound: Math.max(0, storageCreationTime - CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS),
    upperBound: storageCreationTime + CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS,
  };
}

export function isCaseStorageClaimAssociated(
  candidate: CaseStorageClaimAssociationCandidate,
): boolean {
  const activityRange = caseStorageClaimActivityRange(candidate.storageCreationTime);
  if (
    !Number.isSafeInteger(candidate.claimCreatedAt) ||
    candidate.claimCreatedAt < 0 ||
    candidate.claimCreatedAt > candidate.storageCreationTime ||
    !Number.isSafeInteger(candidate.claimUpdatedAt) ||
    candidate.claimUpdatedAt < candidate.claimCreatedAt
  ) return false;
  if (
    !SHA256_HEX_PATTERN.test(candidate.storageContentDigest) ||
    !SHA256_HEX_PATTERN.test(candidate.claimContentDigest)
  ) {
    return false;
  }
  if (candidate.storageContentDigest !== candidate.claimContentDigest) return false;
  const createdForInitialGeneration =
    candidate.claimCreatedAt >= activityRange.lowerBound &&
    candidate.claimCreatedAt <= candidate.storageCreationTime;
  const activeForLaterGeneration =
    candidate.claimUpdatedAt >= activityRange.lowerBound &&
    candidate.claimUpdatedAt <= activityRange.upperBound;
  return createdForInitialGeneration || activeForLaterGeneration;
}

export function decideCaseStorageReconciliation(
  candidate: CaseStorageReconcileCandidate,
): CaseStorageReconcileDecision {
  if (!Number.isFinite(candidate.creationTime) || !Number.isFinite(candidate.cutoff)) {
    throw new Error("CASE_STORAGE_RECONCILE_TIME_INVALID");
  }
  if (candidate.creationTime >= candidate.cutoff) {
    return { deleteStorage: false, reason: "not_old_enough" };
  }
  if (!isCaseUploadStorageContentType(candidate.contentType)) {
    return { deleteStorage: false, reason: "unsupported_content_type" };
  }
  if (!candidate.claimAssociated) {
    return { deleteStorage: false, reason: "no_matching_claim" };
  }
  if (candidate.referenced) {
    return { deleteStorage: false, reason: "referenced" };
  }
  if (!candidate.deletionEnabled) {
    return { deleteStorage: false, reason: "dry_run" };
  }
  return { deleteStorage: true, reason: "eligible_orphan" };
}

export function caseStorageSweepStartDecision(
  activeSweep: Readonly<{
    status: "running" | "completed" | "fenced";
    updatedAt: number;
  }> | null,
  now: number,
): CaseStorageSweepStartDecision {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("CASE_STORAGE_RECONCILE_TIME_INVALID");
  }
  if (!activeSweep || activeSweep.status !== "running") return "start";
  if (
    !Number.isSafeInteger(activeSweep.updatedAt) ||
    activeSweep.updatedAt < 0 ||
    activeSweep.updatedAt > now
  ) {
    throw new Error("CASE_STORAGE_RECONCILE_STATE_INVALID");
  }
  return now - activeSweep.updatedAt < CASE_STORAGE_RECONCILE_SWEEP_STALE_MS
    ? "already_running"
    : "takeover";
}

export function caseStorageSweepFenceMatches(
  candidate: CaseStorageSweepFenceCandidate,
): boolean {
  const { lock, sweep } = candidate;
  return lock !== null &&
    sweep !== null &&
    lock.activeSweepId === candidate.expectedSweepId &&
    lock.generation === candidate.expectedGeneration &&
    sweep.sweepId === candidate.expectedSweepId &&
    sweep.generation === candidate.expectedGeneration &&
    sweep.status === "running" &&
    sweep.cutoff === candidate.expectedCutoff &&
    sweep.cursor === candidate.expectedCursor;
}

function emptyPageCounters(scanned: number): SweepPageCounters {
  return {
    scanned,
    eligible: 0,
    deleted: 0,
    dryRunRetained: 0,
    missing: 0,
    retainedTooYoung: 0,
    retainedReferenced: 0,
    retainedUnsupported: 0,
    retainedUnrecognizedDigest: 0,
    retainedNoClaim: 0,
  };
}

function accumulatedSweepCounters(
  sweep: Doc<"caseStorageReconcileSweeps">,
  page: SweepPageCounters,
) {
  return {
    pages: sweep.pages + 1,
    scanned: sweep.scanned + page.scanned,
    eligible: sweep.eligible + page.eligible,
    deleted: sweep.deleted + page.deleted,
    dryRunRetained: sweep.dryRunRetained + page.dryRunRetained,
    missing: sweep.missing + page.missing,
    retainedTooYoung: sweep.retainedTooYoung + page.retainedTooYoung,
    retainedReferenced: sweep.retainedReferenced + page.retainedReferenced,
    retainedUnsupported: sweep.retainedUnsupported + page.retainedUnsupported,
    retainedUnrecognizedDigest:
      sweep.retainedUnrecognizedDigest + page.retainedUnrecognizedDigest,
    retainedNoClaim: sweep.retainedNoClaim + page.retainedNoClaim,
  };
}

async function uniqueSweepById(
  ctx: MutationCtx,
  sweepId: string,
): Promise<Doc<"caseStorageReconcileSweeps"> | null> {
  const matches = await ctx.db
    .query("caseStorageReconcileSweeps")
    .withIndex("by_sweep_id", (index) => index.eq("sweepId", sweepId))
    .take(2);
  if (matches.length > 1) throw new Error("CASE_STORAGE_RECONCILE_STATE_INVALID");
  return matches[0] ?? null;
}

async function uniqueSweepLock(
  ctx: MutationCtx,
): Promise<Doc<"caseStorageReconcileLocks"> | null> {
  const matches = await ctx.db
    .query("caseStorageReconcileLocks")
    .withIndex("by_singleton_key", (index) => index.eq("singletonKey", SWEEP_SINGLETON_KEY))
    .take(2);
  if (matches.length > 1) throw new Error("CASE_STORAGE_RECONCILE_STATE_INVALID");
  return matches[0] ?? null;
}

/** Starts one fenced sweep; repeated cron invocations cannot overlap its page chain. */
export const startOrphanStorageSweep = internalMutation({
  args: {},
  returns: v.object({
    outcome: v.union(v.literal("started"), v.literal("already_running")),
    sweepId: v.string(),
    generation: v.number(),
    mode: v.union(v.literal("dry_run"), v.literal("delete")),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = resolveCaseStorageReconcileCutoff(undefined, now);
    const lock = await uniqueSweepLock(ctx);
    const activeSweep = lock ? await uniqueSweepById(ctx, lock.activeSweepId) : null;
    if (lock && !activeSweep) throw new Error("CASE_STORAGE_RECONCILE_STATE_INVALID");

    const startDecision = caseStorageSweepStartDecision(activeSweep, now);
    if (startDecision === "already_running" && lock && activeSweep) {
      return {
        outcome: "already_running" as const,
        sweepId: activeSweep.sweepId,
        generation: activeSweep.generation,
        mode: activeSweep.mode,
      };
    }
    if (startDecision === "takeover" && activeSweep) {
      await ctx.db.patch(activeSweep._id, {
        status: "fenced",
        updatedAt: now,
        completedAt: now,
      });
    }

    const generation = (lock?.generation ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) {
      throw new Error("CASE_STORAGE_RECONCILE_STATE_INVALID");
    }
    const sweepId = `case-storage-sweep:${crypto.randomUUID()}`;
    const mode = caseStorageReconcileMode(
      process.env.SUITS_STORAGE_RECONCILER_DELETE_ENABLED,
    );
    await ctx.db.insert("caseStorageReconcileSweeps", {
      sweepId,
      generation,
      status: "running",
      mode,
      cutoff,
      cursor: null,
      pages: 0,
      scanned: 0,
      eligible: 0,
      deleted: 0,
      dryRunRetained: 0,
      missing: 0,
      retainedTooYoung: 0,
      retainedReferenced: 0,
      retainedUnsupported: 0,
      retainedUnrecognizedDigest: 0,
      retainedNoClaim: 0,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    });
    if (lock) {
      await ctx.db.patch(lock._id, {
        activeSweepId: sweepId,
        generation,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("caseStorageReconcileLocks", {
        singletonKey: SWEEP_SINGLETON_KEY,
        activeSweepId: sweepId,
        generation,
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, reconcileOrphanStoragePageReference, {
      sweepId,
      generation,
      cutoff,
      cursor: null,
    });
    return { outcome: "started" as const, sweepId, generation, mode };
  },
});

/**
 * Reconciles one bounded `_storage` page. Deletion requires age, MIME, an
 * exact SHA-256 compile-claim association, and a final caseUploads reference
 * check. The sweep row, deletion audit, file deletion, and continuation are
 * committed in the same serializable mutation.
 */
export const reconcileOrphanStoragePage = internalMutation({
  args: {
    sweepId: v.string(),
    generation: v.number(),
    cutoff: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    outcome: v.union(v.literal("processed"), v.literal("fenced")),
    sweepId: v.string(),
    generation: v.number(),
    mode: v.union(v.literal("dry_run"), v.literal("delete"), v.null()),
    cutoff: v.number(),
    scanned: v.number(),
    eligible: v.number(),
    deleted: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const cutoff = resolveCaseStorageReconcileCutoff(args.cutoff, now);
    if (!Number.isSafeInteger(args.generation) || args.generation <= 0) {
      throw new Error("CASE_STORAGE_RECONCILE_FENCE_INVALID");
    }

    const [lock, sweep] = await Promise.all([
      uniqueSweepLock(ctx),
      uniqueSweepById(ctx, args.sweepId),
    ]);
    if (!caseStorageSweepFenceMatches({
      expectedSweepId: args.sweepId,
      expectedGeneration: args.generation,
      expectedCutoff: cutoff,
      expectedCursor: args.cursor,
      lock,
      sweep,
    })) {
      return {
        outcome: "fenced" as const,
        sweepId: args.sweepId,
        generation: args.generation,
        mode: sweep?.mode ?? null,
        cutoff,
        scanned: 0,
        eligible: 0,
        deleted: 0,
        continuationScheduled: false,
      };
    }
    if (!lock || !sweep) throw new Error("CASE_STORAGE_RECONCILE_STATE_INVALID");

    const page = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (index) => index.lt("_creationTime", cutoff))
      .order("asc")
      .paginate({
        cursor: args.cursor,
        numItems: CASE_STORAGE_RECONCILE_PAGE_SIZE,
      });
    const counters = { ...emptyPageCounters(page.page.length) };

    for (const candidate of page.page) {
      const current = await ctx.db.system.get("_storage", candidate._id);
      if (!current) {
        counters.missing += 1;
        continue;
      }
      if (current._creationTime >= cutoff) {
        counters.retainedTooYoung += 1;
        continue;
      }
      if (!isCaseUploadStorageContentType(current.contentType)) {
        counters.retainedUnsupported += 1;
        continue;
      }

      const contentDigest = storedStorageSha256ToHex(current.sha256);
      if (!contentDigest) {
        counters.retainedUnrecognizedDigest += 1;
        continue;
      }
      const claimRange = caseStorageClaimActivityRange(current._creationTime);
      const [claimByCreation, claimByActivity] = await Promise.all([
        ctx.db
          .query("caseCompileClaims")
          .withIndex("by_content_digest_created_at", (index) =>
            index
              .eq("contentDigest", contentDigest)
              .gte("createdAt", claimRange.lowerBound)
              .lte("createdAt", current._creationTime))
          .order("desc")
          .first(),
        ctx.db
          .query("caseCompileClaims")
          .withIndex("by_content_digest_updated_at", (index) =>
            index
              .eq("contentDigest", contentDigest)
              .gte("updatedAt", claimRange.lowerBound)
              .lte("updatedAt", claimRange.upperBound))
          .order("desc")
          .first(),
      ]);
      const claim = [claimByCreation, claimByActivity].find((candidateClaim) =>
        candidateClaim !== null && isCaseStorageClaimAssociated({
          storageCreationTime: current._creationTime,
          storageContentDigest: contentDigest,
          claimCreatedAt: candidateClaim.createdAt,
          claimUpdatedAt: candidateClaim.updatedAt,
          claimContentDigest: candidateClaim.contentDigest,
        })) ?? null;
      if (!claim || !isCaseStorageClaimAssociated({
        storageCreationTime: current._creationTime,
        storageContentDigest: contentDigest,
        claimCreatedAt: claim.createdAt,
        claimUpdatedAt: claim.updatedAt,
        claimContentDigest: claim.contentDigest,
      })) {
        counters.retainedNoClaim += 1;
        continue;
      }

      // This exact-index lookup must remain the final ownership read before deletion.
      const reference = await ctx.db
        .query("caseUploads")
        .withIndex("by_storage_id", (index) => index.eq("storageId", current._id))
        .first();
      const decision = decideCaseStorageReconciliation({
        creationTime: current._creationTime,
        contentType: current.contentType,
        cutoff,
        claimAssociated: true,
        referenced: reference !== null,
        deletionEnabled: sweep.mode === "delete",
      });
      if (!decision.deleteStorage) {
        if (decision.reason === "referenced") counters.retainedReferenced += 1;
        if (decision.reason === "dry_run") {
          counters.eligible += 1;
          counters.dryRunRetained += 1;
        }
        continue;
      }

      counters.eligible += 1;
      const deletedAt = Date.now();
      await ctx.storage.delete(current._id);
      await ctx.db.insert("caseStorageDeletionAudits", {
        auditId: `case-storage-delete:${args.sweepId}:${current._id}`,
        sweepId: args.sweepId,
        generation: args.generation,
        storageId: current._id,
        storageCreatedAt: current._creationTime,
        storageSha256: current.sha256,
        contentDigest,
        contentType: normalizeStoredContentType(current.contentType) ?? "",
        sizeBytes: current.size,
        claimId: claim.claimId,
        claimCreatedAt: claim.createdAt,
        claimUpdatedAt: claim.updatedAt,
        deletedAt,
      });
      counters.deleted += 1;
    }

    const updatedAt = Date.now();
    const continuationScheduled = !page.isDone;
    await ctx.db.patch(sweep._id, {
      ...accumulatedSweepCounters(sweep, counters),
      status: page.isDone ? "completed" : "running",
      cursor: page.isDone ? null : page.continueCursor,
      updatedAt,
      completedAt: page.isDone ? updatedAt : null,
    });
    await ctx.db.patch(lock._id, { updatedAt });
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        CASE_STORAGE_RECONCILE_CONTINUATION_DELAY_MS,
        reconcileOrphanStoragePageReference,
        {
          sweepId: args.sweepId,
          generation: args.generation,
          cutoff,
          cursor: page.continueCursor,
        },
      );
    }

    return {
      outcome: "processed" as const,
      sweepId: args.sweepId,
      generation: args.generation,
      mode: sweep.mode,
      cutoff,
      scanned: counters.scanned,
      eligible: counters.eligible,
      deleted: counters.deleted,
      continuationScheduled,
    };
  },
});
