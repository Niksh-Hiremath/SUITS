import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CASE_OWNER_COOKIE_NAME,
  resolveCaseOwnerSession,
} from "@/server/case-api";

const SESSION_SECRET =
  "test-preflight-session-secret-that-is-longer-than-thirty-two-characters";

const mocks = vi.hoisted(() => ({
  acquireDurablePreflightPermit: vi.fn(async () => ({
    schemaVersion: "suits.durable-preflight-permit.v1" as const,
    allowed: true,
    retryAfterSeconds: 0,
  })),
  checkDurableService: vi.fn(async (signal: AbortSignal) => {
    void signal;
  }),
  createResponse: vi.fn(async (body: unknown, options?: unknown) => {
    void body;
    void options;
    return { id: "resp_preflight_test" };
  }),
}));

vi.mock("@/server/preflight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/preflight")>();
  return {
    ...actual,
    acquireDurablePreflightPermit: mocks.acquireDurablePreflightPermit,
    checkDurableService: mocks.checkDurableService,
    runServerPreflight: (dependencies: {
      checkConvex: (signal: AbortSignal) => Promise<void>;
      checkOpenAIModel: (model: string, signal: AbortSignal) => Promise<void>;
      signal?: AbortSignal;
    }) => {
      return actual.runServerPreflight({
        checkConvex: dependencies.checkConvex,
        checkOpenAIModel: dependencies.checkOpenAIModel,
        signal: dependencies.signal,
        now: () => 10,
        checkedAt: () => "2026-07-19T12:00:00.000Z",
      });
    },
  };
});

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    readonly responses = { create: mocks.createResponse };
  },
}));

function request(body: unknown, origin = "http://localhost:3000"): NextRequest {
  return new NextRequest("http://localhost:3000/api/preflight", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/preflight", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SUITS_SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("OPENAI_API_KEY", "server-only-test-key");
    mocks.checkDurableService.mockClear();
    mocks.acquireDurablePreflightPermit.mockReset();
    mocks.acquireDurablePreflightPermit.mockResolvedValue({
      schemaVersion: "suits.durable-preflight-permit.v1",
      allowed: true,
      retryAfterSeconds: 0,
    });
    mocks.createResponse.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns safe server readiness and refreshes the HTTP-only owner cookie", async () => {
    const session = resolveCaseOwnerSession(undefined, {
      secret: SESSION_SECRET,
      createSessionId: () => "123e4567-e89b-42d3-a456-426614174000",
    });
    const input = request({});
    input.headers.set(
      "Cookie",
      `${CASE_OWNER_COOKIE_NAME}=${session.cookieValue}`,
    );
    const { POST } = await import("./route");
    const response = await POST(input);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get(CASE_OWNER_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
    });
    expect(body).toMatchObject({
      schemaVersion: "suits.server-preflight.v1",
      overallStatus: "ready",
      convex: { status: "ready" },
      openai: { status: "ready" },
    });
    expect(mocks.checkDurableService).toHaveBeenCalledTimes(1);
    expect(mocks.acquireDurablePreflightPermit).toHaveBeenCalledTimes(1);
    expect(
      mocks.createResponse.mock.calls.map(([body]) =>
        (body as { model: string }).model,
      ),
    ).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-terra",
    ]);
    expect(mocks.createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        store: false,
        max_output_tokens: 32,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects cross-origin and non-empty requests before external checks", async () => {
    const { POST } = await import("./route");
    const crossOrigin = await POST(request({}, "https://attacker.test"));
    const invalid = await POST(request({ probe: true }));

    expect(crossOrigin.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(mocks.checkDurableService).not.toHaveBeenCalled();
    expect(mocks.createResponse).not.toHaveBeenCalled();
  });

  it("fails closed before billable probes when the durable quota is exhausted", async () => {
    mocks.acquireDurablePreflightPermit.mockResolvedValueOnce({
      schemaVersion: "suits.durable-preflight-permit.v1",
      allowed: false,
      retryAfterSeconds: 120,
    });
    const { serverPreflightCache } = await import("@/server/preflight");
    serverPreflightCache.clear();
    const { POST } = await import("./route");
    const response = await POST(request({}));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PREFLIGHT_RATE_LIMITED",
        message: "The live model checks were run recently. Please retry later.",
      },
    });
    expect(mocks.createResponse).not.toHaveBeenCalled();
  });
});
