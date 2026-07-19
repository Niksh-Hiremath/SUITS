import { z } from "zod";

export const SPEECH_PROTOCOL = "suits.speech.v1" as const;
export const SPEECH_SERVICE_VERSION = "0.1.0" as const;
export const MAX_SPEECH_CONTROL_BYTES = 65_536;

const identifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const shortText = z.string().trim().min(1).max(512);
const speechText = z.string().trim().min(1).max(8_192);
const phraseText = z.string().trim().min(1).max(512);
const protocol = z.literal(SPEECH_PROTOCOL);
const nonNegativeInteger = z.number().int().min(0);
const positiveSafeInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const sttSequenceWatermark = z.number().int().min(-1).max(2_147_483_647);

const helloControlSchema = z.strictObject({
  protocol,
  type: z.literal("hello"),
  requestId: identifier,
  clientId: identifier,
  supportedProtocols: z.array(z.literal(SPEECH_PROTOCOL)).min(1),
});

const loadModelsControlSchema = z.strictObject({
  protocol,
  type: z.literal("load_models"),
  requestId: identifier,
  sttProvider: identifier.optional(),
  ttsProvider: identifier.optional(),
  warmup: z.boolean(),
});

const startUtteranceControlSchema = z.strictObject({
  protocol,
  type: z.literal("start_utterance"),
  utteranceId: identifier,
  sampleRateHz: z.number().int().min(8_000).max(48_000),
  channels: z.literal(1),
  encoding: z.literal("pcm_s16le"),
  bargeIn: z.boolean(),
  endOfUtteranceSilenceMs: z.number().int().min(200).max(3_000),
});

const audioChunkControlSchema = z.strictObject({
  protocol,
  type: z.literal("audio_chunk"),
  utteranceId: identifier,
  sequence: z.number().int().min(0).max(2_147_483_647),
  byteLength: z.number().int().min(2).max(262_144).multipleOf(2),
  durationMs: z.number().int().min(1).max(2_000),
});

const endUtteranceControlSchema = z.strictObject({
  protocol,
  type: z.literal("end_utterance"),
  utteranceId: identifier,
});

const cancelUtteranceControlSchema = z.strictObject({
  protocol,
  type: z.literal("cancel_utterance"),
  utteranceId: identifier,
  reason: shortText,
});

const synthesizeControlSchema = z
  .strictObject({
    protocol,
    type: z.literal("synthesize"),
    jobId: identifier,
    responseId: identifier,
    actor: identifier,
    sequence: z.number().int().min(0).max(2_147_483_647),
    text: phraseText.optional(),
    clipId: identifier.optional(),
    voiceId: identifier.optional(),
    isFinal: z.boolean(),
  })
  .refine((value) => (value.text === undefined) !== (value.clipId === undefined));

const cancelSynthesisControlSchema = z
  .strictObject({
    protocol,
    type: z.literal("cancel_synthesis"),
    scope: z.enum(["job", "response", "all"]),
    jobId: identifier.optional(),
    responseId: identifier.optional(),
    reason: shortText,
  })
  .refine(
    (value) =>
      (value.scope === "job") === (value.jobId !== undefined) &&
      (value.scope === "response") === (value.responseId !== undefined),
  );

const ackTtsAudioControlSchema = z.strictObject({
  protocol,
  type: z.literal("ack_tts_audio"),
  jobId: identifier,
  responseId: identifier,
  frameSequence: nonNegativeInteger,
  frameToken: identifier,
  byteLength: z.number().int().min(2).multipleOf(2),
});

const setVoiceControlSchema = z.strictObject({
  protocol,
  type: z.literal("set_voice"),
  actor: identifier,
  voiceId: identifier,
});

const pingControlSchema = z.strictObject({
  protocol,
  type: z.literal("ping"),
  nonce: identifier,
  sentAtMs: nonNegativeInteger,
});

export const speechClientControlSchema = z.union([
  helloControlSchema,
  loadModelsControlSchema,
  startUtteranceControlSchema,
  audioChunkControlSchema,
  endUtteranceControlSchema,
  cancelUtteranceControlSchema,
  synthesizeControlSchema,
  cancelSynthesisControlSchema,
  ackTtsAudioControlSchema,
  setVoiceControlSchema,
  pingControlSchema,
]);

export type SpeechClientControl = z.infer<typeof speechClientControlSchema>;

const cudaCapabilitySchema = z.strictObject({
  available: z.boolean(),
  deviceName: shortText.nullish(),
  driverVersion: shortText.nullish(),
  computeCapability: shortText.nullish(),
  vramMb: nonNegativeInteger.nullish(),
  diagnostic: shortText.nullish(),
});

const providerCapabilitySchema = z.strictObject({
  providerId: identifier,
  kind: z.enum(["stt", "tts", "vad"]),
  configured: z.boolean(),
  loaded: z.boolean(),
  ready: z.boolean(),
  device: z.enum(["cuda", "cpu", "fake", "unavailable"]),
  modelId: shortText.nullish(),
  supportsStreaming: z.boolean(),
  supportsTimings: z.boolean(),
  warmupLatencyMs: nonNegativeInteger.nullish(),
  diagnostic: shortText.nullish(),
});

export const readyEventSchema = z.strictObject({
  protocol,
  type: z.literal("ready"),
  sessionId: identifier,
  serviceVersion: z.literal(SPEECH_SERVICE_VERSION),
  mode: z.enum(["fake", "cpu", "cuda"]),
});

export const capabilitiesEventSchema = z.strictObject({
  protocol,
  type: z.literal("capabilities"),
  requestId: identifier.nullish(),
  providers: z.array(providerCapabilitySchema),
  cuda: cudaCapabilitySchema,
  cachedClipIds: z.array(identifier),
  maxTtsQueueDepth: z.number().int().min(1).max(256),
  maxAudioChunkBytes: z.number().int().min(2),
});

const speechStartedEventSchema = z.strictObject({
  protocol,
  type: z.literal("speech_started"),
  utteranceId: identifier,
  detectedAtMs: nonNegativeInteger,
});

export const sttPartialEventSchema = z.strictObject({
  protocol,
  type: z.literal("stt_partial"),
  utteranceId: identifier,
  revision: z.number().int().min(1),
  text: speechText,
  confidence: z.number().min(0).max(1).nullish(),
  audioEndMs: nonNegativeInteger,
  emittedAtMs: nonNegativeInteger,
});

export const sttFinalEventSchema = z.strictObject({
  protocol,
  type: z.literal("stt_final"),
  utteranceId: identifier,
  revision: z.number().int().min(1),
  text: speechText,
  confidence: z.number().min(0).max(1).nullish(),
  audioEndMs: nonNegativeInteger,
  emittedAtMs: nonNegativeInteger,
});

const speechEndedEventSchema = z.strictObject({
  protocol,
  type: z.literal("speech_ended"),
  utteranceId: identifier,
  reason: z.enum(["client_end", "vad_end", "cancelled", "disconnect"]),
  detectedAtMs: nonNegativeInteger,
});

const ttsIdentity = {
  jobId: identifier,
  responseId: identifier,
  actor: identifier,
  sequence: nonNegativeInteger,
};

const ttsStartedEventSchema = z.strictObject({
  protocol,
  type: z.literal("tts_started"),
  ...ttsIdentity,
  voiceId: identifier,
  cached: z.boolean(),
  queueLatencyMs: nonNegativeInteger,
});

export const ttsAudioEventSchema = z.strictObject({
  protocol,
  type: z.literal("tts_audio"),
  ...ttsIdentity,
  frameSequence: nonNegativeInteger,
  frameToken: identifier,
  byteLength: z.number().int().min(2).multipleOf(2),
  durationMs: z.number().int().min(1),
  sampleRateHz: z.number().int().min(8_000).max(48_000),
  channels: z.literal(1),
  encoding: z.literal("pcm_s16le"),
  ackRequired: z.literal(true),
});

const timingMarkSchema = z
  .strictObject({
    kind: z.enum(["phrase", "word", "viseme"]),
    value: shortText,
    startMs: nonNegativeInteger,
    endMs: nonNegativeInteger,
  })
  .refine((value) => value.endMs >= value.startMs);

const ttsTimingEventSchema = z.strictObject({
  protocol,
  type: z.literal("tts_timing"),
  ...ttsIdentity,
  marks: z.array(timingMarkSchema).max(2_048),
});

const ttsFinishedEventSchema = z.strictObject({
  protocol,
  type: z.literal("tts_finished"),
  ...ttsIdentity,
  audioDurationMs: nonNegativeInteger,
  synthesisLatencyMs: nonNegativeInteger,
});

const cancelledEventSchema = z
  .strictObject({
    protocol,
    type: z.literal("cancelled"),
    target: z.enum(["utterance", "job", "response", "all_synthesis"]),
    targetId: identifier.nullish(),
    reason: shortText,
    cancellationLatencyMs: nonNegativeInteger,
  })
  .refine(
    (value) =>
      (value.target === "all_synthesis") ===
      (value.targetId === undefined || value.targetId === null),
  );

const metricSchema = z.strictObject({
  name: identifier,
  value: z.number().finite(),
  unit: z.enum(["count", "bytes", "milliseconds", "ratio"]),
});

const metricsEventSchema = z.strictObject({
  protocol,
  type: z.literal("metrics"),
  utteranceId: identifier.nullish(),
  jobId: identifier.nullish(),
  metrics: z.array(metricSchema).min(1).max(64),
});

export const flowControlEventSchema = z
  .strictObject({
    protocol,
    type: z.literal("flow_control"),
    sttCreditRevision: positiveSafeInteger,
    sttUtteranceId: identifier.nullable(),
    sttAcceptedThroughSequence: sttSequenceWatermark,
    sttAvailableFrames: nonNegativeInteger,
    sttAvailableBytes: nonNegativeInteger,
    ttsWindowBytes: z.number().int().min(2),
    ttsOutstandingBytes: nonNegativeInteger,
  })
  .refine(
    (value) =>
      value.sttUtteranceId !== null || value.sttAcceptedThroughSequence === -1,
  );

const errorEventSchema = z.strictObject({
  protocol,
  type: z.literal("error"),
  code: identifier,
  message: shortText,
  requestId: identifier.nullish(),
  utteranceId: identifier.nullish(),
  jobId: identifier.nullish(),
  retryable: z.boolean(),
  fatal: z.boolean(),
});

const pongEventSchema = z.strictObject({
  protocol,
  type: z.literal("pong"),
  nonce: identifier,
  receivedAtMs: nonNegativeInteger,
});

export const speechServerEventSchema = z.union([
  readyEventSchema,
  capabilitiesEventSchema,
  speechStartedEventSchema,
  sttPartialEventSchema,
  sttFinalEventSchema,
  speechEndedEventSchema,
  ttsStartedEventSchema,
  ttsAudioEventSchema,
  ttsTimingEventSchema,
  ttsFinishedEventSchema,
  cancelledEventSchema,
  metricsEventSchema,
  flowControlEventSchema,
  errorEventSchema,
  pongEventSchema,
]);

export type SpeechServerEvent = z.infer<typeof speechServerEventSchema>;
export type SpeechReadyEvent = z.infer<typeof readyEventSchema>;
export type SpeechCapabilitiesEvent = z.infer<typeof capabilitiesEventSchema>;
export type SpeechFlowControlEvent = z.infer<typeof flowControlEventSchema>;
export type SttPartialEvent = z.infer<typeof sttPartialEventSchema>;
export type SttFinalEvent = z.infer<typeof sttFinalEventSchema>;
export type TtsAudioEvent = z.infer<typeof ttsAudioEventSchema>;

export class SpeechProtocolError extends Error {
  constructor(
    readonly code: "CONTROL_TOO_LARGE" | "INVALID_CONTROL",
    message: string,
  ) {
    super(message);
    this.name = "SpeechProtocolError";
  }
}

function assertWireShape(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SpeechProtocolError(
      "INVALID_CONTROL",
      "speech control must be a JSON object",
    );
  }

  const root = value as Record<string, unknown>;
  if (root.protocol !== SPEECH_PROTOCOL) {
    throw new SpeechProtocolError(
      "INVALID_CONTROL",
      "speech control declared an unsupported protocol",
    );
  }

  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (candidate === undefined) break;
    if (candidate.depth > 32) {
      throw new SpeechProtocolError(
        "INVALID_CONTROL",
        "speech control exceeded the nesting limit",
      );
    }
    if (Array.isArray(candidate.value)) {
      for (const nested of candidate.value) {
        pending.push({ value: nested, depth: candidate.depth + 1 });
      }
      continue;
    }
    if (typeof candidate.value !== "object" || candidate.value === null) continue;
    for (const [key, nested] of Object.entries(candidate.value)) {
      if (key.includes("_")) {
        throw new SpeechProtocolError(
          "INVALID_CONTROL",
          "speech control keys must use camelCase",
        );
      }
      pending.push({ value: nested, depth: candidate.depth + 1 });
    }
  }
}

function parseStrict<T>(schema: z.ZodType<T>, value: unknown): T {
  assertWireShape(value);
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SpeechProtocolError(
      "INVALID_CONTROL",
      "speech control failed strict validation",
    );
  }
  return result.data;
}

export function parseSpeechServerEvent(value: unknown): SpeechServerEvent {
  return parseStrict(speechServerEventSchema, value);
}

export function parseSpeechServerEventJson(payload: string): SpeechServerEvent {
  if (new TextEncoder().encode(payload).byteLength > MAX_SPEECH_CONTROL_BYTES) {
    throw new SpeechProtocolError(
      "CONTROL_TOO_LARGE",
      "speech control exceeded the transport limit",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    throw new SpeechProtocolError(
      "INVALID_CONTROL",
      "speech control was not valid JSON",
    );
  }
  return parseSpeechServerEvent(value);
}

export function serializeSpeechClientControl(control: SpeechClientControl): string {
  return JSON.stringify(parseStrict(speechClientControlSchema, control));
}

export function assertSpeechIdentifier(value: string): string {
  const result = identifier.safeParse(value);
  if (!result.success) {
    throw new SpeechProtocolError(
      "INVALID_CONTROL",
      "speech identifier failed strict validation",
    );
  }
  return result.data;
}
