import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  type CourtRecordsTrialSummary,
  CourtRecordsViewSchema,
  type CourtRecordsView,
} from "../src/domain/court-records";
import {
  HEARING_START_SCHEMA_VERSION,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "../src/domain/hearing-runtime";
import { createHearingAudioAuditPreparer } from "../src/lib/speech/hearing-audio-audit";
import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
} from "../src/lib/speech/hearing-performance";
import type { PersistHearingAudioAuditResult } from "./hearingAudioAudits";
import { MAX_COURT_RECORD_TRIALS_PER_OWNER } from "./courtRecords";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./courtRecords.ts": () => import("./courtRecords"),
  "./courtroomGeneratedArtifacts.ts": () =>
    import("./courtroomGeneratedArtifacts"),
  "./courtroomModelCalls.ts": () => import("./courtroomModelCalls"),
  "./hearingAudioAudits.ts": () => import("./hearingAudioAudits"),
  "./hearingRuntime.ts": () => import("./hearingRuntime"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

const OWNER_ID = "owner:323e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:423e4567-e89b-42d3-a456-426614174000";

const startReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; requestJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:start");

const readRecordsReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string }>,
  CourtRecordsView
>("courtRecords:readForOwner");

const listRecordsReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string }>,
  readonly CourtRecordsTrialSummary[]
>("courtRecords:listForOwner");

const recordAudioReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; trialId: string; recordJson: string }>,
  PersistHearingAudioAuditResult
>("hearingAudioAudits:recordForOwner");

function startRequest(
  requestId = "33333333-3333-4333-8333-333333333333",
  requestedAt = "2026-07-20T02:30:00.000Z",
) {
  return {
    schemaVersion: HEARING_START_SCHEMA_VERSION,
    requestId,
    requestedAt,
    case: { kind: "seeded", slug: "redwood-signal-retaliation" },
    userSide: "user",
  } as const;
}

describe("owner-bound Court Records assembly", () => {
  it("returns an empty owner summary list without creating a trial", async () => {
    const backend = convexTest(schema, modules);

    await expect(
      backend.action(listRecordsReference, { ownerId: OWNER_ID }),
    ).resolves.toEqual([]);
  });

  it("lists only owned trials in canonical newest-first order", async () => {
    const backend = convexTest(schema, modules);
    const older = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(
          startRequest(
            "63333333-3333-4333-8333-333333333333",
            "2026-07-20T02:31:00.000Z",
          ),
        ),
      }),
    );
    const newer = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(
          startRequest(
            "73333333-3333-4333-8333-333333333333",
            "2026-07-20T02:32:00.000Z",
          ),
        ),
      }),
    );
    await backend.action(startReference, {
      ownerId: OTHER_OWNER_ID,
      requestJson: JSON.stringify(
        startRequest(
          "83333333-3333-4333-8333-333333333333",
          "2026-07-20T02:33:00.000Z",
        ),
      ),
    });

    const summaries = await backend.action(listRecordsReference, {
      ownerId: OWNER_ID,
    });
    expect(summaries.map(({ trialId }) => trialId)).toEqual([
      newer.trial.trialId,
      older.trial.trialId,
    ]);
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemaVersion: "court-records-summary.v1",
          caseTitle: "Rina Shah v. Redwood Signal Systems",
        }),
      ]),
    );
  });

  it("fails the whole list when an owned projection requires migration", async () => {
    const backend = convexTest(schema, modules);
    const hearing = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(startRequest()),
      }),
    );
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

    await expect(
      backend.action(listRecordsReference, { ownerId: OWNER_ID }),
    ).rejects.toThrow("TRIAL_MIGRATION_REQUIRED");
  });

  it("fails closed when the owner trial count exceeds the bounded list", async () => {
    const backend = convexTest(schema, modules);
    await backend.run(async (ctx) => {
      for (
        let index = 0;
        index < MAX_COURT_RECORD_TRIALS_PER_OWNER + 1;
        index += 1
      ) {
        await ctx.db.insert("trialProjections", {
          projectionId: `projection:records:limit:${index}`,
          trialId: `trial:records:limit:${index}`,
          ownerId: OWNER_ID,
          graphId: "graph:records:limit",
          caseId: "case:records:limit",
          caseVersion: 1,
          stateVersion: 1,
          lastSequence: 1,
          stateJson: "{}",
          stateSchemaVersion: "trial-state.v3",
          eventSchemaVersion: "trial-event.v3",
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    await expect(
      backend.action(listRecordsReference, { ownerId: OWNER_ID }),
    ).rejects.toThrow("COURT_RECORDS_TRIAL_LIMIT_EXCEEDED");
  });

  it("returns only a stable privacy-safe projection of an owned V3 trial", async () => {
    const backend = convexTest(schema, modules);
    const hearing = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(startRequest()),
      }),
    );

    const first = CourtRecordsViewSchema.parse(
      await backend.action(readRecordsReference, {
        ownerId: OWNER_ID,
        trialId: hearing.trial.trialId,
      }),
    );
    const second = CourtRecordsViewSchema.parse(
      await backend.action(readRecordsReference, {
        ownerId: OWNER_ID,
        trialId: hearing.trial.trialId,
      }),
    );

    expect(second).toEqual(first);
    expect(first.summary).toMatchObject({
      trialId: hearing.trial.trialId,
      caseId: "case_redwood_signal_v1",
      stateVersion: hearing.trial.version,
      lastEventId: hearing.trial.lastEventId,
      modelCallCount: 0,
      hasFinalDebrief: false,
    });
    expect(first.eventTree.nodes).toHaveLength(hearing.trial.version);
    expect(first.modelCalls).toEqual([]);
    expect(first.audio).toMatchObject({
      availability: "not_recorded",
      retentionPolicy: "metadata_only_raw_audio_not_stored",
      entries: [],
    });
    expect(first.replayIntegrity).toMatchObject({
      status: "verified",
      eventCount: hearing.trial.version,
      firstSequence: 1,
      lastSequence: hearing.trial.version,
    });
    expect(first.replayIntegrity.privacySafeProjectionHash).toMatch(
      /^[a-f0-9]{64}$/u,
    );

    const serialized = JSON.stringify(first);
    for (const forbidden of [
      '"payload"',
      '"caseGraph"',
      '"modelMetadata"',
      '"artifactJson"',
      '"eventJsons"',
      '"eventStreamSha256"',
      '"stateJson"',
      '"stateSha256"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects cross-owner reads before graph or audit data is returned", async () => {
    const backend = convexTest(schema, modules);
    const hearing = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(startRequest()),
      }),
    );

    await expect(
      backend.action(readRecordsReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: hearing.trial.trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
  });

  it("includes only metadata from an owner-bound local speech observation", async () => {
    const backend = convexTest(schema, modules);
    const hearing = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(startRequest()),
      }),
    );
    let nowEpochMs = 1_000;
    const preparer = createHearingAudioAuditPreparer({
      clock: { nowEpochMs: () => nowEpochMs },
    });
    preparer.consume(
      freezeHearingPerformanceEvent({
        schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
        type: "user_speech_started",
        generation: 1,
        utteranceId: "utterance:records:1",
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
        utteranceId: "utterance:records:1",
        sceneActor: "user_counsel",
        mode: "question",
        observedAtMs: 135,
        timestampSource: "speech_service",
        reason: "vad_end",
      }),
    );
    const record = preparer.flush()[0];
    if (record === undefined) throw new Error("Missing audio record fixture");
    await backend.mutation(recordAudioReference, {
      ownerId: OWNER_ID,
      trialId: hearing.trial.trialId,
      recordJson: JSON.stringify(record),
    });

    const view = CourtRecordsViewSchema.parse(
      await backend.action(readRecordsReference, {
        ownerId: OWNER_ID,
        trialId: hearing.trial.trialId,
      }),
    );
    expect(view.audio.availability).toBe("metadata_available");
    expect(view.audio.entries).toEqual([
      expect.objectContaining({
        record: expect.objectContaining({
          kind: "user_speech",
          mode: "question",
          aggregateDurationMs: 125,
        }),
        rawAudioRetained: false,
        canonicalBinding: {
          status: "local_observation",
          turnId: null,
          interruptId: null,
        },
      }),
    ]);
    const serialized = JSON.stringify(view.audio);
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("audioBytes");
  });

  it("fails closed when the durable projection diverges from canonical replay", async () => {
    const backend = convexTest(schema, modules);
    const hearing = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(startRequest()),
      }),
    );
    await backend.run(async (ctx) => {
      const projection = await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", hearing.trial.trialId),
        )
        .unique();
      if (projection === null) throw new Error("Missing projection fixture");
      const state = JSON.parse(projection.stateJson) as Record<string, unknown>;
      await ctx.db.patch(projection._id, {
        stateJson: JSON.stringify({ ...state, status: "failed" }),
      });
    });

    await expect(
      backend.action(readRecordsReference, {
        ownerId: OWNER_ID,
        trialId: hearing.trial.trialId,
      }),
    ).rejects.toThrow("TRIAL_PROJECTION_MISMATCH");
  });
});
