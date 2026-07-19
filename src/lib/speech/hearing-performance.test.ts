import { describe, expect, it } from "vitest";

import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  HearingPerformanceEventSchema,
  freezeHearingPerformanceEvent,
} from "./hearing-performance";

const identity = {
  schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  generation: 3,
  playbackFence: 7,
  jobId: "job:7",
  responseId: "response:4",
  actor: "actor.opposing_counsel.objection",
  sequence: 0,
  sceneActor: "opposing_counsel" as const,
  purpose: "objection" as const,
  turnId: null,
  interruptId: "interrupt:partial:3:utterance-1:4",
};

describe("hearing performance event contract", () => {
  it("accepts and freezes exact audio-clock timing", () => {
    const event = freezeHearingPerformanceEvent({
      type: "timing_scheduled",
      ...identity,
      audioClockTimeSeconds: 12.5,
      marks: [
        {
          kind: "word",
          value: "Objection",
          startMs: 0,
          endMs: 180,
          audioStartTimeSeconds: 12.55,
          audioEndTimeSeconds: 12.73,
        },
      ],
    });

    expect(Object.isFrozen(event)).toBe(true);
    expect(event.type).toBe("timing_scheduled");
    if (event.type !== "timing_scheduled") throw new Error("wrong event");
    expect(Object.isFrozen(event.marks)).toBe(true);
    expect(Object.isFrozen(event.marks[0])).toBe(true);
  });

  it("allows durable turn identifiers up to the hearing-view limit", () => {
    expect(
      HearingPerformanceEventSchema.safeParse({
        type: "playback_requested",
        ...identity,
        purpose: "testimony",
        turnId: `turn:${"a".repeat(251)}`,
      }).success,
    ).toBe(true);
  });

  it("accepts the maximum derived local interruption identifier", () => {
    const interruptId = `interrupt:partial:${Number.MAX_SAFE_INTEGER}:${"u".repeat(240)}:${Number.MAX_SAFE_INTEGER}`;
    expect(interruptId).toHaveLength(292);
    expect(
      HearingPerformanceEventSchema.safeParse({
        type: "playback_requested",
        ...identity,
        interruptId,
      }).success,
    ).toBe(true);
    expect(
      HearingPerformanceEventSchema.safeParse({
        type: "playback_requested",
        ...identity,
        interruptId: `${interruptId}x`,
      }).success,
    ).toBe(false);
  });

  it("distinguishes service VAD timestamps from controller fallbacks", () => {
    expect(
      HearingPerformanceEventSchema.safeParse({
        schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
        type: "user_speech_started",
        generation: 3,
        utteranceId: "utterance:3",
        sceneActor: "user_counsel",
        mode: "question",
        observedAtMs: 1_000,
        timestampSource: "speech_service",
      }).success,
    ).toBe(true);
    expect(
      HearingPerformanceEventSchema.safeParse({
        schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
        type: "user_speech_ended",
        generation: 3,
        utteranceId: "utterance:3",
        sceneActor: "user_counsel",
        mode: "question",
        observedAtMs: 1_100,
        timestampSource: "controller",
        reason: "final_received",
      }).success,
    ).toBe(true);
    expect(
      HearingPerformanceEventSchema.safeParse({
        schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
        type: "user_speech_started",
        generation: 3,
        utteranceId: "utterance:3",
        sceneActor: "user_counsel",
        mode: "question",
        observedAtMs: 1_000,
        timestampSource: "controller",
      }).success,
    ).toBe(false);
  });

  it("rejects empty timings, invalid terminal pairs, and arbitrary fields", () => {
    expect(
      HearingPerformanceEventSchema.safeParse({
        type: "timing_scheduled",
        ...identity,
        audioClockTimeSeconds: 12.5,
        marks: [],
      }).success,
    ).toBe(false);
    expect(
      HearingPerformanceEventSchema.safeParse({
        type: "playback_terminal",
        ...identity,
        status: "completed",
        reason: "barge_in",
      }).success,
    ).toBe(false);
    expect(
      HearingPerformanceEventSchema.safeParse({
        type: "playback_started",
        ...identity,
        arbitraryThreeProperty: "rotation.x",
      }).success,
    ).toBe(false);
  });
});
