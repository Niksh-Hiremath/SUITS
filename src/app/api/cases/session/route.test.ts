import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CASE_OWNER_COOKIE_NAME, verifyCaseOwnerSession } from "../../../../server/case-api";

import { POST } from "./route";

const SESSION_SECRET = "test-only-session-secret-that-is-long-enough";

describe("case owner session route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("issues a signed HTTP-only owner cookie", async () => {
    vi.stubEnv("SUITS_SESSION_SECRET", SESSION_SECRET);
    const response = await POST(
      new NextRequest("https://suits.test/api/cases/session", {
        method: "POST",
        headers: { origin: "https://suits.test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ready: true });
    const cookie = response.cookies.get(CASE_OWNER_COOKIE_NAME);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("strict");
    expect(verifyCaseOwnerSession(cookie?.value, SESSION_SECRET)).not.toBeNull();
  });

  it("rejects cross-origin session minting", async () => {
    vi.stubEnv("SUITS_SESSION_SECRET", SESSION_SECRET);
    const response = await POST(
      new NextRequest("https://suits.test/api/cases/session", {
        method: "POST",
        headers: { origin: "https://attacker.test" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.cookies.get(CASE_OWNER_COOKIE_NAME)).toBeUndefined();
  });
});
