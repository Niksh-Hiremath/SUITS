import { describe, expect, it } from "vitest";

import {
  createThreeWitnessCaseGraphV1Fixture,
  type CaseGraphV1,
} from "../case-graph";
import {
  createTrialPolicySnapshot,
  type TrialPolicyActorBindingInput,
  type TrialPolicySnapshot,
} from "../trial-policy";
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

const TRIAL_ID = "trial_policy_enforcement";
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
  jury: {
    actorId: "actor_jury",
    role: "jury",
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
} as const satisfies Record<string, ActorRef>;

const ACTOR_ROSTER = Object.values(ACTORS);

type PolicyCarrier = {
  policySnapshot?: TrialPolicySnapshot;
};

function actorBindings(): TrialPolicyActorBindingInput[] {
  return [
    { actor: ACTORS.system, representedPartyIds: [] },
    { actor: ACTORS.judge, representedPartyIds: [] },
    { actor: ACTORS.jury, representedPartyIds: [] },
    {
      actor: ACTORS.userCounsel,
      representedPartyIds: ["party_rina_shah"],
    },
    {
      actor: ACTORS.opposingCounsel,
      representedPartyIds: ["party_redwood_signal"],
    },
    { actor: ACTORS.rina, representedPartyIds: [] },
    { actor: ACTORS.theo, representedPartyIds: [] },
    { actor: ACTORS.maya, representedPartyIds: [] },
  ];
}

function policyFromPayload(payload: unknown): TrialPolicySnapshot | undefined {
  return (payload as PolicyCarrier).policySnapshot;
}

function policyFromState(state: TrialState): TrialPolicySnapshot | undefined {
  return (state as TrialState & PolicyCarrier).policySnapshot;
}

type Harness = ReturnType<typeof createHarness>;

function createHarness(graph: CaseGraphV1 = createThreeWitnessCaseGraphV1Fixture()) {
  let state: TrialState | null = null;
  let identity = 0;
  const events: TrialEvent[] = [];

  function nextIdentity(type: string): {
    actionId: string;
    requestedAt: string;
  } {
    identity += 1;
    return {
      actionId: `action_policy_${String(identity).padStart(3, "0")}_${type.toLowerCase()}`,
      requestedAt: new Date(BASE_TIME_MS + identity * 1_000).toISOString(),
    };
  }

  function start(): CommitResult {
    if (state !== null) throw new Error("Harness trial already started");
    const action = createStartTrialAction({
      trialId: TRIAL_ID,
      ...nextIdentity("start_trial"),
      graph,
      actors: ACTOR_ROSTER,
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
    if (state === null) throw new Error("Start the trial before drafting actions");
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

  function expectDenied<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
    code: TrialEngineErrorCode,
  ): void {
    if (state === null) throw new Error("Start the trial before validating actions");
    const before = state;
    const result = tryCommitAction(state, draft(type, payload, actor));
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error(`Expected ${type} to be denied by trial policy`);
    }
    expect(result.issue.code).toBe(code);
    expect(state).toBe(before);
  }

  return {
    events,
    graph,
    start,
    draft,
    commit,
    expectDenied,
    get state(): TrialState {
      if (state === null) throw new Error("Harness trial has not started");
      return state;
    },
  };
}

function enterCaseInChief(harness: Harness): void {
  harness.start();
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
}

function settlementTerms(
  amount: number,
  nonMonetaryTerms: string[] = [],
) {
  return {
    amount,
    currency: "USD" as const,
    nonMonetaryTerms,
    summary: `Settle this fictional matter for USD ${amount}.`,
  };
}

function exactExpiry(harness: Harness): number {
  return (
    harness.state.lastSequence +
    1 +
    harness.graph.settlement.expiresAfterEventCount
  );
}

function addAuditAssertion(harness: Harness, suffix: string): void {
  harness.commit(
    "PROPOSE_ASSERTION",
    {
      factId: `fact_policy_clock_${suffix}`,
      proposition: `Policy-clock event ${suffix} advanced the append-only trial sequence.`,
      provenanceIds: [`provenance_policy_clock_${suffix}`],
      visibility: "public",
    },
    ACTORS.userCounsel,
  );
}

describe("TrialPolicySnapshot enforcement by the trial engine", () => {
  it("pins the exact private policy in START_TRIAL and preserves it through events and replay", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const expected = createTrialPolicySnapshot({
      graph,
      actorBindings: actorBindings(),
    });
    const harness = createHarness(graph);

    const started = harness.start();

    expect(policyFromPayload(started.action.payload)).toEqual(expected);
    expect(policyFromPayload(started.event.payload)).toEqual(expected);
    expect(policyFromState(started.state)).toEqual(expected);
    expect(policyFromState(started.state)?.settlement.partyAuthorities).toEqual(
      expected.settlement.partyAuthorities,
    );

    graph.settlement.participants[0].minimumAuthority = 0;
    graph.settlement.participants[0].confidentialPriorities.push(
      "Mutation after START_TRIAL",
    );
    graph.witnesses[0].callableByPartyIds = ["party_redwood_signal"];

    harness.commit("BEGIN_PHASE", { phase: "opening" }, ACTORS.judge);
    expect(policyFromState(harness.state)).toEqual(expected);

    const replayed = reduceTrial(harness.events);
    expect(policyFromState(replayed)).toEqual(expected);
    expect(JSON.stringify(policyFromState(replayed))).toBe(
      JSON.stringify(policyFromPayload(started.event.payload)),
    );
  });

  it("denies witness calls and recalls outside the pinned callability rule", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    graph.witnesses.find(
      (witness) => witness.witnessId === "witness_rina_shah",
    )!.callableByPartyIds = ["party_rina_shah"];
    const harness = createHarness(graph);
    enterCaseInChief(harness);

    harness.expectDenied(
      "CALL_WITNESS",
      { witnessId: "witness_rina_shah", calledBySide: "opposing" },
      ACTORS.opposingCounsel,
      "ACTOR_NOT_PERMITTED",
    );

    harness.commit(
      "CALL_WITNESS",
      { witnessId: "witness_rina_shah", calledBySide: "user" },
      ACTORS.userCounsel,
    );
    harness.commit(
      "RELEASE_WITNESS",
      { witnessId: "witness_rina_shah" },
      ACTORS.userCounsel,
    );

    harness.expectDenied(
      "RECALL_WITNESS",
      { witnessId: "witness_rina_shah", calledBySide: "opposing" },
      ACTORS.opposingCounsel,
      "ACTOR_NOT_PERMITTED",
    );
  });

  it("denies evidence offers by actors outside the pinned proponent rule", () => {
    const harness = createHarness();
    enterCaseInChief(harness);

    harness.expectDenied(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        offeredBySide: "opposing",
        foundationTestimonyIds: [],
      },
      ACTORS.opposingCounsel,
      "ACTOR_NOT_PERMITTED",
    );
  });

  it("denies objection grounds omitted from the pinned jurisdiction policy", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    graph.jurisdictionProfile.permittedObjectionGrounds = ["relevance"];
    const harness = createHarness(graph);
    enterCaseInChief(harness);
    harness.commit(
      "CALL_WITNESS",
      { witnessId: "witness_rina_shah", calledBySide: "user" },
      ACTORS.userCounsel,
    );
    harness.commit(
      "SWEAR_WITNESS",
      { witnessId: "witness_rina_shah" },
      ACTORS.judge,
    );
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question_policy_objection",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did the access log show?",
        turnId: "turn_policy_objection_question",
      },
      ACTORS.userCounsel,
    );

    harness.expectDenied(
      "OBJECT",
      {
        objectionId: "objection_disallowed_hearsay",
        questionId: "question_policy_objection",
        ground: "hearsay",
        interruptedResponseId: null,
      },
      ACTORS.opposingCounsel,
      "ACTOR_NOT_PERMITTED",
    );
  });

  it("enforces settlement enablement and the configured opening phase", () => {
    const disabledGraph = createThreeWitnessCaseGraphV1Fixture();
    disabledGraph.settlement.enabled = false;
    const disabled = createHarness(disabledGraph);
    disabled.start();
    disabled.expectDenied(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_disabled",
        parentOfferId: null,
        terms: settlementTerms(100_000, ["Neutral reference"]),
        expiresAtSequence: exactExpiry(disabled),
      },
      ACTORS.userCounsel,
      "INVALID_SETTLEMENT_STATUS",
    );

    const delayedGraph = createThreeWitnessCaseGraphV1Fixture();
    delayedGraph.settlement.opensAtPhase = "case_in_chief";
    const delayed = createHarness(delayedGraph);
    delayed.start();
    delayed.expectDenied(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_too_early",
        parentOfferId: null,
        terms: settlementTerms(100_000, ["Neutral reference"]),
        expiresAtSequence: exactExpiry(delayed),
      },
      ACTORS.userCounsel,
      "WRONG_PHASE",
    );
  });

  it("rejects counteroffers when the pinned switch is disabled", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    graph.settlement.allowCounteroffers = false;
    const harness = createHarness(graph);
    harness.start();
    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_no_counter_parent",
        parentOfferId: null,
        terms: settlementTerms(100_000, ["Neutral reference"]),
        expiresAtSequence: exactExpiry(harness),
      },
      ACTORS.userCounsel,
    );

    harness.expectDenied(
      "COUNTER_SETTLEMENT",
      {
        offerId: "offer_disallowed_counter",
        parentOfferId: "offer_no_counter_parent",
        terms: settlementTerms(50_000, ["Confidentiality"]),
        expiresAtSequence: exactExpiry(harness),
      },
      ACTORS.opposingCounsel,
      "INVALID_SETTLEMENT_STATUS",
    );
  });

  it("requires the configured expiry and permits expiry at the exact event boundary", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    graph.settlement.expiresAfterEventCount = 3;
    const harness = createHarness(graph);
    harness.start();
    const configuredExpiry = exactExpiry(harness);

    harness.expectDenied(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_wrong_expiry",
        parentOfferId: null,
        terms: settlementTerms(100_000, ["Neutral reference"]),
        expiresAtSequence: configuredExpiry + 1,
      },
      ACTORS.userCounsel,
      "INVALID_SETTLEMENT_STATUS",
    );

    harness.commit(
      "PROPOSE_SETTLEMENT",
      {
        offerId: "offer_exact_expiry",
        parentOfferId: null,
        terms: settlementTerms(100_000, ["Neutral reference"]),
        expiresAtSequence: configuredExpiry,
      },
      ACTORS.userCounsel,
    );
    expect(harness.events.at(-1)?.sequence).toBe(2);
    expect(configuredExpiry).toBe(5);

    addAuditAssertion(harness, "before_boundary_one");
    expect(harness.state.lastSequence).toBe(3);
    harness.expectDenied(
      "EXPIRE_SETTLEMENT",
      { offerId: "offer_exact_expiry" },
      ACTORS.system,
      "INVALID_SETTLEMENT_STATUS",
    );

    addAuditAssertion(harness, "before_boundary_two");
    expect(harness.state.lastSequence).toBe(4);
    const expired = harness.commit(
      "EXPIRE_SETTLEMENT",
      { offerId: "offer_exact_expiry" },
      ACTORS.system,
    );

    expect(expired.event.sequence).toBe(configuredExpiry);
    expect(expired.state.settlementOffers.offer_exact_expiry.status).toBe(
      "expired",
    );
  });
});
