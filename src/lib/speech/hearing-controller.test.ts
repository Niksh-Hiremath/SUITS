import { describe, expect, it } from "vitest";

import {
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";
import {
  FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
  type FinalBoundInterruptionRequest,
  type FinalBoundInterruptionResponse,
} from "@/domain/objections/final-bound-contracts";

import {
  CAPTURE_FRAME_BYTES,
  CAPTURE_FRAME_DURATION_MS,
  CAPTURE_SAMPLE_RATE_HZ,
  type AudioCaptureControllerOptions,
  type AudioCaptureFrame,
  type AudioCaptureSnapshot,
} from "./audio-capture";
import type {
  AudioPlaybackCompletion,
  AudioPlaybackControllerOptions,
  AudioPlaybackJobIdentity,
  AudioPlaybackStatus,
  AudioPlaybackTimingBatch,
} from "./audio-playback";
import {
  SpeechClientError,
  type CancelSynthesisRequest,
  type SpeechClientEvent,
  type SpeechConnectionInfo,
  type StartUtteranceOptions,
  type SynthesisRequest,
} from "./client";
import {
  HearingController,
  type HearingAudioCapturePort,
  type HearingAudioPlaybackPort,
  type HearingFinalSubmission,
  type HearingSpeechClientPort,
} from "./hearing-controller";
import {
  SPEECH_PROTOCOL,
  type SpeechCapabilitiesEvent,
} from "./protocol";

type TranscriptTurn = HearingRuntimeViewV1["transcript"][number];
const TRIAL_ID = `trial_${"a".repeat(32)}`;
const INTERRUPTION_CLIPS = Object.freeze([
  "courtroom.objection.v1",
  "courtroom.sustained.v1",
  "courtroom.overruled.v1",
]);

function transcriptTurn(
  ordinal: number,
  actorId: string,
  role: TranscriptTurn["actor"]["role"],
  side: TranscriptTurn["actor"]["side"],
  text: string,
  status: TranscriptTurn["status"] = "active",
): TranscriptTurn {
  return {
    ordinal,
    turnId: `turn-${ordinal}`,
    actor: {
      actorId,
      role,
      side,
      witnessId: role === "witness" ? "witness-one" : null,
    },
    text,
    testimonyId: role === "witness" ? `testimony-${ordinal}` : null,
    status,
    citations: {
      factIds: [],
      evidenceIds: [],
      testimonyIds: [],
      eventIds: [],
      sourceSegmentIds: [],
    },
  };
}

function runtimeView(
  version = 7,
  transcript: readonly TranscriptTurn[] = [],
): HearingRuntimeViewV1 {
  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
    case: {
      caseId: "case-speech",
      version: 1,
      title: "Speech controller fixture",
      summary: "A fictional educational hearing.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction-speech",
        name: "Fixture Court",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional procedure",
        burdenOfProof: "preponderance",
      },
      issues: [],
    },
    trial: {
      trialId: TRIAL_ID,
      phase: "case_in_chief",
      status: "active",
      version,
      sequence: version,
      lastEventId: `event-${version}`,
      userSide: "user",
    },
    activeAppearance: {
      appearanceId: "appearance-one",
      witnessId: "witness-one",
      ordinal: 1,
      invocation: "call",
      callingSide: "user",
      stage: "direct",
      examinationLeg: {
        kind: "direct",
        ownerSide: "user",
        status: "in_progress",
        answeredQuestionCount: 0,
      },
    },
    activeQuestion: null,
    capabilities: {
      canAskQuestion: true,
      canFinishExamination: true,
      canFinishTrial: true,
      canObject: false,
      canContinueResponse: false,
      canProposeSettlement: false,
      counterableSettlementOfferIds: [],
      acceptableSettlementOfferIds: [],
      rejectableSettlementOfferIds: [],
      withdrawableSettlementOfferIds: [],
    },
    witnesses: [
      {
        witnessId: "witness-one",
        name: "Morgan Vale",
        kind: "fact",
        role: "Operations manager",
        status: "testifying",
        callCount: 1,
        callableByPlayer: false,
        recallableByPlayer: false,
        currentAppearanceId: "appearance-one",
        currentExaminationLeg: "direct",
      },
    ],
    player: {
      actorId: "actor-user",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party-user",
      facts: [],
      evidence: [],
      settlement: null,
    },
    transcript,
    permittedObjectionGrounds: [],
  });
}

function objectionView(
  grounds: HearingRuntimeViewV1["permittedObjectionGrounds"] = ["leading"],
  transcript: readonly TranscriptTurn[] = [],
  answeredQuestionCount = 0,
): HearingRuntimeViewV1 {
  const view = runtimeView(7, transcript);
  if (
    view.activeAppearance === null ||
    view.activeAppearance.examinationLeg === null
  ) {
    throw new Error("missing active examination leg");
  }
  return HearingRuntimeViewV1Schema.parse({
    ...view,
    activeAppearance: {
      ...view.activeAppearance,
      examinationLeg: {
        ...view.activeAppearance.examinationLeg,
        answeredQuestionCount,
      },
    },
    permittedObjectionGrounds: grounds,
  });
}

function interruptionResponse(
  ruling: "sustained" | "overruled",
  view = runtimeView(14),
): FinalBoundInterruptionResponse {
  return {
    schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
    interruptId: "interrupt:durable:001",
    ruling,
    remedy: ruling === "sustained" ? "rephrase" : "resume_response",
    replayed: false,
    view,
  };
}

function capabilities(
  streamingStt = true,
  cachedClipIds: readonly string[] = ["courtroom.sustained.v1"],
  streamingTts = true,
): SpeechCapabilitiesEvent {
  return {
    protocol: SPEECH_PROTOCOL,
    type: "capabilities",
    requestId: "load-1",
    providers: [
      {
        providerId: "stt.fake",
        kind: "stt",
        configured: true,
        loaded: true,
        ready: true,
        device: "fake",
        modelId: "stt-model",
        supportsStreaming: streamingStt,
        supportsTimings: false,
        warmupLatencyMs: 12,
        diagnostic: null,
      },
      {
        providerId: "tts.fake",
        kind: "tts",
        configured: true,
        loaded: true,
        ready: true,
        device: "fake",
        modelId: "tts-model",
        supportsStreaming: streamingTts,
        supportsTimings: true,
        warmupLatencyMs: 18,
        diagnostic: null,
      },
    ],
    cuda: {
      available: false,
      deviceName: null,
      driverVersion: null,
      computeCapability: null,
      vramMb: null,
      diagnostic: null,
    },
    cachedClipIds: [...cachedClipIds],
    maxTtsQueueDepth: 8,
    maxAudioChunkBytes: 65_536,
  };
}

function connectionInfo(value: SpeechCapabilitiesEvent): SpeechConnectionInfo {
  return {
    ready: {
      protocol: SPEECH_PROTOCOL,
      type: "ready",
      sessionId: "session-one",
      serviceVersion: "0.1.0",
      mode: "fake",
    },
    capabilities: value,
    flowControl: {
      protocol: SPEECH_PROTOCOL,
      type: "flow_control",
      sttCreditRevision: 1,
      sttUtteranceId: null,
      sttAcceptedThroughSequence: -1,
      sttAvailableFrames: 8,
      sttAvailableBytes: 5_120,
      ttsWindowBytes: 65_536,
      ttsOutstandingBytes: 0,
    },
  };
}

class FakeSpeechClient implements HearingSpeechClientPort {
  private listener: ((event: SpeechClientEvent) => void) | null = null;
  readonly listenerHistory: Array<(event: SpeechClientEvent) => void> = [];
  readonly utterances: StartUtteranceOptions[] = [];
  readonly ended: string[] = [];
  readonly cancelledUtterances: string[] = [];
  readonly synthesis: SynthesisRequest[] = [];
  readonly synthesisCancellations: CancelSynthesisRequest[] = [];
  readonly sentFrames: Array<Readonly<{ utteranceId: string; samples: Int16Array }>> = [];
  connectCount = 0;
  loadCount = 0;
  disconnectCount = 0;
  sendFailure: SpeechClientError | null = null;

  constructor(public capabilitiesValue: SpeechCapabilitiesEvent) {}

  subscribe(listener: (event: SpeechClientEvent) => void): () => void {
    this.listener = listener;
    this.listenerHistory.push(listener);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  async connect(): Promise<SpeechConnectionInfo> {
    this.connectCount += 1;
    return connectionInfo(this.capabilitiesValue);
  }

  async loadModels(): Promise<SpeechCapabilitiesEvent> {
    this.loadCount += 1;
    return this.capabilitiesValue;
  }

  startUtterance(options: StartUtteranceOptions): void {
    this.utterances.push(options);
  }

  sendPcmFrame(utteranceId: string, samples: Int16Array): number {
    if (this.sendFailure !== null) throw this.sendFailure;
    this.sentFrames.push(Object.freeze({ utteranceId, samples }));
    return this.sentFrames.length - 1;
  }

  endUtterance(utteranceId: string): void {
    this.ended.push(utteranceId);
  }

  cancelUtterance(utteranceId: string): void {
    this.cancelledUtterances.push(utteranceId);
  }

  synthesize(request: SynthesisRequest): void {
    this.synthesis.push(request);
  }

  cancelSynthesis(request: CancelSynthesisRequest): void {
    this.synthesisCancellations.push(request);
  }

  disconnect(): void {
    this.disconnectCount += 1;
  }

  emit(event: SpeechClientEvent): void {
    this.listener?.(event);
  }
}

class FakeCapture implements HearingAudioCapturePort {
  private options: AudioCaptureControllerOptions | null = null;
  private snapshotValue: AudioCaptureSnapshot = Object.freeze({
    status: "idle",
    failure: null,
  });
  startCount = 0;
  stopCount = 0;
  emitFrameOnStart = false;
  onStop: (() => void) | null = null;
  startGate: Promise<void> | null = null;
  stopGate: Promise<void> | null = null;

  get state(): AudioCaptureSnapshot {
    return this.snapshotValue;
  }

  configure(options: AudioCaptureControllerOptions): this {
    this.options = options;
    return this;
  }

  async start(): Promise<void> {
    this.startCount += 1;
    this.setStatus("capturing");
    if (this.emitFrameOnStart) this.emitFrame();
    if (this.startGate !== null) await this.startGate;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    this.setStatus("stopped");
    this.onStop?.();
    if (this.stopGate !== null) await this.stopGate;
  }

  emitFrame(): void {
    const pcm = new ArrayBuffer(CAPTURE_FRAME_BYTES);
    this.options?.onFrame({
      sequence: 0,
      sampleRateHz: CAPTURE_SAMPLE_RATE_HZ,
      channels: 1,
      encoding: "pcm_s16le",
      durationMs: CAPTURE_FRAME_DURATION_MS,
      byteLength: CAPTURE_FRAME_BYTES,
      pcm,
    } satisfies AudioCaptureFrame);
  }

  emitFailure(): void {
    this.snapshotValue = Object.freeze({
      status: "error",
      failure: Object.freeze({
        code: "WORKLET_FAILED",
        message: "Microphone processor failed.",
      }),
    });
    this.options?.onStateChange?.(this.snapshotValue);
  }

  private setStatus(status: AudioCaptureSnapshot["status"]): void {
    this.snapshotValue = Object.freeze({ status, failure: null });
    this.options?.onStateChange?.(this.snapshotValue);
  }
}

type PlaybackDeferred = Readonly<{
  promise: Promise<AudioPlaybackCompletion>;
  resolve: (completion: AudioPlaybackCompletion) => void;
}>;

function playbackDeferred(): PlaybackDeferred {
  let resolvePromise: ((completion: AudioPlaybackCompletion) => void) | null = null;
  const promise = new Promise<AudioPlaybackCompletion>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(completion) {
      if (resolvePromise === null) throw new Error("missing playback resolver");
      resolvePromise(completion);
    },
  };
}

class FakePlayback implements HearingAudioPlaybackPort {
  private options: AudioPlaybackControllerOptions | null = null;
  private statusValue: AudioPlaybackStatus = "idle";
  private readonly jobs = new Map<string, Readonly<{
    identity: AudioPlaybackJobIdentity;
    deferred: PlaybackDeferred;
  }>>();
  readonly activatedResponses: string[] = [];
  readonly startedJobs: AudioPlaybackJobIdentity[] = [];
  readonly frames: Array<Readonly<{ jobId: string; byteLength: number }>> = [];
  readonly timings: AudioPlaybackTimingBatch[] = [];
  readonly order: string[] = [];
  bargeCount = 0;
  bargeFailure = false;
  closeCount = 0;
  finishFailure = false;

  get status(): AudioPlaybackStatus {
    return this.statusValue;
  }

  configure(options: AudioPlaybackControllerOptions): this {
    this.options = options;
    return this;
  }

  async activateResponse(responseId: string): Promise<void> {
    this.activatedResponses.push(responseId);
    this.setStatus("ready");
  }

  startJob(identity: AudioPlaybackJobIdentity): Promise<AudioPlaybackCompletion> {
    this.startedJobs.push(identity);
    const deferred = playbackDeferred();
    this.jobs.set(identity.jobId, { identity, deferred });
    return deferred.promise;
  }

  enqueueFrame(frame: {
    readonly jobId: string;
    readonly byteLength: number;
  }): unknown {
    this.order.push("enqueue");
    this.frames.push(Object.freeze({
      jobId: frame.jobId,
      byteLength: frame.byteLength,
    }));
    this.setStatus("playing");
    return Object.freeze({ accepted: true });
  }

  addTiming(batch: AudioPlaybackTimingBatch): void {
    this.timings.push(batch);
  }

  finishJob(identity: AudioPlaybackJobIdentity): Promise<AudioPlaybackCompletion> {
    if (this.finishFailure) throw new Error("test-only finish failure");
    const job = this.jobs.get(identity.jobId);
    if (job === undefined) throw new Error("unknown playback job");
    return job.deferred.promise;
  }

  resolveAudible(jobId: string, status: AudioPlaybackCompletion["status"] = "completed"): void {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error("unknown playback job");
    job.deferred.resolve({
      ...job.identity,
      status,
      audioDurationMs: 20,
      timingMarks: [],
      failureCode: null,
    });
    this.setStatus(status === "completed" ? "ready" : "cancelled");
  }

  bargeIn(): void {
    this.bargeCount += 1;
    if (this.bargeFailure) throw new Error("test-only barge failure");
    this.setStatus("cancelled");
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.setStatus("closed");
  }

  private setStatus(status: AudioPlaybackStatus): void {
    this.statusValue = status;
    this.options?.onStatusChange?.(status);
  }
}

type Harness = Readonly<{
  controller: HearingController;
  client: FakeSpeechClient;
  capture: FakeCapture;
  playback: FakePlayback;
  commits: HearingFinalSubmission[];
  setView: (view: HearingRuntimeViewV1) => void;
  setActivityHook: (hook: (() => void) | null) => void;
  setCommitHook: (hook: (() => Promise<void>) | null) => void;
}>;

function harness(
  capabilityValue = capabilities(),
  options: Readonly<{
    view?: HearingRuntimeViewV1;
    interruptFinal?: (
      request: FinalBoundInterruptionRequest,
      signal: AbortSignal,
    ) => Promise<unknown>;
  }> = {},
): Harness {
  const client = new FakeSpeechClient(capabilityValue);
  const capture = new FakeCapture();
  const playback = new FakePlayback();
  const commits: HearingFinalSubmission[] = [];
  let view = options.view ?? runtimeView();
  let activityHook: (() => void) | null = null;
  let commitHook: (() => Promise<void>) | null = null;
  let nextId = 0;
  const controller = new HearingController({
    url: "ws://127.0.0.1:8765/v1/speech",
    getView: () => view,
    getActivity: () => {
      const activity = Object.freeze({ busy: false, pending: false });
      const hook = activityHook;
      activityHook = null;
      hook?.();
      return activity;
    },
    commitFinal: async (submission) => {
      commits.push(submission);
      await commitHook?.();
    },
    ...(options.interruptFinal === undefined
      ? {}
      : { interruptFinal: options.interruptFinal }),
    idFactory: (prefix) => `${prefix}-${++nextId}`,
    clientFactory: () => client,
    captureFactory: (options) => capture.configure(options),
    playbackFactory: (options) => playback.configure(options),
    finalTimeoutMs: 1_000,
    ttsTimeoutMs: 1_000,
  });
  return Object.freeze({
    controller,
    client,
    capture,
    playback,
    commits,
    setView(next) {
      view = next;
    },
    setActivityHook(hook) {
      activityHook = hook;
    },
    setCommitHook(hook) {
      commitHook = hook;
    },
  });
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferredVoid(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (resolvePromise === null) throw new Error("missing deferred resolver");
      resolvePromise();
    },
  };
}

function latestSynthesis(client: FakeSpeechClient): SynthesisRequest {
  const request = client.synthesis.at(-1);
  if (request === undefined) throw new Error("expected a synthesis request");
  return request;
}

function emitSttPartial(
  client: FakeSpeechClient,
  utteranceId: string,
  revision: number,
  text: string,
  confidence = 0.9,
): void {
  client.emit({
    protocol: SPEECH_PROTOCOL,
    type: "stt_partial",
    utteranceId,
    revision,
    text,
    confidence,
    audioEndMs: 100,
    emittedAtMs: 101,
  });
}

function emitSttFinal(
  client: FakeSpeechClient,
  utteranceId: string,
  revision: number,
  text: string,
): void {
  client.emit({
    protocol: SPEECH_PROTOCOL,
    type: "stt_final",
    utteranceId,
    revision,
    text,
    confidence: 0.95,
    audioEndMs: 200,
    emittedAtMs: 201,
  });
}

function emitTtsStarted(
  client: FakeSpeechClient,
  request: SynthesisRequest,
): void {
  client.emit({
    protocol: SPEECH_PROTOCOL,
    type: "tts_started",
    jobId: request.jobId,
    responseId: request.responseId,
    actor: request.actor,
    sequence: request.sequence,
    voiceId: "voice-fixture",
    cached: request.clipId !== undefined,
    queueLatencyMs: 1,
  });
}

function emitTtsFinished(
  client: FakeSpeechClient,
  request: SynthesisRequest,
): void {
  client.emit({
    protocol: SPEECH_PROTOCOL,
    type: "tts_finished",
    jobId: request.jobId,
    responseId: request.responseId,
    actor: request.actor,
    sequence: request.sequence,
    audioDurationMs: 20,
    synthesisLatencyMs: 4,
  });
}

async function completeLatestClip(test: Harness): Promise<SynthesisRequest> {
  await flushAsync();
  const request = latestSynthesis(test.client);
  emitTtsStarted(test.client, request);
  emitTtsFinished(test.client, request);
  test.playback.resolveAudible(request.jobId);
  await flushAsync();
  return request;
}

describe("HearingController", () => {
  it("fails closed without required providers and preflights capture on success", async () => {
    const failed = harness(capabilities(false));
    await expect(failed.controller.prepare()).rejects.toMatchObject({
      code: "CAPABILITIES_UNAVAILABLE",
    });
    expect(failed.controller.snapshot.lifecycle).toBe("recoverable_error");
    expect(failed.capture.startCount).toBe(0);

    const nonStreamingTts = harness(capabilities(true, [], false));
    await expect(nonStreamingTts.controller.prepare()).rejects.toMatchObject({
      code: "CAPABILITIES_UNAVAILABLE",
    });
    expect(nonStreamingTts.capture.startCount).toBe(0);

    const ready = harness();
    ready.capture.emitFrameOnStart = true;
    const snapshot = await ready.controller.prepare();
    expect(snapshot.lifecycle).toBe("ready");
    expect(snapshot.capabilities).toMatchObject({
      serviceMode: "fake",
      warmupCompleted: true,
      warmupLatencyMs: 18,
      cachedClipIds: ["courtroom.sustained.v1"],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.capabilities?.providers)).toBe(true);
    expect(ready.capture.startCount).toBe(1);
    expect(ready.capture.stopCount).toBe(1);
    expect(ready.client.sentFrames).toHaveLength(0);
  });

  it("cannot become ready after disconnect or fatal error during delayed preflight", async () => {
    const disconnected = harness();
    const startGate = deferredVoid();
    disconnected.capture.startGate = startGate.promise;
    const disconnectPrepare = disconnected.controller.prepare();
    await flushAsync();
    expect(disconnected.capture.startCount).toBe(1);
    disconnected.client.emit({
      type: "client_state",
      state: "disconnected",
    });
    startGate.resolve();

    await expect(disconnectPrepare).rejects.toMatchObject({
      code: "SPEECH_DISCONNECTED",
    });
    expect(disconnected.controller.snapshot).toMatchObject({
      lifecycle: "recoverable_error",
      code: "SPEECH_DISCONNECTED",
    });

    const fatal = harness();
    const stopGate = deferredVoid();
    fatal.capture.stopGate = stopGate.promise;
    const fatalPrepare = fatal.controller.prepare();
    await flushAsync();
    expect(fatal.capture.stopCount).toBe(1);
    fatal.client.emit({
      protocol: SPEECH_PROTOCOL,
      type: "error",
      code: "PROVIDER_CRASHED",
      message: "untrusted fatal detail",
      requestId: null,
      utteranceId: null,
      jobId: null,
      retryable: false,
      fatal: true,
    });
    stopGate.resolve();

    await expect(fatalPrepare).rejects.toMatchObject({
      code: "SPEECH_SERVICE_ERROR",
    });
    expect(fatal.controller.snapshot).toMatchObject({
      lifecycle: "fatal_error",
      code: "SPEECH_SERVICE_ERROR",
    });
    expect(fatal.controller.snapshot.lifecycle).not.toBe("ready");
  });

  it("keeps partials local and commits one matching final exactly once", async () => {
    const test = harness();
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");

    emitSttPartial(test.client, utteranceId, 1, "Did you see");
    expect(test.controller.snapshot.partialText).toBe("Did you see");
    expect(test.commits).toHaveLength(0);

    const stopped = test.controller.stopRecording();
    emitSttFinal(test.client, utteranceId, 2, "Did you see the notice?");
    emitSttFinal(test.client, utteranceId, 2, "duplicate must be ignored");
    await stopped;

    expect(test.commits).toHaveLength(1);
    expect(test.commits[0]).toMatchObject({
      text: "Did you see the notice?",
      context: { mode: "question", witnessId: "witness-one" },
      intent: {
        type: "ask_question",
        witnessId: "witness-one",
        text: "Did you see the notice?",
      },
    });
    expect(test.controller.snapshot.lifecycle).toBe("ready");
  });

  it("fences PCM on a high-confidence partial and dispatches an actorless exact-final interruption", async () => {
    const requests: FinalBoundInterruptionRequest[] = [];
    const test = harness(capabilities(true, INTERRUPTION_CLIPS), {
      view: objectionView(),
      interruptFinal: async (request) => {
        expect(test.client.synthesis[0]?.clipId).toBe(
          "courtroom.objection.v1",
        );
        requests.push(request);
        return interruptionResponse("sustained");
      },
    });
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");

    test.capture.emitFrame();
    expect(test.client.sentFrames).toHaveLength(1);
    emitSttPartial(
      test.client,
      utteranceId,
      1,
      "Isn't it true that you ignored the safety alert that morning?",
      0.99,
    );
    test.capture.emitFrame();
    expect(test.client.sentFrames).toHaveLength(1);
    expect(test.controller.snapshot).toMatchObject({
      lifecycle: "processing",
      activeMode: "question",
    });

    await flushAsync();
    expect(test.client.ended).toEqual([utteranceId]);
    expect(test.client.synthesis[0]?.clipId).toBe("courtroom.objection.v1");
    expect(requests).toHaveLength(0);
    const stopped = test.controller.stopRecording();
    emitSttFinal(
      test.client,
      utteranceId,
      2,
      "Isn't it true that you ignored the safety alert that morning?",
    );
    await flushAsync();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      schemaVersion: "final-bound-interruption.request.v1",
      head: {
        trialId: TRIAL_ID,
        stateVersion: 7,
        lastEventId: "event-7",
      },
      utterance: {
        generation: 1,
        utteranceId,
      },
      trigger: {
        revision: 1,
        text: "Isn't it true that you ignored the safety alert that morning?",
        confidence: 0.99,
      },
      final: {
        revision: 2,
        text: "Isn't it true that you ignored the safety alert that morning?",
      },
    });
    expect(Object.keys(requests[0] ?? {})).toEqual([
      "schemaVersion",
      "head",
      "utterance",
      "trigger",
      "final",
    ]);
    expect(JSON.stringify(requests[0])).not.toMatch(
      /actorId|ownerId|ground|modelMetadata/u,
    );
    expect(test.commits).toHaveLength(0);

    const objectionClip = await completeLatestClip(test);
    expect(objectionClip.clipId).toBe("courtroom.objection.v1");
    const rulingClip = await completeLatestClip(test);
    expect(rulingClip.clipId).toBe("courtroom.sustained.v1");
    await stopped;

    expect(test.client.synthesis).toHaveLength(2);
    expect(test.commits).toHaveLength(0);
    expect(test.controller.snapshot.lifecycle).toBe("ready");
  });

  it("plays the overruled ruling clip and never enters the normal final commit path", async () => {
    const finalQuestion =
      "Isn't it true that you ignored the safety alert that morning?";
    const resumedAnswer = "I reviewed the alert before the shift began.";
    const requests: FinalBoundInterruptionRequest[] = [];
    const test = harness(capabilities(true, INTERRUPTION_CLIPS), {
      view: objectionView(),
      interruptFinal: async (request) => {
        requests.push(request);
        return interruptionResponse(
          "overruled",
          runtimeView(14, [
            transcriptTurn(
              1,
              "actor-user",
              "user_counsel",
              "user",
              finalQuestion,
            ),
            transcriptTurn(
              2,
              "actor-witness",
              "witness",
              "neutral",
              resumedAnswer,
            ),
          ]),
        );
      },
    });
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");

    emitSttPartial(
      test.client,
      utteranceId,
      1,
      finalQuestion,
      0.99,
    );
    await flushAsync();
    const stopped = test.controller.stopRecording();
    emitSttFinal(
      test.client,
      utteranceId,
      2,
      finalQuestion,
    );
    await flushAsync();
    await completeLatestClip(test);
    const rulingClip = await completeLatestClip(test);
    expect(rulingClip.clipId).toBe("courtroom.overruled.v1");
    const resumedSpeech = await completeLatestClip(test);
    expect(resumedSpeech.text).toBe(resumedAnswer);
    await stopped;

    expect(requests).toHaveLength(1);
    expect(test.client.synthesis.map((request) => request.text)).not.toContain(
      finalQuestion,
    );
    expect(test.commits).toHaveLength(0);
    expect(test.controller.snapshot.lifecycle).toBe("ready");
  });

  it("supplies only recent questions from the current examination leg to the detector", async () => {
    const repeatedQuestion =
      "Did you review the safety alert before the morning shift?";
    const requests: FinalBoundInterruptionRequest[] = [];
    const test = harness(capabilities(true, INTERRUPTION_CLIPS), {
      view: objectionView(
        ["asked_and_answered"],
        [
          transcriptTurn(
            1,
            "actor-user",
            "user_counsel",
            "user",
            repeatedQuestion,
          ),
          transcriptTurn(
            2,
            "actor-witness",
            "witness",
            "neutral",
            "Yes, I reviewed it.",
          ),
        ],
        1,
      ),
      interruptFinal: async (request) => {
        requests.push(request);
        return interruptionResponse("sustained");
      },
    });
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");

    emitSttPartial(test.client, utteranceId, 1, repeatedQuestion, 0.99);
    await flushAsync();
    const stopped = test.controller.stopRecording();
    emitSttFinal(test.client, utteranceId, 2, repeatedQuestion);
    await flushAsync();
    await completeLatestClip(test);
    await completeLatestClip(test);
    await stopped;

    expect(requests).toHaveLength(1);
    expect(requests[0]?.trigger.text).toBe(repeatedQuestion);
    expect(test.commits).toHaveLength(0);
  });

  it("retries one final-bound interruption after a transient port failure", async () => {
    let attempts = 0;
    const test = harness(capabilities(true, INTERRUPTION_CLIPS), {
      view: objectionView(),
      interruptFinal: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("untrusted transient detail");
        return interruptionResponse("sustained");
      },
    });
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");

    emitSttPartial(
      test.client,
      utteranceId,
      1,
      "Isn't it true that you ignored the safety alert that morning?",
      0.99,
    );
    await flushAsync();
    const stopped = test.controller.stopRecording();
    emitSttFinal(
      test.client,
      utteranceId,
      2,
      "Isn't it true that you ignored the safety alert that morning?",
    );
    await flushAsync();
    await flushAsync();
    expect(attempts).toBe(2);
    await completeLatestClip(test);
    await completeLatestClip(test);
    await stopped;

    expect(attempts).toBe(2);
    expect(test.controller.snapshot.lifecycle).toBe("ready");
  });

  it("fails closed when the durable head changes before interruption dispatch", async () => {
    let attempts = 0;
    const test = harness(capabilities(true, INTERRUPTION_CLIPS), {
      view: objectionView(),
      interruptFinal: async () => {
        attempts += 1;
        return interruptionResponse("sustained");
      },
    });
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");
    emitSttPartial(
      test.client,
      utteranceId,
      1,
      "Isn't it true that you ignored the safety alert that morning?",
      0.99,
    );
    await flushAsync();
    const stopped = test.controller.stopRecording();
    test.setView(runtimeView(8));
    emitSttFinal(
      test.client,
      utteranceId,
      2,
      "Isn't it true that you ignored the safety alert that morning?",
    );

    await expect(stopped).rejects.toMatchObject({
      code: "INTERRUPTION_FAILED",
    });
    expect(attempts).toBe(0);
    expect(test.commits).toHaveLength(0);
    expect(test.controller.snapshot.lifecycle).toBe("recoverable_error");
  });

  it("aborts an in-flight interruption port and fences late results on close", async () => {
    const responseDeferred: {
      resolve: (response: FinalBoundInterruptionResponse) => void;
    } = {
      resolve: () => undefined,
    };
    const responseGate = new Promise<FinalBoundInterruptionResponse>(
      (resolve) => {
        responseDeferred.resolve = resolve;
      },
    );
    const portSignals: AbortSignal[] = [];
    const test = harness(capabilities(true, INTERRUPTION_CLIPS), {
      view: objectionView(),
      interruptFinal: async (_request, signal) => {
        portSignals.push(signal);
        return responseGate;
      },
    });
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");
    emitSttPartial(
      test.client,
      utteranceId,
      1,
      "Isn't it true that you ignored the safety alert that morning?",
      0.99,
    );
    await flushAsync();
    const stopped = test.controller.stopRecording();
    emitSttFinal(
      test.client,
      utteranceId,
      2,
      "Isn't it true that you ignored the safety alert that morning?",
    );
    await flushAsync();
    expect(portSignals).toHaveLength(1);

    await test.controller.close();
    expect(portSignals[0]?.aborted).toBe(true);
    await expect(stopped).rejects.toMatchObject({ code: "CLOSED" });
    responseDeferred.resolve(interruptionResponse("sustained"));
    await flushAsync();

    expect(test.client.synthesis).toHaveLength(1);
    expect(test.commits).toHaveLength(0);
    expect(test.controller.snapshot.lifecycle).toBe("closed");
  });

  it("keeps closing-mode partials out of the interruption path", async () => {
    let interruptionCalls = 0;
    const test = harness(capabilities(true, INTERRUPTION_CLIPS), {
      view: objectionView(),
      interruptFinal: async () => {
        interruptionCalls += 1;
        return interruptionResponse("sustained");
      },
    });
    await test.controller.prepare();
    await test.controller.startRecording("closing");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");

    emitSttPartial(
      test.client,
      utteranceId,
      1,
      "Isn't it true that the record requires a ruling?",
      0.99,
    );
    const stopped = test.controller.stopRecording();
    emitSttFinal(
      test.client,
      utteranceId,
      2,
      "The admitted record supports our requested outcome.",
    );
    await stopped;

    expect(interruptionCalls).toBe(0);
    expect(test.commits).toHaveLength(1);
    expect(test.commits[0]?.intent.type).toBe("finish_trial");
  });

  it("accepts an automatic VAD final without requiring a manual stop", async () => {
    const test = harness();
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");

    emitSttFinal(test.client, utteranceId, 1, "Did VAD finish this question?");
    await flushAsync();

    expect(test.commits).toHaveLength(1);
    expect(test.client.ended).toHaveLength(0);
    expect(test.capture.stopCount).toBeGreaterThan(1);
    expect(test.controller.snapshot.lifecycle).toBe("ready");
  });

  it("reserves microphone startup and joins duplicate stop requests", async () => {
    const test = harness();
    await test.controller.prepare();
    const started = test.controller.startRecording("question");
    await expect(
      test.controller.startRecording("question"),
    ).rejects.toMatchObject({ code: "BUSY" });
    await started;
    expect(test.client.utterances).toHaveLength(1);

    const firstStop = test.controller.stopRecording();
    const secondStop = test.controller.stopRecording();
    expect(secondStop).toBe(firstStop);
    await flushAsync();
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");
    emitSttFinal(test.client, utteranceId, 1, "One final question?");
    await Promise.all([firstStop, secondStop]);
    expect(test.client.ended).toEqual([utteranceId]);
    expect(test.commits).toHaveLength(1);
  });

  it("ignores late utterance cancellation after accepting the final", async () => {
    const test = harness();
    const commitGate = deferredVoid();
    test.setCommitHook(() => commitGate.promise);
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");
    const stopped = test.controller.stopRecording();
    await flushAsync();
    emitSttFinal(test.client, utteranceId, 1, "Was the notice approved?");
    await flushAsync();
    expect(test.commits).toHaveLength(1);

    test.client.emit({
      protocol: SPEECH_PROTOCOL,
      type: "cancelled",
      target: "utterance",
      targetId: utteranceId,
      reason: "late_terminal_notice",
      cancellationLatencyMs: 1,
    });
    commitGate.resolve();
    await stopped;
    expect(test.commits).toHaveLength(1);
    expect(test.controller.snapshot.lifecycle).toBe("ready");
  });

  it("discards a matching final after the durable hearing head changes", async () => {
    const test = harness();
    await test.controller.prepare();
    await test.controller.startRecording("question");
    const utteranceId = test.client.utterances[0]?.utteranceId;
    if (utteranceId === undefined) throw new Error("missing utterance");
    const stopped = test.controller.stopRecording();
    test.setView(runtimeView(8));
    emitSttFinal(test.client, utteranceId, 1, "Is this now stale?");

    await expect(stopped).rejects.toMatchObject({ code: "HEARING_HEAD_CHANGED" });
    expect(test.commits).toHaveLength(0);
    expect(test.controller.snapshot).toMatchObject({
      lifecycle: "recoverable_error",
      code: "HEARING_HEAD_CHANGED",
    });
  });

  it("uses the same frozen-context revalidation for developer submissions", async () => {
    const test = harness();
    await test.controller.prepare();
    test.setActivityHook(() => test.setView(runtimeView(8)));

    await expect(
      test.controller.submitDeveloperFinal("question", "Who approved it?"),
    ).rejects.toMatchObject({ code: "HEARING_HEAD_CHANGED" });
    expect(test.commits).toHaveLength(0);
  });

  it("accepts the closing policy's full text bound on the developer path", async () => {
    const test = harness();
    await test.controller.prepare();
    const closing = "a".repeat(9_000);

    await test.controller.submitDeveloperFinal("closing", closing);

    expect(test.commits).toHaveLength(1);
    expect(test.commits[0]).toMatchObject({
      text: closing,
      context: { mode: "closing" },
      intent: { type: "finish_trial", closingText: closing },
    });
  });

  it("keeps view adoption queued by callers until final commit processing is ready", async () => {
    const test = harness();
    const baseline = runtimeView();
    const next = runtimeView(8, [
      transcriptTurn(1, "actor-witness", "witness", "neutral", "Committed answer."),
    ]);
    const commitGate = deferredVoid();
    test.setCommitHook(() => commitGate.promise);
    await test.controller.prepare();
    test.controller.baselineView(baseline);
    const submission = test.controller.submitDeveloperFinal(
      "question",
      "What happened next?",
    );
    await flushAsync();

    await expect(
      test.controller.adoptView(baseline, next, "command"),
    ).rejects.toMatchObject({ code: "BUSY" });
    expect(test.client.synthesis).toHaveLength(0);

    commitGate.resolve();
    await submission;
    const adoption = test.controller.adoptView(baseline, next, "command");
    await flushAsync();
    const request = latestSynthesis(test.client);
    emitTtsStarted(test.client, request);
    emitTtsFinished(test.client, request);
    test.playback.resolveAudible(request.jobId);
    await adoption;
  });

  it("does not overwrite disconnect or fatal state after a deferred developer commit", async () => {
    const disconnected = harness();
    const disconnectGate = deferredVoid();
    disconnected.setCommitHook(() => disconnectGate.promise);
    await disconnected.controller.prepare();
    const disconnectSubmission = disconnected.controller.submitDeveloperFinal(
      "question",
      "Was the service connected?",
    );
    await flushAsync();
    disconnected.client.emit({
      type: "client_state",
      state: "disconnected",
    });
    disconnectGate.resolve();
    await disconnectSubmission;
    expect(disconnected.commits).toHaveLength(1);
    expect(disconnected.controller.snapshot).toMatchObject({
      lifecycle: "recoverable_error",
      code: "SPEECH_DISCONNECTED",
    });

    const fatal = harness();
    const fatalGate = deferredVoid();
    fatal.setCommitHook(() => fatalGate.promise);
    await fatal.controller.prepare();
    const fatalSubmission = fatal.controller.submitDeveloperFinal(
      "question",
      "Did the provider remain healthy?",
    );
    await flushAsync();
    fatal.client.emit({
      protocol: SPEECH_PROTOCOL,
      type: "error",
      code: "PROVIDER_CRASHED",
      message: "untrusted fatal detail",
      requestId: null,
      utteranceId: null,
      jobId: null,
      retryable: false,
      fatal: true,
    });
    fatalGate.resolve();
    await fatalSubmission;
    expect(fatal.commits).toHaveLength(1);
    expect(fatal.controller.snapshot).toMatchObject({
      lifecycle: "fatal_error",
      code: "SPEECH_SERVICE_ERROR",
    });
  });

  it("forwards armed Int16 frames and cleans up immediately on STT backpressure", async () => {
    const test = harness();
    await test.controller.prepare();
    await test.controller.startRecording("question");
    test.capture.emitFrame();
    expect(test.client.sentFrames).toHaveLength(1);
    expect(test.client.sentFrames[0]?.samples).toBeInstanceOf(Int16Array);

    test.client.sendFailure = new SpeechClientError(
      "STT_BACKPRESSURE",
      "test-only transport detail",
    );
    test.capture.emitFrame();
    await flushAsync();
    expect(test.client.cancelledUtterances).toHaveLength(1);
    expect(test.controller.snapshot).toMatchObject({
      lifecycle: "recoverable_error",
      code: "STT_BACKPRESSURE",
    });
    const forwarded = test.client.sentFrames.length;
    test.capture.emitFrame();
    expect(test.client.sentFrames).toHaveLength(forwarded);
  });

  it("fails an active utterance on a terminal capture error without downgrading fatal service state", async () => {
    const captureFailure = harness();
    await captureFailure.controller.prepare();
    await captureFailure.controller.startRecording("question");
    captureFailure.capture.emitFailure();
    await flushAsync();
    expect(captureFailure.client.cancelledUtterances).toHaveLength(1);
    expect(captureFailure.controller.snapshot).toMatchObject({
      lifecycle: "recoverable_error",
      code: "WORKLET_FAILED",
    });

    const fatal = harness();
    await fatal.controller.prepare();
    await fatal.controller.startRecording("question");
    fatal.client.emit({
      protocol: SPEECH_PROTOCOL,
      type: "error",
      code: "PROVIDER_CRASHED",
      message: "untrusted service detail",
      requestId: null,
      utteranceId: null,
      jobId: null,
      retryable: false,
      fatal: true,
    });
    await flushAsync();
    expect(fatal.controller.snapshot).toMatchObject({
      lifecycle: "fatal_error",
      code: "SPEECH_SERVICE_ERROR",
    });
    expect(fatal.controller.snapshot.message).not.toContain("untrusted");
  });

  it("barges active playback before arming a fresh microphone utterance", async () => {
    const test = harness();
    await test.controller.prepare();
    const speaker = test.controller.speakerTest();
    await flushAsync();
    expect(test.client.synthesis).toHaveLength(1);

    await test.controller.startRecording("question");
    await expect(speaker).rejects.toMatchObject({ code: "BARGED_IN" });
    expect(test.playback.bargeCount).toBeGreaterThan(0);
    expect(test.client.synthesisCancellations).toContainEqual({
      scope: "all",
      reason: "barge_in",
    });
    expect(test.controller.snapshot.lifecycle).toBe("recording");
  });

  it("still cancels service synthesis and cleans capture when local barge fails", async () => {
    const test = harness();
    await test.controller.prepare();
    const preflightStarts = test.capture.startCount;
    const preflightStops = test.capture.stopCount;
    test.playback.bargeFailure = true;

    await expect(
      test.controller.startRecording("question"),
    ).rejects.toMatchObject({ code: "PLAYBACK_FAILED" });

    expect(test.client.synthesisCancellations).toContainEqual({
      scope: "all",
      reason: "barge_in",
    });
    expect(test.capture.startCount).toBe(preflightStarts);
    expect(test.capture.stopCount).toBe(preflightStops + 1);
    expect(test.client.utterances).toHaveLength(0);
    expect(test.controller.snapshot).toMatchObject({
      lifecycle: "recoverable_error",
      code: "PLAYBACK_FAILED",
    });
  });

  it("ACKs only after enqueue and waits for the audible playback drain", async () => {
    const test = harness();
    await test.controller.prepare();
    const speaker = test.controller.speakerTest();
    await flushAsync();
    const request = latestSynthesis(test.client);
    emitTtsStarted(test.client, request);

    let settled = false;
    void speaker.then(() => {
      settled = true;
    });
    test.client.emit({
      type: "tts_audio_frame",
      metadata: {
        protocol: SPEECH_PROTOCOL,
        type: "tts_audio",
        jobId: request.jobId,
        responseId: request.responseId,
        actor: request.actor,
        sequence: request.sequence,
        frameSequence: 0,
        frameToken: "frame-token-1",
        byteLength: 4,
        durationMs: 1,
        sampleRateHz: 16_000,
        channels: 1,
        encoding: "pcm_s16le",
        ackRequired: true,
      },
      pcmS16le: new ArrayBuffer(4),
      acknowledge: () => {
        test.playback.order.push("ack");
        return true;
      },
    });
    expect(test.playback.order).toEqual(["enqueue", "ack"]);

    emitTtsFinished(test.client, request);
    await flushAsync();
    expect(settled).toBe(false);
    test.playback.resolveAudible(request.jobId);
    await speaker;
    expect(settled).toBe(true);
    expect(test.controller.snapshot.lifecycle).toBe("ready");
  });

  it("surfaces a synchronous playback finish failure without waiting for timeout", async () => {
    const test = harness();
    await test.controller.prepare();
    const speaker = test.controller.speakerTest();
    await flushAsync();
    const request = latestSynthesis(test.client);
    emitTtsStarted(test.client, request);
    test.playback.finishFailure = true;
    emitTtsFinished(test.client, request);

    await expect(speaker).rejects.toMatchObject({ code: "PLAYBACK_FAILED" });
    expect(test.controller.snapshot.lifecycle).toBe("recoverable_error");
  });

  it("baselines without replay and speaks only policy-selected appended turns", async () => {
    const test = harness(capabilities(true, []));
    await test.controller.prepare();
    const previous = runtimeView(7, [
      transcriptTurn(1, "actor-judge", "judge", "neutral", "Court is in session."),
    ]);
    test.controller.baselineView(previous);
    expect(test.client.synthesis).toHaveLength(0);

    const next = runtimeView(8, [
      ...previous.transcript,
      transcriptTurn(2, "actor-user", "user_counsel", "user", "My question."),
      transcriptTurn(3, "actor-witness", "witness", "neutral", "I saw the notice."),
      transcriptTurn(
        4,
        "actor-opposing",
        "opposing_counsel",
        "opposing",
        "This was stricken.",
        "stricken",
      ),
    ]);
    const adopted = test.controller.adoptView(previous, next, "command");
    await flushAsync();
    expect(test.client.synthesis).toHaveLength(1);
    const request = latestSynthesis(test.client);
    expect(request.text).toBe("I saw the notice.");
    emitTtsStarted(test.client, request);
    emitTtsFinished(test.client, request);
    test.playback.resolveAudible(request.jobId);
    await adopted;
  });

  it("rejects a shorter caller prefix instead of replaying the internal baseline", async () => {
    const test = harness();
    await test.controller.prepare();
    const baseline = runtimeView(7, [
      transcriptTurn(1, "actor-judge", "judge", "neutral", "Already spoken."),
    ]);
    test.controller.baselineView(baseline);
    const shorter = runtimeView(7, []);
    const next = runtimeView(8, [
      ...baseline.transcript,
      transcriptTurn(2, "actor-witness", "witness", "neutral", "New answer."),
    ]);

    await expect(
      test.controller.adoptView(shorter, next, "command"),
    ).rejects.toMatchObject({ code: "TRANSCRIPT_DIVERGED" });
    expect(test.client.synthesis).toHaveLength(0);
  });

  it("advances the baseline past an unsynthesizable committed turn", async () => {
    const test = harness();
    await test.controller.prepare();
    const previous = runtimeView();
    test.controller.baselineView(previous);
    const unsafe = runtimeView(8, [
      transcriptTurn(
        1,
        "actor-witness",
        "witness",
        "neutral",
        "x".repeat(513),
      ),
    ]);

    await expect(
      test.controller.adoptView(previous, unsafe, "command"),
    ).rejects.toMatchObject({ code: "SPEECH_TOKEN_TOO_LONG" });
    expect(test.client.synthesis).toHaveLength(0);

    await test.controller.prepare();
    const recovered = runtimeView(9, [
      ...unsafe.transcript,
      transcriptTurn(2, "actor-witness", "witness", "neutral", "Safe next turn."),
    ]);
    const adoption = test.controller.adoptView(unsafe, recovered, "command");
    await flushAsync();
    const request = latestSynthesis(test.client);
    expect(request.text).toBe("Safe next turn.");
    emitTtsStarted(test.client, request);
    emitTtsFinished(test.client, request);
    test.playback.resolveAudible(request.jobId);
    await adoption;
  });

  it("accepts a null baseline for a genuinely new hearing", async () => {
    const test = harness();
    await test.controller.prepare();
    await test.controller.adoptView(null, runtimeView(), "new_hearing");
    expect(test.client.synthesis).toHaveLength(0);
  });

  it("fences disconnects and close-time late events by generation and identity", async () => {
    const disconnected = harness();
    await disconnected.controller.prepare();
    await disconnected.controller.startRecording("question");
    const disconnectedId = disconnected.client.utterances[0]?.utteranceId;
    if (disconnectedId === undefined) throw new Error("missing utterance");
    disconnected.client.emit({
      type: "client_state",
      state: "disconnected",
    });
    await flushAsync();
    emitSttFinal(disconnected.client, disconnectedId, 1, "Late final");
    expect(disconnected.commits).toHaveLength(0);
    expect(disconnected.controller.snapshot.code).toBe("SPEECH_DISCONNECTED");

    const closed = harness();
    await closed.controller.prepare();
    await closed.controller.startRecording("question");
    const closedId = closed.client.utterances[0]?.utteranceId;
    const lateListener = closed.client.listenerHistory.at(-1);
    if (closedId === undefined || lateListener === undefined) {
      throw new Error("missing close fixture state");
    }
    const firstClose = closed.controller.close();
    let reentrantClose: Promise<void> | null = null;
    closed.capture.onStop = () => {
      reentrantClose = closed.controller.close();
    };
    const secondClose = closed.controller.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(reentrantClose).toBe(firstClose);
    lateListener({
      protocol: SPEECH_PROTOCOL,
      type: "stt_final",
      utteranceId: closedId,
      revision: 1,
      text: "Late after close",
      confidence: null,
      audioEndMs: 20,
      emittedAtMs: 21,
    });
    closed.capture.emitFrame();
    expect(closed.commits).toHaveLength(0);
    expect(closed.client.sentFrames).toHaveLength(0);
    expect(closed.playback.closeCount).toBe(1);
    expect(closed.client.disconnectCount).toBe(1);
    expect(closed.controller.snapshot.lifecycle).toBe("closed");
  });
});
