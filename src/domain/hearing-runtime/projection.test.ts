import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
  type CaseGraph,
} from "../case-graph";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionV3Schema,
  TrialStateV3Schema,
  commitAction,
  createStartTrialAction,
  type ActorRef,
  type TrialActionByType,
  type TrialActionType,
  type TrialStateV3,
} from "../trial-engine";
import {
  actorFromBindings,
  deriveTrialActorBindings,
} from "./actors";
import { buildHearingRuntimeView } from "./projection";
import { HearingCommittedPerformanceSchema } from "./performance";
import {
  HearingRuntimeViewLegacyV1Schema,
  HearingRuntimeViewV1Schema,
} from "./schema";

const BASE_TIME = Date.parse("2026-07-19T06:00:00.000Z");

function createHarness(
  userSide: "user" | "opposing" = "user",
  graph: CaseGraph = createThreeWitnessCaseGraphV1Fixture(),
) {
  const caseGraph = CaseGraphV1Schema.parse(graph);
  const bindings = deriveTrialActorBindings(caseGraph);
  const trialId = `trial:hearing-view:${userSide}`;
  let identity = 0;
  const started = commitAction(
    null,
    createStartTrialAction({
      trialId,
      actionId: `action:start:${userSide}`,
      requestedAt: new Date(BASE_TIME).toISOString(),
      graph: caseGraph,
      actors: bindings.map((binding) => binding.actor),
      actorBindings: bindings,
      userSide,
    }),
  );
  let state = started.state;

  function actor(
    predicate: (candidate: ActorRef) => boolean,
    errorCode: string,
  ): ActorRef {
    return actorFromBindings(bindings, predicate, errorCode);
  }

  function commit<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actionActor: ActorRef,
  ): void {
    identity += 1;
    const payloadRecord = payload as unknown as Record<string, unknown>;
    const action = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId: `action:view:${userSide}:${identity}:${type.toLowerCase()}`,
      trialId,
      expectedStateVersion: state.version,
      actor: actionActor,
      source: "deterministic",
      requestedAt: new Date(BASE_TIME + identity * 1_000).toISOString(),
      causationId: state.eventIds.at(-1) ?? null,
      correlationId: trialId,
      responseId:
        typeof payloadRecord.responseId === "string"
          ? payloadRecord.responseId
          : null,
      interruptId:
        typeof payloadRecord.interruptId === "string"
          ? payloadRecord.interruptId
          : null,
      modelMetadata: null,
      type,
      payload,
    });
    state = commitAction(state, action).state;
  }

  return {
    caseGraph,
    bindings,
    actor,
    commit,
    get state(): TrialStateV3 {
      return state;
    },
  };
}

function enterRinaQuestion(harness: ReturnType<typeof createHarness>): {
  userCounsel: ActorRef;
  opposingCounsel: ActorRef;
  judge: ActorRef;
  system: ActorRef;
  rina: ActorRef;
} {
  const userCounsel = harness.actor(
    (actor) => actor.role === "user_counsel",
    "USER_COUNSEL_NOT_FOUND",
  );
  const opposingCounsel = harness.actor(
    (actor) => actor.role === "opposing_counsel",
    "OPPOSING_COUNSEL_NOT_FOUND",
  );
  const judge = harness.actor(
    (actor) => actor.role === "judge",
    "JUDGE_NOT_FOUND",
  );
  const system = harness.actor(
    (actor) => actor.role === "system",
    "SYSTEM_NOT_FOUND",
  );
  const rina = harness.actor(
    (actor) => actor.witnessId === "witness_rina_shah",
    "RINA_NOT_FOUND",
  );

  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, judge);
  harness.commit(
    "CALL_WITNESS",
    { witnessId: "witness_rina_shah", calledBySide: "user" },
    userCounsel,
  );
  harness.commit(
    "SWEAR_WITNESS",
    { witnessId: "witness_rina_shah" },
    judge,
  );
  harness.commit(
    "ASK_QUESTION",
    {
      questionId: "question:rina:complaint",
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
      text: "When did you send the safety complaint?",
      turnId: "turn:rina:question",
      presentedEvidenceIds: [],
    },
    userCounsel,
  );
  return { userCounsel, opposingCounsel, judge, system, rina };
}

describe("V3 hearing runtime projection", () => {
  it("exposes the first question while keeping an unstarted examination open", () => {
    const harness = createHarness();
    const userCounsel = harness.actor(
      (actor) => actor.role === "user_counsel",
      "USER_COUNSEL_NOT_FOUND",
    );
    const judge = harness.actor(
      (actor) => actor.role === "judge",
      "JUDGE_NOT_FOUND",
    );
    harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, judge);
    harness.commit(
      "CALL_WITNESS",
      { witnessId: "witness_rina_shah", calledBySide: "user" },
      userCounsel,
    );
    harness.commit(
      "SWEAR_WITNESS",
      { witnessId: "witness_rina_shah" },
      judge,
    );

    const view = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: harness.state,
      playerActorId: userCounsel.actorId,
    });
    expect(view.schemaVersion).toBe("hearing-runtime-view.v2");
    expect(HearingRuntimeViewLegacyV1Schema.safeParse(view).success).toBe(false);
    expect(view.activeAppearance?.examinationLeg).toMatchObject({
      kind: "direct",
      ownerSide: "user",
      status: "available",
    });
    expect(view.capabilities).toMatchObject({
      canAskQuestion: true,
      canFinishExamination: false,
    });
  });

  it("renders the dynamic roster, active examination, and ordered canonical transcript", () => {
    const harness = createHarness();
    const actors = enterRinaQuestion(harness);

    const activeView = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: harness.state,
      playerActorId: actors.userCounsel.actorId,
    });
    expect(activeView.witnesses.map(({ witnessId }) => witnessId)).toEqual([
      "witness_rina_shah",
      "witness_theo_morgan",
      "witness_maya_ortiz",
    ]);
    expect(
      activeView.witnesses.every(
        (witness) => witness.callableByPlayer && witness.recallableByPlayer,
      ),
    ).toBe(true);
    expect(activeView.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      invocation: "call",
      stage: "direct",
      examinationLeg: {
        kind: "direct",
        ownerSide: "user",
        status: "in_progress",
        answeredQuestionCount: 0,
      },
    });
    expect(activeView.activeQuestion).toMatchObject({
      questionId: "question:rina:complaint",
      witnessId: "witness_rina_shah",
      askedBy: actors.userCounsel,
      pendingResponseId: null,
      status: "open",
    });
    expect(activeView.capabilities).toEqual({
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
    });
    expect(activeView.transcript).toHaveLength(1);
    expect(activeView.transcript[0]).toMatchObject({
      ordinal: 1,
      turnId: "turn:rina:question",
      actor: actors.userCounsel,
      status: "active",
    });

    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response:rina:complaint",
        actorId: actors.rina.actorId,
        purpose: "answer_question",
      },
      actors.system,
    );
    harness.commit(
      "ANSWER_QUESTION",
      {
        responseId: "response:rina:complaint",
        questionId: "question:rina:complaint",
        witnessId: "witness_rina_shah",
        testimonyId: "testimony:rina:complaint",
        turnId: "turn:rina:answer",
        text: "I sent it at 10:14 AM.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      actors.rina,
    );
    harness.commit(
      "END_EXAMINATION",
      {
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        disposition: "completed",
      },
      actors.userCounsel,
    );
    harness.commit(
      "END_EXAMINATION",
      {
        witnessId: "witness_rina_shah",
        examinationKind: "cross",
        disposition: "waived",
      },
      actors.opposingCounsel,
    );
    harness.commit(
      "RELEASE_WITNESS",
      { witnessId: "witness_rina_shah" },
      actors.userCounsel,
    );
    const theo = harness.actor(
      (actor) => actor.witnessId === "witness_theo_morgan",
      "THEO_NOT_FOUND",
    );
    harness.commit(
      "CALL_WITNESS",
      { witnessId: "witness_theo_morgan", calledBySide: "opposing" },
      actors.opposingCounsel,
    );
    harness.commit(
      "SWEAR_WITNESS",
      { witnessId: "witness_theo_morgan" },
      actors.judge,
    );

    const secondWitnessView = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: harness.state,
      playerActorId: actors.userCounsel.actorId,
    });
    expect(secondWitnessView.witnesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          witnessId: "witness_rina_shah",
          status: "released",
          callCount: 1,
          currentExaminationLeg: null,
        }),
        expect.objectContaining({
          witnessId: "witness_theo_morgan",
          status: "sworn",
          callCount: 1,
          currentExaminationLeg: "direct",
        }),
        expect.objectContaining({
          witnessId: "witness_maya_ortiz",
          status: "available",
          callCount: 0,
        }),
      ]),
    );
    expect(secondWitnessView.activeAppearance).toMatchObject({
      witnessId: theo.witnessId,
      stage: "direct",
    });
    expect(secondWitnessView.transcript.map(({ turnId }) => turnId)).toEqual([
      "turn:rina:question",
      "turn:rina:answer",
    ]);
  });

  it("projects witness call controls from the pinned player-counsel policy", () => {
    const baseGraph = createThreeWitnessCaseGraphV1Fixture();
    const restrictedGraph = CaseGraphV1Schema.parse({
      ...baseGraph,
      witnesses: baseGraph.witnesses.map((witness) =>
        witness.witnessId === "witness_maya_ortiz"
          ? {
              ...witness,
              callableByPartyIds: ["party_redwood_signal"],
            }
          : witness,
      ),
    });
    const harness = createHarness("user", restrictedGraph);
    const player = harness.actor(
      (actor) => actor.role === "user_counsel",
      "USER_COUNSEL_NOT_FOUND",
    );

    const view = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: harness.state,
      playerActorId: player.actorId,
    });
    expect(
      view.witnesses.find(
        (witness) => witness.witnessId === "witness_maya_ortiz",
      ),
    ).toMatchObject({
      callableByPlayer: false,
      recallableByPlayer: false,
    });
  });

  it("omits hidden truth, witness boundaries, strategy memory, and settlement authority", () => {
    const harness = createHarness("opposing");
    const opposingCounsel = harness.actor(
      (actor) => actor.role === "opposing_counsel",
      "OPPOSING_COUNSEL_NOT_FOUND",
    );
    harness.commit(
      "UPDATE_OPPOSING_STRATEGY",
      {
        strategyId: "strategy:redwood",
        revision: 1,
        objectives: ["SECRET_OBJECTIVE_SHOULD_NOT_RENDER"],
        witnessPriorityIds: ["witness_theo_morgan"],
        evidencePriorityIds: ["evidence_draft_metadata"],
        settlementPosture: "avoid",
        privateNotes: ["SECRET_STRATEGY_NOTE_SHOULD_NOT_RENDER"],
      },
      opposingCounsel,
    );

    const view = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: harness.state,
      playerActorId: opposingCounsel.actorId,
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("fact_manager_accessed_complaint");
    expect(serialized).not.toContain(
      "Theo accessed Rina's complaint before editing the termination memorandum.",
    );
    expect(serialized).not.toContain("statement_theo_email");
    expect(serialized).not.toContain("SECRET_OBJECTIVE_SHOULD_NOT_RENDER");
    expect(serialized).not.toContain("SECRET_STRATEGY_NOTE_SHOULD_NOT_RENDER");
    expect(serialized).not.toContain("No admission of liability");
    expect(serialized).not.toContain("policySnapshot");
    expect(serialized).not.toContain("knowledgeBoundary");
    expect(serialized).not.toContain("strategyMemory");
    expect(serialized).not.toContain("authority");
    expect(serialized).not.toContain("sourceSegments");
    expect(serialized).not.toContain("compilerMetadata");
    expect(Object.keys(view.player.settlement ?? {})).toEqual([
      "partyId",
      "currency",
      "offers",
    ]);
    expect(
      HearingRuntimeViewV1Schema.safeParse({
        ...view,
        policySnapshot: harness.state.policySnapshot,
      }).success,
    ).toBe(false);
  });

  it("filters transcript citation identifiers through the player's visible scope", () => {
    const harness = createHarness();
    const actors = enterRinaQuestion(harness);
    const questionTurn = harness.state.transcriptTurns["turn:rina:question"];
    const taintedState = TrialStateV3Schema.parse({
      ...harness.state,
      transcriptTurns: {
        ...harness.state.transcriptTurns,
        [questionTurn.turnId]: {
          ...questionTurn,
          citations: {
            factIds: [
              "fact_complaint_sent",
              "fact_manager_accessed_complaint",
            ],
            evidenceIds: [
              "evidence_complaint_email",
              "evidence_draft_metadata",
            ],
            testimonyIds: [],
            eventIds: [
              harness.state.eventIds[0],
              questionTurn.sourceEventId,
            ],
            sourceSegmentIds: [
              "segment_complaint_email",
              "segment_access_log",
            ],
          },
        },
      },
    });

    const view = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: taintedState,
      playerActorId: actors.userCounsel.actorId,
    });
    expect(view.transcript[0].citations).toEqual({
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
      testimonyIds: [],
      eventIds: [questionTurn.sourceEventId],
      sourceSegmentIds: [],
    });
  });

  it("attaches only exact visible turn-bound semantic cues", () => {
    const harness = createHarness();
    const actors = enterRinaQuestion(harness);
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response:rina:performance",
        actorId: actors.rina.actorId,
        purpose: "answer_question",
      },
      actors.system,
    );
    harness.commit(
      "ANSWER_QUESTION",
      {
        responseId: "response:rina:performance",
        questionId: "question:rina:complaint",
        witnessId: "witness_rina_shah",
        testimonyId: "testimony:rina:performance",
        turnId: "turn:rina:performance",
        text: "I sent the complaint email that morning.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      actors.rina,
    );
    const answerTurn = harness.state.transcriptTurns["turn:rina:performance"];
    const sourceEventId = answerTurn.sourceEventId;
    const cue = HearingCommittedPerformanceSchema.parse({
      schemaVersion: "hearing-committed-performance.v2",
      kind: "witness_answer",
      context: "courtroom",
      head: {
        trialId: harness.state.trialId,
        stateVersion: harness.state.version,
        lastEventId: harness.state.eventIds.at(-1),
      },
      source: {
        callId: "call:rina:performance",
        actionId: sourceEventId.slice("event:".length),
        eventId: sourceEventId,
        turnId: answerTurn.turnId,
        responseId: "response:rina:performance",
        interruptId: null,
        model: "gpt-5.6-luna",
        outputSchemaVersion: "role-responder.witness-answer.output.v1",
        outputHash: "a".repeat(64),
      },
      actor: actors.rina,
      evidenceIds: [],
      semantic: {
        kind: "witness",
        emotion: "nervous",
        intensity: 0.63,
        gazeTarget: "questioning_counsel",
        gesture: "look_away",
        delivery: "hesitant",
      },
    });
    const view = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: harness.state,
      playerActorId: actors.userCounsel.actorId,
      committedPerformances: [cue],
    });
    expect(
      view.transcript.find(({ turnId }) => turnId === answerTurn.turnId)
        ?.semanticCue,
    ).toEqual(cue);

    const hiddenEvidenceCue = HearingCommittedPerformanceSchema.parse({
      ...cue,
      evidenceIds: ["evidence_draft_metadata"],
      semantic: { ...cue.semantic, gesture: "none", gazeTarget: "judge" },
    });
    const redacted = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: harness.state,
      playerActorId: actors.userCounsel.actorId,
      committedPerformances: [hiddenEvidenceCue],
    });
    expect(
      redacted.transcript.find(({ turnId }) => turnId === answerTurn.turnId)
        ?.semanticCue,
    ).toBeNull();
    expect(JSON.stringify(redacted)).not.toContain("evidence_draft_metadata");

    const jury = harness.actor(
      (actor) => actor.role === "jury",
      "JURY_NOT_FOUND",
    );
    const privateOnly = buildHearingRuntimeView({
      caseGraph: harness.caseGraph,
      trialState: harness.state,
      playerActorId: actors.userCounsel.actorId,
      committedPerformances: [
        HearingCommittedPerformanceSchema.parse({
          ...cue,
          kind: "negotiation_decision",
          context: "private_settlement",
          source: {
            ...cue.source,
            callId: "call:private-settlement-canary",
            turnId: null,
          },
          actor: actors.userCounsel,
          semantic: {
            kind: "role",
            activity: "speaking",
            emotion: "neutral",
            intensity: 0.2,
            gesture: "none",
            gazeTarget: "judge",
            speakingStyle: "formal",
          },
        }),
        HearingCommittedPerformanceSchema.parse({
          ...cue,
          kind: "jury_deliberation",
          source: {
            ...cue.source,
            callId: "call:private-jury-canary",
            turnId: null,
          },
          actor: jury,
          semantic: {
            kind: "role",
            activity: "thinking",
            emotion: "neutral",
            intensity: 0.2,
            gesture: "none",
            gazeTarget: "judge",
            speakingStyle: "measured",
          },
        }),
      ],
    });
    expect(JSON.stringify(privateOnly)).not.toContain("private-settlement-canary");
    expect(JSON.stringify(privateOnly)).not.toContain("private-jury-canary");

    const otherWitness = harness.actor(
      (actor) => actor.witnessId === "witness_theo_morgan",
      "THEO_NOT_FOUND",
    );
    expect(() =>
      buildHearingRuntimeView({
        caseGraph: harness.caseGraph,
        trialState: harness.state,
        playerActorId: actors.userCounsel.actorId,
        committedPerformances: [
          HearingCommittedPerformanceSchema.parse({
            ...cue,
            actor: otherWitness,
          }),
        ],
      }),
    ).toThrow("COMMITTED_PERFORMANCE_TURN_BINDING_INVALID");
  });
});
