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
  type StrikeMotionStateEntry,
  type TrialActionByType,
  type TrialActionType,
  type TrialStateV3,
} from "../trial-engine";
import {
  actorFromBindings,
  deriveTrialActorBindings,
} from "./actors";
import { deriveOpponentStrikeableTestimonyIds } from "./opponent-strike-opportunities";

const BASE_TIME = Date.parse("2026-07-20T00:00:00.000Z");

type ExaminationKind = "direct" | "cross" | "redirect" | "recross";

function createHarness() {
  const graph = CaseGraphV1Schema.parse(
    createThreeWitnessCaseGraphV1Fixture(),
  );
  const bindings = deriveTrialActorBindings(graph);
  const trialId = "trial:opponent-strike-opportunities";
  let identity = 0;
  let state = commitAction(
    null,
    createStartTrialAction({
      trialId,
      actionId: "action:opponent-strike-opportunities:start",
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
      actionId: `action:opponent-strike-opportunities:${identity}:${type.toLowerCase()}`,
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

function counselFor(harness: Harness, kind: ExaminationKind): ActorRef {
  return kind === "direct" || kind === "redirect"
    ? harness.userCounsel
    : harness.opposingCounsel;
}

function askAndAnswer(
  harness: Harness,
  kind: ExaminationKind,
  suffix: string,
): { testimonyId: string; answerTurnId: string } {
  const questionId = `question:${suffix}`;
  const responseId = `response:${suffix}`;
  const testimonyId = `testimony:${suffix}`;
  const answerTurnId = `turn:answer:${suffix}`;
  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId: harness.witness.witnessId!,
      examinationKind: kind,
      text: `Please answer the ${kind} question for ${suffix}.`,
      turnId: `turn:question:${suffix}`,
      presentedEvidenceIds: [],
    },
    counselFor(harness, kind),
  );
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
      testimonyId,
      turnId: answerTurnId,
      text: `Grounded ${kind} answer for ${suffix}.`,
      factIds: [],
      evidenceIds: [],
    },
    harness.witness,
  );
  return { testimonyId, answerTurnId };
}

function endExamination(
  harness: Harness,
  kind: ExaminationKind,
  disposition: "completed" | "waived" = "completed",
): void {
  harness.commit(
    "END_EXAMINATION",
    {
      witnessId: harness.witness.witnessId!,
      examinationKind: kind,
      disposition,
    },
    counselFor(harness, kind),
  );
}

function strikeable(
  state: TrialStateV3,
  publicTestimonyIds: readonly string[],
): readonly string[] {
  return deriveOpponentStrikeableTestimonyIds({
    state,
    publicTestimonyIds,
  });
}

describe("opponent strike opportunities", () => {
  it("returns sorted public player-direct testimony only when cross begins", () => {
    const harness = createHarness();
    const laterId = askAndAnswer(harness, "direct", "zulu").testimonyId;
    const earlierId = askAndAnswer(harness, "direct", "alpha").testimonyId;

    expect(strikeable(harness.state, [laterId, earlierId])).toEqual([]);

    endExamination(harness, "direct");
    const result = strikeable(harness.state, [
      laterId,
      "testimony:not-public-record",
      earlierId,
      earlierId,
    ]);

    expect(result).toEqual([earlierId, laterId]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(strikeable(harness.state, [laterId])).toEqual([laterId]);
    expect(strikeable(harness.state, [])).toEqual([]);
  });

  it("offers only player redirect testimony during recross", () => {
    const harness = createHarness();
    const directId = askAndAnswer(harness, "direct", "direct").testimonyId;
    endExamination(harness, "direct");
    const crossId = askAndAnswer(harness, "cross", "cross").testimonyId;
    endExamination(harness, "cross");
    const redirectId = askAndAnswer(
      harness,
      "redirect",
      "redirect",
    ).testimonyId;
    endExamination(harness, "redirect");

    expect(
      strikeable(harness.state, [directId, crossId, redirectId]),
    ).toEqual([redirectId]);
  });

  it("keeps prior-appearance testimony out of a recalled witness's cross", () => {
    const harness = createHarness();
    const priorId = askAndAnswer(
      harness,
      "direct",
      "prior-appearance",
    ).testimonyId;
    endExamination(harness, "direct");
    endExamination(harness, "cross", "waived");
    harness.commit(
      "RELEASE_WITNESS",
      { witnessId: harness.witness.witnessId! },
      harness.userCounsel,
    );
    harness.commit(
      "RECALL_WITNESS",
      { witnessId: harness.witness.witnessId!, calledBySide: "user" },
      harness.userCounsel,
    );
    harness.commit(
      "SWEAR_WITNESS",
      { witnessId: harness.witness.witnessId! },
      harness.judge,
    );
    const currentId = askAndAnswer(
      harness,
      "direct",
      "current-appearance",
    ).testimonyId;
    endExamination(harness, "direct");

    const stateWithPriorMotion: TrialStateV3 = {
      ...harness.state,
      strikeMotions: {
        "motion:prior": {
          motionId: "motion:prior",
          movedByActorId: harness.opposingCounsel.actorId,
          testimonyIds: [priorId],
          reason: "A prior appearance does not consume this appearance.",
          status: "denied",
          sourceEventId: "event:motion:prior",
          rulingEventId: "event:ruling:prior",
        },
      },
    };

    expect(strikeable(stateWithPriorMotion, [priorId, currentId])).toEqual([
      currentId,
    ]);
  });

  it("requires an active case-in-chief appearance owned by the AI opponent", () => {
    const harness = createHarness();
    const testimonyId = askAndAnswer(
      harness,
      "direct",
      "active-context",
    ).testimonyId;
    endExamination(harness, "direct");
    const appearanceId = harness.state.activeAppearanceId!;
    const appearance = harness.state.appearances[appearanceId];

    expect(
      strikeable({ ...harness.state, status: "paused" }, [testimonyId]),
    ).toEqual([]);
    expect(
      strikeable({ ...harness.state, phase: "opening" }, [testimonyId]),
    ).toEqual([]);
    expect(
      strikeable({ ...harness.state, activeAppearanceId: null }, [testimonyId]),
    ).toEqual([]);
    expect(
      strikeable({ ...harness.state, activeWitnessId: null }, [testimonyId]),
    ).toEqual([]);
    expect(
      strikeable(
        {
          ...harness.state,
          appearances: {
            ...harness.state.appearances,
            [appearanceId]: {
              ...appearance,
              legs: {
                ...appearance.legs,
                cross: {
                  ...appearance.legs.cross,
                  ownerSide: harness.state.userSide,
                },
              },
            },
          },
        },
        [testimonyId],
      ),
    ).toEqual([]);
  });

  it("requires both active testimony and its active transcript turn", () => {
    const harness = createHarness();
    const first = askAndAnswer(harness, "direct", "stricken-entry");
    const second = askAndAnswer(harness, "direct", "stricken-turn");
    endExamination(harness, "direct");

    const state: TrialStateV3 = {
      ...harness.state,
      testimony: {
        ...harness.state.testimony,
        [first.testimonyId]: {
          ...harness.state.testimony[first.testimonyId],
          status: "stricken",
        },
      },
      transcriptTurns: {
        ...harness.state.transcriptTurns,
        [second.answerTurnId]: {
          ...harness.state.transcriptTurns[second.answerTurnId],
          status: "stricken",
        },
      },
    };

    expect(
      strikeable(state, [first.testimonyId, second.testimonyId]),
    ).toEqual([]);
  });

  it("consumes the appearance after one motion regardless of its status", () => {
    const statuses: StrikeMotionStateEntry["status"][] = [
      "pending",
      "granted",
      "denied",
      "withdrawn",
    ];

    for (const status of statuses) {
      const harness = createHarness();
      const targetedId = askAndAnswer(
        harness,
        "direct",
        `targeted-${status}`,
      ).testimonyId;
      const otherwiseEligibleId = askAndAnswer(
        harness,
        "direct",
        `eligible-${status}`,
      ).testimonyId;
      endExamination(harness, "direct");
      const motion: StrikeMotionStateEntry = {
        motionId: `motion:${status}`,
        movedByActorId: harness.opposingCounsel.actorId,
        testimonyIds: [targetedId],
        reason: "Only one strike-motion opportunity is allowed per appearance.",
        status,
        sourceEventId: `event:motion:${status}`,
        rulingEventId:
          status === "pending" ? null : `event:ruling:${status}`,
      };
      const state: TrialStateV3 = {
        ...harness.state,
        strikeMotions: { [motion.motionId]: motion },
      };

      expect(strikeable(state, [otherwiseEligibleId])).toEqual([]);
    }
  });
});
