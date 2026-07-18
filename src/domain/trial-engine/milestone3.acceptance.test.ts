import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  commitAction,
  createStartTrialAction,
  reduceTrial,
  type ActorRef,
  type CommitResult,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialEvent,
  type TrialState,
} from "./index";

const TRIAL_ID = "trial_m3_scripted_acceptance";
const BASE_TIME_MS = Date.parse("2026-07-18T18:00:00.000Z");

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

function createHarness() {
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
    actor: ActorRef,
  ): CommitResult {
    const result = commitAction(state, draft(type, payload, actor));
    state = result.state;
    events.push(result.event);
    return result;
  }

  function reloadFromSerializedEvents(): TrialState {
    const persistedEvents = JSON.parse(JSON.stringify(events)) as unknown[];
    state = reduceTrial(persistedEvents);
    return state;
  }

  return {
    events,
    start,
    commit,
    reloadFromSerializedEvents,
    get state(): TrialState {
      if (state === null) throw new Error("Trial has not started");
      return state;
    },
  };
}

type ExaminationInput = {
  id: string;
  witnessId: string;
  witnessActor: ActorRef;
  counselActor: ActorRef;
  kind: "direct" | "cross";
  question: string;
  answer: string;
  factIds: string[];
  evidenceIds: string[];
};

function examine(harness: Harness, input: ExaminationInput): string {
  const questionId = `question_${input.id}`;
  const responseId = `response_${input.id}`;
  const testimonyId = `testimony_${input.id}`;

  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId: input.witnessId,
      examinationKind: input.kind,
      text: input.question,
      turnId: `turn_question_${input.id}`,
      presentedEvidenceIds: [...input.evidenceIds],
    },
    input.counselActor,
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId,
      actorId: input.witnessActor.actorId,
      purpose: "answer_question",
    },
    ACTORS.system,
  );
  harness.commit(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId,
      witnessId: input.witnessId,
      testimonyId,
      turnId: `turn_answer_${input.id}`,
      text: input.answer,
      factIds: input.factIds,
      evidenceIds: input.evidenceIds,
    },
    input.witnessActor,
  );
  return testimonyId;
}

function endExamination(
  harness: Harness,
  witnessId: string,
  examinationKind: "direct" | "cross" | "redirect" | "recross",
  counselActor: ActorRef,
  disposition: "completed" | "waived" = "completed",
): void {
  harness.commit(
    "END_EXAMINATION",
    { witnessId, examinationKind, disposition },
    counselActor,
  );
}

function emptyCitations() {
  return {
    factIds: [],
    evidenceIds: [],
    testimonyIds: [],
    eventIds: [],
    sourceSegmentIds: [],
  };
}

describe("Milestone 3 deterministic scripted acceptance", () => {
  it("completes and byte-identically replays both sides' three-witness case", () => {
    const harness = createHarness();
    harness.start();
    harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);

    // User calls Rina; user examines and opposing counsel crosses.
    harness.commit(
      "CALL_WITNESS",
      { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
      ACTORS.userCounsel,
    );
    harness.commit("SWEAR_WITNESS", { witnessId: ACTORS.rina.witnessId }, ACTORS.judge);
    const rinaDirect = examine(harness, {
      id: "rina_direct",
      witnessId: ACTORS.rina.witnessId,
      witnessActor: ACTORS.rina,
      counselActor: ACTORS.userCounsel,
      kind: "direct",
      question: "When did you send your safety complaint?",
      answer: "I sent the safety complaint at 10:14 AM on March 10.",
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    });
    endExamination(harness, ACTORS.rina.witnessId, "direct", ACTORS.userCounsel);
    examine(harness, {
      id: "rina_cross",
      witnessId: ACTORS.rina.witnessId,
      witnessActor: ACTORS.rina,
      counselActor: ACTORS.opposingCounsel,
      kind: "cross",
      question: "Were two monthly reports submitted after internal due dates?",
      answer: "The report history lists two submissions after those dates.",
      factIds: ["fact_late_reports"],
      evidenceIds: ["evidence_report_history"],
    });
    endExamination(harness, ACTORS.rina.witnessId, "cross", ACTORS.opposingCounsel);
    endExamination(harness, ACTORS.rina.witnessId, "redirect", ACTORS.userCounsel, "waived");
    harness.commit("RELEASE_WITNESS", { witnessId: ACTORS.rina.witnessId }, ACTORS.userCounsel);

    harness.commit(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        offeredBySide: "user",
        foundationTestimonyIds: [rinaDirect],
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "RULE_ON_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        ruling: "admitted",
        reason: "Rina authenticated the complaint that she sent.",
      },
      ACTORS.judge,
    );

    // Opposing counsel calls Theo; opposing examines and user crosses.
    harness.commit(
      "CALL_WITNESS",
      { witnessId: ACTORS.theo.witnessId, calledBySide: "opposing" },
      ACTORS.opposingCounsel,
    );
    harness.commit("SWEAR_WITNESS", { witnessId: ACTORS.theo.witnessId }, ACTORS.judge);
    const strickenTestimonyId = examine(harness, {
      id: "theo_direct_stricken",
      witnessId: ACTORS.theo.witnessId,
      witnessActor: ACTORS.theo,
      counselActor: ACTORS.opposingCounsel,
      kind: "direct",
      question: "Why was the termination decision unquestionably unrelated to the complaint?",
      answer: "It was unquestionably unrelated because I had already made up my mind.",
      factIds: [],
      evidenceIds: ["evidence_draft_metadata"],
    });
    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_strike_theo_conclusion",
        testimonyIds: [strickenTestimonyId],
        reason: "The answer stated an unsupported ultimate conclusion.",
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_strike_theo_conclusion",
        testimonyIds: [strickenTestimonyId],
        factIds: [],
      },
      ACTORS.judge,
    );
    endExamination(harness, ACTORS.theo.witnessId, "direct", ACTORS.opposingCounsel);
    const theoCross = examine(harness, {
      id: "theo_cross",
      witnessId: ACTORS.theo.witnessId,
      witnessActor: ACTORS.theo,
      counselActor: ACTORS.userCounsel,
      kind: "cross",
      question: "Does the report-history export list two submissions after internal due dates?",
      answer: "Yes, the report-history export lists two submissions after those dates.",
      factIds: ["fact_late_reports"],
      evidenceIds: ["evidence_report_history"],
    });
    endExamination(harness, ACTORS.theo.witnessId, "cross", ACTORS.userCounsel);
    endExamination(harness, ACTORS.theo.witnessId, "redirect", ACTORS.opposingCounsel, "waived");
    harness.commit("RELEASE_WITNESS", { witnessId: ACTORS.theo.witnessId }, ACTORS.opposingCounsel);

    harness.commit(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_report_history",
        offeredBySide: "opposing",
        foundationTestimonyIds: [theoCross],
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "RULE_ON_EVIDENCE",
      {
        evidenceId: "evidence_report_history",
        ruling: "excluded",
        reason: "The proponent did not establish how the internal due dates were communicated.",
      },
      ACTORS.judge,
    );

    // The parties negotiate privately but reject the only offer, so trial continues.
    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_user_90000",
        parentOfferId: null,
        proposedByPartyId: "party_rina_shah",
        recipientPartyIds: ["party_redwood_signal"],
        terms: {
          amount: 90_000,
          currency: "USD",
          nonMonetaryTerms: ["Neutral reference"],
          summary: "Claimant proposes a $90,000 resolution and neutral reference.",
        },
        expiresAtSequence:
          harness.state.lastSequence +
          1 +
          harness.state.policySnapshot.settlement.expiresAfterEventCount,
      },
      ACTORS.userCounsel,
    );
    harness.commit("REJECT_SETTLEMENT", { offerId: "offer_user_90000" }, ACTORS.opposingCounsel);

    // User calls neutral examiner Maya; her grounded answer atomically reveals the hidden authored fact.
    harness.commit(
      "CALL_WITNESS",
      { witnessId: ACTORS.maya.witnessId, calledBySide: "user" },
      ACTORS.userCounsel,
    );
    harness.commit("SWEAR_WITNESS", { witnessId: ACTORS.maya.witnessId }, ACTORS.judge);
    const mayaDirect = examine(harness, {
      id: "maya_direct_reveal",
      witnessId: ACTORS.maya.witnessId,
      witnessActor: ACTORS.maya,
      counselActor: ACTORS.userCounsel,
      kind: "direct",
      question: "What does the authenticated access log show?",
      answer: "It shows Theo opened the complaint before editing the termination memorandum.",
      factIds: ["fact_manager_accessed_complaint"],
      evidenceIds: ["evidence_revision_history"],
    });
    harness.commit(
      "VERIFY_ASSERTION",
      { factId: "fact_manager_accessed_complaint" },
      ACTORS.judge,
    );
    harness.commit(
      "RULE_ON_ASSERTION",
      {
        factId: "fact_manager_accessed_complaint",
        ruling: "admitted",
        reason: "The authenticated access log and examiner testimony establish the timestamp.",
      },
      ACTORS.judge,
    );
    endExamination(harness, ACTORS.maya.witnessId, "direct", ACTORS.userCounsel);
    examine(harness, {
      id: "maya_cross",
      witnessId: ACTORS.maya.witnessId,
      witnessActor: ACTORS.maya,
      counselActor: ACTORS.opposingCounsel,
      kind: "cross",
      question: "Can metadata alone establish anyone's motive?",
      answer: "No. My examination establishes timestamps, not motive.",
      factIds: ["fact_rationale_revised"],
      evidenceIds: ["evidence_revision_history"],
    });
    endExamination(harness, ACTORS.maya.witnessId, "cross", ACTORS.opposingCounsel);
    endExamination(harness, ACTORS.maya.witnessId, "redirect", ACTORS.userCounsel, "waived");
    harness.commit("RELEASE_WITNESS", { witnessId: ACTORS.maya.witnessId }, ACTORS.userCounsel);

    // Simulate a browser reload from persisted append-only events before continuing.
    harness.commit("PAUSE_TRIAL", {}, ACTORS.judge);
    const beforeReload = JSON.stringify(harness.state);
    expect(JSON.stringify(harness.reloadFromSerializedEvents())).toBe(beforeReload);
    harness.commit("RESUME_TRIAL", {}, ACTORS.judge);

    // Opposing counsel recalls Rina; opposing examines and user crosses.
    harness.commit(
      "RECALL_WITNESS",
      { witnessId: ACTORS.rina.witnessId, calledBySide: "opposing" },
      ACTORS.opposingCounsel,
    );
    harness.commit("SWEAR_WITNESS", { witnessId: ACTORS.rina.witnessId }, ACTORS.judge);
    examine(harness, {
      id: "rina_recall_direct",
      witnessId: ACTORS.rina.witnessId,
      witnessActor: ACTORS.rina,
      counselActor: ACTORS.opposingCounsel,
      kind: "direct",
      question: "Were the two report submissions after their listed due dates?",
      answer: "Yes, the export lists them after the internal dates.",
      factIds: ["fact_late_reports"],
      evidenceIds: [],
    });
    endExamination(harness, ACTORS.rina.witnessId, "direct", ACTORS.opposingCounsel);
    examine(harness, {
      id: "rina_recall_cross",
      witnessId: ACTORS.rina.witnessId,
      witnessActor: ACTORS.rina,
      counselActor: ACTORS.userCounsel,
      kind: "cross",
      question: "Did you nevertheless send the safety complaint on March 10?",
      answer: "Yes, I sent it at 10:14 AM that day.",
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    });
    endExamination(harness, ACTORS.rina.witnessId, "cross", ACTORS.userCounsel);
    endExamination(harness, ACTORS.rina.witnessId, "redirect", ACTORS.opposingCounsel, "waived");
    harness.commit("RELEASE_WITNESS", { witnessId: ACTORS.rina.witnessId }, ACTORS.opposingCounsel);

    // User recalls Theo; user examines and opposing counsel crosses.
    harness.commit(
      "RECALL_WITNESS",
      { witnessId: ACTORS.theo.witnessId, calledBySide: "user" },
      ACTORS.userCounsel,
    );
    harness.commit("SWEAR_WITNESS", { witnessId: ACTORS.theo.witnessId }, ACTORS.judge);
    examine(harness, {
      id: "theo_recall_direct",
      witnessId: ACTORS.theo.witnessId,
      witnessActor: ACTORS.theo,
      counselActor: ACTORS.userCounsel,
      kind: "direct",
      question: "Did you open the complaint before the final edit?",
      answer: "The access record shows my account opened it before the final edit.",
      factIds: ["fact_manager_accessed_complaint", "fact_rationale_revised"],
      evidenceIds: ["evidence_revision_history"],
    });
    endExamination(harness, ACTORS.theo.witnessId, "direct", ACTORS.userCounsel);
    const theoRecallCross = examine(harness, {
      id: "theo_recall_cross",
      witnessId: ACTORS.theo.witnessId,
      witnessActor: ACTORS.theo,
      counselActor: ACTORS.opposingCounsel,
      kind: "cross",
      question: "Was an initial termination draft created before the complaint?",
      answer: "Yes, I created an initial draft seven days earlier.",
      factIds: ["fact_draft_created"],
      evidenceIds: ["evidence_draft_metadata"],
    });
    endExamination(harness, ACTORS.theo.witnessId, "cross", ACTORS.opposingCounsel);
    endExamination(harness, ACTORS.theo.witnessId, "redirect", ACTORS.userCounsel, "waived");
    harness.commit("RELEASE_WITNESS", { witnessId: ACTORS.theo.witnessId }, ACTORS.userCounsel);

    harness.commit(
      "RULE_ON_ASSERTION",
      {
        factId: "fact_draft_created",
        ruling: "admitted",
        reason: "The unstricken draft testimony establishes the creation date.",
      },
      ACTORS.judge,
    );
    harness.commit(
      "RULE_ON_ASSERTION",
      {
        factId: "fact_complaint_sent",
        ruling: "admitted",
        reason: "The admitted complaint and unstricken testimony establish its timestamp.",
      },
      ACTORS.judge,
    );

    harness.commit("REST_CASE", { side: "user" }, ACTORS.userCounsel);
    harness.commit("REST_CASE", { side: "opposing" }, ACTORS.opposingCounsel);
    harness.commit("BEGIN_PHASE", { phase: "pre_closing" }, ACTORS.judge);
    harness.commit("BEGIN_PHASE", { phase: "closing" }, ACTORS.judge);
    harness.commit(
      "GIVE_CLOSING",
      {
        side: "user",
        turnId: "turn_closing_user",
        text: "The admitted timestamps show complaint access before the final rationale edit.",
        citations: {
          ...emptyCitations(),
          factIds: ["fact_manager_accessed_complaint"],
          evidenceIds: ["evidence_complaint_email"],
          testimonyIds: [mayaDirect],
        },
      },
      ACTORS.userCounsel,
    );
    harness.commit(
      "GIVE_CLOSING",
      {
        side: "opposing",
        turnId: "turn_closing_opposing",
        text: "The first termination draft predates the complaint.",
        citations: {
          ...emptyCitations(),
          factIds: ["fact_draft_created"],
          testimonyIds: [theoRecallCross],
        },
      },
      ACTORS.opposingCounsel,
    );
    harness.commit("BEGIN_PHASE", { phase: "jury_instructions" }, ACTORS.judge);
    harness.commit(
      "INSTRUCT_JURY",
      { instructionIds: ["instruction_retaliation_causation"] },
      ACTORS.judge,
    );
    harness.commit("BEGIN_PHASE", { phase: "deliberation" }, ACTORS.judge);
    harness.commit("DELIBERATE", {}, ACTORS.jury);
    harness.commit("BEGIN_PHASE", { phase: "verdict" }, ACTORS.judge);
    harness.commit(
      "RENDER_VERDICT",
      {
        verdictId: "verdict_scripted_acceptance",
        decision: "The jury finds for Rina Shah in this fictional educational simulation.",
        citations: {
          ...emptyCitations(),
          factIds: ["fact_complaint_sent", "fact_manager_accessed_complaint"],
          evidenceIds: ["evidence_complaint_email"],
          testimonyIds: [rinaDirect, mayaDirect],
        },
      },
      ACTORS.judge,
    );
    harness.commit("BEGIN_PHASE", { phase: "debrief" }, ACTORS.judge);
    harness.commit(
      "GENERATE_DEBRIEF",
      { debriefId: "debrief_scripted_acceptance" },
      ACTORS.debriefCoach,
    );
    harness.commit("BEGIN_PHASE", { phase: "complete" }, ACTORS.judge);

    const finalState = harness.state;
    const firstReplay = reduceTrial(harness.events);
    const serializedEvents = JSON.stringify(harness.events);
    const secondReplay = reduceTrial(JSON.parse(serializedEvents) as unknown[]);

    expect(finalState).toMatchObject({
      phase: "complete",
      status: "complete",
      activeWitnessId: null,
      restedSides: ["user", "opposing"],
      verdictId: "verdict_scripted_acceptance",
      debriefId: "debrief_scripted_acceptance",
    });
    expect(JSON.stringify(firstReplay)).toBe(JSON.stringify(finalState));
    expect(JSON.stringify(secondReplay)).toBe(JSON.stringify(finalState));

    expect(
      harness.events
        .filter((event) => event.type === "CALL_WITNESS")
        .map((event) => [event.actor.side, event.payload.witnessId]),
    ).toEqual([
      ["user", ACTORS.rina.witnessId],
      ["opposing", ACTORS.theo.witnessId],
      ["user", ACTORS.maya.witnessId],
    ]);
    expect(
      harness.events
        .filter((event) => event.type === "RECALL_WITNESS")
        .map((event) => [event.actor.side, event.payload.witnessId]),
    ).toEqual([
      ["opposing", ACTORS.rina.witnessId],
      ["user", ACTORS.theo.witnessId],
    ]);
    expect(
      harness.events
        .filter((event) => event.type === "RELEASE_WITNESS")
        .map((event) => event.actor.side),
    ).toEqual(["user", "opposing", "user", "opposing", "user"]);

    const examinationPairs = harness.events
      .filter((event) => event.type === "ASK_QUESTION")
      .map((event) => `${event.actor.side}:${event.payload.examinationKind}`);
    expect(examinationPairs).toEqual(
      expect.arrayContaining([
        "user:direct",
        "user:cross",
        "opposing:direct",
        "opposing:cross",
      ]),
    );

    expect(Object.values(finalState.testimony)).toHaveLength(10);
    expect(Object.values(finalState.testimony).filter((entry) => entry.status === "stricken"))
      .toEqual([expect.objectContaining({ testimonyId: strickenTestimonyId })]);
    expect(finalState.transcriptTurns.turn_answer_theo_direct_stricken).toMatchObject({
      testimonyId: strickenTestimonyId,
      status: "stricken",
    });
    expect(Object.values(finalState.evidence).filter((entry) => entry.status === "excluded"))
      .toEqual([expect.objectContaining({ evidenceId: "evidence_report_history" })]);
    expect(finalState.evidence.evidence_complaint_email.status).toBe("admitted");

    expect(
      harness.events.find(
        (event) =>
          event.type === "ANSWER_QUESTION" &&
          event.payload.testimonyId === mayaDirect,
      ),
    ).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          factIds: ["fact_manager_accessed_complaint"],
        }),
      }),
    );
    expect(finalState.testimony["testimony_maya_direct_reveal"].factIds)
      .toContain("fact_manager_accessed_complaint");
    expect(finalState.facts.fact_manager_accessed_complaint).toMatchObject({
      status: "admitted",
      visibility: "public",
    });

    expect(Object.values(finalState.settlementOffers)).toEqual([
      expect.objectContaining({
        offerId: "offer_user_90000",
        proposedBySide: "user",
        visibleToSides: ["user", "opposing"],
        status: "rejected",
      }),
    ]);
  });
});
