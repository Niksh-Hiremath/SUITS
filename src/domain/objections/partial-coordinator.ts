import {
  PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION,
  detectPartialObjectionCandidate,
  type PartialObjectionCandidate,
  type PartialObjectionDetectorInput,
} from "./partial-detector";

export const PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION =
  "partial-objection-coordinator.v1" as const;
export const PARTIAL_OBJECTION_ENVELOPE_SCHEMA_VERSION =
  "partial-objection-envelope.v1" as const;
export const PARTIAL_OBJECTION_METRICS_SCHEMA_VERSION =
  "partial-objection-metrics.v1" as const;
export const PARTIAL_OBJECTION_ERROR_SCHEMA_VERSION =
  "partial-objection-error.v1" as const;
export const CACHED_OBJECTION_CLIP_ID = "courtroom.objection.v1" as const;

export type PartialObjectionHead = Readonly<{
  trialId: string;
  stateVersion: number;
  lastEventId: string;
}>;

export type PartialObjectionDetectorContext = Omit<
  PartialObjectionDetectorInput,
  "schemaVersion" | "partialText" | "sttConfidence"
>;

export type OpenPartialObjectionUtterance = Readonly<{
  schemaVersion: typeof PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION;
  generation: number;
  head: PartialObjectionHead;
  utteranceId: string;
  detectorContext: PartialObjectionDetectorContext;
}>;

export type PartialTranscriptRevision = Readonly<{
  generation: number;
  head: PartialObjectionHead;
  utteranceId: string;
  revision: number;
  text: string;
  confidence: number | null;
}>;

export type FinalTranscriptRevision = Readonly<{
  generation: number;
  head: PartialObjectionHead;
  utteranceId: string;
  revision: number;
}>;

/**
 * Browser-local proposal only. A protected server boundary must derive actors,
 * rules, and the authorized ground from the owner-bound canonical trial head.
 */
export type PartialObjectionEnvelope = Readonly<{
  schemaVersion: typeof PARTIAL_OBJECTION_ENVELOPE_SCHEMA_VERSION;
  interruptId: string;
  generation: number;
  head: PartialObjectionHead;
  utteranceId: string;
  revision: number;
  candidate: PartialObjectionCandidate;
}>;

export type CachedObjectionReaction = Readonly<{
  clipId: typeof CACHED_OBJECTION_CLIP_ID;
  interruptId: string;
  generation: number;
  utteranceId: string;
  revision: number;
}>;

export type PartialObjectionCoordinatorError = Readonly<{
  schemaVersion: typeof PARTIAL_OBJECTION_ERROR_SCHEMA_VERSION;
  stage: "cached_reaction" | "model_candidate" | "model_result" | "coordinator";
  code:
    | "cached_reaction_failed"
    | "model_candidate_failed"
    | "model_result_failed"
    | "coordinator_task_failed";
  cause: unknown;
}>;

/**
 * A delivery callback must pass the exact expected head/revision to the
 * deterministic commit boundary and observe this signal for cancellable work.
 * The coordinator is not itself authorization to commit an objection.
 */
export type PartialObjectionDeliveryFence = Readonly<{
  signal: AbortSignal;
  expectedHead: PartialObjectionHead;
  expectedGeneration: number;
  expectedUtteranceId: string;
  expectedRevision: number;
  isCurrent: () => boolean;
}>;

export type PartialObjectionMetrics = Readonly<{
  schemaVersion: typeof PARTIAL_OBJECTION_METRICS_SCHEMA_VERSION;
  utterancesOpened: number;
  partialsReceived: number;
  partialsAccepted: number;
  nonCandidates: number;
  candidatesDetected: number;
  duplicateCandidates: number;
  staleRevisions: number;
  wrongUtterances: number;
  staleGenerations: number;
  staleHeadsIgnored: number;
  headMismatches: number;
  afterFinal: number;
  afterClose: number;
  reactionsStarted: number;
  reactionFailures: number;
  reactionsAborted: number;
  finalCandidatesSealed: number;
  sealedRetriesStarted: number;
  sealedRetryLimitReached: number;
  candidatePipelinesAborted: number;
  modelRequestsStarted: number;
  modelRequestsCompleted: number;
  modelRequestsAborted: number;
  modelRequestFailures: number;
  staleResultsFenced: number;
  resultsDelivered: number;
  resultDeliveryFailures: number;
  errorHandlerFailures: number;
  coordinatorTaskFailures: number;
  lastReactionDispatchLatencyMs: number | null;
  maximumReactionDispatchLatencyMs: number | null;
  lastModelLatencyMs: number | null;
  maximumModelLatencyMs: number | null;
}>;

export type PartialRevisionDisposition =
  | "candidate_started"
  | "duplicate_candidate"
  | "non_candidate"
  | "stale_revision"
  | "stale_generation"
  | "wrong_utterance"
  | "head_mismatch"
  | "after_final"
  | "closed"
  | "no_active_utterance";

export type PartialRevisionResult = Readonly<{
  disposition: PartialRevisionDisposition;
  envelope: PartialObjectionEnvelope | null;
}>;

export type PartialObjectionCoordinatorOptions<ModelResult> = Readonly<{
  requestModelCandidate: (
    envelope: PartialObjectionEnvelope,
    signal: AbortSignal,
  ) => Promise<ModelResult>;
  onCachedReaction: (
    reaction: CachedObjectionReaction,
    signal: AbortSignal,
  ) => void | Promise<void>;
  onModelResult: (
    envelope: PartialObjectionEnvelope,
    result: ModelResult,
    fence: PartialObjectionDeliveryFence,
  ) => void | Promise<void>;
  onError: (error: PartialObjectionCoordinatorError) => void;
  now?: () => number;
  detectCandidate?: typeof detectPartialObjectionCandidate;
  modelDispatch?: "immediate" | "after_final_seal";
}>;

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableMetrics = Mutable<Omit<PartialObjectionMetrics, "schemaVersion">>;

type InFlight = {
  readonly key: string;
  readonly envelope: PartialObjectionEnvelope;
  readonly controller: AbortController;
  requestStarted: boolean;
  deliveryStarted: boolean;
  authorizedRevision: number;
};

type DeferredVoid = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}>;

type SealedCandidateRecovery = {
  readonly key: string;
  readonly envelope: PartialObjectionEnvelope;
  readonly authorizedRevision: number;
  retryCount: number;
};

type ActiveUtterance = {
  readonly config: OpenPartialObjectionUtterance;
  lastRevision: number;
  final: boolean;
  retainCandidateAfterFinal: boolean;
  reactionPlayed: boolean;
  reactionComplete: boolean;
  readonly reactionController: AbortController;
  reactionTask: Promise<void> | null;
  readonly finalSealReady: DeferredVoid;
  sealedCandidateRecovery: SealedCandidateRecovery | null;
  currentCandidateKey: string | null;
  readonly submittedCandidateKeys: Set<string>;
  inFlight: InFlight | null;
};

const initialMetrics = (): MutableMetrics => ({
  utterancesOpened: 0,
  partialsReceived: 0,
  partialsAccepted: 0,
  nonCandidates: 0,
  candidatesDetected: 0,
  duplicateCandidates: 0,
  staleRevisions: 0,
  wrongUtterances: 0,
  staleGenerations: 0,
  staleHeadsIgnored: 0,
  headMismatches: 0,
  afterFinal: 0,
  afterClose: 0,
  reactionsStarted: 0,
  reactionFailures: 0,
  reactionsAborted: 0,
  finalCandidatesSealed: 0,
  sealedRetriesStarted: 0,
  sealedRetryLimitReached: 0,
  candidatePipelinesAborted: 0,
  modelRequestsStarted: 0,
  modelRequestsCompleted: 0,
  modelRequestsAborted: 0,
  modelRequestFailures: 0,
  staleResultsFenced: 0,
  resultsDelivered: 0,
  resultDeliveryFailures: 0,
  errorHandlerFailures: 0,
  coordinatorTaskFailures: 0,
  lastReactionDispatchLatencyMs: null,
  maximumReactionDispatchLatencyMs: null,
  lastModelLatencyMs: null,
  maximumModelLatencyMs: null,
});

function sameHead(
  left: PartialObjectionHead,
  right: PartialObjectionHead,
): boolean {
  return (
    left.trialId === right.trialId &&
    left.stateVersion === right.stateVersion &&
    left.lastEventId === right.lastEventId
  );
}

function headCanAdvanceFrom(
  candidate: PartialObjectionHead,
  highWater: PartialObjectionHead,
): boolean {
  return (
    candidate.trialId === highWater.trialId &&
    (candidate.stateVersion > highWater.stateVersion ||
      (candidate.stateVersion === highWater.stateVersion &&
        candidate.lastEventId === highWater.lastEventId))
  );
}

function candidateKey(candidate: PartialObjectionCandidate): string {
  return `${candidate.ground}\u0000${candidate.signal}\u0000${candidate.normalizedText}`;
}

function validIdentifier(value: string): boolean {
  return value.trim().length > 0 && value.length <= 240;
}

function validHead(head: PartialObjectionHead): boolean {
  return (
    validIdentifier(head.trialId) &&
    Number.isSafeInteger(head.stateVersion) &&
    head.stateVersion >= 0 &&
    validIdentifier(head.lastEventId)
  );
}

function validGeneration(generation: number): boolean {
  return Number.isSafeInteger(generation) && generation > 0;
}

function validDetectorContext(
  context: PartialObjectionDetectorContext,
): boolean {
  return (
    Array.isArray(context.permittedGrounds) &&
    Array.isArray(context.recentQuestionTexts) &&
    context.permittedGrounds.length <= 32 &&
    context.recentQuestionTexts.length <= 32 &&
    context.recentQuestionTexts.every(
      (question) => typeof question === "string" && question.length <= 2_000,
    )
  );
}

function createDeferredVoid(): DeferredVoid {
  let settled = false;
  let complete: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => {
      if (settled || complete === null) return;
      settled = true;
      complete();
    },
  });
}

function safeDuration(startedAtMs: number, endedAtMs: number): number {
  const duration = endedAtMs - startedAtMs;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

async function waitForTaskOrAbort(
  task: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      signal.removeEventListener("abort", finish);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    void task.then(finish, finish);
  });
}

type AbortableOutcome<T> =
  Readonly<{ aborted: true }> | Readonly<{ aborted: false; value: T }>;

function settleOperationOrAbort<T>(
  task: Promise<T>,
  signal: AbortSignal,
): Promise<AbortableOutcome<T>> {
  if (signal.aborted) return Promise.resolve({ aborted: true });
  return new Promise<AbortableOutcome<T>>((resolve, reject) => {
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", abort);
      return true;
    };
    const abort = (): void => {
      if (finish()) resolve({ aborted: true });
    };
    signal.addEventListener("abort", abort, { once: true });
    void task.then(
      (value) => {
        if (finish()) resolve({ aborted: false, value });
      },
      (cause: unknown) => {
        if (finish()) reject(cause);
      },
    );
  });
}

function updateLatency(
  metrics: MutableMetrics,
  kind: "reaction" | "model",
  durationMs: number,
): void {
  if (kind === "reaction") {
    metrics.lastReactionDispatchLatencyMs = durationMs;
    metrics.maximumReactionDispatchLatencyMs = Math.max(
      metrics.maximumReactionDispatchLatencyMs ?? 0,
      durationMs,
    );
    return;
  }
  metrics.lastModelLatencyMs = durationMs;
  metrics.maximumModelLatencyMs = Math.max(
    metrics.maximumModelLatencyMs ?? 0,
    durationMs,
  );
}

/**
 * Coordinates local partial candidates only. It neither validates nor commits
 * an objection or ruling; its result callback remains behind freshness fences
 * for a later deterministic/server boundary.
 */
export class PartialObjectionCoordinator<ModelResult> {
  private readonly options: PartialObjectionCoordinatorOptions<ModelResult>;
  private readonly now: () => number;
  private readonly detectCandidate: typeof detectPartialObjectionCandidate;
  private readonly metrics = initialMetrics();
  private readonly pending = new Set<Promise<void>>();
  private active: ActiveUtterance | null = null;
  private highestGeneration = 0;
  private canonicalHead: PartialObjectionHead | null = null;
  private closed = false;

  constructor(options: PartialObjectionCoordinatorOptions<ModelResult>) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.detectCandidate =
      options.detectCandidate ?? detectPartialObjectionCandidate;
  }

  openUtterance(config: OpenPartialObjectionUtterance): boolean {
    if (this.closed) {
      this.metrics.afterClose += 1;
      return false;
    }
    if (
      config.schemaVersion !== PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION ||
      !validGeneration(config.generation) ||
      !validHead(config.head) ||
      !validIdentifier(config.utteranceId) ||
      !validDetectorContext(config.detectorContext)
    ) {
      return false;
    }
    if (
      config.generation <= this.highestGeneration ||
      (this.canonicalHead !== null &&
        !headCanAdvanceFrom(config.head, this.canonicalHead))
    ) {
      return false;
    }
    this.highestGeneration = config.generation;
    if (
      this.canonicalHead === null ||
      config.head.stateVersion > this.canonicalHead.stateVersion
    ) {
      this.canonicalHead = Object.freeze({ ...config.head });
    }
    this.abortActive("utterance_replaced");
    this.active = {
      config: Object.freeze({
        ...config,
        head: Object.freeze({ ...config.head }),
        detectorContext: Object.freeze({
          ...config.detectorContext,
          permittedGrounds: Object.freeze([
            ...new Set(config.detectorContext.permittedGrounds),
          ]),
          recentQuestionTexts: Object.freeze([
            ...config.detectorContext.recentQuestionTexts,
          ]),
        }),
      }),
      lastRevision: 0,
      final: false,
      retainCandidateAfterFinal: false,
      reactionPlayed: false,
      reactionComplete: false,
      reactionController: new AbortController(),
      reactionTask: null,
      finalSealReady: createDeferredVoid(),
      sealedCandidateRecovery: null,
      currentCandidateKey: null,
      submittedCandidateKeys: new Set<string>(),
      inFlight: null,
    };
    this.metrics.utterancesOpened += 1;
    return true;
  }

  acceptPartial(partial: PartialTranscriptRevision): PartialRevisionResult {
    this.metrics.partialsReceived += 1;
    if (this.closed) return this.ignored("closed", "afterClose");
    const active = this.active;
    if (active === null) {
      return { disposition: "no_active_utterance", envelope: null };
    }
    if (active.final) return this.ignored("after_final", "afterFinal");
    if (partial.generation !== active.config.generation) {
      return this.ignored("stale_generation", "staleGenerations");
    }
    if (partial.utteranceId !== active.config.utteranceId) {
      return this.ignored("wrong_utterance", "wrongUtterances");
    }
    if (!sameHead(partial.head, active.config.head)) {
      this.metrics.headMismatches += 1;
      this.abortActive("head_changed");
      this.active = null;
      return { disposition: "head_mismatch", envelope: null };
    }
    if (
      !Number.isSafeInteger(partial.revision) ||
      partial.revision <= active.lastRevision
    ) {
      return this.ignored("stale_revision", "staleRevisions");
    }

    active.lastRevision = partial.revision;
    this.metrics.partialsAccepted += 1;
    const candidate = this.detectCandidate({
      schemaVersion: PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION,
      ...active.config.detectorContext,
      partialText: partial.text,
      sttConfidence: partial.confidence,
    });
    if (candidate === null) {
      this.metrics.nonCandidates += 1;
      active.currentCandidateKey = null;
      this.abortInFlight(active, "candidate_withdrawn");
      return { disposition: "non_candidate", envelope: null };
    }

    this.metrics.candidatesDetected += 1;
    const key = candidateKey(candidate);
    active.currentCandidateKey = key;
    if (active.inFlight !== null) {
      this.abortInFlight(
        active,
        active.inFlight.key === key
          ? "superseded_equivalent_revision"
          : "superseded_revision",
      );
    }
    if (active.submittedCandidateKeys.has(key)) {
      this.metrics.duplicateCandidates += 1;
      return { disposition: "duplicate_candidate", envelope: null };
    }
    const envelope = this.createEnvelope(
      active.config,
      partial.revision,
      candidate,
    );
    const controller = new AbortController();
    const inFlight: InFlight = {
      key,
      envelope,
      controller,
      requestStarted: false,
      deliveryStarted: false,
      authorizedRevision: envelope.revision,
    };
    active.submittedCandidateKeys.add(key);
    active.inFlight = inFlight;

    if (!active.reactionPlayed) {
      active.reactionPlayed = true;
      active.reactionTask = this.startCachedReaction(active, envelope);
    }
    this.track(this.runModelCandidate(active, inFlight));
    return { disposition: "candidate_started", envelope };
  }

  /**
   * Bind a final STT revision to the active partial candidate without
   * cancelling its resolver. The caller must use the final transcript as the
   * durable question and the partial only as interruption-trigger provenance.
   */
  sealFinalCandidate(finalRevision: FinalTranscriptRevision): boolean {
    if (this.closed) {
      this.metrics.afterClose += 1;
      return false;
    }
    const active = this.active;
    if (
      active === null ||
      active.final ||
      finalRevision.generation !== active.config.generation ||
      finalRevision.utteranceId !== active.config.utteranceId
    ) {
      if (active?.final) this.metrics.afterFinal += 1;
      else if (
        active !== null &&
        finalRevision.generation !== active.config.generation
      ) {
        this.metrics.staleGenerations += 1;
      } else if (active !== null) this.metrics.wrongUtterances += 1;
      return false;
    }
    if (!sameHead(finalRevision.head, active.config.head)) {
      this.metrics.headMismatches += 1;
      this.abortActive("head_changed");
      this.active = null;
      return false;
    }
    if (
      !Number.isSafeInteger(finalRevision.revision) ||
      finalRevision.revision < active.lastRevision
    ) {
      this.metrics.staleRevisions += 1;
      return false;
    }
    if (active.inFlight === null || active.currentCandidateKey === null) {
      return false;
    }
    if (active.inFlight.deliveryStarted) {
      active.lastRevision = finalRevision.revision;
      active.final = true;
      active.retainCandidateAfterFinal = false;
      active.currentCandidateKey = null;
      this.abortActive("final_seal_conflict");
      return false;
    }
    active.lastRevision = finalRevision.revision;
    active.final = true;
    active.retainCandidateAfterFinal = true;
    active.inFlight.authorizedRevision = finalRevision.revision;
    active.sealedCandidateRecovery = {
      key: active.inFlight.key,
      envelope: active.inFlight.envelope,
      authorizedRevision: finalRevision.revision,
      retryCount: 0,
    };
    active.finalSealReady.resolve();
    this.metrics.finalCandidatesSealed += 1;
    return true;
  }

  /** Retry one sealed candidate after a transient request/delivery failure. */
  retrySealedCandidate(): boolean {
    if (this.closed) {
      this.metrics.afterClose += 1;
      return false;
    }
    const active = this.active;
    const recovery = active?.sealedCandidateRecovery ?? null;
    if (
      active === null ||
      !active.final ||
      !active.retainCandidateAfterFinal ||
      active.inFlight !== null ||
      recovery === null
    ) {
      return false;
    }
    if (recovery.retryCount >= 1) {
      this.metrics.sealedRetryLimitReached += 1;
      return false;
    }
    recovery.retryCount += 1;
    const inFlight: InFlight = {
      key: recovery.key,
      envelope: recovery.envelope,
      controller: new AbortController(),
      requestStarted: false,
      deliveryStarted: false,
      authorizedRevision: recovery.authorizedRevision,
    };
    active.currentCandidateKey = recovery.key;
    active.submittedCandidateKeys.add(recovery.key);
    active.inFlight = inFlight;
    this.metrics.sealedRetriesStarted += 1;
    this.track(this.runModelCandidate(active, inFlight));
    return true;
  }

  finalize(finalRevision: FinalTranscriptRevision): boolean {
    if (this.closed) {
      this.metrics.afterClose += 1;
      return false;
    }
    const active = this.active;
    if (
      active === null ||
      active.final ||
      finalRevision.generation !== active.config.generation ||
      finalRevision.utteranceId !== active.config.utteranceId
    ) {
      if (active?.final) this.metrics.afterFinal += 1;
      else if (
        active !== null &&
        finalRevision.generation !== active.config.generation
      ) {
        this.metrics.staleGenerations += 1;
      } else if (active !== null) this.metrics.wrongUtterances += 1;
      return false;
    }
    if (!sameHead(finalRevision.head, active.config.head)) {
      this.metrics.headMismatches += 1;
      this.abortActive("head_changed");
      this.active = null;
      return false;
    }
    if (
      !Number.isSafeInteger(finalRevision.revision) ||
      finalRevision.revision < active.lastRevision
    ) {
      this.metrics.staleRevisions += 1;
      return false;
    }
    active.lastRevision = finalRevision.revision;
    active.final = true;
    active.retainCandidateAfterFinal = false;
    active.currentCandidateKey = null;
    this.abortActive("final_transcript");
    return true;
  }

  invalidateHead(currentHead: PartialObjectionHead): boolean {
    if (!validHead(currentHead)) return false;
    const highWater = this.canonicalHead;
    if (highWater !== null && sameHead(highWater, currentHead)) {
      return false;
    }
    if (
      highWater !== null &&
      highWater.trialId === currentHead.trialId &&
      currentHead.stateVersion < highWater.stateVersion
    ) {
      this.metrics.staleHeadsIgnored += 1;
      return false;
    }
    if (highWater === null || headCanAdvanceFrom(currentHead, highWater)) {
      this.canonicalHead = Object.freeze({ ...currentHead });
    }
    if (this.active === null) return false;
    if (sameHead(this.active.config.head, currentHead)) return false;
    this.metrics.headMismatches += 1;
    this.abortActive("head_changed");
    this.active = null;
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abortActive("coordinator_closed");
    this.active = null;
  }

  getMetrics(): PartialObjectionMetrics {
    return Object.freeze({
      schemaVersion: PARTIAL_OBJECTION_METRICS_SCHEMA_VERSION,
      ...this.metrics,
    });
  }

  async waitForIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  private ignored<K extends keyof MutableMetrics>(
    disposition: PartialRevisionDisposition,
    metric: K,
  ): PartialRevisionResult {
    const value = this.metrics[metric];
    if (typeof value === "number") {
      (this.metrics[metric] as number) = value + 1;
    }
    return { disposition, envelope: null };
  }

  private createEnvelope(
    config: OpenPartialObjectionUtterance,
    revision: number,
    candidate: PartialObjectionCandidate,
  ): PartialObjectionEnvelope {
    return Object.freeze({
      schemaVersion: PARTIAL_OBJECTION_ENVELOPE_SCHEMA_VERSION,
      interruptId: `interrupt:partial:${config.generation}:${config.utteranceId}:${revision}`,
      generation: config.generation,
      head: config.head,
      utteranceId: config.utteranceId,
      revision,
      candidate,
    });
  }

  private abortActive(reason: string): void {
    if (this.active === null) return;
    this.abortInFlight(this.active, reason);
    if (
      this.active.reactionPlayed &&
      !this.active.reactionComplete &&
      !this.active.reactionController.signal.aborted
    ) {
      this.metrics.reactionsAborted += 1;
      this.active.reactionController.abort(reason);
    }
  }

  private abortInFlight(active: ActiveUtterance, reason: string): void {
    const inFlight = active.inFlight;
    if (inFlight === null) return;
    active.inFlight = null;
    active.submittedCandidateKeys.delete(inFlight.key);
    if (!inFlight.controller.signal.aborted) {
      this.metrics.candidatePipelinesAborted += 1;
      if (inFlight.requestStarted) this.metrics.modelRequestsAborted += 1;
      inFlight.controller.abort(reason);
    }
  }

  private isCurrent(active: ActiveUtterance, inFlight: InFlight): boolean {
    return (
      !this.closed &&
      this.active === active &&
      (!active.final || active.retainCandidateAfterFinal) &&
      active.inFlight === inFlight &&
      active.currentCandidateKey === inFlight.key &&
      active.lastRevision === inFlight.authorizedRevision &&
      sameHead(active.config.head, inFlight.envelope.head) &&
      !inFlight.controller.signal.aborted
    );
  }

  private startCachedReaction(
    active: ActiveUtterance,
    envelope: PartialObjectionEnvelope,
  ): Promise<void> {
    const reactionStartedAtMs = this.now();
    this.metrics.reactionsStarted += 1;
    try {
      const outcome = this.options.onCachedReaction(
        {
          clipId: CACHED_OBJECTION_CLIP_ID,
          interruptId: envelope.interruptId,
          generation: envelope.generation,
          utteranceId: envelope.utteranceId,
          revision: envelope.revision,
        },
        active.reactionController.signal,
      );
      if (!isPromiseLike(outcome)) {
        this.finishCachedReaction(active, reactionStartedAtMs);
        return Promise.resolve();
      }
      return Promise.resolve(outcome).then(
        () => this.finishCachedReaction(active, reactionStartedAtMs),
        (cause: unknown) => {
          if (!active.reactionController.signal.aborted) {
            this.failCachedReaction(cause);
          }
          this.finishCachedReaction(active, reactionStartedAtMs);
        },
      );
    } catch (cause) {
      this.failCachedReaction(cause);
      this.finishCachedReaction(active, reactionStartedAtMs);
      return Promise.resolve();
    }
  }

  private failCachedReaction(cause: unknown): void {
    this.metrics.reactionFailures += 1;
    this.reportError({
      schemaVersion: PARTIAL_OBJECTION_ERROR_SCHEMA_VERSION,
      stage: "cached_reaction",
      code: "cached_reaction_failed",
      cause,
    });
  }

  private finishCachedReaction(
    active: ActiveUtterance,
    reactionStartedAtMs: number,
  ): void {
    active.reactionComplete = true;
    updateLatency(
      this.metrics,
      "reaction",
      safeDuration(reactionStartedAtMs, this.now()),
    );
  }

  private async runModelCandidate(
    active: ActiveUtterance,
    inFlight: InFlight,
  ): Promise<void> {
    if (!active.reactionComplete && active.reactionTask !== null) {
      await waitForTaskOrAbort(active.reactionTask, inFlight.controller.signal);
    }
    if (
      this.options.modelDispatch === "after_final_seal" &&
      !active.retainCandidateAfterFinal
    ) {
      await waitForTaskOrAbort(
        active.finalSealReady.promise,
        inFlight.controller.signal,
      );
    }
    if (!this.isCurrent(active, inFlight)) return;

    const requestStartedAtMs = this.now();
    inFlight.requestStarted = true;
    this.metrics.modelRequestsStarted += 1;
    let result: ModelResult;
    try {
      const outcome = await settleOperationOrAbort(
        this.options.requestModelCandidate(
          inFlight.envelope,
          inFlight.controller.signal,
        ),
        inFlight.controller.signal,
      );
      if (outcome.aborted) return;
      result = outcome.value;
    } catch (cause) {
      if (
        inFlight.controller.signal.aborted ||
        !this.isCurrent(active, inFlight)
      ) {
        return;
      }
      active.inFlight = null;
      active.submittedCandidateKeys.delete(inFlight.key);
      this.metrics.modelRequestFailures += 1;
      this.reportError({
        schemaVersion: PARTIAL_OBJECTION_ERROR_SCHEMA_VERSION,
        stage: "model_candidate",
        code: "model_candidate_failed",
        cause,
      });
      return;
    }

    this.metrics.modelRequestsCompleted += 1;
    updateLatency(
      this.metrics,
      "model",
      safeDuration(requestStartedAtMs, this.now()),
    );
    if (!this.isCurrent(active, inFlight)) {
      this.metrics.staleResultsFenced += 1;
      return;
    }
    inFlight.deliveryStarted = true;
    const deliveryRevision = inFlight.authorizedRevision;
    const fence = Object.freeze({
      signal: inFlight.controller.signal,
      expectedHead: inFlight.envelope.head,
      expectedGeneration: inFlight.envelope.generation,
      expectedUtteranceId: inFlight.envelope.utteranceId,
      expectedRevision: deliveryRevision,
      isCurrent: () =>
        inFlight.authorizedRevision === deliveryRevision &&
        this.isCurrent(active, inFlight),
    });
    try {
      const outcome = await settleOperationOrAbort(
        Promise.resolve(
          this.options.onModelResult(inFlight.envelope, result, fence),
        ),
        inFlight.controller.signal,
      );
      if (outcome.aborted) {
        this.metrics.staleResultsFenced += 1;
        return;
      }
      if (!fence.isCurrent()) {
        this.metrics.staleResultsFenced += 1;
        return;
      }
      active.inFlight = null;
      active.sealedCandidateRecovery = null;
      this.metrics.resultsDelivered += 1;
    } catch (cause) {
      if (
        inFlight.controller.signal.aborted ||
        !this.isCurrent(active, inFlight)
      ) {
        this.metrics.staleResultsFenced += 1;
        return;
      }
      active.inFlight = null;
      active.submittedCandidateKeys.delete(inFlight.key);
      this.metrics.resultDeliveryFailures += 1;
      this.reportError({
        schemaVersion: PARTIAL_OBJECTION_ERROR_SCHEMA_VERSION,
        stage: "model_result",
        code: "model_result_failed",
        cause,
      });
    }
  }

  private reportError(error: PartialObjectionCoordinatorError): void {
    try {
      this.options.onError(error);
    } catch {
      this.metrics.errorHandlerFailures += 1;
    }
  }

  private track(task: Promise<void>): void {
    const guarded = task.catch((cause: unknown) => {
      this.metrics.coordinatorTaskFailures += 1;
      this.reportError({
        schemaVersion: PARTIAL_OBJECTION_ERROR_SCHEMA_VERSION,
        stage: "coordinator",
        code: "coordinator_task_failed",
        cause,
      });
    });
    this.pending.add(guarded);
    void guarded.then(() => this.pending.delete(guarded));
  }
}
