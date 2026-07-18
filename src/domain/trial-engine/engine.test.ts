import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  applyTrialEvent,
  commitAction,
  createStartTrialAction,
  reduceTrial,
  validateAction,
  type ActorRef,
  type CommitResult,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialEvent,
  type TrialState,
} from "./index";

const TRIAL_ID = "trial_m1_invariants";
const BASE_TIME_MS = Date.parse("2026-07-18T12:00:00.000Z");

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

type Harness = ReturnType<typeof createHarness>;

function createHarness(graph = createThreeWitnessCaseGraphV1Fixture()) {
  let state: TrialState | null = null;
  let identity = 0;
  const events: TrialEvent[] = [];

  function nextIdentity(type: string): { actionId: string; requestedAt: string } {
    identity += 1;
    return {
      actionId: `action_${String(identity).padStart(3, "0")}_${type.toLowerCase()}`,
      requestedAt: new Date(BASE_TIME_MS + identity * 1_000).toISOString(),
    };
  }

  function start(): CommitResult {
    if (state !== null) throw new Error("Harness trial already started");
    const identityFields = nextIdentity("start_trial");
    const action = createStartTrialAction({
      trialId: TRIAL_ID,
      ...identityFields,
      graph,
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
    actor: ActorRef = ACTORS.system,
  ): TrialAction {
    if (state === null) throw new Error("Start the harness trial before drafting actions");
    const identityFields = nextIdentity(type);
    const payloadRecord = payload as unknown as Record<string, unknown>;
    return TrialActionSchema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      ...identityFields,
      trialId: TRIAL_ID,
      expectedStateVersion: state.version,
      actor,
      source: "deterministic",
      causationId: events.at(-1)?.eventId ?? null,
      correlationId: TRIAL_ID,
      responseId:
        typeof payloadRecord.responseId === "string" ? payloadRecord.responseId : null,
      interruptId:
        typeof payloadRecord.interruptId === "string" ? payloadRecord.interruptId : null,
      modelMetadata: null,
      type,
      payload,
    });
  }

  function commit<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef = ACTORS.system,
  ): CommitResult {
    const action = draft(type, payload, actor);
    const result = commitAction(state, action);
    state = result.state;
    events.push(result.event);
    return result;
  }

  return {
    events,
    start,
    draft,
    commit,
    get state(): TrialState {
      if (state === null) throw new Error("Harness trial has not started");
      return state;
    },
  };
}

function expectIssue(state: TrialState, action: TrialAction, code: string): void {
  const result = validateAction(state, action);
  expect(result).toMatchObject({ ok: false, issue: { code } });
}

function enterCaseInChief(harness: Harness): void {
  harness.start();
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
}

function prepareRinaResponse(harness: Harness, suffix = "one"): string {
  harness.commit(
    "CALL_WITNESS",
    { witnessId: "witness_rina_shah", calledBySide: "user" },
    ACTORS.userCounsel,
  );
  harness.commit("SWEAR_WITNESS", { witnessId: "witness_rina_shah" }, ACTORS.judge);
  harness.commit(
    "ASK_QUESTION",
    {
      questionId: `question_${suffix}`,
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
      text: "What did you report in your safety complaint?",
      turnId: `turn_question_${suffix}`,
    },
    ACTORS.userCounsel,
  );
  const responseId = `response_${suffix}`;
  harness.commit(
    "REQUEST_RESPONSE",
    { responseId, actorId: ACTORS.rina.actorId, purpose: "answer_question" },
    ACTORS.system,
  );
  return responseId;
}

function answerRina(harness: Harness, responseId: string, suffix = "one"): CommitResult {
  return harness.commit(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId: `question_${suffix}`,
      witnessId: "witness_rina_shah",
      testimonyId: `testimony_${suffix}`,
      turnId: `turn_answer_${suffix}`,
      text: "I reported that the battery-test interlock had been disabled.",
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    },
    ACTORS.rina,
  );
}

describe("trial action validation", () => {
  it("enforces the exhaustive actor-role permission matrix", () => {
    const harness = createHarness();
    harness.start();

    expectIssue(
      harness.state,
      harness.draft(
        "PROPOSE_ASSERTION",
        {
          factId: "fact_jury_must_not_propose",
          proposition: "The jury cannot create facts in the trial record.",
          provenanceIds: ["provenance_invalid_jury_action"],
          visibility: "public",
        },
        ACTORS.jury,
      ),
      "ACTOR_NOT_PERMITTED",
    );

    expectIssue(
      harness.state,
      harness.draft("DELIBERATE", {}, ACTORS.system),
      "ACTOR_NOT_PERMITTED",
    );
    expectIssue(
      harness.state,
      harness.draft("GENERATE_DEBRIEF", { debriefId: "debrief_invalid" }, ACTORS.system),
      "ACTOR_NOT_PERMITTED",
    );
  });

  it("rejects an illegal phase transition", () => {
    const harness = createHarness();
    harness.start();
    const action = harness.draft("BEGIN_PHASE", { phase: "closing" }, ACTORS.judge);

    expectIssue(harness.state, action, "ILLEGAL_PHASE_TRANSITION");
  });

  it("rejects use of evidence outside the case graph", () => {
    const harness = createHarness();
    harness.start();
    const action = harness.draft(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_not_in_case",
        offeredBySide: "user",
        foundationTestimonyIds: [],
      },
      ACTORS.userCounsel,
    );

    expectIssue(harness.state, action, "UNKNOWN_EVIDENCE");
  });

  it("rejects stale actions and responses independently", () => {
    const staleActionHarness = createHarness();
    staleActionHarness.start();
    const staleAction = staleActionHarness.draft(
      "BEGIN_PHASE",
      { phase: "opening" },
      ACTORS.judge,
    );
    staleActionHarness.commit("PAUSE_TRIAL", {}, ACTORS.judge);
    expectIssue(staleActionHarness.state, staleAction, "STALE_STATE_VERSION");

    const staleResponseHarness = createHarness();
    enterCaseInChief(staleResponseHarness);
    const responseId = prepareRinaResponse(staleResponseHarness, "stale");
    staleResponseHarness.commit(
      "PROPOSE_ASSERTION",
      {
        factId: "fact_intervening_assertion",
        proposition: "An intervening event advanced the canonical state version.",
        provenanceIds: ["prov_intervening_assertion"],
        visibility: "public",
      },
      ACTORS.userCounsel,
    );
    const response = staleResponseHarness.draft(
      "ANSWER_QUESTION",
      {
        responseId,
        questionId: "question_stale",
        witnessId: "witness_rina_shah",
        testimonyId: "testimony_stale",
        turnId: "turn_answer_stale",
        text: "This response was generated against an obsolete state version.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      ACTORS.rina,
    );

    expectIssue(staleResponseHarness.state, response, "STALE_RESPONSE");
  });

  it("binds question responses to the active witness actor", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const responseId = prepareRinaResponse(harness, "actor_binding");
    const answer = harness.draft(
      "ANSWER_QUESTION",
      {
        responseId,
        questionId: "question_actor_binding",
        witnessId: "witness_rina_shah",
        testimonyId: "testimony_actor_binding",
        turnId: "turn_answer_actor_binding",
        text: "I reported the disabled interlock.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: ["evidence_complaint_email"],
      },
      ACTORS.rina,
    );
    const corruptedState: TrialState = {
      ...harness.state,
      pendingResponses: {
        ...harness.state.pendingResponses,
        [responseId]: {
          ...harness.state.pendingResponses[responseId],
          actorId: ACTORS.theo.actorId,
        },
      },
    };

    expectIssue(corruptedState, answer, "ACTOR_NOT_PERMITTED");
  });
});

describe("fact and evidence lifecycles", () => {
  it("keeps generated assertions proposed until explicit verification and ruling", () => {
    const harness = createHarness();
    harness.start();

    harness.commit(
      "PROPOSE_ASSERTION",
      {
        factId: "fact_generated_assertion",
        proposition: "A generated assertion that is not part of authored truth.",
        provenanceIds: ["prov_generated_assertion"],
        visibility: "public",
      },
      ACTORS.userCounsel,
    );
    expect(harness.state.facts.fact_generated_assertion.status).toBe("proposed");
    expect(harness.state.facts.fact_generated_assertion.status).not.toBe("admitted");

    harness.commit("VERIFY_ASSERTION", { factId: "fact_generated_assertion" }, ACTORS.judge);
    expect(harness.state.facts.fact_generated_assertion.status).toBe("verified");

    harness.commit(
      "RULE_ON_ASSERTION",
      {
        factId: "fact_generated_assertion",
        ruling: "admitted",
        reason: "The proposition was verified against authenticated records.",
      },
      ACTORS.judge,
    );
    expect(harness.state.facts.fact_generated_assertion.status).toBe("admitted");
  });

  it("moves facts through reveal, dispute, verify, and exclusion without implicit admission", () => {
    const harness = createHarness();
    harness.start();
    expect(harness.state.facts.fact_manager_accessed_complaint.status).toBe("hidden");

    harness.commit(
      "REVEAL_HIDDEN_FACT",
      { factId: "fact_manager_accessed_complaint" },
      ACTORS.judge,
    );
    expect(harness.state.facts.fact_manager_accessed_complaint).toMatchObject({
      status: "proposed",
      visibility: "public",
    });

    harness.commit(
      "DISPUTE_ASSERTION",
      { factId: "fact_manager_accessed_complaint" },
      ACTORS.userCounsel,
    );
    expect(harness.state.facts.fact_manager_accessed_complaint.status).toBe("disputed");

    harness.commit(
      "VERIFY_ASSERTION",
      { factId: "fact_manager_accessed_complaint" },
      ACTORS.judge,
    );
    expect(harness.state.facts.fact_manager_accessed_complaint.status).toBe("verified");

    harness.commit(
      "RULE_ON_ASSERTION",
      {
        factId: "fact_manager_accessed_complaint",
        ruling: "excluded",
        reason: "The foundation was insufficient for the jury-considerable record.",
      },
      ACTORS.judge,
    );
    expect(harness.state.facts.fact_manager_accessed_complaint.status).toBe("excluded");
  });

  it("supports offer, admission, exclusion, and withdrawal evidence outcomes", () => {
    const harness = createHarness();
    harness.start();

    harness.commit(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        offeredBySide: "user",
        foundationTestimonyIds: [],
      },
      ACTORS.userCounsel,
    );
    expect(harness.state.evidence.evidence_complaint_email.status).toBe("offered");
    harness.commit(
      "WITHDRAW_EVIDENCE",
      { evidenceId: "evidence_complaint_email" },
      ACTORS.userCounsel,
    );
    expect(harness.state.evidence.evidence_complaint_email.status).toBe("withdrawn");

    harness.commit(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_draft_metadata",
        offeredBySide: "opposing",
        foundationTestimonyIds: [],
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "RULE_ON_EVIDENCE",
      {
        evidenceId: "evidence_draft_metadata",
        ruling: "admitted",
        reason: "Authenticated metadata is admissible.",
      },
      ACTORS.judge,
    );
    expect(harness.state.evidence.evidence_draft_metadata.status).toBe("admitted");

    harness.commit(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_revision_history",
        offeredBySide: "user",
        foundationTestimonyIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "RULE_ON_EVIDENCE",
      {
        evidenceId: "evidence_revision_history",
        ruling: "excluded",
        reason: "The proponent did not establish the required foundation.",
      },
      ACTORS.judge,
    );
    expect(harness.state.evidence.evidence_revision_history.status).toBe("excluded");
  });
});

describe("append-only testimony and idempotency", () => {
  it("keeps stricken testimony and its transcript turn in the historical record", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const responseId = prepareRinaResponse(harness);
    answerRina(harness, responseId);
    const originalText = harness.state.testimony.testimony_one.text;

    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_strike_one",
        testimonyIds: ["testimony_one"],
        reason: "The answer exceeded the permitted scope.",
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_strike_one",
        testimonyIds: ["testimony_one"],
        factIds: [],
      },
      ACTORS.judge,
    );

    expect(harness.state.testimony.testimony_one).toMatchObject({
      status: "stricken",
      text: originalText,
      turnId: "turn_answer_one",
    });
    expect(harness.state.transcriptTurns.turn_answer_one).toMatchObject({
      status: "stricken",
      text: originalText,
      testimonyId: "testimony_one",
    });
    expect(harness.state.transcriptTurnIds).toContain("turn_answer_one");
  });

  it("rejects exact duplicate actions and events before applying them again", () => {
    const harness = createHarness();
    harness.start();
    const committed = harness.commit("BEGIN_PHASE", { phase: "opening" }, ACTORS.judge);

    expectIssue(harness.state, committed.action, "DUPLICATE_ACTION_ID");
    expect(() => applyTrialEvent(harness.state, committed.event)).toThrow(/DUPLICATE_EVENT_ID/);
  });
});

describe("interruption and trial-control lifecycles", () => {
  it("resumes a live response after an interruption but cannot resume a cancelled response", () => {
    const resumeHarness = createHarness();
    enterCaseInChief(resumeHarness);
    const resumableResponseId = prepareRinaResponse(resumeHarness, "resume");
    resumeHarness.commit(
      "BEGIN_INTERRUPTION",
      {
        interruptId: "interrupt_resume",
        interruptedResponseId: resumableResponseId,
        objectionId: null,
      },
      ACTORS.opposingCounsel,
    );
    resumeHarness.commit(
      "RESOLVE_INTERRUPTION",
      { interruptId: "interrupt_resume", outcome: "resume" },
      ACTORS.judge,
    );
    resumeHarness.commit(
      "RESUME_INTERRUPTED_SPEECH",
      { interruptId: "interrupt_resume", interruptedResponseId: resumableResponseId },
      ACTORS.system,
    );
    expect(resumeHarness.state.activeInterruption?.status).toBe("resumed");
    expect(resumeHarness.state.pendingResponses[resumableResponseId]).toMatchObject({
      status: "streaming",
      expectedStateVersion: resumeHarness.state.version,
    });
    answerRina(resumeHarness, resumableResponseId, "resume");
    expect(resumeHarness.state.pendingResponses[resumableResponseId].status).toBe("committed");
    resumeHarness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_second_interrupt",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What happened next?",
        turnId: "turn_question_second_interrupt",
      },
      ACTORS.userCounsel,
    );
    resumeHarness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_second_interrupt",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      ACTORS.system,
    );
    resumeHarness.commit(
      "BEGIN_INTERRUPTION",
      {
        interruptId: "interrupt_second",
        interruptedResponseId: "response_second_interrupt",
        objectionId: null,
      },
      ACTORS.opposingCounsel,
    );
    expect(resumeHarness.state.activeInterruption?.interruptId).toBe("interrupt_second");

    const cancelHarness = createHarness();
    enterCaseInChief(cancelHarness);
    const cancelledResponseId = prepareRinaResponse(cancelHarness, "cancel");
    cancelHarness.commit(
      "BEGIN_INTERRUPTION",
      {
        interruptId: "interrupt_cancel",
        interruptedResponseId: cancelledResponseId,
        objectionId: null,
      },
      ACTORS.opposingCounsel,
    );
    cancelHarness.commit(
      "RESOLVE_INTERRUPTION",
      { interruptId: "interrupt_cancel", outcome: "cancel" },
      ACTORS.judge,
    );
    expect(cancelHarness.state.pendingResponses[cancelledResponseId].status).toBe("cancelled");
    const invalidResume = cancelHarness.draft(
      "RESUME_INTERRUPTED_SPEECH",
      { interruptId: "interrupt_cancel", interruptedResponseId: cancelledResponseId },
      ACTORS.system,
    );
    expectIssue(cancelHarness.state, invalidResume, "STALE_RESPONSE");
    cancelHarness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_cancel_retry",
        actorId: ACTORS.rina.actorId,
        purpose: "retry_answer_question",
      },
      ACTORS.system,
    );
    cancelHarness.commit(
      "BEGIN_INTERRUPTION",
      {
        interruptId: "interrupt_after_cancel",
        interruptedResponseId: "response_cancel_retry",
        objectionId: null,
      },
      ACTORS.opposingCounsel,
    );
    expect(cancelHarness.state.activeInterruption?.interruptId).toBe("interrupt_after_cancel");
  });

  it("pauses, resumes, enters recess, and returns to the prior phase", () => {
    const harness = createHarness();
    harness.start();

    harness.commit("PAUSE_TRIAL", {}, ACTORS.judge);
    expect(harness.state.status).toBe("paused");
    harness.commit("RESUME_TRIAL", {}, ACTORS.judge);
    expect(harness.state.status).toBe("active");

    harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
    harness.commit("REQUEST_RECESS", {}, ACTORS.judge);
    expect(harness.state).toMatchObject({
      phase: "recess",
      phaseBeforeRecess: "case_in_chief",
      status: "active",
    });
    harness.commit("RESUME_TRIAL", {}, ACTORS.judge);
    expect(harness.state).toMatchObject({
      phase: "case_in_chief",
      phaseBeforeRecess: null,
      status: "active",
    });
  });
});

describe("settlement lifecycle", () => {
  const terms = (summary: string, amount: number) => ({
    amount,
    currency: "USD" as const,
    nonMonetaryTerms: ["Neutral reference"],
    summary,
  });

  const exactExpiry = (harness: Harness) =>
    harness.state.lastSequence +
    1 +
    harness.state.policySnapshot.settlement.expiresAfterEventCount;

  it("supports counter, rejection, withdrawal, expiry, and acceptance", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    graph.settlement.expiresAfterEventCount = 2;
    const harness = createHarness(graph);
    harness.start();

    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_initial",
        parentOfferId: null,
        terms: terms("Initial claimant offer", 100_000),
        expiresAtSequence: exactExpiry(harness),
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "COUNTER_SETTLEMENT",
      {
        offerId: "offer_counter",
        parentOfferId: "offer_initial",
        terms: terms("Respondent counteroffer", 65_000),
        expiresAtSequence: exactExpiry(harness),
      },
      ACTORS.opposingCounsel,
    );
    expect(harness.state.settlementOffers.offer_initial.status).toBe("countered");
    expect(harness.state.settlementOffers.offer_counter.status).toBe("open");
    harness.commit(
      "REJECT_SETTLEMENT",
      { offerId: "offer_counter" },
      ACTORS.userCounsel,
    );
    expect(harness.state.settlementOffers.offer_counter.status).toBe("rejected");

    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_withdrawn",
        parentOfferId: null,
        terms: terms("Offer later withdrawn", 80_000),
        expiresAtSequence: exactExpiry(harness),
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "WITHDRAW_SETTLEMENT",
      { offerId: "offer_withdrawn" },
      ACTORS.userCounsel,
    );
    expect(harness.state.settlementOffers.offer_withdrawn.status).toBe("withdrawn");

    const expirySequence = exactExpiry(harness);
    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_expiring",
        parentOfferId: null,
        terms: terms("Short-lived offer", 70_000),
        expiresAtSequence: expirySequence,
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "PROPOSE_ASSERTION",
      {
        factId: "fact_expiry_clock_advanced",
        proposition: "A material event advanced the settlement expiry clock.",
        provenanceIds: ["prov_expiry_clock_advanced"],
        visibility: "restricted",
      },
      ACTORS.userCounsel,
    );
    expect(harness.state.lastSequence + 1).toBe(expirySequence);
    harness.commit(
      "EXPIRE_SETTLEMENT",
      { offerId: "offer_expiring" },
      ACTORS.system,
    );
    expect(harness.state.settlementOffers.offer_expiring.status).toBe("expired");

    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_accepted",
        parentOfferId: null,
        terms: terms("Final accepted offer", 85_000),
        expiresAtSequence: exactExpiry(harness),
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "ACCEPT_SETTLEMENT",
      { offerId: "offer_accepted" },
      ACTORS.opposingCounsel,
    );
    expect(harness.state).toMatchObject({
      status: "settled",
      activeSettlementOfferId: null,
      settlementOffers: { offer_accepted: { status: "accepted" } },
    });
  });

  it("requires the counterparty to counter, accept, or reject an offer", () => {
    const harness = createHarness();
    harness.start();
    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_counterparty_only",
        parentOfferId: null,
        terms: terms("Counterparty-only offer", 90_000),
        expiresAtSequence: exactExpiry(harness),
      },
      ACTORS.userCounsel,
    );

    expectIssue(
      harness.state,
      harness.draft(
        "COUNTER_SETTLEMENT",
        {
          offerId: "offer_invalid_same_side_counter",
          parentOfferId: "offer_counterparty_only",
          terms: terms("Invalid same-side counter", 95_000),
          expiresAtSequence: exactExpiry(harness),
        },
        ACTORS.userCounsel,
      ),
      "ACTOR_NOT_PERMITTED",
    );
    expectIssue(
      harness.state,
      harness.draft(
        "ACCEPT_SETTLEMENT",
        { offerId: "offer_counterparty_only" },
        ACTORS.userCounsel,
      ),
      "ACTOR_NOT_PERMITTED",
    );
    expectIssue(
      harness.state,
      harness.draft(
        "REJECT_SETTLEMENT",
        { offerId: "offer_counterparty_only" },
        ACTORS.userCounsel,
      ),
      "ACTOR_NOT_PERMITTED",
    );
  });
});

describe("deterministic replay", () => {
  it("replays the seeded three-witness CaseGraph to byte-identical state twice", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const responseId = prepareRinaResponse(harness, "replay");
    answerRina(harness, responseId, "replay");
    harness.commit(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        offeredBySide: "user",
        foundationTestimonyIds: ["testimony_replay"],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "RULE_ON_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        ruling: "admitted",
        reason: "The witness authenticated the email she sent.",
      },
      ACTORS.judge,
    );

    const first = reduceTrial(harness.events);
    const second = reduceTrial(harness.events);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(harness.state);
    expect(Object.keys(first.witnesses)).toEqual([
      "witness_rina_shah",
      "witness_theo_morgan",
      "witness_maya_ortiz",
    ]);
  });
});
