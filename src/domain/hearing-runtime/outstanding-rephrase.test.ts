import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
} from "../case-graph";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionV3Schema,
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
import { findOutstandingRephraseTarget } from "./outstanding-rephrase";

const BASE_TIME = Date.parse("2026-07-19T20:00:00.000Z");

function createHarness() {
  const graph = CaseGraphV1Schema.parse(
    createThreeWitnessCaseGraphV1Fixture(),
  );
  const bindings = deriveTrialActorBindings(graph);
  const trialId = "trial:outstanding-rephrase";
  let identity = 0;
  let state = commitAction(
    null,
    createStartTrialAction({
      trialId,
      actionId: "action:outstanding-rephrase:start",
      requestedAt: new Date(BASE_TIME).toISOString(),
      graph,
      actors: bindings.map((binding) => binding.actor),
      actorBindings: bindings,
      userSide: "user",
    }),
  ).state;

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
      actionId: `action:outstanding-rephrase:${identity}:${type.toLowerCase()}`,
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

  const userCounsel = actor(
    (candidate) => candidate.role === "user_counsel",
    "USER_COUNSEL_NOT_FOUND",
  );
  const opposingCounsel = actor(
    (candidate) => candidate.role === "opposing_counsel",
    "OPPOSING_COUNSEL_NOT_FOUND",
  );
  const judge = actor(
    (candidate) => candidate.role === "judge",
    "JUDGE_NOT_FOUND",
  );
  const system = actor(
    (candidate) => candidate.role === "system",
    "SYSTEM_NOT_FOUND",
  );
  const witness = actor(
    (candidate) => candidate.witnessId === "witness_rina_shah",
    "WITNESS_NOT_FOUND",
  );

  commit("BEGIN_PHASE", { phase: "case_in_chief" }, judge);
  commit(
    "CALL_WITNESS",
    { witnessId: witness.witnessId!, calledBySide: "user" },
    userCounsel,
  );
  commit("SWEAR_WITNESS", { witnessId: witness.witnessId! }, judge);

  return {
    commit,
    judge,
    opposingCounsel,
    system,
    userCounsel,
    witness,
    get state(): TrialStateV3 {
      return state;
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

function askQuestion(
  harness: Harness,
  questionId: string,
  actor: ActorRef = harness.userCounsel,
): void {
  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId: harness.witness.witnessId!,
      examinationKind: "direct",
      text: `Question text for ${questionId}?`,
      turnId: `turn:${questionId}`,
      presentedEvidenceIds: [],
    },
    actor,
  );
}

function answerQuestion(harness: Harness, questionId: string): void {
  const responseId = `response:${questionId}`;
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId,
      actorId: harness.witness.actorId,
      purpose: "answer_question",
    },
    harness.system,
  );
  harness.commit(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId,
      witnessId: harness.witness.witnessId!,
      testimonyId: `testimony:${questionId}`,
      turnId: `turn:answer:${questionId}`,
      text: `Answer text for ${questionId}.`,
      factIds: [],
      evidenceIds: [],
    },
    harness.witness,
  );
}

function sustainQuestion(
  harness: Harness,
  questionId: string,
  remedy: "rephrase" | "cancel_response" = "rephrase",
): string {
  const objectionId = `objection:${questionId}`;
  const responseId =
    remedy === "cancel_response" ? `response:${questionId}` : null;
  if (responseId) {
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId,
        actorId: harness.witness.actorId,
        purpose: "answer_question",
      },
      harness.system,
    );
  }
  harness.commit(
    "OBJECT",
    {
      objectionId,
      questionId,
      ground: "leading",
      interruptedResponseId: responseId,
    },
    harness.opposingCounsel,
  );
  const interruptId = responseId ? `interrupt:${questionId}` : null;
  if (responseId && interruptId) {
    harness.commit(
      "BEGIN_INTERRUPTION",
      { interruptId, interruptedResponseId: responseId, objectionId },
      harness.system,
    );
  }
  harness.commit(
    "RULE_ON_OBJECTION",
    {
      objectionId,
      ruling: "sustained",
      remedy,
      reason: "The question must be corrected.",
    },
    harness.judge,
  );
  if (interruptId) {
    harness.commit(
      "RESOLVE_INTERRUPTION",
      { interruptId, outcome: "cancel" },
      harness.system,
    );
  }
  return objectionId;
}

function targetForUser(harness: Harness) {
  return findOutstandingRephraseTarget({
    state: harness.state,
    examiningActorId: harness.userCounsel.actorId,
    examiningSide: "user",
  });
}

describe("outstanding rephrase target", () => {
  it("returns the exact sustained question at the current active leg tail", () => {
    const harness = createHarness();
    askQuestion(harness, "question:first");
    const objectionId = sustainQuestion(harness, "question:first");
    const appearanceId = harness.state.activeAppearanceId;

    expect(targetForUser(harness)).toEqual({
      originalQuestionId: "question:first",
      objectionId,
      appearanceId,
      witnessId: harness.witness.witnessId,
      examinationKind: "direct",
    });
  });

  it("does not treat a sustained cancel-response ruling as a rephrase target", () => {
    const harness = createHarness();
    askQuestion(harness, "question:cancelled");
    sustainQuestion(harness, "question:cancelled", "cancel_response");

    expect(targetForUser(harness)).toBeNull();
  });

  it("rejects a wrong examining actor, side, and examination leg", () => {
    const harness = createHarness();
    askQuestion(harness, "question:answered");
    answerQuestion(harness, "question:answered");
    askQuestion(harness, "question:direct-target");
    sustainQuestion(harness, "question:direct-target");

    expect(
      findOutstandingRephraseTarget({
        state: harness.state,
        examiningActorId: harness.opposingCounsel.actorId,
        examiningSide: "opposing",
      }),
    ).toBeNull();
    expect(
      findOutstandingRephraseTarget({
        state: harness.state,
        examiningActorId: harness.userCounsel.actorId,
        examiningSide: "opposing",
      }),
    ).toBeNull();

    harness.commit(
      "END_EXAMINATION",
      {
        witnessId: harness.witness.witnessId!,
        examinationKind: "direct",
        disposition: "completed",
      },
      harness.userCounsel,
    );
    expect(harness.state.appearances[harness.state.activeAppearanceId!].stage).toBe(
      "cross",
    );
    expect(targetForUser(harness)).toBeNull();
  });

  it("does not reuse a target after its rephrased question has been consumed", () => {
    const harness = createHarness();
    askQuestion(harness, "question:original");
    sustainQuestion(harness, "question:original");
    harness.commit(
      "REPHRASE_QUESTION",
      {
        originalQuestionId: "question:original",
        questionId: "question:replacement",
        text: "What happened immediately after you sent the complaint?",
        turnId: "turn:question:replacement",
      },
      harness.userCounsel,
    );
    answerQuestion(harness, "question:replacement");

    expect(targetForUser(harness)).toBeNull();
  });

  it("selects the newest sustained question in a chained rephrase", () => {
    const harness = createHarness();
    askQuestion(harness, "question:original");
    sustainQuestion(harness, "question:original");
    harness.commit(
      "REPHRASE_QUESTION",
      {
        originalQuestionId: "question:original",
        questionId: "question:replacement",
        text: "Did you send the complaint before the meeting?",
        turnId: "turn:question:replacement",
      },
      harness.userCounsel,
    );
    const objectionId = sustainQuestion(harness, "question:replacement");

    expect(targetForUser(harness)).toEqual({
      originalQuestionId: "question:replacement",
      objectionId,
      appearanceId: harness.state.activeAppearanceId,
      witnessId: harness.witness.witnessId,
      examinationKind: "direct",
    });
    expect(
      harness.state.questions["question:replacement"].rephrasesQuestionId,
    ).toBe("question:original");
  });
});
