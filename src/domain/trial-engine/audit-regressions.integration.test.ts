import { describe, expect, it } from "vitest";

import {
  createThreeWitnessCaseGraphV1Fixture,
  type CaseGraph,
} from "../case-graph";
import { buildKnowledgeView } from "../knowledge";
import {
  settlementExpirySequence,
  type TrialPolicyActorBindingInput,
} from "../trial-policy";
import {
  NO_CITATIONS,
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  TrialStateSchema,
  commitAction,
  createStartTrialAction,
  reduceTrial,
  tryCommitAction,
  validateAction,
  type ActorRef,
  type CommitResult,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialEngineErrorCode,
  type TrialEvent,
  type TrialState,
} from "./index";

const BASE_TIME_MS = Date.parse("2026-07-19T02:00:00.000Z");

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

function createHarness(
  suffix: string,
  graph: CaseGraph = createThreeWitnessCaseGraphV1Fixture(),
) {
  const trialId = `trial_audit_${suffix}`;
  let state: TrialState | null = null;
  let identity = 0;
  const events: TrialEvent[] = [];

  function nextIdentity(type: string): {
    actionId: string;
    requestedAt: string;
  } {
    identity += 1;
    return {
      actionId: `action_${suffix}_${String(identity).padStart(3, "0")}_${type.toLowerCase()}`,
      requestedAt: new Date(BASE_TIME_MS + identity * 1_000).toISOString(),
    };
  }

  function start(): CommitResult {
    if (state !== null) throw new Error("Harness trial already started");
    const action = createStartTrialAction({
      trialId,
      ...nextIdentity("start_trial"),
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
    actor: ActorRef,
  ): TrialAction {
    if (state === null) throw new Error("Start the trial before drafting an action");
    const payloadRecord = payload as unknown as Record<string, unknown>;
    return TrialActionSchema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      ...nextIdentity(type),
      trialId,
      expectedStateVersion: state.version,
      actor,
      source: "deterministic",
      causationId: events.at(-1)?.eventId ?? null,
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
    if (state === null) throw new Error("Start the trial before rejecting an action");
    const before = state;
    const result = tryCommitAction(state, draft(type, payload, actor));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error(`Expected ${type} to be rejected`);
    if (expectedCode) expect(result.issue.code).toBe(expectedCode);
    expect(state).toBe(before);
  }

  return {
    events,
    graph,
    trialId,
    start,
    draft,
    commit,
    reject,
    get state(): TrialState {
      if (state === null) throw new Error("Harness trial has not started");
      return state;
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

function enterCaseInChief(harness: Harness): void {
  harness.start();
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
}

function callAndSwear(
  harness: Harness,
  witness: ActorRef & { witnessId: string },
  counsel: ActorRef,
  calledBySide: "user" | "opposing",
): void {
  harness.commit(
    "CALL_WITNESS",
    { witnessId: witness.witnessId, calledBySide },
    counsel,
  );
  harness.commit(
    "SWEAR_WITNESS",
    { witnessId: witness.witnessId },
    ACTORS.judge,
  );
}

function askAndAnswer(
  harness: Harness,
  input: {
    suffix: string;
    counsel: ActorRef;
    witness: ActorRef & { witnessId: string };
    factIds: string[];
    evidenceIds?: string[];
  },
): string {
  const questionId = `question_${input.suffix}`;
  const responseId = `response_${input.suffix}`;
  const testimonyId = `testimony_${input.suffix}`;
  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId: input.witness.witnessId,
      examinationKind: "direct",
      text: `Foundation question ${input.suffix}?`,
      turnId: `turn_question_${input.suffix}`,
      presentedEvidenceIds: input.evidenceIds ?? [],
    },
    input.counsel,
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId,
      actorId: input.witness.actorId,
      purpose: `answer_${input.suffix}`,
    },
    ACTORS.system,
  );
  harness.commit(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId,
      witnessId: input.witness.witnessId,
      testimonyId,
      turnId: `turn_answer_${input.suffix}`,
      text: `Answer ${input.suffix}.`,
      factIds: input.factIds,
      evidenceIds: input.evidenceIds ?? [],
    },
    input.witness,
  );
  return testimonyId;
}

function toClosing(harness: Harness): void {
  enterCaseInChief(harness);
  harness.commit("REST_CASE", { side: "user" }, ACTORS.userCounsel);
  harness.commit("REST_CASE", { side: "opposing" }, ACTORS.opposingCounsel);
  harness.commit("BEGIN_PHASE", { phase: "pre_closing" }, ACTORS.judge);
  harness.commit("BEGIN_PHASE", { phase: "closing" }, ACTORS.judge);
}

function giveClosing(
  harness: Harness,
  side: "user" | "opposing",
  suffix: string,
): void {
  harness.commit(
    "GIVE_CLOSING",
    {
      side,
      turnId: `turn_closing_${suffix}`,
      text: `Closing argument ${suffix}.`,
      citations: NO_CITATIONS,
    },
    side === "user" ? ACTORS.userCounsel : ACTORS.opposingCounsel,
  );
}

function toJuryInstructions(harness: Harness): string {
  toClosing(harness);
  giveClosing(harness, "user", "user");
  giveClosing(harness, "opposing", "opposing");
  harness.commit("BEGIN_PHASE", { phase: "jury_instructions" }, ACTORS.judge);
  const instructionId = harness.graph.juryInstructions[0]?.instructionId;
  if (!instructionId) throw new Error("Fixture must contain a jury instruction");
  return instructionId;
}

function toVerdict(harness: Harness): void {
  const instructionId = toJuryInstructions(harness);
  harness.commit("INSTRUCT_JURY", { instructionIds: [instructionId] }, ACTORS.judge);
  harness.commit("BEGIN_PHASE", { phase: "deliberation" }, ACTORS.judge);
  harness.commit("DELIBERATE", {}, ACTORS.jury);
  harness.commit("BEGIN_PHASE", { phase: "verdict" }, ACTORS.judge);
}

function renderVerdict(harness: Harness, suffix: string): void {
  harness.commit(
    "RENDER_VERDICT",
    {
      verdictId: `verdict_${suffix}`,
      decision: `Decision ${suffix}.`,
      citations: NO_CITATIONS,
    },
    ACTORS.judge,
  );
}

describe("audit regressions: role isolation and policy trust", () => {
  it("keeps unseen exhibits, unknown facts, and other testimony out of the entire witness view", () => {
    const harness = createHarness("witness_scope");
    const start = harness.start();
    const unknownFactId = "fact_manager_accessed_complaint";
    const unseenEvidenceId = "evidence_draft_metadata";
    const testimonyId = "testimony_theo_private";
    const turnId = "turn_theo_private";
    const currentTurnId = "turn_rina_current_exchange";
    const trial = TrialStateSchema.parse({
      ...harness.state,
      facts: {
        ...harness.state.facts,
        [unknownFactId]: {
          ...harness.state.facts[unknownFactId],
          status: "admitted",
          visibility: "public",
        },
      },
      evidence: {
        ...harness.state.evidence,
        [unseenEvidenceId]: {
          ...harness.state.evidence[unseenEvidenceId],
          status: "admitted",
          foundationTestimonyIds: [testimonyId],
        },
      },
      testimony: {
        [testimonyId]: {
          testimonyId,
          turnId,
          witnessId: ACTORS.theo.witnessId,
          questionId: "question_theo_private",
          text: "Theo disclosed the private access sequence.",
          status: "active",
          factIds: [unknownFactId],
          evidenceIds: [unseenEvidenceId],
          sourceEventId: start.event.eventId,
          lastEventId: start.event.eventId,
        },
      },
      transcriptTurns: {
        [turnId]: {
          turnId,
          actor: ACTORS.theo,
          text: "Theo disclosed the private access sequence.",
          testimonyId,
          citations: {
            factIds: [unknownFactId],
            evidenceIds: [unseenEvidenceId],
            testimonyIds: [],
            eventIds: [],
            sourceSegmentIds: [],
          },
          status: "active",
          sourceEventId: start.event.eventId,
        },
        [currentTurnId]: {
          turnId: currentTurnId,
          actor: ACTORS.userCounsel,
          text: "Please describe the complaint you personally sent.",
          testimonyId: null,
          citations: {
            factIds: ["fact_complaint_sent"],
            evidenceIds: [],
            testimonyIds: [],
            eventIds: [],
            sourceSegmentIds: [],
          },
          status: "active",
          sourceEventId: start.event.eventId,
        },
      },
      transcriptTurnIds: [turnId, currentTurnId],
    });

    const view = buildKnowledgeView(
      {
        trial,
        caseGraph: harness.graph,
        currentExchangeTurnId: currentTurnId,
      },
      ACTORS.rina.actorId,
    );
    expect(view.actorRole).toBe("witness");
    expect(JSON.stringify(view)).not.toContain(unknownFactId);
    expect(JSON.stringify(view)).not.toContain(unseenEvidenceId);
    expect(JSON.stringify(view)).not.toContain(
      "Theo disclosed the private access sequence.",
    );
  });

  it("rejects a START policy that maps counsel to an opposite-side party", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const action = createStartTrialAction({
      trialId: "trial_audit_mapping",
      actionId: "action_audit_mapping_start",
      requestedAt: new Date(BASE_TIME_MS).toISOString(),
      graph,
      actors: Object.values(ACTORS),
      actorBindings: actorBindings(),
    });
    if (action.type !== "START_TRIAL") throw new Error("Expected START_TRIAL");
    const tampered = structuredClone(action);
    const userBinding = tampered.payload.policySnapshot.mappings.actors.find(
      (binding) => binding.actorId === ACTORS.userCounsel.actorId,
    );
    const userParty = tampered.payload.policySnapshot.mappings.parties.find(
      (party) => party.partyId === "party_rina_shah",
    );
    const opposingParty = tampered.payload.policySnapshot.mappings.parties.find(
      (party) => party.partyId === "party_redwood_signal",
    );
    if (!userBinding || !userParty || !opposingParty) {
      throw new Error("Fixture is missing expected policy mappings");
    }
    userBinding.representedPartyIds = ["party_redwood_signal"];
    userParty.representativeActorIds = userParty.representativeActorIds.filter(
      (actorId) => actorId !== ACTORS.userCounsel.actorId,
    );
    opposingParty.representativeActorIds = [
      ...opposingParty.representativeActorIds,
      ACTORS.userCounsel.actorId,
    ];

    const result = validateAction(null, tampered);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected inconsistent START policy rejection");
    expect(result.issue.code).toBe("INVALID_ACTION");
  });
});

describe("audit regressions: recess and evidence lifecycle", () => {
  it("rejects courtroom mutation while a valid recess is active", () => {
    const harness = createHarness("recess_mutation");
    enterCaseInChief(harness);
    harness.commit(
      "CALL_WITNESS",
      { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
      ACTORS.userCounsel,
    );
    harness.commit("REQUEST_RECESS", {}, ACTORS.judge);
    expect(harness.state.phase).toBe("recess");
    harness.reject(
      "SWEAR_WITNESS",
      { witnessId: ACTORS.rina.witnessId },
      ACTORS.judge,
      "WRONG_PHASE",
    );
  });

  it("rejects starting recess while a question or response is active", () => {
    const harness = createHarness("recess_open_work");
    enterCaseInChief(harness);
    callAndSwear(harness, ACTORS.rina, ACTORS.userCounsel, "user");
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_recess_open",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "Is this question still open?",
        turnId: "turn_question_recess_open",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.reject("REQUEST_RECESS", {}, ACTORS.judge, "INVALID_ACTION");
  });

  it("rejects admission after the recorded foundation testimony is stricken", () => {
    const harness = createHarness("invalidated_foundation");
    enterCaseInChief(harness);
    callAndSwear(harness, ACTORS.rina, ACTORS.userCounsel, "user");
    const testimonyId = askAndAnswer(harness, {
      suffix: "complaint_foundation",
      counsel: ACTORS.userCounsel,
      witness: ACTORS.rina,
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    });
    harness.commit(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        offeredBySide: "user",
        foundationTestimonyIds: [testimonyId],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_strike_foundation",
        testimonyIds: [testimonyId],
        reason: "The foundation was withdrawn.",
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_strike_foundation",
        testimonyIds: [testimonyId],
        factIds: ["fact_complaint_sent"],
      },
      ACTORS.judge,
    );
    harness.reject(
      "RULE_ON_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        ruling: "admitted",
        reason: "Foundation is no longer active.",
      },
      ACTORS.judge,
      "INVALID_EVIDENCE_STATUS",
    );
  });

  it("keeps a fact live when another active testimony independently supports it", () => {
    const harness = createHarness("independent_support");
    enterCaseInChief(harness);
    callAndSwear(harness, ACTORS.rina, ACTORS.userCounsel, "user");
    const rinaTestimonyId = askAndAnswer(harness, {
      suffix: "rina_reports",
      counsel: ACTORS.userCounsel,
      witness: ACTORS.rina,
      factIds: ["fact_late_reports"],
    });
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
    callAndSwear(harness, ACTORS.theo, ACTORS.opposingCounsel, "opposing");
    const theoTestimonyId = askAndAnswer(harness, {
      suffix: "theo_reports",
      counsel: ACTORS.opposingCounsel,
      witness: ACTORS.theo,
      factIds: ["fact_late_reports"],
    });
    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_strike_rina_reports",
        testimonyIds: [rinaTestimonyId],
        reason: "Strike only Rina's statement.",
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_strike_rina_reports",
        testimonyIds: [rinaTestimonyId],
        factIds: ["fact_late_reports"],
      },
      ACTORS.judge,
    );

    expect(harness.state.testimony[rinaTestimonyId]?.status).toBe("stricken");
    expect(harness.state.testimony[theoTestimonyId]?.status).toBe("active");
    expect(harness.state.facts.fact_late_reports?.status).not.toBe("stricken");
  });
});

describe("audit regressions: settlement and event-envelope integrity", () => {
  it("rejects more than one settlement recipient at the active action schema", () => {
    const harness = createHarness("single_recipient");
    harness.start();
    const valid = harness.draft(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_single_recipient",
        parentOfferId: null,
        proposedByPartyId: "party_rina_shah",
        recipientPartyIds: ["party_redwood_signal"],
        terms: {
          amount: 100_000,
          currency: "USD",
          nonMonetaryTerms: [],
          summary: "One bilateral offer.",
        },
        expiresAtSequence: settlementExpirySequence(
          harness.state.policySnapshot,
          harness.state.lastSequence + 1,
        ),
      },
      ACTORS.userCounsel,
    );
    if (valid.type !== "PROPOSE_SETTLEMENT") {
      throw new Error("Expected settlement proposal action");
    }
    const invalid = structuredClone(valid);
    invalid.payload.recipientPartyIds = [
      "party_redwood_signal",
      "party_second_opposing_recipient",
    ];
    expect(TrialActionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects persisted citation tampering during replay", () => {
    const harness = createHarness("replay_citations");
    harness.start();
    harness.commit("BEGIN_PHASE", { phase: "opening" }, ACTORS.judge);
    const tampered = structuredClone(harness.events[1]);
    tampered.citations.factIds = ["fact_complaint_sent"];
    expect(() => reduceTrial([harness.events[0], tampered])).toThrow(
      "EVENT_ENVELOPE_MISMATCH",
    );
  });

  it("rejects replacing an event ID during deterministic replay", () => {
    const harness = createHarness("replay_event_id");
    harness.start();
    harness.commit("BEGIN_PHASE", { phase: "opening" }, ACTORS.judge);
    const tampered = structuredClone(harness.events[1]);
    tampered.eventId = "event_tampered_replacement";
    expect(() => reduceTrial([harness.events[0], tampered])).toThrow();
  });

  it("rejects replacing a direct causation link with an unrelated older event", () => {
    const harness = createHarness("replay_causation");
    harness.start();
    harness.commit("BEGIN_PHASE", { phase: "opening" }, ACTORS.judge);
    harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
    const tampered = structuredClone(harness.events[2]);
    tampered.causationId = harness.events[0].eventId;
    expect(() => reduceTrial([
      harness.events[0],
      harness.events[1],
      tampered,
    ])).toThrow();
  });

  it("rejects a persisted response ID that disagrees with its payload", () => {
    const harness = createHarness("replay_response_id");
    enterCaseInChief(harness);
    callAndSwear(harness, ACTORS.rina, ACTORS.userCounsel, "user");
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_response_replay",
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "Please answer for the replay record.",
        turnId: "turn_question_response_replay",
        presentedEvidenceIds: [],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response_replay_bound",
        actorId: ACTORS.rina.actorId,
        purpose: "answer_response_replay",
      },
      ACTORS.system,
    );
    const tampered = structuredClone(harness.events.at(-1));
    if (!tampered) throw new Error("Missing response event");
    tampered.responseId = "response_replay_tampered";
    expect(() => reduceTrial([
      ...harness.events.slice(0, -1),
      tampered,
    ])).toThrow("Action responseId must match payload.responseId");
  });
});

describe("audit regressions: admissible assertion and jury grounding", () => {
  it("rejects raw event and source-segment citations in closing argument", () => {
    const harness = createHarness("jury_grounding");
    toClosing(harness);
    harness.reject(
      "GIVE_CLOSING",
      {
        side: "user",
        turnId: "turn_closing_raw_event",
        text: "A settlement event must not reach the jury.",
        citations: {
          ...NO_CITATIONS,
          eventIds: [harness.events[0].eventId],
        },
      },
      ACTORS.userCounsel,
      "INVALID_ACTION",
    );
    harness.reject(
      "GIVE_CLOSING",
      {
        side: "user",
        turnId: "turn_closing_raw_source",
        text: "A raw source segment must not bypass admissibility.",
        citations: {
          ...NO_CITATIONS,
          sourceSegmentIds: [harness.state.sourceSegmentIds[0]!],
        },
      },
      ACTORS.userCounsel,
      "INVALID_ACTION",
    );
  });

  it("requires a generated assertion's linked basis to remain admissible", () => {
    const harness = createHarness("assertion_basis");
    enterCaseInChief(harness);
    harness.reject(
      "PROPOSE_ASSERTION",
      {
        factId: "fact_event_only_assertion",
        proposition: "A raw trial event is not evidentiary support.",
        provenanceIds: [harness.events[0].eventId],
        visibility: "public",
      },
      ACTORS.userCounsel,
      "INVALID_ACTION",
    );
    callAndSwear(harness, ACTORS.rina, ACTORS.userCounsel, "user");
    const testimonyId = askAndAnswer(harness, {
      suffix: "assertion_basis",
      counsel: ACTORS.userCounsel,
      witness: ACTORS.rina,
      factIds: ["fact_complaint_sent"],
    });
    harness.commit(
      "PROPOSE_ASSERTION",
      {
        factId: "fact_generated_from_testimony",
        proposition: "A generated proposition linked to Rina's testimony.",
        provenanceIds: [testimonyId],
        visibility: "public",
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_assertion_basis",
        testimonyIds: [testimonyId],
        reason: "Remove the only asserted basis.",
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_assertion_basis",
        testimonyIds: [testimonyId],
        factIds: ["fact_complaint_sent"],
      },
      ACTORS.judge,
    );
    harness.reject(
      "VERIFY_ASSERTION",
      { factId: "fact_generated_from_testimony" },
      ACTORS.judge,
      "INVALID_ACTION",
    );
    harness.commit(
      "DISPUTE_ASSERTION",
      { factId: "fact_generated_from_testimony" },
      ACTORS.opposingCounsel,
    );
    harness.reject(
      "RULE_ON_ASSERTION",
      {
        factId: "fact_generated_from_testimony",
        ruling: "admitted",
        reason: "A stricken basis cannot support admission.",
      },
      ACTORS.judge,
      "INVALID_ACTION",
    );
  });
});

describe("audit regressions: terminal-stage uniqueness", () => {
  it("rejects a second closing from the same side", () => {
    const harness = createHarness("duplicate_closing");
    toClosing(harness);
    giveClosing(harness, "user", "user_first");
    harness.reject(
      "GIVE_CLOSING",
      {
        side: "user",
        turnId: "turn_closing_user_second",
        text: "A second user closing must not overwrite trial progress.",
        citations: NO_CITATIONS,
      },
      ACTORS.userCounsel,
      "DUPLICATE_ENTITY_ID",
    );
  });

  it("rejects a second instruction event that repeats an instruction ID", () => {
    const harness = createHarness("duplicate_instruction");
    const instructionId = toJuryInstructions(harness);
    harness.commit(
      "INSTRUCT_JURY",
      { instructionIds: [instructionId] },
      ACTORS.judge,
    );
    harness.reject(
      "INSTRUCT_JURY",
      { instructionIds: [instructionId] },
      ACTORS.judge,
      "DUPLICATE_ENTITY_ID",
    );
  });

  it("rejects rendering a second verdict", () => {
    const harness = createHarness("duplicate_verdict");
    toVerdict(harness);
    renderVerdict(harness, "first");
    harness.reject(
      "RENDER_VERDICT",
      {
        verdictId: "verdict_second",
        decision: "A second verdict must be rejected.",
        citations: NO_CITATIONS,
      },
      ACTORS.judge,
      "DUPLICATE_ENTITY_ID",
    );
  });

  it("rejects generating a second debrief", () => {
    const harness = createHarness("duplicate_debrief");
    toVerdict(harness);
    renderVerdict(harness, "for_debrief");
    harness.commit("BEGIN_PHASE", { phase: "debrief" }, ACTORS.judge);
    harness.commit(
      "GENERATE_DEBRIEF",
      { debriefId: "debrief_first" },
      ACTORS.debriefCoach,
    );
    harness.reject(
      "GENERATE_DEBRIEF",
      { debriefId: "debrief_second" },
      ACTORS.debriefCoach,
      "DUPLICATE_ENTITY_ID",
    );
  });
});
