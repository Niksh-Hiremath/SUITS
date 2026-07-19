import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import schema from "./schema";

const SERVICE_SECRET =
  "preflight-http-test-service-secret-longer-than-thirty-two-characters";
const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./caseCompileQuota.ts": () => import("./caseCompileQuota"),
  "./http.ts": () => import("./http"),
};

function authorizedRequest(body: unknown = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

describe("Convex preflight HTTP service", () => {
  beforeEach(() => {
    vi.stubEnv("SUITS_CONVEX_SERVICE_SECRET", SERVICE_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves a secret-protected, strict, no-store health response", async () => {
    const backend = convexTest({ schema, modules });
    const accepted = await backend.fetch(
      "/service/health",
      authorizedRequest(),
    );

    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(accepted.json()).resolves.toEqual({
      schemaVersion: "suits.durable-service.health.v1",
      status: "ready",
    });

    const unauthorized = await backend.fetch("/service/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: "CASE_SERVICE_UNAUTHORIZED",
    });

    const malformed = await backend.fetch(
      "/service/health",
      authorizedRequest({ unexpected: true }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "CASE_SERVICE_REQUEST_INVALID",
    });
  });

  it("durably caps live preflight permits across server instances", async () => {
    const backend = convexTest({ schema, modules });
    const decisions = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await backend.fetch(
        "/service/preflight-permit/acquire",
        authorizedRequest(),
      );
      expect(response.status).toBe(200);
      decisions.push(await response.json());
    }

    expect(decisions.slice(0, 5)).toEqual(
      Array.from({ length: 5 }, () => ({
        schemaVersion: "suits.durable-preflight-permit.v1",
        allowed: true,
        retryAfterSeconds: 0,
      })),
    );
    expect(decisions[5]).toMatchObject({
      schemaVersion: "suits.durable-preflight-permit.v1",
      allowed: false,
    });
    expect(decisions[5]?.retryAfterSeconds).toBeGreaterThan(0);
  });
});
