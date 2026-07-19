import { describe, expect, it } from "vitest";

import {
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
  type HearingRuntimeViewV1,
} from "../hearing-runtime/schema";
import {
  FINAL_BOUND_INTERRUPTION_FINAL_TEXT_MAX_CHARACTERS,
  FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
  FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
  FINAL_BOUND_INTERRUPTION_TRIGGER_TEXT_MAX_CHARACTERS,
  FinalBoundInterruptionRequestSchema,
  FinalBoundInterruptionResponseSchema,
} from "./final-bound-contracts";
import { PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE } from "./partial-detector";

const TRIAL_ID = `trial_${"a".repeat(32)}`;

function requestFixture(): Record<string, unknown> {
  return {
    schemaVersion: FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
    head: {
      trialId: TRIAL_ID,
      stateVersion: 14,
      lastEventId: "event:question-window:014",
    },
    utterance: {
      generation: 7,
      utteranceId: "utterance:question:007",
    },
    trigger: {
      revision: 3,
      text: "  Isn\u2019t\u3000it true   that you ignored the alert?  ",
      confidence: PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE,
    },
    final: {
      revision: 5,
      text: "  Isn\u2019t it true that you ignored the alert that morning?  ",
    },
  };
}

function hearingView(): HearingRuntimeViewV1 {
  return {
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
    case: {
      caseId: "case:final-bound",
      version: 1,
      title: "Final-bound interruption fixture",
      summary: "A fictional educational hearing.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction:fixture",
        name: "Fixture Court",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional procedure",
        burdenOfProof: "preponderance",
      },
      issues: [],
    },
    trial: {
      trialId: TRIAL_ID,
      phase: "case_in_chief",
      status: "active",
      version: 20,
      sequence: 20,
      lastEventId: "event:interruption-resolved:020",
      userSide: "user",
    },
    activeAppearance: null,
    activeQuestion: null,
    capabilities: {
      canAskQuestion: true,
      canFinishExamination: true,
      canFinishTrial: false,
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
      actorId: "actor:user-counsel",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party:claimant",
      facts: [],
      evidence: [],
      settlement: null,
    },
    transcript: [],
    permittedObjectionGrounds: ["leading"],
  };
}

describe("FinalBoundInterruptionRequestSchema", () => {
  it("parses only the actorless final-bound transcript envelope", () => {
    const parsed = FinalBoundInterruptionRequestSchema.parse(requestFixture());

    expect(parsed.trigger.text).toBe(
      "Isn\u2019t it true that you ignored the alert?",
    );
    expect(parsed.final.text).toBe(
      "Isn\u2019t it true that you ignored the alert that morning?",
    );
    expect(Object.isFrozen(parsed.head)).toBe(true);
    expect(Object.keys(parsed)).toEqual([
      "schemaVersion",
      "head",
      "utterance",
      "trigger",
      "final",
    ]);
  });

  it.each([
    ["root", (request: Record<string, unknown>) => Object.assign(request, { ownerId: "owner:forged" })],
    ["head", (request: Record<string, unknown>) => Object.assign(request.head as object, { ownerId: "owner:forged" })],
    ["utterance", (request: Record<string, unknown>) => Object.assign(request.utterance as object, { speakerActorId: "actor:forged" })],
    ["trigger", (request: Record<string, unknown>) => Object.assign(request.trigger as object, { ground: "leading" })],
    ["final", (request: Record<string, unknown>) => Object.assign(request.final as object, { modelMetadata: {} })],
  ])("rejects unknown authority-bearing keys at the %s boundary", (_name, mutate) => {
    const request = requestFixture();
    mutate(request);
    expect(FinalBoundInterruptionRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });

  it.each([
    "objectorActorId",
    "speakerActorId",
    "detectorContext",
    "ground",
    "modelMetadata",
    "interruptId",
  ])("does not accept browser authority field %s", (field) => {
    expect(
      FinalBoundInterruptionRequestSchema.safeParse({
        ...requestFixture(),
        [field]: field.endsWith("Id") ? "actor:forged" : {},
      }).success,
    ).toBe(false);
  });

  it("binds final revision at or after the triggering partial revision", () => {
    const sameRevision = requestFixture();
    (sameRevision.final as { revision: number }).revision = 3;
    expect(
      FinalBoundInterruptionRequestSchema.safeParse(sameRevision).success,
    ).toBe(true);

    const staleFinal = requestFixture();
    (staleFinal.final as { revision: number }).revision = 2;
    expect(
      FinalBoundInterruptionRequestSchema.safeParse(staleFinal).success,
    ).toBe(false);
  });

  it.each([
    PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE - 0.001,
    1.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid trigger confidence %s", (confidence) => {
    const request = requestFixture();
    (request.trigger as { confidence: number }).confidence = confidence;
    expect(FinalBoundInterruptionRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });

  it.each([
    ["trigger", "   "],
    ["final", "\r\n\t"],
    ["trigger", "\u200b\u2060"],
    [
      "trigger",
      "x".repeat(
        FINAL_BOUND_INTERRUPTION_TRIGGER_TEXT_MAX_CHARACTERS + 1,
      ),
    ],
    [
      "final",
      "x".repeat(FINAL_BOUND_INTERRUPTION_FINAL_TEXT_MAX_CHARACTERS + 1),
    ],
  ])("rejects blank or oversized %s text", (field, text) => {
    const request = requestFixture();
    (request[field] as { text: string }).text = text;
    expect(FinalBoundInterruptionRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });

  it.each([
    ["head state", (request: Record<string, unknown>) => ((request.head as { stateVersion: number }).stateVersion = Number.MAX_SAFE_INTEGER + 1)],
    ["generation", (request: Record<string, unknown>) => ((request.utterance as { generation: number }).generation = 0)],
    ["trigger revision", (request: Record<string, unknown>) => ((request.trigger as { revision: number }).revision = 0)],
    ["final revision", (request: Record<string, unknown>) => ((request.final as { revision: number }).revision = 1.5)],
    ["utterance ID", (request: Record<string, unknown>) => ((request.utterance as { utteranceId: string }).utteranceId = "bad id")],
    ["trial ID", (request: Record<string, unknown>) => ((request.head as { trialId: string }).trialId = "trial_legacy")],
  ])("rejects an invalid %s", (_name, mutate) => {
    const request = requestFixture();
    mutate(request);
    expect(FinalBoundInterruptionRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });
});

describe("FinalBoundInterruptionResponseSchema", () => {
  function responseFixture() {
    return {
      schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
      interruptId: "interrupt:partial:007",
      ruling: "sustained" as const,
      remedy: "rephrase" as const,
      replayed: false,
      view: hearingView(),
    };
  }

  it("returns only the durable ruling outcome and canonical redacted view", () => {
    expect(FinalBoundInterruptionResponseSchema.parse(responseFixture())).toEqual(
      responseFixture(),
    );
  });

  it.each([
    ["sustained", "rephrase", true],
    ["sustained", "cancel_response", true],
    ["overruled", "resume_response", true],
    ["sustained", "resume_response", false],
    ["overruled", "rephrase", false],
    ["overruled", "cancel_response", false],
  ] as const)(
    "validates %s with %s",
    (ruling, remedy, expected) => {
      expect(
        FinalBoundInterruptionResponseSchema.safeParse({
          ...responseFixture(),
          ruling,
          remedy,
        }).success,
      ).toBe(expected);
    },
  );

  it("requires explicit exact-replay status", () => {
    const response: Partial<ReturnType<typeof responseFixture>> =
      responseFixture();
    delete response.replayed;
    expect(FinalBoundInterruptionResponseSchema.safeParse(response).success).toBe(
      false,
    );
    expect(
      FinalBoundInterruptionResponseSchema.safeParse({
        ...responseFixture(),
        replayed: true,
      }).success,
    ).toBe(true);
  });

  it.each(["ground", "actorId", "modelMetadata", "retryAfterMs"])(
    "rejects protected response field %s",
    (field) => {
      expect(
        FinalBoundInterruptionResponseSchema.safeParse({
          ...responseFixture(),
          [field]: {},
        }).success,
      ).toBe(false);
    },
  );

  it("rejects an invalid interrupt identity or redacted hearing view", () => {
    expect(
      FinalBoundInterruptionResponseSchema.safeParse({
        ...responseFixture(),
        interruptId: "bad interrupt id",
      }).success,
    ).toBe(false);
    expect(
      FinalBoundInterruptionResponseSchema.safeParse({
        ...responseFixture(),
        view: { ...hearingView(), ownerId: "owner:forged" },
      }).success,
    ).toBe(false);
  });
});
