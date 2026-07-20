import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  HEARING_AUDIO_AUDIT_MAX_EPOCH_MS,
  HearingAudioAuditRecordSchema,
  createHearingAudioAuditPreparer,
  type HearingAudioAuditRecord,
} from "../src/lib/speech/hearing-audio-audit";
import { sha256Utf8 } from "../src/domain/case-graph/hash";
import {
  HEARING_JUDGE_ACTOR_ID,
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
  type HearingPerformanceEvent,
} from "../src/lib/speech/hearing-performance";
import {
  HEARING_START_SCHEMA_VERSION,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "../src/domain/hearing-runtime";
import {
  MAX_HEARING_AUDIO_AUDITS_PER_TRIAL,
  type PersistHearingAudioAuditResult,
} from "./hearingAudioAudits";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./hearingAudioAudits.ts": () => import("./hearingAudioAudits"),
  "./hearingRuntime.ts": () => import("./hearingRuntime"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

type TestBackend = TestConvex<typeof schema>;

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";

const startReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; requestJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:start");
const recordReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; trialId: string; recordJson: string }>,
  PersistHearingAudioAuditResult
>("hearingAudioAudits:recordForOwner");
const listReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  HearingAudioAuditRecord[]
>("hearingAudioAudits:listForOwnerTrial");

async function startTrial(
  backend: TestBackend,
  requestId = "11111111-1111-4111-8111-111111111111",
): Promise<HearingRuntimeViewV1> {
  return HearingRuntimeViewV1Schema.parse(
    await backend.action(startReference, {
      ownerId: OWNER_ID,
      requestJson: JSON.stringify({
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId,
        requestedAt: "2026-07-20T05:30:00.000Z",
        case: { kind: "seeded", slug: "redwood-signal-retaliation" },
        userSide: "user",
      }),
    }),
  );
}

function userRecord(
  generation: number,
  startedAt: number,
  endedAt: number,
): HearingAudioAuditRecord {
  let now = startedAt;
  const preparer = createHearingAudioAuditPreparer({
    clock: { nowEpochMs: () => now },
  });
  const utteranceId = `utterance:${generation}`;
  preparer.consume(
    freezeHearingPerformanceEvent({
      schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
      type: "user_speech_started",
      generation,
      utteranceId,
      sceneActor: "user_counsel",
      mode: "question",
      observedAtMs: 0,
      timestampSource: "speech_service",
    }),
  );
  now = endedAt;
  preparer.consume(
    freezeHearingPerformanceEvent({
      schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
      type: "user_speech_ended",
      generation,
      utteranceId,
      sceneActor: "user_counsel",
      mode: "question",
      observedAtMs: endedAt - startedAt,
      timestampSource: "speech_service",
      reason: "vad_end",
    }),
  );
  const [record] = preparer.flush();
  if (!record) throw new Error("Expected an audio audit fixture");
  return HearingAudioAuditRecordSchema.parse(record);
}

type PlaybackCommon = Omit<
  Extract<HearingPerformanceEvent, { type: "playback_requested" }>,
  "type"
>;

function playbackRecord(
  generation: number,
  requestedAt: number,
  startedAt: number,
  endedAt: number,
  binding: "speaker_test" | "forged_testimony" = "speaker_test",
): HearingAudioAuditRecord {
  let now = requestedAt;
  const preparer = createHearingAudioAuditPreparer({
    clock: { nowEpochMs: () => now },
  });
  const common = {
    schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
    generation,
    playbackFence: generation,
    jobId: `job:${generation}`,
    responseId: `response:${generation}`,
    actor:
      binding === "speaker_test"
        ? HEARING_JUDGE_ACTOR_ID
        : "actor.witness.rina",
    sequence: generation,
    sceneActor: binding === "speaker_test" ? "judge" : "witness",
    purpose: binding === "speaker_test" ? "speaker_test" : "testimony",
    turnId:
      binding === "speaker_test" ? null : `turn:testimony:${generation}`,
    interruptId: null,
  } satisfies PlaybackCommon;
  preparer.consume(
    freezeHearingPerformanceEvent({
      type: "playback_requested",
      ...common,
    }),
  );
  now = startedAt;
  preparer.consume(
    freezeHearingPerformanceEvent({
      type: "playback_started",
      ...common,
    }),
  );
  preparer.consume(
    freezeHearingPerformanceEvent({
      type: "timing_scheduled",
      ...common,
      audioClockTimeSeconds: 5,
      marks: [
        {
          kind: "phrase",
          value: "PRIVATE PLAYBACK PHRASE MUST NOT PERSIST",
          startMs: 0,
          endMs: 400,
          audioStartTimeSeconds: 5,
          audioEndTimeSeconds: 5.4,
        },
        {
          kind: "word",
          value: "private-playback-word",
          startMs: 20,
          endMs: 180,
          audioStartTimeSeconds: 5.02,
          audioEndTimeSeconds: 5.18,
        },
        {
          kind: "viseme",
          value: "private-playback-viseme",
          startMs: 25,
          endMs: 90,
          audioStartTimeSeconds: 5.025,
          audioEndTimeSeconds: 5.09,
        },
      ],
    }),
  );
  now = endedAt;
  preparer.consume(
    freezeHearingPerformanceEvent({
      type: "playback_terminal",
      ...common,
      status: "completed",
      reason: "completed",
    }),
  );
  const [record] = preparer.flush();
  if (!record) throw new Error("Expected a playback audio audit fixture");
  return HearingAudioAuditRecordSchema.parse(record);
}

async function storedRows(backend: TestBackend) {
  return await backend.run(async (ctx) =>
    await ctx.db.query("hearingAudioAudits").collect(),
  );
}

describe("hearing audio-audit persistence", () => {
  it("persists, reparses, lists, and idempotently replays exact metadata", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const record = userRecord(1, 1_000, 1_450);

    const beforePersist = Date.now();
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(record),
      }),
    ).resolves.toEqual({ recordId: record.recordId, replayed: false });
    const afterPersist = Date.now();
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(record, null, 2),
      }),
    ).resolves.toEqual({ recordId: record.recordId, replayed: true });

    const rows = await storedRows(backend);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recordId: record.recordId,
      ownerId: OWNER_ID,
      trialId: trial.trial.trialId,
      recordJson: JSON.stringify(record),
      contentHash: record.contentHash,
      schemaVersion: record.schemaVersion,
      persistedAt: expect.any(Number),
    });
    expect(rows[0]?.persistedAt).toBeGreaterThanOrEqual(beforePersist);
    expect(rows[0]?.persistedAt).toBeLessThanOrEqual(afterPersist);
    expect(rows[0]?.persistedAt).not.toBe(record.endedAtEpochMs);
    await expect(
      backend.query(listReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
      }),
    ).resolves.toEqual([record]);
  });

  it("persists and replays aggregate-only playback metadata", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const record = playbackRecord(8, 8_000, 8_020, 8_500);
    const changedLifecycle = playbackRecord(8, 8_000, 8_020, 8_700);
    expect(changedLifecycle.recordId).toBe(record.recordId);
    expect(changedLifecycle.contentHash).not.toBe(record.contentHash);

    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(record),
      }),
    ).resolves.toEqual({ recordId: record.recordId, replayed: false });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(record, null, 2),
      }),
    ).resolves.toEqual({ recordId: record.recordId, replayed: true });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(changedLifecycle),
      }),
    ).rejects.toThrow("HEARING_AUDIO_AUDIT_CONFLICT");

    const [row] = await storedRows(backend);
    if (!row) throw new Error("Expected stored playback audio audit");
    expect(row.recordJson).toBe(JSON.stringify(record));
    for (const forbidden of [
      "PRIVATE PLAYBACK PHRASE",
      "private-playback-word",
      "private-playback-viseme",
      '"text"',
      '"transcript"',
      '"marks"',
      '"markValues"',
      '"audio"',
      '"audioBytes"',
      '"rawPcm"',
      '"pcmBytes"',
      '"providerError"',
    ]) {
      expect(row.recordJson).not.toContain(forbidden);
    }
    await expect(
      backend.query(listReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
      }),
    ).resolves.toEqual([record]);
  });

  it("rejects cross-owner writes and reads without creating a row", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const record = userRecord(2, 2_000, 2_300);

    await expect(
      backend.mutation(recordReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(record),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.query(listReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: trial.trial.trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    expect(await storedRows(backend)).toEqual([]);
  });

  it("rejects schema-valid playback metadata with forged canonical bindings", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const record = playbackRecord(
      9,
      9_000,
      9_020,
      9_500,
      "forged_testimony",
    );

    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(record),
      }),
    ).rejects.toThrow("HEARING_AUDIO_AUDIT_SEMANTICS_INVALID");
    expect(await storedRows(backend)).toEqual([]);
  });

  it("rejects malformed hashes, raw audio, and arbitrary record fields", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const record = userRecord(3, 3_000, 3_500);
    const unsafeRecords = [
      { ...record, contentHash: "f".repeat(64) },
      { ...record, rawPcm: "PRIVATE_RAW_AUDIO" },
      { ...record, transcriptText: "PRIVATE_TRANSCRIPT" },
    ];

    for (const unsafe of unsafeRecords) {
      await expect(
        backend.mutation(recordReference, {
          ownerId: OWNER_ID,
          trialId: trial.trial.trialId,
          recordJson: JSON.stringify(unsafe),
        }),
      ).rejects.toThrow("HEARING_AUDIO_AUDIT_RECORD_INVALID");
    }
    expect(await storedRows(backend)).toEqual([]);
  });

  it("rejects a valid conflicting duplicate identity", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const first = userRecord(4, 4_000, 4_300);
    const changedLifecycle = userRecord(4, 4_000, 4_600);
    expect(changedLifecycle.recordId).toBe(first.recordId);
    expect(changedLifecycle.contentHash).not.toBe(first.contentHash);

    await backend.mutation(recordReference, {
      ownerId: OWNER_ID,
      trialId: trial.trial.trialId,
      recordJson: JSON.stringify(first),
    });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(changedLifecycle),
      }),
    ).rejects.toThrow("HEARING_AUDIO_AUDIT_CONFLICT");
    expect(await storedRows(backend)).toHaveLength(1);
  });

  it("scopes the same local audio identity independently to each owned trial", async () => {
    const backend = convexTest({ schema, modules });
    const firstTrial = await startTrial(backend);
    const secondTrial = await startTrial(
      backend,
      "22222222-2222-4222-8222-222222222222",
    );
    const record = userRecord(7, 7_000, 7_400);

    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: firstTrial.trial.trialId,
        recordJson: JSON.stringify(record),
      }),
    ).resolves.toEqual({ recordId: record.recordId, replayed: false });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: secondTrial.trial.trialId,
        recordJson: JSON.stringify(record),
      }),
    ).resolves.toEqual({ recordId: record.recordId, replayed: false });
    expect(await storedRows(backend)).toHaveLength(2);
  });

  it("fails closed when stored integrity fields or timestamps are invalid", async () => {
    for (const patch of [
      { contentHash: "e".repeat(64) },
      { schemaVersion: "hearing-audio-audit.tampered" },
      { persistedAt: -1 },
      { recordJson: "{}" },
    ]) {
      const backend = convexTest({ schema, modules });
      const trial = await startTrial(backend);
      const record = userRecord(5, 5_000, 5_500);
      await backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(record),
      });
      await backend.run(async (ctx) => {
        const row = await ctx.db
          .query("hearingAudioAudits")
          .withIndex("by_owner_trial_record", (index) =>
            index
              .eq("ownerId", OWNER_ID)
              .eq("trialId", trial.trial.trialId)
              .eq("recordId", record.recordId),
          )
          .unique();
        if (!row) throw new Error("Expected stored audio audit");
        await ctx.db.patch(row._id, patch);
      });
      await expect(
        backend.query(listReference, {
          ownerId: OWNER_ID,
          trialId: trial.trial.trialId,
        }),
      ).rejects.toThrow("HEARING_AUDIO_AUDIT_INVALID");
    }
  });

  it("rejects a correctly rehashed record outside the JavaScript Date range", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    const record = userRecord(6, 6_000, 6_500);
    const content = {
      ...record,
      observedAtEpochMs: HEARING_AUDIO_AUDIT_MAX_EPOCH_MS + 1,
      requestedAtEpochMs: null,
      startedAtEpochMs: HEARING_AUDIO_AUDIT_MAX_EPOCH_MS + 1,
      endedAtEpochMs: HEARING_AUDIO_AUDIT_MAX_EPOCH_MS + 1,
      aggregateDurationMs: 0,
    };
    const hashInput = Object.fromEntries(
      Object.entries(content).filter(([key]) => key !== "contentHash"),
    );
    const crafted = {
      ...content,
      contentHash: sha256Utf8(JSON.stringify(hashInput)),
    };
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(crafted),
      }),
    ).rejects.toThrow("HEARING_AUDIO_AUDIT_RECORD_INVALID");
  });

  it("accepts the final-capacity mutation and exact replay but rejects a new identity", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    await backend.run(async (ctx) => {
      for (
        let index = 0;
        index < MAX_HEARING_AUDIO_AUDITS_PER_TRIAL - 1;
        index += 1
      ) {
        await ctx.db.insert("hearingAudioAudits", {
          recordId: `capacity:${index}`,
          ownerId: OWNER_ID,
          trialId: trial.trial.trialId,
          recordJson: "{}",
          contentHash: "0".repeat(64),
          schemaVersion: "hearing-audio-audit.v1",
          persistedAt: index,
        });
      }
    });
    const finalCapacityRecord = userRecord(9, 9_000, 9_300);
    const overflowRecord = userRecord(10, 10_000, 10_300);

    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(finalCapacityRecord),
      }),
    ).resolves.toEqual({
      recordId: finalCapacityRecord.recordId,
      replayed: false,
    });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(finalCapacityRecord, null, 2),
      }),
    ).resolves.toEqual({
      recordId: finalCapacityRecord.recordId,
      replayed: true,
    });
    await expect(
      backend.mutation(recordReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
        recordJson: JSON.stringify(overflowRecord),
      }),
    ).rejects.toThrow("HEARING_AUDIO_AUDIT_LIMIT_EXCEEDED");
    expect(await storedRows(backend)).toHaveLength(
      MAX_HEARING_AUDIO_AUDITS_PER_TRIAL,
    );
  });

  it("fails before reparsing when an owner/trial audit exceeds the read cap", async () => {
    const backend = convexTest({ schema, modules });
    const trial = await startTrial(backend);
    await backend.run(async (ctx) => {
      for (
        let index = 0;
        index <= MAX_HEARING_AUDIO_AUDITS_PER_TRIAL;
        index += 1
      ) {
        await ctx.db.insert("hearingAudioAudits", {
          recordId: `overflow:${index}`,
          ownerId: OWNER_ID,
          trialId: trial.trial.trialId,
          recordJson: "{}",
          contentHash: "0".repeat(64),
          schemaVersion: "hearing-audio-audit.v1",
          persistedAt: index,
        });
      }
    });
    await expect(
      backend.query(listReference, {
        ownerId: OWNER_ID,
        trialId: trial.trial.trialId,
      }),
    ).rejects.toThrow("HEARING_AUDIO_AUDIT_LIMIT_EXCEEDED");
  });
});
