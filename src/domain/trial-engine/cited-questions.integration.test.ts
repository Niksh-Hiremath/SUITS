import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  TrialActionV1Schema,
  TrialActionV2Schema,
  TrialActionV3Schema,
  commitAction,
  createStartTrialAction,
  validateAction,
  type ActorRef,
  type CommitResult,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialEngineErrorCode,
  type TrialState,
} from "./index";

const TRIAL_ID = "trial_cited_questions";
const BASE_TIME_MS = Date.parse("2026-07-19T05:00:00.000Z");

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
  clerk: {
    actorId: "actor_clerk",
    role: "clerk",
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

  function identityFor(type: string): {
    actionId: string;
    requestedAt: string;
  } {
    identity += 1;
    return {
      actionId: `action_cited_question_${identity}_${type.toLowerCase()}`,
      requestedAt: new Date(BASE_TIME_MS + identity * 1_000).toISOString(),
    };
  }

  function draft<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
  ): TrialAction {
    if (state === null) throw new Error("Start the cited-question harness first");
    const payloadRecord = payload as unknown as Record<string, unknown>;
    return TrialActionSchema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      ...identityFor(type),
      trialId: TRIAL_ID,
      expectedStateVersion: state.version,
      actor,
      source: "deterministic",
      causationId: state.eventIds.at(-1) ?? null,
      correlationId: TRIAL_ID,
      responseId:
        typeof payloadRecord.responseId === "string"
          ? payloadRecord.responseId
          : null,
      interruptId: null,
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
    return result;
  }

  function reject<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
    expectedCode: TrialEngineErrorCode,
  ): void {
    if (state === null) throw new Error("Start the cited-question harness first");
    const before = state;
    const result = validateAction(state, draft(type, payload, actor));
    expect(result).toMatchObject({ ok: false, issue: { code: expectedCode } });
    expect(state).toBe(before);
  }

  const start = commitAction(
    null,
    createStartTrialAction({
      trialId: TRIAL_ID,
      ...identityFor("start_trial"),
      graph: createThreeWitnessCaseGraphV1Fixture(),
      actors: Object.values(ACTORS),
      actorBindings: actorBindings(),
    }),
  );
  state = start.state;
  commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
  commit(
    "CALL_WITNESS",
    { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
    ACTORS.userCounsel,
  );
  commit(
    "SWEAR_WITNESS",
    { witnessId: ACTORS.rina.witnessId },
    ACTORS.clerk,
  );

  return {
    commit,
    reject,
    get state(): TrialState {
      if (state === null) throw new Error("Cited-question harness is not started");
      return state;
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

function askPayload(
  suffix: string,
  citations: Readonly<{
    factIds?: string[];
    evidenceIds?: string[];
    testimonyIds?: string[];
  }> = {},
): TrialActionByType<"ASK_QUESTION">["payload"] {
  return {
    questionId: `question_${suffix}`,
    witnessId: ACTORS.rina.witnessId,
    examinationKind: "direct",
    text: `What does the record show for ${suffix}?`,
    turnId: `turn_question_${suffix}`,
    presentedEvidenceIds: [],
    ...citations,
  };
}

function commitAnswer(
  harness: Harness,
  suffix: string,
  factId: string,
): string {
  const questionId = `question_${suffix}`;
  const responseId = `response_${suffix}`;
  const testimonyId = `testimony_${suffix}`;
  harness.commit("ASK_QUESTION", askPayload(suffix), ACTORS.userCounsel);
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
      turnId: `turn_answer_${suffix}`,
      text: `Grounded answer for ${suffix}.`,
      factIds: [factId],
      evidenceIds: [],
    },
    ACTORS.rina,
  );
  return testimonyId;
}

function frozenQuestionAction(
  schemaVersion: "trial-action.v1" | "trial-action.v2",
  extraPayload: Record<string, unknown>,
): unknown {
  return {
    schemaVersion,
    actionId: `action_frozen_${schemaVersion}`,
    trialId: "trial_frozen_question",
    expectedStateVersion: 4,
    actor: ACTORS.userCounsel,
    source: "deterministic",
    requestedAt: "2026-07-19T05:00:00.000Z",
    causationId: "event_previous",
    correlationId: "trial_frozen_question",
    responseId: null,
    interruptId: null,
    modelMetadata: null,
    type: "ASK_QUESTION",
    payload: {
      questionId: "question_frozen",
      witnessId: ACTORS.rina.witnessId,
      examinationKind: "direct",
      text: "What happened?",
      turnId: "turn_question_frozen",
      ...extraPayload,
    },
  };
}

describe("V3 cited courtroom questions", () => {
  it("keeps V1 and V2 question payloads frozen", () => {
    for (const schema of [TrialActionV1Schema, TrialActionV2Schema]) {
      for (const field of [
        "factIds",
        "evidenceIds",
        "testimonyIds",
      ] as const) {
        expect(
          schema.safeParse(
            frozenQuestionAction(
              schema === TrialActionV1Schema
                ? "trial-action.v1"
                : "trial-action.v2",
              { [field]: [`${field}_not_permitted`] },
            ),
          ).success,
        ).toBe(false);
      }
    }
  });

  it("preserves the serialized shape of a legacy V3 question that omits citations", () => {
    const payload = {
      questionId: "question_legacy_v3",
      witnessId: ACTORS.rina.witnessId,
      examinationKind: "direct" as const,
      text: "What happened?",
      turnId: "turn_question_legacy_v3",
      presentedEvidenceIds: [] as string[],
    };
    const parsed = TrialActionV3Schema.parse({
      schemaVersion: "trial-action.v3",
      actionId: "action_legacy_v3_question",
      trialId: "trial_legacy_v3_question",
      expectedStateVersion: 4,
      actor: ACTORS.userCounsel,
      source: "deterministic",
      requestedAt: "2026-07-19T05:00:00.000Z",
      causationId: "event_previous",
      correlationId: "trial_legacy_v3_question",
      responseId: null,
      interruptId: null,
      modelMetadata: null,
      type: "ASK_QUESTION",
      payload,
    });

    expect(JSON.stringify(parsed.payload)).toBe(JSON.stringify(payload));
    expect("factIds" in parsed.payload).toBe(false);
    expect("evidenceIds" in parsed.payload).toBe(false);
    expect("testimonyIds" in parsed.payload).toBe(false);
  });

  it("copies valid fact and active-testimony citations into the event and transcript", () => {
    const harness = createHarness();
    const testimonyId = commitAnswer(
      harness,
      "citation_basis",
      "fact_complaint_sent",
    );
    const result = harness.commit(
      "ASK_QUESTION",
      askPayload("cited", {
        factIds: ["fact_complaint_sent"],
        evidenceIds: ["evidence_complaint_email"],
        testimonyIds: [testimonyId],
      }),
      ACTORS.userCounsel,
    );

    expect(result.event.citations).toEqual({
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
      testimonyIds: [testimonyId],
      eventIds: [],
      sourceSegmentIds: [],
    });
    expect(
      harness.state.transcriptTurns.turn_question_cited.citations,
    ).toEqual(result.event.citations);
  });

  it("rejects hidden, unknown, and duplicate fact or testimony citations", () => {
    const harness = createHarness();
    const testimonyId = commitAnswer(
      harness,
      "rejection_basis",
      "fact_complaint_sent",
    );

    harness.reject(
      "ASK_QUESTION",
      askPayload("hidden_fact", {
        factIds: ["fact_manager_accessed_complaint"],
      }),
      ACTORS.userCounsel,
      "INVALID_FACT_STATUS",
    );
    harness.reject(
      "ASK_QUESTION",
      askPayload("unknown_fact", { factIds: ["fact_unknown"] }),
      ACTORS.userCounsel,
      "UNKNOWN_FACT",
    );
    harness.reject(
      "ASK_QUESTION",
      askPayload("duplicate_fact", {
        factIds: ["fact_complaint_sent", "fact_complaint_sent"],
      }),
      ACTORS.userCounsel,
      "DUPLICATE_ENTITY_ID",
    );
    harness.reject(
      "ASK_QUESTION",
      askPayload("unknown_evidence", {
        evidenceIds: ["evidence_unknown"],
      }),
      ACTORS.userCounsel,
      "UNKNOWN_EVIDENCE",
    );
    harness.reject(
      "ASK_QUESTION",
      askPayload("duplicate_evidence", {
        evidenceIds: [
          "evidence_complaint_email",
          "evidence_complaint_email",
        ],
      }),
      ACTORS.userCounsel,
      "DUPLICATE_ENTITY_ID",
    );
    harness.reject(
      "ASK_QUESTION",
      askPayload("unknown_testimony", {
        testimonyIds: ["testimony_unknown"],
      }),
      ACTORS.userCounsel,
      "UNKNOWN_TESTIMONY",
    );
    harness.reject(
      "ASK_QUESTION",
      askPayload("duplicate_testimony", {
        testimonyIds: [testimonyId, testimonyId],
      }),
      ACTORS.userCounsel,
      "DUPLICATE_ENTITY_ID",
    );
  });

  it("rejects excluded facts", () => {
    const harness = createHarness();
    harness.commit(
      "DISPUTE_ASSERTION",
      { factId: "fact_late_reports" },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "RULE_ON_ASSERTION",
      {
        factId: "fact_late_reports",
        ruling: "excluded",
        reason: "The current record does not support the assertion.",
      },
      ACTORS.judge,
    );

    harness.reject(
      "ASK_QUESTION",
      askPayload("excluded_fact", { factIds: ["fact_late_reports"] }),
      ACTORS.userCounsel,
      "INVALID_FACT_STATUS",
    );
  });

  it("rejects stricken facts and testimony", () => {
    const harness = createHarness();
    const testimonyId = commitAnswer(
      harness,
      "stricken_basis",
      "fact_late_reports",
    );
    harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion_stricken_question_basis",
        testimonyIds: [testimonyId],
        reason: "The answer exceeded the permitted scope.",
      },
      ACTORS.opposingCounsel,
    );
    harness.commit(
      "STRIKE_TESTIMONY",
      {
        motionId: "motion_stricken_question_basis",
        testimonyIds: [testimonyId],
        factIds: ["fact_late_reports"],
      },
      ACTORS.judge,
    );

    expect(harness.state.facts.fact_late_reports.status).toBe("stricken");
    expect(harness.state.testimony[testimonyId].status).toBe("stricken");
    harness.reject(
      "ASK_QUESTION",
      askPayload("stricken_fact", { factIds: ["fact_late_reports"] }),
      ACTORS.userCounsel,
      "INVALID_FACT_STATUS",
    );
    harness.reject(
      "ASK_QUESTION",
      askPayload("stricken_testimony", { testimonyIds: [testimonyId] }),
      ACTORS.userCounsel,
      "UNKNOWN_TESTIMONY",
    );
  });
});
