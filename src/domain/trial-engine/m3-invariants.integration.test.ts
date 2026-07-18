import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  commitAction,
  createStartTrialAction,
  reduceTrial,
  tryCommitAction,
  type ActorRef,
  type CommitResult,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialEngineErrorCode,
  type TrialEvent,
  type TrialState,
} from "./index";

const TRIAL_ID = "trial_m3_invariant_regressions";
const BASE_TIME_MS = Date.parse("2026-07-19T03:00:00.000Z");

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
      actionId: `action_m3_invariant_${String(identity).padStart(3, "0")}_${type.toLowerCase()}`,
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
    expectedCode: TrialEngineErrorCode,
  ): void {
    if (state === null) throw new Error("Start the trial before rejecting an action");
    const before = state;
    const result = tryCommitAction(state, draft(type, payload, actor));
    expect(result).toMatchObject({
      ok: false,
      issue: { code: expectedCode },
    });
    expect(state).toBe(before);
  }

  return {
    events,
    start,
    commit,
    reject,
    get state(): TrialState {
      if (state === null) throw new Error("Harness trial has not started");
      return state;
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

function enterRinaDirect(harness: Harness): void {
  harness.start();
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
  harness.commit(
    "CALL_WITNESS",
    { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
    ACTORS.userCounsel,
  );
  harness.commit(
    "SWEAR_WITNESS",
    { witnessId: ACTORS.rina.witnessId },
    ACTORS.judge,
  );
}

function settlementTerms(summary: string, amount: number) {
  return {
    amount,
    currency: "USD" as const,
    nonMonetaryTerms: ["Neutral reference"],
    summary,
  };
}

function exactSettlementExpiry(harness: Harness): number {
  return (
    harness.state.lastSequence +
    1 +
    harness.state.policySnapshot.settlement.expiresAfterEventCount
  );
}

describe("Milestone 3 cross-lifecycle invariants", () => {
  it("binds an objection and interruption to the active opposing question-response pair", () => {
    const harness = createHarness();
    enterRinaDirect(harness);
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_objection_binding",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "You sent the complaint before the decision, correct?",
        turnId: "turn_question_objection_binding",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_objection_binding",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      ACTORS.system,
    );
    harness.reject(
      "OBJECT",
      {
        objectionId: "objection_self",
        questionId: "question_objection_binding",
        ground: "leading",
        interruptedResponseId: "response_objection_binding",
      },
      ACTORS.userCounsel,
      "ACTOR_NOT_PERMITTED",
    );
    harness.commit(
      "OBJECT",
      {
        objectionId: "objection_bound",
        questionId: "question_objection_binding",
        ground: "leading",
        interruptedResponseId: "response_objection_binding",
      },
      ACTORS.opposingCounsel,
    );
    harness.reject(
      "OBJECT",
      {
        objectionId: "objection_duplicate_pending",
        questionId: "question_objection_binding",
        ground: "argumentative",
        interruptedResponseId: "response_objection_binding",
      },
      ACTORS.opposingCounsel,
      "INVALID_OBJECTION_STATUS",
    );
    harness.reject(
      "BEGIN_INTERRUPTION",
      {
        interruptId: "interrupt_wrong_objection",
        interruptedResponseId: "response_objection_binding",
        objectionId: "objection_unknown",
      },
      ACTORS.opposingCounsel,
      "UNKNOWN_OBJECTION",
    );
    harness.commit(
      "BEGIN_INTERRUPTION",
      {
        interruptId: "interrupt_bound",
        interruptedResponseId: "response_objection_binding",
        objectionId: "objection_bound",
      },
      ACTORS.opposingCounsel,
    );
    harness.reject(
      "RULE_ON_OBJECTION",
      {
        objectionId: "objection_bound",
        ruling: "overruled",
        remedy: "none",
        reason: "An interrupted response must resume explicitly.",
      },
      ACTORS.judge,
      "INVALID_OBJECTION_STATUS",
    );
    harness.commit(
      "RULE_ON_OBJECTION",
      {
        objectionId: "objection_bound",
        ruling: "overruled",
        remedy: "resume_response",
        reason: "The question is permitted in this educational simulation.",
      },
      ACTORS.judge,
    );
    harness.reject(
      "RESOLVE_INTERRUPTION",
      { interruptId: "interrupt_bound", outcome: "cancel" },
      ACTORS.judge,
      "INVALID_INTERRUPTION_STATUS",
    );
    harness.commit(
      "RESOLVE_INTERRUPTION",
      { interruptId: "interrupt_bound", outcome: "resume" },
      ACTORS.judge,
    );
    harness.commit(
      "RESUME_INTERRUPTED_SPEECH",
      {
        interruptId: "interrupt_bound",
        interruptedResponseId: "response_objection_binding",
      },
      ACTORS.system,
    );
    harness.commit(
      "ANSWER_QUESTION",
      {
        responseId: "response_objection_binding",
        questionId: "question_objection_binding",
        witnessId: ACTORS.rina.witnessId,
        testimonyId: "testimony_objection_binding",
        turnId: "turn_answer_objection_binding",
        text: "Yes. I sent it before the final decision.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      ACTORS.rina,
    );

    expect(harness.state.objections.objection_bound).toMatchObject({
      status: "overruled",
      remedy: "resume_response",
    });
    expect(harness.state.activeInterruption?.status).toBe("resumed");
    expect(harness.state.pendingResponses.response_objection_binding.status).toBe(
      "committed",
    );
  });

  it("rejects a strike ruling that names a fact absent from every matched testimony", () => {
    const harness = createHarness();
    enterRinaDirect(harness);
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_strike_scope",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "When did you send the safety complaint?",
        turnId: "turn_question_strike_scope",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_strike_scope",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      ACTORS.system,
    );
    harness.commit(
      "ANSWER_QUESTION",
      {
        responseId: "response_strike_scope",
        questionId: "question_strike_scope",
        witnessId: ACTORS.rina.witnessId,
        testimonyId: "testimony_strike_scope",
        turnId: "turn_answer_strike_scope",
        text: "I sent the complaint on March 10.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      ACTORS.rina,
    );
    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_strike_scope",
        testimonyIds: ["testimony_strike_scope"],
        reason: "The answer exceeded the permitted scope.",
      },
      ACTORS.opposingCounsel,
    );

    const unrelatedFactBefore = harness.state.facts.fact_draft_created;
    harness.reject(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_strike_scope",
        testimonyIds: ["testimony_strike_scope"],
        factIds: ["fact_draft_created"],
      },
      ACTORS.judge,
      "INVALID_ACTION",
    );

    expect(harness.state.strikeMotions.motion_strike_scope.status).toBe("pending");
    expect(harness.state.testimony.testimony_strike_scope.status).toBe("active");
    expect(harness.state.facts.fact_draft_created).toBe(unrelatedFactBefore);
  });

  it("closes all active courtroom work when settlement is accepted and completes through debrief", () => {
    const harness = createHarness();
    harness.start();
    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_accepted_during_question",
        parentOfferId: null,
        proposedByPartyId: "party_rina_shah",
        recipientPartyIds: ["party_redwood_signal"],
        terms: settlementTerms("Claimant proposes a complete resolution.", 90_000),
        expiresAtSequence: exactSettlementExpiry(harness),
      },
      ACTORS.userCounsel,
    );
    harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
    harness.commit(
      "CALL_WITNESS",
      { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
      ACTORS.userCounsel,
    );
    harness.commit(
      "SWEAR_WITNESS",
      { witnessId: ACTORS.rina.witnessId },
      ACTORS.judge,
    );
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_open_at_settlement",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "What happened after you sent the complaint?",
        turnId: "turn_question_open_at_settlement",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_open_at_settlement",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      ACTORS.system,
    );
    harness.commit(
      "OBJECT",
      {
        objectionId: "objection_open_at_settlement",
        questionId: "question_open_at_settlement",
        ground: "speculation",
        interruptedResponseId: "response_open_at_settlement",
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "BEGIN_INTERRUPTION",
      {
        interruptId: "interrupt_open_at_settlement",
        interruptedResponseId: "response_open_at_settlement",
        objectionId: "objection_open_at_settlement",
      },
      ACTORS.opposingCounsel,
    );

    harness.commit(
      "ACCEPT_SETTLEMENT",
      { offerId: "offer_accepted_during_question" },
      ACTORS.opposingCounsel,
    );

    expect(harness.state).toMatchObject({
      phase: "debrief",
      status: "settled",
      activeWitnessId: null,
      activeAppearanceId: null,
      activeQuestionId: null,
      activeInterruption: null,
      activeSettlementOfferId: null,
      settlementOffers: {
        offer_accepted_during_question: { status: "accepted" },
      },
      questions: {
        question_open_at_settlement: {
          status: "withdrawn",
          activeResponseId: null,
        },
      },
      objections: {
        objection_open_at_settlement: { status: "withdrawn" },
      },
      pendingResponses: {
        response_open_at_settlement: { status: "cancelled" },
      },
    });
    const appearance = Object.values(harness.state.appearances)[0];
    expect(appearance).toMatchObject({
      stage: "released",
      legs: { direct: { status: "terminated" } },
    });
    expect(
      Object.values(appearance.legs).some((leg) =>
        leg.status === "available" || leg.status === "in_progress"),
    ).toBe(false);
    expect(
      Object.values(harness.state.questions).some(
        (question) => question.status === "open"),
    ).toBe(false);
    expect(
      Object.values(harness.state.objections).some(
        (objection) => objection.status === "pending"),
    ).toBe(false);
    expect(
      Object.values(harness.state.pendingResponses).some((response) =>
        response.status === "pending" || response.status === "streaming"),
    ).toBe(false);

    harness.commit(
      "GENERATE_DEBRIEF",
      { debriefId: "debrief_settled_trial" },
      ACTORS.debriefCoach,
    );
    harness.commit("BEGIN_PHASE", { phase: "complete" }, ACTORS.judge);

    expect(harness.state).toMatchObject({
      phase: "complete",
      status: "complete",
      debriefId: "debrief_settled_trial",
    });
    expect(reduceTrial(harness.events)).toEqual(harness.state);
    expect(
      reduceTrial(JSON.parse(JSON.stringify(harness.events)) as unknown[]),
    ).toEqual(harness.state);
  });

  it("enforces one active settlement chain and rejects action on its inactive parent", () => {
    const harness = createHarness();
    harness.start();
    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_chain_initial",
        parentOfferId: null,
        proposedByPartyId: "party_rina_shah",
        recipientPartyIds: ["party_redwood_signal"],
        terms: settlementTerms("Initial claimant offer.", 95_000),
        expiresAtSequence: exactSettlementExpiry(harness),
      },
      ACTORS.userCounsel,
    );

    harness.reject(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_parallel_forbidden",
        parentOfferId: null,
        proposedByPartyId: "party_redwood_signal",
        recipientPartyIds: ["party_rina_shah"],
        terms: settlementTerms("Independent respondent proposal.", 70_000),
        expiresAtSequence: exactSettlementExpiry(harness),
      },
      ACTORS.opposingCounsel,
      "INVALID_SETTLEMENT_STATUS",
    );

    harness.commit(
      "COUNTER_SETTLEMENT",
      {
        offerId: "offer_chain_counter",
        parentOfferId: "offer_chain_initial",
        proposedByPartyId: "party_redwood_signal",
        recipientPartyIds: ["party_rina_shah"],
        terms: settlementTerms("Respondent counteroffer.", 70_000),
        expiresAtSequence: exactSettlementExpiry(harness),
      },
      ACTORS.opposingCounsel,
    );
    expect(harness.state).toMatchObject({
      activeSettlementOfferId: "offer_chain_counter",
      settlementOffers: {
        offer_chain_initial: { status: "countered" },
        offer_chain_counter: { status: "open" },
      },
    });

    harness.reject(
      "REJECT_SETTLEMENT",
      { offerId: "offer_chain_initial" },
      ACTORS.opposingCounsel,
      "INVALID_SETTLEMENT_STATUS",
    );
    harness.commit(
      "REJECT_SETTLEMENT",
      { offerId: "offer_chain_counter" },
      ACTORS.userCounsel,
    );
    expect(harness.state.activeSettlementOfferId).toBeNull();
  });
});
