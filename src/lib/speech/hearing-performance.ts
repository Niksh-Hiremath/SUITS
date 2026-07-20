import { z } from "zod";

export const HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION =
  "hearing-performance-event.v1" as const;

export const HEARING_OBJECTION_ACTOR_ID =
  "actor.opposing_counsel.objection" as const;
export const HEARING_JUDGE_ACTOR_ID = "actor.judge" as const;
export const HEARING_COURTROOM_DIRECTOR_ACTOR_ID =
  "actor.courtroom.director" as const;

export const HearingPerformanceSceneActorSchema = z.enum([
  "judge",
  "user_counsel",
  "opposing_counsel",
  "witness",
  "clerk",
  "jury",
]);

export const HearingPlaybackPurposeSchema = z.enum([
  "transcript",
  "testimony",
  "objection",
  "ruling",
  "correction",
  "speaker_test",
]);

const IdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u);
// Partial-objection IDs include two safe integers plus an accepted local
// utterance identifier (up to 240 characters), for a maximum of 292.
const LocalInterruptIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,291}$/u);
const DurableIdentifierSchema = z.string().trim().min(1).max(256);

const playbackIdentityShape = {
  schemaVersion: z.literal(HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION),
  generation: z.number().int().nonnegative(),
  playbackFence: z.number().int().nonnegative(),
  jobId: IdentifierSchema,
  responseId: IdentifierSchema,
  actor: IdentifierSchema,
  sequence: z.number().int().nonnegative(),
  sceneActor: HearingPerformanceSceneActorSchema,
  purpose: HearingPlaybackPurposeSchema,
  turnId: DurableIdentifierSchema.nullable(),
  interruptId: LocalInterruptIdentifierSchema.nullable(),
} as const;

const userSpeechIdentityShape = {
  schemaVersion: z.literal(HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION),
  generation: z.number().int().nonnegative(),
  utteranceId: IdentifierSchema,
  sceneActor: z.literal("user_counsel"),
  mode: z.enum(["question", "closing"]),
} as const;

export const HearingPerformanceTimingMarkSchema = z
  .object({
    kind: z.enum(["phrase", "word", "viseme"]),
    value: z.string().trim().min(1).max(512),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    audioStartTimeSeconds: z.number().finite().nonnegative(),
    audioEndTimeSeconds: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(
    (mark) =>
      mark.endMs >= mark.startMs &&
      mark.audioEndTimeSeconds >= mark.audioStartTimeSeconds,
  );

export const HearingPerformanceEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("user_speech_started"),
      ...userSpeechIdentityShape,
      observedAtMs: z.number().int().nonnegative(),
      timestampSource: z.literal("speech_service"),
    })
    .strict(),
  z
    .object({
      type: z.literal("user_speech_ended"),
      ...userSpeechIdentityShape,
      observedAtMs: z.number().int().nonnegative(),
      timestampSource: z.enum(["speech_service", "controller"]),
      reason: z.enum([
        "client_end",
        "vad_end",
        "final_received",
        "cancelled",
        "disconnect",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("playback_requested"),
      ...playbackIdentityShape,
    })
    .strict(),
  z
    .object({
      type: z.literal("playback_started"),
      ...playbackIdentityShape,
    })
    .strict(),
  z
    .object({
      type: z.literal("timing_scheduled"),
      ...playbackIdentityShape,
      audioClockTimeSeconds: z.number().finite().nonnegative(),
      marks: z.array(HearingPerformanceTimingMarkSchema).min(1).max(2_048),
    })
    .strict(),
  z
    .object({
      type: z.literal("playback_terminal"),
      ...playbackIdentityShape,
      status: z.enum(["completed", "cancelled", "failed", "superseded"]),
      reason: z.enum([
        "completed",
        "barge_in",
        "courtroom_action",
        "interruption_stale",
        "playback_failed",
        "service_cancelled",
        "controller_closed",
        "superseded",
      ]),
    })
    .strict()
    .superRefine((event, context) => {
      const valid =
        (event.status === "completed" && event.reason === "completed") ||
        (event.status === "failed" && event.reason === "playback_failed") ||
        (event.status === "superseded" && event.reason === "superseded") ||
        (event.status === "cancelled" &&
          event.reason !== "completed" &&
          event.reason !== "playback_failed" &&
          event.reason !== "superseded");
      if (!valid) {
        context.addIssue({
          code: "custom",
          path: ["reason"],
          message: "Playback terminal status and reason do not match",
        });
      }
    }),
]);

export type HearingPerformanceSceneActor = z.infer<
  typeof HearingPerformanceSceneActorSchema
>;
export type HearingPlaybackPurpose = z.infer<
  typeof HearingPlaybackPurposeSchema
>;
export type HearingPerformanceEvent = z.infer<
  typeof HearingPerformanceEventSchema
>;

/**
 * Produce the privacy-safe actor alias carried by browser audio lifecycle
 * observations. The durable actor ID is intentionally never written to those
 * records, but the server can recompute this alias to verify a transcript-turn
 * binding.
 */
export function hearingPerformanceActorAlias(
  actor: Readonly<{ actorId: string; role: string }>,
): string {
  let hash = 2_166_136_261;
  for (const character of actor.actorId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `actor.${actor.role}.${(hash >>> 0).toString(36)}`;
}

/** Match the actor-side policy used by the production transcript TTS path. */
export function isHearingPerformanceSpeakableActor(
  actor: Readonly<{
    role: string;
    side: "user" | "opposing" | "neutral";
  }>,
  userSide: "user" | "opposing",
): boolean {
  if (
    actor.role === "judge" ||
    actor.role === "witness" ||
    actor.role === "jury"
  ) {
    return true;
  }
  return (
    (actor.role === "user_counsel" || actor.role === "opposing_counsel") &&
    actor.side === (userSide === "user" ? "opposing" : "user")
  );
}

export function freezeHearingPerformanceEvent(
  input: z.input<typeof HearingPerformanceEventSchema>,
): HearingPerformanceEvent {
  const parsed = HearingPerformanceEventSchema.parse(input);
  if (parsed.type === "timing_scheduled") {
    for (const mark of parsed.marks) Object.freeze(mark);
    Object.freeze(parsed.marks);
  }
  return Object.freeze(parsed);
}
