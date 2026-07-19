import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import { buildJuryRecord } from "../knowledge";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  commitAction,
  createStartTrialAction,
  reduceTrial,
  validateAction,
  type ActorRef,
  type CommitResult,
  type OpposingStrategyState,
  type TrialEvent,
  type TrialState,
} from "./index";

const TRIAL_ID = "trial_opposing_strategy";
const BASE_TIME_MS = Date.parse("2026-07-19T00:00:00.000Z");
const PENDING_DIRECTIVE_CANARY = JSON.stringify({
  schemaVersion: "hearing-opponent-directive.v1",
  kind: "question_witness",
  canary: "pending_directive_must_remain_private",
});

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
  clerk: {
    actorId: "actor_clerk",
    role: "clerk",
    side: "neutral",
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

type StrategyPayload = {
  strategyId: string;
  revision: number;
  objectives: string[];
  witnessPriorityIds: string[];
  evidencePriorityIds: string[];
  settlementPosture: "avoid" | "explore" | "counter" | "recommend_acceptance";
  privateNotes: string[];
  pendingDirectiveJson?: string | null;
};

const INITIAL_STRATEGY: StrategyPayload = {
  strategyId: "strategy_redwood_case_in_chief",
  revision: 1,
  objectives: [
    "Establish that the revision history supports independent authorship.",
    "Test the reliability of the complaint timeline.",
  ],
  witnessPriorityIds: ["witness_theo_morgan", "witness_rina_shah"],
  evidencePriorityIds: ["evidence_revision_history", "evidence_draft_metadata"],
  settlementPosture: "explore",
  privateNotes: ["jury_must_not_see_strategy_secret"],
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

function createHarness() {
  const graph = createThreeWitnessCaseGraphV1Fixture();
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
    const result = commitAction(
      null,
      createStartTrialAction({
        trialId: TRIAL_ID,
        ...nextIdentity("start_trial"),
        graph,
        actors: Object.values(ACTORS),
        actorBindings: actorBindings(),
      }),
    );
    state = result.state;
    events.push(result.event);
    return result;
  }

  function draftStrategy(
    payload: StrategyPayload,
    actor: ActorRef = ACTORS.opposingCounsel,
  ): unknown {
    if (state === null) throw new Error("Start the harness before drafting strategy");
    return {
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      ...nextIdentity("update_opposing_strategy"),
      trialId: TRIAL_ID,
      expectedStateVersion: state.version,
      actor,
      source: "deterministic",
      causationId: events.at(-1)?.eventId ?? null,
      correlationId: TRIAL_ID,
      responseId: null,
      interruptId: null,
      modelMetadata: null,
      type: "UPDATE_OPPOSING_STRATEGY",
      payload,
    };
  }

  function commitStrategy(
    payload: StrategyPayload,
    actor: ActorRef = ACTORS.opposingCounsel,
  ): CommitResult {
    const result = commitAction(state, draftStrategy(payload, actor));
    state = result.state;
    events.push(result.event);
    return result;
  }

  return {
    events,
    graph,
    start,
    draftStrategy,
    commitStrategy,
    get state(): TrialState {
      if (state === null) throw new Error("Harness trial has not started");
      return state;
    },
  };
}

function strategyState(state: TrialState): OpposingStrategyState | null {
  return (
    state as TrialState & {
      opposingStrategy: OpposingStrategyState | null;
    }
  ).opposingStrategy;
}

function expectIssue(
  state: TrialState,
  action: unknown,
  code: string,
): void {
  expect(validateAction(state, action)).toMatchObject({
    ok: false,
    issue: { code },
  });
}

function nextStrategy(
  revision: number,
  overrides: Partial<StrategyPayload> = {},
): StrategyPayload {
  return {
    ...INITIAL_STRATEGY,
    revision,
    objectives: ["Impeach the timeline with the revision metadata."],
    settlementPosture: "counter",
    privateNotes: ["Preserve the metadata foundation before cross-examination."],
    ...overrides,
  };
}

describe("opposing-counsel strategy events", () => {
  it("allows only opposing counsel to update private strategy state", () => {
    const harness = createHarness();
    harness.start();

    for (const actor of Object.values(ACTORS)) {
      if (actor.role === "opposing_counsel") continue;
      expectIssue(
        harness.state,
        harness.draftStrategy(INITIAL_STRATEGY, actor),
        "ACTOR_NOT_PERMITTED",
      );
    }

    harness.commitStrategy(INITIAL_STRATEGY);
    expect(strategyState(harness.state)).toMatchObject({
      strategyId: INITIAL_STRATEGY.strategyId,
      revision: 1,
      objectives: INITIAL_STRATEGY.objectives,
      witnessPriorityIds: INITIAL_STRATEGY.witnessPriorityIds,
      evidencePriorityIds: INITIAL_STRATEGY.evidencePriorityIds,
      settlementPosture: INITIAL_STRATEGY.settlementPosture,
      privateNotes: INITIAL_STRATEGY.privateNotes,
    });
    expect(
      Object.keys(strategyState(harness.state) ?? {}),
    ).not.toContain("pendingDirectiveJson");
    expect(Object.keys(harness.events[1].payload)).not.toContain(
      "pendingDirectiveJson",
    );
  });

  it("persists and replays a bounded private pending directive", () => {
    const harness = createHarness();
    harness.start();
    const committed = harness.commitStrategy({
      ...INITIAL_STRATEGY,
      pendingDirectiveJson: PENDING_DIRECTIVE_CANARY,
    });
    if (committed.event.type !== "UPDATE_OPPOSING_STRATEGY") {
      throw new Error("Expected an opposing-strategy event");
    }

    expect(committed.event.payload).toMatchObject({
      pendingDirectiveJson: PENDING_DIRECTIVE_CANARY,
    });
    expect(strategyState(harness.state)?.pendingDirectiveJson).toBe(
      PENDING_DIRECTIVE_CANARY,
    );
    expect(
      strategyState(reduceTrial(harness.events))?.pendingDirectiveJson,
    ).toBe(PENDING_DIRECTIVE_CANARY);

    const cleared = harness.commitStrategy(
      nextStrategy(2, { pendingDirectiveJson: null }),
    );
    if (cleared.event.type !== "UPDATE_OPPOSING_STRATEGY") {
      throw new Error("Expected an opposing-strategy clearing event");
    }
    expect(cleared.event.payload.pendingDirectiveJson).toBeNull();
    expect(strategyState(harness.state)?.pendingDirectiveJson).toBeNull();
  });

  it("rejects empty and oversized pending directives", () => {
    const harness = createHarness();
    harness.start();

    expectIssue(
      harness.state,
      harness.draftStrategy({
        ...INITIAL_STRATEGY,
        pendingDirectiveJson: "",
      }),
      "INVALID_ACTION",
    );
    expectIssue(
      harness.state,
      harness.draftStrategy({
        ...INITIAL_STRATEGY,
        pendingDirectiveJson: "x".repeat(32_001),
      }),
      "INVALID_ACTION",
    );
  });

  it("requires revision one initially, then the same strategy ID and sequential revisions", () => {
    const harness = createHarness();
    harness.start();

    expectIssue(
      harness.state,
      harness.draftStrategy(nextStrategy(2)),
      "INVALID_ACTION",
    );

    harness.commitStrategy(INITIAL_STRATEGY);

    expectIssue(
      harness.state,
      harness.draftStrategy(nextStrategy(2, { strategyId: "strategy_replacement" })),
      "INVALID_ACTION",
    );
    expectIssue(
      harness.state,
      harness.draftStrategy(nextStrategy(3)),
      "INVALID_ACTION",
    );

    harness.commitStrategy(nextStrategy(2));
    expect(strategyState(harness.state)).toMatchObject({
      strategyId: INITIAL_STRATEGY.strategyId,
      revision: 2,
      settlementPosture: "counter",
    });
  });

  it("rejects unknown witness and evidence priorities", () => {
    const harness = createHarness();
    harness.start();

    expectIssue(
      harness.state,
      harness.draftStrategy({
        ...INITIAL_STRATEGY,
        witnessPriorityIds: ["witness_not_in_trial"],
      }),
      "UNKNOWN_WITNESS",
    );
    expectIssue(
      harness.state,
      harness.draftStrategy({
        ...INITIAL_STRATEGY,
        evidencePriorityIds: ["evidence_not_in_trial"],
      }),
      "UNKNOWN_EVIDENCE",
    );
  });

  it("retains append-only strategy revisions and replays to byte-identical state", () => {
    const harness = createHarness();
    harness.start();
    const first = harness.commitStrategy(INITIAL_STRATEGY);
    const immutableFirstEvent = JSON.stringify(first.event);
    const second = harness.commitStrategy(nextStrategy(2));

    expect(JSON.stringify(harness.events[1])).toBe(immutableFirstEvent);
    expect(harness.events).toHaveLength(3);
    expect(
      harness.events
        .filter((event) => event.type === "UPDATE_OPPOSING_STRATEGY")
        .map((event) => event.payload.revision),
    ).toEqual([1, 2]);
    expect(second.event.causationId).toBe(first.event.eventId);

    const firstReplay = reduceTrial(harness.events);
    const secondReplay = reduceTrial(harness.events);
    expect(strategyState(firstReplay)).toMatchObject({
      strategyId: INITIAL_STRATEGY.strategyId,
      revision: 2,
    });
    expect(JSON.stringify(firstReplay)).toBe(JSON.stringify(harness.state));
    expect(JSON.stringify(secondReplay)).toBe(JSON.stringify(firstReplay));
  });

  it("omits strategy and private notes from the existing jury-safe projection", () => {
    const harness = createHarness();
    harness.start();
    harness.commitStrategy(INITIAL_STRATEGY);
    expect(strategyState(harness.state)?.revision).toBe(1);

    const juryRecord = buildJuryRecord({
      trial: harness.state,
      caseGraph: harness.graph,
    });
    const serialized = JSON.stringify(juryRecord);

    expect(Object.keys(juryRecord)).not.toContain("opposingStrategy");
    expect(serialized).not.toContain(INITIAL_STRATEGY.strategyId);
    expect(serialized).not.toContain(INITIAL_STRATEGY.objectives[0]);
    expect(serialized).not.toContain(INITIAL_STRATEGY.privateNotes[0]);
  });
});
