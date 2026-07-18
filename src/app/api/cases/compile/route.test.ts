import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CASE_OWNER_COOKIE_NAME,
  resolveCaseOwnerSession,
} from "@/server/case-api";

import { POST } from "./route";

const PUBLIC_ORIGIN = "https://suits.test";
const SESSION_SECRET = "test-session-secret-that-is-longer-than-thirty-two-characters";
const SERVICE_SECRET = "test-convex-service-secret-longer-than-thirty-two-characters";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";

function caseRequest(includeRequestId: boolean): NextRequest {
  const session = resolveCaseOwnerSession(undefined, {
    secret: SESSION_SECRET,
    createSessionId: () => SESSION_ID,
  });
  const form = new FormData();
  if (includeRequestId) form.set("requestId", REQUEST_ID);
  form.set(
    "packet",
    new File(["A fictional educational dispute packet."], "packet.txt", {
      type: "text/plain",
    }),
  );
  return new NextRequest(`${PUBLIC_ORIGIN}/api/cases/compile`, {
    method: "POST",
    headers: {
      Cookie: `${CASE_OWNER_COOKIE_NAME}=${session.cookieValue}`,
      Origin: PUBLIC_ORIGIN,
    },
    body: form,
  });
}

function configureEnvironment(): void {
  vi.stubEnv("SUITS_PUBLIC_ORIGIN", PUBLIC_ORIGIN);
  vi.stubEnv("SUITS_SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("SUITS_CONVEX_SERVICE_SECRET", SERVICE_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://convex.test");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("case compile route coordination", () => {
  it("rejects a malformed multipart request before calling durable quota or claim services", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(caseRequest(false));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CASE_COMPILE_REQUEST_ID_REQUIRED",
        message: "A retry-safe compilation request ID is required.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a competing live claim as busy without invoking a legacy permit or compiler", async () => {
    configureEnvironment();
    const requestedPaths: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const rawUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const url = new URL(rawUrl);
      requestedPaths.push(url.pathname);
      if (url.pathname === "/service/case-draft/lookup") {
        return Response.json({ found: false });
      }
      if (url.pathname === "/service/case-compile-claim/acquire") {
        return Response.json({
          outcome: "busy",
          claimId: `claim:${"a".repeat(64)}`,
          retryAfterSeconds: 42,
        });
      }
      throw new Error(`Unexpected request to ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(caseRequest(true));

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("42");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CASE_COMPILATION_IN_PROGRESS",
        message: "This packet is already being compiled. Wait a moment and retry.",
      },
    });
    expect(requestedPaths).toEqual([
      "/service/case-draft/lookup",
      "/service/case-compile-claim/acquire",
    ]);
    expect(requestedPaths).not.toContain("/service/case-compile-permit");
  });
});
