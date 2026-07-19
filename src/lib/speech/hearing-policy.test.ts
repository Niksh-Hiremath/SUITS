import { describe, expect, it } from "vitest";

import {
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "../../domain/hearing-runtime";

import {
  HearingVoicePolicyError,
  freezeHearingVoiceContext,
  selectSpeakableTranscriptDelta,
  splitSpeechPhrases,
  validateHearingVoiceContext,
  voiceContextToIntent,
} from "./hearing-policy";

const TRIAL_ID = `trial_${"v".repeat(32)}`;

function viewFixture(): HearingRuntimeViewV1 {
  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
    case: {
      caseId: "case_voice_policy",
      version: 1,
      title: "Voice policy fixture",
      summary: "A fictional educational hearing.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction_fixture",
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
      version: 3,
      sequence: 3,
      lastEventId: "event_three",
      userSide: "user",
    },
    activeAppearance: {
      appearanceId: "appearance_maya_1",
      witnessId: "witness_maya",
      ordinal: 1,
      invocation: "call",
      callingSide: "user",
      stage: "direct",
      examinationLeg: {
        kind: "direct",
        ownerSide: "user",
        status: "in_progress",
        answeredQuestionCount: 0,
      },
    },
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
      actorId: "actor_user_counsel",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party_user",
      facts: [],
      evidence: [],
      settlement: null,
    },
    transcript: [],
    permittedObjectionGrounds: [],
  });
}

function closingViewFixture(): HearingRuntimeViewV1 {
  const view = viewFixture();
  return {
    ...view,
    activeAppearance: null,
    capabilities: {
      ...view.capabilities,
      canAskQuestion: false,
      canFinishExamination: false,
      canFinishTrial: true,
    },
  };
}

function transcriptTurn(
  ordinal: number,
  role: HearingRuntimeViewV1["transcript"][number]["actor"]["role"],
  side: HearingRuntimeViewV1["transcript"][number]["actor"]["side"],
  status: HearingRuntimeViewV1["transcript"][number]["status"] = "active",
): HearingRuntimeViewV1["transcript"][number] {
  return {
    ordinal,
    turnId: `turn_${ordinal}`,
    actor: {
      actorId:
        role === "user_counsel" ? "actor_user_counsel" : `actor_${role}_${ordinal}`,
      role,
      side,
      witnessId: role === "witness" ? `witness_${ordinal}` : null,
    },
    text: `${role} turn ${ordinal}`,
    testimonyId: role === "witness" ? `testimony_${ordinal}` : null,
    status,
    citations: {
      factIds: [],
      evidenceIds: [],
      testimonyIds: [],
      eventIds: [],
      sourceSegmentIds: [],
    },
  };
}

function expectPolicyError(
  operation: () => unknown,
  code: HearingVoicePolicyError["code"],
): void {
  expect(operation).toThrowError(HearingVoicePolicyError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("hearing voice context policy", () => {
  it("freezes a question against the exact witness, examination leg, and record head", () => {
    const context = freezeHearingVoiceContext("question", viewFixture());

    expect(context).toEqual({
      mode: "question",
      trialId: TRIAL_ID,
      stateVersion: 3,
      lastEventId: "event_three",
      witnessId: "witness_maya",
      examinationKind: "direct",
    });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("freezes closing only when the deterministic view permits it", () => {
    expect(freezeHearingVoiceContext("closing", closingViewFixture())).toEqual({
      mode: "closing",
      trialId: TRIAL_ID,
      stateVersion: 3,
      lastEventId: "event_three",
      witnessId: null,
      examinationKind: null,
    });
    expectPolicyError(
      () => freezeHearingVoiceContext("closing", viewFixture()),
      "CLOSING_NOT_AVAILABLE",
    );
  });

  it("rejects question capture when the player does not own an available leg", () => {
    const view = viewFixture();
    expectPolicyError(
      () =>
        freezeHearingVoiceContext("question", {
          ...view,
          activeAppearance: {
            ...view.activeAppearance!,
            examinationLeg: {
              ...view.activeAppearance!.examinationLeg!,
              ownerSide: "opposing",
            },
          },
        }),
      "QUESTION_NOT_AVAILABLE",
    );
    expectPolicyError(
      () =>
        freezeHearingVoiceContext("question", {
          ...view,
          activeAppearance: {
            ...view.activeAppearance!,
            examinationLeg: {
              ...view.activeAppearance!.examinationLeg!,
              status: "completed",
            },
          },
        }),
      "QUESTION_NOT_AVAILABLE",
    );
    expectPolicyError(
      () =>
        freezeHearingVoiceContext("question", {
          ...view,
          activeAppearance: { ...view.activeAppearance!, stage: "cross" },
        }),
      "QUESTION_NOT_AVAILABLE",
    );
  });

  it("fails closed while busy or pending and when the durable head changes", () => {
    const view = viewFixture();
    const context = freezeHearingVoiceContext("question", view);

    expect(validateHearingVoiceContext(context, view, { busy: true, pending: false })).toMatchObject({
      valid: false,
      code: "HEARING_BUSY",
    });
    expect(validateHearingVoiceContext(context, view, { busy: false, pending: true })).toMatchObject({
      valid: false,
      code: "HEARING_BUSY",
    });
    expect(
      validateHearingVoiceContext(
        context,
        { ...view, trial: { ...view.trial, version: 4 } },
        { busy: false, pending: false },
      ),
    ).toMatchObject({ valid: false, code: "HEARING_HEAD_CHANGED" });
    expect(
      validateHearingVoiceContext(context, null, {
        busy: false,
        pending: false,
      }),
    ).toMatchObject({ valid: false, code: "HEARING_NOT_READY" });
    expect(
      validateHearingVoiceContext(
        context,
        {
          ...view,
          trial: { ...view.trial, trialId: `trial_${"x".repeat(32)}` },
        },
        { busy: false, pending: false },
      ),
    ).toMatchObject({ valid: false, code: "HEARING_HEAD_CHANGED" });
    expect(
      validateHearingVoiceContext(
        context,
        { ...view, trial: { ...view.trial, lastEventId: "event_replaced" } },
        { busy: false, pending: false },
      ),
    ).toMatchObject({ valid: false, code: "HEARING_HEAD_CHANGED" });
  });

  it("revalidates witness, examination kind, and current capability", () => {
    const view = viewFixture();
    const context = freezeHearingVoiceContext("question", view);
    const changedWitness = {
      ...view,
      activeAppearance: {
        ...view.activeAppearance!,
        witnessId: "witness_other",
      },
    };
    expect(
      validateHearingVoiceContext(context, changedWitness, {
        busy: false,
        pending: false,
      }),
    ).toMatchObject({ valid: false, code: "QUESTION_NOT_AVAILABLE" });
    expect(
      validateHearingVoiceContext(
        context,
        {
          ...view,
          capabilities: { ...view.capabilities, canAskQuestion: false },
        },
        { busy: false, pending: false },
      ),
    ).toMatchObject({ valid: false, code: "QUESTION_NOT_AVAILABLE" });
    expect(
      validateHearingVoiceContext(
        context,
        {
          ...view,
          activeAppearance: {
            ...view.activeAppearance!,
            stage: "cross",
            examinationLeg: {
              ...view.activeAppearance!.examinationLeg!,
              kind: "cross",
            },
          },
        },
        { busy: false, pending: false },
      ),
    ).toMatchObject({ valid: false, code: "QUESTION_NOT_AVAILABLE" });
    expect(
      validateHearingVoiceContext(
        context,
        {
          ...view,
          activeQuestion: {
            questionId: "question_open",
            appearanceId: "appearance_maya_1",
            witnessId: "witness_maya",
            examinationKind: "direct",
            askedBy: {
              actorId: "actor_user_counsel",
              role: "user_counsel",
              side: "user",
              witnessId: null,
            },
            questionTurnId: "turn_open_question",
            pendingResponseId: null,
            presentedEvidenceIds: [],
            status: "open",
          },
        },
        { busy: false, pending: false },
      ),
    ).toMatchObject({ valid: false, code: "QUESTION_NOT_AVAILABLE" });
  });

  it("rejects malformed closing context fields even when closing is available", () => {
    const view = closingViewFixture();
    const context = {
      ...freezeHearingVoiceContext("closing", view),
      witnessId: "witness_injected",
    };

    expect(
      validateHearingVoiceContext(context, view, {
        busy: false,
        pending: false,
      }),
    ).toMatchObject({ valid: false, code: "CLOSING_NOT_AVAILABLE" });
  });
});

describe("speakable transcript policy", () => {
  it("never replays transcript from a restored baseline", () => {
    const next = {
      ...viewFixture(),
      transcript: [transcriptTurn(1, "judge", "neutral")],
    };

    expect(selectSpeakableTranscriptDelta(null, next, "baseline")).toEqual({
      ok: true,
      turns: [],
    });
  });

  it("requires an exact prior turn-ID prefix for command and recovery deltas", () => {
    const previous = {
      ...viewFixture(),
      transcript: [transcriptTurn(1, "judge", "neutral")],
    };
    const diverged = {
      ...previous,
      transcript: [
        { ...transcriptTurn(1, "judge", "neutral"), turnId: "turn_rewritten" },
        transcriptTurn(2, "witness", "neutral"),
      ],
    };

    expect(selectSpeakableTranscriptDelta(previous, diverged, "command")).toMatchObject({
      ok: false,
      code: "TRANSCRIPT_DIVERGED",
    });
    expect(selectSpeakableTranscriptDelta(null, diverged, "recovery")).toMatchObject({
      ok: false,
      code: "TRANSCRIPT_DIVERGED",
    });
  });

  it("rejects duplicate turn IDs instead of replaying an appended copy", () => {
    const base = viewFixture();
    const first = transcriptTurn(1, "judge", "neutral");
    const previous = { ...base, transcript: [first] };
    const duplicated = {
      ...base,
      transcript: [first, { ...first, ordinal: 2 }],
    };

    expect(selectSpeakableTranscriptDelta(previous, duplicated, "command")).toMatchObject({
      ok: false,
      code: "TRANSCRIPT_DIVERGED",
    });
    expect(selectSpeakableTranscriptDelta(null, duplicated, "new_hearing")).toMatchObject({
      ok: false,
      code: "TRANSCRIPT_DIVERGED",
    });
  });

  it("accepts valid recovery additions but rejects transcript shrink and trial changes", () => {
    const base = viewFixture();
    const first = transcriptTurn(1, "judge", "neutral");
    const previous = { ...base, transcript: [first] };
    const recovered = {
      ...base,
      transcript: [first, transcriptTurn(2, "witness", "neutral")],
    };

    expect(selectSpeakableTranscriptDelta(previous, recovered, "recovery")).toMatchObject({
      ok: true,
      turns: [{ turnId: "turn_2" }],
    });
    expect(selectSpeakableTranscriptDelta(recovered, previous, "command")).toMatchObject({
      ok: false,
      code: "TRANSCRIPT_DIVERGED",
    });
    expect(
      selectSpeakableTranscriptDelta(
        previous,
        {
          ...recovered,
          trial: { ...recovered.trial, trialId: `trial_${"z".repeat(32)}` },
        },
        "command",
      ),
    ).toMatchObject({ ok: false, code: "TRANSCRIPT_DIVERGED" });
  });

  it("does not replay a historical turn whose status changes under the same ID", () => {
    const base = viewFixture();
    const first = transcriptTurn(1, "witness", "neutral");
    const result = selectSpeakableTranscriptDelta(
      { ...base, transcript: [first] },
      {
        ...base,
        transcript: [{ ...first, status: "stricken" }],
      },
      "command",
    );

    expect(result).toEqual({ ok: true, turns: [] });
  });

  it("speaks only active judge, witness, jury, and other-side counsel additions", () => {
    const base = viewFixture();
    const previous = {
      ...base,
      transcript: [transcriptTurn(1, "judge", "neutral")],
    };
    const added = [
      transcriptTurn(2, "witness", "neutral"),
      transcriptTurn(3, "jury", "neutral"),
      transcriptTurn(4, "opposing_counsel", "opposing"),
      transcriptTurn(5, "user_counsel", "user"),
      transcriptTurn(6, "clerk", "neutral"),
      transcriptTurn(7, "system", "neutral"),
      transcriptTurn(8, "debrief_coach", "neutral"),
      transcriptTurn(9, "judge", "neutral", "stricken"),
      transcriptTurn(10, "opposing_counsel", "neutral"),
    ];
    const result = selectSpeakableTranscriptDelta(
      previous,
      { ...base, transcript: [...previous.transcript, ...added] },
      "command",
    );

    expect(result.ok && result.turns.map((turn) => turn.turnId)).toEqual([
      "turn_2",
      "turn_3",
      "turn_4",
    ]);
  });

  it("derives other-side counsel from userSide rather than the counsel role name", () => {
    const base = viewFixture();
    const opposingPlayer = {
      ...base,
      trial: { ...base.trial, userSide: "opposing" as const },
      player: {
        ...base.player,
        actorId: "actor_opposing_counsel",
        actorRole: "opposing_counsel" as const,
        side: "opposing" as const,
      },
      transcript: [
        transcriptTurn(1, "user_counsel", "user"),
        transcriptTurn(2, "opposing_counsel", "opposing"),
      ],
    };
    const result = selectSpeakableTranscriptDelta(null, opposingPlayer, "new_hearing");

    expect(result.ok && result.turns.map((turn) => turn.turnId)).toEqual(["turn_1"]);
  });
});

describe("speech phrase and intent policy", () => {
  it("splits at sentence and word boundaries without losing normalized text", () => {
    const text = "  First sentence.   Second sentence has several words for splitting!  ";
    const phrases = splitSpeechPhrases(text, { targetChars: 18, maxChars: 40 });

    expect(phrases.join(" ")).toBe(
      "First sentence. Second sentence has several words for splitting!",
    );
    expect(phrases.every((phrase) => phrase.length <= 40)).toBe(true);
    expect(Object.isFrozen(phrases)).toBe(true);
  });

  it("accepts one token above the target but rejects a token above the hard maximum", () => {
    expect(splitSpeechPhrases("12345", { targetChars: 4, maxChars: 5 })).toEqual([
      "12345",
    ]);
    expectPolicyError(
      () => splitSpeechPhrases("x".repeat(513)),
      "SPEECH_TOKEN_TOO_LONG",
    );
  });

  it("enforces the bounded 64-phrase queue and valid option bounds", () => {
    expectPolicyError(
      () =>
        splitSpeechPhrases(Array.from({ length: 65 }, () => "word").join(" "), {
          targetChars: 4,
          maxChars: 8,
        }),
      "SPEECH_PHRASE_LIMIT",
    );
    expectPolicyError(
      () => splitSpeechPhrases("hello", { maxPhrases: 65 }),
      "SPEECH_PHRASE_LIMIT",
    );
    expectPolicyError(
      () => splitSpeechPhrases("hello", { targetChars: 5.5 }),
      "SPEECH_PHRASE_LIMIT",
    );
    expectPolicyError(
      () => splitSpeechPhrases("hello", { targetChars: 10, maxChars: 9 }),
      "SPEECH_PHRASE_LIMIT",
    );
    expectPolicyError(
      () => splitSpeechPhrases("hello", { maxChars: 513 }),
      "SPEECH_PHRASE_LIMIT",
    );
  });

  it("maps normalized final speech to a deterministic question intent", () => {
    const context = freezeHearingVoiceContext("question", viewFixture());

    expect(voiceContextToIntent(context, "  Where   were you?  ")).toEqual({
      type: "ask_question",
      witnessId: "witness_maya",
      examinationKind: "direct",
      text: "Where were you?",
      presentedEvidenceIds: [],
    });
    expect(voiceContextToIntent(context, "x".repeat(8_000))).toMatchObject({
      type: "ask_question",
      text: "x".repeat(8_000),
    });
    expectPolicyError(
      () => voiceContextToIntent(context, "x".repeat(8_001)),
      "SPEECH_TEXT_INVALID",
    );
  });

  it("maps closing speech and rejects empty or oversized final text", () => {
    const context = freezeHearingVoiceContext("closing", closingViewFixture());

    expect(voiceContextToIntent(context, "  The record   proves our case. ")).toEqual({
      type: "finish_trial",
      closingText: "The record proves our case.",
    });
    expectPolicyError(
      () => voiceContextToIntent(context, "   "),
      "SPEECH_TEXT_INVALID",
    );
    expectPolicyError(
      () => voiceContextToIntent(context, "x".repeat(20_001)),
      "SPEECH_TEXT_INVALID",
    );
  });
});
