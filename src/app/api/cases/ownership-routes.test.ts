import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "@/domain/case-graph";
import {
  CASE_OWNER_COOKIE_NAME,
  resolveCaseOwnerSession,
} from "@/server/case-api";

import { GET as readDraft } from "./draft/route";
import { GET as listOwnedCases } from "./owned/route";
import { POST as publishCase } from "./publish/route";

const PUBLIC_ORIGIN = "https://suits.test";
const SESSION_SECRET = "test-session-secret-that-is-longer-than-thirty-two-characters";
const SERVICE_SECRET = "test-convex-service-secret-longer-than-thirty-two-characters";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const UPLOAD_ID = `upload:${"a".repeat(48)}`;
const CASE_ID = `case:${"b".repeat(48)}`;

function configureEnvironment(): void {
  vi.stubEnv("SUITS_PUBLIC_ORIGIN", PUBLIC_ORIGIN);
  vi.stubEnv("SUITS_SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("SUITS_CONVEX_SERVICE_SECRET", SERVICE_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://convex.test");
}

function session() {
  return resolveCaseOwnerSession(undefined, {
    secret: SESSION_SECRET,
    createSessionId: () => SESSION_ID,
  });
}

function authorizedHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Cookie", `${CASE_OWNER_COOKIE_NAME}=${session().cookieValue}`);
  headers.set("Origin", PUBLIC_ORIGIN);
  return headers;
}

function serviceRequest(fetchMock: ReturnType<typeof vi.fn>, index = 0): {
  url: URL;
  headers: Headers;
  body: unknown;
} {
  const [input, init] = fetchMock.mock.calls[index] as [RequestInfo | URL, RequestInit];
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  return {
    url: new URL(rawUrl),
    headers: new Headers(init.headers),
    body: init.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("owner-bound case routes", () => {
  it("rejects cross-origin draft reads before durable service access", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await readDraft(new NextRequest(
      `${PUBLIC_ORIGIN}/api/cases/draft?uploadId=${UPLOAD_ID}`,
      { headers: { Origin: "https://attacker.test" } },
    ));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ORIGIN_REJECTED",
        message: "Cross-origin case reads are not allowed.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a forged owner cookie on the owned-case list", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await listOwnedCases(new NextRequest(`${PUBLIC_ORIGIN}/api/cases/owned`, {
      headers: {
        Cookie: `${CASE_OWNER_COOKIE_NAME}=v1.${SESSION_ID}.forged`,
        Origin: PUBLIC_ORIGIN,
      },
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("derives draft ownership only from the signed cookie", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ found: false }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await readDraft(new NextRequest(
      `${PUBLIC_ORIGIN}/api/cases/draft?uploadId=${UPLOAD_ID}&ownerId=owner%3Aattacker`,
      { headers: authorizedHeaders({ "X-Owner-Id": "owner:attacker" }) },
    ));

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const forwarded = serviceRequest(fetchMock);
    expect(forwarded.url.pathname).toBe("/service/case-draft/lookup");
    expect(forwarded.headers.get("Authorization")).toBe(`Bearer ${SERVICE_SECRET}`);
    expect(forwarded.body).toEqual({
      ownerId: session().ownerId,
      uploadId: UPLOAD_ID,
    });
    expect(JSON.stringify(forwarded.body)).not.toContain("attacker");
  });

  it("derives owned-list scope only from the signed cookie", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ cases: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await listOwnedCases(new NextRequest(
      `${PUBLIC_ORIGIN}/api/cases/owned?ownerId=owner%3Aattacker`,
      { headers: authorizedHeaders({ "X-Owner-Id": "owner:attacker" }) },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ cases: [] });
    const forwarded = serviceRequest(fetchMock);
    expect(forwarded.url.pathname).toBe("/service/cases/owned/list");
    expect(forwarded.body).toEqual({ ownerId: session().ownerId });
  });

  it("rejects publication without a signed owner cookie", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await publishCase(new NextRequest(`${PUBLIC_ORIGIN}/api/cases/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: PUBLIC_ORIGIN,
      },
      body: "{}",
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes only the bounded reviewed graph under the signed owner", async () => {
    configureEnvironment();
    const caseGraph = createThreeWitnessCaseGraphV1Fixture();
    caseGraph.caseId = CASE_ID;
    caseGraph.status = "published";
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      caseId: CASE_ID,
      version: 2,
      published: true,
      replayed: false,
      caseGraph,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await publishCase(new NextRequest(
      `${PUBLIC_ORIGIN}/api/cases/publish?ownerId=owner%3Aattacker`,
      {
        method: "POST",
        headers: authorizedHeaders({
          "Content-Type": "application/json",
          "X-Owner-Id": "owner:attacker",
        }),
        body: JSON.stringify({ uploadId: UPLOAD_ID, caseGraph }),
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const forwarded = serviceRequest(fetchMock);
    expect(forwarded.url.pathname).toBe("/service/case-draft/publish");
    expect(forwarded.body).toEqual({
      ownerId: session().ownerId,
      uploadId: UPLOAD_ID,
      caseGraph,
    });
    expect(JSON.stringify(forwarded.body)).not.toContain("owner:attacker");
  });

  it("rejects an oversized publish body before reading or forwarding it", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await publishCase(new NextRequest(`${PUBLIC_ORIGIN}/api/cases/publish`, {
      method: "POST",
      headers: authorizedHeaders({
        "Content-Length": String(4 * 1024 * 1024 + 1),
        "Content-Type": "application/json",
      }),
      body: "{}",
    }));

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
