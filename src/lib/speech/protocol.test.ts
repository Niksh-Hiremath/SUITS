import { describe, expect, it } from "vitest";

import {
  MAX_SPEECH_CONTROL_BYTES,
  SPEECH_PROTOCOL,
  SPEECH_SERVICE_VERSION,
  SpeechProtocolError,
  parseSpeechServerEventJson,
  serializeSpeechClientControl,
} from "./protocol";

const provider = {
  providerId: "fake-stt",
  kind: "stt",
  configured: true,
  loaded: true,
  ready: true,
  device: "fake",
  supportsStreaming: true,
  supportsTimings: false,
};

const identity = {
  jobId: "job:1",
  responseId: "response:1",
  actor: "witness:maya",
  sequence: 0,
};

describe("speech wire protocol", () => {
  it("parses every strict server event without embedding binary audio", () => {
    const events = [
      {
        protocol: SPEECH_PROTOCOL,
        type: "ready",
        sessionId: "session:1",
        serviceVersion: SPEECH_SERVICE_VERSION,
        mode: "fake",
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "capabilities",
        providers: [provider],
        cuda: { available: false, diagnostic: "fake mode" },
        cachedClipIds: ["clip:objection"],
        maxTtsQueueDepth: 8,
        maxAudioChunkBytes: 262_144,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "speech_started",
        utteranceId: "utterance:1",
        detectedAtMs: 10,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "stt_partial",
        utteranceId: "utterance:1",
        revision: 1,
        text: "Objection",
        confidence: 0.9,
        audioEndMs: 100,
        emittedAtMs: 110,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "stt_final",
        utteranceId: "utterance:1",
        revision: 2,
        text: "Objection, Your Honor.",
        confidence: 0.95,
        audioEndMs: 200,
        emittedAtMs: 210,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "speech_ended",
        utteranceId: "utterance:1",
        reason: "client_end",
        detectedAtMs: 220,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "tts_started",
        ...identity,
        voiceId: "af_heart",
        cached: false,
        queueLatencyMs: 4,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "tts_audio",
        ...identity,
        frameSequence: 0,
        frameToken: "frame:1",
        byteLength: 640,
        durationMs: 20,
        sampleRateHz: 16_000,
        channels: 1,
        encoding: "pcm_s16le",
        ackRequired: true,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "tts_timing",
        ...identity,
        marks: [{ kind: "word", value: "Objection", startMs: 0, endMs: 120 }],
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "tts_finished",
        ...identity,
        audioDurationMs: 300,
        synthesisLatencyMs: 25,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "cancelled",
        target: "job",
        targetId: "job:1",
        reason: "barge in",
        cancellationLatencyMs: 3,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "metrics",
        utteranceId: "utterance:1",
        metrics: [{ name: "latency", value: 12.5, unit: "milliseconds" }],
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "flow_control",
        sttCreditRevision: 1,
        sttUtteranceId: null,
        sttAcceptedThroughSequence: -1,
        sttAvailableFrames: 8,
        sttAvailableBytes: 524_288,
        ttsWindowBytes: 5_760,
        ttsOutstandingBytes: 0,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "error",
        code: "STT_NOT_READY",
        message: "load the configured provider",
        utteranceId: "utterance:1",
        retryable: true,
        fatal: false,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "pong",
        nonce: "ping:1",
        receivedAtMs: 42,
      },
    ] as const;

    expect(
      events.map((event) => parseSpeechServerEventJson(JSON.stringify(event)).type),
    ).toEqual(events.map((event) => event.type));
    expect(JSON.stringify(events[7])).not.toContain("audioBase64");
  });

  it("rejects wrong versions, unknown fields, snake case, and scalar coercion", () => {
    const invalid = [
      {
        protocol: "suits.speech.v2",
        type: "pong",
        nonce: "ping:1",
        receivedAtMs: 1,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "pong",
        nonce: "ping:1",
        receivedAtMs: 1,
        audioBase64: "private-audio",
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "pong",
        nonce: "ping:1",
        received_at_ms: 1,
      },
      {
        protocol: SPEECH_PROTOCOL,
        type: "pong",
        nonce: "ping:1",
        receivedAtMs: "1",
      },
    ];

    for (const event of invalid) {
      expect(() => parseSpeechServerEventJson(JSON.stringify(event))).toThrow(
        SpeechProtocolError,
      );
    }
  });

  it("requires a safe cumulative STT credit revision and bound watermark", () => {
    const valid = {
      protocol: SPEECH_PROTOCOL,
      type: "flow_control",
      sttCreditRevision: 1,
      sttUtteranceId: null,
      sttAcceptedThroughSequence: -1,
      sttAvailableFrames: 8,
      sttAvailableBytes: 5_120,
      ttsWindowBytes: 5_760,
      ttsOutstandingBytes: 0,
    };
    expect(parseSpeechServerEventJson(JSON.stringify(valid))).toEqual(valid);

    for (const invalid of [
      { ...valid, sttCreditRevision: 0 },
      { ...valid, sttCreditRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, sttCreditRevision: undefined },
      { ...valid, sttAcceptedThroughSequence: 0 },
      { ...valid, sttUtteranceId: undefined },
      { ...valid, sttAcceptedThroughSequence: undefined },
      {
        ...valid,
        sttUtteranceId: "utterance:1",
        sttAcceptedThroughSequence: Number.MAX_SAFE_INTEGER,
      },
    ]) {
      expect(() => parseSpeechServerEventJson(JSON.stringify(invalid))).toThrow(
        SpeechProtocolError,
      );
    }
  });

  it("rejects oversized and deeply nested controls with redacted diagnostics", () => {
    const oversized = " ".repeat(MAX_SPEECH_CONTROL_BYTES + 1);
    expect(() => parseSpeechServerEventJson(oversized)).toThrow(
      "speech control exceeded the transport limit",
    );

    let nested: unknown = { value: true };
    for (let index = 0; index < 40; index += 1) nested = [nested];
    const payload = JSON.stringify({
      protocol: SPEECH_PROTOCOL,
      type: "pong",
      nonce: "ping:private-value",
      receivedAtMs: 1,
      nested,
    });
    try {
      parseSpeechServerEventJson(payload);
      throw new Error("expected parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SpeechProtocolError);
      expect(String(error)).not.toContain("private-value");
    }
  });

  it("serializes exact client controls and rejects raw audio or ambiguous synthesis", () => {
    expect(
      JSON.parse(
        serializeSpeechClientControl({
          protocol: SPEECH_PROTOCOL,
          type: "audio_chunk",
          utteranceId: "utterance:1",
          sequence: 0,
          byteLength: 640,
          durationMs: 20,
        }),
      ),
    ).toEqual({
      protocol: SPEECH_PROTOCOL,
      type: "audio_chunk",
      utteranceId: "utterance:1",
      sequence: 0,
      byteLength: 640,
      durationMs: 20,
    });

    expect(() =>
      serializeSpeechClientControl({
        protocol: SPEECH_PROTOCOL,
        type: "synthesize",
        jobId: "job:1",
        responseId: "response:1",
        actor: "judge",
        sequence: 0,
        text: "Sustained.",
        clipId: "clip:sustained",
        isFinal: true,
      }),
    ).toThrow(SpeechProtocolError);

    expect(() =>
      serializeSpeechClientControl({
        protocol: SPEECH_PROTOCOL,
        type: "audio_chunk",
        utteranceId: "utterance:1",
        sequence: 0,
        byteLength: 640,
        durationMs: 20,
        audioBase64: "AAECAw==",
      } as never),
    ).toThrow(SpeechProtocolError);
  });
});
