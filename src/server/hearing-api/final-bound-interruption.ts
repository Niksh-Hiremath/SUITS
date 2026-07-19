import {
  isHearingObjectionRulingModelRequiredPreparation,
  isHearingWitnessModelRequiredPreparation,
  type HearingCommandPreparation,
} from "@/domain/hearing-runtime";
import {
  FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
  FinalBoundInterruptionResolutionSchema,
  FinalBoundInterruptionResponseSchema,
  type FinalBoundInterruptionRequest,
  type FinalBoundInterruptionResolution,
  type FinalBoundInterruptionResponse,
} from "@/domain/objections/final-bound-contracts";
import {
  FINAL_BOUND_INTERRUPTION_LEASE_CLOCK_SKEW_MS,
  FINAL_BOUND_INTERRUPTION_LEASE_DURATION_MS,
} from "@/domain/objections/final-bound-lease";
import {
  HearingFinalBoundInterruptionClaimResultSchema,
  HearingFinalBoundInterruptionLeaseCredentialSchema,
  HearingFinalBoundInterruptionLeaseUpdateResultSchema,
  HearingFinalBoundInterruptionOutcomeSchema,
  HearingFinalBoundInterruptionPreparationSchema,
  HearingFinalBoundInterruptionRecoveryPreparationSchema,
  assertFinalBoundInterruptionPreparationMatchesRequest,
  assertFinalBoundInterruptionRecoveryPreparation,
  assertFinalBoundInterruptionScopedPreparation,
  type HearingFinalBoundInterruptionLeaseCredential,
  type HearingFinalBoundInterruptionRecoveryPreparation,
  type HearingFinalBoundInterruptionScopeMetadata,
} from "@/domain/objections/final-bound-persistence";
import {
  ConvexCaseServiceError,
  callConvexCaseService,
} from "@/server/case-api";
import {
  EnvironmentCourtroomModelProvider,
  type CourtroomModelProvider,
} from "@/server/courtroom-ai";

import {
  orchestratePreparedCourtroomCommandResult,
  type CourtroomCommandDurableService,
} from "./courtroom-command";
import { createCourtroomCommandDurableService } from "./durable-service";

const CLAIM_RENEWAL_LEAD_MS = 10_000;
const CLAIM_RENEWAL_EXPIRY_BUFFER_MS = 1_000;
const CLAIM_WAIT_TIMEOUT_MS = 60_000;
const MAX_CLAIM_WAIT_ATTEMPTS = 900;

type ModelRequiredPreparation = Extract<
  HearingCommandPreparation,
  Readonly<{ status: "model_required" }>
>;

type FinalBoundInterruptionDriveOptions = Readonly<{
  ownerId: string;
  trialId: string;
  interruptId?: string;
  expectedScope?: HearingFinalBoundInterruptionScopeMetadata;
  replayed: boolean;
  signal?: AbortSignal;
  provider?: CourtroomModelProvider;
}>;

type LeaseGuard = Readonly<{
  signal: AbortSignal;
  ready: Promise<void>;
  finish: () => Promise<
    Readonly<{
      failure: unknown | null;
      outcome: HearingFinalBoundInterruptionRecoveryPreparation | null;
    }>
  >;
}>;

function invalidInterruption(): never {
  throw new Error("The protected interruption result was inconsistent");
}

function assertLeaseExpiryHorizon(leaseExpiresAt: number): number {
  if (
    leaseExpiresAt >
    Date.now() +
      FINAL_BOUND_INTERRUPTION_LEASE_DURATION_MS +
      FINAL_BOUND_INTERRUPTION_LEASE_CLOCK_SKEW_MS
  ) {
    return invalidInterruption();
  }
  return leaseExpiresAt;
}

function effectiveLeaseExpiry(leaseExpiresAt: number): number {
  return (
    leaseExpiresAt - FINAL_BOUND_INTERRUPTION_LEASE_CLOCK_SKEW_MS
  );
}

function sameHead(
  left: Readonly<{
    trialId: string;
    stateVersion: number;
    lastEventId: string;
  }>,
  right: Readonly<{
    trialId: string;
    stateVersion: number;
    lastEventId: string;
  }>,
): boolean {
  return (
    left.trialId === right.trialId &&
    left.stateVersion === right.stateVersion &&
    left.lastEventId === right.lastEventId
  );
}

function assertRecoveryMatchesScope(
  recoveryInput: unknown,
  expected: HearingFinalBoundInterruptionScopeMetadata,
): HearingFinalBoundInterruptionRecoveryPreparation {
  const recovery = assertFinalBoundInterruptionRecoveryPreparation(
    HearingFinalBoundInterruptionRecoveryPreparationSchema.parse(
      recoveryInput,
    ),
  );
  const actual = recovery.interrupt;
  if (
    actual.interruptId !== expected.interruptId ||
    actual.objectionId !== expected.objectionId ||
    actual.questionId !== expected.questionId ||
    actual.responseId !== expected.responseId ||
    actual.questionEventId !== expected.questionEventId ||
    actual.objectionEventId !== expected.objectionEventId ||
    actual.interruptionEventId !== expected.interruptionEventId ||
    actual.ground !== expected.ground ||
    !sameHead(actual.sourceHead, expected.sourceHead) ||
    !sameHead(actual.committedHead, expected.committedHead)
  ) {
    return invalidInterruption();
  }
  return recovery;
}

function interruptionResponse(
  recoveryInput: unknown,
  replayed: boolean,
): FinalBoundInterruptionResponse {
  const recovery = assertFinalBoundInterruptionRecoveryPreparation(
    recoveryInput,
  );
  if (recovery.phase !== "ruling_committed" || recovery.outcome === null) {
    return invalidInterruption();
  }
  const target = recovery.interrupt.targetCompletionHead;
  const viewHead = recovery.view.trial;
  const current =
    viewHead.trialId === target.trialId &&
    viewHead.version === target.stateVersion &&
    viewHead.lastEventId === target.lastEventId;
  return FinalBoundInterruptionResponseSchema.parse({
    schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
    disposition: "ruling_committed",
    interruptId: recovery.interrupt.interruptId,
    ruling: recovery.outcome.ruling,
    remedy: recovery.outcome.remedy,
    replayed,
    targetCompletionHead: target,
    continuation: recovery.continuation,
    performance: {
      disposition: current ? "current" : "historical",
      answerTurnId:
        current &&
        recovery.continuation === "complete" &&
        recovery.outcome.ruling === "overruled"
          ? recovery.interrupt.answerTurnId
          : null,
    },
    view: recovery.view,
  });
}

function waitForClaimRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Request aborted"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function claimFinalBoundInterruption(
  options: FinalBoundInterruptionDriveOptions,
) {
  const deadline = Date.now() + CLAIM_WAIT_TIMEOUT_MS;
  for (let attempt = 0; attempt < MAX_CLAIM_WAIT_ATTEMPTS; attempt += 1) {
    const claimBudgetMs = deadline - Date.now();
    if (claimBudgetMs <= 0) break;
    const claim = HearingFinalBoundInterruptionClaimResultSchema.parse(
      await callConvexCaseService({
        path: "/service/hearings/interruption/claim",
        body: {
          ownerId: options.ownerId,
          trialId: options.trialId,
          ...(options.interruptId === undefined
            ? {}
            : { interruptId: options.interruptId }),
        },
        responseSchema: HearingFinalBoundInterruptionClaimResultSchema,
        timeoutMs: Math.min(30_000, claimBudgetMs),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
    if (
      options.interruptId !== undefined &&
      claim.interruptId !== options.interruptId
    ) {
      return invalidInterruption();
    }
    if (
      claim.status !== "wait" &&
      claim.recovery.interrupt.interruptId !== claim.interruptId
    ) {
      return invalidInterruption();
    }
    if (
      claim.status === "claimed" &&
      claim.recovery.interrupt.decisionId !== claim.decisionId
    ) {
      return invalidInterruption();
    }
    if (claim.status === "outcome") return claim;
    if (claim.status === "claimed") {
      try {
        assertLeaseExpiryHorizon(claim.leaseExpiresAt);
      } catch (error) {
        await releaseClaim(options, leaseCredential(claim));
        throw error;
      }
      if (Date.now() < deadline) return claim;
      await releaseClaim(options, leaseCredential(claim));
      break;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await waitForClaimRetry(
      Math.min(claim.retryAfterMs, remainingMs),
      options.signal,
    );
  }
  throw new ConvexCaseServiceError("HEARING_INTERRUPTION_BUSY", 503);
}

function leaseCredential(
  claim: Extract<
    ReturnType<typeof HearingFinalBoundInterruptionClaimResultSchema.parse>,
    Readonly<{ status: "claimed" }>
  >,
): HearingFinalBoundInterruptionLeaseCredential {
  return HearingFinalBoundInterruptionLeaseCredentialSchema.parse({
    decisionId: claim.decisionId,
    interruptId: claim.interruptId,
    leaseGeneration: claim.leaseGeneration,
    leaseToken: claim.leaseToken,
  });
}

function startLeaseGuard(
  options: FinalBoundInterruptionDriveOptions,
  credential: HearingFinalBoundInterruptionLeaseCredential,
  initialLeaseExpiresAt: number,
): LeaseGuard {
  const controller = new AbortController();
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal]);
  let stopped = false;
  let failure: unknown | null = null;
  let outcome: HearingFinalBoundInterruptionRecoveryPreparation | null = null;
  let leaseExpiresAt = assertLeaseExpiryHorizon(initialLeaseExpiresAt);
  let readySettled = false;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((reason: unknown) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const markReady = (): void => {
    if (readySettled) return;
    readySettled = true;
    resolveReady?.();
  };
  const failReady = (error: unknown): void => {
    if (readySettled) return;
    readySettled = true;
    rejectReady?.(error);
  };
  const renewal = (async (): Promise<void> => {
    try {
      if (signal.aborted) {
        throw signal.reason ?? new Error("Interruption lease guard cancelled");
      }
      while (!stopped && !signal.aborted) {
        const renewalDelayMs =
          effectiveLeaseExpiry(leaseExpiresAt) -
          Date.now() -
          CLAIM_RENEWAL_LEAD_MS;
        if (renewalDelayMs > 0) {
          markReady();
          await waitForClaimRetry(renewalDelayMs, signal);
        }
        if (stopped || signal.aborted) return;
        const renewalTimeoutMs = Math.floor(
          effectiveLeaseExpiry(leaseExpiresAt) -
            Date.now() -
            CLAIM_RENEWAL_EXPIRY_BUFFER_MS,
        );
        if (renewalTimeoutMs < 1) {
          throw new ConvexCaseServiceError(
            "HEARING_INTERRUPTION_BUSY",
            503,
          );
        }
        const previousLeaseExpiresAt = leaseExpiresAt;
        const update = HearingFinalBoundInterruptionLeaseUpdateResultSchema.parse(
          await callConvexCaseService({
            path: "/service/hearings/interruption/claim/renew",
            body: {
              ownerId: options.ownerId,
              trialId: options.trialId,
              credential,
            },
            responseSchema:
              HearingFinalBoundInterruptionLeaseUpdateResultSchema,
            timeoutMs: renewalTimeoutMs,
            signal,
          }),
        );
        if (update.status === "outcome") {
          outcome = update.recovery;
          markReady();
          controller.abort();
          return;
        }
        if (update.status !== "renewed") return invalidInterruption();
        if (
          assertLeaseExpiryHorizon(update.leaseExpiresAt) <=
            previousLeaseExpiresAt ||
          effectiveLeaseExpiry(update.leaseExpiresAt) <=
            Date.now() + CLAIM_RENEWAL_EXPIRY_BUFFER_MS
        ) {
          return invalidInterruption();
        }
        leaseExpiresAt = update.leaseExpiresAt;
        markReady();
      }
    } catch (error) {
      if (!stopped) {
        if (!options.signal?.aborted) failure = error;
        failReady(error);
        controller.abort();
      }
    }
  })();
  return {
    signal,
    ready,
    finish: async () => {
      stopped = true;
      controller.abort();
      await renewal;
      return { failure, outcome };
    },
  };
}

function createClaimedModelFence(input: Readonly<{
  ownerId: string;
  trialId: string;
  credential: HearingFinalBoundInterruptionLeaseCredential;
  initial: HearingFinalBoundInterruptionRecoveryPreparation;
  signal: AbortSignal;
  onRecovery: (
    recovery: HearingFinalBoundInterruptionRecoveryPreparation,
  ) => void;
}>): Readonly<{
  assertModelPreparation: (preparation: ModelRequiredPreparation) => void;
  durableService: CourtroomCommandDurableService;
}> {
  const base = createCourtroomCommandDurableService({
    ownerId: input.ownerId,
    trialId: input.trialId,
  });
  const metadata = input.initial.interrupt;
  const initialPhase = input.initial.phase;
  let committedOutcome = input.initial.outcome;
  let rulingStepConsumed = false;
  let witnessStepConsumed = false;

  const assertModelPreparation = (
    preparation: ModelRequiredPreparation,
  ): void => {
    assertFinalBoundInterruptionScopedPreparation(
      preparation,
      metadata,
      committedOutcome,
    );
    if (preparation.request.trialId !== input.trialId) {
      return invalidInterruption();
    }
    if (isHearingObjectionRulingModelRequiredPreparation(preparation)) {
      if (
        initialPhase !== "ruling_required" ||
        rulingStepConsumed ||
        witnessStepConsumed ||
        committedOutcome !== null
      ) {
        return invalidInterruption();
      }
      rulingStepConsumed = true;
      return;
    }
    if (isHearingWitnessModelRequiredPreparation(preparation)) {
      if (
        committedOutcome?.ruling !== "overruled" ||
        committedOutcome.remedy !== "resume_response" ||
        witnessStepConsumed ||
        (initialPhase === "ruling_required" && !rulingStepConsumed)
      ) {
        return invalidInterruption();
      }
      witnessStepConsumed = true;
      return;
    }
    return invalidInterruption();
  };

  return {
    assertModelPreparation,
    durableService: {
      ...base,
      commitObjectionRuling: async (generation) => {
        if (
          initialPhase !== "ruling_required" ||
          !rulingStepConsumed ||
          committedOutcome !== null ||
          generation.trialId !== input.trialId ||
          generation.expectedStateVersion !==
            metadata.committedHead.stateVersion ||
          generation.expectedLastEventId !==
            metadata.committedHead.lastEventId ||
          generation.objectionEventId !== metadata.objectionEventId ||
          generation.responseId !== metadata.responseId ||
          generation.questionEventBinding.sourceEventId !==
            metadata.questionEventId
        ) {
          return invalidInterruption();
        }
        const recovery = assertRecoveryMatchesScope(
          await callConvexCaseService({
            path: "/service/hearings/interruption/claim/commit",
            body: {
              ownerId: input.ownerId,
              trialId: input.trialId,
              credential: input.credential,
              generation,
            },
            responseSchema:
              HearingFinalBoundInterruptionRecoveryPreparationSchema,
            signal: input.signal,
          }),
          metadata,
        );
        const proposed = HearingFinalBoundInterruptionOutcomeSchema.parse({
          ruling: generation.output.ruling,
          remedy: generation.output.remedy,
        });
        if (
          recovery.outcome?.ruling !== proposed.ruling ||
          recovery.outcome.remedy !== proposed.remedy
        ) {
          return invalidInterruption();
        }
        committedOutcome = recovery.outcome;
        input.onRecovery(recovery);
        return recovery.preparation;
      },
      commitWitness: async (generation) => {
        if (
          committedOutcome?.ruling !== "overruled" ||
          committedOutcome.remedy !== "resume_response" ||
          !witnessStepConsumed ||
          generation.trialId !== input.trialId ||
          generation.responseId !== metadata.responseId
        ) {
          return invalidInterruption();
        }
        const recovery = assertRecoveryMatchesScope(
          await callConvexCaseService({
            path: "/service/hearings/interruption/claim/witness/commit",
            body: {
              ownerId: input.ownerId,
              trialId: input.trialId,
              credential: input.credential,
              generation,
            },
            responseSchema:
              HearingFinalBoundInterruptionRecoveryPreparationSchema,
            signal: input.signal,
          }),
          metadata,
        );
        if (
          recovery.phase !== "ruling_committed" ||
          recovery.outcome?.ruling !== "overruled" ||
          recovery.outcome.remedy !== "resume_response"
        ) {
          return invalidInterruption();
        }
        input.onRecovery(recovery);
        return recovery.preparation;
      },
    },
  };
}

async function resumeExactInterruption(
  options: FinalBoundInterruptionDriveOptions,
  interruptId: string,
): Promise<HearingFinalBoundInterruptionRecoveryPreparation> {
  return assertFinalBoundInterruptionRecoveryPreparation(
    await callConvexCaseService({
      path: "/service/hearings/interruption/resume",
      body: {
        ownerId: options.ownerId,
        trialId: options.trialId,
        interruptId,
      },
      responseSchema: HearingFinalBoundInterruptionRecoveryPreparationSchema,
    }),
  );
}

async function releaseClaim(
  options: FinalBoundInterruptionDriveOptions,
  credential: HearingFinalBoundInterruptionLeaseCredential,
): Promise<HearingFinalBoundInterruptionRecoveryPreparation | null> {
  try {
    const result = HearingFinalBoundInterruptionLeaseUpdateResultSchema.parse(
      await callConvexCaseService({
        path: "/service/hearings/interruption/claim/release",
        body: {
          ownerId: options.ownerId,
          trialId: options.trialId,
          credential,
        },
        responseSchema: HearingFinalBoundInterruptionLeaseUpdateResultSchema,
      }),
    );
    return result.status === "outcome" ? result.recovery : null;
  } catch (error) {
    console.error("hearing_interruption_claim_release_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      interruptId: credential.interruptId,
    });
    return null;
  }
}

async function driveFinalBoundInterruption(
  options: FinalBoundInterruptionDriveOptions,
): Promise<FinalBoundInterruptionResponse> {
  const claim = await claimFinalBoundInterruption(options);
  if (claim.status === "outcome") {
    const recovery =
      options.expectedScope === undefined
        ? claim.recovery
        : assertRecoveryMatchesScope(
            claim.recovery,
            options.expectedScope,
          );
    return interruptionResponse(recovery, options.replayed);
  }
  if (claim.status !== "claimed") return invalidInterruption();
  const credential = leaseCredential(claim);
  let latest =
    options.expectedScope === undefined
      ? claim.recovery
      : assertRecoveryMatchesScope(claim.recovery, options.expectedScope);
  const scope = latest.interrupt;
  const guard = startLeaseGuard(
    options,
    credential,
    claim.leaseExpiresAt,
  );
  const modelFence = createClaimedModelFence({
    ownerId: options.ownerId,
    trialId: options.trialId,
    credential,
    initial: latest,
    signal: guard.signal,
    onRecovery: (recovery) => {
      latest = recovery;
    },
  });
  let failure: unknown | null = null;
  try {
    await guard.ready;
    await orchestratePreparedCourtroomCommandResult({
      preparation: latest.preparation,
      provider: options.provider ?? new EnvironmentCourtroomModelProvider(),
      durableService: modelFence.durableService,
      signal: guard.signal,
      assertModelPreparation: modelFence.assertModelPreparation,
    });
    latest = assertRecoveryMatchesScope(
      await resumeExactInterruption(options, credential.interruptId),
      scope,
    );
  } catch (error) {
    failure = error;
    try {
      latest = assertRecoveryMatchesScope(
        await resumeExactInterruption(options, credential.interruptId),
        scope,
      );
    } catch {
      // Preserve the model/lease failure unless a durable recovery is available.
    }
  }
  const guardResult = await guard.finish();
  const releasedOutcome = await releaseClaim(options, credential);
  const reconciled =
    releasedOutcome === null
      ? guardResult.outcome === null
        ? latest
        : assertRecoveryMatchesScope(guardResult.outcome, scope)
      : assertRecoveryMatchesScope(releasedOutcome, scope);
  if (reconciled.phase === "ruling_committed") {
    return interruptionResponse(reconciled, options.replayed);
  }
  if (guardResult.failure !== null) throw guardResult.failure;
  if (failure !== null) throw failure;
  return invalidInterruption();
}

/** Resolve one exact final-sealed browser request without exposing lease data. */
export async function resolveFinalBoundInterruption(input: Readonly<{
  ownerId: string;
  trialId: string;
  request: FinalBoundInterruptionRequest;
  signal?: AbortSignal;
  provider?: CourtroomModelProvider;
}>): Promise<FinalBoundInterruptionResolution> {
  const prepared = assertFinalBoundInterruptionPreparationMatchesRequest(
    await callConvexCaseService({
      path: "/service/hearings/interruption/prepare",
      body: {
        ownerId: input.ownerId,
        trialId: input.trialId,
        request: input.request,
      },
      responseSchema: HearingFinalBoundInterruptionPreparationSchema,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    input.request,
  );
  if (prepared.phase === "candidate_withdrawn") {
    return FinalBoundInterruptionResolutionSchema.parse({
      schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
      disposition: "candidate_withdrawn",
      withdrawalId: prepared.withdrawalId,
      head: prepared.sourceHead,
    });
  }
  return await driveFinalBoundInterruption({
    ownerId: input.ownerId,
    trialId: input.trialId,
    interruptId: prepared.interrupt.interruptId,
    expectedScope: prepared.interrupt,
    replayed:
      prepared.interrupt.prefixReplayed || prepared.outcomeReplayed,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
  });
}

/** Recover the owner-bound current interruption without browser authority. */
export async function recoverFinalBoundInterruption(input: Readonly<{
  ownerId: string;
  trialId: string;
  signal?: AbortSignal;
  provider?: CourtroomModelProvider;
}>): Promise<FinalBoundInterruptionResponse> {
  return await driveFinalBoundInterruption({
    ownerId: input.ownerId,
    trialId: input.trialId,
    replayed: true,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
  });
}
