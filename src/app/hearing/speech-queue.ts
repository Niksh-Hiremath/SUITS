import type { HearingRuntimeViewV1 } from "@/domain/hearing-runtime";
import type { FinalBoundInterruptionResponse } from "@/domain/objections/final-bound-contracts";
import type { HearingSpeechViewSource } from "@/lib/speech/hearing-policy";

export type PendingSpeechAdoption =
  | Readonly<{
      kind: "view";
      previous: HearingRuntimeViewV1 | null;
      next: HearingRuntimeViewV1;
      source: HearingSpeechViewSource;
    }>
  | Readonly<{
      kind: "interruption";
      previous: HearingRuntimeViewV1;
      response: FinalBoundInterruptionResponse;
    }>;

function sameViewHead(
  left: HearingRuntimeViewV1,
  right: HearingRuntimeViewV1,
): boolean {
  return (
    left.trial.trialId === right.trial.trialId &&
    left.trial.version === right.trial.version &&
    left.trial.lastEventId === right.trial.lastEventId
  );
}

function responseCanReplace(
  current: FinalBoundInterruptionResponse,
  incoming: FinalBoundInterruptionResponse,
): boolean {
  const currentHead = current.view.trial;
  const incomingHead = incoming.view.trial;
  if (
    currentHead.trialId !== incomingHead.trialId ||
    incomingHead.version < currentHead.version ||
    (incomingHead.version === currentHead.version &&
      incomingHead.lastEventId !== currentHead.lastEventId)
  ) {
    return false;
  }
  return !(
    incomingHead.version === currentHead.version &&
    current.continuation === "complete" &&
    incoming.continuation === "pending"
  );
}

/**
 * Coalesce recovery progress for one durable interruption before audio drains.
 * A later complete response replaces its queued pending ruling while retaining
 * the earliest controller baseline, so barge-in cannot expose a stale second
 * adoption after the player has moved on.
 */
export function enqueuePendingSpeechAdoption(
  current: readonly PendingSpeechAdoption[],
  incoming: PendingSpeechAdoption,
): PendingSpeechAdoption[] {
  if (incoming.kind !== "interruption") return [...current, incoming];
  const existing = current.find(
    (candidate): candidate is Extract<
      PendingSpeechAdoption,
      Readonly<{ kind: "interruption" }>
    > =>
      candidate.kind === "interruption" &&
      candidate.response.interruptId === incoming.response.interruptId,
  );
  if (existing === undefined) return [...current, incoming];
  if (!responseCanReplace(existing.response, incoming.response)) {
    return [...current];
  }
  const withoutOlderRecovery = current.filter(
    (candidate) =>
      candidate.kind !== "interruption" ||
      candidate.response.interruptId !== incoming.response.interruptId,
  );
  return [
    ...withoutOlderRecovery,
    Object.freeze({
      ...incoming,
      previous: existing.previous,
    }),
  ];
}

type RecoveredInterruptionAdoptionInput = Readonly<{
  previous: HearingRuntimeViewV1;
  response: FinalBoundInterruptionResponse;
  signal?: AbortSignal;
  isCurrent: () => boolean;
  currentView: () => HearingRuntimeViewV1 | null;
  publishView: (view: HearingRuntimeViewV1) => void;
  queueSpeech: (
    adoption: Extract<
      PendingSpeechAdoption,
      Readonly<{ kind: "interruption" }>
    >,
  ) => void;
}>;

function assertRecoveryActive(
  input: Pick<RecoveredInterruptionAdoptionInput, "signal" | "isCurrent">,
): void {
  if (input.signal?.aborted || !input.isCurrent()) {
    throw new Error("The interrupted courtroom recovery was cancelled.");
  }
}

/** Validate and atomically publish/queue one protected recovery response. */
export function adoptRecoveredInterruptionResponse(
  input: RecoveredInterruptionAdoptionInput,
): HearingRuntimeViewV1 {
  assertRecoveryActive(input);
  const latest = input.currentView();
  if (latest === null || !sameViewHead(latest, input.previous)) {
    throw new Error(
      "The courtroom changed while interrupted speech was recovering.",
    );
  }
  const next = input.response.view;
  if (
    next.trial.trialId !== input.previous.trial.trialId ||
    next.trial.version < input.previous.trial.version ||
    (next.trial.version === input.previous.trial.version &&
      next.trial.lastEventId !== input.previous.trial.lastEventId)
  ) {
    throw new Error(
      "The recovered courtroom record moved behind the current head.",
    );
  }
  assertRecoveryActive(input);
  input.publishView(next);
  assertRecoveryActive(input);
  input.queueSpeech({
    kind: "interruption",
    previous: input.previous,
    response: input.response,
  });
  return next;
}
