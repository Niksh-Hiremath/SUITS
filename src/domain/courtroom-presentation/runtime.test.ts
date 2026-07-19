import { describe, expect, it } from "vitest";

import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
  type HearingPerformanceEvent,
} from "@/lib/speech/hearing-performance";

import {
  COURTROOM_CAMERA_HYSTERESIS_MS,
  COURTROOM_MAX_ACTIVE_PLAYBACK_CUES,
  COURTROOM_MAX_RETIRED_PLAYBACK_IDENTITIES,
  COURTROOM_MAX_RETIRED_USER_SPEECH_IDENTITIES,
  CourtroomPresentationRuntimeStateSchema,
  advanceCourtroomPresentationRuntime,
  createCourtroomPresentationRuntime,
  rebaseCourtroomPresentationRuntime,
  reduceCourtroomPresentationRuntime,
  resetCourtroomPresentationRuntime,
  selectCourtroomPresentationRuntime,
} from "./runtime";

type RequestedEvent = Extract<
  HearingPerformanceEvent,
  { type: "playback_requested" }
>;
type PlaybackIdentity = Omit<RequestedEvent, "type">;
type IdentityOverrides = Partial<PlaybackIdentity>;

const baseIdentity: PlaybackIdentity = {
  schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  generation: 1,
  playbackFence: 1,
  jobId: "job:base",
  responseId: "response:base",
  actor: "actor:witness",
  sequence: 0,
  sceneActor: "witness",
  purpose: "testimony",
  turnId: "turn:base",
  interruptId: null,
};

function identity(overrides: IdentityOverrides = {}): PlaybackIdentity {
  return { ...baseIdentity, ...overrides };
}

function requested(overrides: IdentityOverrides = {}): HearingPerformanceEvent {
  return freezeHearingPerformanceEvent({
    type: "playback_requested",
    ...identity(overrides),
  });
}

function started(overrides: IdentityOverrides = {}): HearingPerformanceEvent {
  return freezeHearingPerformanceEvent({
    type: "playback_started",
    ...identity(overrides),
  });
}

function timing(
  overrides: IdentityOverrides = {},
  marks: Extract<
    HearingPerformanceEvent,
    { type: "timing_scheduled" }
  >["marks"] = [
    {
      kind: "word",
      value: "answer",
      startMs: 0,
      endMs: 100,
      audioStartTimeSeconds: 1,
      audioEndTimeSeconds: 1.1,
    },
  ],
): HearingPerformanceEvent {
  return freezeHearingPerformanceEvent({
    type: "timing_scheduled",
    ...identity(overrides),
    audioClockTimeSeconds: 0.9,
    marks,
  });
}

function terminal(overrides: IdentityOverrides = {}): HearingPerformanceEvent {
  return freezeHearingPerformanceEvent({
    type: "playback_terminal",
    ...identity(overrides),
    status: "completed",
    reason: "completed",
  });
}

function userStarted(
  generation = 1,
  utteranceId = "utterance:user",
): HearingPerformanceEvent {
  return freezeHearingPerformanceEvent({
    type: "user_speech_started",
    schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
    generation,
    utteranceId,
    sceneActor: "user_counsel",
    mode: "question",
    observedAtMs: 10,
    timestampSource: "speech_service",
  });
}

function userEnded(
  generation = 1,
  utteranceId = "utterance:user",
): HearingPerformanceEvent {
  return freezeHearingPerformanceEvent({
    type: "user_speech_ended",
    schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
    generation,
    utteranceId,
    sceneActor: "user_counsel",
    mode: "question",
    observedAtMs: 20,
    timestampSource: "speech_service",
    reason: "vad_end",
  });
}

describe("courtroom presentation runtime", () => {
  it("creates a strict, deeply immutable base state and snapshot", () => {
    const state = createCourtroomPresentationRuntime({
      baseFocus: "witness",
      observedAtMs: 12,
    });
    const snapshot = selectCourtroomPresentationRuntime(state);

    expect(snapshot).toMatchObject({
      source: "base",
      sceneActor: "witness",
      priority: 0,
      mouthShape: "rest",
      camera: { target: "witness", transition: "cut" },
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.camera)).toBe(true);
    expect(Object.isFrozen(state.playbackCues)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.mouthCues)).toBe(true);
    expect(Reflect.set(state.camera, "target", "judge")).toBe(false);
    expect(() =>
      CourtroomPresentationRuntimeStateSchema.parse({ ...state, extra: true }),
    ).toThrow();
    expect(() =>
      CourtroomPresentationRuntimeStateSchema.parse({
        ...state,
        camera: { ...state.camera, extra: true },
      }),
    ).toThrow();
  });

  it("lets a request establish posture and focus without moving the mouth", () => {
    let state = createCourtroomPresentationRuntime({ baseFocus: "witness" });
    const objection = {
      jobId: "job:objection",
      responseId: "response:objection",
      actor: "actor:opposing",
      sceneActor: "opposing_counsel" as const,
      purpose: "objection" as const,
      interruptId: "interrupt:1",
    };
    state = reduceCourtroomPresentationRuntime(
      state,
      requested(objection),
      10,
    );

    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      source: "playback",
      sceneActor: "opposing_counsel",
      priority: 6,
      animation: "objecting",
      posture: "standing",
      mouthShape: "rest",
      playback: { phase: "requested" },
      camera: { target: "opposing_counsel", transition: "blend" },
    });

    state = reduceCourtroomPresentationRuntime(state, started(objection), 11);
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      animation: "objecting",
      mouthShape: "open",
      playback: { phase: "started" },
    });
  });

  it("normalizes visemes to shape-only absolute cues and never retains words", () => {
    const playback = {
      jobId: "job:timed",
      responseId: "response:timed",
      actor: "actor:judge",
      sceneActor: "judge" as const,
      purpose: "ruling" as const,
      interruptId: "interrupt:timed",
    };
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(
      state,
      requested(playback),
      1,
    );
    state = reduceCourtroomPresentationRuntime(state, started(playback), 2);
    state = reduceCourtroomPresentationRuntime(
      state,
      timing(playback, [
        {
          kind: "phrase",
          value: "TOP SECRET PHRASE",
          startMs: 0,
          endMs: 300,
          audioStartTimeSeconds: 5,
          audioEndTimeSeconds: 5.3,
        },
        {
          kind: "word",
          value: "CONFIDENTIAL-WORD",
          startMs: 0,
          endMs: 300,
          audioStartTimeSeconds: 5,
          audioEndTimeSeconds: 5.3,
        },
        {
          kind: "viseme",
          value: "PP",
          startMs: 0,
          endMs: 100,
          audioStartTimeSeconds: 5,
          audioEndTimeSeconds: 5.1,
        },
        {
          kind: "viseme",
          value: "aa",
          startMs: 100,
          endMs: 200,
          audioStartTimeSeconds: 5.1,
          audioEndTimeSeconds: 5.2,
        },
      ]),
      1_000,
    );

    expect(selectCourtroomPresentationRuntime(state, 5_150)).toMatchObject({
      mouthShape: "closed",
      mouthCues: [
        { shape: "closed", startAtMs: 5_100, endAtMs: 5_200 },
        { shape: "open", startAtMs: 5_200, endAtMs: 5_300 },
      ],
    });
    expect(selectCourtroomPresentationRuntime(state, 5_250).mouthShape).toBe(
      "open",
    );
    expect(selectCourtroomPresentationRuntime(state, 5_350).mouthShape).toBe(
      "rest",
    );
    expect(JSON.stringify(state)).not.toMatch(
      /TOP SECRET|CONFIDENTIAL|"PP"|"aa"/u,
    );
    expect(Object.isFrozen(state.playbackCues[0]?.mouthCues[0])).toBe(true);
  });

  it("derives every renderer mouth shape from word timings", () => {
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(state, requested(), 1);
    state = reduceCourtroomPresentationRuntime(state, started(), 2);
    state = reduceCourtroomPresentationRuntime(
      state,
      timing({}, [
        {
          kind: "word",
          value: "map",
          startMs: 0,
          endMs: 10,
          audioStartTimeSeconds: 1,
          audioEndTimeSeconds: 1.1,
        },
        {
          kind: "word",
          value: "book",
          startMs: 10,
          endMs: 20,
          audioStartTimeSeconds: 1.1,
          audioEndTimeSeconds: 1.2,
        },
        {
          kind: "word",
          value: "myth",
          startMs: 20,
          endMs: 30,
          audioStartTimeSeconds: 1.2,
          audioEndTimeSeconds: 1.3,
        },
        {
          kind: "word",
          value: "bmp",
          startMs: 30,
          endMs: 40,
          audioStartTimeSeconds: 1.3,
          audioEndTimeSeconds: 1.4,
        },
        {
          kind: "word",
          value: "shh",
          startMs: 40,
          endMs: 50,
          audioStartTimeSeconds: 1.4,
          audioEndTimeSeconds: 1.5,
        },
        {
          kind: "word",
          value: "...",
          startMs: 50,
          endMs: 60,
          audioStartTimeSeconds: 1.5,
          audioEndTimeSeconds: 1.6,
        },
      ]),
      3,
    );

    expect(state.playbackCues[0]?.mouthCues.map(({ shape }) => shape)).toEqual([
      "open",
      "round",
      "wide",
      "closed",
      "narrow",
      "rest",
    ]);
  });

  it("applies the complete semantic priority ladder", () => {
    let state = createCourtroomPresentationRuntime({ baseFocus: "judge" });
    const add = (overrides: IdentityOverrides, atMs: number) => {
      state = reduceCourtroomPresentationRuntime(
        state,
        requested(overrides),
        atMs,
      );
      return selectCourtroomPresentationRuntime(state);
    };

    expect(
      add(
        {
          jobId: "job:test",
          responseId: "response:test",
          sceneActor: "clerk",
          purpose: "speaker_test",
        },
        1,
      ).priority,
    ).toBe(1);
    expect(
      add(
        {
          jobId: "job:dialogue",
          responseId: "response:dialogue",
          purpose: "transcript",
        },
        2,
      ).priority,
    ).toBe(2);
    state = reduceCourtroomPresentationRuntime(state, userStarted(), 3);
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      source: "user_speech",
      priority: 3,
    });
    expect(
      add(
        {
          jobId: "job:resumed",
          responseId: "response:resumed",
          purpose: "testimony",
          interruptId: "interrupt:resumed",
        },
        4,
      ).priority,
    ).toBe(4);
    expect(
      add(
        {
          jobId: "job:correction",
          responseId: "response:correction",
          actor: "actor:clerk",
          sceneActor: "clerk",
          purpose: "correction",
        },
        5,
      ).priority,
    ).toBe(5);
    expect(
      add(
        {
          jobId: "job:objection",
          responseId: "response:objection",
          actor: "actor:opposing",
          sceneActor: "opposing_counsel",
          purpose: "objection",
        },
        6,
      ).priority,
    ).toBe(6);
    expect(
      add(
        {
          jobId: "job:ruling",
          responseId: "response:ruling",
          actor: "actor:judge",
          sceneActor: "judge",
          purpose: "ruling",
        },
        7,
      ).priority,
    ).toBe(7);
  });

  it("fences updates and terminals against every playback identity field", () => {
    const exact = {
      generation: 7,
      playbackFence: 9,
      jobId: "job:exact",
      responseId: "response:exact",
      actor: "actor:judge",
      sequence: 4,
      sceneActor: "judge" as const,
      purpose: "ruling" as const,
      turnId: "turn:exact",
      interruptId: "interrupt:exact",
    };
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(state, requested(exact), 1);
    state = reduceCourtroomPresentationRuntime(state, started(exact), 2);

    const mismatches: IdentityOverrides[] = [
      { ...exact, generation: 6 },
      { ...exact, playbackFence: 8 },
      { ...exact, jobId: "job:other" },
      { ...exact, responseId: "response:other" },
      { ...exact, actor: "actor:other" },
      { ...exact, sequence: 5 },
      { ...exact, sceneActor: "clerk" },
      { ...exact, purpose: "correction" },
      { ...exact, turnId: "turn:other" },
      { ...exact, interruptId: "interrupt:other" },
    ];
    for (const mismatch of mismatches) {
      state = reduceCourtroomPresentationRuntime(
        state,
        timing(mismatch),
        3,
      );
      state = reduceCourtroomPresentationRuntime(
        state,
        terminal(mismatch),
        3,
      );
      expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
        sceneActor: "judge",
        priority: 7,
        playback: { phase: "started" },
      });
    }

    state = reduceCourtroomPresentationRuntime(state, terminal(exact), 4);
    expect(selectCourtroomPresentationRuntime(state).source).toBe("base");
  });

  it("uses a monotonic playback fence even after exact tombstones expire", () => {
    const current = {
      generation: 10,
      playbackFence: 10,
      jobId: "job:current",
      responseId: "response:current",
      actor: "actor:witness",
      sceneActor: "witness" as const,
      purpose: "testimony" as const,
    };
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(state, requested(current), 1);

    const beforeStale = state;
    state = reduceCourtroomPresentationRuntime(
      state,
      requested({
        generation: 9,
        playbackFence: 99,
        jobId: "job:stale-ruling",
        responseId: "response:stale-ruling",
        actor: "actor:judge",
        sceneActor: "judge",
        purpose: "ruling",
      }),
      2,
    );
    expect(state).toBe(beforeStale);
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      sceneActor: "witness",
      priority: 2,
    });

    state = reduceCourtroomPresentationRuntime(
      state,
      terminal({
        ...current,
        playbackFence: 11,
        jobId: "job:new-terminal",
        responseId: "response:new-terminal",
      }),
      3,
    );
    expect(state.playbackHighWater).toEqual({
      generation: 10,
      playbackFence: 11,
    });
    expect(state.playbackCues).toHaveLength(0);

    for (
      let offset = 0;
      offset < COURTROOM_MAX_RETIRED_PLAYBACK_IDENTITIES + 4;
      offset += 1
    ) {
      state = reduceCourtroomPresentationRuntime(
        state,
        terminal({
          generation: 10,
          playbackFence: 12 + offset,
          jobId: `job:newer:${offset}`,
          responseId: `response:newer:${offset}`,
          sequence: offset,
        }),
        4 + offset,
      );
    }
    expect(
      state.retiredPlaybackIdentities.some(
        ({ jobId }) => jobId === current.jobId,
      ),
    ).toBe(false);

    const afterExpiry = state;
    state = reduceCourtroomPresentationRuntime(
      state,
      requested(current),
      1_000,
    );
    expect(state).toBe(afterExpiry);
    expect(state.playbackCues).toHaveLength(0);
  });

  it("tombstones terminal identities so late events cannot resurrect them", () => {
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(state, requested(), 1);
    state = reduceCourtroomPresentationRuntime(state, terminal(), 2);
    state = reduceCourtroomPresentationRuntime(state, timing(), 2);
    state = reduceCourtroomPresentationRuntime(state, started(), 2);
    state = reduceCourtroomPresentationRuntime(state, requested(), 2);

    expect(state.playbackCues).toHaveLength(0);
    expect(state.retiredPlaybackIdentities).toHaveLength(1);
    expect(selectCourtroomPresentationRuntime(state).source).toBe("base");

    let terminalFirst = createCourtroomPresentationRuntime();
    terminalFirst = reduceCourtroomPresentationRuntime(
      terminalFirst,
      terminal(),
      1,
    );
    terminalFirst = reduceCourtroomPresentationRuntime(
      terminalFirst,
      requested(),
      2,
    );
    expect(terminalFirst.playbackCues).toHaveLength(0);
  });

  it("clears only the exact terminal cue and reveals the next priority", () => {
    const dialogue = {
      jobId: "job:dialogue",
      responseId: "response:dialogue",
      purpose: "transcript" as const,
    };
    const ruling = {
      jobId: "job:ruling",
      responseId: "response:ruling",
      actor: "actor:judge",
      sceneActor: "judge" as const,
      purpose: "ruling" as const,
    };
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(state, requested(dialogue), 1);
    state = reduceCourtroomPresentationRuntime(state, requested(ruling), 2);
    state = reduceCourtroomPresentationRuntime(
      state,
      terminal({ ...dialogue, sequence: 99 }),
      3,
    );
    expect(selectCourtroomPresentationRuntime(state).priority).toBe(7);

    state = reduceCourtroomPresentationRuntime(state, terminal(ruling), 4);
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      sceneActor: "witness",
      priority: 2,
    });
    expect(state.playbackCues).toHaveLength(1);
  });

  it("keeps duplicate requests and timings idempotent without downgrading", () => {
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(state, requested(), 1);
    state = reduceCourtroomPresentationRuntime(state, started(), 2);
    state = reduceCourtroomPresentationRuntime(state, timing(), 3);
    state = reduceCourtroomPresentationRuntime(state, requested(), 4);
    state = reduceCourtroomPresentationRuntime(state, timing(), 3);

    expect(state.playbackCues).toHaveLength(1);
    expect(state.playbackCues[0]).toMatchObject({
      phase: "timed",
      mouthCues: [{ shape: "open" }],
    });
  });

  it("fences VAD end events and replaces speech only with a newer generation", () => {
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(
      state,
      userStarted(2, "utterance:new"),
      1,
    );
    state = reduceCourtroomPresentationRuntime(
      state,
      userStarted(1, "utterance:old"),
      2,
    );
    state = reduceCourtroomPresentationRuntime(
      state,
      userEnded(1, "utterance:old"),
      3,
    );
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      source: "user_speech",
      sceneActor: "user_counsel",
      priority: 3,
      mouthShape: "open",
    });

    state = reduceCourtroomPresentationRuntime(
      state,
      userEnded(2, "utterance:new"),
      4,
    );
    state = reduceCourtroomPresentationRuntime(
      state,
      userStarted(2, "utterance:new"),
      5,
    );
    expect(selectCourtroomPresentationRuntime(state).source).toBe("base");

    state = reduceCourtroomPresentationRuntime(
      state,
      userStarted(1, "utterance:delayed"),
      6,
    );
    expect(selectCourtroomPresentationRuntime(state).source).toBe("base");

    state = reduceCourtroomPresentationRuntime(
      state,
      userStarted(2, "utterance:sequential"),
      7,
    );
    expect(selectCourtroomPresentationRuntime(state).source).toBe(
      "user_speech",
    );
    expect(state.highestUserSpeechGeneration).toBe(2);

    state = reduceCourtroomPresentationRuntime(
      state,
      userStarted(3, "utterance:newest"),
      8,
    );
    expect(state.userSpeech?.identity.utteranceId).toBe("utterance:newest");
    expect(state.highestUserSpeechGeneration).toBe(3);
  });

  it("holds the return to base focus through camera hysteresis", () => {
    const opposing = {
      jobId: "job:opposing",
      responseId: "response:opposing",
      actor: "actor:opposing",
      sceneActor: "opposing_counsel" as const,
      purpose: "transcript" as const,
    };
    let state = createCourtroomPresentationRuntime({ baseFocus: "judge" });
    state = reduceCourtroomPresentationRuntime(state, requested(opposing), 0);
    state = reduceCourtroomPresentationRuntime(state, terminal(opposing), 10);

    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      source: "base",
      sceneActor: "judge",
      camera: {
        target: "opposing_counsel",
        pending: { target: "judge", sinceMs: 10 },
      },
    });
    state = advanceCourtroomPresentationRuntime(
      state,
      10 + COURTROOM_CAMERA_HYSTERESIS_MS - 1,
    );
    expect(state.camera.target).toBe("opposing_counsel");
    state = advanceCourtroomPresentationRuntime(
      state,
      10 + COURTROOM_CAMERA_HYSTERESIS_MS,
    );
    expect(state.camera).toMatchObject({
      target: "judge",
      transition: "blend",
      pending: null,
    });
  });

  it("lets higher-priority interruptions preempt the camera immediately", () => {
    const dialogue = {
      jobId: "job:dialogue",
      responseId: "response:dialogue",
      actor: "actor:opposing",
      sceneActor: "opposing_counsel" as const,
      purpose: "transcript" as const,
    };
    const ruling = {
      jobId: "job:ruling",
      responseId: "response:ruling",
      actor: "actor:judge",
      sceneActor: "judge" as const,
      purpose: "ruling" as const,
    };
    let state = createCourtroomPresentationRuntime({ baseFocus: "witness" });
    state = reduceCourtroomPresentationRuntime(state, requested(dialogue), 1);
    state = reduceCourtroomPresentationRuntime(state, requested(ruling), 2);
    expect(state.camera).toMatchObject({
      target: "judge",
      targetPriority: 7,
      pending: null,
    });

    state = reduceCourtroomPresentationRuntime(state, terminal(ruling), 3);
    expect(state.camera).toMatchObject({
      target: "judge",
      targetPriority: 7,
      pending: {
        target: "opposing_counsel",
        priority: 2,
        sinceMs: 3,
      },
    });
    state = advanceCourtroomPresentationRuntime(
      state,
      3 + COURTROOM_CAMERA_HYSTERESIS_MS - 1,
    );
    expect(state.camera.target).toBe("judge");
    state = advanceCourtroomPresentationRuntime(
      state,
      3 + COURTROOM_CAMERA_HYSTERESIS_MS,
    );
    expect(state.camera).toMatchObject({
      target: "opposing_counsel",
      targetPriority: 2,
      pending: null,
    });
  });

  it("uses camera cuts and a static narrow mouth under reduced motion", () => {
    const first = {
      jobId: "job:first",
      responseId: "response:first",
      actor: "actor:opposing",
      sceneActor: "opposing_counsel" as const,
      purpose: "transcript" as const,
    };
    let state = createCourtroomPresentationRuntime({ reducedMotion: true });
    state = reduceCourtroomPresentationRuntime(state, requested(first), 1);
    state = reduceCourtroomPresentationRuntime(state, started(first), 2);
    expect(state.camera).toMatchObject({
      target: "opposing_counsel",
      transition: "cut",
    });
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      mouthShape: "narrow",
      animation: "speaking",
    });
    state = reduceCourtroomPresentationRuntime(state, terminal(first), 3);
    expect(state.camera).toMatchObject({
      target: "opposing_counsel",
      transition: "cut",
      pending: { target: null },
    });
    state = advanceCourtroomPresentationRuntime(
      state,
      3 + COURTROOM_CAMERA_HYSTERESIS_MS,
    );
    expect(state.camera).toMatchObject({ target: null, transition: "cut" });
  });

  it("rebases durable focus without losing live cues and resets explicitly", () => {
    let state = createCourtroomPresentationRuntime({ baseFocus: "witness" });
    state = reduceCourtroomPresentationRuntime(state, requested(), 1);
    state = reduceCourtroomPresentationRuntime(state, terminal(), 2);
    state = rebaseCourtroomPresentationRuntime(state, {
      baseFocus: "jury",
      reducedMotion: true,
      observedAtMs: 3,
    });

    expect(state.baseFocus).toBe("jury");
    expect(state.reducedMotion).toBe(true);
    expect(state.retiredPlaybackIdentities).toHaveLength(1);
    expect(state.camera.transition).toBe("cut");

    const reset = resetCourtroomPresentationRuntime({
      baseFocus: "jury",
      reducedMotion: true,
      observedAtMs: 4,
    });
    expect(reset).toMatchObject({
      revision: 0,
      playbackCues: [],
      retiredPlaybackIdentities: [],
      userSpeech: null,
      camera: { target: "jury", transition: "cut" },
    });
  });

  it("ignores timing until the exact cue has audibly started", () => {
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(state, requested(), 1);
    state = reduceCourtroomPresentationRuntime(state, timing(), 2);
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      mouthShape: "rest",
      playback: { phase: "requested" },
    });
    expect(state.playbackCues[0]?.mouthCues).toEqual([]);

    state = reduceCourtroomPresentationRuntime(state, started(), 3);
    state = reduceCourtroomPresentationRuntime(state, timing(), 4);
    expect(selectCourtroomPresentationRuntime(state, 104).mouthShape).toBe(
      "open",
    );
  });

  it("bounds active cues and both terminal identity windows", () => {
    let active = createCourtroomPresentationRuntime();
    for (let index = 0; index < COURTROOM_MAX_ACTIVE_PLAYBACK_CUES + 8; index += 1) {
      active = reduceCourtroomPresentationRuntime(
        active,
        requested({
          jobId: `job:active:${index}`,
          responseId: `response:active:${index}`,
          sequence: index,
        }),
        index,
      );
    }
    expect(active.playbackCues).toHaveLength(
      COURTROOM_MAX_ACTIVE_PLAYBACK_CUES,
    );

    let retired = createCourtroomPresentationRuntime();
    for (
      let index = 0;
      index < COURTROOM_MAX_RETIRED_PLAYBACK_IDENTITIES + 16;
      index += 1
    ) {
      retired = reduceCourtroomPresentationRuntime(
        retired,
        terminal({
          jobId: `job:retired:${index}`,
          responseId: `response:retired:${index}`,
          sequence: index,
        }),
        index,
      );
    }
    expect(retired.retiredPlaybackIdentities).toHaveLength(
      COURTROOM_MAX_RETIRED_PLAYBACK_IDENTITIES,
    );

    let speech = createCourtroomPresentationRuntime();
    for (
      let index = 0;
      index < COURTROOM_MAX_RETIRED_USER_SPEECH_IDENTITIES + 8;
      index += 1
    ) {
      speech = reduceCourtroomPresentationRuntime(
        speech,
        userEnded(index, `utterance:${index}`),
        index,
      );
    }
    expect(speech.retiredUserSpeechIdentities).toHaveLength(
      COURTROOM_MAX_RETIRED_USER_SPEECH_IDENTITIES,
    );
  });

  it("rejects invalid monotonic observation values", () => {
    const state = createCourtroomPresentationRuntime();
    expect(() =>
      reduceCourtroomPresentationRuntime(state, requested(), Number.NaN),
    ).toThrow(RangeError);
    expect(() => advanceCourtroomPresentationRuntime(state, -1)).toThrow(
      RangeError,
    );
    expect(() => selectCourtroomPresentationRuntime(state, Infinity)).toThrow(
      RangeError,
    );
  });
});
