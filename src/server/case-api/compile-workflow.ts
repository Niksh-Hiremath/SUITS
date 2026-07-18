import type {
  AcquireCaseCompileClaimRequest,
  AcquireCaseCompileClaimResponse,
  CaseCompileClaimIdentity,
  HeartbeatCaseCompileClaimRequest,
  ReleaseCaseCompileClaimRequest,
} from "../../../convex/caseCompileClaims";

export const CASE_COMPILE_WORKFLOW_HEARTBEAT_INTERVAL_MS = 15_000;

export type CaseCompileWorkflowStage =
  | "replay_lookup"
  | "claim_acquire"
  | "ingestion"
  | "compilation"
  | "storage"
  | "registration"
  | "heartbeat";

export type CaseCompileWorkflowFailureCategory =
  | "cancelled"
  | "invalid_input"
  | "lease_lost"
  | "unavailable"
  | "internal";

export type CaseCompileWorkflowFailureClassification = Readonly<{
  code: string;
  category: CaseCompileWorkflowFailureCategory;
  disposition: "retryable_failed" | "terminal_failed";
  registrationOutcome?: "definite_not_committed" | "unknown";
}>;

export type CaseCompileWorkflowFailureContext = Readonly<{
  stage: CaseCompileWorkflowStage;
  registrationStarted: boolean;
  requestCancelled: boolean;
  leaseLost: boolean;
}>;

export type CaseCompileClaimFence = Readonly<HeartbeatCaseCompileClaimRequest>;

export type CaseCompileHeartbeatReceipt = Readonly<{
  claimId: string;
  generation: number;
  leaseExpiresAt: number;
  heartbeatIntervalMs: number;
}>;

export type CaseCompileClaimCoordinator<TReplay> = Readonly<{
  lookupCompleted: (
    identity: Readonly<CaseCompileClaimIdentity>,
    signal?: AbortSignal,
  ) => Promise<TReplay | null>;
  acquire: (
    request: Readonly<AcquireCaseCompileClaimRequest>,
    signal: AbortSignal,
  ) => Promise<AcquireCaseCompileClaimResponse>;
  heartbeat: (
    request: CaseCompileClaimFence,
    signal: AbortSignal,
  ) => Promise<CaseCompileHeartbeatReceipt>;
  release: (request: Readonly<ReleaseCaseCompileClaimRequest>) => Promise<unknown>;
}>;

export type CaseCompileWorkflowDependencies<
  TSource,
  TIngestion,
  TCompilation,
  TStorage,
  TRegistration,
  TReplay,
> = Readonly<{
  coordinator: CaseCompileClaimCoordinator<TReplay>;
  ingest: (source: TSource, signal: AbortSignal) => Promise<TIngestion>;
  compile: (
    input: Readonly<{ source: TSource; ingestion: TIngestion }>,
    signal: AbortSignal,
  ) => Promise<TCompilation>;
  upload: (
    input: Readonly<{
      source: TSource;
      ingestion: TIngestion;
      compilation: TCompilation;
    }>,
    signal: AbortSignal,
  ) => Promise<TStorage>;
  register: (
    input: Readonly<{
      identity: Readonly<CaseCompileClaimIdentity>;
      fence: CaseCompileClaimFence;
      source: TSource;
      ingestion: TIngestion;
      compilation: TCompilation;
      storage: TStorage;
    }>,
    signal: AbortSignal,
  ) => Promise<TRegistration>;
  cleanup: (
    input: Readonly<{
      identity: Readonly<CaseCompileClaimIdentity>;
      source: TSource;
      storage: TStorage;
    }>,
  ) => Promise<unknown>;
  classifyFailure?: (
    error: unknown,
    context: CaseCompileWorkflowFailureContext,
  ) => CaseCompileWorkflowFailureClassification;
}>;

export type CaseCompileWorkflowOptions<
  TSource,
  TIngestion,
  TCompilation,
  TStorage,
  TRegistration,
  TReplay,
> = Readonly<{
  claimRequest: Readonly<AcquireCaseCompileClaimRequest>;
  source: TSource;
  signal?: AbortSignal;
  dependencies: CaseCompileWorkflowDependencies<
    TSource,
    TIngestion,
    TCompilation,
    TStorage,
    TRegistration,
    TReplay
  >;
}>;

export type CaseCompileWorkflowFailure = Readonly<{
  code: string;
  category: CaseCompileWorkflowFailureCategory;
  stage: CaseCompileWorkflowStage;
  retryable: boolean;
}>;

export type CaseCompileWorkflowFailureResult = Readonly<{
  outcome: "failed";
  error: CaseCompileWorkflowFailure;
  claim: Readonly<{ claimId: string; generation: number }> | null;
  recovery: Readonly<{
    reconciliation: "not_needed" | "miss" | "failed";
    cleanup: "not_needed" | "completed" | "failed" | "retained_unknown";
    release: "not_acquired" | "not_needed" | "completed" | "failed";
  }>;
}>;

export type CaseCompileWorkflowResult<
  TSource,
  TIngestion,
  TCompilation,
  TStorage,
  TRegistration,
  TReplay,
> =
  | Readonly<{
      outcome: "compiled";
      source: TSource;
      ingestion: TIngestion;
      compilation: TCompilation;
      storage: TStorage;
      registration: TRegistration;
      claim: Readonly<{ claimId: string; generation: number }>;
    }>
  | Readonly<{
      outcome: "replayed";
      source: "preflight" | "completed_claim" | "registration_reconciled";
      replay: TReplay;
    }>
  | Readonly<{
      outcome: "busy";
      claimId: string;
      retryAfterSeconds: number;
    }>
  | Readonly<{
      outcome: "quota_exceeded";
      retryAfterSeconds: number;
    }>
  | Readonly<{
      outcome: "terminal_failed";
      claimId: string;
      generation: number;
    }>
  | CaseCompileWorkflowFailureResult;

const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/u;

const FALLBACK_FAILURES: Readonly<
  Record<
    CaseCompileWorkflowStage,
    CaseCompileWorkflowFailureClassification
  >
> = {
  replay_lookup: {
    code: "CASE_REPLAY_LOOKUP_FAILED",
    category: "unavailable",
    disposition: "retryable_failed",
  },
  claim_acquire: {
    code: "CASE_COMPILE_CLAIM_FAILED",
    category: "unavailable",
    disposition: "retryable_failed",
  },
  ingestion: {
    code: "CASE_INGESTION_FAILED",
    category: "invalid_input",
    disposition: "terminal_failed",
  },
  compilation: {
    code: "CASE_COMPILATION_FAILED",
    category: "unavailable",
    disposition: "retryable_failed",
  },
  storage: {
    code: "CASE_STORAGE_FAILED",
    category: "unavailable",
    disposition: "retryable_failed",
  },
  registration: {
    code: "CASE_REGISTRATION_FAILED",
    category: "unavailable",
    disposition: "retryable_failed",
    registrationOutcome: "unknown",
  },
  heartbeat: {
    code: "CASE_COMPILE_LEASE_LOST",
    category: "lease_lost",
    disposition: "retryable_failed",
    registrationOutcome: "unknown",
  },
};

type AcquiredClaim = Extract<AcquireCaseCompileClaimResponse, { outcome: "acquired" }>;

type LeaseMonitor = Readonly<{ stop: () => void }>;

function requestIdentity(
  request: Readonly<AcquireCaseCompileClaimRequest>,
): Readonly<CaseCompileClaimIdentity> {
  return {
    ownerId: request.ownerId,
    uploadId: request.uploadId,
    caseId: request.caseId,
    contentDigest: request.contentDigest,
  };
}

function claimFence(
  identity: Readonly<CaseCompileClaimIdentity>,
  claim: AcquiredClaim,
): CaseCompileClaimFence {
  return {
    ...identity,
    claimId: claim.claimId,
    generation: claim.generation,
    leaseToken: claim.leaseToken,
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("CASE_COMPILE_ABORTED");
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function linkedAbortSignal(
  first: AbortSignal,
  second: AbortSignal,
): Readonly<{ signal: AbortSignal; dispose: () => void }> {
  const controller = new AbortController();
  const abortFromFirst = () => controller.abort(abortReason(first));
  const abortFromSecond = () => controller.abort(abortReason(second));
  if (first.aborted) abortFromFirst();
  else first.addEventListener("abort", abortFromFirst, { once: true });
  if (!controller.signal.aborted) {
    if (second.aborted) abortFromSecond();
    else second.addEventListener("abort", abortFromSecond, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener("abort", abortFromFirst);
      second.removeEventListener("abort", abortFromSecond);
    },
  };
}

function startLeaseMonitor(
  coordinator: Pick<CaseCompileClaimCoordinator<unknown>, "heartbeat">,
  fence: CaseCompileClaimFence,
  onLeaseLost: (error: unknown) => void,
): LeaseMonitor {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatController: AbortController | null = null;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      heartbeatController = new AbortController();
      const controller = heartbeatController;
      const heartbeat = async (): Promise<void> => {
        try {
          const receipt = await coordinator.heartbeat(fence, controller.signal);
          if (stopped) return;
          if (
            receipt.claimId !== fence.claimId ||
            receipt.generation !== fence.generation ||
            receipt.heartbeatIntervalMs !== CASE_COMPILE_WORKFLOW_HEARTBEAT_INTERVAL_MS
          ) {
            throw new Error("CASE_COMPILE_HEARTBEAT_FENCE_MISMATCH");
          }
          schedule();
        } catch (error) {
          if (!stopped) onLeaseLost(error);
        } finally {
          if (heartbeatController === controller) heartbeatController = null;
        }
      };
      void heartbeat();
    }, CASE_COMPILE_WORKFLOW_HEARTBEAT_INTERVAL_MS);
  };

  schedule();
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      heartbeatController?.abort(new Error("CASE_COMPILE_HEARTBEAT_STOPPED"));
      heartbeatController = null;
    },
  };
}

function normalizeClassification(
  error: unknown,
  context: CaseCompileWorkflowFailureContext,
  classifier:
    | CaseCompileWorkflowDependencies<unknown, unknown, unknown, unknown, unknown, unknown>["classifyFailure"]
    | undefined,
): CaseCompileWorkflowFailureClassification {
  if (context.requestCancelled) {
    return {
      code: "CASE_COMPILE_REQUEST_CANCELLED",
      category: "cancelled",
      disposition: "retryable_failed",
      registrationOutcome: context.registrationStarted ? "unknown" : undefined,
    };
  }
  if (context.leaseLost) return FALLBACK_FAILURES.heartbeat;
  if (classifier) {
    try {
      const classification = classifier(error, context);
      if (FAILURE_CODE_PATTERN.test(classification.code)) return classification;
    } catch {
      // A diagnostic classifier must never replace the bounded workflow error.
    }
  }
  return FALLBACK_FAILURES[context.stage];
}

function failureResult(
  classification: CaseCompileWorkflowFailureClassification,
  stage: CaseCompileWorkflowStage,
  claim: Readonly<{ claimId: string; generation: number }> | null,
  recovery: CaseCompileWorkflowFailureResult["recovery"],
): CaseCompileWorkflowFailureResult {
  return {
    outcome: "failed",
    error: {
      code: classification.code,
      category: classification.category,
      stage,
      retryable: classification.disposition === "retryable_failed",
    },
    claim,
    recovery,
  };
}

async function preClaimFailure(
  error: unknown,
  stage: "replay_lookup" | "claim_acquire",
  signal: AbortSignal,
  classifier:
    | CaseCompileWorkflowDependencies<unknown, unknown, unknown, unknown, unknown, unknown>["classifyFailure"]
    | undefined,
): Promise<CaseCompileWorkflowFailureResult> {
  const classification = normalizeClassification(
    error,
    {
      stage,
      registrationStarted: false,
      requestCancelled: signal.aborted,
      leaseLost: false,
    },
    classifier,
  );
  return failureResult(classification, stage, null, {
    reconciliation: "not_needed",
    cleanup: "not_needed",
    release: "not_acquired",
  });
}

/**
 * Runs one retry-safe compile attempt without importing an HTTP or framework API.
 * The registration adapter must commit the draft and complete `fence` atomically.
 */
export async function runCaseCompileWorkflow<
  TSource,
  TIngestion,
  TCompilation,
  TStorage,
  TRegistration,
  TReplay,
>(
  options: CaseCompileWorkflowOptions<
    TSource,
    TIngestion,
    TCompilation,
    TStorage,
    TRegistration,
    TReplay
  >,
): Promise<
  CaseCompileWorkflowResult<
    TSource,
    TIngestion,
    TCompilation,
    TStorage,
    TRegistration,
    TReplay
  >
> {
  const { claimRequest, source, dependencies } = options;
  const requestSignal = options.signal ?? new AbortController().signal;
  const identity = requestIdentity(claimRequest);

  try {
    assertActive(requestSignal);
    const replay = await dependencies.coordinator.lookupCompleted(identity, requestSignal);
    if (replay !== null) return { outcome: "replayed", source: "preflight", replay };
    assertActive(requestSignal);
  } catch (error) {
    return preClaimFailure(error, "replay_lookup", requestSignal, dependencies.classifyFailure);
  }

  let decision: AcquireCaseCompileClaimResponse;
  try {
    decision = await dependencies.coordinator.acquire(claimRequest, requestSignal);
    if (
      decision.outcome === "acquired" &&
      (
        decision.leaseToken !== claimRequest.leaseToken ||
        decision.heartbeatIntervalMs !== CASE_COMPILE_WORKFLOW_HEARTBEAT_INTERVAL_MS
      )
    ) {
      throw new Error("CASE_COMPILE_CLAIM_RESPONSE_MISMATCH");
    }
    if (
      decision.outcome === "completed" &&
      (decision.uploadId !== identity.uploadId || decision.caseId !== identity.caseId)
    ) {
      throw new Error("CASE_COMPILE_CLAIM_RESPONSE_MISMATCH");
    }
    assertActive(requestSignal);
  } catch (error) {
    return preClaimFailure(error, "claim_acquire", requestSignal, dependencies.classifyFailure);
  }

  if (decision.outcome === "busy") {
    return {
      outcome: "busy",
      claimId: decision.claimId,
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }
  if (decision.outcome === "quota_exceeded") {
    return { outcome: "quota_exceeded", retryAfterSeconds: decision.retryAfterSeconds };
  }
  if (decision.outcome === "terminal_failed") {
    return {
      outcome: "terminal_failed",
      claimId: decision.claimId,
      generation: decision.generation,
    };
  }
  if (decision.outcome === "completed") {
    try {
      const replay = await dependencies.coordinator.lookupCompleted(identity, requestSignal);
      if (replay !== null) return { outcome: "replayed", source: "completed_claim", replay };
      return failureResult(FALLBACK_FAILURES.replay_lookup, "replay_lookup", {
        claimId: decision.claimId,
        generation: decision.generation,
      }, {
        reconciliation: "miss",
        cleanup: "not_needed",
        release: "not_needed",
      });
    } catch (error) {
      const classification = normalizeClassification(
        error,
        {
          stage: "replay_lookup",
          registrationStarted: false,
          requestCancelled: requestSignal.aborted,
          leaseLost: false,
        },
        dependencies.classifyFailure,
      );
      return failureResult(classification, "replay_lookup", {
        claimId: decision.claimId,
        generation: decision.generation,
      }, {
        reconciliation: "failed",
        cleanup: "not_needed",
        release: "not_needed",
      });
    }
  }

  const fence = claimFence(identity, decision);
  const claim = { claimId: fence.claimId, generation: fence.generation };
  const leaseAbort = new AbortController();
  const work = linkedAbortSignal(requestSignal, leaseAbort.signal);
  let leaseLost = false;
  let stage: CaseCompileWorkflowStage = "ingestion";
  let registrationStarted = false;
  let stored: Readonly<{ value: TStorage }> | null = null;
  const monitor = startLeaseMonitor(dependencies.coordinator, fence, (error) => {
    if (leaseLost) return;
    leaseLost = true;
    leaseAbort.abort(error);
  });

  try {
    assertActive(work.signal);
    const ingestion = await dependencies.ingest(source, work.signal);
    assertActive(work.signal);

    stage = "compilation";
    const compilation = await dependencies.compile({ source, ingestion }, work.signal);
    assertActive(work.signal);

    stage = "storage";
    const storage = await dependencies.upload({ source, ingestion, compilation }, work.signal);
    stored = { value: storage };
    assertActive(work.signal);

    stage = "registration";
    registrationStarted = true;
    const registration = await dependencies.register(
      { identity, fence, source, ingestion, compilation, storage },
      work.signal,
    );
    assertActive(work.signal);

    monitor.stop();
    work.dispose();
    return {
      outcome: "compiled",
      source,
      ingestion,
      compilation,
      storage,
      registration,
      claim,
    };
  } catch (error) {
    monitor.stop();
    work.dispose();
    const effectiveStage: CaseCompileWorkflowStage = leaseLost ? "heartbeat" : stage;
    const classification = normalizeClassification(
      error,
      {
        stage: effectiveStage,
        registrationStarted,
        requestCancelled: requestSignal.aborted && !leaseLost,
        leaseLost,
      },
      dependencies.classifyFailure,
    );
    const registrationOutcome = registrationStarted
      ? classification.registrationOutcome ?? "unknown"
      : "definite_not_committed";
    let reconciliation: CaseCompileWorkflowFailureResult["recovery"]["reconciliation"] =
      "not_needed";

    if (stored !== null && registrationStarted && registrationOutcome === "unknown") {
      try {
        const replay = await dependencies.coordinator.lookupCompleted(identity);
        if (replay !== null) {
          return { outcome: "replayed", source: "registration_reconciled", replay };
        }
        reconciliation = "miss";
      } catch {
        reconciliation = "failed";
      }
    }

    let release: CaseCompileWorkflowFailureResult["recovery"]["release"] = "completed";
    try {
      await dependencies.coordinator.release({
        ...fence,
        disposition: classification.disposition,
        failureCode: classification.code,
      });
    } catch {
      release = "failed";
    }

    if (
      stored !== null &&
      registrationStarted &&
      registrationOutcome === "unknown" &&
      reconciliation === "miss" &&
      release === "failed"
    ) {
      try {
        const replay = await dependencies.coordinator.lookupCompleted(identity);
        if (replay !== null) {
          return { outcome: "replayed", source: "registration_reconciled", replay };
        }
      } catch {
        reconciliation = "failed";
      }
    }

    let cleanup: CaseCompileWorkflowFailureResult["recovery"]["cleanup"] = "not_needed";
    if (stored !== null) {
      const cleanupIsSafe =
        registrationOutcome === "definite_not_committed" ||
        release === "completed";
      if (cleanupIsSafe) {
        try {
          await dependencies.cleanup({ identity, source, storage: stored.value });
          cleanup = "completed";
        } catch {
          cleanup = "failed";
        }
      } else {
        cleanup = "retained_unknown";
      }
    }

    return failureResult(classification, effectiveStage, claim, {
      reconciliation,
      cleanup,
      release,
    });
  }
}
