import type { NamedAssertion } from "./formal-evals";
import type { Milestone6ObjectionEvalFixture } from "./objection-eval-fixtures";

export { createMilestone6ObjectionEvalFixture } from "./objection-eval-fixtures";

export type Milestone6ObjectionEvalResult = Readonly<{
  status: "passed" | "failed";
  assertions: readonly NamedAssertion[];
  passedCount: number;
  totalCount: number;
  score: number;
  failureReason?: string;
}>;

function assertion(
  name: string,
  passed: boolean,
  evidence: unknown,
): NamedAssertion {
  return { name, passed, evidenceJson: JSON.stringify(evidence) };
}

export function evaluateMilestone6ObjectionFixture(
  input: Milestone6ObjectionEvalFixture,
): Milestone6ObjectionEvalResult {
  const withdrawal = input.candidateWithdrawal;
  const ordering = input.coordinatorOrdering;
  const orderIndex = (event: string) => ordering.order.indexOf(event);
  const sustained = input.sustained;
  const overruled = input.overruled;
  const stale = input.staleSuppression;
  const granted = input.strikeGranted;
  const denied = input.strikeDenied;

  const assertions = [
    assertion(
      "candidate_withdrawal_no_write",
      withdrawal.disposition === "candidate_withdrawn" &&
        withdrawal.sourceStateVersion === withdrawal.completedStateVersion &&
        withdrawal.sourceLastEventId === withdrawal.completedLastEventId &&
        withdrawal.durableEventTypes.length === 0 &&
        withdrawal.neutralCorrectionPlayed &&
        !withdrawal.rulingClipPlayed,
      withdrawal,
    ),
    assertion(
      "cached_reaction_precedes_final_and_model",
      ordering.sealed &&
        orderIndex("cached_reaction_started") >= 0 &&
        orderIndex("cached_reaction_started") < orderIndex("final_sealed") &&
        orderIndex("final_sealed") < orderIndex("model_requested") &&
        orderIndex("cached_reaction_completed") < orderIndex("model_requested") &&
        orderIndex("model_requested") < orderIndex("model_result_delivered") &&
        ordering.metrics.reactionsStarted === 1 &&
        ordering.metrics.finalCandidatesSealed === 1 &&
        ordering.metrics.resultsDelivered === 1,
      { order: ordering.order, metrics: ordering.metrics },
    ),
    assertion(
      "sustained_cancels_and_rephrases",
      JSON.stringify(sustained.eventTypes) ===
        JSON.stringify([
          "ASK_QUESTION",
          "REQUEST_RESPONSE",
          "OBJECT",
          "BEGIN_INTERRUPTION",
          "RULE_ON_OBJECTION",
          "RESOLVE_INTERRUPTION",
          "REPHRASE_QUESTION",
        ]) &&
        sustained.questionStatus === "sustained" &&
        sustained.responseStatus === "cancelled" &&
        sustained.interruptedResponseId === sustained.responseId &&
        sustained.interruptionStatus === "cancelled" &&
        sustained.rephrasedQuestionId !== null &&
        sustained.rephrasesQuestionId === sustained.questionId &&
        sustained.rephrasedQuestionStatus === "open",
      sustained,
    ),
    assertion(
      "overruled_resumes_exact_response",
      JSON.stringify(overruled.eventTypes) ===
        JSON.stringify([
          "ASK_QUESTION",
          "REQUEST_RESPONSE",
          "OBJECT",
          "BEGIN_INTERRUPTION",
          "RULE_ON_OBJECTION",
          "RESOLVE_INTERRUPTION",
          "RESUME_INTERRUPTED_SPEECH",
        ]) &&
        overruled.questionStatus === "open" &&
        overruled.responseStatus === "streaming" &&
        overruled.interruptedResponseId === overruled.responseId &&
        overruled.interruptionStatus === "resumed" &&
        overruled.rephrasedQuestionId === null,
      overruled,
    ),
    assertion(
      "stale_model_and_late_audio_suppressed",
      stale.staleRevisionDisposition === "stale_revision" &&
        stale.requestCount > 0 &&
        stale.abortedRequestCount === stale.requestCount &&
        stale.deliveredResultCount === 0 &&
        stale.metrics.staleRevisions >= 1 &&
        stale.metrics.modelRequestsAborted === stale.requestCount &&
        stale.lateAudio.canonicalStateVersion > stale.lateAudio.targetStateVersion &&
        !stale.lateAudio.played &&
        !stale.lateAudio.mutatedCanonicalState,
      stale,
    ),
    assertion(
      "strike_grant_marks_target_stricken",
      JSON.stringify(granted.eventTypes) ===
        JSON.stringify(["MOVE_TO_STRIKE", "STRIKE_TESTIMONY"]) &&
        granted.motionStatus === "granted" &&
        granted.targetTestimonyStatus === "stricken" &&
        granted.targetTurnStatus === "stricken" &&
        granted.targetRetainedInHistory,
      granted,
    ),
    assertion(
      "strike_denial_preserves_testimony",
      JSON.stringify(denied.eventTypes) ===
        JSON.stringify(["MOVE_TO_STRIKE", "DENY_STRIKE_MOTION"]) &&
        denied.motionStatus === "denied" &&
        denied.targetTestimonyStatus === "active" &&
        denied.targetTurnStatus === "active" &&
        denied.targetRetainedInHistory,
      denied,
    ),
  ];
  const passedCount = assertions.filter((item) => item.passed).length;
  const failureReason = assertions
    .filter((item) => !item.passed)
    .map((item) => item.name)
    .join(", ");
  return {
    status: passedCount === assertions.length ? "passed" : "failed",
    assertions,
    passedCount,
    totalCount: assertions.length,
    score: passedCount / assertions.length,
    ...(failureReason === "" ? {} : { failureReason }),
  };
}
