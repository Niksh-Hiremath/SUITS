import { describe, expect, it } from "vitest";

import {
  FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
  FinalBoundInterruptionRequestSchema,
} from "./final-bound-contracts";
import {
  HearingFinalBoundInterruptionLeaseCredentialSchema,
  HearingFinalBoundInterruptionRecoveryMetadataSchema,
  deriveFinalBoundInterruptionPersistenceIds,
} from "./final-bound-persistence";

function requestFixture() {
  return FinalBoundInterruptionRequestSchema.parse({
    schemaVersion: FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
    head: {
      trialId: "trial_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      stateVersion: 12,
      lastEventId: "event:head:12",
    },
    utterance: { generation: 2, utteranceId: "utterance:partial:2" },
    trigger: {
      revision: 4,
      text: "You signed the delivery report, correct?",
      confidence: 0.99,
    },
    final: {
      revision: 5,
      text: "You signed the delivery report, correct?",
    },
  });
}

describe("final-bound durable identities", () => {
  it("content-addresses the entire strict request including private speech identity", () => {
    const request = requestFixture();
    const ids = deriveFinalBoundInterruptionPersistenceIds(request);
    expect(deriveFinalBoundInterruptionPersistenceIds(request)).toEqual(ids);

    for (const changed of [
      { ...request, utterance: { ...request.utterance, generation: 3 } },
      {
        ...request,
        utterance: { ...request.utterance, utteranceId: "utterance:other" },
      },
      {
        ...request,
        trigger: { ...request.trigger, confidence: 0.98 },
      },
      {
        ...request,
        trigger: { ...request.trigger, text: "You approved that report, correct?" },
      },
      {
        ...request,
        final: { ...request.final, revision: 6 },
      },
    ]) {
      expect(
        deriveFinalBoundInterruptionPersistenceIds(
          FinalBoundInterruptionRequestSchema.parse(changed),
        ).withdrawalId,
      ).not.toBe(ids.withdrawalId);
    }
  });

  it("requires an exact monotonic recovered target head and strict lease credential", () => {
    const metadata = {
      interruptId:
        "interrupt:final-bound:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      objectionId:
        "objection:final-bound:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      questionId:
        "question:final-bound:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      responseId:
        "response:final-bound:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      questionEventId:
        "event:action:final-bound-question:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      objectionEventId:
        "event:action:final-bound-objection:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      interruptionEventId:
        "event:action:final-bound-interruption:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      decisionId:
        "decision:objection-ruling:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ground: "leading",
      sourceHead: {
        trialId: "trial_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        stateVersion: 12,
        lastEventId: "event:head:12",
      },
      committedHead: {
        trialId: "trial_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        stateVersion: 16,
        lastEventId:
          "event:action:final-bound-interruption:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      answerTurnId: null,
      targetCompletionHead: {
        trialId: "trial_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        stateVersion: 19,
        lastEventId: "event:resume:19",
      },
    } as const;
    expect(
      HearingFinalBoundInterruptionRecoveryMetadataSchema.parse(metadata),
    ).toEqual(metadata);
    expect(
      HearingFinalBoundInterruptionRecoveryMetadataSchema.safeParse({
        ...metadata,
        targetCompletionHead: {
          ...metadata.targetCompletionHead,
          stateVersion: 15,
        },
      }).success,
    ).toBe(false);

    const credential = {
      decisionId: metadata.decisionId,
      interruptId: metadata.interruptId,
      leaseGeneration: 2,
      leaseToken: `lease_${"b".repeat(64)}_11111111-1111-4111-8111-111111111111`,
    };
    expect(
      HearingFinalBoundInterruptionLeaseCredentialSchema.parse(credential),
    ).toEqual(credential);
    expect(
      HearingFinalBoundInterruptionLeaseCredentialSchema.safeParse({
        ...credential,
        actorId: "actor:forged",
      }).success,
    ).toBe(false);
  });
});
