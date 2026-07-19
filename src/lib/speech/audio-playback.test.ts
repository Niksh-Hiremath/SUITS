import { describe, expect, it, vi } from "vitest";

import {
  AudioPlaybackError,
  BrowserAudioPlaybackController,
  type AudioPlaybackAudioContext,
  type AudioPlaybackBuffer,
  type AudioPlaybackJobIdentity,
  type AudioPlaybackPcmFrame,
  type AudioPlaybackSourceNode,
  type AudioPlaybackTimerHandle,
} from "./audio-playback";

class FakeBuffer implements AudioPlaybackBuffer {
  readonly duration: number;
  readonly channel: Float32Array;

  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.channel = new Float32Array(length);
  }

  copyToChannel(source: Float32Array, channelNumber: number): void {
    if (channelNumber !== 0) throw new Error("only mono buffers are supported");
    this.channel.set(source);
  }
}

class FakeSource implements AudioPlaybackSourceNode {
  buffer: AudioPlaybackBuffer | null = null;
  onended: (() => void) | null = null;
  connectedTo: unknown = null;
  disconnected = false;
  readonly starts: number[] = [];
  readonly stops: number[] = [];

  connect(destination: unknown): void {
    this.connectedTo = destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  start(when = 0): void {
    this.starts.push(when);
  }

  stop(when = 0): void {
    this.stops.push(when);
  }

  end(): void {
    this.onended?.();
  }
}

class FakePlaybackContext implements AudioPlaybackAudioContext {
  currentTime = 10;
  readonly destination = { kind: "speaker" };
  state = "suspended";
  outputLatency: number | undefined;
  readonly buffers: FakeBuffer[] = [];
  readonly sources: FakeSource[] = [];
  resumeCount = 0;
  closeCount = 0;
  resumeGate: Promise<void> | null = null;
  resumeError: Error | null = null;
  closeError: Error | null = null;

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): FakeBuffer {
    if (numberOfChannels !== 1) throw new Error("playback must remain mono");
    const buffer = new FakeBuffer(length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  async resume(): Promise<void> {
    this.resumeCount += 1;
    if (this.resumeGate !== null) await this.resumeGate;
    if (this.resumeError !== null) throw this.resumeError;
    this.state = "running";
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    if (this.closeError !== null) throw this.closeError;
    this.state = "closed";
  }
}

const IDENTITY: AudioPlaybackJobIdentity = {
  responseId: "response-1",
  jobId: "job-1",
  actor: "witness-1",
  sequence: 0,
};

function pcm(values: readonly number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(values.length * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);
  values.forEach((value, index) => {
    view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, value, true);
  });
  return buffer;
}

function frame(
  identity: AudioPlaybackJobIdentity,
  frameSequence: number,
  values: readonly number[] = new Array<number>(320).fill(0),
  sampleRateHz = 16_000,
): AudioPlaybackPcmFrame {
  const buffer = pcm(values);
  return {
    ...identity,
    frameSequence,
    byteLength: buffer.byteLength,
    durationMs: Math.round((values.length / sampleRateHz) * 1_000),
    sampleRateHz,
    channels: 1,
    encoding: "pcm_s16le",
    pcm: buffer,
  };
}

describe("BrowserAudioPlaybackController", () => {
  it("schedules ordered PCM directly and resolves only after audible drain", async () => {
    const context = new FakePlaybackContext();
    const observerOrder: string[] = [];
    const timing = vi.fn(() => observerOrder.push("timing"));
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
      scheduleLeadMs: 0,
      onStatusChange: (status) => {
        if (status === "playing") observerOrder.push("playing");
      },
      onTiming: timing,
    });
    await controller.activateResponse(IDENTITY.responseId);
    const completion = controller.startJob(IDENTITY);
    controller.addTiming({
      ...IDENTITY,
      marks: [
        { kind: "word", value: "Ready", startMs: 5, endMs: 15 },
      ],
    });

    const firstValues = [0, -32_768, 32_767, ...new Array<number>(317).fill(0)];
    const first = controller.enqueueFrame(frame(IDENTITY, 0, firstValues));
    const second = controller.enqueueFrame(frame(IDENTITY, 1));
    expect(first.startTimeSeconds).toBe(10);
    expect(first.endTimeSeconds).toBe(10.02);
    expect(second.startTimeSeconds).toBe(10.02);
    expect(second.endTimeSeconds).toBe(10.04);
    expect(context.sources.map((source) => source.starts)).toEqual([[10], [10.02]]);
    expect(context.buffers[0]?.channel.slice(0, 3)).toEqual(
      new Float32Array([0, -1, 1]),
    );
    expect(timing).toHaveBeenCalledWith({
      ...IDENTITY,
      audioClockTimeSeconds: 10,
      marks: [
        {
          kind: "word",
          value: "Ready",
          startMs: 5,
          endMs: 15,
          audioStartTimeSeconds: 10.005,
          audioEndTimeSeconds: 10.015,
        },
      ],
    });
    expect(observerOrder).toEqual(["playing", "timing"]);

    expect(controller.finishJob(IDENTITY)).toBe(completion);
    let settled = false;
    void completion.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    context.sources[0]?.end();
    await Promise.resolve();
    expect(settled).toBe(false);
    context.sources[1]?.end();

    await expect(completion).resolves.toMatchObject({
      ...IDENTITY,
      status: "completed",
      audioDurationMs: 40,
      failureCode: null,
      timingMarks: [
        { kind: "word", value: "Ready", startMs: 5, endMs: 15 },
      ],
    });
    expect(context.sources.every((source) => source.disconnected)).toBe(true);
    expect(controller.pressure.queuedBytes).toBe(0);
  });

  it("enforces byte backpressure and emits high/full/normal hooks", async () => {
    const context = new FakePlaybackContext();
    const pressureLevels: string[] = [];
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
      maxQueuedBytes: 64,
      highWaterBytes: 32,
      lowWaterBytes: 16,
      maxFrameBytes: 32,
      scheduleLeadMs: 0,
      onPressureChange: (pressure) => pressureLevels.push(pressure.level),
    });
    await controller.activateResponse(IDENTITY.responseId);
    const completion = controller.startJob(IDENTITY);
    const values = new Array<number>(16).fill(0);

    controller.enqueueFrame(frame(IDENTITY, 0, values, 8_000));
    expect(controller.pressure.level).toBe("high");
    controller.enqueueFrame(frame(IDENTITY, 1, values, 8_000));
    expect(controller.pressure.level).toBe("full");
    expect(controller.canAccept(32)).toBe(false);
    expect(() =>
      controller.enqueueFrame(frame(IDENTITY, 2, values, 8_000)),
    ).toThrow(new AudioPlaybackError("QUEUE_FULL"));

    context.sources[0]?.end();
    expect(controller.pressure.level).toBe("high");
    context.sources[1]?.end();
    expect(controller.pressure.level).toBe("normal");
    controller.finishJob(IDENTITY);
    await expect(completion).resolves.toMatchObject({ status: "completed" });
    expect(pressureLevels).toEqual(["high", "full", "high", "normal"]);
  });

  it("supersedes stale responses and cancels active speech on barge-in", async () => {
    const context = new FakePlaybackContext();
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
      scheduleLeadMs: 0,
    });
    await controller.activateResponse(IDENTITY.responseId);
    const oldCompletion = controller.startJob(IDENTITY);
    const oldFrame = frame(IDENTITY, 0);
    controller.enqueueFrame(oldFrame);

    await controller.activateResponse("response-2");
    await expect(oldCompletion).resolves.toMatchObject({
      status: "superseded",
    });
    expect(context.sources[0]?.stops).toEqual([0]);
    expect(context.sources[0]?.disconnected).toBe(true);
    expect(() => controller.enqueueFrame(oldFrame)).toThrow(
      new AudioPlaybackError("STALE_RESPONSE"),
    );

    const currentIdentity: AudioPlaybackJobIdentity = {
      ...IDENTITY,
      responseId: "response-2",
      jobId: "job-2",
    };
    const currentCompletion = controller.startJob(currentIdentity);
    controller.enqueueFrame(frame(currentIdentity, 0));
    controller.bargeIn();
    await expect(currentCompletion).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(context.sources[1]?.stops).toEqual([0]);
    await expect(controller.activateResponse("response-2")).rejects.toEqual(
      new AudioPlaybackError("STALE_RESPONSE"),
    );

    await controller.close();
    expect(context.closeCount).toBe(1);
    expect(controller.status).toBe("closed");
  });

  it("rejects frames that move backward across ordered jobs", async () => {
    const context = new FakePlaybackContext();
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
      scheduleLeadMs: 0,
    });
    await controller.activateResponse(IDENTITY.responseId);
    controller.startJob(IDENTITY);
    const secondIdentity: AudioPlaybackJobIdentity = {
      ...IDENTITY,
      jobId: "job-2",
      sequence: 1,
    };
    controller.startJob(secondIdentity);
    controller.enqueueFrame(frame(secondIdentity, 0));

    expect(() => controller.enqueueFrame(frame(IDENTITY, 0))).toThrow(
      new AudioPlaybackError("OUT_OF_ORDER_JOB"),
    );
    controller.bargeIn();
    await controller.close();
  });

  it("isolates throwing observers after state and audio acceptance", async () => {
    const context = new FakePlaybackContext();
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
      maxQueuedBytes: 1_280,
      highWaterBytes: 640,
      lowWaterBytes: 320,
      scheduleLeadMs: 0,
      onStatusChange: () => {
        throw new Error("status observer failed");
      },
      onPressureChange: () => {
        throw new Error("pressure observer failed");
      },
      onTiming: () => {
        throw new Error("timing observer failed");
      },
    });

    await expect(
      controller.activateResponse(IDENTITY.responseId),
    ).resolves.toBeUndefined();
    const completion = controller.startJob(IDENTITY);
    expect(() =>
      controller.addTiming({
        ...IDENTITY,
        marks: [{ kind: "word", value: "Safe", startMs: 0, endMs: 10 }],
      }),
    ).not.toThrow();
    expect(() => controller.enqueueFrame(frame(IDENTITY, 0))).not.toThrow();
    expect(context.sources).toHaveLength(1);
    expect(controller.observerFailures).toEqual({
      status: 2,
      pressure: 1,
      timing: 1,
    });

    controller.finishJob(IDENTITY);
    context.sources[0]?.end();
    await expect(completion).resolves.toMatchObject({ status: "completed" });
    expect(controller.observerFailures.status).toBe(3);
  });

  it("removes cancelled source time from the next job schedule", async () => {
    const context = new FakePlaybackContext();
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
      scheduleLeadMs: 0,
    });
    await controller.activateResponse(IDENTITY.responseId);
    controller.startJob(IDENTITY);
    const cancelledSchedule = controller.enqueueFrame(frame(IDENTITY, 0));
    expect(cancelledSchedule.endTimeSeconds).toBe(10.02);
    controller.cancelJob(IDENTITY.responseId, IDENTITY.jobId, "user");

    const nextIdentity: AudioPlaybackJobIdentity = {
      ...IDENTITY,
      jobId: "job-2",
      sequence: 1,
    };
    controller.startJob(nextIdentity);
    const nextSchedule = controller.enqueueFrame(frame(nextIdentity, 0));
    expect(nextSchedule.startTimeSeconds).toBe(10);
    controller.bargeIn();
    await controller.close();
  });

  it("closes cleanly while AudioContext activation is awaiting resume", async () => {
    const context = new FakePlaybackContext();
    let releaseResume: () => void = () => {
      throw new Error("resume was not requested");
    };
    context.resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
    });

    const activation = controller.activateResponse(IDENTITY.responseId);
    await vi.waitFor(() => expect(context.resumeCount).toBe(1));
    const close = controller.close();
    releaseResume();

    await expect(activation).rejects.toEqual(new AudioPlaybackError("CLOSED"));
    await expect(close).resolves.toBeUndefined();
    expect(context.closeCount).toBe(1);
    expect(controller.status).toBe("closed");
  });

  it("closes a newly created context when activation resume fails", async () => {
    const context = new FakePlaybackContext();
    context.resumeError = new Error("speaker activation failed");
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
    });

    await expect(controller.activateResponse(IDENTITY.responseId)).rejects.toEqual(
      new AudioPlaybackError("PLAYBACK_FAILED"),
    );
    expect(context.resumeCount).toBe(1);
    expect(context.closeCount).toBe(1);
    expect(context.state).toBe("closed");
    await expect(controller.close()).resolves.toBeUndefined();
    expect(context.closeCount).toBe(1);
  });

  it("reports cleanup failure when a failed activation context cannot close", async () => {
    const context = new FakePlaybackContext();
    context.resumeError = new Error("speaker activation failed");
    context.closeError = new Error("speaker cleanup failed");
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
    });

    await expect(controller.activateResponse(IDENTITY.responseId)).rejects.toEqual(
      new AudioPlaybackError("CLEANUP_FAILED"),
    );
    expect(context.resumeCount).toBe(1);
    expect(context.closeCount).toBe(1);
  });

  it("waits bounded output latency and fences a cancelled drain timer", async () => {
    type FakeTimer = {
      callback: () => void;
      delayMs: number;
      cancelled: boolean;
    };
    const timers: FakeTimer[] = [];
    const setDrainTimer = vi.fn(
      (callback: () => void, delayMs: number): AudioPlaybackTimerHandle => {
        const timer = { callback, delayMs, cancelled: false };
        timers.push(timer);
        return timer;
      },
    );
    const clearDrainTimer = vi.fn((handle: AudioPlaybackTimerHandle) => {
      (handle as FakeTimer).cancelled = true;
    });
    const context = new FakePlaybackContext();
    context.outputLatency = 0.5;
    const controller = new BrowserAudioPlaybackController({
      createAudioContext: () => context,
      scheduleLeadMs: 0,
      maxOutputLatencyMs: 75,
      setDrainTimer,
      clearDrainTimer,
    });
    await controller.activateResponse(IDENTITY.responseId);
    const completion = controller.startJob(IDENTITY);
    controller.enqueueFrame(frame(IDENTITY, 0));
    controller.finishJob(IDENTITY);
    context.sources[0]?.end();

    let settled = false;
    void completion.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.delayMs).toBe(75);

    controller.cancelJob(IDENTITY.responseId, IDENTITY.jobId, "barge_in");
    await expect(completion).resolves.toMatchObject({ status: "cancelled" });
    expect(timers[0]?.cancelled).toBe(true);
    timers[0]?.callback();
    expect(controller.status).toBe("ready");

    const nextIdentity: AudioPlaybackJobIdentity = {
      ...IDENTITY,
      jobId: "job-2",
      sequence: 1,
    };
    const nextCompletion = controller.startJob(nextIdentity);
    controller.enqueueFrame(frame(nextIdentity, 0));
    controller.finishJob(nextIdentity);
    context.sources[1]?.end();
    expect(timers).toHaveLength(2);
    expect(timers[1]?.delayMs).toBe(75);
    timers[1]?.callback();
    await expect(nextCompletion).resolves.toMatchObject({
      status: "completed",
    });
    await controller.close();
  });
});
