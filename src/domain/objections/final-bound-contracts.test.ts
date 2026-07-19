import { describe, expect, it } from "vitest";

import {
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V2,
  type HearingRuntimeViewV1,
} from "../hearing-runtime/schema";
import {
  FINAL_BOUND_INTERRUPTION_FINAL_TEXT_MAX_CHARACTERS,
  FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
  FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
  FINAL_BOUND_INTERRUPTION_TRIGGER_TEXT_MAX_CHARACTERS,
  FinalBoundInterruptionCandidateWithdrawnSchema,
  FinalBoundInterruptionRequestSchema,
  FinalBoundInterruptionResolutionSchema,
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

function hearingView(
  options: Readonly<{
    trialId?: string;
    version?: number;
    lastEventId?: string;
    transcript?: HearingRuntimeViewV1["transcript"];
  }> = {},
): HearingRuntimeViewV1 {
  const version = options.version ?? 20;
  return {
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V2,
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
      trialId: options.trialId ?? TRIAL_ID,
      phase: "case_in_chief",
      status: "active",
      version,
      sequence: version,
      lastEventId:
        options.lastEventId ?? "event:interruption-resolved:020",
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
    transcript: [...(options.transcript ?? [])],
    permittedObjectionGrounds: ["leading"],
  };
}

const ANSWER_TURN_ID = "turn:witness-answer:020";

function answerTurn(
  turnId = ANSWER_TURN_ID,
): HearingRuntimeViewV1["transcript"][number] {
  return {
    ordinal: 1,
    turnId,
    actor: {
      actorId: "actor:witness:fixture",
      role: "witness",
      side: "neutral",
      witnessId: "witness:fixture",
    },
    text: "I saw the alert that morning.",
    testimonyId: "testimony:fixture:020",
    status: "active",
    citations: {
      factIds: [],
      evidenceIds: [],
      testimonyIds: [],
      eventIds: [],
      sourceSegmentIds: [],
    },
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

  it.each(["\u0000", "\u200b", "\u202e", "\u2066", "\u2069"])(
    "rejects embedded Unicode control or format character %j",
    (character) => {
      for (const field of ["trigger", "final"] as const) {
        const request = requestFixture();
        (request[field] as { text: string }).text =
          `Did you ${character}see the alert?`;
        expect(
          FinalBoundInterruptionRequestSchema.safeParse(request).success,
        ).toBe(false);
      }
    },
  );

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
  type ResponseFixtureOptions = Readonly<{
    ruling?: "sustained" | "overruled";
    remedy?: "rephrase" | "cancel_response" | "resume_response";
    continuation?: "complete" | "pending";
    performanceDisposition?: "current" | "historical";
    answerTurnId?: string | null;
    targetTrialId?: string;
    targetVersion?: number;
    targetLastEventId?: string;
    viewTrialId?: string;
    viewVersion?: number;
    viewLastEventId?: string;
    transcript?: HearingRuntimeViewV1["transcript"];
  }>;

  function responseFixture(options: ResponseFixtureOptions = {}) {
    const targetVersion = options.targetVersion ?? 20;
    const targetLastEventId =
      options.targetLastEventId ?? "event:interruption-resolved:020";
    return {
      schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
      disposition: "ruling_committed" as const,
      interruptId: "interrupt:partial:007",
      ruling: options.ruling ?? ("sustained" as const),
      remedy: options.remedy ?? ("rephrase" as const),
      replayed: false,
      targetCompletionHead: {
        trialId: options.targetTrialId ?? TRIAL_ID,
        stateVersion: targetVersion,
        lastEventId: targetLastEventId,
      },
      continuation: options.continuation ?? ("complete" as const),
      performance: {
        disposition:
          options.performanceDisposition ?? ("current" as const),
        answerTurnId: options.answerTurnId ?? null,
      },
      view: hearingView({
        trialId: options.viewTrialId,
        version: options.viewVersion ?? targetVersion,
        lastEventId: options.viewLastEventId ?? targetLastEventId,
        transcript: options.transcript,
      }),
    };
  }

  const outcomeCrossProduct = (["sustained", "overruled"] as const).flatMap(
    (ruling) =>
      (["complete", "pending"] as const).flatMap((continuation) =>
        (["current", "historical"] as const).flatMap(
          (performanceDisposition) =>
            ([false, true] as const).map((hasAnswerTurn) => {
              const expected =
                ruling === "sustained"
                  ? continuation === "complete" && !hasAnswerTurn
                  : continuation === "pending"
                    ? performanceDisposition === "current" && !hasAnswerTurn
                    : performanceDisposition === "current"
                      ? hasAnswerTurn
                      : !hasAnswerTurn;
              return [
                ruling,
                continuation,
                performanceDisposition,
                hasAnswerTurn,
                expected,
              ] as const;
            }),
        ),
      ),
  );

  it.each(outcomeCrossProduct)(
    "validates the complete outcome cross-product: %s/%s/%s/answer=%s",
    (
      ruling,
      continuation,
      performanceDisposition,
      hasAnswerTurn,
      expected,
    ) => {
      const historical = performanceDisposition === "historical";
      expect(
        FinalBoundInterruptionResponseSchema.safeParse(
          responseFixture({
            ruling,
            remedy:
              ruling === "overruled" ? "resume_response" : "rephrase",
            continuation,
            performanceDisposition,
            answerTurnId: hasAnswerTurn ? ANSWER_TURN_ID : null,
            transcript: hasAnswerTurn ? [answerTurn()] : [],
            viewVersion: historical ? 21 : 20,
            viewLastEventId: historical
              ? "event:later:021"
              : "event:interruption-resolved:020",
          }),
        ).success,
      ).toBe(expected);
    },
  );

  it.each([
    [
      "current sustained completion",
      {
        ruling: "sustained",
        remedy: "rephrase",
        continuation: "complete",
        performanceDisposition: "current",
        answerTurnId: null,
      },
    ],
    [
      "historical sustained completion",
      {
        ruling: "sustained",
        remedy: "cancel_response",
        continuation: "complete",
        performanceDisposition: "historical",
        answerTurnId: null,
        viewVersion: 21,
        viewLastEventId: "event:later:021",
      },
    ],
    [
      "current overruled pending continuation",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "pending",
        performanceDisposition: "current",
        answerTurnId: null,
      },
    ],
    [
      "current overruled completed answer",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        performanceDisposition: "current",
        answerTurnId: ANSWER_TURN_ID,
        transcript: [answerTurn()],
      },
    ],
    [
      "historical overruled completion without answer audio",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        performanceDisposition: "historical",
        answerTurnId: null,
        viewVersion: 21,
        viewLastEventId: "event:later:021",
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, ResponseFixtureOptions]>) (
    "accepts %s",
    (_name, options) => {
      const fixture = responseFixture(options);
      expect(FinalBoundInterruptionResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
      expect(FinalBoundInterruptionResolutionSchema.parse(fixture)).toEqual(
        fixture,
      );
    },
  );

  it.each([
    [
      "a sustained pending continuation",
      { ruling: "sustained", continuation: "pending" },
    ],
    [
      "a sustained answer turn",
      {
        ruling: "sustained",
        continuation: "complete",
        answerTurnId: ANSWER_TURN_ID,
        transcript: [answerTurn()],
      },
    ],
    [
      "an overruled pending historical continuation",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "pending",
        performanceDisposition: "historical",
        viewVersion: 21,
        viewLastEventId: "event:later:021",
      },
    ],
    [
      "an overruled pending answer turn",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "pending",
        answerTurnId: ANSWER_TURN_ID,
        transcript: [answerTurn()],
      },
    ],
    [
      "an overruled current completion without an answer turn",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        performanceDisposition: "current",
      },
    ],
    [
      "an overruled current completion with an unknown answer turn",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        answerTurnId: "turn:witness-answer:unknown",
        transcript: [answerTurn()],
      },
    ],
    [
      "an overruled current completion with a non-final answer turn",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        answerTurnId: ANSWER_TURN_ID,
        transcript: [
          answerTurn(),
          { ...answerTurn("turn:later:021"), ordinal: 2 },
        ],
      },
    ],
    [
      "an overruled current completion with a duplicate answer identity",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        answerTurnId: ANSWER_TURN_ID,
        transcript: [answerTurn(), { ...answerTurn(), ordinal: 2 }],
      },
    ],
    [
      "an overruled current completion with a counsel-authored turn",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        answerTurnId: ANSWER_TURN_ID,
        transcript: [
          {
            ...answerTurn(),
            actor: {
              actorId: "actor:user-counsel",
              role: "user_counsel",
              side: "user",
              witnessId: null,
            },
          },
        ],
      },
    ],
    [
      "an overruled current completion with a stricken witness turn",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        answerTurnId: ANSWER_TURN_ID,
        transcript: [{ ...answerTurn(), status: "stricken" }],
      },
    ],
    [
      "an overruled current completion without testimony",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        answerTurnId: ANSWER_TURN_ID,
        transcript: [{ ...answerTurn(), testimonyId: null }],
      },
    ],
    [
      "an overruled historical completion with answer audio",
      {
        ruling: "overruled",
        remedy: "resume_response",
        continuation: "complete",
        performanceDisposition: "historical",
        answerTurnId: ANSWER_TURN_ID,
        viewVersion: 21,
        viewLastEventId: "event:later:021",
        transcript: [answerTurn()],
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, ResponseFixtureOptions]>) (
    "rejects %s",
    (_name, options) => {
      expect(
        FinalBoundInterruptionResponseSchema.safeParse(
          responseFixture(options),
        ).success,
      ).toBe(false);
    },
  );

  it.each([
    ["sustained", "rephrase", true],
    ["sustained", "cancel_response", true],
    ["overruled", "resume_response", true],
    ["sustained", "resume_response", false],
    ["overruled", "rephrase", false],
    ["overruled", "cancel_response", false],
  ] as const)("validates %s with %s", (ruling, remedy, expected) => {
    const options: ResponseFixtureOptions =
      ruling === "overruled"
        ? {
            ruling,
            remedy,
            continuation: "pending",
          }
        : { ruling, remedy };
    expect(
      FinalBoundInterruptionResponseSchema.safeParse(
        responseFixture(options),
      ).success,
    ).toBe(expected);
  });

  it.each([
    [
      "a view before the target head",
      { targetVersion: 21, viewVersion: 20 },
    ],
    [
      "an equal-version view with a different event",
      { viewLastEventId: "event:fork:020" },
    ],
    [
      "current performance at a later view",
      { viewVersion: 21, viewLastEventId: "event:later:021" },
    ],
    [
      "historical performance at the exact target",
      { performanceDisposition: "historical" },
    ],
    [
      "a target from a different trial",
      { targetTrialId: `trial_${"b".repeat(32)}` },
    ],
    [
      "a view from a different trial",
      { viewTrialId: `trial_${"b".repeat(32)}` },
    ],
  ] satisfies ReadonlyArray<readonly [string, ResponseFixtureOptions]>) (
    "rejects %s",
    (_name, options) => {
      expect(
        FinalBoundInterruptionResponseSchema.safeParse(
          responseFixture(options),
        ).success,
      ).toBe(false);
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

  it.each([
    ["target head", "targetCompletionHead", "ownerId"],
    ["performance", "performance", "speakerActorId"],
  ] as const)(
    "rejects protected authority at the %s boundary",
    (_name, field, authorityField) => {
      const fixture = responseFixture();
      (fixture[field] as Record<string, unknown>)[authorityField] =
        "actor:forged";
      expect(FinalBoundInterruptionResponseSchema.safeParse(fixture).success).toBe(
        false,
      );
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

describe("FinalBoundInterruptionResolutionSchema", () => {
  function withdrawnFixture() {
    return {
      schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
      disposition: "candidate_withdrawn" as const,
      withdrawalId: "withdrawal:partial:007",
      head: {
        trialId: TRIAL_ID,
        stateVersion: 14,
        lastEventId: "event:question-window:014",
      },
    };
  }

  it("parses the strict candidate-withdrawn branch", () => {
    const fixture = withdrawnFixture();
    expect(
      FinalBoundInterruptionCandidateWithdrawnSchema.parse(fixture),
    ).toEqual(fixture);
    expect(FinalBoundInterruptionResolutionSchema.parse(fixture)).toEqual(
      fixture,
    );
  });

  it.each([
    ["root owner", (fixture: Record<string, unknown>) => Object.assign(fixture, { ownerId: "owner:forged" })],
    ["root actor", (fixture: Record<string, unknown>) => Object.assign(fixture, { actorId: "actor:forged" })],
    ["head actor", (fixture: Record<string, unknown>) => Object.assign(fixture.head as object, { actorId: "actor:forged" })],
    ["ruling-branch view", (fixture: Record<string, unknown>) => Object.assign(fixture, { view: hearingView() })],
  ])("rejects candidate-withdrawn authority or mixed field %s", (_name, mutate) => {
    const fixture = withdrawnFixture();
    mutate(fixture);
    expect(
      FinalBoundInterruptionCandidateWithdrawnSchema.safeParse(fixture)
        .success,
    ).toBe(false);
    expect(FinalBoundInterruptionResolutionSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it("rejects a missing, unknown, or branch-inconsistent disposition", () => {
    const missing: Partial<ReturnType<typeof withdrawnFixture>> =
      withdrawnFixture();
    delete missing.disposition;
    expect(FinalBoundInterruptionResolutionSchema.safeParse(missing).success).toBe(
      false,
    );
    expect(
      FinalBoundInterruptionResolutionSchema.safeParse({
        ...withdrawnFixture(),
        disposition: "pending",
      }).success,
    ).toBe(false);
    expect(
      FinalBoundInterruptionResolutionSchema.safeParse({
        ...withdrawnFixture(),
        disposition: "ruling_committed",
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid withdrawal identity or canonical head", () => {
    expect(
      FinalBoundInterruptionResolutionSchema.safeParse({
        ...withdrawnFixture(),
        withdrawalId: "bad withdrawal id",
      }).success,
    ).toBe(false);
    expect(
      FinalBoundInterruptionResolutionSchema.safeParse({
        ...withdrawnFixture(),
        head: { ...withdrawnFixture().head, stateVersion: -1 },
      }).success,
    ).toBe(false);
  });
});
