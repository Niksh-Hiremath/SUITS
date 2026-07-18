import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "./schema";
import type {
  AcquireCaseCompileClaimRequest,
  AcquireCaseCompileClaimResponse,
  ReleaseCaseCompileClaimRequest,
} from "./caseCompileClaims";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./caseCompileClaims.ts": () => import("./caseCompileClaims"),
};

const acquireReference = makeFunctionReference<
  "mutation",
  AcquireCaseCompileClaimRequest,
  AcquireCaseCompileClaimResponse
>("caseCompileClaims:acquire");

const releaseReference = makeFunctionReference<
  "mutation",
  ReleaseCaseCompileClaimRequest,
  Readonly<{
    claimId: string;
    generation: number;
    status: "retryable_failed" | "terminal_failed";
    replayed: boolean;
  }>
>("caseCompileClaims:release");

const IDENTITY = {
  ownerId: "owner:123e4567-e89b-42d3-a456-426614174000",
  uploadId: "upload:quota-generation-test",
  caseId: "case:quota-generation-test",
  contentDigest: "a".repeat(64),
  clientKeyHash: "b".repeat(64),
} as const;

const CLAIM_IDENTITY = {
  ownerId: IDENTITY.ownerId,
  uploadId: IDENTITY.uploadId,
  caseId: IDENTITY.caseId,
  contentDigest: IDENTITY.contentDigest,
} as const;

function leaseToken(index: number): string {
  return index.toString(16).padStart(64, "0");
}

describe("case compile claim generation quota", () => {
  it("charges each billable generation while busy competitors remain free", async () => {
    const backend = convexTest({ schema, modules });
    let acquired = await backend.mutation(acquireReference, {
      ...IDENTITY,
      leaseToken: leaseToken(1),
    });
    expect(acquired).toMatchObject({
      outcome: "acquired",
      acquisition: "new",
      generation: 1,
    });
    if (acquired.outcome !== "acquired") throw new Error("TEST_EXPECTED_ACQUIRED_CLAIM");

    const busy = await backend.mutation(acquireReference, {
      ...IDENTITY,
      leaseToken: leaseToken(99),
    });
    expect(busy).toMatchObject({ outcome: "busy" });
    expect(await backend.run(async (ctx) => {
      const quota = await ctx.db
        .query("caseCompileQuotas")
        .withIndex("by_client_key_hash", (index) =>
          index.eq("clientKeyHash", IDENTITY.clientKeyHash))
        .unique();
      return quota?.attemptedAt.length;
    })).toBe(1);

    for (let generation = 1; generation <= 4; generation += 1) {
      await backend.mutation(releaseReference, {
        ...CLAIM_IDENTITY,
        claimId: acquired.claimId,
        generation: acquired.generation,
        leaseToken: acquired.leaseToken,
        disposition: "retryable_failed",
        failureCode: "TEST_RETRY",
      });
      const next = await backend.mutation(acquireReference, {
        ...IDENTITY,
        leaseToken: leaseToken(generation + 1),
      });
      expect(next).toMatchObject({
        outcome: "acquired",
        acquisition: "retry",
        generation: generation + 1,
      });
      if (next.outcome !== "acquired") throw new Error("TEST_EXPECTED_RETRY_CLAIM");
      acquired = next;
    }

    await backend.mutation(releaseReference, {
      ...CLAIM_IDENTITY,
      claimId: acquired.claimId,
      generation: acquired.generation,
      leaseToken: acquired.leaseToken,
      disposition: "retryable_failed",
      failureCode: "TEST_RETRY",
    });
    const denied = await backend.mutation(acquireReference, {
      ...IDENTITY,
      leaseToken: leaseToken(6),
    });
    expect(denied).toMatchObject({ outcome: "quota_exceeded" });

    const persisted = await backend.run(async (ctx) => {
      const [claim, quota] = await Promise.all([
        ctx.db.query("caseCompileClaims").withIndex("by_upload_id", (index) =>
          index.eq("uploadId", IDENTITY.uploadId)).unique(),
        ctx.db.query("caseCompileQuotas").withIndex("by_client_key_hash", (index) =>
          index.eq("clientKeyHash", IDENTITY.clientKeyHash)).unique(),
      ]);
      return {
        claimStatus: claim?.status,
        claimGeneration: claim?.generation,
        chargedAttempts: quota?.attemptedAt.length,
      };
    });
    expect(persisted).toEqual({
      claimStatus: "retryable_failed",
      claimGeneration: 5,
      chargedAttempts: 5,
    });
  });
});
