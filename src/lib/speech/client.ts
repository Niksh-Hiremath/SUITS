import {
  SPEECH_PROTOCOL,
  type SpeechCapabilitiesEvent,
  type SpeechClientControl,
  type SpeechFlowControlEvent,
  type SpeechReadyEvent,
  type SpeechServerEvent,
  type TtsAudioEvent,
  assertSpeechIdentifier,
  parseSpeechServerEventJson,
  serializeSpeechClientControl,
} from "./protocol";

const SOCKET_OPEN = 1;
const MAX_TOMBSTONES = 2_048;
const MAX_RESPONSE_TOMBSTONES = MAX_TOMBSTONES * 2;

export interface SpeechSocketMessageEvent {
  readonly data: unknown;
}

export interface SpeechSocketCloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface SpeechSocket {
  readonly protocol: string;
  readonly readyState: number;
  binaryType: "blob" | "arraybuffer";
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: SpeechSocketMessageEvent) => void) | null;
  onclose: ((event: SpeechSocketCloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export type SpeechSocketFactory = (
  url: string,
  protocols: readonly string[],
) => SpeechSocket;

export type SpeechConnectionState =
  | "idle"
  | "connecting"
  | "ready"
  | "disconnected";

type NonAudioServerEvent = Exclude<SpeechServerEvent, { type: "tts_audio" }>;

export interface TtsAudioFrameEvent {
  readonly type: "tts_audio_frame";
  readonly metadata: TtsAudioEvent;
  /** Ephemeral local playback bytes. The client never stores or serializes this buffer. */
  readonly pcmS16le: ArrayBuffer;
  /** Release the service's byte window only after the frame is accepted for playback. */
  readonly acknowledge: () => boolean;
}

export type SpeechClientEvent =
  | NonAudioServerEvent
  | TtsAudioFrameEvent
  | {
      readonly type: "client_state";
      readonly state: SpeechConnectionState;
    }
  | {
      readonly type: "client_error";
      readonly code: string;
    };

export interface SpeechConnectionInfo {
  readonly ready: SpeechReadyEvent;
  readonly capabilities: SpeechCapabilitiesEvent;
  readonly flowControl: SpeechFlowControlEvent;
}

export interface SpeechClientOptions {
  readonly url: string;
  readonly clientId: string;
  readonly socketFactory?: SpeechSocketFactory;
  readonly idFactory?: (prefix: string) => string;
  readonly now?: () => number;
  readonly handshakeTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

export interface StartUtteranceOptions {
  readonly utteranceId: string;
  readonly sampleRateHz?: number;
  readonly bargeIn?: boolean;
  readonly endOfUtteranceSilenceMs?: number;
}

interface SynthesisBase {
  readonly jobId: string;
  readonly responseId: string;
  readonly actor: string;
  readonly sequence: number;
  readonly voiceId?: string;
  readonly isFinal?: boolean;
}

export type SynthesisRequest = SynthesisBase &
  (
    | { readonly text: string; readonly clipId?: never }
    | { readonly clipId: string; readonly text?: never }
  );

export type CancelSynthesisRequest =
  | { readonly scope: "job"; readonly jobId: string; readonly reason?: string }
  | {
      readonly scope: "response";
      readonly responseId: string;
      readonly reason?: string;
    }
  | { readonly scope: "all"; readonly reason?: string };

interface ConnectAttempt {
  readonly generation: number;
  readonly promise: Promise<SpeechConnectionInfo>;
  readonly resolve: (info: SpeechConnectionInfo) => void;
  readonly reject: (error: SpeechClientError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  ready: SpeechReadyEvent | null;
  capabilities: SpeechCapabilitiesEvent | null;
  flowControl: SpeechFlowControlEvent | null;
}

interface LoadRequest {
  readonly generation: number;
  readonly resolve: (event: SpeechCapabilitiesEvent) => void;
  readonly reject: (error: SpeechClientError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface UtteranceState {
  readonly utteranceId: string;
  readonly sampleRateHz: number;
  nextSequence: number;
  lastRevision: number;
  status: "listening" | "finalizing" | "final" | "cancelled" | "failed";
}

interface ResponseState {
  nextSequence: number;
  status: "open" | "closed" | "cancelled";
}

interface TtsJobState {
  readonly jobId: string;
  readonly responseId: string;
  readonly actor: string;
  readonly sequence: number;
  status: "queued" | "started" | "finished" | "cancelled";
  nextFrameSequence: number;
  readonly seenFrameTokens: Set<string>;
  readonly unacknowledgedFrameTokens: Set<string>;
}

interface PendingTtsFrame {
  readonly generation: number;
  readonly metadata: TtsAudioEvent;
  readonly deliver: boolean;
}

export class SpeechClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SpeechClientError";
  }
}

function defaultSocketFactory(url: string, protocols: readonly string[]): SpeechSocket {
  if (typeof globalThis.WebSocket !== "function") {
    throw new SpeechClientError(
      "WEBSOCKET_UNAVAILABLE",
      "WebSocket is unavailable in this browser context",
    );
  }
  return new globalThis.WebSocket(url, [...protocols]) as unknown as SpeechSocket;
}

function isIpv4Loopback(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets[0] !== "127") return false;
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

export function assertLoopbackSpeechUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SpeechClientError(
      "INVALID_SPEECH_URL",
      "the local speech WebSocket URL is invalid",
    );
  }
  const hostname = url.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    isIpv4Loopback(hostname);
  if (
    (url.protocol !== "ws:" && url.protocol !== "wss:") ||
    !loopback ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/v1/speech" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new SpeechClientError(
      "NON_LOOPBACK_SPEECH_URL",
      "raw audio may connect only to the local speech companion",
    );
  }
  return url.toString();
}

export class LocalSpeechClient {
  private readonly url: string;
  private readonly clientId: string;
  private readonly socketFactory: SpeechSocketFactory;
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => number;
  private readonly handshakeTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly listeners = new Set<(event: SpeechClientEvent) => void>();

  private stateValue: SpeechConnectionState = "idle";
  private generation = 0;
  private fallbackId = 0;
  private socket: SpeechSocket | null = null;
  private connectAttempt: ConnectAttempt | null = null;
  private readyValue: SpeechReadyEvent | null = null;
  private capabilitiesValue: SpeechCapabilitiesEvent | null = null;
  private flowControlValue: SpeechFlowControlEvent | null = null;
  private lastSttCreditRevision = 0;
  private sttServerAvailableFrames = 0;
  private sttServerAvailableBytes = 0;
  private sttAvailableFrames = 0;
  private sttAvailableBytes = 0;
  private readonly sttUnaccountedFrames = new Map<string, Map<number, number>>();
  private readonly sttHighestSentSequence = new Map<string, number>();
  private readonly sttAcceptedWatermarks = new Map<string, number>();
  private pendingTtsFrame: PendingTtsFrame | null = null;
  private activeUtteranceId: string | null = null;

  private readonly loadRequests = new Map<string, LoadRequest>();
  private readonly usedRequestIds = new Set<string>();
  private readonly utterances = new Map<string, UtteranceState>();
  private readonly utteranceOrder: string[] = [];
  private readonly responses = new Map<string, ResponseState>();
  private readonly responseOrder: string[] = [];
  private readonly jobs = new Map<string, TtsJobState>();
  private readonly jobOrder: string[] = [];

  constructor(options: SpeechClientOptions) {
    this.url = assertLoopbackSpeechUrl(options.url);
    this.clientId = assertSpeechIdentifier(options.clientId);
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? ((prefix) => this.createFallbackId(prefix));
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    if (this.handshakeTimeoutMs < 100 || this.requestTimeoutMs < 100) {
      throw new SpeechClientError(
        "INVALID_TIMEOUT",
        "speech client timeouts must be at least 100 milliseconds",
      );
    }
  }

  get state(): SpeechConnectionState {
    return this.stateValue;
  }

  get capabilities(): SpeechCapabilitiesEvent | null {
    return this.capabilitiesValue;
  }

  get flowControl(): SpeechFlowControlEvent | null {
    return this.flowControlValue;
  }

  subscribe(listener: (event: SpeechClientEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): Promise<SpeechConnectionInfo> {
    if (this.stateValue === "ready") {
      return Promise.resolve(this.connectionInfo());
    }
    if (this.connectAttempt !== null) return this.connectAttempt.promise;

    this.resetSessionState(
      new SpeechClientError("SESSION_REPLACED", "the local speech session was replaced"),
    );
    this.generation += 1;
    const generation = this.generation;
    let resolveAttempt!: (info: SpeechConnectionInfo) => void;
    let rejectAttempt!: (error: SpeechClientError) => void;
    const promise = new Promise<SpeechConnectionInfo>((resolve, reject) => {
      resolveAttempt = resolve;
      rejectAttempt = reject;
    });
    const timer = setTimeout(() => {
      if (this.connectAttempt?.generation !== generation) return;
      this.abortConnection(
        "HANDSHAKE_TIMEOUT",
        "the local speech companion did not complete its handshake",
      );
    }, this.handshakeTimeoutMs);
    this.connectAttempt = {
      generation,
      promise,
      resolve: resolveAttempt,
      reject: rejectAttempt,
      timer,
      ready: null,
      capabilities: null,
      flowControl: null,
    };
    this.setState("connecting");

    let socket: SpeechSocket;
    try {
      socket = this.socketFactory(this.url, [SPEECH_PROTOCOL]);
    } catch {
      this.abortConnection(
        "SOCKET_CREATE_FAILED",
        "the local speech WebSocket could not be created",
      );
      return promise;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => this.handleOpen(socket, generation);
    socket.onmessage = (event) => this.handleMessage(socket, generation, event.data);
    socket.onclose = (event) => this.handleClose(socket, generation, event);
    socket.onerror = () => {
      if (!this.isCurrentSocket(socket, generation)) return;
      this.abortConnection(
        "SOCKET_ERROR",
        "the local speech WebSocket reported a transport error",
      );
    };
    return promise;
  }

  reconnect(): Promise<SpeechConnectionInfo> {
    this.disconnect("client_reconnect");
    return this.connect();
  }

  disconnect(reason = "client_disconnect"): void {
    const socket = this.socket;
    const wasActive = this.stateValue !== "idle" && this.stateValue !== "disconnected";
    this.generation += 1;
    this.detachSocket(socket);
    this.socket = null;
    if (socket !== null && socket.readyState <= SOCKET_OPEN) {
      try {
        socket.close(1_000, reason.slice(0, 123));
      } catch {
        // The generation fence already makes this transport inert.
      }
    }
    this.resetSessionState(
      new SpeechClientError("CLIENT_DISCONNECTED", "the local speech client disconnected"),
    );
    if (wasActive || this.stateValue !== "disconnected") this.setState("disconnected");
  }

  loadModels(options: {
    readonly requestId?: string;
    readonly sttProvider?: string;
    readonly ttsProvider?: string;
    readonly warmup?: boolean;
  } = {}): Promise<SpeechCapabilitiesEvent> {
    this.assertReady();
    const requestId = this.claimRequestId(options.requestId ?? this.newId("load"));
    const generation = this.generation;
    return new Promise<SpeechCapabilitiesEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.loadRequests.get(requestId);
        if (pending?.generation !== generation) return;
        this.loadRequests.delete(requestId);
        reject(
          new SpeechClientError(
            "REQUEST_TIMEOUT",
            "the local speech model request exceeded its deadline",
          ),
        );
      }, this.requestTimeoutMs);
      this.loadRequests.set(requestId, { generation, resolve, reject, timer });
      try {
        this.sendControl({
          protocol: SPEECH_PROTOCOL,
          type: "load_models",
          requestId,
          ...(options.sttProvider === undefined
            ? {}
            : { sttProvider: assertSpeechIdentifier(options.sttProvider) }),
          ...(options.ttsProvider === undefined
            ? {}
            : { ttsProvider: assertSpeechIdentifier(options.ttsProvider) }),
          warmup: options.warmup ?? true,
        });
      } catch (error) {
        clearTimeout(timer);
        this.loadRequests.delete(requestId);
        reject(this.safeClientError(error));
      }
    });
  }

  startUtterance(options: StartUtteranceOptions): void {
    this.assertReady();
    const utteranceId = assertSpeechIdentifier(options.utteranceId);
    if (this.activeUtteranceId !== null) {
      throw new SpeechClientError(
        "UTTERANCE_ACTIVE",
        "only one local microphone utterance may be active",
      );
    }
    if (this.utterances.has(utteranceId)) {
      throw new SpeechClientError(
        "UTTERANCE_REUSED",
        "utteranceId cannot be reused in one local speech session",
      );
    }
    const sampleRateHz = options.sampleRateHz ?? 16_000;
    const bargeIn = options.bargeIn ?? true;
    this.sendControl({
      protocol: SPEECH_PROTOCOL,
      type: "start_utterance",
      utteranceId,
      sampleRateHz,
      channels: 1,
      encoding: "pcm_s16le",
      bargeIn,
      endOfUtteranceSilenceMs: options.endOfUtteranceSilenceMs ?? 600,
    });
    if (bargeIn) this.fenceAllSynthesis();
    this.rememberUtterance({
      utteranceId,
      sampleRateHz,
      nextSequence: 0,
      lastRevision: 0,
      status: "listening",
    });
    this.sttUnaccountedFrames.set(utteranceId, new Map());
    this.sttHighestSentSequence.set(utteranceId, -1);
    this.sttAcceptedWatermarks.set(utteranceId, -1);
    this.activeUtteranceId = utteranceId;
  }

  sendPcmFrame(utteranceIdValue: string, pcmS16le: Int16Array): number {
    this.assertReady();
    const utteranceId = assertSpeechIdentifier(utteranceIdValue);
    const utterance = this.utterances.get(utteranceId);
    if (
      utterance === undefined ||
      utterance.status !== "listening" ||
      this.activeUtteranceId !== utteranceId
    ) {
      throw new SpeechClientError(
        "UTTERANCE_NOT_LISTENING",
        "PCM requires its matching local microphone utterance",
      );
    }
    const byteLength = pcmS16le.byteLength;
    const durationMs = (byteLength * 1_000) / (utterance.sampleRateHz * 2);
    if (
      byteLength < 2 ||
      byteLength % 2 !== 0 ||
      !Number.isInteger(durationMs) ||
      durationMs < 1 ||
      durationMs > 2_000 ||
      byteLength > (this.capabilitiesValue?.maxAudioChunkBytes ?? 0)
    ) {
      throw new SpeechClientError(
        "INVALID_PCM_FRAME",
        "PCM frame length is incompatible with the negotiated local format",
      );
    }
    if (this.sttAvailableFrames < 1 || this.sttAvailableBytes < byteLength) {
      throw new SpeechClientError(
        "STT_BACKPRESSURE",
        "local microphone input has exhausted its advertised credits",
      );
    }

    const sequence = utterance.nextSequence;
    const header: SpeechClientControl = {
      protocol: SPEECH_PROTOCOL,
      type: "audio_chunk",
      utteranceId,
      sequence,
      byteLength,
      durationMs,
    };
    const socket = this.assertReady();
    this.sendSerialized(socket, serializeSpeechClientControl(header));
    try {
      socket.send(pcmS16le);
    } catch {
      this.abortConnection(
        "BINARY_SEND_FAILED",
        "the local microphone frame could not be sent",
      );
      throw new SpeechClientError(
        "BINARY_SEND_FAILED",
        "the local microphone frame could not be sent",
      );
    }
    const pending = this.sttUnaccountedFrames.get(utteranceId);
    if (pending === undefined || pending.has(sequence)) {
      this.abortConnection(
        "INVALID_STT_ACCOUNTING",
        "local microphone accounting entered an impossible state",
      );
      throw new SpeechClientError(
        "INVALID_STT_ACCOUNTING",
        "local microphone accounting entered an impossible state",
      );
    }
    pending.set(sequence, byteLength);
    this.sttHighestSentSequence.set(utteranceId, sequence);
    utterance.nextSequence += 1;
    this.recalculateEffectiveSttCredits();
    return sequence;
  }

  endUtterance(utteranceIdValue: string): void {
    const utteranceId = assertSpeechIdentifier(utteranceIdValue);
    const utterance = this.utterances.get(utteranceId);
    if (
      utterance === undefined ||
      utterance.status !== "listening" ||
      this.activeUtteranceId !== utteranceId
    ) {
      throw new SpeechClientError(
        "UTTERANCE_NOT_LISTENING",
        "endUtterance requires its matching local microphone utterance",
      );
    }
    this.sendControl({
      protocol: SPEECH_PROTOCOL,
      type: "end_utterance",
      utteranceId,
    });
    utterance.status = "finalizing";
  }

  cancelUtterance(utteranceIdValue: string, reason = "client_cancelled"): void {
    const utteranceId = assertSpeechIdentifier(utteranceIdValue);
    const utterance = this.utterances.get(utteranceId);
    if (
      utterance === undefined ||
      !["listening", "finalizing"].includes(utterance.status)
    ) {
      throw new SpeechClientError(
        "UTTERANCE_NOT_ACTIVE",
        "cancelUtterance requires its matching local microphone utterance",
      );
    }
    this.sendControl({
      protocol: SPEECH_PROTOCOL,
      type: "cancel_utterance",
      utteranceId,
      reason,
    });
    utterance.status = "cancelled";
    if (this.activeUtteranceId === utteranceId) this.activeUtteranceId = null;
  }

  synthesize(request: SynthesisRequest): void {
    this.assertReady();
    const jobId = assertSpeechIdentifier(request.jobId);
    const responseId = assertSpeechIdentifier(request.responseId);
    const actor = assertSpeechIdentifier(request.actor);
    if (this.jobs.has(jobId)) {
      throw new SpeechClientError(
        "TTS_JOB_REUSED",
        "jobId cannot be reused in one local speech session",
      );
    }
    const activeJobCount = [...this.jobs.values()].filter(
      (job) => job.status === "queued" || job.status === "started",
    ).length;
    if (activeJobCount >= (this.capabilitiesValue?.maxTtsQueueDepth ?? 0)) {
      throw new SpeechClientError(
        "TTS_BACKPRESSURE",
        "the local TTS phrase queue has reached its advertised depth",
      );
    }
    const existingResponse = this.responses.get(responseId);
    const response = existingResponse ?? {
      nextSequence: 0,
      status: "open" as const,
    };
    if (response.status !== "open" || request.sequence !== response.nextSequence) {
      throw new SpeechClientError(
        "INVALID_TTS_SEQUENCE",
        "TTS phrase sequence is stale or non-contiguous",
      );
    }
    const control: SpeechClientControl = {
      protocol: SPEECH_PROTOCOL,
      type: "synthesize",
      jobId,
      responseId,
      actor,
      sequence: request.sequence,
      ...(request.text === undefined ? { clipId: request.clipId } : { text: request.text }),
      ...(request.voiceId === undefined
        ? {}
        : { voiceId: assertSpeechIdentifier(request.voiceId) }),
      isFinal: request.isFinal ?? true,
    };
    this.sendControl(control);
    response.nextSequence += 1;
    if (request.isFinal ?? true) response.status = "closed";
    if (existingResponse === undefined) this.rememberResponse(responseId, response);
    this.rememberJob({
      jobId,
      responseId,
      actor,
      sequence: request.sequence,
      status: "queued",
      nextFrameSequence: 0,
      seenFrameTokens: new Set(),
      unacknowledgedFrameTokens: new Set(),
    });
  }

  cancelSynthesis(request: CancelSynthesisRequest): void {
    const reason = request.reason ?? "client_cancelled";
    if (request.scope === "job") {
      const jobId = assertSpeechIdentifier(request.jobId);
      if (!this.jobs.has(jobId)) {
        throw new SpeechClientError("UNKNOWN_TTS_JOB", "the TTS job is unknown locally");
      }
      this.sendControl({
        protocol: SPEECH_PROTOCOL,
        type: "cancel_synthesis",
        scope: "job",
        jobId,
        reason,
      });
      this.fenceJobAndResponse(jobId);
      return;
    }
    if (request.scope === "response") {
      const responseId = assertSpeechIdentifier(request.responseId);
      if (!this.responses.has(responseId)) {
        throw new SpeechClientError(
          "UNKNOWN_TTS_RESPONSE",
          "the TTS response is unknown locally",
        );
      }
      this.sendControl({
        protocol: SPEECH_PROTOCOL,
        type: "cancel_synthesis",
        scope: "response",
        responseId,
        reason,
      });
      this.fenceResponse(responseId);
      return;
    }
    this.sendControl({
      protocol: SPEECH_PROTOCOL,
      type: "cancel_synthesis",
      scope: "all",
      reason,
    });
    this.fenceAllSynthesis();
  }

  setVoice(actorValue: string, voiceIdValue: string): void {
    this.sendControl({
      protocol: SPEECH_PROTOCOL,
      type: "set_voice",
      actor: assertSpeechIdentifier(actorValue),
      voiceId: assertSpeechIdentifier(voiceIdValue),
    });
  }

  ping(nonceValue = this.newId("ping")): string {
    const nonce = assertSpeechIdentifier(nonceValue);
    this.sendControl({
      protocol: SPEECH_PROTOCOL,
      type: "ping",
      nonce,
      sentAtMs: Math.max(0, Math.floor(this.now())),
    });
    return nonce;
  }

  private handleOpen(socket: SpeechSocket, generation: number): void {
    if (!this.isCurrentSocket(socket, generation)) return;
    if (socket.protocol !== SPEECH_PROTOCOL) {
      this.abortConnection(
        "PROTOCOL_NEGOTIATION_FAILED",
        "the local speech companion negotiated an unexpected protocol",
      );
      return;
    }
    const requestId = this.claimRequestId(this.newId("hello"));
    this.sendSerialized(
      socket,
      serializeSpeechClientControl({
        protocol: SPEECH_PROTOCOL,
        type: "hello",
        requestId,
        clientId: this.clientId,
        supportedProtocols: [SPEECH_PROTOCOL],
      }),
    );
  }

  private handleMessage(socket: SpeechSocket, generation: number, data: unknown): void {
    if (!this.isCurrentSocket(socket, generation)) return;
    if (typeof data === "string") {
      if (this.pendingTtsFrame !== null) {
        this.abortConnection(
          "TTS_BINARY_REQUIRED",
          "TTS audio metadata was not followed by its binary frame",
        );
        return;
      }
      let event: SpeechServerEvent;
      try {
        event = parseSpeechServerEventJson(data);
      } catch {
        this.abortConnection(
          "INVALID_SERVER_CONTROL",
          "the local speech companion sent invalid control data",
        );
        return;
      }
      if (event.type === "tts_audio") {
        this.acceptTtsHeader(event, generation);
        return;
      }
      this.acceptServerEvent(event);
      return;
    }
    if (!(data instanceof ArrayBuffer)) {
      this.abortConnection(
        "INVALID_BINARY_FRAME",
        "the local speech companion sent an unsupported binary frame",
      );
      return;
    }
    this.acceptTtsBinary(data, generation);
  }

  private handleClose(
    socket: SpeechSocket,
    generation: number,
    event: SpeechSocketCloseEvent,
  ): void {
    if (!this.isCurrentSocket(socket, generation)) return;
    this.detachSocket(socket);
    this.socket = null;
    const code = Number.isInteger(event.code) ? event.code : 1_006;
    this.resetSessionState(
      new SpeechClientError(
        "SOCKET_CLOSED",
        `the local speech WebSocket closed (${code})`,
      ),
    );
    this.setState("disconnected");
  }

  private acceptServerEvent(event: NonAudioServerEvent): void {
    const attempt = this.connectAttempt;
    if (attempt !== null) {
      if (event.type === "ready") {
        if (attempt.ready !== null) {
          this.abortConnection("DUPLICATE_READY", "the speech handshake repeated ready");
          return;
        }
        attempt.ready = event;
        this.readyValue = event;
        this.emit(event);
        this.finishHandshakeIfReady(attempt);
        return;
      }
      if (attempt.ready === null) {
        this.abortConnection(
          "READY_REQUIRED",
          "ready must be the first local speech server event",
        );
        return;
      }
      if (event.type === "capabilities") {
        if (attempt.capabilities !== null || event.requestId != null) {
          this.abortConnection(
            "INVALID_INITIAL_CAPABILITIES",
            "the speech handshake sent invalid initial capabilities",
          );
          return;
        }
        attempt.capabilities = event;
        this.capabilitiesValue = event;
        this.emit(event);
        this.finishHandshakeIfReady(attempt);
        return;
      }
      if (attempt.capabilities === null) {
        this.abortConnection(
          "CAPABILITIES_REQUIRED",
          "capabilities must follow ready during the speech handshake",
        );
        return;
      }
      if (event.type === "flow_control" && attempt.flowControl === null) {
        attempt.flowControl = event;
        if (!this.applyFlowControl(event)) return;
        this.emit(event);
        this.finishHandshakeIfReady(attempt);
        return;
      }
      this.abortConnection(
        "FLOW_CONTROL_REQUIRED",
        "flow control must complete the speech handshake",
      );
      return;
    }

    switch (event.type) {
      case "ready":
        this.abortConnection("DUPLICATE_READY", "the local speech session repeated ready");
        return;
      case "capabilities":
        this.acceptCapabilities(event);
        return;
      case "flow_control":
        if (!this.applyFlowControl(event)) return;
        this.emit(event);
        return;
      case "speech_started": {
        const utterance = this.utterances.get(event.utteranceId);
        if (
          utterance !== undefined &&
          this.activeUtteranceId === event.utteranceId &&
          ["listening", "finalizing"].includes(utterance.status)
        ) {
          this.emit(event);
        }
        return;
      }
      case "stt_partial":
      case "stt_final":
        this.acceptTranscript(event);
        return;
      case "speech_ended": {
        const utterance = this.utterances.get(event.utteranceId);
        if (utterance !== undefined) {
          if (["listening", "finalizing"].includes(utterance.status)) {
            utterance.status = event.reason === "cancelled" ? "cancelled" : "failed";
            if (this.activeUtteranceId === event.utteranceId) {
              this.activeUtteranceId = null;
            }
          }
          this.emit(event);
        }
        return;
      }
      case "tts_started":
      case "tts_timing":
      case "tts_finished":
        this.acceptTtsLifecycle(event);
        return;
      case "cancelled":
        this.acceptCancellation(event);
        this.emit(event);
        return;
      case "error":
        this.acceptServiceError(event);
        return;
      case "metrics":
      case "pong":
        this.emit(event);
        return;
    }
  }

  private acceptCapabilities(event: SpeechCapabilitiesEvent): void {
    if (event.requestId == null) {
      this.capabilitiesValue = event;
      this.emit(event);
      return;
    }
    const pending = this.loadRequests.get(event.requestId);
    if (pending === undefined || pending.generation !== this.generation) return;
    clearTimeout(pending.timer);
    this.loadRequests.delete(event.requestId);
    this.capabilitiesValue = event;
    pending.resolve(event);
    this.emit(event);
  }

  private acceptTranscript(event: Extract<NonAudioServerEvent, { type: "stt_partial" | "stt_final" }>): void {
    const utterance = this.utterances.get(event.utteranceId);
    if (
      utterance === undefined ||
      this.activeUtteranceId !== event.utteranceId ||
      !["listening", "finalizing"].includes(utterance.status) ||
      event.revision <= utterance.lastRevision
    ) {
      return;
    }
    utterance.lastRevision = event.revision;
    if (event.type === "stt_final") {
      utterance.status = "final";
      this.activeUtteranceId = null;
    }
    this.emit(event);
  }

  private acceptTtsLifecycle(
    event: Extract<NonAudioServerEvent, { type: "tts_started" | "tts_timing" | "tts_finished" }>,
  ): void {
    const job = this.jobs.get(event.jobId);
    if (job === undefined || !this.ttsIdentityMatches(job, event)) {
      this.abortConnection(
        "INVALID_TTS_IDENTITY",
        "TTS event identity did not match a local synthesis job",
      );
      return;
    }
    if (job.status === "cancelled" || job.status === "finished") return;
    if (event.type === "tts_started") {
      if (job.status !== "queued") {
        this.abortConnection("INVALID_TTS_STATE", "TTS started in an invalid local state");
        return;
      }
      job.status = "started";
      this.emit(event);
      return;
    }
    if (job.status !== "started") {
      this.abortConnection("INVALID_TTS_STATE", "TTS metadata arrived before start");
      return;
    }
    if (event.type === "tts_finished") {
      if (job.unacknowledgedFrameTokens.size !== 0) {
        this.abortConnection(
          "TTS_FINISHED_BEFORE_ACK",
          "TTS finished before local playback acknowledged every frame",
        );
        return;
      }
      job.status = "finished";
      this.clearTerminalJobTokens(job);
    }
    this.emit(event);
  }

  private acceptTtsHeader(event: TtsAudioEvent, generation: number): void {
    if (this.connectAttempt !== null || this.stateValue !== "ready") {
      this.abortConnection("HANDSHAKE_INCOMPLETE", "TTS audio arrived before handshake");
      return;
    }
    const job = this.jobs.get(event.jobId);
    if (job === undefined || !this.ttsIdentityMatches(job, event)) {
      this.abortConnection(
        "INVALID_TTS_IDENTITY",
        "TTS audio identity did not match a local synthesis job",
      );
      return;
    }
    if (job.status !== "started" && job.status !== "cancelled") {
      this.abortConnection(
        "INVALID_TTS_STATE",
        "TTS audio arrived outside an active synthesis job",
      );
      return;
    }
    if (
      event.frameSequence !== job.nextFrameSequence ||
      job.seenFrameTokens.has(event.frameToken)
    ) {
      this.abortConnection(
        "STALE_TTS_FRAME",
        "TTS audio frames must be unique and contiguous",
      );
      return;
    }
    this.pendingTtsFrame = {
      generation,
      metadata: event,
      deliver: job.status === "started",
    };
  }

  private acceptTtsBinary(pcmS16le: ArrayBuffer, generation: number): void {
    const pending = this.pendingTtsFrame;
    this.pendingTtsFrame = null;
    if (pending === null || pending.generation !== generation) {
      this.abortConnection(
        "UNEXPECTED_TTS_BINARY",
        "binary TTS audio requires its immediately preceding metadata",
      );
      return;
    }
    if (
      pcmS16le.byteLength !== pending.metadata.byteLength ||
      pcmS16le.byteLength % 2 !== 0
    ) {
      this.abortConnection(
        "TTS_LENGTH_MISMATCH",
        "binary TTS audio length did not match its metadata",
      );
      return;
    }
    const job = this.jobs.get(pending.metadata.jobId);
    if (job === undefined || !this.ttsIdentityMatches(job, pending.metadata)) {
      this.abortConnection(
        "INVALID_TTS_IDENTITY",
        "binary TTS audio no longer matched its local synthesis job",
      );
      return;
    }
    job.nextFrameSequence += 1;
    if (!pending.deliver || job.status !== "started") return;
    job.seenFrameTokens.add(pending.metadata.frameToken);
    job.unacknowledgedFrameTokens.add(pending.metadata.frameToken);
    const generationAtDelivery = this.generation;
    const metadata = pending.metadata;
    let acknowledged = false;
    const acknowledge = (): boolean => {
      if (
        acknowledged ||
        generationAtDelivery !== this.generation ||
        job.status !== "started" ||
        !job.unacknowledgedFrameTokens.has(metadata.frameToken)
      ) {
        return false;
      }
      try {
        this.sendControl({
          protocol: SPEECH_PROTOCOL,
          type: "ack_tts_audio",
          jobId: metadata.jobId,
          responseId: metadata.responseId,
          frameSequence: metadata.frameSequence,
          frameToken: metadata.frameToken,
          byteLength: metadata.byteLength,
        });
      } catch {
        return false;
      }
      acknowledged = true;
      job.unacknowledgedFrameTokens.delete(metadata.frameToken);
      return true;
    };
    this.emit({
      type: "tts_audio_frame",
      metadata,
      pcmS16le,
      acknowledge,
    });
  }

  private acceptCancellation(event: Extract<NonAudioServerEvent, { type: "cancelled" }>): void {
    if (event.target === "all_synthesis") {
      this.fenceAllSynthesis();
      return;
    }
    if (event.target === "job" && event.targetId != null) {
      this.fenceJobAndResponse(event.targetId);
      return;
    }
    if (event.target === "response" && event.targetId != null) {
      this.fenceResponse(event.targetId);
      return;
    }
    if (event.target === "utterance" && event.targetId != null) {
      const utterance = this.utterances.get(event.targetId);
      if (utterance !== undefined && utterance.status !== "final") {
        utterance.status = "cancelled";
        if (this.activeUtteranceId === event.targetId) this.activeUtteranceId = null;
      }
    }
  }

  private acceptServiceError(event: Extract<NonAudioServerEvent, { type: "error" }>): void {
    if (event.requestId != null) {
      const pending = this.loadRequests.get(event.requestId);
      if (pending !== undefined && pending.generation === this.generation) {
        clearTimeout(pending.timer);
        this.loadRequests.delete(event.requestId);
        pending.reject(
          new SpeechClientError(
            event.code,
            "the local speech model request was rejected",
          ),
        );
      } else {
        return;
      }
    }
    if (event.utteranceId != null) {
      const utterance = this.utterances.get(event.utteranceId);
      if (utterance !== undefined && utterance.status !== "final") {
        utterance.status = "failed";
        if (this.activeUtteranceId === event.utteranceId) this.activeUtteranceId = null;
      }
    }
    if (event.jobId != null) this.fenceJobAndResponse(event.jobId);
    this.emit(event);
    if (event.fatal) {
      this.abortConnection(event.code, "the local speech companion reported a fatal error");
    }
  }

  private applyFlowControl(event: SpeechFlowControlEvent): boolean {
    if (event.sttCreditRevision <= this.lastSttCreditRevision) return false;

    if (event.sttUtteranceId !== null) {
      const highestSent = this.sttHighestSentSequence.get(event.sttUtteranceId);
      const priorWatermark = this.sttAcceptedWatermarks.get(event.sttUtteranceId);
      if (highestSent === undefined || priorWatermark === undefined) {
        this.abortConnection(
          "UNKNOWN_STT_CREDIT_IDENTITY",
          "the local speech companion reported an unknown microphone identity",
        );
        return false;
      }
      if (
        event.sttAcceptedThroughSequence > highestSent ||
        event.sttAcceptedThroughSequence < priorWatermark
      ) {
        this.abortConnection(
          "IMPOSSIBLE_STT_WATERMARK",
          "the local speech companion reported an impossible microphone watermark",
        );
        return false;
      }
      const pending = this.sttUnaccountedFrames.get(event.sttUtteranceId);
      if (pending !== undefined) {
        for (const sequence of pending.keys()) {
          if (sequence <= event.sttAcceptedThroughSequence) pending.delete(sequence);
        }
      }
      this.sttAcceptedWatermarks.set(
        event.sttUtteranceId,
        event.sttAcceptedThroughSequence,
      );
    }

    this.lastSttCreditRevision = event.sttCreditRevision;
    this.flowControlValue = event;
    this.sttServerAvailableFrames = event.sttAvailableFrames;
    this.sttServerAvailableBytes = event.sttAvailableBytes;
    this.recalculateEffectiveSttCredits();
    return true;
  }

  private recalculateEffectiveSttCredits(): void {
    let unaccountedFrames = 0;
    let unaccountedBytes = 0;
    for (const frames of this.sttUnaccountedFrames.values()) {
      unaccountedFrames += frames.size;
      for (const byteLength of frames.values()) unaccountedBytes += byteLength;
    }
    this.sttAvailableFrames = Math.max(
      0,
      this.sttServerAvailableFrames - unaccountedFrames,
    );
    this.sttAvailableBytes = Math.max(
      0,
      this.sttServerAvailableBytes - unaccountedBytes,
    );
  }

  private finishHandshakeIfReady(attempt: ConnectAttempt): void {
    if (
      this.connectAttempt !== attempt ||
      attempt.ready === null ||
      attempt.capabilities === null ||
      attempt.flowControl === null
    ) {
      return;
    }
    clearTimeout(attempt.timer);
    this.connectAttempt = null;
    this.setState("ready");
    attempt.resolve({
      ready: attempt.ready,
      capabilities: attempt.capabilities,
      flowControl: attempt.flowControl,
    });
  }

  private connectionInfo(): SpeechConnectionInfo {
    if (
      this.readyValue === null ||
      this.capabilitiesValue === null ||
      this.flowControlValue === null
    ) {
      throw new SpeechClientError(
        "HANDSHAKE_INCOMPLETE",
        "the local speech handshake is incomplete",
      );
    }
    return {
      ready: this.readyValue,
      capabilities: this.capabilitiesValue,
      flowControl: this.flowControlValue,
    };
  }

  private sendControl(control: SpeechClientControl): void {
    const socket = this.assertReady();
    this.sendSerialized(socket, serializeSpeechClientControl(control));
  }

  private sendSerialized(socket: SpeechSocket, payload: string): void {
    if (socket !== this.socket || socket.readyState !== SOCKET_OPEN) {
      throw new SpeechClientError("SOCKET_NOT_OPEN", "the local speech WebSocket is not open");
    }
    try {
      socket.send(payload);
    } catch {
      this.abortConnection(
        "SOCKET_SEND_FAILED",
        "the local speech control could not be sent",
      );
      throw new SpeechClientError(
        "SOCKET_SEND_FAILED",
        "the local speech control could not be sent",
      );
    }
  }

  private assertReady(): SpeechSocket {
    const socket = this.socket;
    if (this.stateValue !== "ready" || socket === null || socket.readyState !== SOCKET_OPEN) {
      throw new SpeechClientError(
        "SPEECH_NOT_READY",
        "the local speech client has not completed its handshake",
      );
    }
    return socket;
  }

  private claimRequestId(value: string): string {
    const requestId = assertSpeechIdentifier(value);
    if (this.usedRequestIds.has(requestId)) {
      throw new SpeechClientError(
        "REQUEST_ID_REUSED",
        "requestId cannot be reused in one local speech session",
      );
    }
    this.usedRequestIds.add(requestId);
    return requestId;
  }

  private newId(prefix: string): string {
    return assertSpeechIdentifier(this.idFactory(prefix));
  }

  private createFallbackId(prefix: string): string {
    this.fallbackId += 1;
    const cryptoObject = globalThis.crypto;
    if (cryptoObject !== undefined && typeof cryptoObject.randomUUID === "function") {
      return `${prefix}:${cryptoObject.randomUUID()}`;
    }
    return `${prefix}:${Math.max(0, Math.floor(this.now()))}:${this.fallbackId}`;
  }

  private rememberUtterance(utterance: UtteranceState): void {
    this.utterances.set(utterance.utteranceId, utterance);
    this.utteranceOrder.push(utterance.utteranceId);
    let inspected = 0;
    while (
      this.utteranceOrder.length > MAX_TOMBSTONES &&
      inspected < this.utteranceOrder.length
    ) {
      const expired = this.utteranceOrder.shift();
      if (expired === undefined) break;
      const hasUnaccountedFrames =
        (this.sttUnaccountedFrames.get(expired)?.size ?? 0) > 0;
      if (expired === this.activeUtteranceId || hasUnaccountedFrames) {
        this.utteranceOrder.push(expired);
        inspected += 1;
        continue;
      }
      this.utterances.delete(expired);
      this.sttUnaccountedFrames.delete(expired);
      this.sttHighestSentSequence.delete(expired);
      this.sttAcceptedWatermarks.delete(expired);
    }
  }

  private rememberJob(job: TtsJobState): void {
    this.jobs.set(job.jobId, job);
    this.jobOrder.push(job.jobId);
    while (this.jobOrder.length > MAX_TOMBSTONES) {
      const expired = this.jobOrder.shift();
      if (expired === undefined) continue;
      const candidate = this.jobs.get(expired);
      if (candidate?.status === "finished" || candidate?.status === "cancelled") {
        this.jobs.delete(expired);
      }
    }
  }

  private rememberResponse(responseId: string, response: ResponseState): void {
    this.responses.set(responseId, response);
    this.responseOrder.push(responseId);
    let inspected = 0;
    while (
      this.responseOrder.length > MAX_RESPONSE_TOMBSTONES &&
      inspected < this.responseOrder.length
    ) {
      const expired = this.responseOrder.shift();
      if (expired === undefined) break;
      const hasLiveJob = [...this.jobs.values()].some(
        (job) =>
          job.responseId === expired &&
          (job.status === "queued" || job.status === "started"),
      );
      if (hasLiveJob) {
        this.responseOrder.push(expired);
        inspected += 1;
      } else {
        this.responses.delete(expired);
      }
    }
  }

  private fenceJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job === undefined || job.status === "finished") return;
    job.status = "cancelled";
    this.clearTerminalJobTokens(job);
    if (this.pendingTtsFrame?.metadata.jobId === jobId) {
      this.pendingTtsFrame = { ...this.pendingTtsFrame, deliver: false };
    }
  }

  private fenceJobAndResponse(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job === undefined) return;
    this.fenceResponse(job.responseId);
  }

  private clearTerminalJobTokens(job: TtsJobState): void {
    job.seenFrameTokens.clear();
    job.unacknowledgedFrameTokens.clear();
  }

  private fenceResponse(responseId: string): void {
    const response = this.responses.get(responseId);
    if (response !== undefined) response.status = "cancelled";
    for (const job of this.jobs.values()) {
      if (job.responseId === responseId) this.fenceJob(job.jobId);
    }
  }

  private fenceAllSynthesis(): void {
    for (const response of this.responses.values()) response.status = "cancelled";
    for (const job of this.jobs.values()) this.fenceJob(job.jobId);
  }

  private ttsIdentityMatches(
    job: TtsJobState,
    event: { responseId: string; actor: string; sequence: number },
  ): boolean {
    return (
      job.responseId === event.responseId &&
      job.actor === event.actor &&
      job.sequence === event.sequence
    );
  }

  private abortConnection(code: string, message: string): void {
    const socket = this.socket;
    this.generation += 1;
    this.detachSocket(socket);
    this.socket = null;
    if (socket !== null && socket.readyState <= SOCKET_OPEN) {
      try {
        socket.close(4_400, "speech protocol error");
      } catch {
        // The generation fence already makes this transport inert.
      }
    }
    this.resetSessionState(new SpeechClientError(code, message));
    this.setState("disconnected");
    this.emit({ type: "client_error", code });
  }

  private resetSessionState(error: SpeechClientError): void {
    const attempt = this.connectAttempt;
    if (attempt !== null) {
      clearTimeout(attempt.timer);
      this.connectAttempt = null;
      attempt.reject(error);
    }
    for (const request of this.loadRequests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.loadRequests.clear();
    this.readyValue = null;
    this.capabilitiesValue = null;
    this.flowControlValue = null;
    this.lastSttCreditRevision = 0;
    this.sttServerAvailableFrames = 0;
    this.sttServerAvailableBytes = 0;
    this.sttAvailableFrames = 0;
    this.sttAvailableBytes = 0;
    this.sttUnaccountedFrames.clear();
    this.sttHighestSentSequence.clear();
    this.sttAcceptedWatermarks.clear();
    this.pendingTtsFrame = null;
    this.activeUtteranceId = null;
    this.usedRequestIds.clear();
    this.utterances.clear();
    this.utteranceOrder.length = 0;
    this.responses.clear();
    this.responseOrder.length = 0;
    this.jobs.clear();
    this.jobOrder.length = 0;
  }

  private safeClientError(error: unknown): SpeechClientError {
    return error instanceof SpeechClientError
      ? error
      : new SpeechClientError(
          "SPEECH_CLIENT_FAILED",
          "the local speech client could not complete the request",
        );
  }

  private isCurrentSocket(socket: SpeechSocket, generation: number): boolean {
    return socket === this.socket && generation === this.generation;
  }

  private detachSocket(socket: SpeechSocket | null): void {
    if (socket === null) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }

  private setState(state: SpeechConnectionState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.emit({ type: "client_state", state });
  }

  private emit(event: SpeechClientEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
