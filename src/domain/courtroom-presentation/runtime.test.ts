import { describe, expect, it } from "vitest";

import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
  type HearingPerformanceEvent,
} from "@/lib/speech/hearing-performance";

import {
  COURTROOM_CAMERA_HYSTERESIS_MS,
  COURTROOM_DISPLAY_TRANSITION_MS,
  COURTROOM_GAVEL_PHASE_MS,
  COURTROOM_MAX_ACTIVE_PLAYBACK_CUES,
  COURTROOM_MAX_RETIRED_PLAYBACK_IDENTITIES,
  COURTROOM_MAX_RETIRED_USER_SPEECH_IDENTITIES,
  CourtroomPresentationRuntimeStateSchema,
  advanceCourtroomPresentationRuntime,
  courtroomRuntimeAnnouncementText,
  createCourtroomPresentationRuntime,
  nextCourtroomPresentationWakeAt,
  rebaseCourtroomPresentationRuntime,
  reduceCourtroomPresentationRuntime,
  resetCourtroomPresentationRuntime,
  selectCourtroomPresentationRuntime,
} from "./runtime";
import {
  CourtroomDisplayDescriptorSchema,
  type CourtroomDisplayDescriptor,
  type CourtroomPresentationHead,
} from "./schema";

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

const idleDisplay = CourtroomDisplayDescriptorSchema.parse({
  mode: "idle",
  itemId: null,
  label: null,
  status: null,
});

function evidenceDisplay(
  status: "uploaded" | "indexed" | "offered" | "admitted" | "excluded" | "withdrawn" =
    "offered",
  itemId = "evidence:ledger",
): CourtroomDisplayDescriptor {
  return CourtroomDisplayDescriptorSchema.parse({
    mode: "evidence",
    itemId,
    label: "Ledger excerpt",
    status,
  });
}

function settlementDisplay(
  status: "open" | "countered" | "accepted" | "rejected" | "withdrawn" | "expired" =
    "open",
  itemId = "offer:private",
): CourtroomDisplayDescriptor {
  return CourtroomDisplayDescriptorSchema.parse({
    mode: "settlement",
    itemId,
    label: "Private settlement conference",
    status,
  });
}

function presentationHead(
  stateVersion: number,
  lastEventId = `event:${stateVersion}`,
  trialId = "trial:presentation",
): CourtroomPresentationHead {
  return { trialId, stateVersion, lastEventId };
}

function rebaseDisplay(
  state: ReturnType<typeof createCourtroomPresentationRuntime>,
  baseDisplay: CourtroomDisplayDescriptor,
  displayHead: CourtroomPresentationHead,
  observedAtMs: number,
  reducedMotion = state.reducedMotion,
) {
  return rebaseCourtroomPresentationRuntime(state, {
    baseFocus: state.baseFocus,
    baseCameraShot: state.baseCameraShot,
    baseDisplay,
    displayHead,
    reducedMotion,
    observedAtMs,
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
    let state = createCourtroomPresentationRuntime({
      baseFocus: "witness",
      baseCameraShot: "witness_counsel_two_shot",
    });
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

  it("holds a same-actor close-up before returning to its base shot", () => {
    const testimony = {
      jobId: "job:witness-close",
      responseId: "response:witness-close",
      actor: "actor:witness",
      sceneActor: "witness" as const,
      purpose: "testimony" as const,
    };
    let state = createCourtroomPresentationRuntime({
      baseFocus: "witness",
      baseCameraShot: "witness_counsel_two_shot",
    });
    state = reduceCourtroomPresentationRuntime(state, requested(testimony), 1);
    expect(state.camera).toMatchObject({
      target: "witness",
      shot: "witness_close",
      targetPriority: 2,
      targetOrder: 1,
      transition: "blend",
      pending: null,
    });

    state = reduceCourtroomPresentationRuntime(state, terminal(testimony), 2);
    expect(state.camera).toMatchObject({
      target: "witness",
      targetPriority: 2,
      targetOrder: 1,
      pending: {
        target: "witness",
        shot: "witness_counsel_two_shot",
        priority: 0,
        order: 0,
        sinceMs: 2,
      },
    });
    state = advanceCourtroomPresentationRuntime(
      state,
      2 + COURTROOM_CAMERA_HYSTERESIS_MS - 1,
    );
    expect(state.camera.targetPriority).toBe(2);
    state = advanceCourtroomPresentationRuntime(
      state,
      2 + COURTROOM_CAMERA_HYSTERESIS_MS,
    );
    expect(state.camera).toMatchObject({
      target: "witness",
      shot: "witness_counsel_two_shot",
      targetPriority: 0,
      targetOrder: 0,
      transition: "blend",
      pending: null,
    });
  });

  it("holds the exact prior composition across a base-to-base reframe", () => {
    let state = createCourtroomPresentationRuntime({
      baseFocus: "witness",
      baseCameraShot: "witness_counsel_two_shot",
    });
    state = rebaseCourtroomPresentationRuntime(state, {
      baseFocus: "judge",
      baseCameraShot: "judge_close",
      reducedMotion: false,
      observedAtMs: 5,
    });
    expect(state.camera).toMatchObject({
      target: "witness",
      shot: "witness_counsel_two_shot",
      targetPriority: 0,
      targetOrder: 0,
      pending: {
        target: "judge",
        shot: "judge_close",
        priority: 0,
        order: 0,
        sinceMs: 5,
      },
    });

    state = advanceCourtroomPresentationRuntime(
      state,
      5 + COURTROOM_CAMERA_HYSTERESIS_MS,
    );
    expect(state.camera).toMatchObject({
      target: "judge",
      shot: "judge_close",
      targetPriority: 0,
      targetOrder: 0,
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
      baseCameraShot: "jury_box",
      reducedMotion: true,
      observedAtMs: 3,
    });

    expect(state.baseFocus).toBe("jury");
    expect(state.reducedMotion).toBe(true);
    expect(state.retiredPlaybackIdentities).toHaveLength(1);
    expect(state.camera.transition).toBe("cut");

    const reset = resetCourtroomPresentationRuntime({
      baseFocus: "jury",
      baseCameraShot: "jury_box",
      reducedMotion: true,
      observedAtMs: 4,
    });
    expect(reset).toMatchObject({
      revision: 0,
      playbackCues: [],
      retiredPlaybackIdentities: [],
      userSpeech: null,
      camera: { target: "jury", shot: "jury_box", transition: "cut" },
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

  it("enforces a strict, private-safe display descriptor union", () => {
    const evidence = evidenceDisplay("admitted");
    const settlement = settlementDisplay();

    expect(evidence).toMatchObject({
      mode: "evidence",
      status: "admitted",
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(settlement)).toBe(true);
    expect(() =>
      CourtroomDisplayDescriptorSchema.parse({
        mode: "idle",
        itemId: "evidence:leak",
        label: null,
        status: null,
      }),
    ).toThrow();
    expect(() =>
      CourtroomDisplayDescriptorSchema.parse({
        mode: "evidence",
        itemId: "evidence:ledger",
        label: "Ledger excerpt",
        status: "pending",
      }),
    ).toThrow();
    expect(() =>
      CourtroomDisplayDescriptorSchema.parse({
        mode: "settlement",
        itemId: "offer:private",
        label: "Pay 5000 credits",
        status: "open",
      }),
    ).toThrow();
    expect(() =>
      CourtroomDisplayDescriptorSchema.parse({
        ...settlement,
        privateTerms: "secret",
      }),
    ).toThrow();
  });

  it("establishes a reload display baseline without replay and fences stale heads", () => {
    const baseline = evidenceDisplay("offered");
    let state = createCourtroomPresentationRuntime();
    state = rebaseDisplay(state, baseline, presentationHead(7), 100);

    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      display: baseline,
      displayPhase: "steady",
      displayTransition: null,
      announcement: null,
    });
    expect(state.displayHead).toEqual(presentationHead(7));

    const duplicate = rebaseDisplay(
      state,
      baseline,
      presentationHead(7),
      101,
    );
    expect(duplicate).toBe(state);

    const stale = rebaseDisplay(
      state,
      settlementDisplay(),
      presentationHead(6),
      102,
    );
    expect(stale).toBe(state);
    expect(stale.baseDisplay).toEqual(baseline);

    const conflictingSameVersion = rebaseDisplay(
      state,
      settlementDisplay(),
      presentationHead(7, "event:conflict"),
      103,
    );
    expect(conflictingSameVersion).toBe(state);

    const nextTrial = rebaseDisplay(
      state,
      settlementDisplay(),
      presentationHead(1, "event:new-trial", "trial:new"),
      104,
    );
    expect(selectCourtroomPresentationRuntime(nextTrial)).toMatchObject({
      display: { mode: "settlement" },
      displayPhase: "steady",
      displayTransition: null,
      announcement: null,
    });
  });

  it("classifies display enter, update, switch, and exit transitions", () => {
    let state = createCourtroomPresentationRuntime({
      baseDisplay: idleDisplay,
      displayHead: presentationHead(1),
    });
    state = rebaseDisplay(
      state,
      evidenceDisplay("offered"),
      presentationHead(2),
      100,
    );
    expect(selectCourtroomPresentationRuntime(state, 100)).toMatchObject({
      display: { mode: "evidence", status: "offered" },
      displayPhase: "entering",
      transitionActive: true,
      announcement: {
        kind: "evidence",
        change: "opened",
        label: "Ledger excerpt",
        status: "offered",
      },
    });
    expect(state.displayTransition).toMatchObject({
      from: { mode: "idle" },
      to: { mode: "evidence" },
      startedAtMs: 100,
      endsAtMs: 100 + COURTROOM_DISPLAY_TRANSITION_MS,
    });
    expect(Object.isFrozen(state.displayTransition)).toBe(true);
    expect(Object.isFrozen(state.displayTransition?.from)).toBe(true);

    state = rebaseDisplay(
      state,
      evidenceDisplay("admitted"),
      presentationHead(3),
      110,
    );
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      displayPhase: "updating",
      announcement: {
        kind: "evidence",
        change: "updated",
        status: "admitted",
      },
    });

    state = rebaseDisplay(
      state,
      settlementDisplay(),
      presentationHead(4),
      120,
    );
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      display: { mode: "settlement" },
      displayPhase: "switching",
      announcement: { kind: "settlement", change: "opened" },
    });
    expect(JSON.stringify(state.announcement)).not.toContain("offer:private");
    expect(courtroomRuntimeAnnouncementText(state.announcement)).toBe(
      "Private settlement channel opened.",
    );

    state = rebaseDisplay(state, idleDisplay, presentationHead(5), 130);
    expect(selectCourtroomPresentationRuntime(state, 369)).toMatchObject({
      display: { mode: "settlement" },
      displayPhase: "exiting",
      announcement: { kind: "settlement", change: "closed" },
    });
    expect(selectCourtroomPresentationRuntime(state, 370)).toMatchObject({
      display: { mode: "idle" },
      displayPhase: "steady",
      displayTransition: null,
      transitionActive: false,
    });

    const beforeDeadline = advanceCourtroomPresentationRuntime(state, 369);
    expect(beforeDeadline).toBe(state);
    state = advanceCourtroomPresentationRuntime(state, 370);
    expect(state.displayTransition).toBeNull();
    expect(nextCourtroomPresentationWakeAt(state)).toBeNull();
  });

  it("collapses display and gavel timing under reduced motion", () => {
    let state = createCourtroomPresentationRuntime({
      baseDisplay: idleDisplay,
      displayHead: presentationHead(1),
      reducedMotion: true,
    });
    state = rebaseDisplay(
      state,
      settlementDisplay(),
      presentationHead(2),
      10,
      true,
    );
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      display: { mode: "settlement" },
      displayPhase: "steady",
      displayTransition: null,
      announcement: { kind: "settlement", change: "opened" },
    });
    expect(nextCourtroomPresentationWakeAt(state)).toBeNull();

    const ruling = {
      jobId: "job:reduced-ruling",
      responseId: "response:reduced-ruling",
      actor: "actor:judge",
      sceneActor: "judge" as const,
      purpose: "ruling" as const,
    };
    state = reduceCourtroomPresentationRuntime(state, requested(ruling), 20);
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      animation: "ruling",
      rulingPhase: "ready",
    });
    state = reduceCourtroomPresentationRuntime(state, started(ruling), 30);
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      animation: "ruling",
      rulingPhase: "holding",
      rulingTransition: { endsAtMs: null },
      transitionActive: false,
      announcement: { kind: "ruling", change: "holding" },
    });
    expect(nextCourtroomPresentationWakeAt(state)).toBeNull();

    let toggled = createCourtroomPresentationRuntime({
      baseDisplay: idleDisplay,
      displayHead: presentationHead(1),
    });
    toggled = rebaseDisplay(
      toggled,
      settlementDisplay(),
      presentationHead(2),
      100,
    );
    toggled = reduceCourtroomPresentationRuntime(
      toggled,
      requested(ruling),
      110,
    );
    toggled = reduceCourtroomPresentationRuntime(
      toggled,
      started(ruling),
      120,
    );
    expect(nextCourtroomPresentationWakeAt(toggled)).not.toBeNull();
    toggled = rebaseDisplay(
      toggled,
      settlementDisplay(),
      presentationHead(2),
      130,
      true,
    );
    expect(selectCourtroomPresentationRuntime(toggled)).toMatchObject({
      displayPhase: "steady",
      displayTransition: null,
      rulingPhase: "holding",
      transitionActive: false,
      announcement: { kind: "ruling", change: "holding" },
    });
    expect(nextCourtroomPresentationWakeAt(toggled)).toBeNull();
  });

  it("runs an exact, idempotent ruling ready-to-gavel lifecycle", () => {
    const ruling = {
      jobId: "job:gavel",
      responseId: "response:gavel",
      actor: "actor:judge",
      sceneActor: "judge" as const,
      purpose: "ruling" as const,
    };
    let state = createCourtroomPresentationRuntime();
    state = reduceCourtroomPresentationRuntime(state, requested(ruling), 10);
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      animation: "ruling",
      rulingPhase: "ready",
      announcement: { kind: "ruling", change: "ready" },
    });
    expect(nextCourtroomPresentationWakeAt(state)).toBeNull();

    const duplicateRequest = reduceCourtroomPresentationRuntime(
      state,
      requested(ruling),
      11,
    );
    expect(duplicateRequest).toBe(state);
    const ignoredTiming = reduceCourtroomPresentationRuntime(
      state,
      timing(ruling),
      12,
    );
    expect(ignoredTiming).toBe(state);

    state = reduceCourtroomPresentationRuntime(state, started(ruling), 20);
    const gavelEndsAtMs = 20 + COURTROOM_GAVEL_PHASE_MS;
    expect(selectCourtroomPresentationRuntime(state, 20)).toMatchObject({
      animation: "gavel",
      rulingPhase: "gavel",
      rulingTransition: { startedAtMs: 20, endsAtMs: gavelEndsAtMs },
      transitionActive: true,
      announcement: { kind: "ruling", change: "gavel" },
    });
    expect(nextCourtroomPresentationWakeAt(state)).toBe(gavelEndsAtMs);

    const duplicateStart = reduceCourtroomPresentationRuntime(
      state,
      started(ruling),
      21,
    );
    expect(duplicateStart).toBe(state);
    state = reduceCourtroomPresentationRuntime(state, timing(ruling), 22);
    expect(state.rulingTransition?.endsAtMs).toBe(gavelEndsAtMs);
    expect(selectCourtroomPresentationRuntime(state, gavelEndsAtMs)).toMatchObject(
      {
        animation: "ruling",
        rulingPhase: "holding",
        rulingTransition: { endsAtMs: null },
        transitionActive: false,
      },
    );

    state = advanceCourtroomPresentationRuntime(state, gavelEndsAtMs);
    expect(state.rulingTransition).toMatchObject({
      phase: "holding",
      endsAtMs: null,
    });
    expect(state.announcement).toEqual({
      kind: "ruling",
      change: "holding",
    });
    expect(nextCourtroomPresentationWakeAt(state)).toBeNull();
    const settled = advanceCourtroomPresentationRuntime(
      state,
      gavelEndsAtMs + 1,
    );
    expect(settled).toBe(state);

    state = reduceCourtroomPresentationRuntime(
      state,
      terminal(ruling),
      gavelEndsAtMs + 2,
    );
    expect(selectCourtroomPresentationRuntime(state)).toMatchObject({
      rulingPhase: "idle",
      rulingTransition: null,
      announcement: { kind: "ruling", change: "complete" },
    });
  });

  it("never gavels after cancellation before start or a newer playback fence", () => {
    const ruling = {
      jobId: "job:cancelled-ruling",
      responseId: "response:cancelled-ruling",
      actor: "actor:judge",
      sceneActor: "judge" as const,
      purpose: "ruling" as const,
    };
    let cancelled = createCourtroomPresentationRuntime();
    cancelled = reduceCourtroomPresentationRuntime(
      cancelled,
      requested(ruling),
      1,
    );
    cancelled = reduceCourtroomPresentationRuntime(
      cancelled,
      terminal(ruling),
      2,
    );
    expect(selectCourtroomPresentationRuntime(cancelled)).toMatchObject({
      rulingPhase: "idle",
      rulingTransition: null,
      announcement: null,
    });
    const afterLateStart = reduceCourtroomPresentationRuntime(
      cancelled,
      started(ruling),
      3,
    );
    expect(afterLateStart).toBe(cancelled);

    let fenced = createCourtroomPresentationRuntime();
    fenced = reduceCourtroomPresentationRuntime(fenced, requested(ruling), 1);
    fenced = reduceCourtroomPresentationRuntime(fenced, started(ruling), 2);
    fenced = reduceCourtroomPresentationRuntime(
      fenced,
      requested({
        generation: 2,
        playbackFence: 0,
        jobId: "job:new-controller",
        responseId: "response:new-controller",
      }),
      3,
    );
    expect(selectCourtroomPresentationRuntime(fenced)).toMatchObject({
      rulingPhase: "idle",
      rulingTransition: null,
      sceneActor: "witness",
    });
    const afterStaleTiming = reduceCourtroomPresentationRuntime(
      fenced,
      timing(ruling),
      4,
    );
    expect(afterStaleTiming).toBe(fenced);
  });

  it("selects the earliest camera, display, or gavel wake and terminates it", () => {
    const testimony = {
      jobId: "job:wake-testimony",
      responseId: "response:wake-testimony",
    };
    let cameraAndDisplay = createCourtroomPresentationRuntime({
      baseDisplay: idleDisplay,
      displayHead: presentationHead(1),
    });
    cameraAndDisplay = reduceCourtroomPresentationRuntime(
      cameraAndDisplay,
      requested(testimony),
      0,
    );
    cameraAndDisplay = reduceCourtroomPresentationRuntime(
      cameraAndDisplay,
      terminal(testimony),
      10,
    );
    cameraAndDisplay = rebaseDisplay(
      cameraAndDisplay,
      evidenceDisplay(),
      presentationHead(2),
      20,
    );
    expect(nextCourtroomPresentationWakeAt(cameraAndDisplay)).toBe(
      10 + COURTROOM_CAMERA_HYSTERESIS_MS,
    );
    cameraAndDisplay = advanceCourtroomPresentationRuntime(
      cameraAndDisplay,
      10 + COURTROOM_CAMERA_HYSTERESIS_MS,
    );
    expect(nextCourtroomPresentationWakeAt(cameraAndDisplay)).toBe(
      20 + COURTROOM_DISPLAY_TRANSITION_MS,
    );
    cameraAndDisplay = advanceCourtroomPresentationRuntime(
      cameraAndDisplay,
      20 + COURTROOM_DISPLAY_TRANSITION_MS,
    );
    expect(nextCourtroomPresentationWakeAt(cameraAndDisplay)).toBeNull();

    const ruling = {
      jobId: "job:wake-ruling",
      responseId: "response:wake-ruling",
      actor: "actor:judge",
      sceneActor: "judge" as const,
      purpose: "ruling" as const,
    };
    let displayAndGavel = createCourtroomPresentationRuntime({
      baseDisplay: idleDisplay,
      displayHead: presentationHead(1),
    });
    displayAndGavel = rebaseDisplay(
      displayAndGavel,
      evidenceDisplay(),
      presentationHead(2),
      100,
    );
    displayAndGavel = reduceCourtroomPresentationRuntime(
      displayAndGavel,
      requested(ruling),
      110,
    );
    displayAndGavel = reduceCourtroomPresentationRuntime(
      displayAndGavel,
      started(ruling),
      120,
    );
    expect(nextCourtroomPresentationWakeAt(displayAndGavel)).toBe(
      100 + COURTROOM_DISPLAY_TRANSITION_MS,
    );
    displayAndGavel = advanceCourtroomPresentationRuntime(
      displayAndGavel,
      100 + COURTROOM_DISPLAY_TRANSITION_MS,
    );
    expect(nextCourtroomPresentationWakeAt(displayAndGavel)).toBe(
      120 + COURTROOM_GAVEL_PHASE_MS,
    );
    displayAndGavel = advanceCourtroomPresentationRuntime(
      displayAndGavel,
      120 + COURTROOM_GAVEL_PHASE_MS,
    );
    expect(nextCourtroomPresentationWakeAt(displayAndGavel)).toBeNull();
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
