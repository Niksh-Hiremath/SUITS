import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  commitAction,
  createStartTrialAction,
  validateAction,
  type ActorRef,
  type CommitResult,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialState,
} from "./index";

const TRIAL_ID = "trial_evidence_foundation_invariants";
const BASE_TIME = Date.parse("2026-07-19T00:00:00.000Z");

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

type Harness = {
  start: () => CommitResult;
  draft: <K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor?: ActorRef,
  ) => TrialAction;
  commit: <K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor?: ActorRef,
  ) => CommitResult;
  readonly state: TrialState;
};

function createHarness(): Harness {
  const graph = createThreeWitnessCaseGraphV1Fixture();
  const events: CommitResult["event"][] = [];
  let state: TrialState | null = null;
  let ordinal = 0;

  function nextIdentity(label: string) {
    ordinal += 1;
    return {
      actionId: `action_foundation_${ordinal}_${label.toLowerCase()}`,
      requestedAt: new Date(BASE_TIME + ordinal * 1_000).toISOString(),
    };
  }

  function start(): CommitResult {
    const result = commitAction(
      null,
      createStartTrialAction({
        trialId: TRIAL_ID,
        ...nextIdentity("start"),
        graph,
        actors: Object.values(ACTORS),
        actorBindings: actorBindings(),
      }),
    );
    state = result.state;
    events.push(result.event);
    return result;
  }

  function draft<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef = ACTORS.system,
  ): TrialAction {
    if (state === null) throw new Error("Start the foundation harness first");
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
    actor: ActorRef = ACTORS.system,
  ): CommitResult {
    const result = commitAction(state, draft(type, payload, actor));
    state = result.state;
    events.push(result.event);
    return result;
  }

  return {
    start,
    draft,
    commit,
    get state(): TrialState {
      if (state === null) throw new Error("Foundation harness is not started");
      return state;
    },
  };
}

function enterCaseInChief(harness: Harness): void {
  harness.start();
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
}

function createWitnessTestimony(
  harness: Harness,
  suffix: string,
  evidenceId: string,
  witnessActor: ActorRef = ACTORS.rina,
): string {
  const witnessId = witnessActor.witnessId;
  if (witnessId === null) throw new Error("Foundation actor must be a witness");
  harness.commit(
    "CALL_WITNESS",
    { witnessId, calledBySide: "user" },
    ACTORS.userCounsel,
  );
  harness.commit(
    "SWEAR_WITNESS",
    { witnessId },
    ACTORS.judge,
  );
  const questionId = `question_foundation_${suffix}`;
  const responseId = `response_foundation_${suffix}`;
  const testimonyId = `testimony_foundation_${suffix}`;
  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId,
      examinationKind: "direct",
      text: "Do you recognize this record?",
      turnId: `turn_foundation_question_${suffix}`,
      presentedEvidenceIds: [evidenceId],
    },
    ACTORS.userCounsel,
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId,
      actorId: witnessActor.actorId,
      purpose: "answer_question",
    },
  );
  harness.commit(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId,
      witnessId,
      testimonyId,
      turnId: `turn_foundation_answer_${suffix}`,
      text: "Yes. I recognize this record.",
      factIds: [],
      evidenceIds: [evidenceId],
    },
    witnessActor,
  );
  return testimonyId;
}

function prepareRinaAnswer(harness: Harness, suffix: string): TrialAction {
  const questionId = `question_citation_${suffix}`;
  const responseId = `response_citation_${suffix}`;
  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
      text: "What does the exhibit show?",
      turnId: `turn_citation_question_${suffix}`,
      presentedEvidenceIds: [],
    },
    ACTORS.userCounsel,
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId,
      actorId: ACTORS.rina.actorId,
      purpose: "answer_question",
    },
  );
  return harness.draft(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId,
      witnessId: "witness_rina_shah",
      testimonyId: `testimony_citation_${suffix}`,
      turnId: `turn_citation_answer_${suffix}`,
      text: "The exhibit records my safety complaint.",
      factIds: [],
      evidenceIds: ["evidence_complaint_email"],
    },
    ACTORS.rina,
  );
}

function offerComplaint(
  harness: Harness,
  foundationTestimonyIds: string[],
): CommitResult {
  return harness.commit(
    "OFFER_EVIDENCE",
    {
      evidenceId: "evidence_complaint_email",
      offeredBySide: "user",
      foundationTestimonyIds,
    },
    ACTORS.userCounsel,
  );
}

function draftComplaintOffer(
  harness: Harness,
  foundationTestimonyIds: string[],
): TrialAction {
  return harness.draft(
    "OFFER_EVIDENCE",
    {
      evidenceId: "evidence_complaint_email",
      offeredBySide: "user",
      foundationTestimonyIds,
    },
    ACTORS.userCounsel,
  );
}

function strikeTestimony(harness: Harness, testimonyId: string): void {
  const motionId = `motion_strike_${testimonyId}`;
  harness.commit(
    "MOVE_TO_STRIKE",
    {
      motionId,
      testimonyIds: [testimonyId],
      reason: "The foundation testimony should be stricken.",
    },
    ACTORS.opposingCounsel,
  );
  harness.commit(
    "STRIKE_TESTIMONY",
    { motionId, testimonyIds: [testimonyId], factIds: [] },
    ACTORS.judge,
  );
}

function expectIssue(
  state: TrialState,
  action: TrialAction,
  code: string,
): void {
  expect(validateAction(state, action)).toMatchObject({
    ok: false,
    issue: { code },
  });
}

describe("active v3 evidence foundation invariants", () => {
  it("rejects a permitted exhibit offer with no required foundation", () => {
    const harness = createHarness();
    enterCaseInChief(harness);

    expectIssue(
      harness.state,
      draftComplaintOffer(harness, []),
      "INVALID_EVIDENCE_STATUS",
    );
  });

  it("rejects unrelated testimony as an exhibit foundation", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const unrelated = createWitnessTestimony(
      harness,
      "unrelated",
      "evidence_revision_history",
      ACTORS.maya,
    );

    expectIssue(
      harness.state,
      draftComplaintOffer(harness, [unrelated]),
      "INVALID_EVIDENCE_STATUS",
    );
  });

  it("rejects duplicate foundation testimony IDs", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const foundation = createWitnessTestimony(
      harness,
      "duplicate",
      "evidence_complaint_email",
    );

    expectIssue(
      harness.state,
      draftComplaintOffer(harness, [foundation, foundation]),
      "DUPLICATE_ENTITY_ID",
    );
  });

  it("rejects foundation testimony that was already stricken", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const foundation = createWitnessTestimony(
      harness,
      "pre_stricken",
      "evidence_complaint_email",
    );
    strikeTestimony(harness, foundation);

    expectIssue(
      harness.state,
      draftComplaintOffer(harness, [foundation]),
      "INVALID_EVIDENCE_STATUS",
    );
  });

  it("rejects admission when offered foundation testimony is later stricken", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const foundation = createWitnessTestimony(
      harness,
      "stricken_after_offer",
      "evidence_complaint_email",
    );
    offerComplaint(harness, [foundation]);
    strikeTestimony(harness, foundation);

    expectIssue(
      harness.state,
      harness.draft(
        "RULE_ON_EVIDENCE",
        {
          evidenceId: "evidence_complaint_email",
          ruling: "admitted",
          reason: "The exhibit was originally offered with foundation.",
        },
        ACTORS.judge,
      ),
      "INVALID_EVIDENCE_STATUS",
    );
  });
});

describe("active v3 witness evidence citation invariants", () => {
  it("rejects an answer citing excluded evidence", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const foundation = createWitnessTestimony(
      harness,
      "excluded",
      "evidence_complaint_email",
    );
    offerComplaint(harness, [foundation]);
    harness.commit(
      "RULE_ON_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        ruling: "excluded",
        reason: "The exhibit is excluded for this simulation.",
      },
      ACTORS.judge,
    );

    const answer = prepareRinaAnswer(harness, "excluded");
    expectIssue(harness.state, answer, "INVALID_EVIDENCE_STATUS");
  });

  it("rejects an answer citing withdrawn evidence", () => {
    const harness = createHarness();
    enterCaseInChief(harness);
    const foundation = createWitnessTestimony(
      harness,
      "withdrawn",
      "evidence_complaint_email",
    );
    offerComplaint(harness, [foundation]);
    harness.commit(
      "WITHDRAW_EVIDENCE",
      { evidenceId: "evidence_complaint_email" },
      ACTORS.userCounsel,
    );

    const answer = prepareRinaAnswer(harness, "withdrawn");
    expectIssue(harness.state, answer, "INVALID_EVIDENCE_STATUS");
  });
});
