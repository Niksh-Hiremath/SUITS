export type AudioPlaybackStatus =
  | "idle"
  | "ready"
  | "playing"
  | "cancelled"
  | "error"
  | "closed";

export type AudioPlaybackErrorCode =
  | "CLEANUP_FAILED"
  | "CLOSED"
  | "INVALID_FRAME"
  | "INVALID_IDENTITY"
  | "INVALID_TIMING"
  | "JOB_LIMIT_REACHED"
  | "OUT_OF_ORDER_FRAME"
  | "OUT_OF_ORDER_JOB"
  | "PLAYBACK_FAILED"
  | "QUEUE_FULL"
  | "STALE_JOB"
  | "STALE_RESPONSE"
  | "UNSUPPORTED_BROWSER";

export type AudioPlaybackCompletionStatus =
  | "completed"
  | "cancelled"
  | "superseded"
  | "failed";

export type AudioPlaybackCancelReason =
  | "barge_in"
  | "server_cancelled"
  | "shutdown"
  | "superseded"
  | "user";

export type AudioPlaybackPressureLevel = "normal" | "high" | "full";

export type AudioPlaybackObserverFailures = Readonly<{
  status: number;
  pressure: number;
  timing: number;
}>;

export type AudioPlaybackTimerHandle = number | object;

export type AudioPlaybackJobIdentity = Readonly<{
  jobId: string;
  responseId: string;
  actor: string;
  sequence: number;
}>;

export type AudioPlaybackPcmFrame = AudioPlaybackJobIdentity &
  Readonly<{
    frameSequence: number;
    byteLength: number;
    durationMs: number;
    sampleRateHz: number;
    channels: 1;
    encoding: "pcm_s16le";
    pcm: ArrayBuffer;
  }>;

export type AudioPlaybackTimingMark = Readonly<{
  kind: "phrase" | "word" | "viseme";
  value: string;
  startMs: number;
  endMs: number;
}>;

export type AudioPlaybackTimingBatch = AudioPlaybackJobIdentity &
  Readonly<{
    marks: readonly AudioPlaybackTimingMark[];
  }>;

export type ScheduledAudioPlaybackTiming = AudioPlaybackJobIdentity &
  Readonly<{
    marks: readonly (AudioPlaybackTimingMark &
      Readonly<{
        audioStartTimeSeconds: number;
        audioEndTimeSeconds: number;
      }>)[];
  }>;

export type AudioPlaybackCompletion = AudioPlaybackJobIdentity &
  Readonly<{
    status: AudioPlaybackCompletionStatus;
    audioDurationMs: number;
    timingMarks: readonly AudioPlaybackTimingMark[];
    failureCode: AudioPlaybackErrorCode | null;
  }>;

export type AudioPlaybackSchedule = Readonly<{
  startTimeSeconds: number;
  endTimeSeconds: number;
  pressure: AudioPlaybackPressure;
}>;

export type AudioPlaybackPressure = Readonly<{
  level: AudioPlaybackPressureLevel;
  queuedBytes: number;
  availableBytes: number;
  maxQueuedBytes: number;
}>;

export interface AudioPlaybackBuffer {
  readonly duration: number;
  copyToChannel(source: Float32Array, channelNumber: number): void;
}

export interface AudioPlaybackSourceNode {
  buffer: AudioPlaybackBuffer | null;
  onended: (() => void) | null;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioPlaybackAudioContext {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state: string;
  readonly outputLatency?: number;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioPlaybackBuffer;
  createBufferSource(): AudioPlaybackSourceNode;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export type AudioPlaybackControllerOptions = Readonly<{
  createAudioContext?: () => AudioPlaybackAudioContext;
  maxQueuedBytes?: number;
  highWaterBytes?: number;
  lowWaterBytes?: number;
  maxJobsPerResponse?: number;
  maxTimingMarksPerJob?: number;
  maxFrameBytes?: number;
  scheduleLeadMs?: number;
  maxOutputLatencyMs?: number;
  setDrainTimer?: (
    callback: () => void,
    delayMs: number,
  ) => AudioPlaybackTimerHandle;
  clearDrainTimer?: (handle: AudioPlaybackTimerHandle) => void;
  onPressureChange?: (pressure: AudioPlaybackPressure) => void;
  onTiming?: (timing: ScheduledAudioPlaybackTiming) => void;
  onStatusChange?: (status: AudioPlaybackStatus) => void;
}>;

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

type SourceRecord = {
  source: AudioPlaybackSourceNode;
  byteLength: number;
  endTimeSeconds: number;
  released: boolean;
};

type TimingBatchState = {
  marks: readonly AudioPlaybackTimingMark[];
  emitted: boolean;
};

type JobState = {
  identity: AudioPlaybackJobIdentity;
  expectedFrameSequence: number;
  inputFinished: boolean;
  terminalStatus: AudioPlaybackCompletionStatus | null;
  failureCode: AudioPlaybackErrorCode | null;
  sources: Set<SourceRecord>;
  completion: Deferred<AudioPlaybackCompletion>;
  audioDurationMs: number;
  startTimeSeconds: number | null;
  timingBatches: TimingBatchState[];
  timingMarkCount: number;
  drainTimer: AudioPlaybackTimerHandle | null;
  drainFence: number;
};

type ResponseState = {
  responseId: string;
  generation: number;
  cancelled: boolean;
  nextStartTimeSeconds: number;
  lastJobSequence: number | null;
  lastFrameJobSequence: number | null;
  jobs: Map<string, JobState>;
};

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

const SAFE_MESSAGES: Record<AudioPlaybackErrorCode, string> = {
  CLEANUP_FAILED: "Audio playback resources could not be fully released.",
  CLOSED: "Audio playback has already been closed.",
  INVALID_FRAME: "The local speech service returned an invalid audio frame.",
  INVALID_IDENTITY: "The audio playback identity is invalid.",
  INVALID_TIMING: "The local speech service returned invalid timing metadata.",
  JOB_LIMIT_REACHED: "The response exceeded the local audio job limit.",
  OUT_OF_ORDER_FRAME: "The local speech service returned an out-of-order audio frame.",
  OUT_OF_ORDER_JOB: "The local speech service returned an out-of-order audio job.",
  PLAYBACK_FAILED: "Local audio playback failed.",
  QUEUE_FULL: "The local audio playback queue is full.",
  STALE_JOB: "A stale audio job was rejected.",
  STALE_RESPONSE: "A stale audio response was rejected.",
  UNSUPPORTED_BROWSER: "This browser does not support local PCM playback.",
};

const DEFAULT_MAX_QUEUED_BYTES = 512 * 1_024;
const DEFAULT_HIGH_WATER_BYTES = 384 * 1_024;
const DEFAULT_LOW_WATER_BYTES = 128 * 1_024;
const DEFAULT_MAX_JOBS_PER_RESPONSE = 64;
const DEFAULT_MAX_TIMING_MARKS_PER_JOB = 2_048;
const DEFAULT_MAX_FRAME_BYTES = 262_144;
const DEFAULT_SCHEDULE_LEAD_MS = 8;
const DEFAULT_MAX_OUTPUT_LATENCY_MS = 2_000;
const MAX_RETIRED_RESPONSE_IDS = 256;

export class AudioPlaybackError extends Error {
  constructor(readonly code: AudioPlaybackErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "AudioPlaybackError";
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      if (resolvePromise === null) {
        throw new AudioPlaybackError("PLAYBACK_FAILED");
      }
      resolvePromise(value);
    },
  };
}

function defaultCreateAudioContext(): AudioPlaybackAudioContext {
  if (typeof globalThis.AudioContext !== "function") {
    throw new AudioPlaybackError("UNSUPPORTED_BROWSER");
  }
  return new globalThis.AudioContext({
    latencyHint: "interactive",
  }) as unknown as AudioPlaybackAudioContext;
}

function defaultSetDrainTimer(
  callback: () => void,
  delayMs: number,
): AudioPlaybackTimerHandle {
  return globalThis.setTimeout(callback, delayMs) as unknown as AudioPlaybackTimerHandle;
}

function defaultClearDrainTimer(handle: AudioPlaybackTimerHandle): void {
  globalThis.clearTimeout(
    handle as ReturnType<typeof globalThis.setTimeout>,
  );
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isAudioContextClosed(context: AudioPlaybackAudioContext): boolean {
  return context.state === "closed";
}

function validateIdentity(identity: AudioPlaybackJobIdentity): void {
  if (
    !IDENTIFIER.test(identity.jobId) ||
    !IDENTIFIER.test(identity.responseId) ||
    !IDENTIFIER.test(identity.actor) ||
    !isNonNegativeInteger(identity.sequence)
  ) {
    throw new AudioPlaybackError("INVALID_IDENTITY");
  }
}

function copyIdentity(
  identity: AudioPlaybackJobIdentity,
): AudioPlaybackJobIdentity {
  return Object.freeze({
    jobId: identity.jobId,
    responseId: identity.responseId,
    actor: identity.actor,
    sequence: identity.sequence,
  });
}

function validatePositiveLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AudioPlaybackError("INVALID_FRAME");
  }
}

function freezeTimingMark(
  mark: AudioPlaybackTimingMark,
): AudioPlaybackTimingMark {
  return Object.freeze({
    kind: mark.kind,
    value: mark.value,
    startMs: mark.startMs,
    endMs: mark.endMs,
  });
}

export class BrowserAudioPlaybackController {
  private readonly createAudioContext: () => AudioPlaybackAudioContext;
  private readonly maxQueuedBytes: number;
  private readonly highWaterBytes: number;
  private readonly lowWaterBytes: number;
  private readonly maxJobsPerResponse: number;
  private readonly maxTimingMarksPerJob: number;
  private readonly maxFrameBytes: number;
  private readonly scheduleLeadSeconds: number;
  private readonly maxOutputLatencyMs: number;
  private readonly setDrainTimer: (
    callback: () => void,
    delayMs: number,
  ) => AudioPlaybackTimerHandle;
  private readonly clearDrainTimer: (handle: AudioPlaybackTimerHandle) => void;
  private context: AudioPlaybackAudioContext | null = null;
  private contextPromise: Promise<AudioPlaybackAudioContext> | null = null;
  private activeResponse: ResponseState | null = null;
  private responseGeneration = 0;
  private activationGeneration = 0;
  private readonly retiredResponseIds = new Set<string>();
  private outstandingBytes = 0;
  private pressureLevel: AudioPlaybackPressureLevel = "normal";
  private currentStatus: AudioPlaybackStatus = "idle";
  private observerFailureCounts = { status: 0, pressure: 0, timing: 0 };
  private closed = false;

  constructor(private readonly options: AudioPlaybackControllerOptions = {}) {
    this.createAudioContext =
      options.createAudioContext ?? defaultCreateAudioContext;
    this.maxQueuedBytes =
      options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
    this.highWaterBytes =
      options.highWaterBytes ?? DEFAULT_HIGH_WATER_BYTES;
    this.lowWaterBytes =
      options.lowWaterBytes ?? DEFAULT_LOW_WATER_BYTES;
    this.maxJobsPerResponse =
      options.maxJobsPerResponse ?? DEFAULT_MAX_JOBS_PER_RESPONSE;
    this.maxTimingMarksPerJob =
      options.maxTimingMarksPerJob ?? DEFAULT_MAX_TIMING_MARKS_PER_JOB;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    const scheduleLeadMs = options.scheduleLeadMs ?? DEFAULT_SCHEDULE_LEAD_MS;
    this.maxOutputLatencyMs =
      options.maxOutputLatencyMs ?? DEFAULT_MAX_OUTPUT_LATENCY_MS;
    if (
      (options.setDrainTimer === undefined) !==
      (options.clearDrainTimer === undefined)
    ) {
      throw new AudioPlaybackError("INVALID_FRAME");
    }
    this.setDrainTimer = options.setDrainTimer ?? defaultSetDrainTimer;
    this.clearDrainTimer = options.clearDrainTimer ?? defaultClearDrainTimer;

    for (const value of [
      this.maxQueuedBytes,
      this.highWaterBytes,
      this.maxJobsPerResponse,
      this.maxTimingMarksPerJob,
      this.maxFrameBytes,
      this.maxOutputLatencyMs,
    ]) {
      validatePositiveLimit(value);
    }
    if (
      !Number.isSafeInteger(this.lowWaterBytes) ||
      this.lowWaterBytes < 0 ||
      this.lowWaterBytes >= this.highWaterBytes ||
      this.highWaterBytes >= this.maxQueuedBytes ||
      !Number.isFinite(scheduleLeadMs) ||
      scheduleLeadMs < 0 ||
      scheduleLeadMs > 1_000
    ) {
      throw new AudioPlaybackError("INVALID_FRAME");
    }
    this.scheduleLeadSeconds = scheduleLeadMs / 1_000;
  }

  get status(): AudioPlaybackStatus {
    return this.currentStatus;
  }

  get pressure(): AudioPlaybackPressure {
    return Object.freeze({
      level: this.pressureLevel,
      queuedBytes: this.outstandingBytes,
      availableBytes: Math.max(0, this.maxQueuedBytes - this.outstandingBytes),
      maxQueuedBytes: this.maxQueuedBytes,
    });
  }

  get observerFailures(): AudioPlaybackObserverFailures {
    return Object.freeze({ ...this.observerFailureCounts });
  }

  canAccept(byteLength: number): boolean {
    return (
      Number.isSafeInteger(byteLength) &&
      byteLength > 0 &&
      byteLength <= this.maxFrameBytes &&
      this.outstandingBytes + byteLength <= this.maxQueuedBytes
    );
  }

  async activateResponse(responseId: string): Promise<void> {
    this.assertOpen();
    if (!IDENTIFIER.test(responseId)) {
      throw new AudioPlaybackError("INVALID_IDENTITY");
    }
    if (this.retiredResponseIds.has(responseId)) {
      throw new AudioPlaybackError("STALE_RESPONSE");
    }
    const activation = ++this.activationGeneration;
    const context = await this.ensureContext();
    if (activation !== this.activationGeneration || this.closed) {
      throw new AudioPlaybackError("STALE_RESPONSE");
    }
    if (
      this.activeResponse?.responseId === responseId &&
      !this.activeResponse.cancelled
    ) {
      return;
    }
    if (this.activeResponse !== null) {
      const cleanupFailed = this.cancelResponseState(
        this.activeResponse,
        "superseded",
      );
      if (cleanupFailed) throw new AudioPlaybackError("CLEANUP_FAILED");
    }
    this.activeResponse = {
      responseId,
      generation: ++this.responseGeneration,
      cancelled: false,
      nextStartTimeSeconds: context.currentTime + this.scheduleLeadSeconds,
      lastJobSequence: null,
      lastFrameJobSequence: null,
      jobs: new Map(),
    };
    this.setStatus("ready");
  }

  startJob(identity: AudioPlaybackJobIdentity): Promise<AudioPlaybackCompletion> {
    this.assertOpen();
    validateIdentity(identity);
    const response = this.requireActiveResponse(identity.responseId);
    const existing = response.jobs.get(identity.jobId);
    if (existing !== undefined) {
      if (
        existing.identity.actor === identity.actor &&
        existing.identity.sequence === identity.sequence
      ) {
        if (existing.terminalStatus !== null) {
          throw new AudioPlaybackError("STALE_JOB");
        }
        return existing.completion.promise;
      }
      throw new AudioPlaybackError("STALE_JOB");
    }
    if (response.jobs.size >= this.maxJobsPerResponse) {
      throw new AudioPlaybackError("JOB_LIMIT_REACHED");
    }
    if (
      response.lastJobSequence !== null &&
      identity.sequence !== response.lastJobSequence + 1
    ) {
      throw new AudioPlaybackError("OUT_OF_ORDER_JOB");
    }

    const copiedIdentity = copyIdentity(identity);
    const job: JobState = {
      identity: copiedIdentity,
      expectedFrameSequence: 0,
      inputFinished: false,
      terminalStatus: null,
      failureCode: null,
      sources: new Set(),
      completion: createDeferred<AudioPlaybackCompletion>(),
      audioDurationMs: 0,
      startTimeSeconds: null,
      timingBatches: [],
      timingMarkCount: 0,
      drainTimer: null,
      drainFence: 0,
    };
    response.jobs.set(copiedIdentity.jobId, job);
    response.lastJobSequence = copiedIdentity.sequence;
    return job.completion.promise;
  }

  enqueueFrame(frame: AudioPlaybackPcmFrame): AudioPlaybackSchedule {
    this.assertOpen();
    const { response, job } = this.requireJob(frame);
    this.validateFrame(frame, job);
    if (
      response.lastFrameJobSequence !== null &&
      frame.sequence < response.lastFrameJobSequence
    ) {
      throw new AudioPlaybackError("OUT_OF_ORDER_JOB");
    }
    if (!this.canAccept(frame.byteLength)) {
      this.setPressureLevel("full");
      throw new AudioPlaybackError("QUEUE_FULL");
    }
    const context = this.context;
    if (context === null) throw new AudioPlaybackError("PLAYBACK_FAILED");

    const sampleCount = frame.byteLength / Int16Array.BYTES_PER_ELEMENT;
    const samples = new Float32Array(sampleCount);
    const pcm = new DataView(frame.pcm);
    for (let index = 0; index < sampleCount; index += 1) {
      const value = pcm.getInt16(index * Int16Array.BYTES_PER_ELEMENT, true);
      samples[index] = value < 0 ? value / 32_768 : value / 32_767;
    }

    let source: AudioPlaybackSourceNode | null = null;
    let record: SourceRecord | null = null;
    const durationSeconds = sampleCount / frame.sampleRateHz;
    const startTimeSeconds = Math.max(
      context.currentTime + this.scheduleLeadSeconds,
      response.nextStartTimeSeconds,
    );
    const endTimeSeconds = startTimeSeconds + durationSeconds;
    try {
      const buffer = context.createBuffer(1, sampleCount, frame.sampleRateHz);
      buffer.copyToChannel(samples, 0);
      source = context.createBufferSource();
      source.buffer = buffer;
      record = {
        source,
        byteLength: frame.byteLength,
        endTimeSeconds,
        released: false,
      };
      const scheduledRecord = record;
      job.sources.add(scheduledRecord);
      this.outstandingBytes += frame.byteLength;
      job.expectedFrameSequence += 1;
      response.lastFrameJobSequence = frame.sequence;
      job.audioDurationMs += durationSeconds * 1_000;
      job.startTimeSeconds ??= startTimeSeconds;
      response.nextStartTimeSeconds = endTimeSeconds;
      source.onended = () =>
        this.releaseNaturally(response, job, scheduledRecord);
      source.connect(context.destination);
      source.start(startTimeSeconds);
    } catch {
      if (record !== null && !record.released) {
        this.releaseRecord(job, record, false);
      } else if (source !== null) {
        try {
          source.disconnect();
        } catch {
          // The job is failed below with a safe diagnostic.
        }
      }
      this.failJob(job, "PLAYBACK_FAILED");
      throw new AudioPlaybackError("PLAYBACK_FAILED");
    }

    this.setStatus("playing");
    this.updatePressureLevel();
    this.emitPendingTiming(job);
    return Object.freeze({
      startTimeSeconds,
      endTimeSeconds,
      pressure: this.pressure,
    });
  }

  addTiming(batch: AudioPlaybackTimingBatch): void {
    this.assertOpen();
    const { job } = this.requireJob(batch);
    if (job.inputFinished) throw new AudioPlaybackError("STALE_JOB");
    if (batch.marks.length === 0) {
      throw new AudioPlaybackError("INVALID_TIMING");
    }
    if (
      job.timingMarkCount + batch.marks.length >
      this.maxTimingMarksPerJob
    ) {
      throw new AudioPlaybackError("INVALID_TIMING");
    }
    const marks = batch.marks.map((mark) => {
      if (
        (mark.kind !== "phrase" &&
          mark.kind !== "word" &&
          mark.kind !== "viseme") ||
        typeof mark.value !== "string" ||
        mark.value.trim().length === 0 ||
        mark.value.length > 512 ||
        !isNonNegativeInteger(mark.startMs) ||
        !isNonNegativeInteger(mark.endMs) ||
        mark.endMs < mark.startMs
      ) {
        throw new AudioPlaybackError("INVALID_TIMING");
      }
      return freezeTimingMark(mark);
    });
    job.timingBatches.push({ marks: Object.freeze(marks), emitted: false });
    job.timingMarkCount += marks.length;
    this.emitPendingTiming(job);
  }

  finishJob(identity: AudioPlaybackJobIdentity): Promise<AudioPlaybackCompletion> {
    this.assertOpen();
    const { job } = this.requireJob(identity);
    job.inputFinished = true;
    this.settleCompletedJob(job);
    return job.completion.promise;
  }

  cancelJob(
    responseId: string,
    jobId: string,
    reason: Exclude<AudioPlaybackCancelReason, "superseded"> = "server_cancelled",
  ): void {
    this.assertOpen();
    const response = this.requireActiveResponse(responseId);
    const job = response.jobs.get(jobId);
    if (job === undefined || job.terminalStatus !== null) {
      throw new AudioPlaybackError("STALE_JOB");
    }
    const cleanupFailed = this.cancelJobState(job, reason);
    this.recomputeNextStartTime(response);
    this.updatePressureLevel();
    if (cleanupFailed) throw new AudioPlaybackError("CLEANUP_FAILED");
  }

  cancelResponse(
    responseId: string,
    reason: Exclude<AudioPlaybackCancelReason, "superseded"> = "server_cancelled",
  ): void {
    this.assertOpen();
    const response = this.requireActiveResponse(responseId);
    const cleanupFailed = this.cancelResponseState(response, reason);
    if (cleanupFailed) throw new AudioPlaybackError("CLEANUP_FAILED");
  }

  bargeIn(): void {
    this.assertOpen();
    if (this.activeResponse === null || this.activeResponse.cancelled) return;
    const cleanupFailed = this.cancelResponseState(
      this.activeResponse,
      "barge_in",
    );
    if (cleanupFailed) throw new AudioPlaybackError("CLEANUP_FAILED");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    ++this.activationGeneration;
    let cleanupFailed = false;
    if (this.activeResponse !== null) {
      cleanupFailed = this.cancelResponseState(
        this.activeResponse,
        "shutdown",
      );
    }
    let context = this.context;
    if (context === null && this.contextPromise !== null) {
      try {
        context = await this.contextPromise;
      } catch (cause) {
        if (
          !(cause instanceof AudioPlaybackError) ||
          cause.code !== "CLOSED"
        ) {
          cleanupFailed = true;
        }
      }
    }
    if (context !== null && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        cleanupFailed = true;
      }
    }
    this.context = null;
    this.setStatus(cleanupFailed ? "error" : "closed");
    if (cleanupFailed) throw new AudioPlaybackError("CLEANUP_FAILED");
  }

  private async ensureContext(): Promise<AudioPlaybackAudioContext> {
    if (this.context !== null) {
      if (this.context.state === "suspended") await this.context.resume();
      return this.context;
    }
    if (this.contextPromise !== null) return this.contextPromise;

    const pending = (async (): Promise<AudioPlaybackAudioContext> => {
      let context: AudioPlaybackAudioContext;
      try {
        context = this.createAudioContext();
      } catch (cause) {
        if (cause instanceof AudioPlaybackError) throw cause;
        throw new AudioPlaybackError("PLAYBACK_FAILED");
      }
      if (context.state === "suspended") {
        try {
          await context.resume();
        } catch {
          if (!isAudioContextClosed(context)) {
            try {
              await context.close();
            } catch {
              throw new AudioPlaybackError("CLEANUP_FAILED");
            }
          }
          throw new AudioPlaybackError("PLAYBACK_FAILED");
        }
      }
      if (this.closed) {
        try {
          await context.close();
        } catch {
          throw new AudioPlaybackError("CLEANUP_FAILED");
        }
        throw new AudioPlaybackError("CLOSED");
      }
      this.context = context;
      return context;
    })();
    this.contextPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.contextPromise === pending) this.contextPromise = null;
    }
  }

  private validateFrame(frame: AudioPlaybackPcmFrame, job: JobState): void {
    if (job.inputFinished) throw new AudioPlaybackError("STALE_JOB");
    if (
      frame.frameSequence !== job.expectedFrameSequence ||
      !isNonNegativeInteger(frame.frameSequence)
    ) {
      throw new AudioPlaybackError("OUT_OF_ORDER_FRAME");
    }
    if (
      frame.channels !== 1 ||
      frame.encoding !== "pcm_s16le" ||
      !Number.isSafeInteger(frame.byteLength) ||
      frame.byteLength < 2 ||
      frame.byteLength > this.maxFrameBytes ||
      frame.byteLength % 2 !== 0 ||
      !(frame.pcm instanceof ArrayBuffer) ||
      frame.pcm.byteLength !== frame.byteLength ||
      !Number.isSafeInteger(frame.sampleRateHz) ||
      frame.sampleRateHz < 8_000 ||
      frame.sampleRateHz > 48_000 ||
      !Number.isSafeInteger(frame.durationMs) ||
      frame.durationMs <= 0
    ) {
      throw new AudioPlaybackError("INVALID_FRAME");
    }
    const calculatedDurationMs =
      (frame.byteLength / Int16Array.BYTES_PER_ELEMENT / frame.sampleRateHz) *
      1_000;
    if (Math.abs(calculatedDurationMs - frame.durationMs) > 1.5) {
      throw new AudioPlaybackError("INVALID_FRAME");
    }
  }

  private requireActiveResponse(responseId: string): ResponseState {
    if (
      this.activeResponse === null ||
      this.activeResponse.responseId !== responseId ||
      this.activeResponse.cancelled
    ) {
      throw new AudioPlaybackError("STALE_RESPONSE");
    }
    return this.activeResponse;
  }

  private requireJob(identity: AudioPlaybackJobIdentity): {
    response: ResponseState;
    job: JobState;
  } {
    validateIdentity(identity);
    const response = this.requireActiveResponse(identity.responseId);
    const job = response.jobs.get(identity.jobId);
    if (
      job === undefined ||
      job.terminalStatus !== null ||
      job.identity.actor !== identity.actor ||
      job.identity.sequence !== identity.sequence
    ) {
      throw new AudioPlaybackError("STALE_JOB");
    }
    return { response, job };
  }

  private releaseNaturally(
    response: ResponseState,
    job: JobState,
    record: SourceRecord,
  ): void {
    if (record.released) return;
    const cleanupFailed = this.releaseRecord(job, record, false);
    this.updatePressureLevel();
    if (cleanupFailed) {
      this.failJob(job, "CLEANUP_FAILED");
      return;
    }
    this.settleCompletedJob(job);
    if (
      this.activeResponse === response &&
      [...response.jobs.values()].every(
        (candidate) => candidate.terminalStatus !== null,
      )
    ) {
      this.setStatus(response.cancelled ? "cancelled" : "ready");
    }
  }

  private releaseRecord(
    job: JobState,
    record: SourceRecord,
    stop: boolean,
  ): boolean {
    if (record.released) return false;
    record.released = true;
    job.sources.delete(record);
    this.outstandingBytes = Math.max(
      0,
      this.outstandingBytes - record.byteLength,
    );
    record.source.onended = null;
    let failed = false;
    if (stop) {
      try {
        record.source.stop(0);
      } catch {
        failed = true;
      }
    }
    try {
      record.source.disconnect();
    } catch {
      failed = true;
    }
    return failed;
  }

  private cancelJobState(
    job: JobState,
    reason: AudioPlaybackCancelReason,
  ): boolean {
    if (job.terminalStatus !== null) return false;
    let cleanupFailed = this.cancelDrainTimer(job);
    for (const record of [...job.sources]) {
      cleanupFailed = this.releaseRecord(job, record, true) || cleanupFailed;
    }
    this.finalizeJob(
      job,
      cleanupFailed
        ? "failed"
        : reason === "superseded"
          ? "superseded"
          : "cancelled",
      cleanupFailed ? "CLEANUP_FAILED" : null,
    );
    return cleanupFailed;
  }

  private cancelResponseState(
    response: ResponseState,
    reason: AudioPlaybackCancelReason,
  ): boolean {
    response.cancelled = true;
    this.retireResponseId(response.responseId);
    let cleanupFailed = false;
    for (const job of response.jobs.values()) {
      cleanupFailed = this.cancelJobState(job, reason) || cleanupFailed;
    }
    this.updatePressureLevel();
    this.setStatus(cleanupFailed ? "error" : "cancelled");
    return cleanupFailed;
  }

  private failJob(job: JobState, code: AudioPlaybackErrorCode): void {
    if (job.terminalStatus !== null) return;
    this.cancelDrainTimer(job);
    for (const record of [...job.sources]) {
      this.releaseRecord(job, record, true);
    }
    this.finalizeJob(job, "failed", code);
    this.updatePressureLevel();
    this.setStatus("error");
  }

  private settleCompletedJob(job: JobState): void {
    if (
      !job.inputFinished ||
      job.sources.size !== 0 ||
      job.terminalStatus !== null ||
      job.drainTimer !== null
    ) {
      return;
    }
    const latencyMs =
      job.audioDurationMs > 0 ? this.outputLatencyMs() : 0;
    if (latencyMs === 0) {
      this.finalizeJob(job, "completed", null);
      return;
    }

    const fence = ++job.drainFence;
    try {
      const handle = this.setDrainTimer(() => {
        if (
          job.drainFence !== fence ||
          job.terminalStatus !== null ||
          job.sources.size !== 0 ||
          !job.inputFinished
        ) {
          return;
        }
        job.drainTimer = null;
        this.finalizeJob(job, "completed", null);
      }, latencyMs);
      if (job.terminalStatus === null && job.drainFence === fence) {
        job.drainTimer = handle;
      } else {
        this.clearDrainTimer(handle);
      }
    } catch {
      this.failJob(job, "PLAYBACK_FAILED");
    }
  }

  private finalizeJob(
    job: JobState,
    status: AudioPlaybackCompletionStatus,
    failureCode: AudioPlaybackErrorCode | null,
  ): void {
    if (job.terminalStatus !== null) return;
    job.terminalStatus = status;
    job.failureCode = failureCode;
    const timingMarks = Object.freeze(
      job.timingBatches.flatMap((batch) => batch.marks),
    );
    job.completion.resolve(
      Object.freeze({
        ...job.identity,
        status,
        audioDurationMs: Math.round(job.audioDurationMs),
        timingMarks,
        failureCode,
      }),
    );
    const response = this.activeResponse;
    if (
      response !== null &&
      response.jobs.get(job.identity.jobId) === job &&
      [...response.jobs.values()].every(
        (candidate) => candidate.terminalStatus !== null,
      )
    ) {
      this.setStatus(response.cancelled ? "cancelled" : "ready");
    }
  }

  private cancelDrainTimer(job: JobState): boolean {
    ++job.drainFence;
    const timer = job.drainTimer;
    job.drainTimer = null;
    if (timer === null) return false;
    try {
      this.clearDrainTimer(timer);
      return false;
    } catch {
      return true;
    }
  }

  private outputLatencyMs(): number {
    const outputLatency = this.context?.outputLatency;
    if (
      outputLatency === undefined ||
      !Number.isFinite(outputLatency) ||
      outputLatency <= 0
    ) {
      return 0;
    }
    return Math.min(
      this.maxOutputLatencyMs,
      Math.ceil(outputLatency * 1_000),
    );
  }

  private emitPendingTiming(job: JobState): void {
    if (job.startTimeSeconds === null || this.options.onTiming === undefined) {
      return;
    }
    const jobStartTimeSeconds = job.startTimeSeconds;
    for (const batch of job.timingBatches) {
      if (batch.emitted) continue;
      batch.emitted = true;
      const marks = Object.freeze(
        batch.marks.map((mark) =>
          Object.freeze({
            ...mark,
            audioStartTimeSeconds:
              jobStartTimeSeconds + mark.startMs / 1_000,
            audioEndTimeSeconds:
              jobStartTimeSeconds + mark.endMs / 1_000,
          }),
        ),
      );
      const timing = Object.freeze({ ...job.identity, marks });
      this.notifyObserver("timing", () => this.options.onTiming?.(timing));
    }
  }

  private updatePressureLevel(): void {
    let next: AudioPlaybackPressureLevel;
    if (this.outstandingBytes >= this.maxQueuedBytes) {
      next = "full";
    } else if (
      this.outstandingBytes >= this.highWaterBytes ||
      ((this.pressureLevel === "high" || this.pressureLevel === "full") &&
        this.outstandingBytes > this.lowWaterBytes)
    ) {
      next = "high";
    } else {
      next = "normal";
    }
    this.setPressureLevel(next);
  }

  private recomputeNextStartTime(response: ResponseState): void {
    const context = this.context;
    let nextStartTimeSeconds =
      context === null
        ? 0
        : context.currentTime + this.scheduleLeadSeconds;
    for (const job of response.jobs.values()) {
      for (const record of job.sources) {
        if (!record.released) {
          nextStartTimeSeconds = Math.max(
            nextStartTimeSeconds,
            record.endTimeSeconds,
          );
        }
      }
    }
    response.nextStartTimeSeconds = nextStartTimeSeconds;
  }

  private setPressureLevel(level: AudioPlaybackPressureLevel): void {
    if (this.pressureLevel === level) return;
    this.pressureLevel = level;
    const pressure = this.pressure;
    this.notifyObserver("pressure", () =>
      this.options.onPressureChange?.(pressure),
    );
  }

  private setStatus(status: AudioPlaybackStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.notifyObserver("status", () =>
      this.options.onStatusChange?.(status),
    );
  }

  private notifyObserver(
    observer: keyof AudioPlaybackObserverFailures,
    callback: () => void,
  ): void {
    try {
      callback();
    } catch {
      this.observerFailureCounts = {
        ...this.observerFailureCounts,
        [observer]: Math.min(
          Number.MAX_SAFE_INTEGER,
          this.observerFailureCounts[observer] + 1,
        ),
      };
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new AudioPlaybackError("CLOSED");
  }

  private retireResponseId(responseId: string): void {
    this.retiredResponseIds.delete(responseId);
    this.retiredResponseIds.add(responseId);
    if (this.retiredResponseIds.size <= MAX_RETIRED_RESPONSE_IDS) return;
    const oldest = this.retiredResponseIds.values().next().value;
    if (typeof oldest === "string") this.retiredResponseIds.delete(oldest);
  }
}
