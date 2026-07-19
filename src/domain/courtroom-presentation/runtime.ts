import { z } from "zod";

import type { HearingPerformanceEvent } from "@/lib/speech/hearing-performance";

import {
  CourtroomAnimationSchema,
  CourtroomCameraShotSchema,
  CourtroomPostureSchema,
  SceneActorKeySchema,
  type CourtroomAnimation,
  type SceneActorKey,
} from "./schema";

export const COURTROOM_PRESENTATION_RUNTIME_SCHEMA_VERSION =
  "courtroom-presentation-runtime.v1" as const;
export const COURTROOM_CAMERA_HYSTERESIS_MS = 180;
export const COURTROOM_MAX_ACTIVE_PLAYBACK_CUES = 32;
export const COURTROOM_MAX_RETIRED_PLAYBACK_IDENTITIES = 256;
export const COURTROOM_MAX_RETIRED_USER_SPEECH_IDENTITIES = 64;
export const COURTROOM_MAX_MOUTH_CUES = 2_048;

export const CourtroomMouthShapeSchema = z.enum([
  "rest",
  "closed",
  "open",
  "wide",
  "round",
  "narrow",
]);

const SpeechIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u);
const LocalInterruptIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,291}$/u);
const DurableIdentifierSchema = z.string().trim().min(1).max(256);

export const CourtroomRuntimePlaybackIdentitySchema = z
  .object({
    eventSchemaVersion: z.literal("hearing-performance-event.v1"),
    generation: z.number().int().nonnegative(),
    playbackFence: z.number().int().nonnegative(),
    jobId: SpeechIdentifierSchema,
    responseId: SpeechIdentifierSchema,
    actor: SpeechIdentifierSchema,
    sequence: z.number().int().nonnegative(),
    sceneActor: SceneActorKeySchema,
    purpose: z.enum([
      "transcript",
      "testimony",
      "objection",
      "ruling",
      "correction",
      "speaker_test",
    ]),
    turnId: DurableIdentifierSchema.nullable(),
    interruptId: LocalInterruptIdentifierSchema.nullable(),
  })
  .strict()
  .readonly();

export const CourtroomRuntimeUserSpeechIdentitySchema = z
  .object({
    eventSchemaVersion: z.literal("hearing-performance-event.v1"),
    generation: z.number().int().nonnegative(),
    utteranceId: SpeechIdentifierSchema,
    sceneActor: z.literal("user_counsel"),
    mode: z.enum(["question", "closing"]),
  })
  .strict()
  .readonly();

export const CourtroomMouthCueSchema = z
  .object({
    shape: CourtroomMouthShapeSchema,
    startAtMs: z.number().finite().nonnegative(),
    endAtMs: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((cue) => cue.endAtMs >= cue.startAtMs)
  .readonly();

const CourtroomRuntimePlaybackCueSchema = z
  .object({
    identity: CourtroomRuntimePlaybackIdentitySchema,
    phase: z.enum(["requested", "started", "timed"]),
    order: z.number().int().positive(),
    mouthCues: z
      .array(CourtroomMouthCueSchema)
      .max(COURTROOM_MAX_MOUTH_CUES)
      .readonly(),
  })
  .strict()
  .readonly();

const CourtroomRuntimeUserSpeechCueSchema = z
  .object({
    identity: CourtroomRuntimeUserSpeechIdentitySchema,
    order: z.number().int().positive(),
  })
  .strict()
  .readonly();

const CourtroomRuntimePlaybackHighWaterSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    playbackFence: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();

const CourtroomRuntimeCameraPendingSchema = z
  .object({
    target: SceneActorKeySchema.nullable(),
    shot: CourtroomCameraShotSchema,
    priority: z.number().int().min(0).max(7),
    order: z.number().int().nonnegative(),
    sinceMs: z.number().finite().nonnegative(),
  })
  .strict()
  .readonly();

const CourtroomRuntimeCameraSchema = z
  .object({
    target: SceneActorKeySchema.nullable(),
    shot: CourtroomCameraShotSchema,
    targetPriority: z.number().int().min(0).max(7),
    targetOrder: z.number().int().nonnegative(),
    transition: z.enum(["blend", "cut"]),
    changedAtMs: z.number().finite().nonnegative(),
    pending: CourtroomRuntimeCameraPendingSchema.nullable(),
  })
  .strict()
  .readonly();

export const CourtroomPresentationRuntimeStateSchema = z
  .object({
    schemaVersion: z.literal(COURTROOM_PRESENTATION_RUNTIME_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    reducedMotion: z.boolean(),
    baseFocus: SceneActorKeySchema.nullable(),
    baseCameraShot: CourtroomCameraShotSchema,
    nextOrder: z.number().int().positive(),
    playbackHighWater: CourtroomRuntimePlaybackHighWaterSchema.nullable(),
    highestUserSpeechGeneration: z.number().int().nonnegative(),
    playbackCues: z
      .array(CourtroomRuntimePlaybackCueSchema)
      .max(COURTROOM_MAX_ACTIVE_PLAYBACK_CUES)
      .readonly(),
    retiredPlaybackIdentities: z
      .array(CourtroomRuntimePlaybackIdentitySchema)
      .max(COURTROOM_MAX_RETIRED_PLAYBACK_IDENTITIES)
      .readonly(),
    userSpeech: CourtroomRuntimeUserSpeechCueSchema.nullable(),
    retiredUserSpeechIdentities: z
      .array(CourtroomRuntimeUserSpeechIdentitySchema)
      .max(COURTROOM_MAX_RETIRED_USER_SPEECH_IDENTITIES)
      .readonly(),
    camera: CourtroomRuntimeCameraSchema,
  })
  .strict()
  .superRefine((state, context) => {
    for (let index = 0; index < state.playbackCues.length; index += 1) {
      const cue = state.playbackCues[index];
      if (!cue) continue;
      if (
        state.playbackCues
          .slice(index + 1)
          .some((candidate) =>
            samePlaybackIdentity(candidate.identity, cue.identity),
          )
      ) {
        context.addIssue({
          code: "custom",
          path: ["playbackCues", index],
          message: "Active playback identities must be unique",
        });
      }
      if (
        state.retiredPlaybackIdentities.some((identity) =>
          samePlaybackIdentity(identity, cue.identity),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["playbackCues", index],
          message: "A retired playback cannot remain active",
        });
      }
      if (
        state.playbackHighWater === null ||
        cue.identity.generation !== state.playbackHighWater.generation ||
        cue.identity.playbackFence !==
          state.playbackHighWater.playbackFence
      ) {
        context.addIssue({
          code: "custom",
          path: ["playbackCues", index],
          message: "Active playback must match the current controller fence",
        });
      }
    }
    const greatestOrder = Math.max(
      0,
      ...state.playbackCues.map(({ order }) => order),
      state.userSpeech?.order ?? 0,
    );
    if (state.nextOrder <= greatestOrder) {
      context.addIssue({
        code: "custom",
        path: ["nextOrder"],
        message: "nextOrder must exceed all allocated cue orders",
      });
    }
    if (
      state.userSpeech !== null &&
      state.userSpeech.identity.generation !==
        state.highestUserSpeechGeneration
    ) {
      context.addIssue({
        code: "custom",
        path: ["userSpeech"],
        message: "Active user speech must match the current controller generation",
      });
    }
  })
  .readonly();

const CourtroomRuntimeSnapshotPlaybackSchema = z
  .object({
    identity: CourtroomRuntimePlaybackIdentitySchema,
    phase: z.enum(["requested", "started", "timed"]),
  })
  .strict()
  .readonly();

export const CourtroomPresentationRuntimeSnapshotSchema = z
  .object({
    source: z.enum(["base", "user_speech", "playback"]),
    sceneActor: SceneActorKeySchema.nullable(),
    priority: z.number().int().min(0).max(7),
    animation: CourtroomAnimationSchema.nullable(),
    posture: CourtroomPostureSchema.nullable(),
    mouthShape: CourtroomMouthShapeSchema,
    mouthCues: z
      .array(CourtroomMouthCueSchema)
      .max(COURTROOM_MAX_MOUTH_CUES)
      .readonly(),
    playback: CourtroomRuntimeSnapshotPlaybackSchema.nullable(),
    camera: CourtroomRuntimeCameraSchema,
  })
  .strict()
  .readonly();

export type CourtroomMouthShape = z.infer<typeof CourtroomMouthShapeSchema>;
export type CourtroomMouthCue = z.infer<typeof CourtroomMouthCueSchema>;
export type CourtroomRuntimePlaybackIdentity = z.infer<
  typeof CourtroomRuntimePlaybackIdentitySchema
>;
export type CourtroomRuntimeUserSpeechIdentity = z.infer<
  typeof CourtroomRuntimeUserSpeechIdentitySchema
>;
export type CourtroomPresentationRuntimeState = z.infer<
  typeof CourtroomPresentationRuntimeStateSchema
>;
export type CourtroomPresentationRuntimeSnapshot = z.infer<
  typeof CourtroomPresentationRuntimeSnapshotSchema
>;

type PlaybackEvent = Extract<
  HearingPerformanceEvent,
  {
    type:
      | "playback_requested"
      | "playback_started"
      | "timing_scheduled"
      | "playback_terminal";
  }
>;
type TimingEvent = Extract<
  HearingPerformanceEvent,
  { type: "timing_scheduled" }
>;
type PlaybackCue = z.infer<typeof CourtroomRuntimePlaybackCueSchema>;

type RuntimeSelection = Readonly<{
  source: "base" | "user_speech" | "playback";
  sceneActor: SceneActorKey | null;
  cameraShot: z.infer<typeof CourtroomCameraShotSchema>;
  priority: number;
  order: number;
  playback: PlaybackCue | null;
}>;

function checkedTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Runtime observation time must be finite and nonnegative");
  }
  return value;
}

function playbackIdentity(event: PlaybackEvent): CourtroomRuntimePlaybackIdentity {
  return CourtroomRuntimePlaybackIdentitySchema.parse({
    eventSchemaVersion: event.schemaVersion,
    generation: event.generation,
    playbackFence: event.playbackFence,
    jobId: event.jobId,
    responseId: event.responseId,
    actor: event.actor,
    sequence: event.sequence,
    sceneActor: event.sceneActor,
    purpose: event.purpose,
    turnId: event.turnId,
    interruptId: event.interruptId,
  });
}

function userSpeechIdentity(
  event: Extract<
    HearingPerformanceEvent,
    { type: "user_speech_started" | "user_speech_ended" }
  >,
): CourtroomRuntimeUserSpeechIdentity {
  return CourtroomRuntimeUserSpeechIdentitySchema.parse({
    eventSchemaVersion: event.schemaVersion,
    generation: event.generation,
    utteranceId: event.utteranceId,
    sceneActor: event.sceneActor,
    mode: event.mode,
  });
}

function samePlaybackIdentity(
  left: CourtroomRuntimePlaybackIdentity,
  right: CourtroomRuntimePlaybackIdentity,
): boolean {
  return (
    left.eventSchemaVersion === right.eventSchemaVersion &&
    left.generation === right.generation &&
    left.playbackFence === right.playbackFence &&
    left.jobId === right.jobId &&
    left.responseId === right.responseId &&
    left.actor === right.actor &&
    left.sequence === right.sequence &&
    left.sceneActor === right.sceneActor &&
    left.purpose === right.purpose &&
    left.turnId === right.turnId &&
    left.interruptId === right.interruptId
  );
}

function sameUserSpeechIdentity(
  left: CourtroomRuntimeUserSpeechIdentity,
  right: CourtroomRuntimeUserSpeechIdentity,
): boolean {
  return (
    left.eventSchemaVersion === right.eventSchemaVersion &&
    left.generation === right.generation &&
    left.utteranceId === right.utteranceId &&
    left.sceneActor === right.sceneActor &&
    left.mode === right.mode
  );
}

function comparePlaybackFence(
  identity: Pick<
    CourtroomRuntimePlaybackIdentity,
    "generation" | "playbackFence"
  >,
  highWater: CourtroomPresentationRuntimeState["playbackHighWater"],
): -1 | 0 | 1 {
  if (highWater === null) return 1;
  if (identity.generation !== highWater.generation) {
    return identity.generation > highWater.generation ? 1 : -1;
  }
  if (identity.playbackFence === highWater.playbackFence) return 0;
  return identity.playbackFence > highWater.playbackFence ? 1 : -1;
}

function boundedPlaybackTombstones(
  identities: readonly CourtroomRuntimePlaybackIdentity[],
): readonly CourtroomRuntimePlaybackIdentity[] {
  return identities.slice(-COURTROOM_MAX_RETIRED_PLAYBACK_IDENTITIES);
}

function boundedUserSpeechTombstones(
  identities: readonly CourtroomRuntimeUserSpeechIdentity[],
): readonly CourtroomRuntimeUserSpeechIdentity[] {
  return identities.slice(-COURTROOM_MAX_RETIRED_USER_SPEECH_IDENTITIES);
}

function playbackPriority(identity: CourtroomRuntimePlaybackIdentity): number {
  switch (identity.purpose) {
    case "ruling":
      return 7;
    case "objection":
      return 6;
    case "correction":
      return 5;
    case "testimony":
      return identity.interruptId === null ? 2 : 4;
    case "transcript":
      return 2;
    case "speaker_test":
      return 1;
  }
}

function closeCameraShot(
  sceneActor: SceneActorKey | null,
): z.infer<typeof CourtroomCameraShotSchema> {
  switch (sceneActor) {
    case "judge":
      return "judge_close";
    case "user_counsel":
      return "user_counsel_close";
    case "opposing_counsel":
      return "opposing_counsel_close";
    case "witness":
      return "witness_close";
    case "jury":
      return "jury_box";
    case "clerk":
      return "evidence_display";
    case null:
      return "courtroom_wide";
  }
}

function selectRuntimeCue(
  state: Pick<
    CourtroomPresentationRuntimeState,
    "baseCameraShot" | "baseFocus" | "playbackCues" | "userSpeech"
  >,
): RuntimeSelection {
  let selected: RuntimeSelection = {
    source: "base",
    sceneActor: state.baseFocus,
    cameraShot: state.baseCameraShot,
    priority: 0,
    order: 0,
    playback: null,
  };
  if (state.userSpeech) {
    selected = {
      source: "user_speech",
      sceneActor: "user_counsel",
      cameraShot: "user_counsel_close",
      priority: 3,
      order: state.userSpeech.order,
      playback: null,
    };
  }
  for (const cue of state.playbackCues) {
    const priority = playbackPriority(cue.identity);
    if (
      priority > selected.priority ||
      (priority === selected.priority && cue.order > selected.order)
    ) {
      selected = {
        source: "playback",
        sceneActor: cue.identity.sceneActor,
        cameraShot: closeCameraShot(cue.identity.sceneActor),
        priority,
        order: cue.order,
        playback: cue,
      };
    }
  }
  return selected;
}

function reconcileCamera(
  camera: CourtroomPresentationRuntimeState["camera"],
  selection: RuntimeSelection,
  reducedMotion: boolean,
  observedAtMs: number,
): CourtroomPresentationRuntimeState["camera"] {
  const transition = reducedMotion ? "cut" : "blend";
  const selectionMatchesCamera =
    selection.sceneActor === camera.target &&
    selection.cameraShot === camera.shot &&
    selection.priority === camera.targetPriority &&
    selection.order === camera.targetOrder;
  if (selectionMatchesCamera) {
    if (camera.pending === null && camera.transition === transition) return camera;
    return CourtroomRuntimeCameraSchema.parse({
      ...camera,
      transition,
      pending: null,
    });
  }

  const shouldPreempt =
    selection.priority > camera.targetPriority ||
    (selection.source !== "base" && selection.order > camera.targetOrder);
  const pendingMatches =
    camera.pending?.target === selection.sceneActor &&
    camera.pending.shot === selection.cameraShot &&
    camera.pending.priority === selection.priority &&
    camera.pending.order === selection.order;
  const hysteresisElapsed =
    pendingMatches &&
    observedAtMs - (camera.pending?.sinceMs ?? observedAtMs) >=
      COURTROOM_CAMERA_HYSTERESIS_MS;
  if (shouldPreempt || hysteresisElapsed) {
    return CourtroomRuntimeCameraSchema.parse({
      target: selection.sceneActor,
      shot: selection.cameraShot,
      targetPriority: selection.priority,
      targetOrder: selection.order,
      transition,
      changedAtMs: observedAtMs,
      pending: null,
    });
  }
  if (pendingMatches && camera.transition === transition) {
    return camera;
  }
  return CourtroomRuntimeCameraSchema.parse({
    ...camera,
    transition,
    pending: pendingMatches
      ? camera.pending
      : {
          target: selection.sceneActor,
          shot: selection.cameraShot,
          priority: selection.priority,
          order: selection.order,
          sinceMs: observedAtMs,
        },
  });
}

function visemeShape(value: string): CourtroomMouthShape {
  const normalized = value.trim().toLowerCase().replace(/^viseme[_:-]?/u, "");
  if (/^(?:0|sil|silence|sp|pau|pause|rest|_)$/u.test(normalized)) {
    return "rest";
  }
  if (/^(?:21|p|b|m|pp|bmp)$/u.test(normalized)) return "closed";
  if (/^(?:7|8|o|oh|ow|u|uw|w|q)$/u.test(normalized)) return "round";
  if (/^(?:3|4|5|6|e|ee|eh|ih|iy|y)$/u.test(normalized)) return "wide";
  if (/^(?:1|2|9|10|11|a|aa|ae|ah|ao|ay|oy)$/u.test(normalized)) {
    return "open";
  }
  return "narrow";
}

function textShape(value: string): CourtroomMouthShape {
  const normalized = value.toLowerCase().replace(/[^a-z]/gu, "");
  if (normalized.length === 0) return "rest";
  const vowel = normalized.match(/[aeiouy]/u)?.[0];
  if (vowel === "a") return "open";
  if (vowel === "o" || vowel === "u") return "round";
  if (vowel) return "wide";
  if (/[bmp]/u.test(normalized)) return "closed";
  return "narrow";
}

function normalizeMouthCues(
  event: TimingEvent,
  observedAtMs: number,
): CourtroomMouthCue[] {
  const selectedKind = event.marks.some(({ kind }) => kind === "viseme")
    ? "viseme"
    : event.marks.some(({ kind }) => kind === "word")
      ? "word"
      : "phrase";
  return event.marks
    .filter(({ kind }) => kind === selectedKind)
    .map((mark) => {
      const startAtMs = Math.max(
        0,
        Math.round(
          observedAtMs +
            (mark.audioStartTimeSeconds - event.audioClockTimeSeconds) * 1_000,
        ),
      );
      const endAtMs = Math.max(
        startAtMs,
        Math.round(
          observedAtMs +
            (mark.audioEndTimeSeconds - event.audioClockTimeSeconds) * 1_000,
        ),
      );
      return CourtroomMouthCueSchema.parse({
        shape:
          mark.kind === "viseme"
            ? visemeShape(mark.value)
            : textShape(mark.value),
        startAtMs,
        endAtMs,
      });
    })
    .sort(
      (left, right) =>
        left.startAtMs - right.startAtMs || left.endAtMs - right.endAtMs,
    );
}

function mergeMouthCues(
  existing: readonly CourtroomMouthCue[],
  incoming: readonly CourtroomMouthCue[],
): CourtroomMouthCue[] {
  const merged = [...existing];
  for (const cue of incoming) {
    if (
      !merged.some(
        (candidate) =>
          candidate.shape === cue.shape &&
          candidate.startAtMs === cue.startAtMs &&
          candidate.endAtMs === cue.endAtMs,
      )
    ) {
      merged.push(cue);
    }
  }
  return merged
    .sort(
      (left, right) =>
        left.startAtMs - right.startAtMs || left.endAtMs - right.endAtMs,
    )
    .slice(0, COURTROOM_MAX_MOUTH_CUES);
}

function finishRuntimeChange(
  state: CourtroomPresentationRuntimeState,
  update: Omit<CourtroomPresentationRuntimeState, "revision" | "schemaVersion">,
  observedAtMs: number,
  changed: boolean,
): CourtroomPresentationRuntimeState {
  const selection = selectRuntimeCue(update);
  const camera = reconcileCamera(
    update.camera,
    selection,
    update.reducedMotion,
    observedAtMs,
  );
  if (!changed && camera === state.camera) return state;
  return CourtroomPresentationRuntimeStateSchema.parse({
    schemaVersion: COURTROOM_PRESENTATION_RUNTIME_SCHEMA_VERSION,
    revision: state.revision + 1,
    ...update,
    camera,
  });
}

export type CreateCourtroomPresentationRuntimeInput = Readonly<{
  reducedMotion?: boolean;
  baseFocus?: SceneActorKey | null;
  baseCameraShot?: z.infer<typeof CourtroomCameraShotSchema>;
  observedAtMs?: number;
}>;

export function createCourtroomPresentationRuntime(
  input: CreateCourtroomPresentationRuntimeInput = {},
): CourtroomPresentationRuntimeState {
  const observedAtMs = checkedTime(input.observedAtMs ?? 0);
  const reducedMotion = input.reducedMotion ?? false;
  return CourtroomPresentationRuntimeStateSchema.parse({
    schemaVersion: COURTROOM_PRESENTATION_RUNTIME_SCHEMA_VERSION,
    revision: 0,
    reducedMotion,
    baseFocus: input.baseFocus ?? null,
    baseCameraShot: input.baseCameraShot ?? "courtroom_wide",
    nextOrder: 1,
    playbackHighWater: null,
    highestUserSpeechGeneration: 0,
    playbackCues: [],
    retiredPlaybackIdentities: [],
    userSpeech: null,
    retiredUserSpeechIdentities: [],
    camera: {
      target: input.baseFocus ?? null,
      shot: input.baseCameraShot ?? "courtroom_wide",
      targetPriority: 0,
      targetOrder: 0,
      transition: "cut",
      changedAtMs: observedAtMs,
      pending: null,
    },
  });
}

export const resetCourtroomPresentationRuntime =
  createCourtroomPresentationRuntime;

export function reduceCourtroomPresentationRuntime(
  state: CourtroomPresentationRuntimeState,
  event: HearingPerformanceEvent,
  observedAtMs: number,
): CourtroomPresentationRuntimeState {
  const atMs = checkedTime(observedAtMs);
  let playbackCues = state.playbackCues;
  let retiredPlaybackIdentities = state.retiredPlaybackIdentities;
  let playbackHighWater = state.playbackHighWater;
  let userSpeech = state.userSpeech;
  let retiredUserSpeechIdentities = state.retiredUserSpeechIdentities;
  let highestUserSpeechGeneration = state.highestUserSpeechGeneration;
  let nextOrder = state.nextOrder;
  let changed = false;

  if (
    event.type === "playback_requested" ||
    event.type === "playback_started" ||
    event.type === "timing_scheduled" ||
    event.type === "playback_terminal"
  ) {
    const identity = playbackIdentity(event);
    const fenceComparison = comparePlaybackFence(identity, playbackHighWater);
    if (fenceComparison < 0) return state;
    if (fenceComparison > 0) {
      const newlyRetired = playbackCues
        .map(({ identity: activeIdentity }) => activeIdentity)
        .filter(
          (activeIdentity) =>
            !retiredPlaybackIdentities.some((retiredIdentity) =>
              samePlaybackIdentity(retiredIdentity, activeIdentity),
            ),
        );
      retiredPlaybackIdentities = boundedPlaybackTombstones([
        ...retiredPlaybackIdentities,
        ...newlyRetired,
      ]);
      playbackCues = [];
      playbackHighWater = CourtroomRuntimePlaybackHighWaterSchema.parse({
        generation: identity.generation,
        playbackFence: identity.playbackFence,
      });
      changed = true;
    }
  } else {
    const identity = userSpeechIdentity(event);
    if (identity.generation < highestUserSpeechGeneration) return state;
    if (identity.generation > highestUserSpeechGeneration) {
      highestUserSpeechGeneration = identity.generation;
      if (userSpeech !== null) {
        const activeIdentity = userSpeech.identity;
        if (
          !retiredUserSpeechIdentities.some((retiredIdentity) =>
            sameUserSpeechIdentity(retiredIdentity, activeIdentity),
          )
        ) {
          retiredUserSpeechIdentities = boundedUserSpeechTombstones([
            ...retiredUserSpeechIdentities,
            activeIdentity,
          ]);
        }
        userSpeech = null;
      }
      changed = true;
    }
  }

  switch (event.type) {
    case "playback_requested": {
      const identity = playbackIdentity(event);
      const active = playbackCues.some((cue) =>
        samePlaybackIdentity(cue.identity, identity),
      );
      const retired = retiredPlaybackIdentities.some((candidate) =>
        samePlaybackIdentity(candidate, identity),
      );
      if (
        !active &&
        !retired &&
        playbackCues.length < COURTROOM_MAX_ACTIVE_PLAYBACK_CUES
      ) {
        playbackCues = [
          ...playbackCues,
          { identity, phase: "requested", order: nextOrder, mouthCues: [] },
        ];
        nextOrder += 1;
        changed = true;
      }
      break;
    }
    case "playback_started": {
      const identity = playbackIdentity(event);
      const index = playbackCues.findIndex((cue) =>
        samePlaybackIdentity(cue.identity, identity),
      );
      const cue = playbackCues[index];
      if (cue && cue.phase === "requested") {
        playbackCues = playbackCues.map((candidate, candidateIndex) =>
          candidateIndex === index
            ? { ...candidate, phase: "started" as const }
            : candidate,
        );
        changed = true;
      }
      break;
    }
    case "timing_scheduled": {
      const identity = playbackIdentity(event);
      const index = playbackCues.findIndex((cue) =>
        samePlaybackIdentity(cue.identity, identity),
      );
      const cue = playbackCues[index];
      if (cue && cue.phase !== "requested") {
        const mouthCues = mergeMouthCues(
          cue.mouthCues,
          normalizeMouthCues(event, atMs),
        );
        const timingChanged =
          cue.phase !== "timed" || mouthCues.length !== cue.mouthCues.length;
        if (timingChanged) {
          playbackCues = playbackCues.map((candidate, candidateIndex) =>
            candidateIndex === index
              ? { ...candidate, phase: "timed" as const, mouthCues }
              : candidate,
          );
          changed = true;
        }
      }
      break;
    }
    case "playback_terminal": {
      const identity = playbackIdentity(event);
      const remaining = playbackCues.filter(
        (cue) => !samePlaybackIdentity(cue.identity, identity),
      );
      if (remaining.length !== playbackCues.length) {
        playbackCues = remaining;
        changed = true;
      }
      if (
        !retiredPlaybackIdentities.some((candidate) =>
          samePlaybackIdentity(candidate, identity),
        )
      ) {
        retiredPlaybackIdentities = boundedPlaybackTombstones([
          ...retiredPlaybackIdentities,
          identity,
        ]);
        changed = true;
      }
      break;
    }
    case "user_speech_started": {
      const identity = userSpeechIdentity(event);
      const retired = retiredUserSpeechIdentities.some((candidate) =>
        sameUserSpeechIdentity(candidate, identity),
      );
      if (
        !retired &&
        (userSpeech === null ||
          !sameUserSpeechIdentity(userSpeech.identity, identity))
      ) {
        if (userSpeech) {
          const activeIdentity = userSpeech.identity;
          if (
            !retiredUserSpeechIdentities.some((retiredIdentity) =>
              sameUserSpeechIdentity(retiredIdentity, activeIdentity),
            )
          ) {
            retiredUserSpeechIdentities = boundedUserSpeechTombstones([
              ...retiredUserSpeechIdentities,
              activeIdentity,
            ]);
          }
        }
        userSpeech = { identity, order: nextOrder };
        nextOrder += 1;
        changed = true;
      }
      break;
    }
    case "user_speech_ended": {
      const identity = userSpeechIdentity(event);
      if (
        userSpeech &&
        sameUserSpeechIdentity(userSpeech.identity, identity)
      ) {
        userSpeech = null;
        changed = true;
      }
      if (
        !retiredUserSpeechIdentities.some((candidate) =>
          sameUserSpeechIdentity(candidate, identity),
        )
      ) {
        retiredUserSpeechIdentities = boundedUserSpeechTombstones([
          ...retiredUserSpeechIdentities,
          identity,
        ]);
        changed = true;
      }
      break;
    }
  }

  return finishRuntimeChange(
    state,
    {
      reducedMotion: state.reducedMotion,
      baseFocus: state.baseFocus,
      baseCameraShot: state.baseCameraShot,
      nextOrder,
      playbackHighWater,
      highestUserSpeechGeneration,
      playbackCues,
      retiredPlaybackIdentities,
      userSpeech,
      retiredUserSpeechIdentities,
      camera: state.camera,
    },
    atMs,
    changed,
  );
}

export function advanceCourtroomPresentationRuntime(
  state: CourtroomPresentationRuntimeState,
  observedAtMs: number,
): CourtroomPresentationRuntimeState {
  return finishRuntimeChange(
    state,
    {
      reducedMotion: state.reducedMotion,
      baseFocus: state.baseFocus,
      baseCameraShot: state.baseCameraShot,
      nextOrder: state.nextOrder,
      playbackHighWater: state.playbackHighWater,
      highestUserSpeechGeneration: state.highestUserSpeechGeneration,
      playbackCues: state.playbackCues,
      retiredPlaybackIdentities: state.retiredPlaybackIdentities,
      userSpeech: state.userSpeech,
      retiredUserSpeechIdentities: state.retiredUserSpeechIdentities,
      camera: state.camera,
    },
    checkedTime(observedAtMs),
    false,
  );
}

export type RebaseCourtroomPresentationRuntimeInput = Readonly<{
  baseFocus: SceneActorKey | null;
  baseCameraShot: z.infer<typeof CourtroomCameraShotSchema>;
  reducedMotion: boolean;
  observedAtMs: number;
}>;

export function rebaseCourtroomPresentationRuntime(
  state: CourtroomPresentationRuntimeState,
  input: RebaseCourtroomPresentationRuntimeInput,
): CourtroomPresentationRuntimeState {
  const atMs = checkedTime(input.observedAtMs);
  const changed =
    state.baseFocus !== input.baseFocus ||
    state.baseCameraShot !== input.baseCameraShot ||
    state.reducedMotion !== input.reducedMotion;
  return finishRuntimeChange(
    state,
    {
      reducedMotion: input.reducedMotion,
      baseFocus: input.baseFocus,
      baseCameraShot: input.baseCameraShot,
      nextOrder: state.nextOrder,
      playbackHighWater: state.playbackHighWater,
      highestUserSpeechGeneration: state.highestUserSpeechGeneration,
      playbackCues: state.playbackCues,
      retiredPlaybackIdentities: state.retiredPlaybackIdentities,
      userSpeech: state.userSpeech,
      retiredUserSpeechIdentities: state.retiredUserSpeechIdentities,
      camera: state.camera,
    },
    atMs,
    changed,
  );
}

function playbackAnimation(cue: PlaybackCue): CourtroomAnimation {
  switch (cue.identity.purpose) {
    case "ruling":
      return "ruling";
    case "objection":
      return "objecting";
    case "correction":
      return cue.phase === "requested" ? "reacting" : "speaking";
    case "testimony":
    case "speaker_test":
      return cue.phase === "requested" ? "thinking" : "speaking";
    case "transcript":
      if (cue.phase !== "requested") return "speaking";
      return cue.identity.sceneActor === "user_counsel" ||
        cue.identity.sceneActor === "opposing_counsel"
        ? "standing"
        : "thinking";
  }
}

function playbackPosture(cue: PlaybackCue): "seated" | "standing" {
  return cue.identity.sceneActor === "user_counsel" ||
    cue.identity.sceneActor === "opposing_counsel"
    ? "standing"
    : "seated";
}

function sampledMouthShape(
  cue: PlaybackCue,
  observedAtMs: number | undefined,
  reducedMotion: boolean,
): CourtroomMouthShape {
  if (cue.phase === "requested") return "rest";
  if (reducedMotion) return "narrow";
  if (observedAtMs === undefined || cue.mouthCues.length === 0) {
    return "open";
  }
  return (
    cue.mouthCues.find(
      ({ startAtMs, endAtMs }) =>
        observedAtMs >= startAtMs && observedAtMs < endAtMs,
    )?.shape ?? "rest"
  );
}

export function selectCourtroomPresentationRuntime(
  state: CourtroomPresentationRuntimeState,
  observedAtMs?: number,
): CourtroomPresentationRuntimeSnapshot {
  if (observedAtMs !== undefined) checkedTime(observedAtMs);
  const selection = selectRuntimeCue(state);
  const cue = selection.playback;
  if (cue) {
    return CourtroomPresentationRuntimeSnapshotSchema.parse({
      source: "playback",
      sceneActor: cue.identity.sceneActor,
      priority: selection.priority,
      animation: playbackAnimation(cue),
      posture: playbackPosture(cue),
      mouthShape: sampledMouthShape(cue, observedAtMs, state.reducedMotion),
      mouthCues: cue.mouthCues,
      playback: { identity: cue.identity, phase: cue.phase },
      camera: state.camera,
    });
  }
  if (selection.source === "user_speech") {
    return CourtroomPresentationRuntimeSnapshotSchema.parse({
      source: "user_speech",
      sceneActor: "user_counsel",
      priority: selection.priority,
      animation: "speaking",
      posture: "standing",
      mouthShape: state.reducedMotion ? "narrow" : "open",
      mouthCues: [],
      playback: null,
      camera: state.camera,
    });
  }
  return CourtroomPresentationRuntimeSnapshotSchema.parse({
    source: "base",
    sceneActor: selection.sceneActor,
    priority: 0,
    animation: null,
    posture: null,
    mouthShape: "rest",
    mouthCues: [],
    playback: null,
    camera: state.camera,
  });
}
