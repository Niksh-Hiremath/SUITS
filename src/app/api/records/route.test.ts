import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CourtRecordsTrialSummarySchema,
  CourtRecordsViewSchema,
} from "@/domain/court-records";
import {
  CASE_OWNER_COOKIE_NAME,
  resolveCaseOwnerSession,
} from "@/server/case-api";

import { GET as downloadCourtRecord } from "./[trialId]/download/route";
import { GET as readCourtRecord } from "./[trialId]/route";
import { GET as listCourtRecords } from "./route";

const PUBLIC_ORIGIN = "https://suits.test";
const SESSION_SECRET =
  "court-records-session-secret-longer-than-thirty-two-characters";
const SERVICE_SECRET =
  "court-records-service-secret-longer-than-thirty-two-characters";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const TRIAL_ID = "trial_223e4567e89b42d3a456426614174000";
const OTHER_TRIAL_ID = "trial_323e4567e89b42d3a456426614174000";
const EVENT_ID = "event:records:start";

const EMPTY_CITATIONS = {
  factIds: [],
  evidenceIds: [],
  testimonyIds: [],
  eventIds: [],
  sourceSegmentIds: [],
} as const;

const SUMMARY = CourtRecordsTrialSummarySchema.parse({
  schemaVersion: "court-records-summary.v1",
  trialId: TRIAL_ID,
  caseId: "case_redwood_signal_v1",
  caseTitle: "Rina Shah v. Redwood Signal Systems",
  phase: "case_in_chief",
  status: "active",
  stateVersion: 1,
  lastSequence: 1,
  lastEventId: EVENT_ID,
  startedAt: "2026-07-20T05:00:00.000Z",
  updatedAt: "2026-07-20T05:00:00.001Z",
  transcriptTurnCount: 0,
  modelCallCount: 0,
  hasFinalDebrief: false,
});

const VIEW = CourtRecordsViewSchema.parse({
  schemaVersion: "court-records-view.v2",
  summary: SUMMARY,
  eventTree: {
    rootEventIds: [EVENT_ID],
    nodes: [
      {
        eventId: EVENT_ID,
        sequence: 1,
        stateVersion: 1,
        type: "START_TRIAL",
        actor: {
          actorId: "actor:system",
          role: "system",
          side: "neutral",
          witnessId: null,
        },
        source: "system",
        occurredAt: "2026-07-20T05:00:00.000Z",
        parentEventId: null,
        childEventIds: [],
        responseId: null,
        interruptId: null,
        citations: EMPTY_CITATIONS,
      },
    ],
  },
  transcript: [],
  procedure: {
    objections: [],
    rulings: [],
    recoveries: [],
    interruptions: [],
  },
  lifecycles: { facts: [], evidence: [] },
  modelCalls: [],
  finalDebrief: null,
  citationResources: [],
  audio: {
    availability: "not_recorded",
    retentionPolicy: "metadata_only_raw_audio_not_stored",
    entries: [],
  },
  replayIntegrity: {
    status: "verified",
    eventCount: 1,
    firstSequence: 1,
    lastSequence: 1,
    stateVersion: 1,
    lastEventId: EVENT_ID,
    privacySafeProjectionHash: "a".repeat(64),
  },
});

function configureEnvironment(): void {
  vi.stubEnv("SUITS_PUBLIC_ORIGIN", PUBLIC_ORIGIN);
  vi.stubEnv("SUITS_SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("SUITS_CONVEX_SERVICE_SECRET", SERVICE_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://convex.test");
}

function sessionCookie(): string {
  return resolveCaseOwnerSession(undefined, {
    secret: SESSION_SECRET,
    createSessionId: () => SESSION_ID,
  }).cookieValue;
}

function authorizedRequest(path: string, headers: HeadersInit = {}): NextRequest {
  return new NextRequest(`${PUBLIC_ORIGIN}${path}`, {
    headers: {
      Cookie: `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`,
      Origin: PUBLIC_ORIGIN,
      ...headers,
    },
  });
}

function expectPrivateHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("set-cookie")).toBeNull();
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("Court Records browser BFF", () => {
  beforeEach(() => {
    configureEnvironment();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("derives owner authority only from the cookie and returns stable downloads", async () => {
    const forwarded: Array<{
      path: string;
      body: unknown;
      authorization: string | null;
      cache: RequestCache | undefined;
      hasSignal: boolean;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        const headers = new Headers(init?.headers);
        forwarded.push({
          path,
          body: JSON.parse(String(init?.body)) as unknown,
          authorization: headers.get("authorization"),
          cache: init?.cache,
          hasSignal: init?.signal !== undefined,
        });
        return Response.json(
          path === "/service/court-records/list" ? [SUMMARY] : VIEW,
        );
      }),
    );

    const listResponse = await listCourtRecords(
      authorizedRequest(
        "/api/records?ownerId=owner:attacker",
        { "X-Owner-Id": "owner:attacker" },
      ),
    );
    const readResponse = await readCourtRecord(
      authorizedRequest(`/api/records/${TRIAL_ID}`, {
        "X-Owner-Id": "owner:attacker",
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const firstDownload = await downloadCourtRecord(
      authorizedRequest(`/api/records/${TRIAL_ID}/download`),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const secondDownload = await downloadCourtRecord(
      authorizedRequest(`/api/records/${TRIAL_ID}/download`),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([SUMMARY]);
    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toEqual(VIEW);
    const firstBytes = Buffer.from(await firstDownload.arrayBuffer());
    const secondBytes = Buffer.from(await secondDownload.arrayBuffer());
    expect(firstBytes.equals(secondBytes)).toBe(true);
    const downloaded = firstBytes.toString("utf8");
    expect(JSON.parse(downloaded)).toEqual(VIEW);
    expect(downloaded).not.toContain("owner:");
    expect(downloaded).not.toContain("exportedAt");
    expect(downloaded).toContain(VIEW.replayIntegrity.privacySafeProjectionHash);
    expect(firstDownload.headers.get("content-disposition")).toBe(
      `attachment; filename="suits-court-record-${TRIAL_ID}.json"`,
    );
    expect(firstDownload.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );

    expect(forwarded).toEqual([
      expect.objectContaining({
        path: "/service/court-records/list",
        body: { ownerId: `owner:${SESSION_ID}` },
      }),
      ...Array.from({ length: 3 }, () =>
        expect.objectContaining({
          path: "/service/court-records/read",
          body: { ownerId: `owner:${SESSION_ID}`, trialId: TRIAL_ID },
        }),
      ),
    ]);
    for (const request of forwarded) {
      expect(request).toMatchObject({
        authorization: `Bearer ${SERVICE_SECRET}`,
        cache: "no-store",
        hasSignal: true,
      });
      expect(JSON.stringify(request.body)).not.toContain("attacker");
    }
    for (const response of [
      listResponse,
      readResponse,
      firstDownload,
      secondDownload,
    ]) {
      expectPrivateHeaders(response);
    }
  });

  it("rejects origin, identifier, and session failures before Convex", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const crossOrigin = await listCourtRecords(
      new NextRequest(`${PUBLIC_ORIGIN}/api/records`, {
        headers: {
          Cookie: `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`,
          Origin: "https://attacker.test",
        },
      }),
    );
    const invalidTrial = await readCourtRecord(
      authorizedRequest("/api/records/trial_legacy"),
      { params: Promise.resolve({ trialId: "trial_legacy" }) },
    );
    const missingSession = await listCourtRecords(
      new NextRequest(`${PUBLIC_ORIGIN}/api/records`, {
        headers: { Origin: PUBLIC_ORIGIN },
      }),
    );
    const tamperedSession = await downloadCourtRecord(
      new NextRequest(`${PUBLIC_ORIGIN}/api/records/${TRIAL_ID}/download`, {
        headers: {
          Cookie: `${CASE_OWNER_COOKIE_NAME}=v1.${SESSION_ID}.tampered`,
          Origin: PUBLIC_ORIGIN,
        },
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    vi.stubEnv("SUITS_SESSION_SECRET", "");
    const unavailableSession = await listCourtRecords(
      new NextRequest(`${PUBLIC_ORIGIN}/api/records`, {
        headers: { Origin: PUBLIC_ORIGIN },
      }),
    );

    expect(crossOrigin.status).toBe(403);
    expect(await errorCode(crossOrigin)).toBe("ORIGIN_REJECTED");
    expect(invalidTrial.status).toBe(400);
    expect(await errorCode(invalidTrial)).toBe(
      "COURT_RECORD_TRIAL_ID_INVALID",
    );
    expect(missingSession.status).toBe(401);
    expect(await errorCode(missingSession)).toBe(
      "COURT_RECORD_SESSION_REQUIRED",
    );
    expect(tamperedSession.status).toBe(401);
    expect(await errorCode(tamperedSession)).toBe(
      "COURT_RECORD_SESSION_REQUIRED",
    );
    expect(unavailableSession.status).toBe(503);
    expect(await errorCode(unavailableSession)).toBe(
      "COURT_RECORD_SESSION_UNAVAILABLE",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    for (const response of [
      crossOrigin,
      invalidTrial,
      missingSession,
      tamperedSession,
      unavailableSession,
    ]) {
      expectPrivateHeaders(response);
    }
  });

  it("returns caller cancellation without logging a service failure", async () => {
    const callerController = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      callerController.abort(
        new DOMException("browser request cancelled", "AbortError"),
      );
      throw init?.signal?.reason ?? new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(`${PUBLIC_ORIGIN}/api/records`, {
      headers: {
        Cookie: `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`,
        Origin: PUBLIC_ORIGIN,
      },
      signal: callerController.signal,
    });

    const response = await listCourtRecords(request);

    expect(response.status).toBe(499);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "COURT_RECORD_REQUEST_CANCELLED",
        message: "The Court Records request was cancelled.",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expectPrivateHeaders(response);
  });

  it("allowlists public errors and collapses every other failure", async () => {
    const responses: Array<Response | Error> = [
      Response.json({ error: "TRIAL_NOT_FOUND" }, { status: 404 }),
      Response.json({ error: "TRIAL_NOT_FOUND" }, { status: 404 }),
      Response.json(
        { error: "TRIAL_MIGRATION_REQUIRED" },
        { status: 409 },
      ),
      Response.json({ error: "TRIAL_NOT_FOUND" }, { status: 404 }),
      Response.json({ unexpected: true }),
      Response.json({
        ...VIEW,
        summary: { ...SUMMARY, trialId: OTHER_TRIAL_ID },
      }),
      new Error("network unavailable"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        const response = responses.shift();
        if (response instanceof Error) throw response;
        if (response === undefined) throw new Error("Missing response fixture");
        return response;
      }),
    );

    const missing = await readCourtRecord(
      authorizedRequest(`/api/records/${TRIAL_ID}`),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const foreign = await downloadCourtRecord(
      authorizedRequest(`/api/records/${TRIAL_ID}/download`),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const migration = await listCourtRecords(
      authorizedRequest("/api/records"),
    );
    const listNotFound = await listCourtRecords(
      authorizedRequest("/api/records"),
    );
    const malformed = await readCourtRecord(
      authorizedRequest(`/api/records/${TRIAL_ID}`),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const mismatched = await readCourtRecord(
      authorizedRequest(`/api/records/${TRIAL_ID}`),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const unavailable = await listCourtRecords(
      authorizedRequest("/api/records"),
    );

    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe("COURT_RECORD_NOT_FOUND");
    expect(foreign.status).toBe(404);
    expect(await errorCode(foreign)).toBe("COURT_RECORD_NOT_FOUND");
    expect(migration.status).toBe(409);
    expect(await errorCode(migration)).toBe(
      "COURT_RECORD_MIGRATION_REQUIRED",
    );
    for (const response of [
      listNotFound,
      malformed,
      mismatched,
      unavailable,
    ]) {
      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe("COURT_RECORD_UNAVAILABLE");
    }
    for (const response of [
      missing,
      foreign,
      migration,
      listNotFound,
      malformed,
      mismatched,
      unavailable,
    ]) {
      expectPrivateHeaders(response);
    }
  });
});
