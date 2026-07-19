import {
  COURTROOM_DISPLAY_TRANSITION_MS,
  COURTROOM_GAVEL_PHASE_MS,
  COURTROOM_PRESENTATION_FRAME_SCHEMA_VERSION,
  CourtroomAudibleSemanticPerformanceSchema,
  CourtroomDisplayDescriptorSchema,
  CourtroomPresentationFrameSchema,
  CourtroomPresentationHeadSchema,
  advanceCourtroomPresentationRuntime,
  createCourtroomPresentationRuntime,
  rebaseCourtroomPresentationRuntime,
  reduceCourtroomPresentationRuntime,
  selectCourtroomPresentationRuntime,
  type CourtroomAnimation,
  type CourtroomAudibleSemanticPerformance,
  type CourtroomDisplayDescriptor,
  type CourtroomPresentationFrame,
  type CourtroomPresentationRuntimeSnapshot,
  type CourtroomPresentationRuntimeState,
  type CourtroomPresentationHead,
  type SceneActorKey,
} from "@/domain/courtroom-presentation";
import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
  type HearingPerformanceEvent,
  type HearingPlaybackPurpose,
} from "@/lib/speech/hearing-performance";

export const COURTROOM_VISUAL_ATLAS_STATE_IDS = Object.freeze([
  "animation-idle-clerk",
  "animation-listening-jury",
  "animation-thinking-witness",
  "animation-speaking-witness",
  "animation-objecting-opposing-counsel",
  "animation-standing-user-counsel",
  "animation-sitting-user-counsel",
  "animation-presenting-evidence-user-counsel",
  "animation-reacting-witness",
  "animation-ruling-judge-ready",
  "animation-gavel-judge-active",
  "evidence-enter",
  "evidence-update",
  "evidence-switch",
  "evidence-exit",
  "evidence-steady",
  "settlement-enter",
  "settlement-update",
  "settlement-steady",
  "settlement-exit",
  "ruling-holding-judge",
  "reduced-motion-speaking-model-stand",
  "reduced-motion-speaking-model-sit",
  "reduced-motion-ruling-model-gavel",
] as const);

export type CourtroomVisualAtlasStateId =
  (typeof COURTROOM_VISUAL_ATLAS_STATE_IDS)[number];

export type CourtroomVisualFixture = Readonly<{
  frame: CourtroomPresentationFrame;
  presentationRuntime: CourtroomPresentationRuntimeState;
  runtimeSnapshot: CourtroomPresentationRuntimeSnapshot;
  audibleSemanticPerformance: CourtroomAudibleSemanticPerformance | null;
  captureAtMs: number;
  title: string;
}>;

const VISUAL_TRIAL_ID = "trial:visual-atlas";
const TRANSIENT_START_AT_MS = 8_000_000_000_000;
const STATIC_CAPTURE_AT_MS = TRANSIENT_START_AT_MS + 10_000;

const CHARACTER_ORDER = Object.freeze([
  "judge",
  "user_counsel",
  "opposing_counsel",
  "witness",
  "clerk",
  "jury",
] as const satisfies readonly SceneActorKey[]);

const ACTOR_IDS = Object.freeze({
  judge: "actor:visual:judge",
  user_counsel: "actor:visual:user-counsel",
  opposing_counsel: "actor:visual:opposing-counsel",
  witness: "actor:visual:witness",
  clerk: "actor:visual:clerk",
  jury: "actor:visual:jury",
} as const satisfies Readonly<Record<SceneActorKey, string>>);

const ACTOR_LABELS = Object.freeze({
  judge: "Judge",
  user_counsel: "Counsel A",
  opposing_counsel: "Counsel B",
  witness: "Witness",
  clerk: "Court clerk",
  jury: "Jury",
} as const satisfies Readonly<Record<SceneActorKey, string>>);

const IDLE_DISPLAY = CourtroomDisplayDescriptorSchema.parse({
  mode: "idle",
  itemId: null,
  label: null,
  status: null,
});

const EVIDENCE_A_OFFERED = evidenceDisplay(
  "evidence:visual:a",
  "Synthetic exhibit A",
  "offered",
);
const EVIDENCE_A_ADMITTED = evidenceDisplay(
  "evidence:visual:a",
  "Synthetic exhibit A",
  "admitted",
);
const EVIDENCE_B_EXCLUDED = evidenceDisplay(
  "evidence:visual:b",
  "Synthetic exhibit B",
  "excluded",
);
const SETTLEMENT_OPEN = settlementDisplay("settlement:visual:a", "open");
const SETTLEMENT_COUNTERED = settlementDisplay(
  "settlement:visual:a",
  "countered",
);

type PlaybackRequestedEvent = Extract<
  HearingPerformanceEvent,
  { type: "playback_requested" }
>;
type PlaybackIdentity = Omit<PlaybackRequestedEvent, "type">;
type PlaybackPhase = "requested" | "started";
type RoleGesture = Extract<
  CourtroomAudibleSemanticPerformance,
  { kind: "role" }
>["gesture"];

type RuntimeBuild = Readonly<{
  captureAtMs: number;
  presentationRuntime: CourtroomPresentationRuntimeState;
}>;

type FixtureInput = Readonly<{
  activeAnimation: CourtroomAnimation;
  activeSlot: SceneActorKey;
  audibleSemanticPerformance?: CourtroomAudibleSemanticPerformance | null;
  captureAtMs: number;
  presentationRuntime: CourtroomPresentationRuntimeState;
  title: string;
}>;

function evidenceDisplay(
  itemId: string,
  label: string,
  status:
    | "uploaded"
    | "indexed"
    | "offered"
    | "admitted"
    | "excluded"
    | "withdrawn",
): CourtroomDisplayDescriptor {
  return CourtroomDisplayDescriptorSchema.parse({
    mode: "evidence",
    itemId,
    label,
    status,
  });
}

function settlementDisplay(
  itemId: string,
  status:
    | "open"
    | "countered"
    | "accepted"
    | "rejected"
    | "withdrawn"
    | "expired",
): CourtroomDisplayDescriptor {
  return CourtroomDisplayDescriptorSchema.parse({
    mode: "settlement",
    itemId,
    label: "Private settlement conference",
    status,
  });
}

function visualHead(stateVersion: number): CourtroomPresentationHead {
  return CourtroomPresentationHeadSchema.parse({
    trialId: VISUAL_TRIAL_ID,
    stateVersion,
    lastEventId: `event:visual:${stateVersion}`,
  });
}

function closeShot(slot: SceneActorKey): CourtroomPresentationFrame["camera"]["shot"] {
  switch (slot) {
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
  }
}

function postureForAnimation(
  slot: SceneActorKey,
  animation: CourtroomAnimation,
): "seated" | "standing" {
  if (
    animation === "objecting" ||
    animation === "standing" ||
    animation === "presenting_evidence"
  ) {
    return "standing";
  }
  if (
    animation === "speaking" &&
    (slot === "user_counsel" || slot === "opposing_counsel")
  ) {
    return "standing";
  }
  return "seated";
}

function immutableFrame(
  runtime: CourtroomPresentationRuntimeState,
  snapshot: CourtroomPresentationRuntimeSnapshot,
  activeSlot: SceneActorKey,
  activeAnimation: CourtroomAnimation,
  title: string,
): CourtroomPresentationFrame {
  const activePosture =
    snapshot.sceneActor === activeSlot && snapshot.posture !== null
      ? snapshot.posture
      : postureForAnimation(activeSlot, activeAnimation);
  const parsed = CourtroomPresentationFrameSchema.parse({
    schemaVersion: COURTROOM_PRESENTATION_FRAME_SCHEMA_VERSION,
    head: runtime.displayHead ?? visualHead(1),
    quality: runtime.reducedMotion ? "reduced" : "balanced",
    reducedMotion: runtime.reducedMotion,
    camera: {
      shot: snapshot.camera.shot,
      target: snapshot.camera.target,
      transition: snapshot.camera.transition,
    },
    characters: CHARACTER_ORDER.map((slot) => ({
      slot,
      actorId: ACTOR_IDS[slot],
      label: ACTOR_LABELS[slot],
      present: true,
      animation: slot === activeSlot ? activeAnimation : "idle",
      posture: slot === activeSlot ? activePosture : "seated",
      emphasis: slot === activeSlot ? 0.82 : slot === "judge" ? 0.2 : 0,
    })),
    display: runtime.baseDisplay,
    statusSummary: title,
  });
  Object.freeze(parsed.head);
  Object.freeze(parsed.camera);
  Object.freeze(parsed.display);
  for (const character of parsed.characters) Object.freeze(character);
  Object.freeze(parsed.characters);
  return Object.freeze(parsed);
}

function semanticPerformance(
  input: CourtroomAudibleSemanticPerformance,
): CourtroomAudibleSemanticPerformance {
  return Object.freeze(CourtroomAudibleSemanticPerformanceSchema.parse(input));
}

function witnessSemantic(): CourtroomAudibleSemanticPerformance {
  return semanticPerformance({
    kind: "witness",
    emotion: "confident",
    intensity: 0.68,
    delivery: "measured",
    gesture: "small_nod",
    gazeTarget: "questioning_counsel",
  });
}

function roleSemantic(gesture: RoleGesture): CourtroomAudibleSemanticPerformance {
  return semanticPerformance({
    kind: "role",
    emotion: "confident",
    intensity: 0.64,
    gazeTarget: "witness",
    gesture,
    speakingStyle: "firm",
  });
}

function createBaseRuntime(
  baseFocus: SceneActorKey,
  options: Readonly<{
    baseDisplay?: CourtroomDisplayDescriptor;
    baseHead?: CourtroomPresentationHead;
    cameraShot?: CourtroomPresentationFrame["camera"]["shot"];
    observedAtMs?: number;
    reducedMotion?: boolean;
  }> = {},
): CourtroomPresentationRuntimeState {
  return createCourtroomPresentationRuntime({
    baseFocus,
    baseCameraShot: options.cameraShot ?? closeShot(baseFocus),
    baseDisplay: options.baseDisplay ?? IDLE_DISPLAY,
    displayHead: options.baseHead ?? visualHead(1),
    observedAtMs: options.observedAtMs ?? STATIC_CAPTURE_AT_MS,
    reducedMotion: options.reducedMotion ?? false,
  });
}

function playbackIdentity(
  sceneActor: SceneActorKey,
  purpose: HearingPlaybackPurpose,
): PlaybackIdentity {
  const hasInterrupt =
    purpose === "objection" || purpose === "ruling" || purpose === "correction";
  return {
    schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
    generation: 1,
    playbackFence: 1,
    jobId: `job:visual:${purpose}`,
    responseId: `response:visual:${purpose}`,
    actor: ACTOR_IDS[sceneActor],
    sequence: 0,
    sceneActor,
    purpose,
    turnId: purpose === "ruling" ? null : `turn:visual:${purpose}`,
    interruptId: hasInterrupt ? "interrupt:visual" : null,
  };
}

function playbackEvent(
  type: "playback_requested" | "playback_started",
  identity: PlaybackIdentity,
): HearingPerformanceEvent {
  return freezeHearingPerformanceEvent({ type, ...identity });
}

function playbackRuntime(
  sceneActor: SceneActorKey,
  purpose: HearingPlaybackPurpose,
  phase: PlaybackPhase,
  options: Readonly<{
    reducedMotion?: boolean;
    startedAtMs?: number;
  }> = {},
): RuntimeBuild {
  const startedAtMs = options.startedAtMs ?? STATIC_CAPTURE_AT_MS - 1;
  const identity = playbackIdentity(sceneActor, purpose);
  let presentationRuntime = createBaseRuntime(sceneActor, {
    observedAtMs: startedAtMs - 2,
    reducedMotion: options.reducedMotion,
  });
  presentationRuntime = reduceCourtroomPresentationRuntime(
    presentationRuntime,
    playbackEvent("playback_requested", identity),
    startedAtMs - 1,
  );
  if (phase === "started") {
    presentationRuntime = reduceCourtroomPresentationRuntime(
      presentationRuntime,
      playbackEvent("playback_started", identity),
      startedAtMs,
    );
  }
  const captureAtMs =
    phase === "started" && purpose === "ruling" && !options.reducedMotion
      ? startedAtMs + Math.floor(COURTROOM_GAVEL_PHASE_MS / 2)
      : phase === "started"
        ? startedAtMs + 1
        : startedAtMs - 1;
  return Object.freeze({ captureAtMs, presentationRuntime });
}

function holdingRulingRuntime(reducedMotion = false): RuntimeBuild {
  const startedAtMs = TRANSIENT_START_AT_MS;
  const started = playbackRuntime("judge", "ruling", "started", {
    reducedMotion,
    startedAtMs,
  });
  if (reducedMotion) {
    return Object.freeze({
      captureAtMs: startedAtMs + 1,
      presentationRuntime: started.presentationRuntime,
    });
  }
  const captureAtMs = startedAtMs + COURTROOM_GAVEL_PHASE_MS;
  return Object.freeze({
    captureAtMs,
    presentationRuntime: advanceCourtroomPresentationRuntime(
      started.presentationRuntime,
      captureAtMs,
    ),
  });
}

function displayRuntime(
  from: CourtroomDisplayDescriptor,
  to: CourtroomDisplayDescriptor,
): RuntimeBuild {
  let presentationRuntime = createBaseRuntime("clerk", {
    baseDisplay: from,
    baseHead: visualHead(1),
    cameraShot: "evidence_display",
    observedAtMs: TRANSIENT_START_AT_MS - 1,
  });
  presentationRuntime = rebaseCourtroomPresentationRuntime(
    presentationRuntime,
    {
      baseFocus: "clerk",
      baseCameraShot: "evidence_display",
      baseDisplay: to,
      displayHead: visualHead(2),
      reducedMotion: false,
      observedAtMs: TRANSIENT_START_AT_MS,
    },
  );
  return Object.freeze({
    captureAtMs:
      TRANSIENT_START_AT_MS + Math.floor(COURTROOM_DISPLAY_TRANSITION_MS / 2),
    presentationRuntime,
  });
}

function steadyDisplayRuntime(display: CourtroomDisplayDescriptor): RuntimeBuild {
  return Object.freeze({
    captureAtMs: STATIC_CAPTURE_AT_MS,
    presentationRuntime: createBaseRuntime("clerk", {
      baseDisplay: display,
      baseHead: visualHead(2),
      cameraShot: "evidence_display",
    }),
  });
}

function fixture(input: FixtureInput): CourtroomVisualFixture {
  const runtimeSnapshot = selectCourtroomPresentationRuntime(
    input.presentationRuntime,
    input.captureAtMs,
  );
  return Object.freeze({
    frame: immutableFrame(
      input.presentationRuntime,
      runtimeSnapshot,
      input.activeSlot,
      input.activeAnimation,
      input.title,
    ),
    presentationRuntime: input.presentationRuntime,
    runtimeSnapshot,
    audibleSemanticPerformance: input.audibleSemanticPerformance ?? null,
    captureAtMs: input.captureAtMs,
    title: input.title,
  });
}

function staticAnimationFixture(
  title: string,
  activeSlot: SceneActorKey,
  activeAnimation: CourtroomAnimation,
  options: Readonly<{
    baseDisplay?: CourtroomDisplayDescriptor;
    cameraShot?: CourtroomPresentationFrame["camera"]["shot"];
  }> = {},
): CourtroomVisualFixture {
  const presentationRuntime = createBaseRuntime(activeSlot, {
    baseDisplay: options.baseDisplay,
    cameraShot: options.cameraShot,
  });
  return fixture({
    activeAnimation,
    activeSlot,
    captureAtMs: STATIC_CAPTURE_AT_MS,
    presentationRuntime,
    title,
  });
}

function playbackAnimationFixture(
  title: string,
  activeSlot: SceneActorKey,
  activeAnimation: CourtroomAnimation,
  purpose: HearingPlaybackPurpose,
  phase: PlaybackPhase,
  audibleSemanticPerformance: CourtroomAudibleSemanticPerformance | null,
): CourtroomVisualFixture {
  const built = playbackRuntime(
    activeSlot,
    purpose,
    phase,
    purpose === "ruling" && phase === "started"
      ? { startedAtMs: TRANSIENT_START_AT_MS }
      : {},
  );
  return fixture({
    activeAnimation,
    activeSlot,
    audibleSemanticPerformance,
    captureAtMs: built.captureAtMs,
    presentationRuntime: built.presentationRuntime,
    title,
  });
}

function displayFixture(
  title: string,
  built: RuntimeBuild,
  mode: "evidence" | "settlement",
): CourtroomVisualFixture {
  return fixture({
    activeAnimation: mode === "evidence" ? "presenting_evidence" : "listening",
    activeSlot: mode === "evidence" ? "user_counsel" : "clerk",
    captureAtMs: built.captureAtMs,
    presentationRuntime: built.presentationRuntime,
    title,
  });
}

function reducedSpeakingFixture(
  title: string,
  gesture: "stand" | "sit",
): CourtroomVisualFixture {
  const built = playbackRuntime("user_counsel", "transcript", "started", {
    reducedMotion: true,
  });
  return fixture({
    activeAnimation: "speaking",
    activeSlot: "user_counsel",
    audibleSemanticPerformance: roleSemantic(gesture),
    captureAtMs: built.captureAtMs,
    presentationRuntime: built.presentationRuntime,
    title,
  });
}

function unreachableState(stateId: never): never {
  throw new TypeError(`Unknown courtroom visual atlas state: ${String(stateId)}`);
}

export function createCourtroomVisualFixture(
  stateId: CourtroomVisualAtlasStateId,
): CourtroomVisualFixture {
  switch (stateId) {
    case "animation-idle-clerk":
      return staticAnimationFixture("Idle clerk", "clerk", "idle");
    case "animation-listening-jury":
      return staticAnimationFixture("Listening jury", "jury", "listening");
    case "animation-thinking-witness":
      return playbackAnimationFixture(
        "Thinking witness",
        "witness",
        "thinking",
        "testimony",
        "requested",
        null,
      );
    case "animation-speaking-witness":
      return playbackAnimationFixture(
        "Speaking witness",
        "witness",
        "speaking",
        "testimony",
        "started",
        witnessSemantic(),
      );
    case "animation-objecting-opposing-counsel":
      return playbackAnimationFixture(
        "Objecting counsel",
        "opposing_counsel",
        "objecting",
        "objection",
        "started",
        roleSemantic("open_palm"),
      );
    case "animation-standing-user-counsel":
      return playbackAnimationFixture(
        "Standing counsel",
        "user_counsel",
        "standing",
        "transcript",
        "requested",
        null,
      );
    case "animation-sitting-user-counsel":
      return staticAnimationFixture(
        "Sitting counsel",
        "user_counsel",
        "sitting",
      );
    case "animation-presenting-evidence-user-counsel":
      return staticAnimationFixture(
        "Counsel presenting synthetic evidence",
        "user_counsel",
        "presenting_evidence",
        {
          baseDisplay: EVIDENCE_A_ADMITTED,
          cameraShot: "evidence_display",
        },
      );
    case "animation-reacting-witness":
      return playbackAnimationFixture(
        "Reacting witness",
        "witness",
        "reacting",
        "correction",
        "requested",
        null,
      );
    case "animation-ruling-judge-ready":
      return playbackAnimationFixture(
        "Judge ready to rule",
        "judge",
        "ruling",
        "ruling",
        "requested",
        null,
      );
    case "animation-gavel-judge-active":
      return playbackAnimationFixture(
        "Judge gavel strike",
        "judge",
        "gavel",
        "ruling",
        "started",
        roleSemantic("none"),
      );
    case "evidence-enter":
      return displayFixture(
        "Synthetic evidence entering",
        displayRuntime(IDLE_DISPLAY, EVIDENCE_A_OFFERED),
        "evidence",
      );
    case "evidence-update":
      return displayFixture(
        "Synthetic evidence status update",
        displayRuntime(EVIDENCE_A_OFFERED, EVIDENCE_A_ADMITTED),
        "evidence",
      );
    case "evidence-switch":
      return displayFixture(
        "Synthetic evidence switch",
        displayRuntime(EVIDENCE_A_ADMITTED, EVIDENCE_B_EXCLUDED),
        "evidence",
      );
    case "evidence-exit":
      return displayFixture(
        "Synthetic evidence exiting",
        displayRuntime(EVIDENCE_A_ADMITTED, IDLE_DISPLAY),
        "evidence",
      );
    case "evidence-steady":
      return displayFixture(
        "Synthetic evidence steady",
        steadyDisplayRuntime(EVIDENCE_A_ADMITTED),
        "evidence",
      );
    case "settlement-enter":
      return displayFixture(
        "Private settlement status entering",
        displayRuntime(IDLE_DISPLAY, SETTLEMENT_OPEN),
        "settlement",
      );
    case "settlement-update":
      return displayFixture(
        "Private settlement status update",
        displayRuntime(SETTLEMENT_OPEN, SETTLEMENT_COUNTERED),
        "settlement",
      );
    case "settlement-steady":
      return displayFixture(
        "Private settlement status steady",
        steadyDisplayRuntime(SETTLEMENT_COUNTERED),
        "settlement",
      );
    case "settlement-exit":
      return displayFixture(
        "Private settlement status exiting",
        displayRuntime(SETTLEMENT_COUNTERED, IDLE_DISPLAY),
        "settlement",
      );
    case "ruling-holding-judge": {
      const built = holdingRulingRuntime();
      return fixture({
        activeAnimation: "ruling",
        activeSlot: "judge",
        audibleSemanticPerformance: roleSemantic("small_nod"),
        captureAtMs: built.captureAtMs,
        presentationRuntime: built.presentationRuntime,
        title: "Judge holding the ruling",
      });
    }
    case "reduced-motion-speaking-model-stand":
      return reducedSpeakingFixture(
        "Reduced motion with inert stand cue",
        "stand",
      );
    case "reduced-motion-speaking-model-sit":
      return reducedSpeakingFixture(
        "Reduced motion with inert sit cue",
        "sit",
      );
    case "reduced-motion-ruling-model-gavel": {
      const built = holdingRulingRuntime(true);
      return fixture({
        activeAnimation: "ruling",
        activeSlot: "judge",
        audibleSemanticPerformance: roleSemantic("gavel"),
        captureAtMs: built.captureAtMs,
        presentationRuntime: built.presentationRuntime,
        title: "Reduced motion with inert gavel cue",
      });
    }
  }
  return unreachableState(stateId);
}
