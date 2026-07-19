import {
  HearingRuntimeViewV1Schema,
  HearingPlayerIntent,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";
import {
  FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
  FinalBoundInterruptionRequestSchema,
  FinalBoundInterruptionResolutionSchema,
  FinalBoundInterruptionResponseSchema,
  type FinalBoundInterruptionRequest,
  type FinalBoundInterruptionResolution,
  type FinalBoundInterruptionResponse,
} from "@/domain/objections/final-bound-contracts";
import {
  CACHED_OBJECTION_CLIP_ID,
  PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION,
  PartialObjectionCoordinator,
  type CachedObjectionReaction,
  type PartialObjectionCoordinatorError,
  type PartialObjectionDeliveryFence,
  type PartialObjectionEnvelope,
  type PartialObjectionHead,
} from "@/domain/objections/partial-coordinator";

import {
  BrowserAudioCaptureController,
  AudioCaptureError,
  CAPTURE_SAMPLE_RATE_HZ,
  type AudioCaptureControllerOptions,
  type AudioCaptureFrame,
  type AudioCaptureSnapshot,
  type AudioCaptureStatus,
} from "./audio-capture";
import {
  BrowserAudioPlaybackController,
  AudioPlaybackError,
  type AudioPlaybackCompletion,
  type AudioPlaybackControllerOptions,
  type AudioPlaybackJobIdentity,
  type AudioPlaybackStatus,
  type AudioPlaybackTimingBatch,
} from "./audio-playback";
import {
  LocalSpeechClient,
  SpeechClientError,
  type CancelSynthesisRequest,
  type SpeechClientEvent,
  type SpeechClientOptions,
  type SpeechConnectionInfo,
  type StartUtteranceOptions,
  type SynthesisRequest,
} from "./client";
import {
  freezeHearingVoiceContext,
  HearingVoicePolicyError,
  selectSpeakableTranscriptDelta,
  splitSpeechPhrases,
  validateHearingVoiceContext,
  voiceContextToIntent,
  type HearingSpeechViewSource,
  type HearingVoiceContext,
  type HearingVoiceInputMode,
} from "./hearing-policy";
import {
  assertSpeechIdentifier,
  type SpeechCapabilitiesEvent,
} from "./protocol";

const MAX_JOBS_PER_RESPONSE = 64;
const DEFAULT_FINAL_TIMEOUT_MS = 20_000;
const DEFAULT_TTS_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 100;
const SPEAKER_TEST_CLIP_ID = "courtroom.sustained.v1";
const SPEAKER_TEST_PHRASE = "Sustained. Local courtroom audio is ready.";
const SUSTAINED_CLIP_ID = "courtroom.sustained.v1";
const OVERRULED_CLIP_ID = "courtroom.overruled.v1";
const OBJECTION_ACTOR_ID = "actor.opposing_counsel.objection";
const JUDGE_ACTOR_ID = "actor.judge";
const COURTROOM_DIRECTOR_ACTOR_ID = "actor.courtroom.director";
const WITHDRAWAL_CORRECTION_PHRASE =
  "Correction. The objection is withdrawn.";
const MAX_RECENT_SAME_LEG_QUESTIONS = 32;
const TRANSCRIPT_DIVERGED_MESSAGE =
  "The courtroom transcript changed unexpectedly; earlier turns will not be replayed.";

export type HearingControllerLifecycle =
  | "idle"
  | "preparing"
  | "ready"
  | "recording"
  | "processing"
  | "speaking"
  | "recoverable_error"
  | "fatal_error"
  | "closed";

export type HearingCapabilityProviderSummary = Readonly<{
  providerId: string;
  kind: "stt" | "tts" | "vad";
  ready: boolean;
  loaded: boolean;
  device: "cuda" | "cpu" | "fake" | "unavailable";
  supportsStreaming: boolean;
  supportsTimings: boolean;
  warmupLatencyMs: number | null;
}>;

export type HearingCapabilitySummary = Readonly<{
  serviceMode: "fake" | "cpu" | "cuda";
  cuda: Readonly<{
    available: boolean;
    deviceName: string | null;
  }>;
  providers: readonly HearingCapabilityProviderSummary[];
  warmupCompleted: boolean;
  warmupLatencyMs: number | null;
  cachedClipIds: readonly string[];
  maxTtsQueueDepth: number;
}>;

export type HearingControllerSnapshot = Readonly<{
  lifecycle: HearingControllerLifecycle;
  code: string | null;
  message: string | null;
  partialText: string;
  activeMode: HearingVoiceInputMode | null;
  capabilities: HearingCapabilitySummary | null;
  captureStatus: AudioCaptureStatus;
  playbackStatus: AudioPlaybackStatus;
}>;

export type HearingFinalSubmission = Readonly<{
  context: HearingVoiceContext;
  text: string;
  intent: HearingPlayerIntent;
}>;

/**
 * Injected protected transport. The controller never owns credentials or a
 * remote endpoint, and treats the returned value as untrusted until parsed.
 */
export type HearingFinalBoundInterruptionPort = (
  request: FinalBoundInterruptionRequest,
  signal: AbortSignal,
) => Promise<unknown>;

export interface HearingSpeechClientPort {
  subscribe(listener: (event: SpeechClientEvent) => void): () => void;
  connect(): Promise<SpeechConnectionInfo>;
  loadModels(options?: {
    readonly requestId?: string;
    readonly sttProvider?: string;
    readonly ttsProvider?: string;
    readonly warmup?: boolean;
  }): Promise<SpeechCapabilitiesEvent>;
  startUtterance(options: StartUtteranceOptions): void;
  sendPcmFrame(utteranceId: string, samples: Int16Array): number;
  endUtterance(utteranceId: string): void;
  cancelUtterance(utteranceId: string, reason?: string): void;
  synthesize(request: SynthesisRequest): void;
  cancelSynthesis(request: CancelSynthesisRequest): void;
  disconnect(reason?: string): void;
}

export interface HearingAudioCapturePort {
  readonly state: AudioCaptureSnapshot;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface HearingAudioPlaybackPort {
  readonly status: AudioPlaybackStatus;
  activateResponse(responseId: string): Promise<void>;
  startJob(identity: AudioPlaybackJobIdentity): Promise<AudioPlaybackCompletion>;
  enqueueFrame(frame: {
    readonly jobId: string;
    readonly responseId: string;
    readonly actor: string;
    readonly sequence: number;
    readonly frameSequence: number;
    readonly byteLength: number;
    readonly durationMs: number;
    readonly sampleRateHz: number;
    readonly channels: 1;
    readonly encoding: "pcm_s16le";
    readonly pcm: ArrayBuffer;
  }): unknown;
  addTiming(batch: AudioPlaybackTimingBatch): void;
  finishJob(identity: AudioPlaybackJobIdentity): Promise<AudioPlaybackCompletion>;
  bargeIn(): void;
  close(): Promise<void>;
}

export type HearingSpeechClientFactory = (
  options: SpeechClientOptions,
) => HearingSpeechClientPort;
export type HearingAudioCaptureFactory = (
  options: AudioCaptureControllerOptions,
) => HearingAudioCapturePort;
export type HearingAudioPlaybackFactory = (
  options: AudioPlaybackControllerOptions,
) => HearingAudioPlaybackPort;

export type HearingControllerOptions = Readonly<{
  url: string;
  getView: () => HearingRuntimeViewV1 | null;
  getActivity: () => Readonly<{ busy: boolean; pending: boolean }>;
  commitFinal: (submission: HearingFinalSubmission) => Promise<void>;
  interruptFinal?: HearingFinalBoundInterruptionPort;
  onInterruptionPending?: (response: FinalBoundInterruptionResponse) => void;
  clientId?: string;
  idFactory?: (prefix: string) => string;
  onStateChange?: (snapshot: HearingControllerSnapshot) => void;
  clientFactory?: HearingSpeechClientFactory;
  captureFactory?: HearingAudioCaptureFactory;
  playbackFactory?: HearingAudioPlaybackFactory;
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
  finalTimeoutMs?: number;
  ttsTimeoutMs?: number;
}>;

export class HearingControllerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HearingControllerError";
  }
}

type DeferredResult = Readonly<{
  promise: Promise<HearingControllerError | null>;
  resolve: (error: HearingControllerError | null) => void;
}>;

type RecordingState = {
  generation: number;
  utteranceId: string;
  mode: HearingVoiceInputMode;
  context: HearingVoiceContext;
  finalReceived: DeferredResult;
  completion: DeferredResult;
  lastRevision: number;
  finalHandled: boolean;
  commitStarted: boolean;
  postCommitRecovery: HearingControllerError | null;
  stopPromise: Promise<void> | null;
  partialGeneration: number | null;
  partialHead: PartialObjectionHead | null;
  partialSourceView: HearingRuntimeViewV1 | null;
  partialInterruption: PartialInterruptionState | null;
};

type PartialInterruptionState = {
  readonly generation: number;
  readonly head: PartialObjectionHead;
  readonly reaction: CachedObjectionReaction;
  envelope: PartialObjectionEnvelope | null;
  finalRevision: number | null;
  finalText: string | null;
  durableResponse: FinalBoundInterruptionResolution | null;
  reactionPlayback: Promise<void> | null;
  candidateCorrectionCompleted: boolean;
};

type PlaybackJobState = {
  generation: number;
  playbackFence: number;
  identity: AudioPlaybackJobIdentity;
  completion: DeferredResult;
  started: boolean;
};

type PreparationFailure = Readonly<{
  generation: number;
  error: HearingControllerError;
}>;

type DeveloperSubmissionState = {
  generation: number;
  failure: HearingControllerError | null;
};

type SpeechUnit = Readonly<{
  actor: string;
  text?: string;
  clipId?: string;
}>;

function activePartialInterruption(
  recording: RecordingState,
): PartialInterruptionState | null {
  return recording.partialInterruption;
}

const SAFE_MESSAGES = Object.freeze({
  CLOSED: "The local hearing audio controller is closed.",
  NOT_READY: "Local courtroom audio is not ready.",
  INVALID_TIMEOUT: "A local courtroom audio timeout is invalid.",
  CAPABILITIES_UNAVAILABLE:
    "The local speech companion is not ready for streaming recognition and speech.",
  PREPARE_FAILED: "Local courtroom audio could not be prepared.",
  RECORDING_FAILED: "Microphone input could not be recorded safely.",
  STT_BACKPRESSURE:
    "The local speech companion could not accept microphone input quickly enough.",
  FINAL_TIMEOUT: "The local speech companion did not finish recognition in time.",
  STALE_FINAL: "The courtroom changed before that spoken action could be committed.",
  COMMIT_FAILED: "The spoken courtroom action could not be committed.",
  PLAYBACK_FAILED: "Local courtroom speech could not be played.",
  PLAYBACK_TIMEOUT: "Local courtroom speech did not finish in time.",
  SPEECH_CANCELLED: "Local courtroom speech was cancelled.",
  SPEECH_DISCONNECTED: "The local speech companion disconnected.",
  SPEECH_SERVICE_ERROR: "The local speech companion reported an error.",
  INVALID_IDENTIFIER: "A local speech operation identifier was invalid.",
  INVALID_TEXT: "The spoken courtroom text was empty or too long.",
  BUSY: "Another local courtroom audio operation is already active.",
  BARGED_IN: "Courtroom speech was interrupted by microphone input.",
  CLOSE_FAILED: "Local courtroom audio could not be fully released.",
  INTERRUPTION_FAILED:
    "The mid-question objection could not be resolved safely. Please repeat the question.",
  INTERRUPTION_STALE:
    "The courtroom changed while the mid-question objection was being resolved.",
  REACTION_UNAVAILABLE:
    "The cached courtroom objection reaction is unavailable.",
});

function createDeferredResult(): DeferredResult {
  let settled = false;
  let settle: ((error: HearingControllerError | null) => void) | null = null;
  const promise = new Promise<HearingControllerError | null>((resolve) => {
    settle = resolve;
  });
  return Object.freeze({
    promise,
    resolve(error: HearingControllerError | null): void {
      if (settled || settle === null) return;
      settled = true;
      settle(error);
    },
  });
}

function defaultIdFactory(prefix: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  return `${prefix}-${suffix}`;
}

function freezeSnapshot(
  value: HearingControllerSnapshot,
): HearingControllerSnapshot {
  return Object.freeze({ ...value });
}

function summarizeCapabilities(
  connection: SpeechConnectionInfo,
  capabilities: SpeechCapabilitiesEvent,
): HearingCapabilitySummary {
  const providers = Object.freeze(
    capabilities.providers.map((provider) =>
      Object.freeze({
        providerId: provider.providerId,
        kind: provider.kind,
        ready: provider.ready,
        loaded: provider.loaded,
        device: provider.device,
        supportsStreaming: provider.supportsStreaming,
        supportsTimings: provider.supportsTimings,
        warmupLatencyMs: provider.warmupLatencyMs ?? null,
      }),
    ),
  );
  const requiredProviders = providers.filter(
    (provider) => provider.kind === "stt" || provider.kind === "tts",
  );
  const warmups = requiredProviders
    .map((provider) => provider.warmupLatencyMs)
    .filter((value): value is number => value !== null);
  return Object.freeze({
    serviceMode: connection.ready.mode,
    cuda: Object.freeze({
      available: capabilities.cuda.available,
      deviceName: capabilities.cuda.deviceName ?? null,
    }),
    providers,
    warmupCompleted: requiredProviders.every(
      (provider) => provider.loaded && provider.ready,
    ),
    warmupLatencyMs: warmups.length === 0 ? null : Math.max(...warmups),
    cachedClipIds: Object.freeze([...capabilities.cachedClipIds]),
    maxTtsQueueDepth: capabilities.maxTtsQueueDepth,
  });
}

function supportsRequiredSpeech(capabilities: SpeechCapabilitiesEvent): boolean {
  const streamingStt = capabilities.providers.some(
    (provider) =>
      provider.kind === "stt" &&
      provider.loaded &&
      provider.ready &&
      provider.supportsStreaming,
  );
  const readyTts = capabilities.providers.some(
    (provider) =>
      provider.kind === "tts" &&
      provider.loaded &&
      provider.ready &&
      provider.supportsStreaming,
  );
  return streamingStt && readyTts;
}

function safeActorId(actor: HearingRuntimeViewV1["transcript"][number]["actor"]): string {
  let hash = 2_166_136_261;
  for (const character of actor.actorId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `actor.${actor.role}.${(hash >>> 0).toString(36)}`;
}

function normalizeText(text: string, mode: HearingVoiceInputMode): string {
  const normalized = text.trim().replace(/\s+/gu, " ");
  const maximum = mode === "question" ? 8_000 : 20_000;
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new HearingControllerError("INVALID_TEXT", SAFE_MESSAGES.INVALID_TEXT);
  }
  return normalized;
}

function sameBaseline(
  expected: HearingRuntimeViewV1 | null,
  supplied: HearingRuntimeViewV1 | null,
): boolean {
  if (expected === null || supplied === null) return expected === supplied;
  if (
    expected.trial.trialId !== supplied.trial.trialId ||
    expected.trial.version !== supplied.trial.version ||
    expected.trial.lastEventId !== supplied.trial.lastEventId ||
    expected.transcript.length !== supplied.transcript.length
  ) {
    return false;
  }
  return expected.transcript.every(
    (turn, index) => turn.turnId === supplied.transcript[index]?.turnId,
  );
}

function headFromView(view: HearingRuntimeViewV1): PartialObjectionHead {
  return Object.freeze({
    trialId: view.trial.trialId,
    stateVersion: view.trial.version,
    lastEventId: view.trial.lastEventId,
  });
}

function sameHead(
  expected: PartialObjectionHead,
  supplied: PartialObjectionHead,
): boolean {
  return (
    expected.trialId === supplied.trialId &&
    expected.stateVersion === supplied.stateVersion &&
    expected.lastEventId === supplied.lastEventId
  );
}

function viewMatchesHead(
  view: HearingRuntimeViewV1 | null,
  head: PartialObjectionHead,
): boolean {
  return view !== null && sameHead(headFromView(view), head);
}

function recentSameLegQuestionTexts(
  view: HearingRuntimeViewV1,
): readonly string[] {
  const answeredCount = view.activeAppearance?.examinationLeg?.answeredQuestionCount;
  if (answeredCount === undefined || answeredCount <= 0) return Object.freeze([]);
  const limit = Math.min(answeredCount, MAX_RECENT_SAME_LEG_QUESTIONS);
  return Object.freeze(
    view.transcript
      .filter(
        (turn) =>
          turn.status === "active" &&
          turn.actor.actorId === view.player.actorId &&
          turn.actor.role === view.player.actorRole,
      )
      .slice(-limit)
      .map((turn) => turn.text),
  );
}

function controllerError(cause: unknown): HearingControllerError {
  if (cause instanceof HearingControllerError) return cause;
  if (
    cause instanceof HearingVoicePolicyError ||
    cause instanceof AudioCaptureError ||
    cause instanceof AudioPlaybackError
  ) {
    return new HearingControllerError(cause.code, cause.message);
  }
  if (cause instanceof SpeechClientError && cause.code === "STT_BACKPRESSURE") {
    return new HearingControllerError(
      "STT_BACKPRESSURE",
      SAFE_MESSAGES.STT_BACKPRESSURE,
    );
  }
  if (cause instanceof SpeechClientError) {
    return new HearingControllerError(
      cause.code,
      SAFE_MESSAGES.SPEECH_SERVICE_ERROR,
    );
  }
  return new HearingControllerError("CONTROLLER_FAILURE", SAFE_MESSAGES.PREPARE_FAILED);
}

function assertTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS) {
    throw new HearingControllerError("INVALID_TIMEOUT", SAFE_MESSAGES.INVALID_TIMEOUT);
  }
  return value;
}

export class HearingController {
  private readonly options: HearingControllerOptions;
  private readonly idFactory: (prefix: string) => string;
  private readonly client: HearingSpeechClientPort;
  private readonly capture: HearingAudioCapturePort;
  private readonly playback: HearingAudioPlaybackPort;
  private readonly finalTimeoutMs: number;
  private readonly ttsTimeoutMs: number;
  private readonly partialObjections: PartialObjectionCoordinator<FinalBoundInterruptionResolution> | null;
  private readonly listeners = new Set<
    (snapshot: HearingControllerSnapshot) => void
  >();
  private readonly deliveredInterruptionRulings = new Set<string>();

  private snapshotValue: HearingControllerSnapshot;
  private generation = 0;
  private partialInterruptionGeneration = 0;
  private playbackFence = 0;
  private unsubscribeClient: (() => void) | null = null;
  private recording: RecordingState | null = null;
  private activePlaybackJob: PlaybackJobState | null = null;
  private activePlaybackResponseId: string | null = null;
  private frameForwarding = false;
  private baseline: HearingRuntimeViewV1 | null = null;
  private clientSessionReady = false;
  private preparingGeneration: number | null = null;
  private preparationFailure: PreparationFailure | null = null;
  private developerSubmission: DeveloperSubmissionState | null = null;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: HearingControllerOptions) {
    this.options = options;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.finalTimeoutMs = assertTimeout(
      options.finalTimeoutMs ?? DEFAULT_FINAL_TIMEOUT_MS,
    );
    this.ttsTimeoutMs = assertTimeout(
      options.ttsTimeoutMs ?? DEFAULT_TTS_TIMEOUT_MS,
    );

    const clientFactory =
      options.clientFactory ??
      ((clientOptions: SpeechClientOptions) =>
        new LocalSpeechClient(clientOptions));
    const captureFactory =
      options.captureFactory ??
      ((captureOptions: AudioCaptureControllerOptions) =>
        new BrowserAudioCaptureController(captureOptions));
    const playbackFactory =
      options.playbackFactory ??
      ((playbackOptions: AudioPlaybackControllerOptions) =>
        new BrowserAudioPlaybackController(playbackOptions));

    const clientId = assertSpeechIdentifier(
      options.clientId ?? this.createId("hearing-client"),
    );
    this.client = clientFactory({
      url: options.url,
      clientId,
      idFactory: this.idFactory,
      ...(options.handshakeTimeoutMs === undefined
        ? {}
        : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
    });
    this.capture = captureFactory({
      onFrame: (frame) => this.handleCaptureFrame(frame),
      onStateChange: (snapshot) => this.handleCaptureState(snapshot),
    });
    this.playback = playbackFactory({
      maxJobsPerResponse: MAX_JOBS_PER_RESPONSE,
      onStatusChange: (status) => this.handlePlaybackStatus(status),
    });
    this.snapshotValue = freezeSnapshot({
      lifecycle: "idle",
      code: null,
      message: null,
      partialText: "",
      activeMode: null,
      capabilities: null,
      captureStatus: this.capture.state.status,
      playbackStatus: this.playback.status,
    });
    this.partialObjections =
      options.interruptFinal === undefined
        ? null
        : new PartialObjectionCoordinator<FinalBoundInterruptionResolution>({
            modelDispatch: "after_final_seal",
            requestModelCandidate: (envelope, signal) =>
              this.requestFinalBoundInterruption(envelope, signal),
            onCachedReaction: (reaction, signal) =>
              this.startCachedObjectionReaction(reaction, signal),
            onModelResult: (envelope, result, fence) =>
              this.deliverFinalBoundInterruption(envelope, result, fence),
            onError: (error) => this.handlePartialObjectionError(error),
          });
  }

  get snapshot(): HearingControllerSnapshot {
    return this.snapshotValue;
  }

  subscribe(listener: (snapshot: HearingControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async prepare(): Promise<HearingControllerSnapshot> {
    this.assertOpen();
    if (
      this.preparingGeneration !== null ||
      this.developerSubmission !== null ||
      this.recording !== null
    ) {
      throw new HearingControllerError("BUSY", SAFE_MESSAGES.BUSY);
    }
    if (
      this.snapshotValue.lifecycle !== "idle" &&
      this.snapshotValue.lifecycle !== "recoverable_error"
    ) {
      if (this.snapshotValue.lifecycle === "ready") return this.snapshotValue;
      throw new HearingControllerError("BUSY", SAFE_MESSAGES.BUSY);
    }

    const generation = ++this.generation;
    this.preparingGeneration = generation;
    this.preparationFailure = null;
    this.unsubscribeClient?.();
    this.unsubscribeClient = this.client.subscribe((event) => {
      if (generation !== this.generation || this.closed) return;
      this.handleClientEvent(event, generation);
    });
    this.setSnapshot({
      lifecycle: "preparing",
      code: null,
      message: null,
      partialText: "",
      activeMode: null,
    });

    try {
      const connection = await this.client.connect();
      this.assertPreparationHealthy(generation);
      this.clientSessionReady = true;
      const capabilities = await this.client.loadModels({ warmup: true });
      this.assertPreparationHealthy(generation);
      const summary = summarizeCapabilities(connection, capabilities);
      this.setSnapshot({ capabilities: summary });
      this.assertPreparationHealthy(generation);
      if (!supportsRequiredSpeech(capabilities)) {
        throw new HearingControllerError(
          "CAPABILITIES_UNAVAILABLE",
          SAFE_MESSAGES.CAPABILITIES_UNAVAILABLE,
        );
      }

      this.frameForwarding = false;
      await this.capture.start();
      this.assertPreparationHealthy(generation);
      await this.capture.stop();
      this.assertPreparationHealthy(generation);
      this.preparingGeneration = null;
      this.preparationFailure = null;
      this.setSnapshot({
        lifecycle: "ready",
        code: null,
        message: null,
        partialText: "",
        activeMode: null,
      });
      return this.snapshotValue;
    } catch (cause) {
      this.frameForwarding = false;
      try {
        await this.capture.stop();
      } catch {
        // The primary safe preparation error is retained below.
      }
      if (generation !== this.generation || this.closed) {
        throw new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED);
      }
      const recordedFailure = this.preparationErrorFor(generation);
      const error = recordedFailure ?? controllerError(cause);
      this.preparingGeneration = null;
      this.preparationFailure = null;
      this.setRecoverable(error);
      throw error;
    }
  }

  async speakerTest(): Promise<void> {
    this.requireReady();
    const clipAvailable =
      this.snapshotValue.capabilities?.cachedClipIds.includes(
        SPEAKER_TEST_CLIP_ID,
      ) ?? false;
    await this.speakUnits([
      Object.freeze(
        clipAvailable
          ? { actor: "actor.judge", clipId: SPEAKER_TEST_CLIP_ID }
          : { actor: "actor.judge", text: SPEAKER_TEST_PHRASE },
      ),
    ]);
  }

  baselineView(view: HearingRuntimeViewV1): void {
    this.assertOpen();
    const selection = selectSpeakableTranscriptDelta(view, view, "baseline");
    if (!selection.ok) {
      throw new HearingControllerError(selection.code, selection.message);
    }
    this.baseline = view;
    this.partialObjections?.invalidateHead(headFromView(view));
  }

  async adoptView(
    previous: HearingRuntimeViewV1 | null,
    next: HearingRuntimeViewV1,
    source: HearingSpeechViewSource,
  ): Promise<void> {
    this.requireReady();
    if (!sameBaseline(this.baseline, previous)) {
      const error = new HearingControllerError(
        "TRANSCRIPT_DIVERGED",
        TRANSCRIPT_DIVERGED_MESSAGE,
      );
      this.setRecoverable(error);
      throw error;
    }
    const selection = selectSpeakableTranscriptDelta(this.baseline, next, source);
    if (!selection.ok) {
      const error = new HearingControllerError(selection.code, selection.message);
      this.setRecoverable(error);
      throw error;
    }
    // Adopt the durable head before phrase construction: an irreparable model
    // turn must be reported once, never replayed or allowed to deadlock later heads.
    this.baseline = next;
    this.partialObjections?.invalidateHead(headFromView(next));
    const units: SpeechUnit[] = [];
    try {
      for (const turn of selection.turns) {
        const actor = safeActorId(turn.actor);
        for (const phrase of splitSpeechPhrases(turn.text)) {
          units.push(Object.freeze({ actor, text: phrase }));
        }
      }
    } catch (cause) {
      const error = controllerError(cause);
      this.setRecoverable(error);
      throw error;
    }
    if (units.length > 0) await this.speakUnits(units);
  }

  /**
   * Adopt an owner-recovered interruption after reload or a failed witness
   * continuation. The durable head advances before local audio, and exact
   * ruling/answer authority comes only from the strict protected response.
   */
  async adoptRecoveredInterruption(
    previous: HearingRuntimeViewV1,
    responseInput: FinalBoundInterruptionResponse,
  ): Promise<void> {
    this.requireReady();
    const response = FinalBoundInterruptionResponseSchema.parse(responseInput);
    if (!sameBaseline(this.baseline, previous)) {
      const error = new HearingControllerError(
        "TRANSCRIPT_DIVERGED",
        TRANSCRIPT_DIVERGED_MESSAGE,
      );
      this.setRecoverable(error);
      throw error;
    }
    const previousHead = previous.trial;
    const nextHead = response.view.trial;
    if (
      previousHead.trialId !== nextHead.trialId ||
      nextHead.version < previousHead.version ||
      (nextHead.version === previousHead.version &&
        nextHead.lastEventId !== previousHead.lastEventId)
    ) {
      const error = new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
      this.setRecoverable(error);
      throw error;
    }
    this.baseline = response.view;
    this.partialObjections?.invalidateHead(headFromView(response.view));
    if (response.performance.disposition === "historical") return;
    const answerUnits = this.recoveredWitnessUnits(response);

    if (!this.deliveredInterruptionRulings.has(response.interruptId)) {
      const clipId =
        response.ruling === "sustained"
          ? SUSTAINED_CLIP_ID
          : OVERRULED_CLIP_ID;
      const clipAvailable =
        this.snapshotValue.capabilities?.cachedClipIds.includes(clipId) ??
        false;
      await this.speakUnits([
        Object.freeze(
          clipAvailable
            ? { actor: JUDGE_ACTOR_ID, clipId }
            : {
                actor: JUDGE_ACTOR_ID,
                text:
                  response.ruling === "sustained"
                    ? "Sustained."
                    : "Overruled.",
              },
        ),
      ]);
      this.deliveredInterruptionRulings.add(response.interruptId);
    }
    if (answerUnits.length > 0) await this.speakUnits(answerUnits);
  }

  async startRecording(mode: HearingVoiceInputMode): Promise<void> {
    this.requirePreparedForRecording();
    const context = this.freezeAndValidate(mode);
    const interruptionView =
      mode === "question" && this.partialObjections !== null
        ? this.currentViewForContext(context)
        : null;
    const generation = this.generation;
    this.setSnapshot({
      lifecycle: "preparing",
      code: null,
      message: null,
      partialText: "",
      activeMode: mode,
    });

    try {
      this.interruptPlaybackForRecording();
      this.frameForwarding = false;
      await this.capture.start();
      this.assertGeneration(generation);
      const utteranceId = this.createId("utterance");
      const partialGeneration =
        interruptionView === null ? null : ++this.partialInterruptionGeneration;
      const partialSourceView =
        interruptionView === null
          ? null
          : HearingRuntimeViewV1Schema.parse(interruptionView);
      const partialHead =
        partialSourceView === null ? null : headFromView(partialSourceView);
      const recording: RecordingState = {
        generation,
        utteranceId,
        mode,
        context,
        finalReceived: createDeferredResult(),
        completion: createDeferredResult(),
        lastRevision: 0,
        finalHandled: false,
        commitStarted: false,
        postCommitRecovery: null,
        stopPromise: null,
        partialGeneration,
        partialHead,
        partialSourceView,
        partialInterruption: null,
      };
      if (
        interruptionView !== null &&
        partialSourceView !== null &&
        partialGeneration !== null &&
        partialHead !== null &&
        !this.partialObjections?.openUtterance({
          schemaVersion: PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION,
          generation: partialGeneration,
          head: partialHead,
          utteranceId,
          detectorContext: {
            speechKind: "question",
            examinationLeg: context.examinationKind,
            permittedGrounds: Object.freeze([
              ...partialSourceView.permittedObjectionGrounds,
            ]),
            recentQuestionTexts:
              recentSameLegQuestionTexts(partialSourceView),
            evidenceFoundationMissing: false,
            topicRelation: "unknown",
            privilegeContext: "unknown",
            thirdPartyStatementPurpose: "unknown",
            thirdPartyStatementException: "unknown",
            argumentativeContext: "unknown",
            personalKnowledgeContext: "unknown",
          },
        })
      ) {
        throw new HearingControllerError(
          "INTERRUPTION_FAILED",
          SAFE_MESSAGES.INTERRUPTION_FAILED,
        );
      }
      this.client.startUtterance({
        utteranceId,
        sampleRateHz: CAPTURE_SAMPLE_RATE_HZ,
        bargeIn: true,
      });
      this.recording = recording;
      this.frameForwarding = true;
      this.setSnapshot({
        lifecycle: "recording",
        code: null,
        message: null,
        partialText: "",
        activeMode: mode,
      });
    } catch (cause) {
      this.frameForwarding = false;
      try {
        await this.capture.stop();
      } catch {
        // The primary safe recording error is retained below.
      }
      const error = this.recordingError(cause);
      this.setRecoverable(error);
      throw error;
    }
  }

  stopRecording(): Promise<void> {
    const recording = this.recording;
    if (recording === null || recording.generation !== this.generation) {
      return Promise.reject(
        new HearingControllerError("NOT_RECORDING", SAFE_MESSAGES.NOT_READY),
      );
    }
    if (recording.stopPromise !== null) return recording.stopPromise;
    this.frameForwarding = false;
    const pending = Promise.resolve().then(() =>
      this.stopRecordingInternal(recording),
    );
    recording.stopPromise = pending;
    return pending;
  }

  private async stopRecordingInternal(recording: RecordingState): Promise<void> {
    this.frameForwarding = false;
    try {
      await this.capture.stop();
      if (
        recording.generation !== this.generation ||
        this.recording !== recording ||
        this.closed
      ) {
        const closedError = await recording.completion.promise;
        throw (
          closedError ??
          new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED)
        );
      }
      if (!recording.finalHandled) this.client.endUtterance(recording.utteranceId);
      if (!recording.finalHandled) {
        this.setSnapshot({ lifecycle: "processing", partialText: "" });
      }
    } catch (cause) {
      const error = this.recordingError(cause);
      await this.failRecording(recording, error);
      throw error;
    }

    const finalError = await this.waitForResult(
      recording.finalReceived.promise,
      this.finalTimeoutMs,
      new HearingControllerError("FINAL_TIMEOUT", SAFE_MESSAGES.FINAL_TIMEOUT),
    );
    if (finalError !== null) {
      if (!recording.finalHandled) await this.failRecording(recording, finalError);
      throw finalError;
    }
    const completionError = await recording.completion.promise;
    if (completionError !== null) throw completionError;
  }

  async submitDeveloperFinal(
    mode: HearingVoiceInputMode,
    text: string,
  ): Promise<void> {
    this.requireReady();
    const context = this.freezeAndValidate(mode);
    const normalized = normalizeText(text, context.mode);
    const generation = this.generation;
    const submissionState: DeveloperSubmissionState = {
      generation,
      failure: null,
    };
    this.developerSubmission = submissionState;
    this.setSnapshot({
      lifecycle: "processing",
      code: null,
      message: null,
      partialText: "",
      activeMode: mode,
    });
    try {
      await this.commitValidatedFinal(context, normalized, generation);
      this.assertGeneration(generation);
      if (this.developerSubmission !== submissionState) {
        throw new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED);
      }
      this.developerSubmission = null;
      if (submissionState.failure !== null) {
        if (this.snapshotValue.lifecycle !== "fatal_error") {
          this.setRecoverable(submissionState.failure);
        }
        return;
      }
      this.setSnapshot({
        lifecycle: "ready",
        code: null,
        message: null,
        partialText: "",
        activeMode: null,
      });
    } catch (cause) {
      if (this.developerSubmission === submissionState) {
        this.developerSubmission = null;
      }
      const error = submissionState.failure ?? this.finalError(cause);
      this.setRecoverable(error);
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    if (this.closed) return Promise.resolve();
    ++this.generation;
    ++this.playbackFence;
    this.preparingGeneration = null;
    this.preparationFailure = null;
    this.developerSubmission = null;
    this.closed = true;
    this.unsubscribeClient?.();
    this.unsubscribeClient = null;
    this.frameForwarding = false;
    this.partialObjections?.close();
    const recording = this.recording;
    this.recording = null;
    const playbackJob = this.activePlaybackJob;
    this.activePlaybackJob = null;
    this.activePlaybackResponseId = null;
    recording?.completion.resolve(
      new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED),
    );
    recording?.finalReceived.resolve(
      new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED),
    );
    playbackJob?.completion.resolve(
      new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED),
    );

    const pending = Promise.resolve().then(() => this.closeInternal(recording));
    this.closePromise = pending;
    return pending;
  }

  private async closeInternal(recording: RecordingState | null): Promise<void> {
    let failed = false;
    try {
      await this.capture.stop();
    } catch {
      failed = true;
    }
    if (recording !== null && !recording.finalHandled) {
      try {
        this.client.cancelUtterance(recording.utteranceId, "controller_closed");
      } catch {
        failed = true;
      }
    }
    if (this.clientSessionReady) {
      try {
        this.client.cancelSynthesis({ scope: "all", reason: "controller_closed" });
      } catch {
        failed = true;
      }
    }
    try {
      await this.playback.close();
    } catch {
      failed = true;
    }
    try {
      this.client.disconnect("controller_closed");
    } catch {
      failed = true;
    }
    this.setSnapshot({
      lifecycle: "closed",
      code: failed ? "CLOSE_FAILED" : null,
      message: failed ? SAFE_MESSAGES.CLOSE_FAILED : null,
      partialText: "",
      activeMode: null,
      captureStatus: this.capture.state.status,
      playbackStatus: this.playback.status,
    });
    if (failed) {
      throw new HearingControllerError("CLOSE_FAILED", SAFE_MESSAGES.CLOSE_FAILED);
    }
  }

  private handleCaptureFrame(frame: AudioCaptureFrame): void {
    const recording = this.recording;
    if (
      !this.frameForwarding ||
      recording === null ||
      recording.generation !== this.generation ||
      recording.finalHandled ||
      this.closed
    ) {
      return;
    }
    try {
      this.client.sendPcmFrame(
        recording.utteranceId,
        new Int16Array(frame.pcm),
      );
    } catch (cause) {
      this.frameForwarding = false;
      const error = this.recordingError(cause);
      void this.failRecording(recording, error);
    }
  }

  private handleCaptureState(snapshot: AudioCaptureSnapshot): void {
    if (this.closed && this.snapshotValue.lifecycle === "closed") return;
    this.setSnapshot({ captureStatus: snapshot.status });
    const recording = this.recording;
    if (
      snapshot.failure !== null &&
      recording !== null &&
      !recording.finalHandled &&
      recording.generation === this.generation
    ) {
      this.frameForwarding = false;
      void this.failRecording(
        recording,
        new HearingControllerError(
          snapshot.failure.code,
          SAFE_MESSAGES.RECORDING_FAILED,
        ),
      );
    }
  }

  private handlePlaybackStatus(status: AudioPlaybackStatus): void {
    if (this.closed && this.snapshotValue.lifecycle === "closed") return;
    this.setSnapshot({ playbackStatus: status });
  }

  private handleClientEvent(event: SpeechClientEvent, generation: number): void {
    if (generation !== this.generation || this.closed) return;
    switch (event.type) {
      case "stt_partial":
        this.handlePartial(
          event.utteranceId,
          event.revision,
          event.text,
          event.confidence ?? null,
        );
        return;
      case "stt_final":
        this.handleFinal(event.utteranceId, event.revision, event.text);
        return;
      case "tts_started":
        this.handleTtsStarted(event);
        return;
      case "tts_audio_frame":
        this.handleTtsAudio(event);
        return;
      case "tts_timing":
        this.handleTtsTiming(event);
        return;
      case "tts_finished":
        this.handleTtsFinished(event);
        return;
      case "cancelled":
        this.handleCancellation(event.target, event.targetId ?? null);
        return;
      case "error":
        if (!this.errorMatchesActiveOperation(event.utteranceId, event.jobId)) return;
        this.handleServiceFailure(event.fatal);
        return;
      case "client_error":
        this.handleServiceFailure(false);
        return;
      case "client_state":
        if (event.state === "disconnected") this.handleDisconnect();
        return;
      case "ready":
      case "capabilities":
      case "flow_control":
      case "speech_started":
      case "speech_ended":
      case "metrics":
      case "pong":
        return;
    }
  }

  private handlePartial(
    utteranceId: string,
    revision: number,
    text: string,
    confidence: number | null,
  ): void {
    const recording = this.recording;
    if (
      recording === null ||
      recording.generation !== this.generation ||
      recording.utteranceId !== utteranceId ||
      recording.finalHandled ||
      recording.partialInterruption !== null ||
      revision <= recording.lastRevision
    ) {
      return;
    }
    recording.lastRevision = revision;
    this.setSnapshot({ partialText: text });
    if (
      this.partialObjections === null ||
      recording.partialGeneration === null ||
      recording.partialHead === null
    ) {
      return;
    }
    const currentView = this.options.getView();
    if (!viewMatchesHead(currentView, recording.partialHead)) {
      if (currentView !== null) {
        this.partialObjections.invalidateHead(headFromView(currentView));
      }
      return;
    }
    const result = this.partialObjections.acceptPartial({
      generation: recording.partialGeneration,
      head: recording.partialHead,
      utteranceId,
      revision,
      text,
      confidence,
    });
    const partialInterruption = activePartialInterruption(recording);
    if (
      result.envelope !== null &&
      partialInterruption !== null &&
      partialInterruption.generation === result.envelope.generation
    ) {
      partialInterruption.envelope = result.envelope;
    }
  }

  private handleFinal(
    utteranceId: string,
    revision: number,
    text: string,
  ): void {
    const recording = this.recording;
    if (
      recording === null ||
      recording.generation !== this.generation ||
      recording.utteranceId !== utteranceId ||
      recording.finalHandled ||
      revision < recording.lastRevision
    ) {
      return;
    }
    const partialInterruption = recording.partialInterruption;
    if (
      partialInterruption !== null &&
      recording.partialGeneration !== null &&
      recording.partialHead !== null
    ) {
      let normalizedFinal: string;
      try {
        normalizedFinal = normalizeText(text, "question");
      } catch (cause) {
        void this.failRecording(recording, this.finalError(cause));
        return;
      }
      partialInterruption.finalRevision = revision;
      partialInterruption.finalText = normalizedFinal;
      recording.lastRevision = revision;
      recording.finalHandled = true;
      this.frameForwarding = false;
      const sealed = this.partialObjections?.sealFinalCandidate({
        generation: recording.partialGeneration,
        head: recording.partialHead,
        utteranceId,
        revision,
      });
      if (sealed !== true) {
        void this.failRecording(
          recording,
          new HearingControllerError(
            "INTERRUPTION_STALE",
            SAFE_MESSAGES.INTERRUPTION_STALE,
          ),
        );
        return;
      }
      recording.finalReceived.resolve(null);
      this.setSnapshot({ lifecycle: "processing", partialText: "" });
      return;
    }
    if (
      recording.partialGeneration !== null &&
      recording.partialHead !== null
    ) {
      this.partialObjections?.finalize({
        generation: recording.partialGeneration,
        head: recording.partialHead,
        utteranceId,
        revision,
      });
    }
    recording.lastRevision = revision;
    recording.finalHandled = true;
    recording.finalReceived.resolve(null);
    this.frameForwarding = false;
    this.setSnapshot({ lifecycle: "processing", partialText: "" });
    void this.completeRecording(recording, text);
  }

  private async completeRecording(
    recording: RecordingState,
    text: string,
  ): Promise<void> {
    let failure: HearingControllerError | null = null;
    try {
      await this.capture.stop();
      if (
        recording.generation !== this.generation ||
        this.recording !== recording ||
        this.closed
      ) {
        return;
      }
      recording.commitStarted = true;
      await this.commitValidatedFinal(
        recording.context,
        normalizeText(text, recording.context.mode),
        recording.generation,
      );
      this.assertGeneration(recording.generation);
    } catch (cause) {
      failure = this.finalError(cause);
    }
    if (
      recording.generation !== this.generation ||
      this.recording !== recording ||
      this.closed
    ) {
      recording.completion.resolve(
        failure ?? new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED),
      );
      return;
    }
    this.recording = null;
    recording.completion.resolve(failure);
    if (failure === null) {
      if (this.snapshotValue.lifecycle === "fatal_error") return;
      if (recording.postCommitRecovery !== null) {
        this.setRecoverable(recording.postCommitRecovery);
      } else {
        this.setSnapshot({
          lifecycle: "ready",
          code: null,
          message: null,
          partialText: "",
          activeMode: null,
        });
      }
    } else {
      this.setRecoverable(failure);
    }
  }

  private async commitValidatedFinal(
    context: HearingVoiceContext,
    text: string,
    generation: number,
  ): Promise<void> {
    this.assertGeneration(generation);
    const view = this.options.getView();
    if (view === null) {
      throw new HearingControllerError("STALE_FINAL", SAFE_MESSAGES.STALE_FINAL);
    }
    const validation = validateHearingVoiceContext(
      context,
      view,
      this.options.getActivity(),
    );
    if (!validation.valid) {
      throw new HearingControllerError(validation.code, validation.message);
    }
    const intent = voiceContextToIntent(context, text);
    this.assertGeneration(generation);
    await this.options.commitFinal(Object.freeze({ context, text, intent }));
  }

  private startCachedObjectionReaction(
    reaction: CachedObjectionReaction,
    signal: AbortSignal,
  ): Promise<void> {
    const recording = this.recording;
    if (
      recording === null ||
      recording.generation !== this.generation ||
      recording.mode !== "question" ||
      recording.finalHandled ||
      recording.partialGeneration !== reaction.generation ||
      recording.partialHead === null ||
      recording.utteranceId !== reaction.utteranceId ||
      recording.partialInterruption !== null ||
      this.closed
    ) {
      return Promise.reject(
        new HearingControllerError(
          "INTERRUPTION_STALE",
          SAFE_MESSAGES.INTERRUPTION_STALE,
        ),
      );
    }
    const partialInterruption: PartialInterruptionState = {
      generation: reaction.generation,
      head: recording.partialHead,
      reaction,
      envelope: null,
      finalRevision: null,
      finalText: null,
      durableResponse: null,
      reactionPlayback: null,
      candidateCorrectionCompleted: false,
    };
    recording.partialInterruption = partialInterruption;

    // This is the synchronous safety fence: no capture callback after the
    // detector match can forward another PCM frame to the local companion.
    this.frameForwarding = false;
    this.setSnapshot({ lifecycle: "processing", partialText: "" });
    this.beginAutomaticInterruptionStop(recording);

    if (
      !(
        this.snapshotValue.capabilities?.cachedClipIds.includes(
          CACHED_OBJECTION_CLIP_ID,
        ) ?? false
      )
    ) {
      return Promise.reject(
        new HearingControllerError(
          "REACTION_UNAVAILABLE",
          SAFE_MESSAGES.REACTION_UNAVAILABLE,
        ),
      );
    }
    return this.dispatchInterruptionClip(
      recording,
      CACHED_OBJECTION_CLIP_ID,
      OBJECTION_ACTOR_ID,
      signal,
      (completion) => {
        partialInterruption.reactionPlayback = completion;
      },
    );
  }

  private beginAutomaticInterruptionStop(recording: RecordingState): void {
    if (recording.stopPromise !== null) return;
    const pending = Promise.resolve().then(() =>
      this.stopRecordingInternal(recording),
    );
    recording.stopPromise = pending;
    void pending.catch(() => {
      // stopRecordingInternal has already retained the safe controller state.
    });
  }

  private async requestFinalBoundInterruption(
    envelope: PartialObjectionEnvelope,
    signal: AbortSignal,
  ): Promise<FinalBoundInterruptionResolution> {
    const recording = this.recording;
    const partialInterruption = recording?.partialInterruption ?? null;
    if (
      recording === null ||
      partialInterruption === null ||
      recording.generation !== this.generation ||
      recording.partialGeneration !== envelope.generation ||
      recording.partialHead === null ||
      recording.utteranceId !== envelope.utteranceId ||
      partialInterruption.envelope?.interruptId !== envelope.interruptId ||
      partialInterruption.finalRevision === null ||
      partialInterruption.finalText === null ||
      !sameHead(recording.partialHead, envelope.head) ||
      signal.aborted ||
      this.closed
    ) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    if (partialInterruption.durableResponse !== null) {
      return partialInterruption.durableResponse;
    }
    if (!viewMatchesHead(this.options.getView(), envelope.head)) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    const interruptFinal = this.options.interruptFinal;
    if (interruptFinal === undefined) {
      throw new HearingControllerError(
        "INTERRUPTION_FAILED",
        SAFE_MESSAGES.INTERRUPTION_FAILED,
      );
    }
    const request = FinalBoundInterruptionRequestSchema.parse({
      schemaVersion: FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
      head: envelope.head,
      utterance: {
        generation: envelope.generation,
        utteranceId: envelope.utteranceId,
      },
      trigger: {
        revision: envelope.revision,
        text: envelope.candidate.partialText,
        confidence: envelope.candidate.sttConfidence,
      },
      final: {
        revision: partialInterruption.finalRevision,
        text: partialInterruption.finalText,
      },
    });
    recording.commitStarted = true;
    const response = FinalBoundInterruptionResolutionSchema.parse(
      await interruptFinal(request, signal),
    );
    const invalidWithdrawal =
      response.disposition === "candidate_withdrawn" &&
      !sameHead(response.head, envelope.head);
    const invalidCommitted =
      response.disposition === "ruling_committed" &&
      (response.view.trial.trialId !== envelope.head.trialId ||
        response.targetCompletionHead.trialId !== envelope.head.trialId ||
        response.targetCompletionHead.stateVersion <=
          envelope.head.stateVersion ||
        response.view.trial.version <= envelope.head.stateVersion ||
        response.view.trial.lastEventId === envelope.head.lastEventId);
    if (invalidWithdrawal || invalidCommitted) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    partialInterruption.durableResponse = response;
    return response;
  }

  private async deliverFinalBoundInterruption(
    envelope: PartialObjectionEnvelope,
    response: FinalBoundInterruptionResolution,
    fence: PartialObjectionDeliveryFence,
  ): Promise<void> {
    const recording = this.recording;
    const partialInterruption = recording?.partialInterruption ?? null;
    if (
      recording === null ||
      partialInterruption === null ||
      recording.generation !== this.generation ||
      recording.partialGeneration !== envelope.generation ||
      recording.utteranceId !== envelope.utteranceId ||
      recording.partialSourceView === null ||
      partialInterruption.finalRevision !== fence.expectedRevision ||
      partialInterruption.durableResponse !== response ||
      !fence.isCurrent() ||
      fence.signal.aborted ||
      this.closed
    ) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    const currentView = this.options.getView();
    const expectedPublishedHead =
      response.disposition === "ruling_committed"
        ? headFromView(response.view)
        : envelope.head;
    if (!viewMatchesHead(currentView, expectedPublishedHead)) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }

    if (response.disposition === "candidate_withdrawn") {
      await this.deliverWithdrawnCandidate(
        recording,
        partialInterruption,
        fence,
      );
      return;
    }

    // The route has already published this durable view before resolving the
    // interruption port. Adopt its head before any fallible local playback so
    // a missing clip, audio-device failure, or timeout cannot leave the
    // controller behind the canonical trial record.
    this.baseline = response.view;
    const resumedUnits = this.resumedWitnessUnits(
      recording.partialSourceView,
      response,
      recording.context.witnessId,
    );

    const reactionPlayback = partialInterruption.reactionPlayback;
    if (reactionPlayback === null) {
      throw new HearingControllerError(
        "REACTION_UNAVAILABLE",
        SAFE_MESSAGES.REACTION_UNAVAILABLE,
      );
    }
    await reactionPlayback;
    if (!fence.isCurrent() || fence.signal.aborted) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }

    if (response.performance.disposition === "historical") {
      this.completeDeliveredInterruption(recording);
      return;
    }

    let rulingPlayback: Promise<void> | null = null;
    await this.dispatchInterruptionClip(
      recording,
      response.ruling === "sustained"
        ? SUSTAINED_CLIP_ID
        : OVERRULED_CLIP_ID,
      JUDGE_ACTOR_ID,
      fence.signal,
      (completion) => {
        rulingPlayback = completion;
      },
    );
    if (rulingPlayback === null) {
      throw new HearingControllerError(
        "REACTION_UNAVAILABLE",
        SAFE_MESSAGES.REACTION_UNAVAILABLE,
      );
    }
    await rulingPlayback;
    if (!fence.isCurrent() || fence.signal.aborted) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    this.deliveredInterruptionRulings.add(response.interruptId);

    const canSpeak = this.completeDeliveredInterruption(recording);
    if (!canSpeak) return;
    if (response.continuation === "pending") {
      try {
        this.options.onInterruptionPending?.(response);
      } catch {
        // Recovery scheduling is best-effort; the durable pending head remains.
      }
      return;
    }
    if (resumedUnits.length === 0) return;

    // Resumed testimony uses the normal speaking lifecycle so the player can
    // barge in with the next spoken question. The durable view was adopted
    // above, so local playback failure never replays or rolls back the answer.
    try {
      await this.speakUnits(resumedUnits);
    } catch {
      // speakUnits has already fenced/cancelled playback and exposed a safe
      // recoverable state, or a new recording deliberately barged in.
    }
  }

  private async deliverWithdrawnCandidate(
    recording: RecordingState,
    partialInterruption: PartialInterruptionState,
    fence: PartialObjectionDeliveryFence,
  ): Promise<void> {
    let localFailure: HearingControllerError | null = null;
    try {
      if (partialInterruption.reactionPlayback === null) {
        throw new HearingControllerError(
          "REACTION_UNAVAILABLE",
          SAFE_MESSAGES.REACTION_UNAVAILABLE,
        );
      }
      await partialInterruption.reactionPlayback;
      if (!partialInterruption.candidateCorrectionCompleted) {
        let correctionPlayback: Promise<void> | null = null;
        await this.dispatchInterruptionSpeechUnit(
          recording,
          Object.freeze({
            actor: COURTROOM_DIRECTOR_ACTOR_ID,
            text: WITHDRAWAL_CORRECTION_PHRASE,
          }),
          fence.signal,
          (completion) => {
            correctionPlayback = completion;
          },
        );
        if (correctionPlayback === null) {
          throw new HearingControllerError(
            "REACTION_UNAVAILABLE",
            SAFE_MESSAGES.REACTION_UNAVAILABLE,
          );
        }
        await correctionPlayback;
        partialInterruption.candidateCorrectionCompleted = true;
      }
    } catch (cause) {
      localFailure = controllerError(cause);
    }
    if (!fence.isCurrent() || fence.signal.aborted) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    const finalText = partialInterruption.finalText;
    if (finalText === null) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    await this.commitValidatedFinal(
      recording.context,
      finalText,
      recording.generation,
    );
    if (localFailure !== null && recording.postCommitRecovery === null) {
      recording.postCommitRecovery = localFailure;
    }
    this.completeDeliveredInterruption(recording);
  }

  private resumedWitnessUnits(
    sourceView: HearingRuntimeViewV1,
    response: FinalBoundInterruptionResponse,
    expectedWitnessId: string | null,
  ): SpeechUnit[] {
    const answerTurnId = response.performance.answerTurnId;
    if (
      response.ruling !== "overruled" ||
      response.performance.disposition !== "current" ||
      response.continuation !== "complete" ||
      answerTurnId === null
    ) {
      return [];
    }
    const selection = selectSpeakableTranscriptDelta(
      sourceView,
      response.view,
      "command",
    );
    if (!selection.ok) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    const matchingTurns = selection.turns.filter(
      (turn) => turn.turnId === answerTurnId,
    );
    const turn = matchingTurns[0];
    if (
      matchingTurns.length !== 1 ||
      turn === undefined ||
      expectedWitnessId === null ||
      turn.actor.role !== "witness" ||
      turn.actor.witnessId !== expectedWitnessId ||
      turn.status !== "active" ||
      turn.testimonyId === null
    ) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    const actor = safeActorId(turn.actor);
    return splitSpeechPhrases(turn.text).map((text) =>
      Object.freeze({ actor, text }),
    );
  }

  private recoveredWitnessUnits(
    response: FinalBoundInterruptionResponse,
  ): SpeechUnit[] {
    const answerTurnId = response.performance.answerTurnId;
    if (
      response.ruling !== "overruled" ||
      response.performance.disposition !== "current" ||
      response.continuation !== "complete" ||
      answerTurnId === null
    ) {
      return [];
    }
    const matchingTurns = response.view.transcript.filter(
      (turn) => turn.turnId === answerTurnId,
    );
    const turn = matchingTurns[0];
    const activeWitnessId = response.view.activeAppearance?.witnessId ?? null;
    if (
      matchingTurns.length !== 1 ||
      turn === undefined ||
      turn.actor.role !== "witness" ||
      turn.actor.witnessId === null ||
      (activeWitnessId !== null &&
        turn.actor.witnessId !== activeWitnessId) ||
      turn.status !== "active" ||
      turn.testimonyId === null
    ) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
    const actor = safeActorId(turn.actor);
    return splitSpeechPhrases(turn.text).map((text) =>
      Object.freeze({ actor, text }),
    );
  }

  private completeDeliveredInterruption(recording: RecordingState): boolean {
    this.recording = null;
    recording.completion.resolve(null);
    if (recording.postCommitRecovery !== null) {
      this.setRecoverable(recording.postCommitRecovery);
      return false;
    }
    this.setSnapshot({
      lifecycle: "ready",
      code: null,
      message: null,
      partialText: "",
      activeMode: null,
    });
    return true;
  }

  private handlePartialObjectionError(
    error: PartialObjectionCoordinatorError,
  ): void {
    const recording = this.recording;
    if (
      recording === null ||
      recording.partialInterruption === null ||
      recording.generation !== this.generation ||
      this.closed
    ) {
      return;
    }
    if (
      (error.stage === "model_candidate" || error.stage === "model_result") &&
      this.partialObjections?.retrySealedCandidate()
    ) {
      return;
    }
    void this.failRecording(
      recording,
      new HearingControllerError(
        error.stage === "model_result"
          ? "INTERRUPTION_STALE"
          : "INTERRUPTION_FAILED",
        error.stage === "model_result"
          ? SAFE_MESSAGES.INTERRUPTION_STALE
          : SAFE_MESSAGES.INTERRUPTION_FAILED,
      ),
    );
  }

  private async dispatchInterruptionClip(
    recording: RecordingState,
    clipId: string,
    actor: string,
    signal: AbortSignal,
    onCompletion: (completion: Promise<void>) => void,
  ): Promise<void> {
    if (
      !(
        this.snapshotValue.capabilities?.cachedClipIds.includes(clipId) ??
        false
      )
    ) {
      throw new HearingControllerError(
        "REACTION_UNAVAILABLE",
        SAFE_MESSAGES.REACTION_UNAVAILABLE,
      );
    }
    return this.dispatchInterruptionSpeechUnit(
      recording,
      Object.freeze({ actor, clipId }),
      signal,
      onCompletion,
    );
  }

  private async dispatchInterruptionSpeechUnit(
    recording: RecordingState,
    unit: SpeechUnit,
    signal: AbortSignal,
    onCompletion: (completion: Promise<void>) => void,
  ): Promise<void> {
    if (this.activePlaybackJob !== null) {
      throw new HearingControllerError("BUSY", SAFE_MESSAGES.BUSY);
    }
    const generation = recording.generation;
    const playbackFence = ++this.playbackFence;
    const responseId = this.createId("response");
    await this.playback.activateResponse(responseId);
    this.assertInterruptionPlaybackFence(
      recording,
      generation,
      playbackFence,
      signal,
    );
    this.activePlaybackResponseId = responseId;
    const identity = Object.freeze({
      jobId: this.createId("job"),
      responseId,
      actor: assertSpeechIdentifier(unit.actor),
      sequence: 0,
    });
    const job: PlaybackJobState = {
      generation,
      playbackFence,
      identity,
      completion: createDeferredResult(),
      started: false,
    };
    this.activePlaybackJob = job;
    const abort = (): void => {
      this.cancelInterruptionPlayback(job);
    };
    signal.addEventListener("abort", abort, { once: true });
    const completion = this.monitorInterruptionPlayback(job, signal, abort);
    void completion.catch(() => {
      // The coordinator delivery/retry path observes this same promise.
    });
    onCompletion(completion);
    try {
      this.client.synthesize(
        unit.text === undefined
          ? {
              ...identity,
              clipId: unit.clipId ?? CACHED_OBJECTION_CLIP_ID,
              isFinal: true,
            }
          : { ...identity, text: unit.text, isFinal: true },
      );
    } catch (cause) {
      job.completion.resolve(controllerError(cause));
      throw controllerError(cause);
    }
  }

  private async monitorInterruptionPlayback(
    job: PlaybackJobState,
    signal: AbortSignal,
    abort: () => void,
  ): Promise<void> {
    try {
      const error = await this.waitForResult(
        job.completion.promise,
        this.ttsTimeoutMs,
        new HearingControllerError(
          "PLAYBACK_TIMEOUT",
          SAFE_MESSAGES.PLAYBACK_TIMEOUT,
        ),
      );
      if (error !== null) throw error;
      if (signal.aborted) {
        throw new HearingControllerError(
          "INTERRUPTION_STALE",
          SAFE_MESSAGES.INTERRUPTION_STALE,
        );
      }
    } catch (cause) {
      // A failed or timed-out local job must release both the browser playback
      // and the companion's response queue before the sealed retry can run.
      this.cancelInterruptionPlayback(job);
      throw cause;
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.matchPlaybackJob(job.identity) === job) {
        this.activePlaybackJob = null;
        if (this.activePlaybackResponseId === job.identity.responseId) {
          this.activePlaybackResponseId = null;
        }
      }
    }
  }

  private cancelInterruptionPlayback(job: PlaybackJobState): void {
    if (this.matchPlaybackJob(job.identity) !== job) return;
    ++this.playbackFence;
    this.activePlaybackJob = null;
    this.activePlaybackResponseId = null;
    job.completion.resolve(
      new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      ),
    );
    try {
      this.playback.bargeIn();
    } catch {
      // The playback fence above remains authoritative for late audio.
    }
    try {
      this.client.cancelSynthesis({
        scope: "response",
        responseId: job.identity.responseId,
        reason: "interruption_stale",
      });
    } catch {
      // The local playback fence still prevents stale frames from being used.
    }
  }

  private assertInterruptionPlaybackFence(
    recording: RecordingState,
    generation: number,
    playbackFence: number,
    signal: AbortSignal,
  ): void {
    this.assertGeneration(generation);
    if (
      signal.aborted ||
      playbackFence !== this.playbackFence ||
      this.recording !== recording ||
      recording.partialInterruption === null
    ) {
      throw new HearingControllerError(
        "INTERRUPTION_STALE",
        SAFE_MESSAGES.INTERRUPTION_STALE,
      );
    }
  }

  private async failRecording(
    recording: RecordingState,
    error: HearingControllerError,
  ): Promise<void> {
    if (
      recording.generation !== this.generation ||
      this.recording !== recording ||
      this.closed
    ) {
      return;
    }
    if (
      recording.partialInterruption !== null &&
      recording.partialInterruption.finalRevision === null &&
      recording.partialGeneration !== null &&
      recording.partialHead !== null &&
      recording.lastRevision > 0
    ) {
      this.partialObjections?.finalize({
        generation: recording.partialGeneration,
        head: recording.partialHead,
        utteranceId: recording.utteranceId,
        revision: recording.lastRevision,
      });
    }
    if (this.activePlaybackJob !== null) {
      this.abortPlayback(error, true);
    }
    this.frameForwarding = false;
    recording.finalHandled = true;
    try {
      this.client.cancelUtterance(recording.utteranceId, "recording_failed");
    } catch {
      // The utterance may already be terminal; the generation and forwarding fences remain.
    }
    try {
      await this.capture.stop();
    } catch {
      // The original safe recording failure remains the actionable state.
    }
    if (this.recording !== recording || recording.generation !== this.generation) {
      return;
    }
    this.recording = null;
    recording.finalReceived.resolve(error);
    recording.completion.resolve(error);
    this.setRecoverable(error);
    const durableResponse =
      recording.partialInterruption?.durableResponse ?? null;
    if (
      durableResponse?.disposition === "ruling_committed" &&
      durableResponse.continuation === "pending"
    ) {
      try {
        this.options.onInterruptionPending?.(durableResponse);
      } catch {
        // Owner recovery remains available on reload when local scheduling fails.
      }
    }
  }

  private handleTtsStarted(event: Extract<SpeechClientEvent, { type: "tts_started" }>): void {
    const job = this.matchPlaybackJob(event);
    if (job === null || job.started) return;
    try {
      const completion = this.playback.startJob(job.identity);
      job.started = true;
      void completion
        .then((result) => {
          if (
            result.status !== "completed" &&
            this.matchPlaybackJob(job.identity) === job
          ) {
            this.failPlaybackJob(
              job,
              "PLAYBACK_FAILED",
              SAFE_MESSAGES.PLAYBACK_FAILED,
            );
          }
        })
        .catch(() => {
          this.failPlaybackJob(
            job,
            "PLAYBACK_FAILED",
            SAFE_MESSAGES.PLAYBACK_FAILED,
          );
        });
    } catch {
      this.failPlaybackJob(job, "PLAYBACK_FAILED", SAFE_MESSAGES.PLAYBACK_FAILED);
    }
  }

  private handleTtsAudio(
    event: Extract<SpeechClientEvent, { type: "tts_audio_frame" }>,
  ): void {
    const job = this.matchPlaybackJob(event.metadata);
    if (job === null || !job.started) {
      // Discarded/stale frames still consume companion flow-control credit.
      // ACK them without enqueueing so cancelled responses cannot deadlock the
      // TTS window or become audible later.
      event.acknowledge();
      return;
    }
    try {
      this.playback.enqueueFrame({
        jobId: event.metadata.jobId,
        responseId: event.metadata.responseId,
        actor: event.metadata.actor,
        sequence: event.metadata.sequence,
        frameSequence: event.metadata.frameSequence,
        byteLength: event.metadata.byteLength,
        durationMs: event.metadata.durationMs,
        sampleRateHz: event.metadata.sampleRateHz,
        channels: event.metadata.channels,
        encoding: event.metadata.encoding,
        pcm: event.pcmS16le,
      });
      if (!event.acknowledge()) {
        throw new HearingControllerError(
          "PLAYBACK_FAILED",
          SAFE_MESSAGES.PLAYBACK_FAILED,
        );
      }
    } catch {
      this.failPlaybackJob(job, "PLAYBACK_FAILED", SAFE_MESSAGES.PLAYBACK_FAILED);
    }
  }

  private handleTtsTiming(
    event: Extract<SpeechClientEvent, { type: "tts_timing" }>,
  ): void {
    const job = this.matchPlaybackJob(event);
    if (job === null || !job.started) return;
    try {
      this.playback.addTiming({
        jobId: event.jobId,
        responseId: event.responseId,
        actor: event.actor,
        sequence: event.sequence,
        marks: event.marks,
      });
    } catch {
      this.failPlaybackJob(job, "PLAYBACK_FAILED", SAFE_MESSAGES.PLAYBACK_FAILED);
    }
  }

  private handleTtsFinished(
    event: Extract<SpeechClientEvent, { type: "tts_finished" }>,
  ): void {
    const job = this.matchPlaybackJob(event);
    if (job === null || !job.started) return;
    let completion: Promise<AudioPlaybackCompletion>;
    try {
      completion = this.playback.finishJob(job.identity);
    } catch {
      this.failPlaybackJob(job, "PLAYBACK_FAILED", SAFE_MESSAGES.PLAYBACK_FAILED);
      return;
    }
    void completion
      .then((result) => {
        if (this.matchPlaybackJob(job.identity) !== job) return;
        if (result.status !== "completed") {
          this.failPlaybackJob(
            job,
            "SPEECH_CANCELLED",
            SAFE_MESSAGES.SPEECH_CANCELLED,
          );
          return;
        }
        job.completion.resolve(null);
      })
      .catch(() => {
        this.failPlaybackJob(job, "PLAYBACK_FAILED", SAFE_MESSAGES.PLAYBACK_FAILED);
      });
  }

  private handleCancellation(
    target: "utterance" | "job" | "response" | "all_synthesis",
    targetId: string | null,
  ): void {
    const recording = this.recording;
    if (
      target === "utterance" &&
      recording !== null &&
      targetId === recording.utteranceId
    ) {
      if (recording.finalHandled || recording.commitStarted) return;
      void this.failRecording(
        recording,
        new HearingControllerError(
          "SPEECH_CANCELLED",
          SAFE_MESSAGES.SPEECH_CANCELLED,
        ),
      );
      return;
    }
    const job = this.activePlaybackJob;
    const matchesPlayback =
      job !== null &&
      (target === "all_synthesis" ||
        (target === "job" && targetId === job.identity.jobId) ||
        (target === "response" && targetId === job.identity.responseId));
    if (matchesPlayback) {
      const error = new HearingControllerError(
        "SPEECH_CANCELLED",
        SAFE_MESSAGES.SPEECH_CANCELLED,
      );
      this.abortPlayback(error, false);
      this.setRecoverable(error);
    }
  }

  private handleServiceFailure(fatal: boolean): void {
    const error = new HearingControllerError(
      "SPEECH_SERVICE_ERROR",
      SAFE_MESSAGES.SPEECH_SERVICE_ERROR,
    );
    this.recordPreparationFailure(error);
    this.recordDeveloperSubmissionFailure(error);
    if (fatal) this.clientSessionReady = false;
    const recording = this.recording;
    if (recording?.finalHandled || recording?.commitStarted) {
      recording.postCommitRecovery = error;
    } else if (recording !== null) {
      void this.failRecording(recording, error);
    }
    if (this.activePlaybackJob !== null) this.abortPlayback(error, false);
    if (fatal) this.setFatal(error);
    else if (recording === null && this.activePlaybackJob === null) {
      this.setRecoverable(error);
    }
  }

  private handleDisconnect(): void {
    this.clientSessionReady = false;
    const error = new HearingControllerError(
      "SPEECH_DISCONNECTED",
      SAFE_MESSAGES.SPEECH_DISCONNECTED,
    );
    this.recordPreparationFailure(error);
    this.recordDeveloperSubmissionFailure(error);
    const recording = this.recording;
    if (recording?.finalHandled || recording?.commitStarted) {
      recording.postCommitRecovery = error;
      this.setRecoverable(error);
    } else if (recording !== null) {
      void this.failRecording(recording, error);
    }
    if (this.activePlaybackJob !== null) this.abortPlayback(error, false);
    if (recording === null && this.activePlaybackJob === null) {
      this.setRecoverable(error);
    }
  }

  private errorMatchesActiveOperation(
    utteranceId: string | null | undefined,
    jobId: string | null | undefined,
  ): boolean {
    if (utteranceId !== null && utteranceId !== undefined) {
      if (this.recording?.utteranceId !== utteranceId) return false;
    }
    if (jobId !== null && jobId !== undefined) {
      if (this.activePlaybackJob?.identity.jobId !== jobId) return false;
    }
    return true;
  }

  private async speakUnits(units: readonly SpeechUnit[]): Promise<void> {
    this.requireReady();
    if (units.length === 0) return;
    const generation = this.generation;
    const playbackFence = ++this.playbackFence;
    this.setSnapshot({
      lifecycle: "speaking",
      code: null,
      message: null,
      partialText: "",
      activeMode: null,
    });
    try {
      for (let offset = 0; offset < units.length; offset += MAX_JOBS_PER_RESPONSE) {
        this.assertPlaybackFence(generation, playbackFence);
        const responseUnits = units.slice(offset, offset + MAX_JOBS_PER_RESPONSE);
        const responseId = this.createId("response");
        await this.playback.activateResponse(responseId);
        this.assertPlaybackFence(generation, playbackFence);
        this.activePlaybackResponseId = responseId;

        for (let sequence = 0; sequence < responseUnits.length; sequence += 1) {
          this.assertPlaybackFence(generation, playbackFence);
          const unit = responseUnits[sequence];
          if (unit === undefined) continue;
          const identity = Object.freeze({
            jobId: this.createId("job"),
            responseId,
            actor: assertSpeechIdentifier(unit.actor),
            sequence,
          });
          const job: PlaybackJobState = {
            generation,
            playbackFence,
            identity,
            completion: createDeferredResult(),
            started: false,
          };
          this.activePlaybackJob = job;
          const finalInResponse = sequence === responseUnits.length - 1;
          this.client.synthesize(
            unit.text === undefined
              ? {
                  ...identity,
                  clipId: unit.clipId ?? SPEAKER_TEST_CLIP_ID,
                  isFinal: finalInResponse,
                }
              : { ...identity, text: unit.text, isFinal: finalInResponse },
          );
          const error = await this.waitForResult(
            job.completion.promise,
            this.ttsTimeoutMs,
            new HearingControllerError(
              "PLAYBACK_TIMEOUT",
              SAFE_MESSAGES.PLAYBACK_TIMEOUT,
            ),
          );
          if (error !== null) throw error;
          this.assertPlaybackFence(generation, playbackFence);
          if (this.activePlaybackJob === job) this.activePlaybackJob = null;
        }
        if (this.activePlaybackResponseId === responseId) {
          this.activePlaybackResponseId = null;
        }
      }
      this.assertPlaybackFence(generation, playbackFence);
      this.setSnapshot({
        lifecycle: "ready",
        code: null,
        message: null,
        partialText: "",
        activeMode: null,
      });
    } catch (cause) {
      const error = controllerError(cause);
      if (
        generation === this.generation &&
        playbackFence === this.playbackFence &&
        !this.closed
      ) {
        this.abortPlayback(error, true);
        this.setRecoverable(error);
      }
      throw error;
    }
  }

  private interruptPlaybackForRecording(): void {
    const job = this.activePlaybackJob;
    ++this.playbackFence;
    this.activePlaybackJob = null;
    this.activePlaybackResponseId = null;
    job?.completion.resolve(
      new HearingControllerError("BARGED_IN", SAFE_MESSAGES.BARGED_IN),
    );
    let failure: HearingControllerError | null = null;
    try {
      this.playback.bargeIn();
    } catch {
      failure = new HearingControllerError(
        "PLAYBACK_FAILED",
        SAFE_MESSAGES.PLAYBACK_FAILED,
      );
    }
    try {
      this.client.cancelSynthesis({ scope: "all", reason: "barge_in" });
    } catch {
      failure ??= new HearingControllerError(
        "SPEECH_SERVICE_ERROR",
        SAFE_MESSAGES.SPEECH_SERVICE_ERROR,
      );
    }
    if (failure !== null) throw failure;
  }

  private abortPlayback(
    error: HearingControllerError,
    notifyService: boolean,
  ): void {
    ++this.playbackFence;
    const job = this.activePlaybackJob;
    this.activePlaybackJob = null;
    this.activePlaybackResponseId = null;
    job?.completion.resolve(error);
    try {
      this.playback.bargeIn();
    } catch {
      // The playback fence is already active.
    }
    if (notifyService) {
      try {
        this.client.cancelSynthesis({ scope: "all", reason: "playback_failed" });
      } catch {
        // The local playback fence remains authoritative for late events.
      }
    }
  }

  private failPlaybackJob(
    job: PlaybackJobState,
    code: string,
    message: string,
  ): void {
    if (this.matchPlaybackJob(job.identity) !== job) return;
    job.completion.resolve(new HearingControllerError(code, message));
  }

  private matchPlaybackJob(identity: {
    readonly jobId: string;
    readonly responseId: string;
    readonly actor: string;
    readonly sequence: number;
  }): PlaybackJobState | null {
    const job = this.activePlaybackJob;
    if (
      job === null ||
      job.generation !== this.generation ||
      job.playbackFence !== this.playbackFence ||
      job.identity.jobId !== identity.jobId ||
      job.identity.responseId !== identity.responseId ||
      job.identity.actor !== identity.actor ||
      job.identity.sequence !== identity.sequence
    ) {
      return null;
    }
    return job;
  }

  private freezeAndValidate(mode: HearingVoiceInputMode): HearingVoiceContext {
    const view = this.options.getView();
    if (view === null) {
      throw new HearingControllerError("NOT_READY", SAFE_MESSAGES.NOT_READY);
    }
    let context: HearingVoiceContext;
    try {
      context = freezeHearingVoiceContext(mode, view);
    } catch (cause) {
      throw controllerError(cause);
    }
    const validation = validateHearingVoiceContext(
      context,
      view,
      this.options.getActivity(),
    );
    if (!validation.valid) {
      throw new HearingControllerError(validation.code, validation.message);
    }
    return context;
  }

  private currentViewForContext(
    context: HearingVoiceContext,
  ): HearingRuntimeViewV1 {
    const view = this.options.getView();
    if (
      view === null ||
      view.trial.trialId !== context.trialId ||
      view.trial.version !== context.stateVersion ||
      view.trial.lastEventId !== context.lastEventId
    ) {
      throw new HearingControllerError(
        "STALE_FINAL",
        SAFE_MESSAGES.STALE_FINAL,
      );
    }
    return view;
  }

  private createId(prefix: string): string {
    try {
      return assertSpeechIdentifier(this.idFactory(prefix));
    } catch {
      throw new HearingControllerError(
        "INVALID_IDENTIFIER",
        SAFE_MESSAGES.INVALID_IDENTIFIER,
      );
    }
  }

  private recordingError(cause: unknown): HearingControllerError {
    if (cause instanceof HearingControllerError) return cause;
    if (cause instanceof HearingVoicePolicyError || cause instanceof AudioCaptureError) {
      return new HearingControllerError(cause.code, cause.message);
    }
    if (cause instanceof SpeechClientError && cause.code === "STT_BACKPRESSURE") {
      return new HearingControllerError(
        "STT_BACKPRESSURE",
        SAFE_MESSAGES.STT_BACKPRESSURE,
      );
    }
    return new HearingControllerError("RECORDING_FAILED", SAFE_MESSAGES.RECORDING_FAILED);
  }

  private finalError(cause: unknown): HearingControllerError {
    if (cause instanceof HearingControllerError) return cause;
    if (cause instanceof HearingVoicePolicyError) {
      return new HearingControllerError(cause.code, cause.message);
    }
    return new HearingControllerError("COMMIT_FAILED", SAFE_MESSAGES.COMMIT_FAILED);
  }

  private async waitForResult(
    promise: Promise<HearingControllerError | null>,
    timeoutMs: number,
    timeoutError: HearingControllerError,
  ): Promise<HearingControllerError | null> {
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const timeout = new Promise<HearingControllerError>((resolve) => {
      timer = globalThis.setTimeout(() => resolve(timeoutError), timeoutMs);
    });
    const result = await Promise.race([promise, timeout]);
    if (timer !== null) globalThis.clearTimeout(timer);
    return result;
  }

  private requireReady(): void {
    this.assertOpen();
    if (this.snapshotValue.lifecycle !== "ready") {
      throw new HearingControllerError(
        this.snapshotValue.lifecycle === "recording" ||
          this.snapshotValue.lifecycle === "processing" ||
          this.snapshotValue.lifecycle === "speaking" ||
          this.snapshotValue.lifecycle === "preparing"
          ? "BUSY"
          : "NOT_READY",
        this.snapshotValue.lifecycle === "recording" ||
          this.snapshotValue.lifecycle === "processing" ||
          this.snapshotValue.lifecycle === "speaking" ||
          this.snapshotValue.lifecycle === "preparing"
          ? SAFE_MESSAGES.BUSY
          : SAFE_MESSAGES.NOT_READY,
      );
    }
  }

  private requirePreparedForRecording(): void {
    this.assertOpen();
    if (
      this.snapshotValue.lifecycle !== "ready" &&
      this.snapshotValue.lifecycle !== "speaking"
    ) {
      throw new HearingControllerError(
        this.snapshotValue.lifecycle === "recording" ||
          this.snapshotValue.lifecycle === "processing" ||
          this.snapshotValue.lifecycle === "preparing"
          ? "BUSY"
          : "NOT_READY",
        this.snapshotValue.lifecycle === "recording" ||
          this.snapshotValue.lifecycle === "processing" ||
          this.snapshotValue.lifecycle === "preparing"
          ? SAFE_MESSAGES.BUSY
          : SAFE_MESSAGES.NOT_READY,
      );
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED);
    }
  }

  private assertGeneration(generation: number): void {
    if (this.closed || generation !== this.generation) {
      throw new HearingControllerError("CLOSED", SAFE_MESSAGES.CLOSED);
    }
  }

  private assertPreparationHealthy(generation: number): void {
    this.assertGeneration(generation);
    const failure = this.preparationFailure;
    if (
      this.preparingGeneration !== generation ||
      (failure !== null && failure.generation === generation)
    ) {
      throw (
        failure?.error ??
        new HearingControllerError(
          "SPEECH_SERVICE_ERROR",
          SAFE_MESSAGES.SPEECH_SERVICE_ERROR,
        )
      );
    }
  }

  private recordPreparationFailure(error: HearingControllerError): void {
    const generation = this.preparingGeneration;
    if (generation === null || generation !== this.generation) return;
    this.preparationFailure = Object.freeze({ generation, error });
  }

  private preparationErrorFor(
    generation: number,
  ): HearingControllerError | null {
    const failure: PreparationFailure | null = this.preparationFailure;
    return failure?.generation === generation ? failure.error : null;
  }

  private recordDeveloperSubmissionFailure(error: HearingControllerError): void {
    const submission = this.developerSubmission;
    if (submission === null || submission.generation !== this.generation) return;
    submission.failure = error;
  }

  private assertPlaybackFence(generation: number, playbackFence: number): void {
    this.assertGeneration(generation);
    if (playbackFence !== this.playbackFence) {
      throw new HearingControllerError("BARGED_IN", SAFE_MESSAGES.BARGED_IN);
    }
  }

  private setRecoverable(error: HearingControllerError): void {
    if (this.closed || this.snapshotValue.lifecycle === "fatal_error") return;
    this.setSnapshot({
      lifecycle: "recoverable_error",
      code: error.code,
      message: error.message,
      partialText: "",
      activeMode: null,
    });
  }

  private setFatal(error: HearingControllerError): void {
    if (this.closed) return;
    this.setSnapshot({
      lifecycle: "fatal_error",
      code: error.code,
      message: error.message,
      partialText: "",
      activeMode: null,
    });
  }

  private setSnapshot(patch: Partial<HearingControllerSnapshot>): void {
    this.snapshotValue = freezeSnapshot({ ...this.snapshotValue, ...patch });
    const listeners = [...this.listeners];
    for (const listener of listeners) {
      try {
        listener(this.snapshotValue);
      } catch {
        // State observers cannot compromise the microphone or playback lifecycle.
      }
    }
    try {
      this.options.onStateChange?.(this.snapshotValue);
    } catch {
      // State observers cannot compromise the microphone or playback lifecycle.
    }
  }
}
