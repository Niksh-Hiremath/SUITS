import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  commitAction,
  createStartTrialAction,
  tryCommitAction,
  type ActorRef,
  type CommitResult,
  type QuestionStateEntry,
  type StrikeMotionStateEntry,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialEngineErrorCode,
  type TrialEvent,
  type TrialState,
  type WitnessAppearanceState,
} from "./index";

const TRIAL_ID = "trial_m3_examination_contract";
const BASE_TIME_MS = Date.parse("2026-07-19T00:00:00.000Z");

const ACTORS = {
  system: {
    actorId: "actor_system",
    role: "system",
    side: "neutral",
    witnessId: null,
  },
  judge: {
    actorId: "actor_judge",
    role: "judge",
    side: "neutral",
    witnessId: null,
  },
  userCounsel: {
    actorId: "actor_user_counsel",
    role: "user_counsel",
    side: "user",
    witnessId: null,
  },
  opposingCounsel: {
    actorId: "actor_opposing_counsel",
    role: "opposing_counsel",
    side: "opposing",
    witnessId: null,
  },
  jury: {
    actorId: "actor_jury",
    role: "jury",
    side: "neutral",
    witnessId: null,
  },
  debriefCoach: {
    actorId: "actor_debrief_coach",
    role: "debrief_coach",
    side: "neutral",
    witnessId: null,
  },
  rina: {
    actorId: "actor_witness_rina",
    role: "witness",
    side: "user",
    witnessId: "witness_rina_shah",
  },
  theo: {
    actorId: "actor_witness_theo",
    role: "witness",
    side: "opposing",
    witnessId: "witness_theo_morgan",
  },
  maya: {
    actorId: "actor_witness_maya",
    role: "witness",
    side: "neutral",
    witnessId: "witness_maya_ortiz",
  },
} as const satisfies Record<string, ActorRef>;

type ExaminationState = TrialState & {
  activeAppearanceId: string | null;
  appearances: Record<string, WitnessAppearanceState>;
  questions: Record<string, QuestionStateEntry>;
  strikeMotions: Record<string, StrikeMotionStateEntry>;
};

function actorBindings(): TrialPolicyActorBindingInput[] {
  return Object.values(ACTORS).map((actor) => ({
    actor,
    representedPartyIds:
      actor.role === "user_counsel"
        ? ["party_rina_shah"]
        : actor.role === "opposing_counsel"
          ? ["party_redwood_signal"]
          : [],
  }));
}

type Harness = ReturnType<typeof createHarness>;

function createHarness() {
  let state: TrialState | null = null;
  let identity = 0;
  const events: TrialEvent[] = [];

  function nextIdentity(type: string): {
    actionId: string;
    requestedAt: string;
  } {
    identity += 1;
    return {
      actionId: `action_exam_${String(identity).padStart(3, "0")}_${type.toLowerCase()}`,
      requestedAt: new Date(BASE_TIME_MS + identity * 1_000).toISOString(),
    };
  }

  function start(): CommitResult {
    if (state !== null) throw new Error("Harness trial already started");
    const action = createStartTrialAction({
      trialId: TRIAL_ID,
      ...nextIdentity("start_trial"),
      graph: createThreeWitnessCaseGraphV1Fixture(),
      actors: Object.values(ACTORS),
      actorBindings: actorBindings(),
    });
    const result = commitAction(null, action);
    state = result.state;
    events.push(result.event);
    return result;
  }

  function draft<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
  ): TrialAction {
    if (state === null) throw new Error("Start the trial before drafting an action");
    const payloadRecord = payload as unknown as Record<string, unknown>;
    return TrialActionSchema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      ...nextIdentity(type),
      trialId: TRIAL_ID,
      expectedStateVersion: state.version,
      actor,
      source: "deterministic",
      causationId: events.at(-1)?.eventId ?? null,
      correlationId: TRIAL_ID,
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
  }

  function commit<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
  ): CommitResult {
    const result = commitAction(state, draft(type, payload, actor));
    state = result.state;
    events.push(result.event);
    return result;
  }

  function reject<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
    expectedCode?: TrialEngineErrorCode,
  ): void {
    if (state === null) throw new Error("Start the trial before validating an action");
    const before = state;
    const result = tryCommitAction(state, draft(type, payload, actor));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error(`Expected ${type} to be rejected`);
    if (expectedCode) expect(result.issue.code).toBe(expectedCode);
    expect(state).toBe(before);
  }

  return {
    events,
    start,
    draft,
    commit,
    reject,
    get state(): TrialState {
      if (state === null) throw new Error("Harness trial has not started");
      return state;
    },
    get examinationState(): ExaminationState {
      if (state === null) throw new Error("Harness trial has not started");
      return state as ExaminationState;
    },
  };
}

function enterCaseInChief(harness: Harness): void {
  harness.start();
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
}

function callAndSwearRina(harness: Harness): CommitResult {
  enterCaseInChief(harness);
  const called = harness.commit(
    "CALL_WITNESS",
    { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
    ACTORS.userCounsel,
  );
  harness.commit(
    "SWEAR_WITNESS",
    { witnessId: ACTORS.rina.witnessId },
    ACTORS.judge,
  );
  return called;
}

type ExaminationKind = "direct" | "cross" | "redirect" | "recross";

function counselFor(kind: ExaminationKind): ActorRef {
  return kind === "direct" || kind === "redirect"
    ? ACTORS.userCounsel
    : ACTORS.opposingCounsel;
}

function askAndAnswer(
  harness: Harness,
  kind: ExaminationKind,
  suffix: string,
): {
  questionId: string;
  questionTurnId: string;
  responseId: string;
  testimonyId: string;
  answerTurnId: string;
} {
  const questionId = `question_${suffix}`;
  const questionTurnId = `turn_question_${suffix}`;
  const responseId = `response_${suffix}`;
  const testimonyId = `testimony_${suffix}`;
  const answerTurnId = `turn_answer_${suffix}`;

  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId: ACTORS.rina.witnessId,
      examinationKind: kind,
      text: `Please answer the ${kind} question for ${suffix}.`,
      turnId: questionTurnId,
      presentedEvidenceIds: [],
    },
    counselFor(kind),
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId,
      actorId: ACTORS.rina.actorId,
      purpose: "answer_question",
    },
    ACTORS.system,
  );
  harness.commit(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId,
      witnessId: ACTORS.rina.witnessId,
      testimonyId,
      turnId: answerTurnId,
      text: `This is Rina's grounded ${kind} answer for ${suffix}.`,
      factIds: ["fact_complaint_sent"],
      evidenceIds: [],
    },
    ACTORS.rina,
  );

  return {
    questionId,
    questionTurnId,
    responseId,
    testimonyId,
    answerTurnId,
  };
}

function endExamination(
  harness: Harness,
  kind: ExaminationKind,
  disposition: "completed" | "waived" = "completed",
): void {
  harness.commit(
    "END_EXAMINATION",
    {
      witnessId: ACTORS.rina.witnessId,
      examinationKind: kind,
      disposition,
    },
    counselFor(kind),
  );
}

function activeAppearance(harness: Harness): WitnessAppearanceState {
  const { activeAppearanceId, appearances } = harness.examinationState;
  expect(activeAppearanceId).not.toBeNull();
  const appearance = appearances[activeAppearanceId ?? "missing"];
  expect(appearance).toBeDefined();
  return appearance;
}

describe("multi-leg witness examination", () => {
  it("advances through redirect and recross, releases, and resets a recalled appearance", () => {
    const harness = createHarness();
    const called = callAndSwearRina(harness);
    const firstAppearanceId = harness.examinationState.activeAppearanceId;

    expect(firstAppearanceId).not.toBeNull();
    expect(activeAppearance(harness)).toMatchObject({
      witnessId: ACTORS.rina.witnessId,
      ordinal: 1,
      invocation: "call",
      callingSide: "user",
      stage: "direct",
      calledEventId: called.event.eventId,
      swornEventId: harness.events.at(-1)?.eventId,
    });

    for (const kind of ["direct", "cross", "redirect", "recross"] as const) {
      const answer = askAndAnswer(harness, kind, `full_${kind}`);
      const question = harness.examinationState.questions[answer.questionId];
      const response = harness.state.pendingResponses[answer.responseId];

      expect(question).toMatchObject({
        appearanceId: firstAppearanceId,
        witnessId: ACTORS.rina.witnessId,
        examinationKind: kind,
        askedByActorId: counselFor(kind).actorId,
        status: "answered",
        responseIds: [answer.responseId],
        activeResponseId: null,
        testimonyId: answer.testimonyId,
      });
      expect(response).toMatchObject({
        appearanceId: firstAppearanceId,
        questionId: answer.questionId,
        witnessId: ACTORS.rina.witnessId,
        status: "committed",
      });

      endExamination(harness, kind);
      expect(activeAppearance(harness).stage).toBe(
        kind === "direct"
          ? "cross"
          : kind === "cross"
            ? "redirect"
            : kind === "redirect"
              ? "recross"
              : "ready_for_release",
      );
    }

    const released = harness.commit(
      "RELEASE_WITNESS",
      { witnessId: ACTORS.rina.witnessId },
      ACTORS.userCounsel,
    );
    expect(harness.examinationState.activeAppearanceId).toBeNull();
    expect(harness.examinationState.appearances[firstAppearanceId ?? "missing"]).toMatchObject({
      stage: "released",
      releasedEventId: released.event.eventId,
    });

    const recalled = harness.commit(
      "RECALL_WITNESS",
      { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
      ACTORS.userCounsel,
    );
    const secondAppearanceId = harness.examinationState.activeAppearanceId;
    const secondAppearance = activeAppearance(harness);

    expect(secondAppearanceId).not.toBe(firstAppearanceId);
    expect(secondAppearance).toMatchObject({
      witnessId: ACTORS.rina.witnessId,
      ordinal: 2,
      invocation: "recall",
      callingSide: "user",
      stage: "awaiting_oath",
      calledEventId: recalled.event.eventId,
      swornEventId: null,
      releasedEventId: null,
    });
    expect(secondAppearance.legs.direct).toMatchObject({
      status: "not_available",
      questionIds: [],
      answeredQuestionCount: 0,
      startedEventId: null,
      endedEventId: null,
    });
    for (const kind of ["cross", "redirect", "recross"] as const) {
      expect(secondAppearance.legs[kind]).toMatchObject({
        status: "not_available",
        questionIds: [],
        answeredQuestionCount: 0,
        startedEventId: null,
        endedEventId: null,
      });
    }
    expect(harness.state.witnesses[ACTORS.rina.witnessId]).toMatchObject({
      appearanceIds: [firstAppearanceId, secondAppearanceId],
      callCount: 2,
    });
  });

  it("allows redirect to be waived before the calling side releases the witness", () => {
    const harness = createHarness();
    callAndSwearRina(harness);

    askAndAnswer(harness, "direct", "waiver_direct");
    endExamination(harness, "direct");
    askAndAnswer(harness, "cross", "waiver_cross");
    endExamination(harness, "cross");
    endExamination(harness, "redirect", "waived");

    expect(activeAppearance(harness)).toMatchObject({
      stage: "ready_for_release",
      legs: {
        redirect: expect.objectContaining({ status: "waived" }),
        recross: expect.objectContaining({ status: "not_available" }),
      },
    });
    harness.commit(
      "RELEASE_WITNESS",
      { witnessId: ACTORS.rina.witnessId },
      ACTORS.userCounsel,
    );
    expect(harness.examinationState.activeAppearanceId).toBeNull();
  });

  it("persists V3 examination-ending counsel speech as a cited transcript turn", () => {
    const harness = createHarness();
    callAndSwearRina(harness);
    askAndAnswer(harness, "direct", "spoken_end_direct");
    endExamination(harness, "direct");
    const cross = askAndAnswer(harness, "cross", "spoken_end_cross");
    const ended = harness.commit(
      "END_EXAMINATION",
      {
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "cross",
        disposition: "completed",
        turnId: "turn_cross_completed",
        text: "No further questions, Your Honor.",
        citations: {
          factIds: [],
          evidenceIds: [],
          testimonyIds: [cross.testimonyId],
          eventIds: [],
          sourceSegmentIds: [],
        },
      },
      ACTORS.opposingCounsel,
    );

    expect(ended.event.citations.testimonyIds).toEqual([
      cross.testimonyId,
    ]);
    expect(harness.state.transcriptTurns.turn_cross_completed).toMatchObject({
      text: "No further questions, Your Honor.",
      actor: ACTORS.opposingCounsel,
      testimonyId: null,
      citations: { testimonyIds: [cross.testimonyId] },
      sourceEventId: ended.event.eventId,
    });
    expect(harness.state.transcriptTurnIds.at(-1)).toBe(
      "turn_cross_completed",
    );
    expect(activeAppearance(harness).stage).toBe("redirect");
  });
});

describe("examination permissions and open-work constraints", () => {
  it("rejects factual and evidentiary claims outside the witness knowledge boundary", () => {
    const harness = createHarness();
    callAndSwearRina(harness);
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_outside_knowledge",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "What do you know about the private draft metadata?",
        turnId: "turn_question_outside_knowledge",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_outside_knowledge",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      ACTORS.system,
    );

    harness.reject(
      "ANSWER_QUESTION",
      {
        responseId: "response_outside_knowledge",
        questionId: "question_outside_knowledge",
        witnessId: ACTORS.rina.witnessId,
        testimonyId: "testimony_unknown_fact",
        turnId: "turn_answer_unknown_fact",
        text: "I know when the private draft was created.",
        factIds: ["fact_draft_created"],
        evidenceIds: [],
      },
      ACTORS.rina,
      "ACTOR_NOT_PERMITTED",
    );
    harness.reject(
      "ANSWER_QUESTION",
      {
        responseId: "response_outside_knowledge",
        questionId: "question_outside_knowledge",
        witnessId: ACTORS.rina.witnessId,
        testimonyId: "testimony_unseen_evidence",
        turnId: "turn_answer_unseen_evidence",
        text: "I reviewed the draft metadata.",
        factIds: [],
        evidenceIds: ["evidence_draft_metadata"],
      },
      ACTORS.rina,
      "ACTOR_NOT_PERMITTED",
    );
  });

  it("rejects the wrong examination owner and out-of-order examination kinds", () => {
    const harness = createHarness();
    callAndSwearRina(harness);

    harness.reject(
      "ASK_QUESTION",
      {
        questionId: "question_wrong_direct_owner",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "Opposing counsel cannot conduct the caller's direct examination.",
        turnId: "turn_wrong_direct_owner",
        presentedEvidenceIds: [],
      },
      ACTORS.opposingCounsel,
      "ACTOR_NOT_PERMITTED",
    );
    harness.reject(
      "ASK_QUESTION",
      {
        questionId: "question_premature_cross",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "cross",
        text: "Cross cannot begin before direct ends.",
        turnId: "turn_premature_cross",
        presentedEvidenceIds: [],
      },
      ACTORS.opposingCounsel,
    );

    askAndAnswer(harness, "direct", "ownership_direct");
    harness.reject(
      "END_EXAMINATION",
      {
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        disposition: "completed",
      },
      ACTORS.opposingCounsel,
      "ACTOR_NOT_PERMITTED",
    );
    endExamination(harness, "direct");

    harness.reject(
      "ASK_QUESTION",
      {
        questionId: "question_wrong_cross_owner",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "cross",
        text: "Calling counsel cannot conduct cross of its own witness.",
        turnId: "turn_wrong_cross_owner",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
      "ACTOR_NOT_PERMITTED",
    );
    harness.reject(
      "ASK_QUESTION",
      {
        questionId: "question_premature_redirect",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "redirect",
        text: "Redirect cannot begin before cross ends.",
        turnId: "turn_premature_redirect",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
  });

  it("binds response work to the active question and blocks ending or releasing with open work", () => {
    const harness = createHarness();
    callAndSwearRina(harness);

    harness.reject(
      "REQUEST_RESPONSE",
      {
        responseId: "response_without_question",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      ACTORS.system,
    );
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_open_work",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "What did you report?",
        turnId: "turn_question_open_work",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.reject(
      "END_EXAMINATION",
      {
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        disposition: "completed",
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_open_work",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      ACTORS.system,
    );

    expect(harness.state.pendingResponses.response_open_work).toMatchObject({
      appearanceId: harness.examinationState.activeAppearanceId,
      questionId: "question_open_work",
      witnessId: ACTORS.rina.witnessId,
      status: "pending",
    });
    expect(harness.examinationState.questions.question_open_work).toMatchObject({
      status: "open",
      responseIds: ["response_open_work"],
      activeResponseId: "response_open_work",
    });
    harness.reject(
      "RELEASE_WITNESS",
      { witnessId: ACTORS.rina.witnessId },
      ACTORS.userCounsel,
    );
    harness.reject(
      "ANSWER_QUESTION",
      {
        responseId: "response_open_work",
        questionId: "question_not_bound_to_response",
        witnessId: ACTORS.rina.witnessId,
        testimonyId: "testimony_wrong_question",
        turnId: "turn_answer_wrong_question",
        text: "This answer targets a different question.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      ACTORS.rina,
    );
    expect(harness.state.pendingResponses.response_open_work.status).toBe("pending");
    expect(harness.examinationState.questions.question_open_work.status).toBe("open");
  });

  it("allows only the calling side to release a ready witness", () => {
    const harness = createHarness();
    callAndSwearRina(harness);
    askAndAnswer(harness, "direct", "release_owner_direct");
    endExamination(harness, "direct");
    askAndAnswer(harness, "cross", "release_owner_cross");
    endExamination(harness, "cross");
    endExamination(harness, "redirect", "waived");

    harness.reject(
      "RELEASE_WITNESS",
      { witnessId: ACTORS.rina.witnessId },
      ACTORS.opposingCounsel,
      "ACTOR_NOT_PERMITTED",
    );
    harness.commit(
      "RELEASE_WITNESS",
      { witnessId: ACTORS.rina.witnessId },
      ACTORS.userCounsel,
    );
  });
});

describe("examination identity and strike-motion integrity", () => {
  it("rejects duplicate question IDs and transcript turn IDs", () => {
    const harness = createHarness();
    callAndSwearRina(harness);
    const first = askAndAnswer(harness, "direct", "duplicate_question_seed");

    harness.reject(
      "ASK_QUESTION",
      {
        questionId: first.questionId,
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "A duplicate question ID must not overwrite the first question.",
        turnId: "turn_question_unique_but_bad_id",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
      "DUPLICATE_ENTITY_ID",
    );
    harness.reject(
      "ASK_QUESTION",
      {
        questionId: "question_unique_but_bad_turn",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "A duplicate turn ID must not overwrite the transcript.",
        turnId: first.questionTurnId,
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
      "DUPLICATE_ENTITY_ID",
    );
    expect(Object.keys(harness.examinationState.questions)).toEqual([first.questionId]);
    expect(harness.state.transcriptTurnIds).toEqual([
      first.questionTurnId,
      first.answerTurnId,
    ]);
  });

  it("rejects duplicate testimony IDs and answer turn IDs without consuming the response", () => {
    const harness = createHarness();
    callAndSwearRina(harness);
    const first = askAndAnswer(harness, "direct", "duplicate_answer_seed");

    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_duplicate_answer_target",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "What happened next?",
        turnId: "turn_question_duplicate_answer_target",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_duplicate_answer_target",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      ACTORS.system,
    );
    harness.reject(
      "ANSWER_QUESTION",
      {
        responseId: "response_duplicate_answer_target",
        questionId: "question_duplicate_answer_target",
        witnessId: ACTORS.rina.witnessId,
        testimonyId: first.testimonyId,
        turnId: "turn_answer_unique_but_bad_testimony",
        text: "A duplicate testimony ID must not overwrite testimony.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      ACTORS.rina,
      "DUPLICATE_ENTITY_ID",
    );
    harness.reject(
      "ANSWER_QUESTION",
      {
        responseId: "response_duplicate_answer_target",
        questionId: "question_duplicate_answer_target",
        witnessId: ACTORS.rina.witnessId,
        testimonyId: "testimony_unique_but_bad_turn",
        turnId: first.answerTurnId,
        text: "A duplicate answer turn ID must not overwrite the transcript.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      ACTORS.rina,
      "DUPLICATE_ENTITY_ID",
    );
    expect(harness.state.pendingResponses.response_duplicate_answer_target.status).toBe(
      "pending",
    );
    expect(harness.examinationState.questions.question_duplicate_answer_target).toMatchObject({
      status: "open",
      activeResponseId: "response_duplicate_answer_target",
      testimonyId: null,
    });
    expect(Object.keys(harness.state.testimony)).toEqual([first.testimonyId]);
  });

  it("records a pending strike motion and accepts only a matching pending ruling", () => {
    const harness = createHarness();
    callAndSwearRina(harness);
    const first = askAndAnswer(harness, "direct", "motion_first");
    const second = askAndAnswer(harness, "direct", "motion_second");

    const moved = harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_pending_first",
        testimonyIds: [first.testimonyId],
        reason: "The answer exceeded the permitted scope.",
      },
      ACTORS.opposingCounsel,
    );
    expect(harness.examinationState.strikeMotions.motion_pending_first).toMatchObject({
      movedByActorId: ACTORS.opposingCounsel.actorId,
      testimonyIds: [first.testimonyId],
      status: "pending",
      sourceEventId: moved.event.eventId,
      rulingEventId: null,
    });

    harness.reject(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_pending_first",
        testimonyIds: [second.testimonyId],
        reason: "A duplicate motion ID cannot replace its original target.",
      },
      ACTORS.opposingCounsel,
      "DUPLICATE_ENTITY_ID",
    );
    harness.reject(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_unknown",
        testimonyIds: [first.testimonyId],
        factIds: [],
      },
      ACTORS.judge,
    );
    harness.reject(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_pending_first",
        testimonyIds: [second.testimonyId],
        factIds: [],
      },
      ACTORS.judge,
    );

    const struck = harness.commit(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_pending_first",
        testimonyIds: [first.testimonyId],
        factIds: ["fact_complaint_sent"],
      },
      ACTORS.judge,
    );
    expect(harness.examinationState.strikeMotions.motion_pending_first).toMatchObject({
      status: "granted",
      rulingEventId: struck.event.eventId,
    });
    expect(harness.state.testimony[first.testimonyId].status).toBe("stricken");
    expect(harness.state.testimony[second.testimonyId].status).toBe("active");
    harness.reject(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_pending_first",
        testimonyIds: [first.testimonyId],
        factIds: [],
      },
      ACTORS.judge,
    );
  });

  it("terminates strike motions through explicit denial or mover withdrawal", () => {
    const harness = createHarness();
    callAndSwearRina(harness);
    const answer = askAndAnswer(harness, "direct", "motion_resolution");

    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_to_deny",
        testimonyIds: [answer.testimonyId],
        reason: "The answer should be removed.",
      },
      ACTORS.opposingCounsel,
    );
    harness.reject(
      "WITHDRAW_STRIKE_MOTION",
      { motionId: "motion_to_deny" },
      ACTORS.userCounsel,
      "ACTOR_NOT_PERMITTED",
    );
    const denied = harness.commit(
      "DENY_STRIKE_MOTION",
      {
        motionId: "motion_to_deny",
        reason: "The answer stayed within the permitted scope.",
      },
      ACTORS.judge,
    );
    expect(harness.examinationState.strikeMotions.motion_to_deny).toMatchObject({
      status: "denied",
      rulingEventId: denied.event.eventId,
    });
    expect(harness.state.testimony[answer.testimonyId].status).toBe("active");

    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_to_withdraw",
        testimonyIds: [answer.testimonyId],
        reason: "Counsel requests a second ruling.",
      },
      ACTORS.opposingCounsel,
    );
    const withdrawn = harness.commit(
      "WITHDRAW_STRIKE_MOTION",
      { motionId: "motion_to_withdraw" },
      ACTORS.opposingCounsel,
    );
    expect(
      harness.examinationState.strikeMotions.motion_to_withdraw,
    ).toMatchObject({
      status: "withdrawn",
      rulingEventId: withdrawn.event.eventId,
    });
    harness.reject(
      "DENY_STRIKE_MOTION",
      {
        motionId: "motion_to_withdraw",
        reason: "A withdrawn motion cannot be ruled on.",
      },
      ACTORS.judge,
    );
  });

  it("prevents resting while a strike motion would become unresolvable", () => {
    const harness = createHarness();
    callAndSwearRina(harness);
    const answer = askAndAnswer(harness, "direct", "motion_before_rest");
    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_pending_at_rest",
        testimonyIds: [answer.testimonyId],
        reason: "The court must resolve this motion before closing the record.",
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "END_EXAMINATION",
      {
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        disposition: "completed",
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "END_EXAMINATION",
      {
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "cross",
        disposition: "waived",
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "RELEASE_WITNESS",
      { witnessId: ACTORS.rina.witnessId },
      ACTORS.userCounsel,
    );

    harness.reject(
      "REST_CASE",
      { side: "user" },
      ACTORS.userCounsel,
      "INVALID_ACTION",
    );
    harness.commit(
      "DENY_STRIKE_MOTION",
      {
        motionId: "motion_pending_at_rest",
        reason: "The testimony remains part of the active record.",
      },
      ACTORS.judge,
    );
    harness.commit("REST_CASE", { side: "user" }, ACTORS.userCounsel);
    expect(harness.state.restedSides).toEqual(["user"]);
  });
});
