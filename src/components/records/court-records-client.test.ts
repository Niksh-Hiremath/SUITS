import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CourtRecordsListResponseSchema,
  CourtRecordsTrialSummarySchema,
  CourtRecordsViewSchema,
} from "../../domain/court-records";
import {
  COURT_RECORDS_CLIENT_ERROR_DETAILS,
  CourtRecordsClientError,
  downloadCourtRecord,
  isCourtRecordsRequestAbort,
  listCourtRecords,
  readCourtRecord,
} from "./court-records-client";

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

function expectClientError(
  error: unknown,
  code: keyof typeof COURT_RECORDS_CLIENT_ERROR_DETAILS,
): void {
  expect(error).toBeInstanceOf(CourtRecordsClientError);
  expect(error).toMatchObject({
    name: "CourtRecordsClientError",
    code,
    status: COURT_RECORDS_CLIENT_ERROR_DETAILS[code].status,
    message: COURT_RECORDS_CLIENT_ERROR_DETAILS[code].message,
  });
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected Court Records request to reject");
}

describe("Court Records browser client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses exact private same-origin list and read requests", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([SUMMARY]))
      .mockResolvedValueOnce(Response.json(VIEW));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listCourtRecords({ signal: controller.signal }),
    ).resolves.toEqual([SUMMARY]);
    await expect(
      readCourtRecord(TRIAL_ID, { signal: controller.signal }),
    ).resolves.toEqual(VIEW);

    const exactOptions = {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    };
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/records",
      exactOptions,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/records/${TRIAL_ID}`,
      exactOptions,
    );
  });

  it("exports a strict list contract bounded to 64 records", () => {
    expect(CourtRecordsListResponseSchema.safeParse([SUMMARY]).success).toBe(
      true,
    );
    expect(
      CourtRecordsListResponseSchema.safeParse(
        Array.from({ length: 64 }, () => SUMMARY),
      ).success,
    ).toBe(true);
    expect(
      CourtRecordsListResponseSchema.safeParse(
        Array.from({ length: 65 }, () => SUMMARY),
      ).success,
    ).toBe(false);
    expect(
      CourtRecordsListResponseSchema.safeParse([
        { ...SUMMARY, unexpected: true },
      ]).success,
    ).toBe(false);
  });

  it("validates and preserves the exact redacted download bytes", async () => {
    const json = JSON.stringify(VIEW);
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(json, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadCourtRecord(TRIAL_ID, { signal: controller.signal }),
    ).resolves.toEqual({
      fileName: `suits-court-record-${TRIAL_ID}.json`,
      json,
      view: VIEW,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/records/${TRIAL_ID}/download`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      },
    );
  });

  it("fails closed on malformed successful list and detail payloads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{ ...SUMMARY, unexpected: true }]))
      .mockResolvedValueOnce(
        Response.json({ ...VIEW, replayIntegrity: { status: "verified" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expectClientError(
      await captureRejection(listCourtRecords()),
      "COURT_RECORD_UNAVAILABLE",
    );
    expectClientError(
      await captureRejection(readCourtRecord(TRIAL_ID)),
      "COURT_RECORD_UNAVAILABLE",
    );
  });

  it("rejects a response bound to a different trial", async () => {
    const mismatched = {
      ...VIEW,
      summary: { ...SUMMARY, trialId: OTHER_TRIAL_ID },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(mismatched))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mismatched)),
        ),
    );

    expectClientError(
      await captureRejection(readCourtRecord(TRIAL_ID)),
      "COURT_RECORD_UNAVAILABLE",
    );
    expectClientError(
      await captureRejection(downloadCourtRecord(TRIAL_ID)),
      "COURT_RECORD_UNAVAILABLE",
    );
  });

  it("rejects invalid trial links without issuing a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    expectClientError(
      await captureRejection(
        readCourtRecord("../../service/court-records/read"),
      ),
      "COURT_RECORD_UNAVAILABLE",
    );
    expectClientError(
      await captureRejection(downloadCourtRecord("trial_legacy")),
      "COURT_RECORD_UNAVAILABLE",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "COURT_RECORD_SESSION_REQUIRED"],
    [404, "COURT_RECORD_NOT_FOUND"],
    [409, "COURT_RECORD_MIGRATION_REQUIRED"],
    [503, "COURT_RECORD_UNAVAILABLE"],
    [400, "COURT_RECORD_UNAVAILABLE"],
    [403, "COURT_RECORD_UNAVAILABLE"],
    [418, "COURT_RECORD_UNAVAILABLE"],
    [500, "COURT_RECORD_UNAVAILABLE"],
  ] as const)("maps HTTP %i to fixed safe UI error %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          "sensitive upstream text: owner, prompt, provider, token",
          { status },
        ),
      ),
    );

    const error = await captureRejection(readCourtRecord(TRIAL_ID));
    expectClientError(error, code);
    expect(String(error)).not.toContain("sensitive upstream text");
    expect(String(error)).not.toContain("provider");
  });

  it("maps JSON failures and network details to the fixed unavailable error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("not-json and not safe for display", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockRejectedValueOnce(
        new Error("network detail with an upstream hostname and token"),
      )
      .mockResolvedValueOnce(
        new Response("not-json and not safe for download", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const invalidJsonError = await captureRejection(listCourtRecords());
    expectClientError(invalidJsonError, "COURT_RECORD_UNAVAILABLE");
    expect(String(invalidJsonError)).not.toContain("not-json");

    const networkError = await captureRejection(listCourtRecords());
    expectClientError(networkError, "COURT_RECORD_UNAVAILABLE");
    expect(String(networkError)).not.toContain("upstream hostname");
    expect(String(networkError)).not.toContain("token");

    const invalidDownload = await captureRejection(
      downloadCourtRecord(TRIAL_ID),
    );
    expectClientError(invalidDownload, "COURT_RECORD_UNAVAILABLE");
    expect(String(invalidDownload)).not.toContain("not-json");
  });

  it("passes the caller signal and preserves abort identity", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("request cancelled", "AbortError");
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(abortError),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = listCourtRecords({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toBe(abortError);
    expect(isCourtRecordsRequestAbort(abortError)).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("contains no browser authority or direct persistence access", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./court-records-client.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toMatch(/ownerId|document\.cookie|localStorage|sessionStorage/u);
    expect(source).not.toMatch(/(?:from|import\()\s*["'][^"']*convex/iu);
  });
});
