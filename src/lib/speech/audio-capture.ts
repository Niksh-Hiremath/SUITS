const WORKLET_MODULE_URL = "/worklets/suits-mic-processor.js";
const WORKLET_PROCESSOR_NAME = "suits-mic-processor";

export const CAPTURE_SAMPLE_RATE_HZ = 16_000;
export const CAPTURE_FRAME_DURATION_MS = 20;
export const CAPTURE_FRAME_BYTES = 640;

export type AudioCaptureStatus =
  | "idle"
  | "requesting_permission"
  | "starting"
  | "capturing"
  | "stopping"
  | "stopped"
  | "permission_denied"
  | "unsupported"
  | "error";

export type AudioCaptureErrorCode =
  | "CAPTURE_BUSY"
  | "CLEANUP_FAILED"
  | "DEVICE_UNAVAILABLE"
  | "FRAME_HANDLER_FAILED"
  | "INVALID_WORKLET_FRAME"
  | "PERMISSION_DENIED"
  | "START_CANCELLED"
  | "START_FAILED"
  | "UNSUPPORTED_BROWSER"
  | "WORKLET_FAILED";

export type AudioCaptureFailure = Readonly<{
  code: AudioCaptureErrorCode;
  message: string;
}>;

export type AudioCaptureSnapshot = Readonly<{
  status: AudioCaptureStatus;
  failure: AudioCaptureFailure | null;
}>;

export type AudioCaptureObserverFailures = Readonly<{
  state: number;
}>;

export type AudioCaptureFrame = Readonly<{
  sequence: number;
  sampleRateHz: typeof CAPTURE_SAMPLE_RATE_HZ;
  channels: 1;
  encoding: "pcm_s16le";
  durationMs: typeof CAPTURE_FRAME_DURATION_MS;
  byteLength: typeof CAPTURE_FRAME_BYTES;
  pcm: ArrayBuffer;
}>;

export interface AudioCaptureTrack {
  stop(): void;
}

export interface AudioCaptureMediaStream {
  getTracks(): readonly AudioCaptureTrack[];
}

export interface AudioCaptureMessagePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close?(): void;
}

export interface AudioCaptureWorkletNode {
  readonly port: AudioCaptureMessagePort;
  onprocessorerror: (() => void) | null;
  disconnect(): void;
}

export interface AudioCaptureSourceNode {
  connect(destination: AudioCaptureWorkletNode): unknown;
  disconnect(): void;
}

export interface AudioCaptureAudioContext {
  readonly audioWorklet: {
    addModule(url: string): Promise<void>;
  };
  readonly state: string;
  createMediaStreamSource(stream: AudioCaptureMediaStream): AudioCaptureSourceNode;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export type AudioCaptureDependencies = Readonly<{
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<AudioCaptureMediaStream>;
  createAudioContext?: () => AudioCaptureAudioContext;
  createWorkletNode?: (
    context: AudioCaptureAudioContext,
    processorName: string,
    options: AudioWorkletNodeOptions,
  ) => AudioCaptureWorkletNode;
}>;

export type AudioCaptureControllerOptions = AudioCaptureDependencies &
  Readonly<{
    onFrame: (frame: AudioCaptureFrame) => void;
    onStateChange?: (snapshot: AudioCaptureSnapshot) => void;
  }>;

type CaptureResources = Readonly<{
  stream: AudioCaptureMediaStream;
  context?: AudioCaptureAudioContext;
  source?: AudioCaptureSourceNode;
  worklet?: AudioCaptureWorkletNode;
}>;

const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    autoGainControl: true,
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
  },
  video: false,
};

const SAFE_MESSAGES: Record<AudioCaptureErrorCode, string> = {
  CAPTURE_BUSY: "Microphone capture is completing another lifecycle operation.",
  CLEANUP_FAILED: "Microphone resources could not be fully released.",
  DEVICE_UNAVAILABLE: "No usable microphone is currently available.",
  FRAME_HANDLER_FAILED: "The microphone frame consumer rejected captured audio.",
  INVALID_WORKLET_FRAME: "The microphone processor returned an invalid audio frame.",
  PERMISSION_DENIED: "Microphone permission was denied.",
  START_CANCELLED: "Microphone startup was cancelled.",
  START_FAILED: "Microphone capture could not be started.",
  UNSUPPORTED_BROWSER: "This browser does not support AudioWorklet microphone capture.",
  WORKLET_FAILED: "The microphone processor stopped unexpectedly.",
};

export class AudioCaptureError extends Error {
  constructor(readonly code: AudioCaptureErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "AudioCaptureError";
  }
}

function defaultGetUserMedia(
  constraints: MediaStreamConstraints,
): Promise<AudioCaptureMediaStream> {
  if (
    typeof navigator === "undefined" ||
    navigator.mediaDevices?.getUserMedia === undefined
  ) {
    throw new AudioCaptureError("UNSUPPORTED_BROWSER");
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

function defaultCreateAudioContext(): AudioCaptureAudioContext {
  if (typeof globalThis.AudioContext !== "function") {
    throw new AudioCaptureError("UNSUPPORTED_BROWSER");
  }
  return new globalThis.AudioContext({
    latencyHint: "interactive",
  }) as unknown as AudioCaptureAudioContext;
}

function defaultCreateWorkletNode(
  context: AudioCaptureAudioContext,
  processorName: string,
  options: AudioWorkletNodeOptions,
): AudioCaptureWorkletNode {
  if (typeof globalThis.AudioWorkletNode !== "function") {
    throw new AudioCaptureError("UNSUPPORTED_BROWSER");
  }
  return new globalThis.AudioWorkletNode(
    context as unknown as BaseAudioContext,
    processorName,
    options,
  ) as unknown as AudioCaptureWorkletNode;
}

function namedError(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null || !("name" in cause)) {
    return null;
  }
  return typeof cause.name === "string" ? cause.name : null;
}

function normalizeStartError(cause: unknown): AudioCaptureError {
  if (cause instanceof AudioCaptureError) return cause;
  const name = namedError(cause);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new AudioCaptureError("PERMISSION_DENIED");
  }
  if (
    name === "AbortError" ||
    name === "NotFoundError" ||
    name === "NotReadableError" ||
    name === "OverconstrainedError"
  ) {
    return new AudioCaptureError("DEVICE_UNAVAILABLE");
  }
  return new AudioCaptureError("START_FAILED");
}

function snapshot(
  status: AudioCaptureStatus,
  failure: AudioCaptureError | null = null,
): AudioCaptureSnapshot {
  return Object.freeze({
    status,
    failure:
      failure === null
        ? null
        : Object.freeze({ code: failure.code, message: failure.message }),
  });
}

function isPcmFrame(value: unknown): value is AudioCaptureFrame & {
  type: "pcm_frame";
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "pcm_frame" &&
    Number.isSafeInteger(candidate.sequence) &&
    (candidate.sequence as number) >= 0 &&
    candidate.sampleRateHz === CAPTURE_SAMPLE_RATE_HZ &&
    candidate.channels === 1 &&
    candidate.encoding === "pcm_s16le" &&
    candidate.durationMs === CAPTURE_FRAME_DURATION_MS &&
    candidate.byteLength === CAPTURE_FRAME_BYTES &&
    candidate.pcm instanceof ArrayBuffer &&
    candidate.pcm.byteLength === CAPTURE_FRAME_BYTES
  );
}

async function cleanupCaptureResources(
  resources: CaptureResources | null,
): Promise<void> {
  if (resources === null) return;
  let failed = false;
  const attempt = (operation: () => void): void => {
    try {
      operation();
    } catch {
      failed = true;
    }
  };

  if (resources.worklet !== undefined) {
    attempt(() => resources.worklet?.port.postMessage({ type: "stop" }));
    attempt(() => {
      if (resources.worklet !== undefined) {
        resources.worklet.port.onmessage = null;
        resources.worklet.onprocessorerror = null;
      }
    });
  }
  if (resources.source !== undefined) {
    attempt(() => resources.source?.disconnect());
  }
  if (resources.worklet !== undefined) {
    attempt(() => resources.worklet?.disconnect());
  }
  let tracks: readonly AudioCaptureTrack[] = [];
  try {
    tracks = resources.stream.getTracks();
  } catch {
    failed = true;
  }
  for (const track of tracks) {
    attempt(() => track.stop());
  }
  if (resources.worklet?.port.close !== undefined) {
    attempt(() => resources.worklet?.port.close?.());
  }
  if (resources.context !== undefined && resources.context.state !== "closed") {
    try {
      await resources.context.close();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new AudioCaptureError("CLEANUP_FAILED");
}

export class BrowserAudioCaptureController {
  private currentSnapshot: AudioCaptureSnapshot = snapshot("idle");
  private resources: CaptureResources | null = null;
  private generation = 0;
  private expectedSequence = 0;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private failurePromise: Promise<void> | null = null;
  private stateObserverFailures = 0;

  constructor(private readonly options: AudioCaptureControllerOptions) {}

  get state(): AudioCaptureSnapshot {
    return this.currentSnapshot;
  }

  get observerFailures(): AudioCaptureObserverFailures {
    return Object.freeze({ state: this.stateObserverFailures });
  }

  async start(): Promise<void> {
    if (this.currentSnapshot.status === "capturing") return;
    if (this.startPromise !== null) return this.startPromise;
    if (
      this.currentSnapshot.status === "stopping" ||
      this.stopPromise !== null ||
      this.failurePromise !== null
    ) {
      throw new AudioCaptureError("CAPTURE_BUSY");
    }

    const generation = ++this.generation;
    const pending = this.startInternal(generation);
    this.startPromise = pending;
    try {
      await pending;
    } finally {
      if (this.startPromise === pending) this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise !== null) return this.stopPromise;
    if (
      this.startPromise === null &&
      this.resources === null &&
      (this.currentSnapshot.status === "idle" ||
        this.currentSnapshot.status === "stopped")
    ) {
      this.setState("stopped");
      return;
    }

    const pending = this.stopInternal();
    this.stopPromise = pending;
    try {
      await pending;
    } finally {
      if (this.stopPromise === pending) this.stopPromise = null;
    }
  }

  private async startInternal(generation: number): Promise<void> {
    let localResources: CaptureResources | null = null;
    let startupFailure: AudioCaptureError | null = null;
    try {
      const getUserMedia = this.options.getUserMedia ?? defaultGetUserMedia;
      const createAudioContext =
        this.options.createAudioContext ?? defaultCreateAudioContext;
      const createWorkletNode =
        this.options.createWorkletNode ?? defaultCreateWorkletNode;

      this.setState("requesting_permission");
      const stream = await getUserMedia(MICROPHONE_CONSTRAINTS);
      localResources = { stream };
      this.assertCurrentGeneration(generation);
      this.setState("starting");

      const context = createAudioContext();
      localResources = { context, stream };
      await context.audioWorklet.addModule(WORKLET_MODULE_URL);
      this.assertCurrentGeneration(generation);

      const worklet = createWorkletNode(context, WORKLET_PROCESSOR_NAME, {
        channelCount: 1,
        channelCountMode: "explicit",
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: {
          durationMs: CAPTURE_FRAME_DURATION_MS,
          sampleRateHz: CAPTURE_SAMPLE_RATE_HZ,
        },
      });
      const source = context.createMediaStreamSource(stream);
      localResources = { context, source, stream, worklet };
      worklet.port.onmessage = (event) => {
        if (
          this.currentSnapshot.status === "starting" &&
          typeof event.data === "object" &&
          event.data !== null &&
          !Array.isArray(event.data) &&
          (event.data as Record<string, unknown>).type === "worklet_error"
        ) {
          startupFailure = new AudioCaptureError("WORKLET_FAILED");
          return;
        }
        this.handleWorkletMessage(event.data);
      };
      worklet.onprocessorerror = () =>
        this.beginFailure(new AudioCaptureError("WORKLET_FAILED"));
      source.connect(worklet);
      await context.resume();
      this.assertCurrentGeneration(generation);
      if (startupFailure !== null) throw startupFailure;

      this.expectedSequence = 0;
      this.resources = localResources;
      this.setState("capturing");
      worklet.port.postMessage({ type: "arm", sequence: 0 });
      localResources = null;
    } catch (cause) {
      const error =
        generation === this.generation
          ? normalizeStartError(cause)
          : new AudioCaptureError("START_CANCELLED");
      if (this.resources === localResources) this.resources = null;
      try {
        await cleanupCaptureResources(localResources);
      } catch (cleanupCause) {
        const cleanupError = normalizeStartError(cleanupCause);
        if (generation === this.generation) {
          this.setFailure(cleanupError);
        }
        throw cleanupError;
      }
      if (generation === this.generation) {
        this.setFailure(error);
      }
      throw error;
    }
  }

  private async stopInternal(): Promise<void> {
    ++this.generation;
    this.setState("stopping");
    const resources = this.resources;
    const startPromise = this.startPromise;
    const failurePromise = this.failurePromise;
    this.resources = null;

    let failure: AudioCaptureError | null = null;
    try {
      await cleanupCaptureResources(resources);
    } catch (cause) {
      failure = normalizeStartError(cause);
    }
    if (startPromise !== null) {
      try {
        await startPromise;
      } catch (cause) {
        const startError = normalizeStartError(cause);
        if (startError.code !== "START_CANCELLED" && failure === null) {
          failure = startError;
        }
      }
    }
    if (failurePromise !== null) {
      try {
        await failurePromise;
      } catch (cause) {
        if (failure === null) failure = normalizeStartError(cause);
      }
    }
    if (failure !== null) {
      this.setFailure(failure);
      throw failure;
    }
    this.setState("stopped");
  }

  private handleWorkletMessage(value: unknown): void {
    if (this.currentSnapshot.status !== "capturing") return;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "worklet_ready"
    ) {
      return;
    }
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "worklet_armed"
    ) {
      return;
    }
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "worklet_error"
    ) {
      this.beginFailure(new AudioCaptureError("WORKLET_FAILED"));
      return;
    }
    if (!isPcmFrame(value) || value.sequence !== this.expectedSequence) {
      this.beginFailure(new AudioCaptureError("INVALID_WORKLET_FRAME"));
      return;
    }

    try {
      this.options.onFrame(
        Object.freeze({
          sequence: value.sequence,
          sampleRateHz: value.sampleRateHz,
          channels: value.channels,
          encoding: value.encoding,
          durationMs: value.durationMs,
          byteLength: value.byteLength,
          pcm: value.pcm,
        }),
      );
    } catch {
      this.beginFailure(new AudioCaptureError("FRAME_HANDLER_FAILED"));
      return;
    }
    const worklet = this.resources?.worklet;
    if (worklet === undefined) {
      this.beginFailure(new AudioCaptureError("WORKLET_FAILED"));
      return;
    }
    try {
      worklet.port.postMessage({
        type: "ack_frame",
        sequence: value.sequence,
      });
      this.expectedSequence += 1;
    } catch {
      this.beginFailure(new AudioCaptureError("WORKLET_FAILED"));
    }
  }

  private beginFailure(error: AudioCaptureError): void {
    if (this.failurePromise !== null) return;
    const pending = this.failActiveCapture(error);
    this.failurePromise = pending;
    void pending.finally(() => {
      if (this.failurePromise === pending) this.failurePromise = null;
    });
  }

  private async failActiveCapture(error: AudioCaptureError): Promise<void> {
    ++this.generation;
    const resources = this.resources;
    this.resources = null;
    this.setFailure(error);
    try {
      await cleanupCaptureResources(resources);
    } catch {
      this.setFailure(new AudioCaptureError("CLEANUP_FAILED"));
    }
  }

  private assertCurrentGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new AudioCaptureError("START_CANCELLED");
    }
  }

  private setState(status: AudioCaptureStatus): void {
    this.currentSnapshot = snapshot(status);
    this.notifyStateObserver();
  }

  private setFailure(error: AudioCaptureError): void {
    const status: AudioCaptureStatus =
      error.code === "PERMISSION_DENIED"
        ? "permission_denied"
        : error.code === "UNSUPPORTED_BROWSER"
          ? "unsupported"
          : "error";
    this.currentSnapshot = snapshot(status, error);
    this.notifyStateObserver();
  }

  private notifyStateObserver(): void {
    try {
      this.options.onStateChange?.(this.currentSnapshot);
    } catch {
      this.stateObserverFailures = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.stateObserverFailures + 1,
      );
    }
  }
}
