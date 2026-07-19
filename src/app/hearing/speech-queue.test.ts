import { describe, expect, it, vi } from "vitest";

import {
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";
import {
  FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
  FinalBoundInterruptionResponseSchema,
  type FinalBoundInterruptionResponse,
} from "@/domain/objections/final-bound-contracts";

import {
  adoptRecoveredInterruptionResponse,
  enqueuePendingSpeechAdoption,
  type PendingSpeechAdoption,
} from "./speech-queue";

const TRIAL_ID = "trial_123e4567e89b42d3a456426614174000";

function view(
  version: number,
  lastEventId: string,
  answerTurnId?: string,
): HearingRuntimeViewV1 {
  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: "hearing-runtime-view.v2",
    case: {
      caseId: "case_recovery_queue",
      version: 1,
      title: "Recovery queue fixture",
      summary: "A fictional educational case.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction_fictional_civil",
        name: "Fictional Civil Court",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional civil law",
        burdenOfProof: "preponderance",
      },
      issues: [],
    },
    trial: {
      trialId: TRIAL_ID,
      phase: "case_in_chief",
      status: "active",
      version,
      sequence: version,
      lastEventId,
      userSide: "user",
    },
    activeAppearance: null,
    activeQuestion: null,
    capabilities: {
      canAskQuestion: false,
      canFinishExamination: false,
      canFinishTrial: true,
      canObject: false,
      canContinueResponse: false,
      canProposeSettlement: false,
      counterableSettlementOfferIds: [],
      acceptableSettlementOfferIds: [],
      rejectableSettlementOfferIds: [],
      withdrawableSettlementOfferIds: [],
    },
    witnesses: [],
    player: {
      actorId: "actor:counsel:user",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party_user",
      facts: [],
      evidence: [],
      settlement: null,
    },
    transcript:
      answerTurnId === undefined
        ? []
        : [
            {
              ordinal: 1,
              turnId: answerTurnId,
              actor: {
                actorId: "actor:witness:one",
                role: "witness",
                side: "neutral",
                witnessId: "witness-one",
              },
              text: "I saw the alert that morning.",
              testimonyId: "testimony:recovery:one",
              status: "active",
              citations: {
                factIds: [],
                evidenceIds: [],
                testimonyIds: [],
                eventIds: [],
                sourceSegmentIds: [],
              },
            },
          ],
    permittedObjectionGrounds: ["leading"],
  });
}

function response(
  continuation: "pending" | "complete",
  next: HearingRuntimeViewV1,
  interruptId = "interrupt:recovery:one",
): FinalBoundInterruptionResponse {
  const answerTurnId =
    continuation === "complete" ? (next.transcript.at(-1)?.turnId ?? null) : null;
  return FinalBoundInterruptionResponseSchema.parse({
    schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
    disposition: "ruling_committed",
    interruptId,
    ruling: "overruled",
    remedy: "resume_response",
    replayed: true,
    targetCompletionHead: {
      trialId: next.trial.trialId,
      stateVersion: next.trial.version,
      lastEventId: next.trial.lastEventId,
    },
    continuation,
    performance: { disposition: "current", answerTurnId },
    view: next,
  });
}

function interruptionAdoption(
  previous: HearingRuntimeViewV1,
  recovered: FinalBoundInterruptionResponse,
): Extract<PendingSpeechAdoption, Readonly<{ kind: "interruption" }>> {
  return { kind: "interruption", previous, response: recovered };
}

describe("hearing speech recovery queue", () => {
  it("coalesces pending then complete recovery while preserving the earliest baseline", () => {
    const previous = view(7, "event:source:7");
    const pendingView = view(12, "event:ruling:12");
    const completeView = view(14, "event:answer:14", "turn:answer:14");
    const pending = interruptionAdoption(
      previous,
      response("pending", pendingView),
    );
    const complete = interruptionAdoption(
      pendingView,
      response("complete", completeView),
    );

    const queue = enqueuePendingSpeechAdoption(
      enqueuePendingSpeechAdoption([], pending),
      complete,
    );

    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual({ ...complete, previous });
  });

  it("coalesces duplicate pending recovery and keeps different interruptions ordered", () => {
    const previous = view(7, "event:source:7");
    const pendingView = view(12, "event:ruling:12");
    const first = interruptionAdoption(
      previous,
      response("pending", pendingView),
    );
    const duplicate = interruptionAdoption(
      pendingView,
      response("pending", pendingView),
    );
    const other = interruptionAdoption(
      pendingView,
      response("pending", pendingView, "interrupt:recovery:two"),
    );

    const coalesced = enqueuePendingSpeechAdoption([first], duplicate);
    const ordered = enqueuePendingSpeechAdoption(coalesced, other);

    expect(coalesced).toEqual([{ ...duplicate, previous }]);
    expect(ordered.map((item) =>
      item.kind === "interruption" ? item.response.interruptId : item.kind,
    )).toEqual(["interrupt:recovery:one", "interrupt:recovery:two"]);
  });

  it("refuses to replace a queued complete recovery with a backwards response", () => {
    const previous = view(7, "event:source:7");
    const completeView = view(14, "event:answer:14", "turn:answer:14");
    const olderView = view(12, "event:ruling:12");
    const complete = interruptionAdoption(
      previous,
      response("complete", completeView),
    );
    const backwards = interruptionAdoption(
      olderView,
      response("pending", olderView),
    );

    expect(enqueuePendingSpeechAdoption([complete], backwards)).toEqual([
      complete,
    ]);
  });

  it("does not publish or queue when the run aborts after response resolution", () => {
    const previous = view(7, "event:source:7");
    const recovered = response("pending", view(12, "event:ruling:12"));
    const controller = new AbortController();
    const publishView = vi.fn();
    const queueSpeech = vi.fn();

    expect(() =>
      adoptRecoveredInterruptionResponse({
        previous,
        response: recovered,
        signal: controller.signal,
        isCurrent: () => true,
        currentView: () => {
          controller.abort();
          return previous;
        },
        publishView,
        queueSpeech,
      }),
    ).toThrow("recovery was cancelled");
    expect(publishView).not.toHaveBeenCalled();
    expect(queueSpeech).not.toHaveBeenCalled();
  });
});
