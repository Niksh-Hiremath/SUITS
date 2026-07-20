import { describe, expect, it } from "vitest";

import {
  HEARING_AUDIO_AUDIT_MAX_EPOCH_MS,
  HEARING_AUDIO_AUDIT_AUTHORITY,
  HEARING_AUDIO_AUDIT_SCHEMA_VERSION,
  HEARING_AUDIO_AUDIT_SOURCE,
  HearingAudioAuditRecordSchema,
  createHearingAudioAuditPreparer,
} from "./hearing-audio-audit";
import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
  type HearingPerformanceEvent,
} from "./hearing-performance";

type PlaybackCommon = Omit<
  Extract<HearingPerformanceEvent, { type: "playback_requested" }>,
  "type"
>;
type TimingMark = Extract<
  HearingPerformanceEvent,
  { type: "timing_scheduled" }
>["marks"][number];

const basePlayback: PlaybackCommon = {
  schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  generation: 3,
  playbackFence: 7,
  jobId: "job:7",
  responseId: "response:4",
  actor: "actor.witness.rina",
  sequence: 0,
  sceneActor: "witness",
  purpose: "testimony",
  turnId: "turn:testimony:7",
  interruptId: null,
};

function requested(overrides: Partial<PlaybackCommon> = {}) {
  return freezeHearingPerformanceEvent({
    type: "playback_requested",
    ...basePlayback,
    ...overrides,
  });
}

function started(overrides: Partial<PlaybackCommon> = {}) {
  return freezeHearingPerformanceEvent({
    type: "playback_started",
    ...basePlayback,
    ...overrides,
  });
}

function timing(
  marks: readonly TimingMark[],
  overrides: Partial<PlaybackCommon> = {},
) {
  return freezeHearingPerformanceEvent({
    type: "timing_scheduled",
    ...basePlayback,
    ...overrides,
    audioClockTimeSeconds: 5,
    marks: [...marks],
  });
}

function terminal(
  overrides: Partial<PlaybackCommon> = {},
  status: "completed" | "cancelled" | "failed" | "superseded" = "completed",
  reason:
    | "completed"
    | "barge_in"
    | "courtroom_action"
    | "interruption_stale"
    | "playback_failed"
    | "service_cancelled"
    | "controller_closed"
    | "superseded" = "completed",
) {
  return freezeHearingPerformanceEvent({
    type: "playback_terminal",
    ...basePlayback,
    ...overrides,
    status,
    reason,
  });
}

function userStarted(
  generation = 4,
  utteranceId = "utterance:4",
  mode: "question" | "closing" = "question",
) {
  return freezeHearingPerformanceEvent({
    schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
    type: "user_speech_started",
    generation,
    utteranceId,
    sceneActor: "user_counsel",
    mode,
    observedAtMs: 100,
    timestampSource: "speech_service",
  });
}

function userEnded(
  generation = 4,
  utteranceId = "utterance:4",
  mode: "question" | "closing" = "question",
  reason:
    | "client_end"
    | "vad_end"
    | "final_received"
    | "cancelled"
    | "disconnect" = "vad_end",
  timestampSource: "speech_service" | "controller" = "speech_service",
) {
  return freezeHearingPerformanceEvent({
    schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
    type: "user_speech_ended",
    generation,
    utteranceId,
    sceneActor: "user_counsel",
    mode,
    observedAtMs: 500,
    timestampSource,
    reason,
  });
}

function controlledClock(initial = 1_000) {
  let now = initial;
  return {
    clock: { nowEpochMs: () => now },
    set(value: number) {
      now = value;
    },
  };
}

const marks: readonly TimingMark[] = [
  {
    kind: "phrase",
    value: "PRIVATE PHRASE MUST NOT PERSIST",
    startMs: 0,
    endMs: 400,
    audioStartTimeSeconds: 5,
    audioEndTimeSeconds: 5.4,
  },
  {
    kind: "word",
    value: "secret-word",
    startMs: 20,
    endMs: 180,
    audioStartTimeSeconds: 5.02,
    audioEndTimeSeconds: 5.18,
  },
  {
    kind: "viseme",
    value: "private-viseme-value",
    startMs: 25,
    endMs: 90,
    audioStartTimeSeconds: 5.025,
    audioEndTimeSeconds: 5.09,
  },
];

describe("privacy-safe hearing audio audit preparation", () => {
  it("emits one strict aggregate only after playback terminal", () => {
    const time = controlledClock(1_000);
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });

    expect(preparer.consume(requested())).toBe("accepted");
    time.set(1_020);
    expect(preparer.consume(started())).toBe("accepted");
    time.set(1_030);
    expect(preparer.consume(timing(marks))).toBe("accepted");
    time.set(1_040);
    expect(preparer.consume(timing(marks))).toBe("duplicate");
    expect(preparer.flush()).toEqual([]);

    time.set(1_500);
    expect(preparer.consume(terminal())).toBe("record_ready");
    const records = preparer.flush();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      schemaVersion: HEARING_AUDIO_AUDIT_SCHEMA_VERSION,
      observationSource: HEARING_AUDIO_AUDIT_SOURCE,
      authority: HEARING_AUDIO_AUDIT_AUTHORITY,
      kind: "playback",
      sceneActor: "witness",
      purpose: "testimony",
      observedAtEpochMs: 1_000,
      requestedAtEpochMs: 1_000,
      startedAtEpochMs: 1_020,
      endedAtEpochMs: 1_500,
      aggregateDurationMs: 480,
      timingEventCount: 1,
      markCount: 3,
      markKinds: ["phrase", "word", "viseme"],
      markCounts: { phrase: 1, word: 1, viseme: 1 },
      scheduledAudioDurationMs: 400,
      timingTruncated: false,
      terminalStatus: "completed",
      terminalReason: "completed",
      terminalTimestampSource: "client_observed",
    });
    expect(records[0]?.recordId).toMatch(/^[a-f0-9]{64}$/u);
    expect(records[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(HearingAudioAuditRecordSchema.safeParse(records[0]).success).toBe(true);
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);
  });

  it("never serializes timing-mark values, transcript fields, audio, PCM, or provider errors", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    preparer.consume(requested({ purpose: "transcript" }));
    time.set(1_010);
    preparer.consume(started({ purpose: "transcript" }));
    time.set(1_020);
    preparer.consume(timing(marks, { purpose: "transcript" }));
    time.set(1_030);
    preparer.consume(
      terminal({ purpose: "transcript" }, "failed", "playback_failed"),
    );

    const serialized = JSON.stringify(preparer.flush());
    for (const forbidden of [
      "PRIVATE PHRASE",
      "secret-word",
      "private-viseme-value",
      "rawPcm",
      "audioBytes",
      "providerError",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    const record = JSON.parse(serialized)[0] as Record<string, unknown>;
    expect(record.purpose).toBe("transcript");
    for (const forbiddenKey of [
      "text",
      "transcript",
      "marks",
      "markValues",
      "audio",
      "audioBytes",
      "rawPcm",
      "providerError",
    ]) {
      expect(record).not.toHaveProperty(forbiddenKey);
      expect(
        HearingAudioAuditRecordSchema.safeParse({
          ...record,
          [forbiddenKey]: "sensitive",
        }).success,
      ).toBe(false);
    }
  });

  it("aggregates user speech from start to end with a bounded terminal vocabulary", () => {
    const time = controlledClock(2_000);
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    expect(preparer.consume(userStarted(4, "utterance:4", "closing"))).toBe("accepted");
    time.set(2_450);
    expect(
      preparer.consume(
        userEnded(4, "utterance:4", "closing", "final_received", "controller"),
      ),
    ).toBe("record_ready");

    expect(preparer.flush()).toEqual([
      expect.objectContaining({
        kind: "user_speech",
        sceneActor: "user_counsel",
        mode: "closing",
        observedAtEpochMs: 2_000,
        requestedAtEpochMs: null,
        startedAtEpochMs: 2_000,
        endedAtEpochMs: 2_450,
        aggregateDurationMs: 450,
        terminalStatus: "completed",
        terminalReason: "final_received",
        terminalTimestampSource: "controller",
      }),
    ]);
  });

  it.each([
    ["cancelled", "cancelled"],
    ["disconnect", "failed"],
    ["client_end", "completed"],
  ] as const)("maps user terminal reason %s to %s", (reason, expectedStatus) => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    preparer.consume(userStarted());
    time.set(1_010);
    preparer.consume(userEnded(4, "utterance:4", "question", reason));
    expect(preparer.flush()[0]).toMatchObject({ terminalStatus: expectedStatus });
  });

  it("records terminal-only observations without inventing missing lifecycle phases", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    expect(preparer.consume(userEnded())).toBe("record_ready");
    time.set(1_010);
    expect(preparer.consume(terminal({ playbackFence: 8 }))).toBe("record_ready");

    const [speech, playback] = preparer.flush();
    expect(speech).toMatchObject({
      kind: "user_speech",
      requestedAtEpochMs: null,
      startedAtEpochMs: null,
      aggregateDurationMs: 0,
    });
    expect(playback).toMatchObject({
      kind: "playback",
      requestedAtEpochMs: null,
      startedAtEpochMs: null,
      markCount: 0,
      scheduledAudioDurationMs: null,
      aggregateDurationMs: 0,
    });
  });

  it("makes exact duplicates idempotent before and after completion", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    expect(preparer.consume(requested())).toBe("accepted");
    time.set(1_001);
    expect(preparer.consume(requested())).toBe("duplicate");
    time.set(1_002);
    expect(preparer.consume(terminal())).toBe("record_ready");
    const first = preparer.flush();
    time.set(1_003);
    expect(preparer.consume(terminal())).toBe("duplicate");
    time.set(1_004);
    expect(preparer.consume(requested())).toBe("duplicate");
    expect(preparer.flush()).toEqual([]);
    expect(first).toHaveLength(1);
  });

  it("fences stale playback generations/fences and retires superseded active entries", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    expect(preparer.consume(requested({ playbackFence: 7 }))).toBe("accepted");
    time.set(1_001);
    expect(preparer.consume(requested({ playbackFence: 6, jobId: "job:old" }))).toBe("stale");
    time.set(1_002);
    expect(preparer.consume(requested({ playbackFence: 8, jobId: "job:new" }))).toBe("accepted");
    expect(preparer.activeEntryCount).toBe(1);
    time.set(1_003);
    expect(preparer.consume(terminal({ playbackFence: 7 }))).toBe("stale");
    time.set(1_004);
    expect(preparer.consume(terminal({ playbackFence: 8, jobId: "job:new" }))).toBe("record_ready");
    expect(preparer.flush()).toHaveLength(1);
  });

  it("rejects job and response-sequence identity reuse", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    preparer.consume(requested());
    time.set(1_001);
    expect(preparer.consume(requested({ responseId: "response:other" }))).toBe(
      "identity_conflict",
    );
    time.set(1_002);
    expect(preparer.consume(requested({ jobId: "job:other", purpose: "ruling" }))).toBe(
      "identity_conflict",
    );
  });

  it("fences stale and conflicting user utterance identities", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    preparer.consume(userStarted(4, "utterance:4"));
    time.set(1_001);
    expect(preparer.consume(userStarted(4, "utterance:other"))).toBe("identity_conflict");
    time.set(1_002);
    expect(preparer.consume(userStarted(5, "utterance:5"))).toBe("accepted");
    time.set(1_003);
    expect(preparer.consume(userEnded(4, "utterance:4"))).toBe("stale");
    expect(preparer.activeEntryCount).toBe(1);
  });

  it("bounds active entries and allows a rejected identity to retry after capacity frees", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({
      clock: time.clock,
      maxActiveEntries: 1,
    });
    preparer.consume(requested());
    const second = { jobId: "job:8", responseId: "response:5", sequence: 1 };
    time.set(1_001);
    expect(preparer.consume(requested(second))).toBe("capacity_rejected");
    time.set(1_002);
    preparer.consume(terminal());
    preparer.flush();
    time.set(1_003);
    expect(preparer.consume(requested(second))).toBe("accepted");
    expect(preparer.activeEntryCount).toBe(1);
  });

  it("caps timing events and marks while reporting truncation", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({
      clock: time.clock,
      maxTimingEventsPerPlayback: 1,
      maxTimingMarksPerPlayback: 2,
    });
    preparer.consume(requested());
    time.set(1_001);
    expect(preparer.consume(timing(marks))).toBe("timing_truncated");
    time.set(1_002);
    expect(
      preparer.consume(
        timing([{ ...marks[0], value: "another", audioStartTimeSeconds: 6, audioEndTimeSeconds: 6.4 }]),
      ),
    ).toBe("timing_truncated");
    time.set(1_003);
    preparer.consume(terminal());

    expect(preparer.flush()[0]).toMatchObject({
      timingEventCount: 1,
      markCount: 2,
      markKinds: ["phrase", "word"],
      markCounts: { phrase: 1, word: 1, viseme: 0 },
      timingTruncated: true,
    });
  });

  it("uses explicit flush backpressure and permits terminal retry", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({
      clock: time.clock,
      maxPendingRecords: 1,
    });
    preparer.consume(terminal());
    time.set(1_001);
    const second = { playbackFence: 8, jobId: "job:8", responseId: "response:8" };
    expect(preparer.consume(terminal(second))).toBe("capacity_rejected");
    expect(preparer.pendingRecordCount).toBe(1);
    expect(preparer.flush()).toHaveLength(1);
    time.set(1_002);
    expect(preparer.consume(terminal(second))).toBe("record_ready");
    expect(preparer.flush()).toHaveLength(1);
  });

  it("keeps incomplete entries across flush and clears every fence on reset", () => {
    const time = controlledClock();
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    preparer.consume(requested({ playbackFence: 9 }));
    expect(preparer.flush()).toEqual([]);
    expect(preparer.activeEntryCount).toBe(1);
    preparer.reset();
    expect(preparer.activeEntryCount).toBe(0);
    expect(preparer.pendingRecordCount).toBe(0);
    time.set(500);
    expect(preparer.consume(requested({ playbackFence: 1 }))).toBe("accepted");
  });

  it("derives a stable identity ID and a clock-sensitive content hash", () => {
    const firstTime = controlledClock(1_000);
    const first = createHearingAudioAuditPreparer({ clock: firstTime.clock });
    first.consume(requested());
    firstTime.set(1_100);
    first.consume(terminal());
    const firstRecord = first.flush()[0];

    const secondTime = controlledClock(2_000);
    const second = createHearingAudioAuditPreparer({ clock: secondTime.clock });
    second.consume(requested());
    secondTime.set(2_100);
    second.consume(terminal());
    const secondRecord = second.flush()[0];

    expect(secondRecord?.recordId).toBe(firstRecord?.recordId);
    expect(secondRecord?.contentHash).not.toBe(firstRecord?.contentHash);
    expect(
      HearingAudioAuditRecordSchema.safeParse({
        ...firstRecord,
        endedAtEpochMs: 9_999,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid, regressing clocks and out-of-range bounds", () => {
    expect(
      () =>
        createHearingAudioAuditPreparer({
          clock: { nowEpochMs: () => 0 },
          maxActiveEntries: 33,
        }),
    ).toThrow(RangeError);
    const time = controlledClock(10);
    const preparer = createHearingAudioAuditPreparer({ clock: time.clock });
    preparer.consume(requested());
    time.set(9);
    expect(() => preparer.consume(started())).toThrow(/monotonic/u);
    const invalid = createHearingAudioAuditPreparer({
      clock: { nowEpochMs: () => Number.NaN },
    });
    expect(() => invalid.consume(requested())).toThrow(/nonnegative epoch/u);
    const outsideDateRange = createHearingAudioAuditPreparer({
      clock: { nowEpochMs: () => HEARING_AUDIO_AUDIT_MAX_EPOCH_MS + 1 },
    });
    expect(() => outsideDateRange.consume(requested())).toThrow(/Date range/u);
  });
});
