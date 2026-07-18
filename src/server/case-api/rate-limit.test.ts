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

  it("hashes only explicitly trusted proxy addresses instead of retaining them", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.7" });
    const environment = { SUITS_TRUSTED_PROXY: "x-real-ip" };
    const first = caseCompilationClientKey(headers, environment);
    const second = caseCompilationClientKey(headers, environment);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toContain("203.0.113.7");
  });

  it("ignores caller-supplied forwarding headers without trusted proxy configuration", () => {
    const direct = caseCompilationClientKey(new Headers(), {});
    expect(caseCompilationClientKey(new Headers({ "x-real-ip": "203.0.113.7" }), {})).toBe(direct);
    expect(caseCompilationClientKey(new Headers({ "x-forwarded-for": "198.51.100.8" }), {})).toBe(direct);
    expect(
      caseCompilationClientKey(
        new Headers({ "x-vercel-forwarded-for": "not-an-ip" }),
        { VERCEL: "1" },
      ),
    ).toBe(direct);
  });
});
