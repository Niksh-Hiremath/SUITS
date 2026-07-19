import { describe, expect, it, vi } from "vitest";

import {
  AudioCaptureError,
  BrowserAudioCaptureController,
  CAPTURE_FRAME_BYTES,
  CAPTURE_FRAME_DURATION_MS,
  CAPTURE_SAMPLE_RATE_HZ,
  type AudioCaptureAudioContext,
  type AudioCaptureFrame,
  type AudioCaptureMediaStream,
  type AudioCaptureMessagePort,
  type AudioCaptureSourceNode,
  type AudioCaptureWorkletNode,
} from "./audio-capture";

class FakePort implements AudioCaptureMessagePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: unknown[] = [];
  closeCount = 0;
  failArm = false;
  onPostMessage: ((message: unknown) => void) | null = null;

  postMessage(message: unknown): void {
    if (
      this.failArm &&
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "arm"
    ) {
      throw new Error("arm failed");
    }
    this.posted.push(message);
    this.onPostMessage?.(message);
  }

  close(): void {
    this.closeCount += 1;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
}

class FakeWorklet implements AudioCaptureWorkletNode {
  readonly port = new FakePort();
  onprocessorerror: (() => void) | null = null;
  disconnectCount = 0;

  disconnect(): void {
    this.disconnectCount += 1;
  }

  emitProcessorError(): void {
    this.onprocessorerror?.();
  }
}

class FakeSource implements AudioCaptureSourceNode {
  connectedTo: AudioCaptureWorkletNode | null = null;
  disconnectCount = 0;

  connect(destination: AudioCaptureWorkletNode): void {
    this.connectedTo = destination;
  }

  disconnect(): void {
    this.disconnectCount += 1;
  }
}

class FakeContext implements AudioCaptureAudioContext {
  state = "suspended";
  readonly modules: string[] = [];
  readonly audioWorklet = {
    addModule: async (url: string): Promise<void> => {
      this.modules.push(url);
    },
  };
  resumeCount = 0;
  closeCount = 0;

  constructor(private readonly source: FakeSource) {}

  createMediaStreamSource(): FakeSource {
    return this.source;
  }

  async resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = "running";
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.state = "closed";
  }
}

function captureFixture(
  onFrame: (frame: AudioCaptureFrame) => void = vi.fn(),
  onStateChange?: () => void,
) {
  const track = { stop: vi.fn() };
  const stream: AudioCaptureMediaStream = { getTracks: () => [track] };
  const source = new FakeSource();
  const worklet = new FakeWorklet();
  const context = new FakeContext(source);
  const getUserMedia = vi.fn(
    async (): Promise<AudioCaptureMediaStream> => stream,
  );
  const createWorkletNode = vi.fn(
    (): AudioCaptureWorkletNode => worklet,
  );
  const states: string[] = [];
  const controller = new BrowserAudioCaptureController({
    getUserMedia,
    createAudioContext: () => context,
    createWorkletNode,
    onFrame,
    onStateChange:
      onStateChange ?? ((next) => states.push(next.status)),
  });
  return {
    context,
    controller,
    createWorkletNode,
    getUserMedia,
    onFrame,
    source,
    states,
    stream,
    track,
    worklet,
  };
}

function pcmFrame(sequence: number, pcm = new ArrayBuffer(CAPTURE_FRAME_BYTES)) {
  return {
    type: "pcm_frame",
    sequence,
    sampleRateHz: CAPTURE_SAMPLE_RATE_HZ,
    channels: 1,
    encoding: "pcm_s16le",
    durationMs: CAPTURE_FRAME_DURATION_MS,
    byteLength: CAPTURE_FRAME_BYTES,
    pcm,
  };
}

describe("BrowserAudioCaptureController", () => {
  it("captures exact transferable PCM frames and releases every browser resource", async () => {
    const fixture = captureFixture();
    await fixture.controller.start();

    expect(fixture.controller.state).toEqual({
      status: "capturing",
      failure: null,
    });
    expect(fixture.states).toEqual([
      "requesting_permission",
      "starting",
      "capturing",
    ]);
    expect(fixture.getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: true,
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    expect(fixture.context.modules).toEqual([
      "/worklets/suits-mic-processor.js",
    ]);
    expect(fixture.createWorkletNode).toHaveBeenCalledWith(
      fixture.context,
      "suits-mic-processor",
      expect.objectContaining({
        channelCount: 1,
        numberOfInputs: 1,
        numberOfOutputs: 0,
      }),
    );
    expect(fixture.source.connectedTo).toBe(fixture.worklet);
    expect(fixture.worklet.port.posted).toContainEqual({
      type: "arm",
      sequence: 0,
    });

    const pcm = new ArrayBuffer(CAPTURE_FRAME_BYTES);
    fixture.worklet.port.emit(pcmFrame(0, pcm));
    expect(fixture.onFrame).toHaveBeenCalledWith({
      sequence: 0,
      sampleRateHz: 16_000,
      channels: 1,
      encoding: "pcm_s16le",
      durationMs: 20,
      byteLength: 640,
      pcm,
    });
    expect(fixture.worklet.port.posted).toContainEqual({
      type: "ack_frame",
      sequence: 0,
    });

    await fixture.controller.stop();
    expect(fixture.controller.state.status).toBe("stopped");
    expect(fixture.worklet.port.posted).toContainEqual({ type: "stop" });
    expect(fixture.worklet.port.onmessage).toBeNull();
    expect(fixture.worklet.port.closeCount).toBe(1);
    expect(fixture.source.disconnectCount).toBe(1);
    expect(fixture.worklet.disconnectCount).toBe(1);
    expect(fixture.track.stop).toHaveBeenCalledOnce();
    expect(fixture.context.closeCount).toBe(1);
  });

  it("reports permission denial without exposing the browser error", async () => {
    const browserError = Object.assign(
      new Error("private microphone device label"),
      { name: "NotAllowedError" },
    );
    const controller = new BrowserAudioCaptureController({
      getUserMedia: vi.fn().mockRejectedValue(browserError),
      onFrame: vi.fn(),
    });

    await expect(controller.start()).rejects.toEqual(
      new AudioCaptureError("PERMISSION_DENIED"),
    );
    expect(controller.state).toEqual({
      status: "permission_denied",
      failure: {
        code: "PERMISSION_DENIED",
        message: "Microphone permission was denied.",
      },
    });
    expect(JSON.stringify(controller.state)).not.toContain("device label");
  });

  it("adopts an already-running capture before arming sequence zero", async () => {
    const fixture = captureFixture();
    fixture.context.state = "running";
    fixture.worklet.port.onPostMessage = (message) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === "arm"
      ) {
        fixture.worklet.port.emit(pcmFrame(0));
      }
    };

    await expect(fixture.controller.start()).resolves.toBeUndefined();

    expect(fixture.onFrame).toHaveBeenCalledOnce();
    expect(fixture.worklet.port.posted).toEqual([
      { type: "arm", sequence: 0 },
      { type: "ack_frame", sequence: 0 },
    ]);
    await fixture.controller.stop();
  });

  it("releases every resource when the worklet cannot be armed", async () => {
    const fixture = captureFixture();
    fixture.worklet.port.failArm = true;

    await expect(fixture.controller.start()).rejects.toEqual(
      new AudioCaptureError("START_FAILED"),
    );

    expect(fixture.controller.state.failure?.code).toBe("START_FAILED");
    expect(fixture.source.disconnectCount).toBe(1);
    expect(fixture.worklet.disconnectCount).toBe(1);
    expect(fixture.track.stop).toHaveBeenCalledOnce();
    expect(fixture.context.closeCount).toBe(1);
  });

  it("isolates throwing state observers from accepted start and cleanup", async () => {
    const fixture = captureFixture(vi.fn(), () => {
      throw new Error("state observer failed");
    });

    await expect(fixture.controller.start()).resolves.toBeUndefined();
    expect(fixture.controller.observerFailures).toEqual({ state: 3 });
    await expect(fixture.controller.stop()).resolves.toBeUndefined();

    expect(fixture.controller.observerFailures).toEqual({ state: 5 });
    expect(fixture.track.stop).toHaveBeenCalledOnce();
    expect(fixture.context.closeCount).toBe(1);
  });

  it("isolates throwing state observers while failing and releasing capture", async () => {
    const fixture = captureFixture(vi.fn(), () => {
      throw new Error("state observer failed");
    });
    await fixture.controller.start();

    fixture.worklet.emitProcessorError();

    await vi.waitFor(() => {
      expect(fixture.controller.state.failure?.code).toBe("WORKLET_FAILED");
      expect(fixture.track.stop).toHaveBeenCalledOnce();
      expect(fixture.context.closeCount).toBe(1);
    });
    expect(fixture.controller.observerFailures).toEqual({ state: 4 });
    expect(fixture.worklet.onprocessorerror).toBeNull();
  });

  it("fences a pending permission request and stops its late stream", async () => {
    let resolvePermission: (stream: AudioCaptureMediaStream) => void = () => {
      throw new Error("permission was not requested");
    };
    const track = { stop: vi.fn() };
    const stream: AudioCaptureMediaStream = { getTracks: () => [track] };
    const controller = new BrowserAudioCaptureController({
      getUserMedia: () =>
        new Promise<AudioCaptureMediaStream>((resolve) => {
          resolvePermission = resolve;
        }),
      createAudioContext: () => {
        throw new Error("a cancelled start must not create an AudioContext");
      },
      onFrame: vi.fn(),
    });

    const start = controller.start();
    const cancelledStart = expect(start).rejects.toMatchObject({
      code: "START_CANCELLED",
    });
    const stop = controller.stop();
    expect(controller.state.status).toBe("stopping");
    resolvePermission(stream);

    await cancelledStart;
    await stop;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(controller.state).toEqual({ status: "stopped", failure: null });
  });

  it("fails closed on a skipped frame sequence", async () => {
    const fixture = captureFixture();
    await fixture.controller.start();
    fixture.worklet.port.emit(pcmFrame(1));

    await vi.waitFor(() => {
      expect(fixture.controller.state.failure?.code).toBe(
        "INVALID_WORKLET_FRAME",
      );
      expect(fixture.track.stop).toHaveBeenCalledOnce();
      expect(fixture.context.closeCount).toBe(1);
    });
    expect(fixture.onFrame).not.toHaveBeenCalled();
  });

  it("does not ACK a frame rejected by the synchronous consumer", async () => {
    const fixture = captureFixture(() => {
      throw new Error("consumer rejected the frame");
    });
    await fixture.controller.start();
    fixture.worklet.port.emit(pcmFrame(0));

    await vi.waitFor(() => {
      expect(fixture.controller.state.failure?.code).toBe(
        "FRAME_HANDLER_FAILED",
      );
      expect(fixture.track.stop).toHaveBeenCalledOnce();
    });
    expect(fixture.worklet.port.posted).not.toContainEqual({
      type: "ack_frame",
      sequence: 0,
    });
  });

  it("fails closed when the AudioWorklet processor crashes", async () => {
    const fixture = captureFixture();
    await fixture.controller.start();
    fixture.worklet.emitProcessorError();

    await vi.waitFor(() => {
      expect(fixture.controller.state.failure?.code).toBe("WORKLET_FAILED");
      expect(fixture.context.closeCount).toBe(1);
    });
    expect(fixture.worklet.onprocessorerror).toBeNull();
  });
});
