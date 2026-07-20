import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHearingAudioAuditPreparer,
  type HearingAudioAuditRecord,
} from "@/lib/speech/hearing-audio-audit";
import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
} from "@/lib/speech/hearing-performance";
import {
  CASE_OWNER_COOKIE_NAME,
  resolveCaseOwnerSession,
} from "@/server/case-api";

import { POST } from "./route";

const PUBLIC_ORIGIN = "https://suits.test";
const SESSION_SECRET =
  "audio-audit-session-secret-longer-than-thirty-two-characters";
const SERVICE_SECRET =
  "audio-audit-service-secret-longer-than-thirty-two-characters";
const SESSION_ID = "423e4567-e89b-42d3-a456-426614174000";
const TRIAL_ID = "trial_523e4567e89b42d3a456426614174000";

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

function audioRecord(): HearingAudioAuditRecord {
  let nowEpochMs = 2_000;
  const preparer = createHearingAudioAuditPreparer({
    clock: { nowEpochMs: () => nowEpochMs },
  });
  preparer.consume(
    freezeHearingPerformanceEvent({
      schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
      type: "user_speech_started",
      generation: 2,
      utteranceId: "utterance:audio-audit:bff",
      sceneActor: "user_counsel",
      mode: "question",
      observedAtMs: 20,
      timestampSource: "speech_service",
    }),
  );
  nowEpochMs = 2_150;
  preparer.consume(
    freezeHearingPerformanceEvent({
      schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
      type: "user_speech_ended",
      generation: 2,
      utteranceId: "utterance:audio-audit:bff",
      sceneActor: "user_counsel",
      mode: "question",
      observedAtMs: 170,
      timestampSource: "speech_service",
      reason: "vad_end",
    }),
  );
  const record = preparer.flush()[0];
  if (record === undefined) throw new Error("Missing audio audit fixture");
  return record;
}

function request(
  body: unknown,
  options: Readonly<{
    origin?: string;
    cookie?: string | null;
    contentType?: string | null;
    contentLength?: string;
    ownerHeader?: string;
    signal?: AbortSignal;
  }> = {},
): NextRequest {
  const headers = new Headers();
  const origin = options.origin ?? PUBLIC_ORIGIN;
  if (origin !== "") headers.set("Origin", origin);
  const cookie = options.cookie === undefined ? sessionCookie() : options.cookie;
  if (cookie !== null) {
    headers.set("Cookie", `${CASE_OWNER_COOKIE_NAME}=${cookie}`);
  }
  const contentType = options.contentType ?? "application/json";
  if (contentType !== null) headers.set("Content-Type", contentType);
  if (options.contentLength !== undefined) {
    headers.set("Content-Length", options.contentLength);
  }
  if (options.ownerHeader !== undefined) {
    headers.set("X-Owner-Id", options.ownerHeader);
  }
  return new NextRequest(
    `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/audio-audits?ownerId=owner:attacker`,
    { method: "POST", headers, body: JSON.stringify(body), signal: options.signal },
  );
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

describe("hearing audio audit BFF", () => {
  beforeEach(() => {
    configureEnvironment();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("derives owner authority from the cookie and preserves idempotent results", async () => {
    const record = audioRecord();
    const forwarded: Array<{
      path: string;
      body: unknown;
      authorization: string | null;
      cache: RequestCache | undefined;
      hasSignal: boolean;
      signalAborted: boolean;
    }> = [];
    let disconnectedBrowser: AbortController | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const headers = new Headers(init?.headers);
        if (forwarded.length === 0) {
          disconnectedBrowser?.abort();
          await Promise.resolve();
        }
        forwarded.push({
          path: new URL(rawUrl).pathname,
          body: JSON.parse(String(init?.body)) as unknown,
          authorization: headers.get("authorization"),
          cache: init?.cache,
          hasSignal: init?.signal !== undefined,
          signalAborted: init?.signal?.aborted ?? false,
        });
        return Response.json({
          recordId: record.recordId,
          replayed: forwarded.length > 1,
        });
      }),
    );

    disconnectedBrowser = new AbortController();
    const firstRequest = request(
      { record },
      { ownerHeader: "owner:attacker", signal: disconnectedBrowser.signal },
    );
    const first = await POST(
      firstRequest,
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const replay = await POST(request({ record }), {
      params: Promise.resolve({ trialId: TRIAL_ID }),
    });

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      recordId: record.recordId,
      replayed: false,
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      recordId: record.recordId,
      replayed: true,
    });
    expect(forwarded).toEqual(
      Array.from({ length: 2 }, () => ({
        path: "/service/hearings/audio-audit/record",
        body: {
          ownerId: `owner:${SESSION_ID}`,
          trialId: TRIAL_ID,
          record,
        },
        authorization: `Bearer ${SERVICE_SECRET}`,
        cache: "no-store",
        hasSignal: true,
        signalAborted: false,
      })),
    );
    expect(JSON.stringify(forwarded)).not.toContain("attacker");
    expect(JSON.stringify(forwarded)).not.toContain("rawAudio");
    expect(JSON.stringify(forwarded)).not.toContain("transcript");
    expectPrivateHeaders(first);
    expectPrivateHeaders(replay);
  });

  it("rejects authority, raw data, and oversized bodies before Convex", async () => {
    const record = audioRecord();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const crossOrigin = await POST(
      request({ record }, { origin: "https://attacker.test" }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const invalidTrial = await POST(request({ record }), {
      params: Promise.resolve({ trialId: "trial_legacy" }) },
    );
    const missingSession = await POST(
      request({ record }, { cookie: null }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const rawAudio = await POST(
      request({
        record: {
          ...record,
          rawAudio: "secret-bytes",
          transcript: "private transcript",
          timingMarks: [{ text: "private" }],
        },
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const browserOwner = await POST(
      request({ record, ownerId: "owner:attacker" }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const oversized = await POST(
      request({ record }, { contentLength: "40000" }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    const wrongContentType = await POST(
      request({ record }, { contentType: "text/plain" }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    const expected = [
      [crossOrigin, 403, "ORIGIN_REJECTED"],
      [invalidTrial, 400, "HEARING_AUDIO_AUDIT_TRIAL_ID_INVALID"],
      [missingSession, 401, "HEARING_AUDIO_AUDIT_SESSION_REQUIRED"],
      [rawAudio, 400, "HEARING_REQUEST_INVALID"],
      [browserOwner, 400, "HEARING_REQUEST_INVALID"],
      [oversized, 413, "HEARING_REQUEST_TOO_LARGE"],
      [wrongContentType, 415, "HEARING_JSON_REQUIRED"],
    ] as const;
    for (const [response, status, code] of expected) {
      expect(response.status).toBe(status);
      expect(await errorCode(response)).toBe(code);
      expectPrivateHeaders(response);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allowlists expected durable errors and collapses malformed responses", async () => {
    const record = audioRecord();
    const responses: Array<Response | Error> = [
      Response.json({ error: "TRIAL_NOT_FOUND" }, { status: 404 }),
      Response.json(
        { error: "TRIAL_MIGRATION_REQUIRED" },
        { status: 409 },
      ),
      Response.json(
        { error: "HEARING_AUDIO_AUDIT_CONFLICT" },
        { status: 409 },
      ),
      Response.json(
        { error: "HEARING_AUDIO_AUDIT_SEMANTICS_INVALID" },
        { status: 422 },
      ),
      Response.json({ recordId: "b".repeat(64), replayed: false }),
      Response.json({ unexpected: true }),
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

    const results = [];
    for (let index = 0; index < 7; index += 1) {
      results.push(
        await POST(request({ record }), {
          params: Promise.resolve({ trialId: TRIAL_ID }),
        }),
      );
    }
    const expected = [
      [404, "HEARING_AUDIO_AUDIT_TRIAL_NOT_FOUND"],
      [409, "HEARING_AUDIO_AUDIT_MIGRATION_REQUIRED"],
      [409, "HEARING_AUDIO_AUDIT_REJECTED"],
      [422, "HEARING_AUDIO_AUDIT_REJECTED"],
      [503, "HEARING_AUDIO_AUDIT_UNAVAILABLE"],
      [503, "HEARING_AUDIO_AUDIT_UNAVAILABLE"],
      [503, "HEARING_AUDIO_AUDIT_UNAVAILABLE"],
    ] as const;
    for (const [index, response] of results.entries()) {
      expect(response.status).toBe(expected[index]?.[0]);
      expect(await errorCode(response)).toBe(expected[index]?.[1]);
      expectPrivateHeaders(response);
    }
  });
});
