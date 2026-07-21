import { describe, expect, it } from "vitest";

import {
  CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS,
  CASE_STORAGE_ORPHAN_GRACE_MS,
  CASE_STORAGE_RECONCILE_PAGE_SIZE,
  CASE_STORAGE_RECONCILE_SWEEP_STALE_MS,
  caseStorageReconcileCutoff,
  caseStorageReconcileMode,
  caseStorageSweepFenceMatches,
  caseStorageSweepStartDecision,
  decideCaseStorageReconciliation,
  isCaseStorageClaimAssociated,
  isCaseUploadStorageContentType,
  resolveCaseStorageReconcileCutoff,
  storedStorageSha256ToHex,
} from "./caseStorageReconciler";
import { sha256HexToBase64 } from "./storageIntegrity";

const NOW = 2_000_000_000_000;
const CUTOFF = caseStorageReconcileCutoff(NOW);
const DIGEST = "0123456789abcdef".repeat(4);

const ELIGIBLE_CANDIDATE = {
  creationTime: CUTOFF - 1,
  contentType: "application/pdf",
  cutoff: CUTOFF,
  claimAssociated: true,
  referenced: false,
  deletionEnabled: true,
} as const;

describe("case storage reconciliation policy", () => {
  it("uses a conservative seven-day grace period and a small page bound", () => {
    expect(CASE_STORAGE_ORPHAN_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(CUTOFF).toBe(NOW - CASE_STORAGE_ORPHAN_GRACE_MS);
    expect(CASE_STORAGE_RECONCILE_PAGE_SIZE).toBeGreaterThan(0);
    expect(CASE_STORAGE_RECONCILE_PAGE_SIZE).toBeLessThanOrEqual(64);
  });

  it("accepts only an omitted or conservatively old continuation cutoff", () => {
    expect(resolveCaseStorageReconcileCutoff(undefined, NOW)).toBe(CUTOFF);
    expect(resolveCaseStorageReconcileCutoff(CUTOFF, NOW)).toBe(CUTOFF);
    expect(resolveCaseStorageReconcileCutoff(CUTOFF - 1, NOW)).toBe(CUTOFF - 1);
    expect(() => resolveCaseStorageReconcileCutoff(CUTOFF + 1, NOW)).toThrow(
      "CASE_STORAGE_RECONCILE_CUTOFF_INVALID",
    );
    expect(() => resolveCaseStorageReconcileCutoff(NOW, NOW)).toThrow(
      "CASE_STORAGE_RECONCILE_CUTOFF_INVALID",
    );
    expect(() => resolveCaseStorageReconcileCutoff(Number.NaN, NOW)).toThrow(
      "CASE_STORAGE_RECONCILE_CUTOFF_INVALID",
    );
  });

  it("recognizes active and legacy case-packet content types", () => {
    expect(isCaseUploadStorageContentType("text/plain")).toBe(true);
    expect(isCaseUploadStorageContentType(" Text/Markdown; charset=UTF-8 ")).toBe(true);
    expect(isCaseUploadStorageContentType("application/pdf")).toBe(true);
    expect(
      isCaseUploadStorageContentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(isCaseUploadStorageContentType(undefined)).toBe(false);
    expect(isCaseUploadStorageContentType("image/png")).toBe(false);
  });

  it("defaults to dry-run and requires the exact deletion opt-in", () => {
    expect(caseStorageReconcileMode(undefined)).toBe("dry_run");
    expect(caseStorageReconcileMode("0")).toBe("dry_run");
    expect(caseStorageReconcileMode("true")).toBe("dry_run");
    expect(caseStorageReconcileMode(" 1 ")).toBe("dry_run");
    expect(caseStorageReconcileMode("1")).toBe("delete");
    expect(
      decideCaseStorageReconciliation({
        ...ELIGIBLE_CANDIDATE,
        deletionEnabled: false,
      }),
    ).toEqual({ deleteStorage: false, reason: "dry_run" });
  });

  it("retains objects that have not aged strictly beyond the grace cutoff", () => {
    expect(
      decideCaseStorageReconciliation({
        ...ELIGIBLE_CANDIDATE,
        creationTime: CUTOFF,
      }),
    ).toEqual({ deleteStorage: false, reason: "not_old_enough" });
  });

  it("retains unsupported, unclaimed, and referenced objects", () => {
    expect(
      decideCaseStorageReconciliation({
        ...ELIGIBLE_CANDIDATE,
        contentType: "audio/mpeg",
      }),
    ).toEqual({ deleteStorage: false, reason: "unsupported_content_type" });
    expect(
      decideCaseStorageReconciliation({
        ...ELIGIBLE_CANDIDATE,
        claimAssociated: false,
      }),
    ).toEqual({ deleteStorage: false, reason: "no_matching_claim" });
    expect(
      decideCaseStorageReconciliation({
        ...ELIGIBLE_CANDIDATE,
        referenced: true,
      }),
    ).toEqual({ deleteStorage: false, reason: "referenced" });
  });

  it("deletes only an opted-in, old, claimed, unreferenced case object", () => {
    expect(decideCaseStorageReconciliation(ELIGIBLE_CANDIDATE)).toEqual({
      deleteStorage: true,
      reason: "eligible_orphan",
    });
  });
});

describe("case storage digest and claim ownership", () => {
  it("normalizes documented hex plus observed base64 and base64url digests", () => {
    const base64 = sha256HexToBase64(DIGEST);
    const base64Url = base64
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    expect(storedStorageSha256ToHex(DIGEST)).toBe(DIGEST);
    expect(storedStorageSha256ToHex(DIGEST.toUpperCase())).toBe(DIGEST);
    expect(storedStorageSha256ToHex(base64)).toBe(DIGEST);
    expect(storedStorageSha256ToHex(base64.replace(/=+$/u, ""))).toBe(DIGEST);
    expect(storedStorageSha256ToHex(base64Url)).toBe(DIGEST);
  });

  it("fails closed for malformed or non-canonical storage digests", () => {
    expect(storedStorageSha256ToHex("")).toBeNull();
    expect(storedStorageSha256ToHex("not-a-digest")).toBeNull();
    expect(storedStorageSha256ToHex(`${sha256HexToBase64(DIGEST).slice(0, -2)}AA`)).toBeNull();
  });

  it("requires an exact digest claim created within the activity horizon", () => {
    const storageCreationTime = NOW;
    expect(
      isCaseStorageClaimAssociated({
        storageCreationTime,
        storageContentDigest: DIGEST,
        claimCreatedAt: storageCreationTime - CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS,
        claimUpdatedAt: storageCreationTime - CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS,
        claimContentDigest: DIGEST,
      }),
    ).toBe(true);
    expect(
      isCaseStorageClaimAssociated({
        storageCreationTime,
        storageContentDigest: DIGEST,
        claimCreatedAt: storageCreationTime - CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS - 1,
        claimUpdatedAt: storageCreationTime - CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS - 1,
        claimContentDigest: DIGEST,
      }),
    ).toBe(false);
    expect(
      isCaseStorageClaimAssociated({
        storageCreationTime,
        storageContentDigest: DIGEST,
        claimCreatedAt: storageCreationTime + 1,
        claimUpdatedAt: storageCreationTime + 1,
        claimContentDigest: DIGEST,
      }),
    ).toBe(false);
    expect(
      isCaseStorageClaimAssociated({
        storageCreationTime,
        storageContentDigest: DIGEST,
        claimCreatedAt: storageCreationTime,
        claimUpdatedAt: storageCreationTime,
        claimContentDigest: "f".repeat(64),
      }),
    ).toBe(false);
  });

  it("associates a later retry by bounded claim activity even when creation is old", () => {
    expect(
      isCaseStorageClaimAssociated({
        storageCreationTime: NOW,
        storageContentDigest: DIGEST,
        claimCreatedAt: NOW - (8 * 24 * 60 * 60 * 1_000),
        claimUpdatedAt: NOW - 15_000,
        claimContentDigest: DIGEST,
      }),
    ).toBe(true);
    expect(
      isCaseStorageClaimAssociated({
        storageCreationTime: NOW,
        storageContentDigest: DIGEST,
        claimCreatedAt: NOW - (8 * 24 * 60 * 60 * 1_000),
        claimUpdatedAt: NOW - CASE_STORAGE_CLAIM_ACTIVITY_HORIZON_MS - 1,
        claimContentDigest: DIGEST,
      }),
    ).toBe(false);
  });
});

describe("case storage sweep fencing", () => {
  const activeFence = {
    expectedSweepId: "case-storage-sweep:current",
    expectedGeneration: 4,
    expectedCutoff: CUTOFF,
    expectedCursor: "cursor:next",
    lock: {
      activeSweepId: "case-storage-sweep:current",
      generation: 4,
    },
    sweep: {
      sweepId: "case-storage-sweep:current",
      generation: 4,
      status: "running" as const,
      cutoff: CUTOFF,
      cursor: "cursor:next",
    },
  };

  it("accepts only the active running sweep identity, cutoff, and cursor", () => {
    expect(caseStorageSweepFenceMatches(activeFence)).toBe(true);
    expect(
      caseStorageSweepFenceMatches({ ...activeFence, expectedGeneration: 3 }),
    ).toBe(false);
    expect(
      caseStorageSweepFenceMatches({
        ...activeFence,
        sweep: { ...activeFence.sweep, status: "completed" },
      }),
    ).toBe(false);
    expect(
      caseStorageSweepFenceMatches({ ...activeFence, expectedCutoff: CUTOFF - 1 }),
    ).toBe(false);
    expect(
      caseStorageSweepFenceMatches({ ...activeFence, expectedCursor: "cursor:stale" }),
    ).toBe(false);
    expect(caseStorageSweepFenceMatches({ ...activeFence, lock: null })).toBe(false);
  });

  it("blocks fresh overlap and permits a stale fenced takeover", () => {
    expect(caseStorageSweepStartDecision(null, NOW)).toBe("start");
    expect(
      caseStorageSweepStartDecision({ status: "completed", updatedAt: NOW }, NOW),
    ).toBe("start");
    expect(
      caseStorageSweepStartDecision({ status: "running", updatedAt: NOW - 1 }, NOW),
    ).toBe("already_running");
    expect(
      caseStorageSweepStartDecision(
        { status: "running", updatedAt: NOW - CASE_STORAGE_RECONCILE_SWEEP_STALE_MS },
        NOW,
      ),
    ).toBe("takeover");
  });
});
