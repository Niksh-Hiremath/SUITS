import { describe, expect, it } from "vitest";

import {
  CASE_COMPILE_QUOTA_MAX_ATTEMPTS,
  CASE_COMPILE_QUOTA_RETENTION_MS,
  CASE_COMPILE_QUOTA_WINDOW_MS,
  CaseCompilePermitRequestSchema,
  CaseCompilePermitResponseSchema,
  caseCompileQuotaPruneCutoff,
  evaluateCaseCompilePermit,
  type CaseCompileQuotaState,
} from "./caseCompileQuota";

const CLIENT_KEY_HASH = "a".repeat(64);

describe("case compile permit boundary", () => {
  it("accepts only a lowercase SHA-256 client key and rejects unknown identifying data", () => {
    expect(CaseCompilePermitRequestSchema.parse({ clientKeyHash: CLIENT_KEY_HASH })).toEqual({
      clientKeyHash: CLIENT_KEY_HASH,
    });
    expect(() =>
      CaseCompilePermitRequestSchema.parse({
        clientKeyHash: CLIENT_KEY_HASH,
        clientIp: "203.0.113.7",
      }),
    ).toThrow();
    expect(() =>
      CaseCompilePermitRequestSchema.parse({ clientKeyHash: CLIENT_KEY_HASH.toUpperCase() }),
    ).toThrow();
    expect(() => CaseCompilePermitRequestSchema.parse({ clientKeyHash: "short" })).toThrow();
  });

  it("keeps the service response exact and bounded", () => {
    expect(CaseCompilePermitResponseSchema.parse({ allowed: true, retryAfterSeconds: 0 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(() =>
      CaseCompilePermitResponseSchema.parse({
        allowed: false,
        retryAfterSeconds: 601,
      }),
    ).toThrow();
    expect(() =>
      CaseCompilePermitResponseSchema.parse({
        allowed: false,
        retryAfterSeconds: 1,
        remaining: 0,
      }),
    ).toThrow();
  });
});

describe("case compile rolling quota", () => {
  it("allows five attempts, denies the sixth, and never grows stored attempt state", () => {
    let state: CaseCompileQuotaState | null = null;
    for (let attempt = 0; attempt < CASE_COMPILE_QUOTA_MAX_ATTEMPTS; attempt += 1) {
      const transition = evaluateCaseCompilePermit(state, attempt * 1_000);
      expect(transition.response).toEqual({ allowed: true, retryAfterSeconds: 0 });
      expect(transition.attemptedAt).toHaveLength(attempt + 1);
      state = { attemptedAt: transition.attemptedAt };
    }

    const denied = evaluateCaseCompilePermit(state, 5_000);
    expect(denied.response).toEqual({ allowed: false, retryAfterSeconds: 595 });
    expect(denied.attemptedAt).toHaveLength(CASE_COMPILE_QUOTA_MAX_ATTEMPTS);
  });

  it("admits a new attempt when the oldest attempt leaves the rolling window", () => {
    const state = { attemptedAt: [0, 1_000, 2_000, 3_000, 4_000] };
    const transition = evaluateCaseCompilePermit(state, CASE_COMPILE_QUOTA_WINDOW_MS);

    expect(transition.response).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(transition.attemptedAt).toEqual([
      1_000,
      2_000,
      3_000,
      4_000,
      CASE_COMPILE_QUOTA_WINDOW_MS,
    ]);
  });

  it("rejects invalid time/state and computes a nonnegative stale cutoff", () => {
    expect(() => evaluateCaseCompilePermit(null, -1)).toThrow("nonnegative safe integer");
    expect(() =>
      evaluateCaseCompilePermit(
        { attemptedAt: Array.from({ length: CASE_COMPILE_QUOTA_MAX_ATTEMPTS + 1 }, () => 0) },
        0,
      ),
    ).toThrow();
    expect(caseCompileQuotaPruneCutoff(CASE_COMPILE_QUOTA_RETENTION_MS - 1)).toBe(0);
    expect(caseCompileQuotaPruneCutoff(CASE_COMPILE_QUOTA_RETENTION_MS + 123)).toBe(123);
  });
});
