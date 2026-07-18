import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  CASE_STORAGE_ORPHAN_GRACE_MS,
  CASE_STORAGE_RECONCILE_PAGE_SIZE,
} from "./caseStorageReconciler";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./caseStorageReconciler.ts": () => import("./caseStorageReconciler"),
};

const NOW = Date.UTC(2026, 6, 18, 16, 0, 0);
const OLD_STORAGE_TIME = NOW - CASE_STORAGE_ORPHAN_GRACE_MS - 24 * 60 * 60 * 1_000;
const DELETE_ENV = "SUITS_STORAGE_RECONCILER_DELETE_ENABLED";

type TestBackend = TestConvex<typeof schema>;

type StartSweepResult = Readonly<{
  outcome: "started" | "already_running";
  sweepId: string;
  generation: number;
  mode: "dry_run" | "delete";
}>;

type ReconcilePageArgs = Readonly<{
  sweepId: string;
  generation: number;
  cutoff: number;
  cursor: string | null;
}>;

type ReconcilePageResult = Readonly<{
  outcome: "processed" | "fenced";
  sweepId: string;
  generation: number;
  mode: "dry_run" | "delete" | null;
  cutoff: number;
  scanned: number;
  eligible: number;
  deleted: number;
  continuationScheduled: boolean;
}>;

type StoredFixture = Readonly<{
  storageId: Id<"_storage">;
  creationTime: number;
  sha256: string;
  contentDigest: string;
  contentType: string;
  sizeBytes: number;
}>;

type StorageMetadataPatchWriter = Readonly<{
  patch: (
    tableName: "_storage",
    storageId: Id<"_storage">,
    value: Readonly<{ contentType: string }>,
  ) => Promise<void>;
}>;

const startSweepReference = makeFunctionReference<
  "mutation",
  Record<string, never>,
  StartSweepResult
>("caseStorageReconciler:startOrphanStorageSweep");

const reconcilePageReference = makeFunctionReference<
  "mutation",
  ReconcilePageArgs,
  ReconcilePageResult
>("caseStorageReconciler:reconcileOrphanStoragePage");

let originalDeleteEnvironment: string | undefined;

afterEach(() => {
  if (originalDeleteEnvironment === undefined) {
    delete process.env[DELETE_ENV];
  } else {
    process.env[DELETE_ENV] = originalDeleteEnvironment;
  }
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

async function storeFixture(
  backend: TestBackend,
  body: string,
  contentType: string,
): Promise<StoredFixture> {
  const contentDigest = await sha256Hex(body);
  return backend.run(async (ctx) => {
    const blob = new Blob([body], { type: contentType });
    const storageId = await ctx.storage.store(blob);

    // convex-test 0.0.54 stores size and sha256 but omits Blob.type. This
    // test-only write supplies the system metadata that a real upload creates.
    const storageWriter = ctx.db as unknown as StorageMetadataPatchWriter;
    await storageWriter.patch("_storage", storageId, { contentType });

    const metadata = await ctx.db.system.get("_storage", storageId);
    if (!metadata) throw new Error("TEST_STORAGE_METADATA_MISSING");
    return {
      storageId,
      creationTime: metadata._creationTime,
      sha256: metadata.sha256,
      contentDigest,
      contentType,
      sizeBytes: metadata.size,
    };
  });
}

async function insertClaim(
  backend: TestBackend,
  fixture: StoredFixture,
  suffix: string,
) {
  const claimCreatedAt = Math.floor(fixture.creationTime) - 1_000;
  const claimUpdatedAt = Math.floor(fixture.creationTime);
  const claimId = `claim:test-${suffix}`;
  await backend.run(async (ctx) => {
    await ctx.db.insert("caseCompileClaims", {
      claimId,
      ownerId: `owner:test-${suffix}`,
      uploadId: `upload:test-${suffix}`,
      caseId: `case:test-${suffix}`,
      contentDigest: fixture.contentDigest,
      clientKeyHash: `client-key:${suffix}`,
      status: "terminal_failed",
      generation: 1,
      leaseToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: claimUpdatedAt,
      failureCode: "TEST_ORPHAN",
      completedAt: null,
      quotaConsumedAt: claimCreatedAt,
      createdAt: claimCreatedAt,
      updatedAt: claimUpdatedAt,
    });
  });
  return { claimId, claimCreatedAt, claimUpdatedAt };
}

async function referenceFixture(
  backend: TestBackend,
  fixture: StoredFixture,
  suffix: string,
) {
  await backend.run(async (ctx) => {
    await ctx.db.insert("caseUploads", {
      uploadRecordId: `case-upload:test-${suffix}`,
      uploadId: `upload:test-${suffix}`,
      version: 1,
      caseId: `case:test-${suffix}`,
      ownerId: `owner:test-${suffix}`,
      storageId: fixture.storageId,
      originalName: `${suffix}.txt`,
      mimeType: fixture.contentType,
      sizeBytes: fixture.sizeBytes,
      contentDigest: fixture.contentDigest,
      status: "uploaded",
      metadataJson: "{}",
      schemaVersion: "case-upload.test.v1",
      createdAt: Math.floor(fixture.creationTime),
    });
  });
}

async function sweepState(backend: TestBackend, sweepId: string) {
  return backend.run(async (ctx) => {
    const matches = await ctx.db
      .query("caseStorageReconcileSweeps")
      .withIndex("by_sweep_id", (index) => index.eq("sweepId", sweepId))
      .take(2);
    if (matches.length !== 1) throw new Error("TEST_SWEEP_STATE_INVALID");
    return matches[0];
  });
}

async function runExplicitPage(backend: TestBackend, start: StartSweepResult) {
  const sweep = await sweepState(backend, start.sweepId);
  return backend.mutation(reconcilePageReference, {
    sweepId: start.sweepId,
    generation: start.generation,
    cutoff: sweep.cutoff,
    cursor: sweep.cursor,
  });
}

async function storageMetadata(backend: TestBackend, storageId: Id<"_storage">) {
  return backend.run((ctx) => ctx.db.system.get("_storage", storageId));
}

describe.sequential("case storage reconciler transactions", () => {
  it("dry-runs safely, then deletes only an exact-digest claimed orphan with an audit", async () => {
    originalDeleteEnvironment = process.env[DELETE_ENV];
    vi.useFakeTimers();
    vi.setSystemTime(OLD_STORAGE_TIME);
    const backend = convexTest({ schema, modules });

    const eligible = await storeFixture(backend, "eligible orphan", "text/plain");
    const referenced = await storeFixture(backend, "referenced upload", "text/markdown");
    const unsupported = await storeFixture(
      backend,
      "unsupported upload",
      "application/octet-stream",
    );
    const unclaimed = await storeFixture(backend, "unclaimed upload", "text/plain");
    const eligibleClaim = await insertClaim(backend, eligible, "eligible");
    await insertClaim(backend, referenced, "referenced");
    await insertClaim(backend, unsupported, "unsupported");
    await referenceFixture(backend, referenced, "referenced");

    vi.setSystemTime(NOW);
    delete process.env[DELETE_ENV];
    const dryRun = await backend.mutation(startSweepReference, {});
    expect(dryRun).toMatchObject({ outcome: "started", generation: 1, mode: "dry_run" });

    const dryRunPage = await runExplicitPage(backend, dryRun);
    expect(dryRunPage).toEqual({
      outcome: "processed",
      sweepId: dryRun.sweepId,
      generation: 1,
      mode: "dry_run",
      cutoff: NOW - CASE_STORAGE_ORPHAN_GRACE_MS,
      scanned: 4,
      eligible: 1,
      deleted: 0,
      continuationScheduled: false,
    });
    const dryRunState = await sweepState(backend, dryRun.sweepId);
    expect(dryRunState).toMatchObject({
      status: "completed",
      pages: 1,
      scanned: 4,
      eligible: 1,
      deleted: 0,
      dryRunRetained: 1,
      retainedReferenced: 1,
      retainedUnsupported: 1,
      retainedNoClaim: 1,
    });
    expect(await storageMetadata(backend, eligible.storageId)).not.toBeNull();
    expect(await backend.run((ctx) => ctx.db.query("caseStorageDeletionAudits").collect()))
      .toEqual([]);

    process.env[DELETE_ENV] = "1";
    const deleting = await backend.mutation(startSweepReference, {});
    expect(deleting).toMatchObject({ outcome: "started", generation: 2, mode: "delete" });
    const deletePage = await runExplicitPage(backend, deleting);
    expect(deletePage).toMatchObject({
      outcome: "processed",
      generation: 2,
      mode: "delete",
      scanned: 4,
      eligible: 1,
      deleted: 1,
      continuationScheduled: false,
    });

    expect(await storageMetadata(backend, eligible.storageId)).toBeNull();
    for (const retained of [referenced, unsupported, unclaimed]) {
      expect(await storageMetadata(backend, retained.storageId)).not.toBeNull();
    }

    const audits = await backend.run((ctx) =>
      ctx.db.query("caseStorageDeletionAudits").collect());
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      auditId: `case-storage-delete:${deleting.sweepId}:${eligible.storageId}`,
      sweepId: deleting.sweepId,
      generation: deleting.generation,
      storageId: eligible.storageId,
      storageCreatedAt: eligible.creationTime,
      storageSha256: eligible.sha256,
      contentDigest: eligible.contentDigest,
      contentType: "text/plain",
      sizeBytes: eligible.sizeBytes,
      claimId: eligibleClaim.claimId,
      claimCreatedAt: eligibleClaim.claimCreatedAt,
      claimUpdatedAt: eligibleClaim.claimUpdatedAt,
      deletedAt: NOW,
    });
  });

  it("bounds each storage page and fences stale cursors and generations", async () => {
    originalDeleteEnvironment = process.env[DELETE_ENV];
    vi.useFakeTimers();
    vi.setSystemTime(OLD_STORAGE_TIME);
    const backend = convexTest({ schema, modules });

    for (let index = 0; index < CASE_STORAGE_RECONCILE_PAGE_SIZE + 1; index += 1) {
      await storeFixture(
        backend,
        `unsupported-${index}`,
        "application/octet-stream",
      );
    }

    vi.setSystemTime(NOW);
    delete process.env[DELETE_ENV];
    const start = await backend.mutation(startSweepReference, {});
    const firstPage = await runExplicitPage(backend, start);
    expect(firstPage).toMatchObject({
      outcome: "processed",
      scanned: CASE_STORAGE_RECONCILE_PAGE_SIZE,
      deleted: 0,
      continuationScheduled: true,
    });
    const pending = await sweepState(backend, start.sweepId);
    expect(pending).toMatchObject({
      status: "running",
      pages: 1,
      scanned: CASE_STORAGE_RECONCILE_PAGE_SIZE,
      retainedUnsupported: CASE_STORAGE_RECONCILE_PAGE_SIZE,
    });
    expect(pending.cursor).not.toBeNull();

    const staleCursor = await backend.mutation(reconcilePageReference, {
      sweepId: start.sweepId,
      generation: start.generation,
      cutoff: pending.cutoff,
      cursor: null,
    });
    expect(staleCursor).toMatchObject({
      outcome: "fenced",
      scanned: 0,
      deleted: 0,
      continuationScheduled: false,
    });

    const staleGeneration = await backend.mutation(reconcilePageReference, {
      sweepId: start.sweepId,
      generation: start.generation + 1,
      cutoff: pending.cutoff,
      cursor: pending.cursor,
    });
    expect(staleGeneration).toMatchObject({
      outcome: "fenced",
      scanned: 0,
      deleted: 0,
      continuationScheduled: false,
    });

    const lastPage = await backend.mutation(reconcilePageReference, {
      sweepId: start.sweepId,
      generation: start.generation,
      cutoff: pending.cutoff,
      cursor: pending.cursor,
    });
    expect(lastPage).toMatchObject({
      outcome: "processed",
      scanned: 1,
      deleted: 0,
      continuationScheduled: false,
    });
    expect(await sweepState(backend, start.sweepId)).toMatchObject({
      status: "completed",
      pages: 2,
      scanned: CASE_STORAGE_RECONCILE_PAGE_SIZE + 1,
      retainedUnsupported: CASE_STORAGE_RECONCILE_PAGE_SIZE + 1,
    });
  });
});
