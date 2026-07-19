import { describe, expect, it } from "vitest";

import {
  HearingPlayerIntentSchema,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";

import {
  buildContinueResponseIntent,
  buildObjectIntent,
  deriveOpponentResponseWindow,
  type OpponentResponseWindow,
} from "./response-window";

const QUESTION_ID = "question:opponent:cross:001";
const QUESTION_TURN_ID = "turn:question:opponent:cross:001";
const RESPONSE_ID = "response:opponent:cross:001";
const APPEARANCE_ID = "appearance:witness:rina:001";
const WITNESS_ID = "witness_rina_shah";
const OPPOSING_COUNSEL_ID = "actor:counsel:opposing";

function responseWindowView(): HearingRuntimeViewV1 {
  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: "hearing-runtime-view.v2",
    case: {
      caseId: "case_safety_report",
      version: 3,
      title: "Shah v. Northstar Freight",
      summary:
        "A fictional educational dispute about a reported warehouse hazard.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction_fictional_civil",
        name: "Fictional Civil Court",
        rulesVersion: "rules.v3",
        governingLaw: "Fictional civil law",
        burdenOfProof: "preponderance",
      },
      issues: [
        {
          issueId: "issue_retaliation",
          title: "Retaliation",
          question: "Did the report materially affect the later decision?",
          burdenPartyId: "party_claimant",
          standard: "More likely than not",
        },
      ],
    },
    trial: {
      trialId: "trial_123e4567e89b42d3a456426614174111",
      phase: "case_in_chief",
      status: "active",
      version: 17,
      sequence: 17,
      lastEventId: "event:request-response:017",
      userSide: "user",
    },
    activeAppearance: {
      appearanceId: APPEARANCE_ID,
      witnessId: WITNESS_ID,
      ordinal: 1,
      invocation: "call",
      callingSide: "user",
      stage: "cross",
      examinationLeg: {
        kind: "cross",
        ownerSide: "opposing",
        status: "in_progress",
        answeredQuestionCount: 1,
      },
    },
    activeQuestion: {
      questionId: QUESTION_ID,
      appearanceId: APPEARANCE_ID,
      witnessId: WITNESS_ID,
      examinationKind: "cross",
      askedBy: {
        actorId: OPPOSING_COUNSEL_ID,
        role: "opposing_counsel",
        side: "opposing",
        witnessId: null,
      },
      questionTurnId: QUESTION_TURN_ID,
      pendingResponseId: RESPONSE_ID,
      presentedEvidenceIds: ["evidence_shift_log"],
      status: "open",
    },
    capabilities: {
      canAskQuestion: false,
      canFinishExamination: false,
      canFinishTrial: false,
      canObject: true,
      canContinueResponse: true,
      canProposeSettlement: false,
      counterableSettlementOfferIds: [],
      acceptableSettlementOfferIds: [],
      rejectableSettlementOfferIds: [],
      withdrawableSettlementOfferIds: [],
    },
    witnesses: [
      {
        witnessId: WITNESS_ID,
        name: "Rina Shah",
        kind: "fact",
        role: "Warehouse supervisor",
        status: "testifying",
        callCount: 1,
        callableByPlayer: false,
        recallableByPlayer: false,
        currentAppearanceId: APPEARANCE_ID,
        currentExaminationLeg: "cross",
      },
    ],
    player: {
      actorId: "actor:counsel:user",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party_claimant",
      facts: [
        {
          factId: "fact_safety_report",
          proposition: "The claimant reported a warehouse hazard.",
          status: "admitted",
        },
      ],
      evidence: [
        {
          evidenceId: "evidence_shift_log",
          name: "Shift log",
          description: "A fictional log offered during the exercise.",
          status: "admitted",
        },
      ],
      settlement: null,
    },
    transcript: [
      {
        ordinal: 1,
        turnId: "turn:answer:direct:001",
        actor: {
          actorId: "actor:witness:rina",
          role: "witness",
          side: "neutral",
          witnessId: WITNESS_ID,
        },
        text: "I entered the report in the shift log that morning.",
        testimonyId: "testimony:direct:001",
        status: "active",
        citations: {
          factIds: ["fact_safety_report"],
          evidenceIds: ["evidence_shift_log"],
          testimonyIds: [],
          eventIds: ["event:answer:direct:011"],
          sourceSegmentIds: [],
        },
      },
      {
        ordinal: 2,
        turnId: QUESTION_TURN_ID,
        actor: {
          actorId: OPPOSING_COUNSEL_ID,
          role: "opposing_counsel",
          side: "opposing",
          witnessId: null,
        },
        text: "The log does not identify who made the later decision, correct?",
        testimonyId: null,
        status: "active",
        citations: {
          factIds: [],
          evidenceIds: ["evidence_shift_log"],
          testimonyIds: [],
          eventIds: ["event:ask-question:016"],
          sourceSegmentIds: [],
        },
      },
    ],
    permittedObjectionGrounds: ["hearsay", "argumentative", "compound"],
  });
}

function requireWindow(view: HearingRuntimeViewV1): OpponentResponseWindow {
  const window = deriveOpponentResponseWindow(view);
  if (window === null) throw new Error("Expected an opponent response window");
  return window;
}

describe("opponent response window", () => {
  it("derives one frozen response identity from a schema-parsed runtime view", () => {
    const window = requireWindow(responseWindowView());

    expect(window).toEqual({
      trialId: "trial_123e4567e89b42d3a456426614174111",
      stateVersion: 17,
      lastEventId: "event:request-response:017",
      appearanceId: APPEARANCE_ID,
      witnessId: WITNESS_ID,
      examinationKind: "cross",
      questionId: QUESTION_ID,
      questionTurnId: QUESTION_TURN_ID,
      responseId: RESPONSE_ID,
      opposingCounselActorId: OPPOSING_COUNSEL_ID,
      canObject: true,
      canContinueResponse: true,
      permittedObjectionGrounds: ["hearsay", "argumentative", "compound"],
    });
    expect(Object.isFrozen(window)).toBe(true);
    expect(Object.isFrozen(window.permittedObjectionGrounds)).toBe(true);
  });

  it("builds frozen, schema-valid intents with the exact question and response IDs", () => {
    const view = responseWindowView();
    const window = requireWindow(view);

    const objection = buildObjectIntent(view, window, "hearsay");
    const continuation = buildContinueResponseIntent(view, window);

    expect(objection).toEqual({
      type: "object",
      questionId: QUESTION_ID,
      responseId: RESPONSE_ID,
      ground: "hearsay",
    });
    expect(continuation).toEqual({
      type: "continue_response",
      responseId: RESPONSE_ID,
    });
    expect(HearingPlayerIntentSchema.safeParse(objection).success).toBe(true);
    expect(HearingPlayerIntentSchema.safeParse(continuation).success).toBe(true);
    expect(Object.isFrozen(objection)).toBe(true);
    expect(Object.isFrozen(continuation)).toBe(true);
  });

  it("rejects a missing response identity and mismatched appearance identity", () => {
    const view = responseWindowView();
    const missingResponse = HearingRuntimeViewV1Schema.parse({
      ...view,
      activeQuestion: { ...view.activeQuestion!, pendingResponseId: null },
    });
    const mismatchedAppearance = HearingRuntimeViewV1Schema.parse({
      ...view,
      activeQuestion: {
        ...view.activeQuestion!,
        appearanceId: "appearance:witness:forged",
      },
    });

    expect(deriveOpponentResponseWindow(missingResponse)).toBeNull();
    expect(deriveOpponentResponseWindow(mismatchedAppearance)).toBeNull();
  });

  it("rejects unavailable object and continue capabilities", () => {
    const view = responseWindowView();
    const expected = requireWindow(view);
    const cannotObject = HearingRuntimeViewV1Schema.parse({
      ...view,
      capabilities: { ...view.capabilities, canObject: false },
    });
    const cannotContinue = HearingRuntimeViewV1Schema.parse({
      ...view,
      capabilities: { ...view.capabilities, canContinueResponse: false },
    });

    expect(deriveOpponentResponseWindow(cannotObject)).toMatchObject({
      canObject: false,
      canContinueResponse: true,
    });
    expect(buildObjectIntent(cannotObject, expected, "hearsay")).toBeNull();
    expect(deriveOpponentResponseWindow(cannotContinue)).toMatchObject({
      canObject: true,
      canContinueResponse: false,
    });
    expect(buildContinueResponseIntent(cannotContinue, expected)).toBeNull();
  });

  it("rejects stale or mismatched response-window identity", () => {
    const view = responseWindowView();
    const expected = requireWindow(view);
    const newerView = HearingRuntimeViewV1Schema.parse({
      ...view,
      trial: {
        ...view.trial,
        version: 18,
        sequence: 18,
        lastEventId: "event:request-response:018",
      },
    });
    const switchedResponse = HearingRuntimeViewV1Schema.parse({
      ...view,
      activeQuestion: {
        ...view.activeQuestion!,
        pendingResponseId: "response:opponent:cross:forged",
      },
    });

    expect(buildObjectIntent(newerView, expected, "hearsay")).toBeNull();
    expect(buildContinueResponseIntent(newerView, expected)).toBeNull();
    expect(buildObjectIntent(switchedResponse, expected, "hearsay")).toBeNull();
    expect(buildContinueResponseIntent(switchedResponse, expected)).toBeNull();
  });

  it("rejects a ground outside the exact permitted set", () => {
    const view = responseWindowView();
    const window = requireWindow(view);

    expect(buildObjectIntent(view, window, "privilege")).toBeNull();
  });

  it("rejects a same-side or transcript-mismatched questioning actor", () => {
    const view = responseWindowView();
    const sameSideActor = {
      actorId: "actor:counsel:user:alternate",
      role: "user_counsel" as const,
      side: "user" as const,
      witnessId: null,
    };
    const sameSideQuestion = HearingRuntimeViewV1Schema.parse({
      ...view,
      activeQuestion: { ...view.activeQuestion!, askedBy: sameSideActor },
      transcript: view.transcript.map((turn) =>
        turn.turnId === QUESTION_TURN_ID
          ? { ...turn, actor: sameSideActor }
          : turn,
      ),
    });
    const mismatchedTurn = HearingRuntimeViewV1Schema.parse({
      ...view,
      transcript: view.transcript.map((turn) =>
        turn.turnId === QUESTION_TURN_ID
          ? {
              ...turn,
              actor: { ...turn.actor, actorId: "actor:counsel:forged" },
            }
          : turn,
      ),
    });

    expect(deriveOpponentResponseWindow(sameSideQuestion)).toBeNull();
    expect(deriveOpponentResponseWindow(mismatchedTurn)).toBeNull();
  });

  it("treats the other side as opposing when the player selected opposing", () => {
    const view = responseWindowView();
    const userCounselActor = {
      actorId: "actor:counsel:user",
      role: "user_counsel" as const,
      side: "user" as const,
      witnessId: null,
    };
    const reversedSides = HearingRuntimeViewV1Schema.parse({
      ...view,
      trial: { ...view.trial, userSide: "opposing" },
      activeAppearance: {
        ...view.activeAppearance!,
        callingSide: "opposing",
        examinationLeg: {
          ...view.activeAppearance!.examinationLeg!,
          ownerSide: "user",
        },
      },
      activeQuestion: {
        ...view.activeQuestion!,
        askedBy: userCounselActor,
      },
      player: {
        ...view.player,
        actorId: "actor:counsel:opposing:player",
        actorRole: "opposing_counsel",
        side: "opposing",
      },
      transcript: view.transcript.map((turn) =>
        turn.turnId === QUESTION_TURN_ID
          ? { ...turn, actor: userCounselActor }
          : turn,
      ),
    });

    expect(deriveOpponentResponseWindow(reversedSides)).toMatchObject({
      opposingCounselActorId: "actor:counsel:user",
      questionId: QUESTION_ID,
      responseId: RESPONSE_ID,
    });
  });
});
