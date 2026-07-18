import { describe, expect, it } from "vitest";

import {
  AcquireCaseCompileClaimRequestSchema,
  CASE_COMPILE_CLAIM_HEARTBEAT_INTERVAL_MS,
  CASE_COMPILE_CLAIM_LEASE_TTL_MS,
  CaseCompileClaimStateSchema,
  CompleteCaseCompileClaimRequestSchema,
  HeartbeatCaseCompileClaimRequestSchema,
  ReleaseCaseCompileClaimRequestSchema,
  deriveCaseCompileClaimId,
  evaluateCaseCompileClaim,
  evaluateCaseCompileCompletion,
  evaluateCaseCompileHeartbeat,
  evaluateCaseCompileRelease,
  type AcquireCaseCompileClaimRequest,
  type CaseCompileClaimState,
} from "./caseCompileClaims";

const OWNER_ID = "owner:11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "upload:claim-test";
const CASE_ID = "case:claim-test";
const CONTENT_DIGEST = "a".repeat(64);
const CLIENT_KEY_HASH = "b".repeat(64);
const LEASE_A = "c".repeat(64);
const LEASE_B = "d".repeat(64);

function request(
  overrides: Partial<AcquireCaseCompileClaimRequest> = {},
): AcquireCaseCompileClaimRequest {
  return AcquireCaseCompileClaimRequestSchema.parse({
    ownerId: OWNER_ID,
    uploadId: UPLOAD_ID,
    caseId: CASE_ID,
    contentDigest: CONTENT_DIGEST,
    clientKeyHash: CLIENT_KEY_HASH,
    leaseToken: LEASE_A,
    ...overrides,
  });
}

async function newClaim(now = 1_000): Promise<CaseCompileClaimState> {
  return (await evaluateCaseCompileClaim(null, request(), now)).claim;
}

async function fence(claim: CaseCompileClaimState, leaseToken = claim.leaseToken ?? LEASE_A) {
  return HeartbeatCaseCompileClaimRequestSchema.parse({
    ownerId: claim.ownerId,
    uploadId: claim.uploadId,
    caseId: claim.caseId,
    contentDigest: claim.contentDigest,
    claimId: claim.claimId,
    generation: claim.generation,
    leaseToken,
  });
}

describe("case compile claim boundary", () => {
  it("derives a stable tuple-bound claim ID", async () => {
    const first = await deriveCaseCompileClaimId(request());
    const second = await deriveCaseCompileClaimId({
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
      caseId: CASE_ID,
      contentDigest: CONTENT_DIGEST,
    });
    const changed = await deriveCaseCompileClaimId({
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
      caseId: CASE_ID,
      contentDigest: "e".repeat(64),
    });

    expect(first).toMatch(/^claim:[a-f0-9]{64}$/u);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("keeps acquire and fence payloads strict", async () => {
    expect(() => AcquireCaseCompileClaimRequestSchema.parse({ ...request(), rawIp: "203.0.113.9" }))
      .toThrow();
    expect(() => AcquireCaseCompileClaimRequestSchema.parse({ ...request(), leaseToken: "short" }))
      .toThrow();

    const claim = await newClaim();
    const validFence = await fence(claim);
    expect(CompleteCaseCompileClaimRequestSchema.parse(validFence)).toEqual(validFence);
    expect(() => HeartbeatCaseCompileClaimRequestSchema.parse({ ...validFence, generation: -1 }))
      .toThrow();
    expect(() => ReleaseCaseCompileClaimRequestSchema.parse({
      ...validFence,
      disposition: "retryable_failed",
      failureCode: "contains-details",
    })).toThrow();
  });
});

describe("case compile claim acquisition", () => {
  it("charges quota only for a genuinely new claim and replays the same live lease", async () => {
    const created = await evaluateCaseCompileClaim(null, request(), 10_000);
    expect(created.quotaRequired).toBe(true);
    expect(created.persistence).toBe("insert");
    expect(created.response).toEqual({
      outcome: "acquired",
      acquisition: "new",
      claimId: created.claim.claimId,
      generation: 1,
      leaseToken: LEASE_A,
      leaseExpiresAt: 10_000 + CASE_COMPILE_CLAIM_LEASE_TTL_MS,
      heartbeatIntervalMs: CASE_COMPILE_CLAIM_HEARTBEAT_INTERVAL_MS,
    });

    const replay = await evaluateCaseCompileClaim(created.claim, request(), 11_000);
    expect(replay.quotaRequired).toBe(false);
    expect(replay.persistence).toBe("none");
    expect(replay.claim).toEqual(created.claim);
    expect(replay.response).toMatchObject({ outcome: "acquired", acquisition: "idempotent" });
  });

  it("reports a competing live lease as busy without mutating or charging quota", async () => {
    const claim = await newClaim(20_000);
    const transition = await evaluateCaseCompileClaim(
      claim,
      request({ leaseToken: LEASE_B }),
      35_100,
    );

    expect(transition.quotaRequired).toBe(false);
    expect(transition.persistence).toBe("none");
    expect(transition.claim).toEqual(claim);
    expect(transition.response).toEqual({
      outcome: "busy",
      claimId: claim.claimId,
      retryAfterSeconds: 45,
    });
  });

  it("fences an expired worker by incrementing the generation on takeover", async () => {
    const claim = await newClaim(30_000);
    const transition = await evaluateCaseCompileClaim(
      claim,
      request({ leaseToken: LEASE_B }),
      30_000 + CASE_COMPILE_CLAIM_LEASE_TTL_MS,
    );

    expect(transition.quotaRequired).toBe(true);
    expect(transition.persistence).toBe("patch");
    expect(transition.claim.generation).toBe(2);
    expect(transition.claim.leaseToken).toBe(LEASE_B);
    expect(transition.claim.quotaConsumedAt).toBe(30_000 + CASE_COMPILE_CLAIM_LEASE_TTL_MS);
    expect(transition.response).toMatchObject({ outcome: "acquired", acquisition: "takeover" });
  });

  it("uses one generic conflict for tuple tampering", async () => {
    const claim = await newClaim();
    const mismatches: AcquireCaseCompileClaimRequest[] = [
      request({ ownerId: "owner:22222222-2222-4222-8222-222222222222" }),
      request({ caseId: "case:other" }),
      request({ contentDigest: "e".repeat(64) }),
    ];

    for (const mismatch of mismatches) {
      await expect(evaluateCaseCompileClaim(claim, mismatch, 2_000))
        .rejects.toThrow("CASE_COMPILE_CLAIM_CONFLICT");
    }
  });
});

describe("case compile claim fencing", () => {
  it("renews only the exact live generation and token", async () => {
    const claim = await newClaim(40_000);
    const validFence = await fence(claim);
    const heartbeat = await evaluateCaseCompileHeartbeat(claim, validFence, 50_000);
    expect(heartbeat.persistence).toBe("patch");
    expect(heartbeat.response).toEqual({
      claimId: claim.claimId,
      generation: 1,
      leaseExpiresAt: 50_000 + CASE_COMPILE_CLAIM_LEASE_TTL_MS,
      heartbeatIntervalMs: CASE_COMPILE_CLAIM_HEARTBEAT_INTERVAL_MS,
    });

    await expect(evaluateCaseCompileHeartbeat(
      claim,
      { ...validFence, generation: 2 },
      50_000,
    )).rejects.toThrow("CASE_COMPILE_CLAIM_FENCE");
    await expect(evaluateCaseCompileHeartbeat(
      claim,
      { ...validFence, leaseToken: LEASE_B },
      50_000,
    )).rejects.toThrow("CASE_COMPILE_CLAIM_FENCE");
    await expect(evaluateCaseCompileHeartbeat(
      claim,
      validFence,
      40_000 + CASE_COMPILE_CLAIM_LEASE_TTL_MS,
    )).rejects.toThrow("CASE_COMPILE_CLAIM_FENCE");
  });

  it("releases retryable work idempotently and reacquires it with a new generation", async () => {
    const claim = await newClaim(60_000);
    const releaseRequest = ReleaseCaseCompileClaimRequestSchema.parse({
      ...await fence(claim),
      disposition: "retryable_failed",
      failureCode: "OPENAI_TIMEOUT",
    });
    const released = await evaluateCaseCompileRelease(claim, releaseRequest, 65_000);
    expect(released.response).toMatchObject({ status: "retryable_failed", replayed: false });
    expect(released.claim.leaseExpiresAt).toBeNull();

    const duplicate = await evaluateCaseCompileRelease(released.claim, releaseRequest, 66_000);
    expect(duplicate.persistence).toBe("none");
    expect(duplicate.response.replayed).toBe(true);

    const reacquired = await evaluateCaseCompileClaim(
      released.claim,
      request({ leaseToken: LEASE_B }),
      70_000,
    );
    expect(reacquired.quotaRequired).toBe(true);
    expect(reacquired.claim.generation).toBe(2);
    expect(reacquired.claim.quotaConsumedAt).toBe(70_000);
    expect(reacquired.response).toMatchObject({ outcome: "acquired", acquisition: "retry" });
  });

  it("makes a terminal release final", async () => {
    const claim = await newClaim(80_000);
    const released = await evaluateCaseCompileRelease(claim, {
      ...await fence(claim),
      disposition: "terminal_failed",
      failureCode: "UNSUPPORTED_PACKET",
    }, 81_000);
    const reacquire = await evaluateCaseCompileClaim(
      released.claim,
      request({ leaseToken: LEASE_B }),
      82_000,
    );

    expect(reacquire.quotaRequired).toBe(false);
    expect(reacquire.persistence).toBe("none");
    expect(reacquire.response).toMatchObject({ outcome: "terminal_failed", generation: 1 });
  });

  it("completes only the exact live lease and makes completion idempotent", async () => {
    const claim = await newClaim(100_000);
    const completeRequest = CompleteCaseCompileClaimRequestSchema.parse(await fence(claim));
    const completed = await evaluateCaseCompileCompletion(claim, completeRequest, 105_000);
    expect(completed.claim.status).toBe("completed");
    expect(completed.claim.completedAt).toBe(105_000);
    expect(completed.response).toEqual({
      outcome: "completed",
      claimId: claim.claimId,
      uploadId: UPLOAD_ID,
      caseId: CASE_ID,
      generation: 1,
    });

    const duplicate = await evaluateCaseCompileCompletion(
      completed.claim,
      completeRequest,
      106_000,
    );
    expect(duplicate.persistence).toBe("none");
    expect(duplicate.claim).toEqual(completed.claim);

    const fresh = await newClaim(120_000);
    await expect(evaluateCaseCompileCompletion(
      fresh,
      { ...await fence(fresh), leaseToken: LEASE_B },
      121_000,
    )).rejects.toThrow("CASE_COMPILE_CLAIM_FENCE");
  });

  it("rejects internally inconsistent stored claim state", async () => {
    const claim = await newClaim();
    expect(() => CaseCompileClaimStateSchema.parse({ ...claim, status: "completed" })).toThrow();
  });
});
