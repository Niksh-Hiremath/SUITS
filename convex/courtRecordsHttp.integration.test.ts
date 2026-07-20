import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourtRecordsViewSchema } from "../src/domain/court-records";
import {
  HEARING_START_SCHEMA_VERSION,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "../src/domain/hearing-runtime";
import {
  HearingAudioAuditPersistResultSchema,
  createHearingAudioAuditPreparer,
  type HearingAudioAuditRecord,
} from "../src/lib/speech/hearing-audio-audit";
import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
} from "../src/lib/speech/hearing-performance";
import schema from "./schema";

const SERVICE_SECRET =
  "court-records-http-test-secret-longer-than-thirty-two-characters";
const OWNER_ID = "owner:923e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:a23e4567-e89b-42d3-a456-426614174000";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./courtRecords.ts": () => import("./courtRecords"),
  "./courtroomGeneratedArtifacts.ts": () =>
    import("./courtroomGeneratedArtifacts"),
  "./courtroomModelCalls.ts": () => import("./courtroomModelCalls"),
  "./hearingAudioAudits.ts": () => import("./hearingAudioAudits"),
  "./hearingRuntime.ts": () => import("./hearingRuntime"),
  "./http.ts": () => import("./http"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

const startReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; requestJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:start");

const listAudioAuditsReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  HearingAudioAuditRecord[]
>("hearingAudioAudits:listForOwnerTrial");

function authorizedRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

async function startHearing(
  backend: ReturnType<typeof convexTest>,
): Promise<HearingRuntimeViewV1> {
  return HearingRuntimeViewV1Schema.parse(
    await backend.action(startReference, {
      ownerId: OWNER_ID,
      requestJson: JSON.stringify({
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId: "93333333-3333-4333-8333-333333333333",
        requestedAt: "2026-07-20T04:00:00.000Z",
        case: { kind: "seeded", slug: "redwood-signal-retaliation" },
        userSide: "user",
      }),
    }),
  );
}

function audioRecord(): HearingAudioAuditRecord {
  let nowEpochMs = 1_000;
  const preparer = createHearingAudioAuditPreparer({
    clock: { nowEpochMs: () => nowEpochMs },
  });
  preparer.consume(
    freezeHearingPerformanceEvent({
      schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
      type: "user_speech_started",
      generation: 1,
      utteranceId: "utterance:records:http",
      sceneActor: "user_counsel",
      mode: "question",
      observedAtMs: 10,
      timestampSource: "speech_service",
    }),
  );
  nowEpochMs = 1_125;
  preparer.consume(
    freezeHearingPerformanceEvent({
      schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
      type: "user_speech_ended",
      generation: 1,
      utteranceId: "utterance:records:http",
      sceneActor: "user_counsel",
      mode: "question",
      observedAtMs: 135,
      timestampSource: "speech_service",
      reason: "vad_end",
    }),
  );
  const record = preparer.flush()[0];
  if (record === undefined) throw new Error("Missing audio audit fixture");
  return record;
}

describe("Convex Court Records HTTP service", () => {
  beforeEach(() => {
    vi.stubEnv("SUITS_CONVEX_SERVICE_SECRET", SERVICE_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves strict owner-scoped list and read projections", async () => {
    const backend = convexTest({ schema, modules });
    const hearing = await startHearing(backend);

    const listResponse = await backend.fetch(
      "/service/court-records/list",
      authorizedRequest({ ownerId: OWNER_ID }),
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("cache-control")).toBe(
      "no-store, max-age=0",
    );
    expect(listResponse.headers.get("pragma")).toBe("no-cache");
    expect(listResponse.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        trialId: hearing.trial.trialId,
        schemaVersion: "court-records-summary.v1",
      }),
    ]);

    const readResponse = await backend.fetch(
      "/service/court-records/read",
      authorizedRequest({
        ownerId: OWNER_ID,
        trialId: hearing.trial.trialId,
      }),
    );
    expect(readResponse.status).toBe(200);
    const view = CourtRecordsViewSchema.parse(await readResponse.json());
    expect(view.summary.trialId).toBe(hearing.trial.trialId);
    const serialized = JSON.stringify(view);
    for (const forbidden of [
      '"payload"',
      '"caseGraph"',
      '"artifactJson"',
      '"stateJson"',
      '"eventJsons"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("requires the service secret and rejects malformed bodies", async () => {
    const backend = convexTest({ schema, modules });
    const unauthorized = await backend.fetch("/service/court-records/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: OWNER_ID }),
    });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: "CASE_SERVICE_UNAUTHORIZED",
    });

    const malformed = await backend.fetch(
      "/service/court-records/read",
      authorizedRequest({
        ownerId: OWNER_ID,
        trialId: " ",
        unexpected: true,
      }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "CASE_SERVICE_REQUEST_INVALID",
    });
  });

  it("returns not-found for cross-owner reads and migration for legacy lists", async () => {
    const backend = convexTest({ schema, modules });
    const hearing = await startHearing(backend);

    const foreign = await backend.fetch(
      "/service/court-records/read",
      authorizedRequest({
        ownerId: OTHER_OWNER_ID,
        trialId: hearing.trial.trialId,
      }),
    );
    expect(foreign.status).toBe(404);
    await expect(foreign.json()).resolves.toEqual({
      error: "TRIAL_NOT_FOUND",
    });

    await backend.run(async (ctx) => {
      const projection = await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", hearing.trial.trialId),
        )
        .unique();
      if (projection === null) throw new Error("Missing projection fixture");
      await ctx.db.patch(projection._id, {
        stateSchemaVersion: "trial-state.v2",
      });
    });
    const legacy = await backend.fetch(
      "/service/court-records/list",
      authorizedRequest({ ownerId: OWNER_ID }),
    );
    expect(legacy.status).toBe(409);
    await expect(legacy.json()).resolves.toEqual({
      error: "TRIAL_MIGRATION_REQUIRED",
    });
  });

  it("persists only strict metadata-only browser audio observations", async () => {
    const backend = convexTest({ schema, modules });
    const hearing = await startHearing(backend);
    const record = audioRecord();
    const body = {
      ownerId: OWNER_ID,
      trialId: hearing.trial.trialId,
      record,
    };

    const accepted = await backend.fetch(
      "/service/hearings/audio-audit/record",
      authorizedRequest(body),
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(
      HearingAudioAuditPersistResultSchema.parse(await accepted.json()),
    ).toEqual({ recordId: record.recordId, replayed: false });

    const replay = await backend.fetch(
      "/service/hearings/audio-audit/record",
      authorizedRequest(body),
    );
    expect(
      HearingAudioAuditPersistResultSchema.parse(await replay.json()),
    ).toEqual({ recordId: record.recordId, replayed: true });
    await expect(
      backend.query(listAudioAuditsReference, {
        ownerId: OWNER_ID,
        trialId: hearing.trial.trialId,
      }),
    ).resolves.toEqual([record]);

    const rawAudio = await backend.fetch(
      "/service/hearings/audio-audit/record",
      authorizedRequest({ ...body, record: { ...record, rawAudio: "secret" } }),
    );
    expect(rawAudio.status).toBe(400);
    await expect(rawAudio.json()).resolves.toEqual({
      error: "CASE_SERVICE_REQUEST_INVALID",
    });

    const unauthorized = await backend.fetch(
      "/service/hearings/audio-audit/record",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: "CASE_SERVICE_UNAUTHORIZED",
    });

    const foreign = await backend.fetch(
      "/service/hearings/audio-audit/record",
      authorizedRequest({ ...body, ownerId: OTHER_OWNER_ID }),
    );
    expect(foreign.status).toBe(404);
    await expect(foreign.json()).resolves.toEqual({
      error: "TRIAL_NOT_FOUND",
    });
  });
});
