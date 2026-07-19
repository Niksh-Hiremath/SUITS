import { describe, expect, it } from "vitest";

import {
  LocalSpeechClient,
  SpeechClientError,
  type SpeechClientEvent,
  type SpeechSocket,
  type SpeechSocketCloseEvent,
  assertLoopbackSpeechUrl,
} from "./client";
import { SPEECH_PROTOCOL, SPEECH_SERVICE_VERSION } from "./protocol";

class FakeSpeechSocket implements SpeechSocket {
  protocol: string = SPEECH_PROTOCOL;
  readyState = 0;
  binaryType: "blob" | "arraybuffer" = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: SpeechSocketCloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: Array<string | ArrayBuffer | ArrayBufferView> = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  failNextBinarySend = false;

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 1) throw new Error("socket is not open");
    if (typeof data !== "string" && this.failNextBinarySend) {
      this.failNextBinarySend = false;
      throw new Error("binary send failed");
    }
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receiveJson(event: object): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  receiveBinary(audio: ArrayBuffer): void {
    this.onmessage?.({ data: audio });
  }

  remoteClose(code = 1_006, reason = "transport closed"): void {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: code === 1_000 });
  }
}

class FakeSocketFactory {
  readonly sockets: FakeSpeechSocket[] = [];

  create = (): FakeSpeechSocket => {
    const socket = new FakeSpeechSocket();
    this.sockets.push(socket);
    return socket;
  };
}

function capabilities(requestId?: string) {
  return {
    protocol: SPEECH_PROTOCOL,
    type: "capabilities",
    ...(requestId === undefined ? {} : { requestId }),
    providers: [
      {
        providerId: "fake-stt",
        kind: "stt",
        configured: true,
        loaded: true,
        ready: true,
        device: "fake",
        supportsStreaming: true,
        supportsTimings: false,
      },
      {
        providerId: "fake-tts",
        kind: "tts",
        configured: true,
        loaded: true,
        ready: true,
        device: "fake",
        supportsStreaming: true,
        supportsTimings: true,
      },
    ],
    cuda: { available: false, diagnostic: "fake mode" },
    cachedClipIds: ["clip:objection"],
    maxTtsQueueDepth: 8,
    maxAudioChunkBytes: 262_144,
  };
}

function flow(
  options: {
    revision?: number;
    utteranceId?: string | null;
    acceptedThrough?: number;
    frames?: number;
    bytes?: number;
  } = {},
) {
  return {
    protocol: SPEECH_PROTOCOL,
    type: "flow_control",
    sttCreditRevision: options.revision ?? 1,
    sttUtteranceId: options.utteranceId ?? null,
    sttAcceptedThroughSequence: options.acceptedThrough ?? -1,
    sttAvailableFrames: options.frames ?? 8,
    sttAvailableBytes: options.bytes ?? 524_288,
    ttsWindowBytes: 5_760,
    ttsOutstandingBytes: 0,
  };
}

function ready(sessionId = "session:1") {
  return {
    protocol: SPEECH_PROTOCOL,
    type: "ready",
    sessionId,
    serviceVersion: SPEECH_SERVICE_VERSION,
    mode: "fake",
  };
}

function createHarness() {
  const factory = new FakeSocketFactory();
  let identifier = 0;
  const client = new LocalSpeechClient({
    url: "ws://127.0.0.1:8765/v1/speech",
    clientId: "browser:test",
    socketFactory: factory.create,
    idFactory: (prefix) => `${prefix}:${++identifier}`,
    now: () => 1_000,
  });
  return { client, factory };
}

async function connectHarness(
  client: LocalSpeechClient,
  factory: FakeSocketFactory,
  options: { frames?: number; bytes?: number; sessionId?: string } = {},
) {
  const connection = client.connect();
  const socket = factory.sockets.at(-1);
  if (socket === undefined) throw new Error("socket was not created");
  socket.open();
  socket.receiveJson(ready(options.sessionId));
  socket.receiveJson(capabilities());
  socket.receiveJson(flow({ frames: options.frames, bytes: options.bytes }));
  await connection;
  socket.sent.length = 0;
  return socket;
}

function sentControl(socket: FakeSpeechSocket, index: number): Record<string, unknown> {
  const packet = socket.sent[index];
  if (typeof packet !== "string") throw new Error("expected JSON control packet");
  return JSON.parse(packet) as Record<string, unknown>;
}

const ttsIdentity = {
  jobId: "job:1",
  responseId: "response:1",
  actor: "witness:maya",
  sequence: 0,
};

function ttsStarted() {
  return {
    protocol: SPEECH_PROTOCOL,
    type: "tts_started",
    ...ttsIdentity,
    voiceId: "af_heart",
    cached: false,
    queueLatencyMs: 4,
  };
}

function ttsHeader(byteLength = 640) {
  return {
    protocol: SPEECH_PROTOCOL,
    type: "tts_audio",
    ...ttsIdentity,
    frameSequence: 0,
    frameToken: "frame:1",
    byteLength,
    durationMs: 20,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: "pcm_s16le",
    ackRequired: true,
  };
}

describe("LocalSpeechClient", () => {
  it("pins the subprotocol and completes ready/capabilities/flow negotiation", async () => {
    const { client, factory } = createHarness();
    const states: string[] = [];
    client.subscribe((event) => {
      if (event.type === "client_state") states.push(event.state);
    });

    const connection = client.connect();
    const socket = factory.sockets[0];
    expect(socket.binaryType).toBe("arraybuffer");
    expect(client.state).toBe("connecting");

    socket.open();
    expect(sentControl(socket, 0)).toEqual({
      protocol: SPEECH_PROTOCOL,
      type: "hello",
      requestId: "hello:1",
      clientId: "browser:test",
      supportedProtocols: [SPEECH_PROTOCOL],
    });
    socket.receiveJson(ready());
    socket.receiveJson(capabilities());
    expect(client.state).toBe("connecting");
    socket.receiveJson(flow());

    await expect(connection).resolves.toMatchObject({
      ready: { sessionId: "session:1" },
      capabilities: { maxTtsQueueDepth: 8 },
      flowControl: {
        sttCreditRevision: 1,
        sttUtteranceId: null,
        sttAcceptedThroughSequence: -1,
        sttAvailableFrames: 8,
      },
    });
    expect(client.state).toBe("ready");
    expect(states).toEqual(["connecting", "ready"]);
  });

  it("rejects a non-loopback endpoint and a mismatched negotiated protocol", async () => {
    expect(() => assertLoopbackSpeechUrl("wss://speech.example.com/v1/speech")).toThrow(
      "raw audio may connect only",
    );
    expect(assertLoopbackSpeechUrl("ws://localhost:8765/v1/speech")).toContain(
      "localhost",
    );
    expect(assertLoopbackSpeechUrl("wss://[::1]:8765/v1/speech")).toContain("[::1]");
    for (const invalidUrl of [
      "ws://localhost:8765/",
      "ws://localhost:8765/v1/speech/",
      "ws://localhost:8765/v1/other",
      "ws://localhost:8765/v1/speech?mode=fake",
      "ws://localhost:8765/v1/speech#fragment",
      "ws://user:password@localhost:8765/v1/speech",
    ]) {
      expect(() => assertLoopbackSpeechUrl(invalidUrl)).toThrow(
        "raw audio may connect only",
      );
    }

    const { client, factory } = createHarness();
    const connection = client.connect();
    const socket = factory.sockets[0];
    socket.protocol = "unexpected.protocol";
    socket.open();

    await expect(connection).rejects.toMatchObject({
      code: "PROTOCOL_NEGOTIATION_FAILED",
    });
    expect(socket.closes.at(-1)?.code).toBe(4_400);
    expect(client.state).toBe("disconnected");
  });

  it("sends contiguous PCM metadata and binary frames atomically within credits", async () => {
    const { client, factory } = createHarness();
    const socket = await connectHarness(client, factory, { frames: 1, bytes: 640 });
    client.startUtterance({ utteranceId: "utterance:1" });
    const pcm = new Int16Array(320);

    expect(client.sendPcmFrame("utterance:1", pcm)).toBe(0);
    expect(sentControl(socket, 0)).toMatchObject({ type: "start_utterance" });
    expect(sentControl(socket, 1)).toEqual({
      protocol: SPEECH_PROTOCOL,
      type: "audio_chunk",
      utteranceId: "utterance:1",
      sequence: 0,
      byteLength: 640,
      durationMs: 20,
    });
    expect(socket.sent[2]).toBe(pcm);
    expect(() => client.sendPcmFrame("utterance:1", new Int16Array(320))).toThrow(
      "exhausted its advertised credits",
    );

    socket.receiveJson(
      flow({
        revision: 2,
        utteranceId: "utterance:1",
        acceptedThrough: 0,
        frames: 1,
        bytes: 640,
      }),
    );
    expect(client.sendPcmFrame("utterance:1", new Int16Array(320))).toBe(1);
    expect(sentControl(socket, 3)).toMatchObject({ sequence: 1 });
    client.endUtterance("utterance:1");
    expect(sentControl(socket, 5)).toMatchObject({
      type: "end_utterance",
      utteranceId: "utterance:1",
    });
  });

  it("reconciles delayed and unrelated flow snapshots without over-crediting PCM", async () => {
    const { client, factory } = createHarness();
    const acceptedFlowRevisions: number[] = [];
    client.subscribe((event) => {
      if (event.type === "flow_control") {
        acceptedFlowRevisions.push(event.sttCreditRevision);
      }
    });
    const socket = await connectHarness(client, factory, { frames: 2, bytes: 1_280 });
    client.startUtterance({ utteranceId: "utterance:credits" });
    expect(client.sendPcmFrame("utterance:credits", new Int16Array(320))).toBe(0);

    // This newer snapshot can be caused by unrelated TTS work before PCM sequence 0
    // reaches the service. Its -1 watermark must preserve the local debit.
    socket.receiveJson(
      flow({
        revision: 2,
        frames: 2,
        bytes: 1_280,
      }),
    );
    expect(client.sendPcmFrame("utterance:credits", new Int16Array(320))).toBe(1);
    expect(() =>
      client.sendPcmFrame("utterance:credits", new Int16Array(320)),
    ).toThrow("exhausted its advertised credits");

    // Stale and duplicate revisions cannot use a more optimistic body to regress accounting.
    socket.receiveJson(
      flow({
        revision: 1,
        utteranceId: "utterance:credits",
        acceptedThrough: 1,
        frames: 8,
        bytes: 5_120,
      }),
    );
    socket.receiveJson(
      flow({
        revision: 2,
        utteranceId: "utterance:credits",
        acceptedThrough: 1,
        frames: 8,
        bytes: 5_120,
      }),
    );
    expect(() =>
      client.sendPcmFrame("utterance:credits", new Int16Array(320)),
    ).toThrow("exhausted its advertised credits");

    // Only the strictly newer cumulative watermark releases both local debits.
    socket.receiveJson(
      flow({
        revision: 3,
        utteranceId: "utterance:credits",
        acceptedThrough: 1,
        frames: 2,
        bytes: 1_280,
      }),
    );
    expect(client.sendPcmFrame("utterance:credits", new Int16Array(320))).toBe(2);
    expect(acceptedFlowRevisions).toEqual([1, 2, 3]);
  });

  it("fails closed when a newer STT watermark exceeds the locally sent sequence", async () => {
    const { client, factory } = createHarness();
    const socket = await connectHarness(client, factory, { frames: 2, bytes: 1_280 });
    client.startUtterance({ utteranceId: "utterance:impossible" });
    client.sendPcmFrame("utterance:impossible", new Int16Array(320));

    socket.receiveJson(
      flow({
        revision: 2,
        utteranceId: "utterance:impossible",
        acceptedThrough: 1,
        frames: 2,
        bytes: 1_280,
      }),
    );
    expect(client.state).toBe("disconnected");
    expect(socket.closes.at(-1)?.code).toBe(4_400);
  });

  it("retains terminal utterance debits until their cumulative flow watermark", async () => {
    const { client, factory } = createHarness();
    const socket = await connectHarness(client, factory, { frames: 1, bytes: 640 });
    client.startUtterance({ utteranceId: "utterance:terminal" });
    client.sendPcmFrame("utterance:terminal", new Int16Array(320));
    socket.receiveJson({
      protocol: SPEECH_PROTOCOL,
      type: "stt_final",
      utteranceId: "utterance:terminal",
      revision: 1,
      text: "Terminal transcript.",
      confidence: 1,
      audioEndMs: 20,
      emittedAtMs: 21,
    });
    client.startUtterance({ utteranceId: "utterance:next" });
    expect(() => client.sendPcmFrame("utterance:next", new Int16Array(320))).toThrow(
      "exhausted its advertised credits",
    );

    socket.receiveJson(
      flow({
        revision: 2,
        utteranceId: "utterance:terminal",
        acceptedThrough: 0,
        frames: 1,
        bytes: 640,
      }),
    );
    expect(client.sendPcmFrame("utterance:next", new Int16Array(320))).toBe(0);
    client.cancelUtterance("utterance:next");
    client.startUtterance({ utteranceId: "utterance:after-cancel" });
    expect(() =>
      client.sendPcmFrame("utterance:after-cancel", new Int16Array(320)),
    ).toThrow("exhausted its advertised credits");
    socket.receiveJson(
      flow({
        revision: 3,
        utteranceId: "utterance:next",
        acceptedThrough: 0,
        frames: 1,
        bytes: 640,
      }),
    );
    expect(
      client.sendPcmFrame("utterance:after-cancel", new Int16Array(320)),
    ).toBe(0);
  });

  it("closes the session if the binary half of a PCM pair cannot be sent", async () => {
    const { client, factory } = createHarness();
    const socket = await connectHarness(client, factory);
    client.startUtterance({ utteranceId: "utterance:1" });
    socket.failNextBinarySend = true;

    expect(() => client.sendPcmFrame("utterance:1", new Int16Array(320))).toThrow(
      SpeechClientError,
    );
    expect(socket.closes.at(-1)?.code).toBe(4_400);
    expect(client.state).toBe("disconnected");
    const internal = client as unknown as {
      sttUnaccountedFrames: Map<string, Map<number, number>>;
      sttHighestSentSequence: Map<string, number>;
    };
    expect(internal.sttUnaccountedFrames.size).toBe(0);
    expect(internal.sttHighestSentSequence.size).toBe(0);
  });

  it("emits only monotonic partial/final revisions for the active utterance", async () => {
    const { client, factory } = createHarness();
    const accepted: Array<{ type: string; revision: number }> = [];
    client.subscribe((event) => {
      if (event.type === "stt_partial" || event.type === "stt_final") {
        accepted.push({ type: event.type, revision: event.revision });
      }
    });
    const socket = await connectHarness(client, factory);
    client.startUtterance({ utteranceId: "utterance:1" });

    const transcript = (type: "stt_partial" | "stt_final", revision: number) => ({
      protocol: SPEECH_PROTOCOL,
      type,
      utteranceId: "utterance:1",
      revision,
      text: `revision ${revision}`,
      confidence: 1,
      audioEndMs: revision * 20,
      emittedAtMs: revision * 20 + 1,
    });
    socket.receiveJson(transcript("stt_partial", 1));
    socket.receiveJson(transcript("stt_partial", 1));
    socket.receiveJson(transcript("stt_partial", 2));
    socket.receiveJson(transcript("stt_final", 3));
    socket.receiveJson(transcript("stt_partial", 4));
    socket.receiveJson({
      protocol: SPEECH_PROTOCOL,
      type: "speech_ended",
      utteranceId: "utterance:1",
      reason: "client_end",
      detectedAtMs: 100,
    });

    expect(accepted).toEqual([
      { type: "stt_partial", revision: 1 },
      { type: "stt_partial", revision: 2 },
      { type: "stt_final", revision: 3 },
    ]);
  });

  it("pairs TTS metadata with binary playback and sends one exact acknowledgement", async () => {
    const { client, factory } = createHarness();
    const frames: Extract<SpeechClientEvent, { type: "tts_audio_frame" }>[] = [];
    const lifecycle: string[] = [];
    client.subscribe((event) => {
      if (event.type === "tts_audio_frame") frames.push(event);
      if (["tts_started", "tts_timing", "tts_finished"].includes(event.type)) {
        lifecycle.push(event.type);
      }
    });
    const socket = await connectHarness(client, factory);
    client.synthesize({ ...ttsIdentity, text: "I saw the signal change.", isFinal: true });
    socket.receiveJson(ttsStarted());
    socket.receiveJson({
      protocol: SPEECH_PROTOCOL,
      type: "tts_timing",
      ...ttsIdentity,
      marks: [{ kind: "word", value: "signal", startMs: 20, endMs: 80 }],
    });
    socket.receiveJson(ttsHeader());
    expect(frames).toHaveLength(0);
    const pcm = new ArrayBuffer(640);
    socket.receiveBinary(pcm);

    expect(frames).toHaveLength(1);
    expect(frames[0].pcmS16le).toBe(pcm);
    expect(frames[0].acknowledge()).toBe(true);
    expect(frames[0].acknowledge()).toBe(false);
    expect(sentControl(socket, 1)).toEqual({
      protocol: SPEECH_PROTOCOL,
      type: "ack_tts_audio",
      jobId: "job:1",
      responseId: "response:1",
      frameSequence: 0,
      frameToken: "frame:1",
      byteLength: 640,
    });
    socket.receiveJson({
      protocol: SPEECH_PROTOCOL,
      type: "tts_finished",
      ...ttsIdentity,
      audioDurationMs: 20,
      synthesisLatencyMs: 5,
    });
    expect(lifecycle).toEqual(["tts_started", "tts_timing", "tts_finished"]);
  });

  it("enforces immediate TTS binary ordering and exact frame length", async () => {
    const first = createHarness();
    const firstSocket = await connectHarness(first.client, first.factory);
    first.client.synthesize({ ...ttsIdentity, text: "First phrase." });
    firstSocket.receiveJson(ttsStarted());
    firstSocket.receiveJson(ttsHeader());
    firstSocket.receiveJson(flow());
    expect(firstSocket.closes.at(-1)?.code).toBe(4_400);
    expect(first.client.state).toBe("disconnected");

    const second = createHarness();
    const secondSocket = await connectHarness(second.client, second.factory);
    second.client.synthesize({ ...ttsIdentity, text: "Second phrase." });
    secondSocket.receiveJson(ttsStarted());
    secondSocket.receiveJson(ttsHeader());
    secondSocket.receiveBinary(new ArrayBuffer(638));
    expect(secondSocket.closes.at(-1)?.code).toBe(4_400);
    expect(second.client.state).toBe("disconnected");
  });

  it("fences cancelled responses and barge-in audio before late binary delivery", async () => {
    const { client, factory } = createHarness();
    const frames: Extract<SpeechClientEvent, { type: "tts_audio_frame" }>[] = [];
    client.subscribe((event) => {
      if (event.type === "tts_audio_frame") frames.push(event);
    });
    const socket = await connectHarness(client, factory);
    client.synthesize({ ...ttsIdentity, text: "This will be interrupted." });
    socket.receiveJson(ttsStarted());
    socket.receiveJson(ttsHeader());
    client.cancelSynthesis({ scope: "response", responseId: "response:1" });
    socket.receiveBinary(new ArrayBuffer(640));
    expect(frames).toHaveLength(0);
    expect(sentControl(socket, 1)).toMatchObject({
      type: "cancel_synthesis",
      scope: "response",
      responseId: "response:1",
    });

    client.synthesize({
      jobId: "job:2",
      responseId: "response:2",
      actor: "judge",
      sequence: 0,
      text: "A second response.",
    });
    socket.receiveJson({ ...ttsStarted(), jobId: "job:2", responseId: "response:2", actor: "judge" });
    client.startUtterance({ utteranceId: "utterance:barge", bargeIn: true });
    socket.receiveJson({ ...ttsHeader(), jobId: "job:2", responseId: "response:2", actor: "judge" });
    socket.receiveBinary(new ArrayBuffer(640));
    expect(frames).toHaveLength(0);
  });

  it("rejects non-contiguous synthesis sequences before transport", async () => {
    const { client, factory } = createHarness();
    const socket = await connectHarness(client, factory);
    expect(() =>
      client.synthesize({
        jobId: "job:gap",
        responseId: "response:gap",
        actor: "judge",
        sequence: 1,
        text: "Out of order.",
      }),
    ).toThrow("stale or non-contiguous");
    expect(socket.sent).toHaveLength(0);
  });

  it("fences the whole response after a rejected or cancelled non-final job", async () => {
    const { client, factory } = createHarness();
    const socket = await connectHarness(client, factory);
    client.synthesize({
      jobId: "job:rejected",
      responseId: "response:rejected",
      actor: "judge",
      sequence: 0,
      text: "Rejected phrase.",
      isFinal: false,
    });
    socket.receiveJson({
      protocol: SPEECH_PROTOCOL,
      type: "error",
      code: "TTS_PROVIDER_FAILED",
      message: "the local provider rejected the phrase",
      jobId: "job:rejected",
      retryable: true,
      fatal: false,
    });
    expect(() =>
      client.synthesize({
        jobId: "job:rejected:next",
        responseId: "response:rejected",
        actor: "judge",
        sequence: 1,
        text: "Must not follow a rejected phrase.",
      }),
    ).toThrow("stale or non-contiguous");

    client.synthesize({
      jobId: "job:cancelled",
      responseId: "response:cancelled",
      actor: "judge",
      sequence: 0,
      text: "Cancelled phrase.",
      isFinal: false,
    });
    socket.receiveJson({
      protocol: SPEECH_PROTOCOL,
      type: "cancelled",
      target: "job",
      targetId: "job:cancelled",
      reason: "tts_provider_cancelled",
      cancellationLatencyMs: 2,
    });
    expect(() =>
      client.synthesize({
        jobId: "job:cancelled:next",
        responseId: "response:cancelled",
        actor: "judge",
        sequence: 1,
        text: "Must not follow a cancelled phrase.",
      }),
    ).toThrow("stale or non-contiguous");
    expect(socket.sent).toHaveLength(2);
  });

  it("releases per-frame token retention when TTS jobs finish or cancel", async () => {
    const { client, factory } = createHarness();
    const frames: Extract<SpeechClientEvent, { type: "tts_audio_frame" }>[] = [];
    client.subscribe((event) => {
      if (event.type === "tts_audio_frame") frames.push(event);
    });
    const socket = await connectHarness(client, factory);
    client.synthesize({ ...ttsIdentity, text: "Finished phrase." });
    socket.receiveJson(ttsStarted());
    socket.receiveJson(ttsHeader());
    socket.receiveBinary(new ArrayBuffer(640));
    expect(frames[0].acknowledge()).toBe(true);
    socket.receiveJson({
      protocol: SPEECH_PROTOCOL,
      type: "tts_finished",
      ...ttsIdentity,
      audioDurationMs: 20,
      synthesisLatencyMs: 5,
    });

    client.synthesize({
      jobId: "job:cancel-token",
      responseId: "response:cancel-token",
      actor: "judge",
      sequence: 0,
      text: "Cancelled after delivery.",
    });
    socket.receiveJson({
      ...ttsStarted(),
      jobId: "job:cancel-token",
      responseId: "response:cancel-token",
      actor: "judge",
    });
    socket.receiveJson({
      ...ttsHeader(),
      jobId: "job:cancel-token",
      responseId: "response:cancel-token",
      actor: "judge",
      frameToken: "frame:cancel-token",
    });
    socket.receiveBinary(new ArrayBuffer(640));
    expect(frames).toHaveLength(2);
    client.cancelSynthesis({ scope: "job", jobId: "job:cancel-token" });
    expect(frames[1].acknowledge()).toBe(false);

    const internal = client as unknown as {
      jobs: Map<
        string,
        {
          seenFrameTokens: Set<string>;
          unacknowledgedFrameTokens: Set<string>;
        }
      >;
    };
    for (const jobId of ["job:1", "job:cancel-token"]) {
      expect(internal.jobs.get(jobId)?.seenFrameTokens.size).toBe(0);
      expect(internal.jobs.get(jobId)?.unacknowledgedFrameTokens.size).toBe(0);
    }
  });

  it("enforces the advertised local TTS queue depth before transport", async () => {
    const { client, factory } = createHarness();
    const socket = await connectHarness(client, factory);
    for (let index = 0; index < 8; index += 1) {
      client.synthesize({
        jobId: `job:depth:${index}`,
        responseId: `response:depth:${index}`,
        actor: "judge",
        sequence: 0,
        text: `Phrase ${index}.`,
      });
    }
    expect(() =>
      client.synthesize({
        jobId: "job:depth:overflow",
        responseId: "response:depth:overflow",
        actor: "judge",
        sequence: 0,
        text: "Overflow phrase.",
      }),
    ).toThrow("advertised depth");
    expect(socket.sent).toHaveLength(8);
  });

  it("rejects stale model-load responses and clears all media state across reconnect", async () => {
    const { client, factory } = createHarness();
    const firstSocket = await connectHarness(client, factory, { sessionId: "session:first" });
    client.startUtterance({ utteranceId: "utterance:reusable" });
    client.sendPcmFrame("utterance:reusable", new Int16Array(320));
    firstSocket.receiveJson(flow({ revision: 2 }));
    const loading = client.loadModels({ requestId: "load:stable" });
    const loadingRejection = expect(loading).rejects.toMatchObject({
      code: "CLIENT_DISCONNECTED",
    });

    const reconnection = client.reconnect();
    await loadingRejection;
    expect(firstSocket.closes.at(-1)?.code).toBe(1_000);
    firstSocket.receiveJson(capabilities("load:stable"));

    const secondSocket = factory.sockets[1];
    secondSocket.open();
    secondSocket.receiveJson(ready("session:second"));
    secondSocket.receiveJson(capabilities());
    secondSocket.receiveJson(flow());
    await expect(reconnection).resolves.toMatchObject({
      ready: { sessionId: "session:second" },
    });
    secondSocket.sent.length = 0;
    expect(() =>
      client.startUtterance({ utteranceId: "utterance:reusable" }),
    ).not.toThrow();
    expect(client.sendPcmFrame("utterance:reusable", new Int16Array(320))).toBe(0);
  });

  it("resolves only the matching in-session model-load request", async () => {
    const { client, factory } = createHarness();
    const socket = await connectHarness(client, factory);
    const loading = client.loadModels({ requestId: "load:1" });
    socket.receiveJson(capabilities("load:stale"));
    expect(client.capabilities?.requestId).toBeUndefined();
    socket.receiveJson(capabilities("load:1"));

    await expect(loading).resolves.toMatchObject({ requestId: "load:1" });
    expect(client.capabilities?.requestId).toBe("load:1");
  });

  it("drops callbacks and pending acknowledgements after disconnect", async () => {
    const { client, factory } = createHarness();
    const frames: Extract<SpeechClientEvent, { type: "tts_audio_frame" }>[] = [];
    client.subscribe((event) => {
      if (event.type === "tts_audio_frame") frames.push(event);
    });
    const socket = await connectHarness(client, factory);
    client.synthesize({ ...ttsIdentity, text: "Disconnect me." });
    socket.receiveJson(ttsStarted());
    socket.receiveJson(ttsHeader());
    socket.receiveBinary(new ArrayBuffer(640));
    client.disconnect();

    expect(frames[0].acknowledge()).toBe(false);
    expect(socket.onmessage).toBeNull();
    expect(client.state).toBe("disconnected");
  });
});
