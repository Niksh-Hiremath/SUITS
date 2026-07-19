import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKLET_PATH = fileURLToPath(
  new URL("../../../public/worklets/suits-mic-processor.js", import.meta.url),
);

type WorkletPort = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
};

type WorkletInstance = {
  process(inputs: readonly (readonly Float32Array[])[]): boolean;
};

type WorkletConstructor = new () => WorkletInstance;

describe("suits microphone AudioWorklet", () => {
  it("stays unarmed, then resamples into one transferable 16 kHz PCM frame", async () => {
    const source = await readFile(WORKLET_PATH, "utf8");
    const messages: unknown[] = [];
    const transfers: Array<readonly ArrayBuffer[]> = [];
    const port: WorkletPort = {
      onmessage: null,
      postMessage(message, transfer = []) {
        messages.push(message);
        transfers.push(transfer);
      },
    };
    let registeredName = "";
    let registeredConstructor: WorkletConstructor | null = null;
    class FakeAudioWorkletProcessor {
      readonly port = port;
    }

    runInNewContext(source, {
      AudioWorkletProcessor: FakeAudioWorkletProcessor,
      registerProcessor(name: string, constructor: WorkletConstructor) {
        registeredName = name;
        registeredConstructor = constructor;
      },
      sampleRate: 48_000,
    });

    expect(registeredName).toBe("suits-mic-processor");
    if (registeredConstructor === null) {
      throw new Error("worklet processor was not registered");
    }
    const Processor = registeredConstructor as WorkletConstructor;
    const processor = new Processor();
    const sourceSamples = new Float32Array(960).fill(0.5);
    expect(processor.process([[sourceSamples]])).toBe(true);
    expect(
      messages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === "pcm_frame",
      ),
    ).toBe(false);

    port.onmessage?.({ data: { type: "arm", sequence: 0 } });
    expect(messages).toContainEqual({ type: "worklet_armed", sequence: 0 });
    expect(processor.process([[sourceSamples]])).toBe(true);

    const frame = messages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === "pcm_frame",
    ) as { pcm: ArrayBuffer; [key: string]: unknown } | undefined;
    expect(frame).toMatchObject({
      type: "pcm_frame",
      sequence: 0,
      sampleRateHz: 16_000,
      channels: 1,
      encoding: "pcm_s16le",
      durationMs: 20,
      byteLength: 640,
    });
    if (frame === undefined) throw new Error("worklet did not emit a PCM frame");
    expect(frame.pcm.byteLength).toBe(640);
    expect(new Int16Array(frame.pcm)).toHaveLength(320);
    expect(new Int16Array(frame.pcm)[0]).toBe(16_384);
    expect(transfers.some((transfer) => transfer[0] === frame.pcm)).toBe(true);

    port.onmessage?.({ data: { type: "stop" } });
    expect(processor.process([[sourceSamples]])).toBe(false);
  });

  it("keeps capture memory bounded and has no recording, persistence, or network path", async () => {
    const source = await readFile(WORKLET_PATH, "utf8");
    expect(source).toContain("new Int16Array(FRAME_SAMPLES)");
    expect(source).toContain("MAX_RENDER_QUANTUM_SAMPLES");
    expect(source).toContain("[pcm.buffer]");
    for (const forbidden of [
      "MediaRecorder",
      "FileReader",
      "WebSocket",
      "indexedDB",
      "localStorage",
      "sessionStorage",
      "fetch(",
      "btoa(",
      "Blob(",
      "console.",
    ]) {
      expect(source, `forbidden worklet capability: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("stops explicitly when fixed in-flight frame credits are exhausted", async () => {
    const source = await readFile(WORKLET_PATH, "utf8");
    const messages: unknown[] = [];
    const port: WorkletPort = {
      onmessage: null,
      postMessage(message) {
        messages.push(message);
      },
    };
    let registeredConstructor: WorkletConstructor | null = null;
    class FakeAudioWorkletProcessor {
      readonly port = port;
    }
    runInNewContext(source, {
      AudioWorkletProcessor: FakeAudioWorkletProcessor,
      registerProcessor(_name: string, constructor: WorkletConstructor) {
        registeredConstructor = constructor;
      },
      sampleRate: 48_000,
    });
    if (registeredConstructor === null) {
      throw new Error("worklet processor was not registered");
    }
    const Processor = registeredConstructor as WorkletConstructor;
    const processor = new Processor();
    const sourceSamples = new Float32Array(960).fill(0.25);
    port.onmessage?.({ data: { type: "arm", sequence: 0 } });

    for (let index = 0; index < 8; index += 1) {
      expect(processor.process([[sourceSamples]])).toBe(true);
    }
    expect(processor.process([[sourceSamples]])).toBe(false);
    expect(
      messages.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === "pcm_frame",
      ),
    ).toHaveLength(8);
    expect(messages).toContainEqual({
      type: "worklet_error",
      code: "FRAME_CREDIT_OVERRUN",
    });
    expect(processor.process([[sourceSamples]])).toBe(false);
  });

  it("releases fixed frame credits only for valid ordered acknowledgements", async () => {
    const source = await readFile(WORKLET_PATH, "utf8");
    const messages: unknown[] = [];
    const port: WorkletPort = {
      onmessage: null,
      postMessage(message) {
        messages.push(message);
      },
    };
    let registeredConstructor: WorkletConstructor | null = null;
    class FakeAudioWorkletProcessor {
      readonly port = port;
    }
    runInNewContext(source, {
      AudioWorkletProcessor: FakeAudioWorkletProcessor,
      registerProcessor(_name: string, constructor: WorkletConstructor) {
        registeredConstructor = constructor;
      },
      sampleRate: 48_000,
    });
    if (registeredConstructor === null) {
      throw new Error("worklet processor was not registered");
    }
    const Processor = registeredConstructor as WorkletConstructor;
    const processor = new Processor();
    const sourceSamples = new Float32Array(960).fill(0.25);
    port.onmessage?.({ data: { type: "arm", sequence: 0 } });

    for (let sequence = 0; sequence < 16; sequence += 1) {
      expect(processor.process([[sourceSamples]])).toBe(true);
      port.onmessage?.({ data: { type: "ack_frame", sequence } });
    }

    expect(
      messages.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === "pcm_frame",
      ),
    ).toHaveLength(16);
    expect(messages).not.toContainEqual({
      type: "worklet_error",
      code: "FRAME_CREDIT_OVERRUN",
    });
  });
});
