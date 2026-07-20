import { HearingTrialIdSchema } from "../../domain/hearing-runtime";

import {
  HEARING_AUDIO_AUDIT_MAX_EPOCH_MS,
  HEARING_AUDIO_AUDIT_MAX_PENDING_RECORDS,
  HearingAudioAuditIngestRequestSchema,
  HearingAudioAuditPersistResultSchema,
  createHearingAudioAuditPreparer,
  type HearingAudioAuditClock,
  type HearingAudioAuditConsumeDisposition,
  type HearingAudioAuditRecord,
} from "./hearing-audio-audit";
import type { HearingPerformanceEvent } from "./hearing-performance";

export const HEARING_AUDIO_AUDIT_SINK_DIAGNOSTIC_SCHEMA_VERSION =
  "hearing-audio-audit-sink-diagnostic.v1" as const;
export const HEARING_AUDIO_AUDIT_SINK_MAX_QUEUE_RECORDS =
  HEARING_AUDIO_AUDIT_MAX_PENDING_RECORDS;
export const HEARING_AUDIO_AUDIT_SINK_MAX_RETRY_DELAYS = 5;
export const HEARING_AUDIO_AUDIT_SINK_MAX_RETRY_DELAY_MS = 30_000;

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([
  250,
  1_000,
  4_000,
  16_000,
  30_000,
]);

export type HearingAudioAuditSinkStatus =
  | "active"
  | "sending"
  | "retry_wait"
  | "disabled"
  | "closing"
  | "closed";

export type HearingAudioAuditSinkDiagnosticCode =
  | "none"
  | "event_rejected"
  | "identity_conflict"
  | "observation_capacity_exceeded"
  | "queue_capacity_exceeded"
  | "serialization_failed"
  | "network_retry_scheduled"
  | "server_retry_scheduled"
  | "retry_exhausted"
  | "request_rejected"
  | "response_invalid"
  | "receipt_mismatch";

/** Deliberately contains no trial, record, actor, transcript, or provider IDs. */
export type HearingAudioAuditSinkSnapshot = Readonly<{
  schemaVersion: typeof HEARING_AUDIO_AUDIT_SINK_DIAGNOSTIC_SCHEMA_VERSION;
  status: HearingAudioAuditSinkStatus;
  queueDepth: number;
  inFlight: boolean;
  attempt: number;
  lastDiagnosticCode: HearingAudioAuditSinkDiagnosticCode;
}>;

export type HearingAudioAuditSinkObserveDisposition =
  | HearingAudioAuditConsumeDisposition
  | "event_rejected"
  | "disabled"
  | "closed";

export type HearingAudioAuditSinkScheduler = Readonly<{
  schedule(callback: () => void, delayMs: number): () => void;
}>;

export type HearingAudioAuditSinkFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type HearingAudioAuditSinkOptions = Readonly<{
  trialId: string;
  fetch?: HearingAudioAuditSinkFetch;
  epochSource?: () => number;
  scheduler?: HearingAudioAuditSinkScheduler;
  retryDelaysMs?: readonly number[];
  random?: () => number;
  maxQueueRecords?: number;
  onDiagnostic?: (snapshot: HearingAudioAuditSinkSnapshot) => void;
}>;

type QueueEntry = {
  readonly record: HearingAudioAuditRecord;
  readonly body: string;
  attempts: number;
};

type AttemptOutcome =
  | Readonly<{ kind: "accepted" }>
  | Readonly<{
      kind: "retryable";
      diagnostic: "network_retry_scheduled" | "server_retry_scheduled";
    }>
  | Readonly<{
      kind: "permanent";
      diagnostic:
        | "request_rejected"
        | "response_invalid"
        | "receipt_mismatch";
    }>;

function readBrowserEpochMs(): number {
  const browserPerformance = globalThis.performance;
  if (
    browserPerformance !== undefined &&
    Number.isFinite(browserPerformance.timeOrigin)
  ) {
    const monotonicNow = browserPerformance.now();
    if (Number.isFinite(monotonicNow)) {
      return browserPerformance.timeOrigin + monotonicNow;
    }
  }
  return Date.now();
}

function normalizeEpochMs(candidate: number, fallback: number): number {
  const finiteCandidate = Number.isFinite(candidate) ? candidate : fallback;
  return Math.min(
    HEARING_AUDIO_AUDIT_MAX_EPOCH_MS,
    Math.max(0, Math.round(finiteCandidate)),
  );
}

/**
 * Convert an epoch-like source into the monotonic integer clock required by
 * the audit preparer. Wall-clock corrections can never make a later event
 * predate an earlier observation.
 */
export function createMonotonicEpochClock(
  source: () => number = readBrowserEpochMs,
): HearingAudioAuditClock {
  let lastEpochMs: number | null = null;
  return Object.freeze({
    nowEpochMs: (): number => {
      let candidate: number;
      try {
        candidate = source();
      } catch {
        candidate = lastEpochMs ?? Date.now();
      }
      const normalized = normalizeEpochMs(
        candidate,
        lastEpochMs ?? normalizeEpochMs(Date.now(), 0),
      );
      lastEpochMs =
        lastEpochMs === null ? normalized : Math.max(lastEpochMs, normalized);
      return lastEpochMs;
    },
  });
}

const DEFAULT_SCHEDULER: HearingAudioAuditSinkScheduler = Object.freeze({
  schedule(callback: () => void, delayMs: number): () => void {
    const handle = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(handle);
  },
});

function requireQueueBound(value: number | undefined): number {
  const resolved = value ?? HEARING_AUDIO_AUDIT_SINK_MAX_QUEUE_RECORDS;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > HEARING_AUDIO_AUDIT_SINK_MAX_QUEUE_RECORDS
  ) {
    throw new RangeError(
      `Audio audit queue bound must be an integer from 1 to ${HEARING_AUDIO_AUDIT_SINK_MAX_QUEUE_RECORDS}`,
    );
  }
  return resolved;
}

function requireRetryDelays(input: readonly number[] | undefined): readonly number[] {
  const delays = input ?? DEFAULT_RETRY_DELAYS_MS;
  if (delays.length > HEARING_AUDIO_AUDIT_SINK_MAX_RETRY_DELAYS) {
    throw new RangeError(
      `Audio audit retry schedule cannot exceed ${HEARING_AUDIO_AUDIT_SINK_MAX_RETRY_DELAYS} delays`,
    );
  }
  for (const delay of delays) {
    if (
      !Number.isSafeInteger(delay) ||
      delay < 1 ||
      delay > HEARING_AUDIO_AUDIT_SINK_MAX_RETRY_DELAY_MS
    ) {
      throw new RangeError(
        `Audio audit retry delays must be integers from 1 to ${HEARING_AUDIO_AUDIT_SINK_MAX_RETRY_DELAY_MS}`,
      );
    }
  }
  return Object.freeze([...delays]);
}

function retryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}

/**
 * Trial-pinned, metadata-only delivery for prepared browser audio audits.
 * Observation never throws and persistence never owns courtroom behavior.
 */
export class HearingAudioAuditSink {
  readonly #trialId: string;
  readonly #endpoint: string;
  readonly #fetch: HearingAudioAuditSinkFetch;
  readonly #scheduler: HearingAudioAuditSinkScheduler;
  readonly #retryDelaysMs: readonly number[];
  readonly #random: () => number;
  readonly #maxQueueRecords: number;
  readonly #onDiagnostic: HearingAudioAuditSinkOptions["onDiagnostic"];
  readonly #preparer;
  #queue: QueueEntry[] = [];
  #accepting = true;
  #networkEnabled = true;
  #inFlight = false;
  #retryCancellation: (() => void) | null = null;
  #lastDiagnosticCode: HearingAudioAuditSinkDiagnosticCode = "none";
  #closing = false;
  #closed = false;
  #closeRetryUsed = false;
  #closePromise: Promise<void> | null = null;
  #resolveClose: (() => void) | null = null;

  constructor(options: HearingAudioAuditSinkOptions) {
    this.#trialId = HearingTrialIdSchema.parse(options.trialId);
    this.#endpoint = `/api/hearings/${encodeURIComponent(this.#trialId)}/audio-audits`;
    this.#fetch =
      options.fetch ??
      ((input, init) => globalThis.fetch(input, init));
    this.#scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.#retryDelaysMs = requireRetryDelays(options.retryDelaysMs);
    this.#random = options.random ?? Math.random;
    this.#maxQueueRecords = requireQueueBound(options.maxQueueRecords);
    this.#onDiagnostic = options.onDiagnostic;
    this.#preparer = createHearingAudioAuditPreparer({
      clock: createMonotonicEpochClock(options.epochSource),
    });
  }

  get trialId(): string {
    return this.#trialId;
  }

  get snapshot(): HearingAudioAuditSinkSnapshot {
    return Object.freeze({
      schemaVersion: HEARING_AUDIO_AUDIT_SINK_DIAGNOSTIC_SCHEMA_VERSION,
      status: this.#status(),
      queueDepth: this.#queue.length,
      inFlight: this.#inFlight,
      attempt: this.#queue[0]?.attempts ?? 0,
      lastDiagnosticCode: this.#lastDiagnosticCode,
    });
  }

  observe(
    event: HearingPerformanceEvent,
  ): HearingAudioAuditSinkObserveDisposition {
    if (this.#closing || this.#closed) return "closed";
    if (!this.#accepting) return "disabled";

    let disposition: HearingAudioAuditConsumeDisposition;
    try {
      disposition = this.#preparer.consume(event);
    } catch {
      this.#setDiagnostic("event_rejected");
      return "event_rejected";
    }

    if (disposition === "identity_conflict") {
      this.#disableInput("identity_conflict");
      return disposition;
    }
    if (disposition === "capacity_rejected") {
      this.#disableInput("observation_capacity_exceeded");
      return disposition;
    }
    if (disposition !== "record_ready") return disposition;

    let records: readonly HearingAudioAuditRecord[];
    try {
      records = this.#preparer.flush();
    } catch {
      this.#disableInput("serialization_failed");
      return "disabled";
    }
    for (const record of records) {
      if (!this.#enqueue(record)) return "capacity_rejected";
    }
    this.#kick();
    return disposition;
  }

  /** Cancel a pending backoff and immediately retry the exact queued bytes. */
  expedite(): void {
    if (this.#closed || !this.#networkEnabled) return;
    const cancel = this.#retryCancellation;
    if (cancel !== null) {
      this.#retryCancellation = null;
      try {
        cancel();
      } catch {
        // A scheduler cancellation cannot affect courtroom behavior.
      }
      this.#notify();
    }
    this.#kick();
  }

  /**
   * Stop accepting events and drain queued keepalive requests. A transient
   * close-time failure gets at most one immediate final retry.
   */
  close(): Promise<void> {
    if (this.#closePromise !== null) return this.#closePromise;
    this.#accepting = false;
    this.#closing = true;
    this.#closePromise = new Promise<void>((resolve) => {
      this.#resolveClose = resolve;
    });
    if (this.#retryCancellation !== null) {
      const cancel = this.#retryCancellation;
      this.#retryCancellation = null;
      this.#closeRetryUsed = true;
      try {
        cancel();
      } catch {
        // A scheduler cancellation cannot affect the final drain.
      }
    }
    this.#notify();
    this.#kick();
    this.#finishCloseIfSettled();
    return this.#closePromise;
  }

  #status(): HearingAudioAuditSinkStatus {
    if (this.#closed) return "closed";
    if (this.#closing) return "closing";
    if (!this.#accepting || !this.#networkEnabled) return "disabled";
    if (this.#retryCancellation !== null) return "retry_wait";
    if (this.#inFlight) return "sending";
    return "active";
  }

  #notify(): void {
    if (this.#onDiagnostic === undefined) return;
    try {
      this.#onDiagnostic(this.snapshot);
    } catch {
      // Diagnostics are strictly observational.
    }
  }

  #setDiagnostic(code: HearingAudioAuditSinkDiagnosticCode): void {
    this.#lastDiagnosticCode = code;
    this.#notify();
  }

  #disableInput(code: HearingAudioAuditSinkDiagnosticCode): void {
    this.#accepting = false;
    this.#setDiagnostic(code);
  }

  #disableNetwork(code: HearingAudioAuditSinkDiagnosticCode): void {
    this.#accepting = false;
    this.#networkEnabled = false;
    if (this.#retryCancellation !== null) {
      const cancel = this.#retryCancellation;
      this.#retryCancellation = null;
      try {
        cancel();
      } catch {
        // Network delivery is already disabled.
      }
    }
    this.#queue = [];
    this.#setDiagnostic(code);
    this.#finishCloseIfSettled();
  }

  #enqueue(record: HearingAudioAuditRecord): boolean {
    if (this.#queue.length >= this.#maxQueueRecords) {
      this.#disableInput("queue_capacity_exceeded");
      return false;
    }
    let body: string;
    try {
      HearingAudioAuditIngestRequestSchema.parse({ record });
      body = JSON.stringify({ record });
    } catch {
      this.#disableInput("serialization_failed");
      return false;
    }
    this.#queue.push({ record, body, attempts: 0 });
    this.#notify();
    return true;
  }

  #kick(): void {
    if (
      this.#inFlight ||
      this.#retryCancellation !== null ||
      !this.#networkEnabled ||
      this.#queue.length === 0
    ) {
      this.#finishCloseIfSettled();
      return;
    }
    const entry = this.#queue[0];
    if (entry === undefined) {
      this.#finishCloseIfSettled();
      return;
    }
    entry.attempts += 1;
    this.#inFlight = true;
    this.#notify();
    void this.#attempt(entry).then(
      (outcome) => {
        this.#inFlight = false;
        this.#handleOutcome(entry, outcome);
      },
      () => {
        this.#inFlight = false;
        this.#disableNetwork("response_invalid");
      },
    );
  }

  async #attempt(entry: QueueEntry): Promise<AttemptOutcome> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: entry.body,
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
      });
    } catch {
      return { kind: "retryable", diagnostic: "network_retry_scheduled" };
    }

    if (retryableStatus(response.status)) {
      return { kind: "retryable", diagnostic: "server_retry_scheduled" };
    }
    if (!response.ok) {
      return { kind: "permanent", diagnostic: "request_rejected" };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: "permanent", diagnostic: "response_invalid" };
    }
    const result = HearingAudioAuditPersistResultSchema.safeParse(payload);
    if (!result.success) {
      return { kind: "permanent", diagnostic: "response_invalid" };
    }
    if (result.data.recordId !== entry.record.recordId) {
      return { kind: "permanent", diagnostic: "receipt_mismatch" };
    }
    return { kind: "accepted" };
  }

  #handleOutcome(entry: QueueEntry, outcome: AttemptOutcome): void {
    if (this.#queue[0] !== entry) {
      this.#disableNetwork("response_invalid");
      return;
    }
    if (outcome.kind === "accepted") {
      this.#queue.shift();
      this.#notify();
      this.#kick();
      return;
    }
    if (outcome.kind === "permanent") {
      this.#disableNetwork(outcome.diagnostic);
      return;
    }

    if (this.#closing) {
      if (!this.#closeRetryUsed && entry.attempts <= this.#retryDelaysMs.length) {
        this.#closeRetryUsed = true;
        this.#setDiagnostic(outcome.diagnostic);
        this.#kick();
        return;
      }
      this.#disableNetwork("retry_exhausted");
      return;
    }

    const delayIndex = entry.attempts - 1;
    const baseDelay = this.#retryDelaysMs[delayIndex];
    if (baseDelay === undefined) {
      this.#disableNetwork("retry_exhausted");
      return;
    }
    const delayMs = this.#jitteredDelay(baseDelay);
    this.#setDiagnostic(outcome.diagnostic);
    try {
      this.#retryCancellation = this.#scheduler.schedule(() => {
        this.#retryCancellation = null;
        this.#notify();
        this.#kick();
      }, delayMs);
    } catch {
      this.#disableNetwork("retry_exhausted");
      return;
    }
    this.#notify();
  }

  #jitteredDelay(baseDelay: number): number {
    let sample = 0.5;
    try {
      const candidate = this.#random();
      if (Number.isFinite(candidate) && candidate >= 0 && candidate <= 1) {
        sample = candidate;
      }
    } catch {
      // The neutral sample preserves the bounded base delay.
    }
    return Math.min(
      HEARING_AUDIO_AUDIT_SINK_MAX_RETRY_DELAY_MS,
      Math.max(1, Math.round(baseDelay * (0.75 + sample * 0.5))),
    );
  }

  #finishCloseIfSettled(): void {
    if (
      !this.#closing ||
      this.#closed ||
      this.#inFlight ||
      this.#retryCancellation !== null ||
      (this.#networkEnabled && this.#queue.length > 0)
    ) {
      return;
    }
    this.#closed = true;
    this.#closing = false;
    const resolve = this.#resolveClose;
    this.#resolveClose = null;
    this.#notify();
    resolve?.();
  }
}

export function createHearingAudioAuditSink(
  options: HearingAudioAuditSinkOptions,
): HearingAudioAuditSink {
  return new HearingAudioAuditSink(options);
}
