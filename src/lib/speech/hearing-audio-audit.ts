import { sha256Utf8 } from "../../domain/case-graph/hash";
import { z } from "zod";

import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  HearingPerformanceEventSchema,
  type HearingPerformanceEvent,
} from "./hearing-performance";

export const HEARING_AUDIO_AUDIT_SCHEMA_VERSION =
  "hearing-audio-audit.v1" as const;
export const HEARING_AUDIO_AUDIT_SOURCE = "client_observed" as const;
export const HEARING_AUDIO_AUDIT_AUTHORITY = "noncanonical" as const;

export const HEARING_AUDIO_AUDIT_MAX_ACTIVE_ENTRIES = 32;
export const HEARING_AUDIO_AUDIT_MAX_TIMING_EVENTS = 256;
export const HEARING_AUDIO_AUDIT_MAX_TIMING_MARKS = 4_096;
export const HEARING_AUDIO_AUDIT_MAX_PENDING_RECORDS = 256;
export const HEARING_AUDIO_AUDIT_MAX_EPOCH_MS =
  8_640_000_000_000_000 as const;
const MAX_COMPLETED_IDENTITIES = 1_024;

const SafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const EpochMillisecondsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(HEARING_AUDIO_AUDIT_MAX_EPOCH_MS);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u);
const LocalInterruptIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,291}$/u);
const DurableIdentifierSchema = z.string().trim().min(1).max(256);

export const HearingAudioAuditMarkCountsSchema = z
  .object({
    phrase: SafeIntegerSchema.max(HEARING_AUDIO_AUDIT_MAX_TIMING_MARKS),
    word: SafeIntegerSchema.max(HEARING_AUDIO_AUDIT_MAX_TIMING_MARKS),
    viseme: SafeIntegerSchema.max(HEARING_AUDIO_AUDIT_MAX_TIMING_MARKS),
  })
  .strict();

const UserIdentitySchema = z
  .object({
    eventSchemaVersion: z.literal(HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION),
    generation: SafeIntegerSchema,
    utteranceId: IdentifierSchema,
  })
  .strict();

const PlaybackIdentitySchema = z
  .object({
    eventSchemaVersion: z.literal(HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION),
    generation: SafeIntegerSchema,
    playbackFence: SafeIntegerSchema,
    jobId: IdentifierSchema,
    responseId: IdentifierSchema,
    actor: IdentifierSchema,
    sequence: SafeIntegerSchema,
    turnId: DurableIdentifierSchema.nullable(),
    interruptId: LocalInterruptIdentifierSchema.nullable(),
  })
  .strict();

const commonRecordShape = {
  schemaVersion: z.literal(HEARING_AUDIO_AUDIT_SCHEMA_VERSION),
  recordId: Sha256Schema,
  observationSource: z.literal(HEARING_AUDIO_AUDIT_SOURCE),
  authority: z.literal(HEARING_AUDIO_AUDIT_AUTHORITY),
  observedAtEpochMs: EpochMillisecondsSchema,
  requestedAtEpochMs: EpochMillisecondsSchema.nullable(),
  startedAtEpochMs: EpochMillisecondsSchema.nullable(),
  endedAtEpochMs: EpochMillisecondsSchema,
  aggregateDurationMs: SafeIntegerSchema,
} as const;

const UserRecordContentSchema = z
  .object({
    ...commonRecordShape,
    kind: z.literal("user_speech"),
    identity: UserIdentitySchema,
    sceneActor: z.literal("user_counsel"),
    mode: z.enum(["question", "closing"]),
    terminalStatus: z.enum(["completed", "cancelled", "failed"]),
    terminalReason: z.enum([
      "client_end",
      "vad_end",
      "final_received",
      "cancelled",
      "disconnect",
    ]),
    terminalTimestampSource: z.enum(["speech_service", "controller"]),
  })
  .strict()
  .superRefine((record, context) => {
    const expected =
      record.terminalReason === "cancelled"
        ? "cancelled"
        : record.terminalReason === "disconnect"
          ? "failed"
          : "completed";
    if (record.terminalStatus !== expected) {
      context.addIssue({
        code: "custom",
        path: ["terminalStatus"],
        message: "User terminal status and reason do not match",
      });
    }
  });

const PlaybackRecordContentSchema = z
  .object({
    ...commonRecordShape,
    kind: z.literal("playback"),
    identity: PlaybackIdentitySchema,
    sceneActor: z.enum([
      "judge",
      "user_counsel",
      "opposing_counsel",
      "witness",
      "clerk",
      "jury",
    ]),
    purpose: z.enum([
      "transcript",
      "testimony",
      "objection",
      "ruling",
      "correction",
      "speaker_test",
    ]),
    timingEventCount: SafeIntegerSchema.max(HEARING_AUDIO_AUDIT_MAX_TIMING_EVENTS),
    markCount: SafeIntegerSchema.max(HEARING_AUDIO_AUDIT_MAX_TIMING_MARKS),
    markKinds: z
      .array(z.enum(["phrase", "word", "viseme"]))
      .max(3),
    markCounts: HearingAudioAuditMarkCountsSchema,
    scheduledAudioDurationMs: SafeIntegerSchema.nullable(),
    timingTruncated: z.boolean(),
    terminalStatus: z.enum(["completed", "cancelled", "failed", "superseded"]),
    terminalReason: z.enum([
      "completed",
      "barge_in",
      "courtroom_action",
      "interruption_stale",
      "playback_failed",
      "service_cancelled",
      "controller_closed",
      "superseded",
    ]),
    terminalTimestampSource: z.literal("client_observed"),
  })
  .strict()
  .superRefine((record, context) => {
    const total = record.markCounts.phrase + record.markCounts.word + record.markCounts.viseme;
    const kinds = (["phrase", "word", "viseme"] as const).filter(
      (kind) => record.markCounts[kind] > 0,
    );
    if (total !== record.markCount) {
      context.addIssue({ code: "custom", path: ["markCount"], message: "Mark counts do not add up" });
    }
    if (JSON.stringify(kinds) !== JSON.stringify(record.markKinds)) {
      context.addIssue({ code: "custom", path: ["markKinds"], message: "Mark kinds do not match counts" });
    }
    if ((record.markCount === 0) !== (record.scheduledAudioDurationMs === null)) {
      context.addIssue({
        code: "custom",
        path: ["scheduledAudioDurationMs"],
        message: "Scheduled duration must be present exactly when timing marks are present",
      });
    }
    const terminalPairIsValid =
      (record.terminalStatus === "completed" && record.terminalReason === "completed") ||
      (record.terminalStatus === "failed" && record.terminalReason === "playback_failed") ||
      (record.terminalStatus === "superseded" && record.terminalReason === "superseded") ||
      (record.terminalStatus === "cancelled" &&
        record.terminalReason !== "completed" &&
        record.terminalReason !== "playback_failed" &&
        record.terminalReason !== "superseded");
    if (!terminalPairIsValid) {
      context.addIssue({
        code: "custom",
        path: ["terminalReason"],
        message: "Playback terminal status and reason do not match",
      });
    }
  });

const UserRecordSchemaBase = UserRecordContentSchema.safeExtend({ contentHash: Sha256Schema });
const PlaybackRecordSchemaBase = PlaybackRecordContentSchema.safeExtend({ contentHash: Sha256Schema });

export const HearingAudioAuditRecordSchema = z
  .discriminatedUnion("kind", [UserRecordSchemaBase, PlaybackRecordSchemaBase])
  .superRefine((record, context) => {
    const expectedId = computeRecordId(record);
    if (record.recordId !== expectedId) {
      context.addIssue({ code: "custom", path: ["recordId"], message: "Record ID does not match identity" });
    }
    let expectedHash: string;
    try {
      expectedHash = computeContentHash(record);
    } catch {
      // Base-schema issues are already present. Do not let the integrity
      // refinement turn a safeParse failure into a thrown Zod error.
      return;
    }
    if (record.contentHash !== expectedHash) {
      context.addIssue({ code: "custom", path: ["contentHash"], message: "Content hash does not match record" });
    }
    const baseline = record.startedAtEpochMs ?? record.requestedAtEpochMs ?? record.observedAtEpochMs;
    if (
      record.endedAtEpochMs < record.observedAtEpochMs ||
      (record.requestedAtEpochMs !== null &&
        (record.requestedAtEpochMs < record.observedAtEpochMs ||
          record.requestedAtEpochMs > record.endedAtEpochMs)) ||
      (record.startedAtEpochMs !== null &&
        (record.startedAtEpochMs < record.observedAtEpochMs ||
          record.startedAtEpochMs > record.endedAtEpochMs)) ||
      (record.requestedAtEpochMs !== null &&
        record.startedAtEpochMs !== null &&
        record.startedAtEpochMs < record.requestedAtEpochMs) ||
      record.aggregateDurationMs !== record.endedAtEpochMs - baseline
    ) {
      context.addIssue({ code: "custom", path: ["aggregateDurationMs"], message: "Lifecycle timestamps are inconsistent" });
    }
  });

export const HearingAudioAuditIngestRequestSchema = z
  .object({ record: HearingAudioAuditRecordSchema })
  .strict();

export const HearingAudioAuditPersistResultSchema = z
  .object({
    recordId: Sha256Schema,
    replayed: z.boolean(),
  })
  .strict();

export type HearingAudioAuditRecord = z.infer<typeof HearingAudioAuditRecordSchema>;
export type HearingAudioAuditPersistResult = z.infer<
  typeof HearingAudioAuditPersistResultSchema
>;

export type HearingAudioAuditConsumeDisposition =
  | "accepted"
  | "record_ready"
  | "duplicate"
  | "stale"
  | "identity_conflict"
  | "capacity_rejected"
  | "timing_truncated";

export type HearingAudioAuditClock = Readonly<{ nowEpochMs: () => number }>;

export type HearingAudioAuditPreparerOptions = Readonly<{
  clock: HearingAudioAuditClock;
  maxActiveEntries?: number;
  maxTimingEventsPerPlayback?: number;
  maxTimingMarksPerPlayback?: number;
  maxPendingRecords?: number;
}>;

type UserEvent = Extract<
  HearingPerformanceEvent,
  { type: "user_speech_started" | "user_speech_ended" }
>;
type PlaybackEvent = Exclude<HearingPerformanceEvent, UserEvent>;

type UserEntry = {
  key: string;
  identity: z.infer<typeof UserIdentitySchema>;
  sceneActor: "user_counsel";
  mode: "question" | "closing";
  observedAtEpochMs: number;
  startedAtEpochMs: number | null;
  eventFingerprints: Set<string>;
};

type PlaybackEntry = {
  key: string;
  jobAlias: string;
  responseAlias: string;
  identity: z.infer<typeof PlaybackIdentitySchema>;
  sceneActor: PlaybackEvent["sceneActor"];
  purpose: PlaybackEvent["purpose"];
  observedAtEpochMs: number;
  requestedAtEpochMs: number | null;
  startedAtEpochMs: number | null;
  timingEventCount: number;
  markCounts: { phrase: number; word: number; viseme: number };
  timingStartSeconds: number | null;
  timingEndSeconds: number | null;
  timingTruncated: boolean;
  eventFingerprints: Set<string>;
};

type CompletedIdentity =
  | Readonly<{
      kind: "user_speech";
      key: string;
      userAlias: string;
      eventFingerprints: ReadonlySet<string>;
    }>
  | Readonly<{
      kind: "playback";
      key: string;
      jobAlias: string;
      responseAlias: string;
      eventFingerprints: ReadonlySet<string>;
    }>;

type RecordIdInput =
  | Readonly<{
      schemaVersion: typeof HEARING_AUDIO_AUDIT_SCHEMA_VERSION;
      kind: "user_speech";
      identity: z.infer<typeof UserIdentitySchema>;
      sceneActor: "user_counsel";
      mode: "question" | "closing";
    }>
  | Readonly<{
      schemaVersion: typeof HEARING_AUDIO_AUDIT_SCHEMA_VERSION;
      kind: "playback";
      identity: z.infer<typeof PlaybackIdentitySchema>;
      sceneActor: PlaybackEvent["sceneActor"];
      purpose: PlaybackEvent["purpose"];
    }>;

function computeRecordId(record: RecordIdInput): string {
  const identity =
    record.kind === "user_speech"
      ? {
          schemaVersion: record.schemaVersion,
          kind: record.kind,
          identity: record.identity,
          sceneActor: record.sceneActor,
          mode: record.mode,
        }
      : {
          schemaVersion: record.schemaVersion,
          kind: record.kind,
          identity: record.identity,
          sceneActor: record.sceneActor,
          purpose: record.purpose,
        };
  return sha256Utf8(JSON.stringify(identity));
}

function computeContentHash(record: HearingAudioAuditRecord): string {
  const contentInput = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "contentHash"),
  );
  const content =
    record.kind === "user_speech"
      ? UserRecordContentSchema.parse(contentInput)
      : PlaybackRecordContentSchema.parse(contentInput);
  return sha256Utf8(JSON.stringify(content));
}

function freezeRecord(record: HearingAudioAuditRecord): HearingAudioAuditRecord {
  Object.freeze(record.identity);
  if (record.kind === "playback") {
    Object.freeze(record.markCounts);
    Object.freeze(record.markKinds);
  }
  return Object.freeze(record);
}

function eventFingerprint(event: HearingPerformanceEvent): string {
  if (event.type !== "timing_scheduled") return sha256Utf8(JSON.stringify(event));
  return sha256Utf8(
    JSON.stringify({
      ...event,
      marks: event.marks.map((mark) => ({
        kind: mark.kind,
        startMs: mark.startMs,
        endMs: mark.endMs,
        audioStartTimeSeconds: mark.audioStartTimeSeconds,
        audioEndTimeSeconds: mark.audioEndTimeSeconds,
      })),
    }),
  );
}

function userKey(event: UserEvent): string {
  return JSON.stringify([
    event.schemaVersion,
    event.generation,
    event.utteranceId,
    event.sceneActor,
    event.mode,
  ]);
}

function userAlias(
  identity: Readonly<{ generation: number; utteranceId: string }>,
): string {
  // One prepared controller generation owns many sequential utterances.
  return JSON.stringify([identity.generation, identity.utteranceId]);
}

function playbackKey(event: PlaybackEvent): string {
  return JSON.stringify([
    event.schemaVersion,
    event.generation,
    event.playbackFence,
    event.jobId,
    event.responseId,
    event.actor,
    event.sequence,
    event.sceneActor,
    event.purpose,
    event.turnId,
    event.interruptId,
  ]);
}

function jobAlias(event: PlaybackEvent): string {
  return JSON.stringify([event.generation, event.playbackFence, event.jobId]);
}

function responseAlias(event: PlaybackEvent): string {
  return JSON.stringify([
    event.generation,
    event.playbackFence,
    event.responseId,
    event.sequence,
  ]);
}

function playbackFenceComparison(
  event: PlaybackEvent,
  highWater: readonly [number, number] | null,
): number {
  if (highWater === null) return 1;
  if (event.generation !== highWater[0]) return event.generation - highWater[0];
  return event.playbackFence - highWater[1];
}

function terminalUserStatus(reason: Extract<UserEvent, { type: "user_speech_ended" }>["reason"]) {
  if (reason === "cancelled") return "cancelled" as const;
  if (reason === "disconnect") return "failed" as const;
  return "completed" as const;
}

function boundedDuration(startSeconds: number, endSeconds: number): number {
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(0, Math.round((endSeconds - startSeconds) * 1_000)),
  );
}

function requireBound(value: number | undefined, fallback: number, hardMaximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hardMaximum) {
    throw new RangeError(`Audio audit bound must be an integer from 1 to ${hardMaximum}`);
  }
  return resolved;
}

/**
 * Content-free client observation aggregator. It prepares noncanonical durable
 * records but performs no persistence and never retains transcript/audio data.
 */
export class HearingAudioAuditPreparer {
  readonly #clock: HearingAudioAuditClock;
  readonly #maxActiveEntries: number;
  readonly #maxTimingEvents: number;
  readonly #maxTimingMarks: number;
  readonly #maxPendingRecords: number;
  #lastClockEpochMs: number | null = null;
  #userHighWater = -1;
  #playbackHighWater: readonly [number, number] | null = null;
  #users = new Map<string, UserEntry>();
  #playbacks = new Map<string, PlaybackEntry>();
  #completed: CompletedIdentity[] = [];
  #pending: HearingAudioAuditRecord[] = [];

  constructor(options: HearingAudioAuditPreparerOptions) {
    this.#clock = options.clock;
    this.#maxActiveEntries = requireBound(
      options.maxActiveEntries,
      HEARING_AUDIO_AUDIT_MAX_ACTIVE_ENTRIES,
      HEARING_AUDIO_AUDIT_MAX_ACTIVE_ENTRIES,
    );
    this.#maxTimingEvents = requireBound(
      options.maxTimingEventsPerPlayback,
      HEARING_AUDIO_AUDIT_MAX_TIMING_EVENTS,
      HEARING_AUDIO_AUDIT_MAX_TIMING_EVENTS,
    );
    this.#maxTimingMarks = requireBound(
      options.maxTimingMarksPerPlayback,
      HEARING_AUDIO_AUDIT_MAX_TIMING_MARKS,
      HEARING_AUDIO_AUDIT_MAX_TIMING_MARKS,
    );
    this.#maxPendingRecords = requireBound(
      options.maxPendingRecords,
      HEARING_AUDIO_AUDIT_MAX_PENDING_RECORDS,
      HEARING_AUDIO_AUDIT_MAX_PENDING_RECORDS,
    );
  }

  get activeEntryCount(): number {
    return this.#users.size + this.#playbacks.size;
  }

  get pendingRecordCount(): number {
    return this.#pending.length;
  }

  consume(input: HearingPerformanceEvent): HearingAudioAuditConsumeDisposition {
    const event = HearingPerformanceEventSchema.parse(input);
    const now = this.#readClock();
    return event.type === "user_speech_started" || event.type === "user_speech_ended"
      ? this.#consumeUser(event, now)
      : this.#consumePlayback(event, now);
  }

  flush(): readonly HearingAudioAuditRecord[] {
    const records = Object.freeze([...this.#pending]);
    this.#pending = [];
    return records;
  }

  reset(): void {
    this.#lastClockEpochMs = null;
    this.#userHighWater = -1;
    this.#playbackHighWater = null;
    this.#users.clear();
    this.#playbacks.clear();
    this.#completed = [];
    this.#pending = [];
  }

  #readClock(): number {
    const value = this.#clock.nowEpochMs();
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > HEARING_AUDIO_AUDIT_MAX_EPOCH_MS
    ) {
      throw new RangeError(
        "Audio audit clock must return a nonnegative epoch millisecond integer within the JavaScript Date range",
      );
    }
    if (this.#lastClockEpochMs !== null && value < this.#lastClockEpochMs) {
      throw new RangeError("Audio audit clock must be monotonic");
    }
    this.#lastClockEpochMs = value;
    return value;
  }

  #activeCapacityAvailable(): boolean {
    return this.activeEntryCount < this.#maxActiveEntries;
  }

  #findCompleted(
    kind: CompletedIdentity["kind"],
    key: string,
  ): CompletedIdentity | undefined {
    return this.#completed.find((entry) => entry.kind === kind && entry.key === key);
  }

  #rememberCompleted(entry: CompletedIdentity): void {
    this.#completed.push(entry);
    if (this.#completed.length > MAX_COMPLETED_IDENTITIES) {
      this.#completed.splice(0, this.#completed.length - MAX_COMPLETED_IDENTITIES);
    }
  }

  #consumeUser(event: UserEvent, now: number): HearingAudioAuditConsumeDisposition {
    if (event.generation < this.#userHighWater) return "stale";
    if (event.generation > this.#userHighWater) {
      this.#users.clear();
      this.#userHighWater = event.generation;
    }
    const key = userKey(event);
    const alias = userAlias(event);
    const fingerprint = eventFingerprint(event);
    const completed = this.#findCompleted("user_speech", key);
    if (completed) {
      return completed.eventFingerprints.has(fingerprint) ? "duplicate" : "stale";
    }
    const completedAliasConflict = this.#completed.some(
      (entry) =>
        entry.kind === "user_speech" &&
        entry.userAlias === alias &&
        entry.key !== key,
    );
    if (completedAliasConflict) return "identity_conflict";
    const conflicting = [...this.#users.values()].some(
      (entry) =>
        userAlias(entry.identity) === alias && entry.key !== key,
    );
    if (conflicting) return "identity_conflict";

    if (event.type === "user_speech_started") {
      const existing = this.#users.get(key);
      if (existing) {
        return existing.eventFingerprints.has(fingerprint) ? "duplicate" : "identity_conflict";
      }
      if (!this.#activeCapacityAvailable()) return "capacity_rejected";
      this.#users.set(key, {
        key,
        identity: {
          eventSchemaVersion: event.schemaVersion,
          generation: event.generation,
          utteranceId: event.utteranceId,
        },
        sceneActor: event.sceneActor,
        mode: event.mode,
        observedAtEpochMs: now,
        startedAtEpochMs: now,
        eventFingerprints: new Set([fingerprint]),
      });
      return "accepted";
    }

    if (this.#pending.length >= this.#maxPendingRecords) return "capacity_rejected";
    const entry = this.#users.get(key) ?? {
      key,
      identity: {
        eventSchemaVersion: event.schemaVersion,
        generation: event.generation,
        utteranceId: event.utteranceId,
      },
      sceneActor: event.sceneActor,
      mode: event.mode,
      observedAtEpochMs: now,
      startedAtEpochMs: null,
      eventFingerprints: new Set<string>(),
    };
    entry.eventFingerprints.add(fingerprint);
    const baseline = entry.startedAtEpochMs ?? entry.observedAtEpochMs;
    const withoutHashes = {
      schemaVersion: HEARING_AUDIO_AUDIT_SCHEMA_VERSION,
      observationSource: HEARING_AUDIO_AUDIT_SOURCE,
      authority: HEARING_AUDIO_AUDIT_AUTHORITY,
      observedAtEpochMs: entry.observedAtEpochMs,
      requestedAtEpochMs: null,
      startedAtEpochMs: entry.startedAtEpochMs,
      endedAtEpochMs: now,
      aggregateDurationMs: now - baseline,
      kind: "user_speech" as const,
      identity: entry.identity,
      sceneActor: entry.sceneActor,
      mode: entry.mode,
      terminalStatus: terminalUserStatus(event.reason),
      terminalReason: event.reason,
      terminalTimestampSource: event.timestampSource,
    };
    const recordId = computeRecordId({
      schemaVersion: withoutHashes.schemaVersion,
      kind: withoutHashes.kind,
      identity: withoutHashes.identity,
      sceneActor: withoutHashes.sceneActor,
      mode: withoutHashes.mode,
    });
    const content = UserRecordContentSchema.parse({ ...withoutHashes, recordId });
    const record = HearingAudioAuditRecordSchema.parse({
      ...content,
      contentHash: sha256Utf8(JSON.stringify(content)),
    });
    this.#pending.push(freezeRecord(record));
    this.#users.delete(key);
    this.#rememberCompleted({
      kind: "user_speech",
      key,
      userAlias: alias,
      eventFingerprints: new Set(entry.eventFingerprints),
    });
    return "record_ready";
  }

  #consumePlayback(event: PlaybackEvent, now: number): HearingAudioAuditConsumeDisposition {
    const comparison = playbackFenceComparison(event, this.#playbackHighWater);
    if (comparison < 0) return "stale";
    if (comparison > 0) {
      this.#playbacks.clear();
      this.#playbackHighWater = [event.generation, event.playbackFence];
    }
    const key = playbackKey(event);
    const job = jobAlias(event);
    const response = responseAlias(event);
    const fingerprint = eventFingerprint(event);
    const completed = this.#findCompleted("playback", key);
    if (completed) {
      return completed.eventFingerprints.has(fingerprint) ? "duplicate" : "stale";
    }
    const aliases = [...this.#playbacks.values()].find(
      (entry) => entry.jobAlias === job || entry.responseAlias === response,
    );
    if (aliases && aliases.key !== key) return "identity_conflict";
    const completedAlias = this.#completed.find(
      (entry) =>
        entry.kind === "playback" &&
        (entry.jobAlias === job || entry.responseAlias === response) &&
        entry.key !== key,
    );
    if (completedAlias) return "identity_conflict";

    let entry = this.#playbacks.get(key);
    if (entry?.eventFingerprints.has(fingerprint)) return "duplicate";
    if (!entry) {
      if (event.type !== "playback_terminal" && !this.#activeCapacityAvailable()) {
        return "capacity_rejected";
      }
      entry = {
        key,
        jobAlias: job,
        responseAlias: response,
        identity: {
          eventSchemaVersion: event.schemaVersion,
          generation: event.generation,
          playbackFence: event.playbackFence,
          jobId: event.jobId,
          responseId: event.responseId,
          actor: event.actor,
          sequence: event.sequence,
          turnId: event.turnId,
          interruptId: event.interruptId,
        },
        sceneActor: event.sceneActor,
        purpose: event.purpose,
        observedAtEpochMs: now,
        requestedAtEpochMs: null,
        startedAtEpochMs: null,
        timingEventCount: 0,
        markCounts: { phrase: 0, word: 0, viseme: 0 },
        timingStartSeconds: null,
        timingEndSeconds: null,
        timingTruncated: false,
        eventFingerprints: new Set(),
      };
      if (event.type !== "playback_terminal") this.#playbacks.set(key, entry);
    }

    if (event.type === "playback_requested") {
      if (entry.startedAtEpochMs !== null) return "stale";
      entry.requestedAtEpochMs ??= now;
      entry.eventFingerprints.add(fingerprint);
      return "accepted";
    }
    if (event.type === "playback_started") {
      entry.startedAtEpochMs ??= now;
      entry.eventFingerprints.add(fingerprint);
      return "accepted";
    }
    if (event.type === "timing_scheduled") {
      const remaining = this.#maxTimingMarks -
        (entry.markCounts.phrase + entry.markCounts.word + entry.markCounts.viseme);
      if (entry.timingEventCount >= this.#maxTimingEvents || remaining <= 0) {
        entry.timingTruncated = true;
        return "timing_truncated";
      }
      entry.eventFingerprints.add(fingerprint);
      const accepted = event.marks.slice(0, remaining);
      entry.timingEventCount += 1;
      entry.timingTruncated ||= accepted.length !== event.marks.length;
      for (const mark of accepted) {
        entry.markCounts[mark.kind] += 1;
        entry.timingStartSeconds =
          entry.timingStartSeconds === null
            ? mark.audioStartTimeSeconds
            : Math.min(entry.timingStartSeconds, mark.audioStartTimeSeconds);
        entry.timingEndSeconds =
          entry.timingEndSeconds === null
            ? mark.audioEndTimeSeconds
            : Math.max(entry.timingEndSeconds, mark.audioEndTimeSeconds);
      }
      return entry.timingTruncated ? "timing_truncated" : "accepted";
    }

    if (this.#pending.length >= this.#maxPendingRecords) return "capacity_rejected";
    entry.eventFingerprints.add(fingerprint);
    const markCount = entry.markCounts.phrase + entry.markCounts.word + entry.markCounts.viseme;
    const markKinds = (["phrase", "word", "viseme"] as const).filter(
      (kind) => entry.markCounts[kind] > 0,
    );
    const baseline = entry.startedAtEpochMs ?? entry.requestedAtEpochMs ?? entry.observedAtEpochMs;
    const withoutHashes = {
      schemaVersion: HEARING_AUDIO_AUDIT_SCHEMA_VERSION,
      observationSource: HEARING_AUDIO_AUDIT_SOURCE,
      authority: HEARING_AUDIO_AUDIT_AUTHORITY,
      observedAtEpochMs: entry.observedAtEpochMs,
      requestedAtEpochMs: entry.requestedAtEpochMs,
      startedAtEpochMs: entry.startedAtEpochMs,
      endedAtEpochMs: now,
      aggregateDurationMs: now - baseline,
      kind: "playback" as const,
      identity: entry.identity,
      sceneActor: entry.sceneActor,
      purpose: entry.purpose,
      timingEventCount: entry.timingEventCount,
      markCount,
      markKinds,
      markCounts: entry.markCounts,
      scheduledAudioDurationMs:
        entry.timingStartSeconds === null || entry.timingEndSeconds === null
          ? null
          : boundedDuration(entry.timingStartSeconds, entry.timingEndSeconds),
      timingTruncated: entry.timingTruncated,
      terminalStatus: event.status,
      terminalReason: event.reason,
      terminalTimestampSource: HEARING_AUDIO_AUDIT_SOURCE,
    };
    const recordId = computeRecordId({
      schemaVersion: withoutHashes.schemaVersion,
      kind: withoutHashes.kind,
      identity: withoutHashes.identity,
      sceneActor: withoutHashes.sceneActor,
      purpose: withoutHashes.purpose,
    });
    const content = PlaybackRecordContentSchema.parse({ ...withoutHashes, recordId });
    const record = HearingAudioAuditRecordSchema.parse({
      ...content,
      contentHash: sha256Utf8(JSON.stringify(content)),
    });
    this.#pending.push(freezeRecord(record));
    this.#playbacks.delete(key);
    this.#rememberCompleted({
      kind: "playback",
      key,
      jobAlias: job,
      responseAlias: response,
      eventFingerprints: new Set(entry.eventFingerprints),
    });
    return "record_ready";
  }
}

export function createHearingAudioAuditPreparer(
  options: HearingAudioAuditPreparerOptions,
): HearingAudioAuditPreparer {
  return new HearingAudioAuditPreparer(options);
}
