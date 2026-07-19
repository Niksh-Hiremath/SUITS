import { describe, expect, it } from "vitest";

import {
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";

import { deriveCourtroomPresentation } from "./derive";

const citations = {
  factIds: [],
  evidenceIds: [],
  testimonyIds: [],
  eventIds: [],
  sourceSegmentIds: [],
};

function view(): HearingRuntimeViewV1 {
  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
    case: {
      caseId: "case:test",
      version: 1,
      title: "The Test Record",
      summary: "PRIVATE-LOOKING CASE SUMMARY THAT THE SCENE MUST NOT COPY",
      educationalDisclaimer: "Fictional educational simulation only.",
      jurisdiction: {
        profileId: "jurisdiction:test",
        name: "Test Court",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional law",
        burdenOfProof: "preponderance",
      },
      issues: [],
    },
    trial: {
      trialId: "trial:test",
      phase: "case_in_chief",
      status: "active",
      version: 8,
      sequence: 8,
      lastEventId: "event:8",
      userSide: "user",
    },
    activeAppearance: {
      appearanceId: "appearance:rina:1",
      witnessId: "witness:rina",
      ordinal: 1,
      invocation: "call",
      callingSide: "user",
      stage: "direct",
      examinationLeg: {
        kind: "direct",
        ownerSide: "user",
        status: "in_progress",
        answeredQuestionCount: 1,
      },
    },
    activeQuestion: {
      questionId: "question:2",
      appearanceId: "appearance:rina:1",
      witnessId: "witness:rina",
      examinationKind: "direct",
      askedBy: {
        actorId: "actor:user",
        role: "user_counsel",
        side: "user",
        witnessId: null,
      },
      questionTurnId: "turn:question:2",
      pendingResponseId: "response:2",
      presentedEvidenceIds: [],
      status: "open",
    },
    capabilities: {
      canAskQuestion: false,
      canFinishExamination: false,
      canFinishTrial: false,
      canObject: false,
      canContinueResponse: false,
      canProposeSettlement: false,
      counterableSettlementOfferIds: [],
      acceptableSettlementOfferIds: [],
      rejectableSettlementOfferIds: [],
      withdrawableSettlementOfferIds: [],
    },
    witnesses: [
      {
        witnessId: "witness:rina",
        name: "Rina Sol",
        kind: "fact",
        role: "Operations analyst",
        status: "testifying",
        callCount: 1,
        callableByPlayer: false,
        recallableByPlayer: false,
        currentAppearanceId: "appearance:rina:1",
        currentExaminationLeg: "direct",
      },
    ],
    player: {
      actorId: "actor:user",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party:user",
      facts: [
        {
          factId: "fact:visible",
          proposition: "SCENE-MUST-NOT-COPY-FACT-PROPOSITION",
          status: "verified",
        },
      ],
      evidence: [
        {
          evidenceId: "evidence:email",
          name: "Complaint email",
          description: "SCENE-MUST-NOT-COPY-EVIDENCE-DESCRIPTION",
          status: "admitted",
        },
      ],
      settlement: null,
    },
    transcript: [
      {
        ordinal: 1,
        turnId: "turn:question:1",
        actor: {
          actorId: "actor:user",
          role: "user_counsel",
          side: "user",
          witnessId: null,
        },
        text: "What did you observe?",
        testimonyId: null,
        status: "active",
        citations,
      },
      {
        ordinal: 2,
        turnId: "turn:answer:1",
        actor: {
          actorId: "actor:witness:rina",
          role: "witness",
          side: "neutral",
          witnessId: "witness:rina",
        },
        text: "I saw the warning light.",
        testimonyId: "testimony:1",
        status: "active",
        citations,
      },
    ],
    permittedObjectionGrounds: ["leading"],
  });
}

function character(
  frame: ReturnType<typeof deriveCourtroomPresentation>,
  slot: (typeof frame.characters)[number]["slot"],
) {
  const match = frame.characters.find((candidate) => candidate.slot === slot);
  if (!match) throw new Error(`Missing ${slot} character`);
  return match;
}

describe("courtroom presentation derivation", () => {
  it("creates the complete stable actor ensemble without leaking case knowledge", () => {
    const frame = deriveCourtroomPresentation({
      view: view(),
      speech: null,
      busy: false,
      quality: "balanced",
      reducedMotion: false,
    });

    expect(frame.characters.map(({ slot }) => slot)).toEqual([
      "judge",
      "user_counsel",
      "opposing_counsel",
      "witness",
      "clerk",
      "jury",
    ]);
    expect(character(frame, "witness")).toMatchObject({
      actorId: "actor:witness:rina",
      label: "Rina Sol",
      present: true,
    });
    expect(character(frame, "user_counsel")).toMatchObject({
      actorId: "actor:user",
      animation: "standing",
      posture: "standing",
    });
    expect(JSON.stringify(frame)).not.toMatch(
      /PRIVATE-LOOKING|SCENE-MUST-NOT-COPY/u,
    );
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.characters[0])).toBe(true);
  });

  it("maps local question recording to the user counsel and a close camera", () => {
    const frame = deriveCourtroomPresentation({
      view: view(),
      speech: { lifecycle: "recording", activeMode: "question" },
      busy: false,
      quality: "high",
      reducedMotion: false,
    });

    expect(character(frame, "user_counsel")).toMatchObject({
      animation: "speaking",
      posture: "standing",
      emphasis: 1,
    });
    expect(character(frame, "witness").animation).toBe("listening");
    expect(frame.camera).toEqual({
      shot: "user_counsel_close",
      target: "user_counsel",
      transition: "blend",
    });
  });

  it("does not invent an active speaker from generic playback state", () => {
    const idle = deriveCourtroomPresentation({
      view: view(),
      speech: { lifecycle: "ready", activeMode: null },
      busy: false,
      quality: "balanced",
      reducedMotion: false,
    });
    const speaking = deriveCourtroomPresentation({
      view: view(),
      speech: { lifecycle: "speaking", activeMode: null },
      busy: false,
      quality: "balanced",
      reducedMotion: true,
    });

    expect(character(idle, "witness").animation).toBe("listening");
    expect(character(speaking, "witness").animation).toBe("listening");
    expect(speaking.camera).toMatchObject({
      shot: idle.camera.shot,
      target: idle.camera.target,
      transition: "cut",
    });
  });

  it("shows only visible presented evidence and directs the questioning counsel", () => {
    const input = view();
    const evidenceView = HearingRuntimeViewV1Schema.parse({
      ...input,
      activeQuestion: {
        ...input.activeQuestion,
        presentedEvidenceIds: ["evidence:email"],
        pendingResponseId: null,
      },
    });
    const frame = deriveCourtroomPresentation({
      view: evidenceView,
      speech: { lifecycle: "ready", activeMode: null },
      busy: false,
      quality: "reduced",
      reducedMotion: true,
    });

    expect(frame.display).toEqual({
      mode: "evidence",
      itemId: "evidence:email",
      label: "Complaint email",
      status: "admitted",
    });
    expect(character(frame, "user_counsel")).toMatchObject({
      animation: "presenting_evidence",
      posture: "standing",
    });
    expect(frame.camera.shot).toBe("evidence_display");
  });

  it("marks the pending witness response as thinking without inventing speech", () => {
    const frame = deriveCourtroomPresentation({
      view: view(),
      speech: { lifecycle: "ready", activeMode: null },
      busy: true,
      quality: "balanced",
      reducedMotion: false,
    });

    expect(character(frame, "witness").animation).toBe("thinking");
    expect(frame.camera.target).toBe("witness");
    expect(frame.statusSummary).toBe("Rina Sol is thinking.");
  });

  it("bounds valid long case labels instead of crashing the hearing render", () => {
    const input = view();
    const longWitnessName = `Witness ${"W".repeat(192)}`;
    const longEvidenceName = `Exhibit ${"E".repeat(232)}`;
    const longNameView = HearingRuntimeViewV1Schema.parse({
      ...input,
      activeQuestion: {
        ...input.activeQuestion,
        pendingResponseId: null,
        presentedEvidenceIds: ["evidence:email"],
      },
      witnesses: [{ ...input.witnesses[0], name: longWitnessName }],
      player: {
        ...input.player,
        evidence: [{ ...input.player.evidence[0], name: longEvidenceName }],
      },
    });

    const frame = deriveCourtroomPresentation({
      view: longNameView,
      speech: null,
      busy: false,
      quality: "balanced",
      reducedMotion: false,
    });

    expect(character(frame, "witness").label).toHaveLength(160);
    expect(character(frame, "witness").label.endsWith("…")).toBe(true);
    expect(frame.display.label).toHaveLength(160);
    expect(frame.statusSummary.length).toBeLessThanOrEqual(320);
  });

  it("does not assign the floor to a completed examination leg", () => {
    const input = view();
    const completedLegView = HearingRuntimeViewV1Schema.parse({
      ...input,
      activeAppearance: {
        ...input.activeAppearance,
        examinationLeg: {
          ...input.activeAppearance?.examinationLeg,
          status: "completed",
        },
      },
      activeQuestion: null,
    });
    const frame = deriveCourtroomPresentation({
      view: completedLegView,
      speech: null,
      busy: false,
      quality: "balanced",
      reducedMotion: false,
    });

    expect(character(frame, "user_counsel")).toMatchObject({
      animation: "idle",
      posture: "seated",
      emphasis: 0,
    });
  });
});
