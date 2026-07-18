import { describe, expect, it } from "vitest";

import {
  CaseCompileRateLimiter,
  caseCompilationClientKey,
} from "./rate-limit";

describe("case compilation rate limit", () => {
  it("bounds expensive compilation attempts and resets after the window", () => {
    const limiter = new CaseCompileRateLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.check("client-a", attempt).allowed).toBe(true);
    }
    expect(limiter.check("client-a", 5)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 600,
    });
    expect(limiter.check("client-b", 5).allowed).toBe(true);
    expect(limiter.check("client-a", 600_001).allowed).toBe(true);
  });

  it("hashes the trusted proxy address instead of retaining it", () => {
    const first = caseCompilationClientKey(new Headers({ "x-real-ip": "203.0.113.7" }));
    const second = caseCompilationClientKey(new Headers({ "x-real-ip": "203.0.113.7" }));
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toContain("203.0.113.7");
  });
});
