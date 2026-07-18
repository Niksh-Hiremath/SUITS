import { describe, expect, it } from "vitest";

import {
  caseCompilationClientKey,
} from "./rate-limit";

describe("case compilation rate limit", () => {
  const secret = "test-client-key-secret-longer-than-thirty-two-characters";

  it("HMACs only explicitly trusted proxy addresses instead of retaining them", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.7" });
    const environment = { SUITS_TRUSTED_PROXY: "x-real-ip", SUITS_SESSION_SECRET: secret };
    const first = caseCompilationClientKey(headers, environment);
    const second = caseCompilationClientKey(headers, environment);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toContain("203.0.113.7");
    expect(caseCompilationClientKey(headers, {
      ...environment,
      SUITS_SESSION_SECRET: `${secret}-different`,
    })).not.toBe(first);
  });

  it("ignores caller-supplied forwarding headers without trusted proxy configuration", () => {
    const environment = { SUITS_SESSION_SECRET: secret };
    const direct = caseCompilationClientKey(new Headers(), environment);
    expect(caseCompilationClientKey(new Headers({ "x-real-ip": "203.0.113.7" }), environment)).toBe(direct);
    expect(caseCompilationClientKey(new Headers({ "x-forwarded-for": "198.51.100.8" }), environment)).toBe(direct);
    expect(
      caseCompilationClientKey(
        new Headers({ "x-vercel-forwarded-for": "not-an-ip" }),
        { ...environment, VERCEL: "1" },
      ),
    ).toBe(direct);
  });

  it("fails closed without a server-side HMAC secret", () => {
    expect(() => caseCompilationClientKey(new Headers(), {})).toThrow("SUITS_SESSION_SECRET");
  });
});
