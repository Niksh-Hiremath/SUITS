import { describe, expect, it } from "vitest";

import {
  createThreeWitnessCaseGraphV1Fixture,
} from "../case-graph";
import {
  createTrialPolicySnapshotV1,
  type TrialPolicyActorBindingInput,
} from "../trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionV1Schema,
  TrialActionV2Schema,
  TrialActionSchema,
  TrialEventV1Schema,
  TrialEventV2Schema,
  TrialEventV3Schema,
  TrialStateV1Schema,
  TrialStateV2Schema,
  TrialStateV3Schema,
  commitAction,
  createStartTrialAction,
  migrateAndReduceTrialV1,
  migrateAndReduceTrialV1ToV3,
  migrateAndReduceTrialV2ToV3,
  migrateTrialEventStreamV1ToV2,
  migrateTrialEventStreamV1ToV3,
  migrateTrialEventStreamV2ToV3,
  migrateTrialStateV1ToV2,
  migrateTrialStateV2ToV3,
  type ActorRef,
  type TrialEventV1,
  type TrialEventV2,
  type TrialEventV3,
  type TrialState,
  type TrialStateV1,
  type TrialV1MigrationContext,
  type TrialV2ToV3MigrationContext,
} from "./index";

const TRIAL_ID = "trial_frozen_v1";
const STARTED_AT = "2026-07-18T12:00:00.000Z";
const START_ACTION_ID = "action_frozen_v1_start";
const START_EVENT_ID = "event_frozen_v1_start";

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

function migrationContext(
  graph = createThreeWitnessCaseGraphV1Fixture(),
  bindings = actorBindings(),
): TrialV1MigrationContext {
  return { graph, actorBindings: bindings };
}

function v3MigrationContext(
  graph = createThreeWitnessCaseGraphV1Fixture(),
  bindings = actorBindings(),
  additions: Partial<TrialV2ToV3MigrationContext> = {},
): TrialV2ToV3MigrationContext {
  return {
    graph,
    actorBindings: bindings,
    expectedCaseGraphJson: JSON.stringify(graph),
    ...additions,
  };
}

function frozenV1StartPayload(graph = createThreeWitnessCaseGraphV1Fixture()) {
  return {
    caseId: graph.caseId,
    caseVersion: graph.version,
    caseGraphHash: graph.compilerMetadata.sourceContentHash,
    actors: Object.values(ACTORS),
    witnessIds: graph.witnesses.map((witness) => witness.witnessId),
    initialFacts: graph.facts.map((fact) => ({
      factId: fact.factId,
      proposition: fact.proposition,
      status: fact.initialStatus,
      visibility: fact.visibility,
      provenanceIds: fact.provenance.map((entry) => entry.provenanceId),
    })),
    initialEvidence: graph.evidence.map((evidence) => ({
      evidenceId: evidence.evidenceId,
      name: evidence.name,
      status: evidence.initialStatus,
    })),
    userSide: "user" as const,
  };
}

function frozenV1StartAction() {
  return {
    schemaVersion: "trial-action.v1" as const,
    actionId: START_ACTION_ID,
    trialId: TRIAL_ID,
    expectedStateVersion: 0,
    actor: ACTORS.system,
    source: "system" as const,
    requestedAt: STARTED_AT,
    causationId: null,
    correlationId: TRIAL_ID,
    responseId: null,
    interruptId: null,
    modelMetadata: null,
    type: "START_TRIAL" as const,
    payload: frozenV1StartPayload(),
  };
}

function frozenV1EventStream(): TrialEventV1[] {
  return [
    TrialEventV1Schema.parse({
      schemaVersion: "trial-event.v1",
      eventId: START_EVENT_ID,
      trialId: TRIAL_ID,
      sequence: 1,
      stateVersion: 1,
      actionId: START_ACTION_ID,
      actor: ACTORS.system,
      source: "system",
      occurredAt: STARTED_AT,
      causationId: null,
      correlationId: TRIAL_ID,
      responseId: null,
      interruptId: null,
      modelMetadata: null,
      citations: {
        factIds: [],
        evidenceIds: [],
        testimonyIds: [],
        eventIds: [],
        sourceSegmentIds: [],
      },
      type: "START_TRIAL",
      payload: frozenV1StartPayload(),
    }),
    TrialEventV1Schema.parse({
      schemaVersion: "trial-event.v1",
      eventId: "event_frozen_v1_opening",
      trialId: TRIAL_ID,
      sequence: 2,
      stateVersion: 2,
      actionId: "action_frozen_v1_opening",
      actor: ACTORS.judge,
      source: "deterministic",
      occurredAt: "2026-07-18T12:00:01.000Z",
      causationId: START_EVENT_ID,
      correlationId: TRIAL_ID,
      responseId: null,
      interruptId: null,
      modelMetadata: null,
      citations: {
        factIds: [],
        evidenceIds: [],
        testimonyIds: [],
        eventIds: [],
        sourceSegmentIds: [],
      },
      type: "BEGIN_PHASE",
      payload: { phase: "opening" },
    }),
  ];
}

function frozenV1State(): TrialStateV1 {
  const payload = frozenV1StartPayload();
  return TrialStateV1Schema.parse({
    schemaVersion: "trial-state.v1",
    trialId: TRIAL_ID,
    caseId: payload.caseId,
    caseVersion: payload.caseVersion,
    caseGraphHash: payload.caseGraphHash,
    version: 1,
    lastSequence: 1,
    phase: "pretrial",
    phaseBeforeRecess: null,
    status: "active",
    startedAt: STARTED_AT,
    updatedAt: STARTED_AT,
    userSide: payload.userSide,
    actors: Object.fromEntries(
      payload.actors.map((actor) => [actor.actorId, actor]),
    ),
    facts: Object.fromEntries(
      payload.initialFacts.map((fact) => [
        fact.factId,
        { ...fact, sourceEventId: null, lastEventId: START_EVENT_ID },
      ]),
    ),
    evidence: Object.fromEntries(
      payload.initialEvidence.map((evidence) => [
        evidence.evidenceId,
        {
          ...evidence,
          offeredBySide: null,
          rulingEventId: null,
          lastEventId: START_EVENT_ID,
        },
      ]),
    ),
    witnesses: Object.fromEntries(
      payload.witnessIds.map((witnessId) => [
        witnessId,
        {
          witnessId,
          status: "available",
          calledBySide: null,
          examinationKind: null,
          lastEventId: START_EVENT_ID,
        },
      ]),
    ),
    testimony: {},
    settlementOffers: {},
    objections: {},
    pendingResponses: {},
    transcriptTurns: {},
    activeWitnessId: null,
    activeQuestionId: null,
    activeInterruption: null,
    activeSettlementOfferId: null,
    restedSides: [],
    eventIds: [START_EVENT_ID],
    committedActionIds: [START_ACTION_ID],
    transcriptTurnIds: [],
    instructionIds: [],
    verdictId: null,
    debriefId: null,
    failure: null,
  });
}

function createV3Harness(graph = createThreeWitnessCaseGraphV1Fixture()) {
  const events: TrialEventV3[] = [];
  let state: TrialState | null = null;
  let ordinal = 0;

  function nextIdentity(label: string) {
    ordinal += 1;
    return {
      actionId: `action_migration_${ordinal}_${label.toLowerCase()}`,
      requestedAt: new Date(
        Date.parse(STARTED_AT) + ordinal * 1_000,
      ).toISOString(),
    };
  }

  function start(): void {
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
  }

  function commit(
    type: TrialEventV3["type"],
    payload: unknown,
    actor: ActorRef = ACTORS.system,
  ): void {
    if (state === null) throw new Error("Start the v3 migration fixture first");
    const payloadRecord = payload as Record<string, unknown>;
    const action = TrialActionSchema.parse({
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
    const result = commitAction(state, action);
    state = result.state;
    events.push(result.event);
  }

  return {
    events,
    start,
    commit,
    get state(): TrialState {
      if (state === null) throw new Error("V3 migration fixture is not started");
      return state;
    },
  };
}

function downgradeV3StreamToV2(
  events: readonly TrialEventV3[],
  graph = createThreeWitnessCaseGraphV1Fixture(),
): TrialEventV2[] {
  const policySnapshot = createTrialPolicySnapshotV1({
    graph,
    actorBindings: actorBindings(),
  });
  return events.map((event) => {
    let payload: unknown;
    switch (event.type) {
      case "START_TRIAL":
        payload = { ...frozenV1StartPayload(graph), policySnapshot };
        break;
      case "END_EXAMINATION":
        payload = {
          witnessId: event.payload.witnessId,
          examinationKind: event.payload.examinationKind,
        };
        break;
      case "ASK_QUESTION":
        payload = {
          questionId: event.payload.questionId,
          witnessId: event.payload.witnessId,
          examinationKind: event.payload.examinationKind,
          text: event.payload.text,
          turnId: event.payload.turnId,
        };
        break;
      case "REVEAL_HIDDEN_FACT":
        payload = { factId: event.payload.factId };
        break;
      case "PROPOSE_SETTLEMENT":
      case "COUNTER_SETTLEMENT":
        payload = {
          offerId: event.payload.offerId,
          parentOfferId: event.payload.parentOfferId,
          terms: event.payload.terms,
          expiresAtSequence: event.payload.expiresAtSequence,
        };
        break;
      case "UPDATE_OPPOSING_STRATEGY":
        throw new Error("V3-only strategy events cannot be downgraded");
      default:
        payload = event.payload;
    }
    return TrialEventV2Schema.parse({
      ...event,
      schemaVersion: "trial-event.v2",
      payload,
    });
  });
}

function v2RevealFixture(): {
  graph: ReturnType<typeof createThreeWitnessCaseGraphV1Fixture>;
  events: TrialEventV2[];
  revealEventId: string;
} {
  const graph = createThreeWitnessCaseGraphV1Fixture();
  const harness = createV3Harness(graph);
  harness.start();
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
  harness.commit(
    "CALL_WITNESS",
    { witnessId: "witness_maya_ortiz", calledBySide: "user" },
    ACTORS.userCounsel,
  );
  harness.commit(
    "SWEAR_WITNESS",
    { witnessId: "witness_maya_ortiz" },
    ACTORS.judge,
  );
  harness.commit(
    "ASK_QUESTION",
    {
      questionId: "question_migration_maya",
      witnessId: "witness_maya_ortiz",
      examinationKind: "direct",
      text: "What does the revision history show?",
      turnId: "turn_migration_question",
      presentedEvidenceIds: ["evidence_revision_history"],
    },
    ACTORS.userCounsel,
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId: "response_migration_maya",
      actorId: ACTORS.maya.actorId,
      purpose: "answer_question",
    },
  );
  harness.commit(
    "ANSWER_QUESTION",
    {
      responseId: "response_migration_maya",
      questionId: "question_migration_maya",
      witnessId: "witness_maya_ortiz",
      testimonyId: "testimony_migration_foundation",
      turnId: "turn_migration_answer",
      text: "The final memorandum was revised after the complaint.",
      factIds: ["fact_rationale_revised"],
      evidenceIds: ["evidence_revision_history"],
    },
    ACTORS.maya,
  );
  harness.commit(
    "END_EXAMINATION",
    {
      witnessId: "witness_maya_ortiz",
      examinationKind: "direct",
      disposition: "completed",
    },
    ACTORS.userCounsel,
  );
  harness.commit(
    "OFFER_EVIDENCE",
    {
      evidenceId: "evidence_revision_history",
      offeredBySide: "user",
      foundationTestimonyIds: ["testimony_migration_foundation"],
    },
    ACTORS.userCounsel,
  );
  harness.commit(
    "RULE_ON_EVIDENCE",
    {
      evidenceId: "evidence_revision_history",
      ruling: "admitted",
      reason: "Maya authenticated the revision and access history.",
    },
    ACTORS.judge,
  );
  harness.commit(
    "REVEAL_HIDDEN_FACT",
    {
      factId: "fact_manager_accessed_complaint",
      basis: {
        kind: "evidence",
        evidenceId: "evidence_revision_history",
      },
    },
    ACTORS.judge,
  );
  const revealEvent = harness.events.at(-1);
  if (!revealEvent || revealEvent.type !== "REVEAL_HIDDEN_FACT") {
    throw new Error("Missing reveal fixture event");
  }
  return {
    graph,
    events: downgradeV3StreamToV2(harness.events, graph),
    revealEventId: revealEvent.eventId,
  };
}

function v2SettlementFixture(): {
  graph: ReturnType<typeof createThreeWitnessCaseGraphV1Fixture>;
  events: TrialEventV2[];
  proposalEventId: string;
  counterEventId: string;
} {
  const graph = createThreeWitnessCaseGraphV1Fixture();
  const harness = createV3Harness(graph);
  harness.start();
  const expiry = () =>
    harness.state.lastSequence +
    1 +
    harness.state.policySnapshot.settlement.expiresAfterEventCount;
  harness.commit(
    "PROPOSE_SETTLEMENT",
    {
      offerId: "offer_migration_initial",
      parentOfferId: null,
      proposedByPartyId: "party_rina_shah",
      recipientPartyIds: ["party_redwood_signal"],
      terms: {
        amount: 100_000,
        currency: "USD",
        nonMonetaryTerms: ["Neutral reference"],
        summary: "Initial migration fixture offer",
      },
      expiresAtSequence: expiry(),
    },
    ACTORS.userCounsel,
  );
  const proposal = harness.events.at(-1);
  harness.commit(
    "COUNTER_SETTLEMENT",
    {
      offerId: "offer_migration_counter",
      parentOfferId: "offer_migration_initial",
      proposedByPartyId: "party_redwood_signal",
      recipientPartyIds: ["party_rina_shah"],
      terms: {
        amount: 65_000,
        currency: "USD",
        nonMonetaryTerms: ["Neutral reference"],
        summary: "Migration fixture counteroffer",
      },
      expiresAtSequence: expiry(),
    },
    ACTORS.opposingCounsel,
  );
  const counter = harness.events.at(-1);
  if (
    !proposal ||
    proposal.type !== "PROPOSE_SETTLEMENT" ||
    !counter ||
    counter.type !== "COUNTER_SETTLEMENT"
  ) {
    throw new Error("Missing settlement fixture events");
  }
  return {
    graph,
    events: downgradeV3StreamToV2(harness.events, graph),
    proposalEventId: proposal.eventId,
    counterEventId: counter.eventId,
  };
}

describe("trial engine v1 to v2 migrations", () => {
  it("keeps frozen v1 START action, event, and state envelopes parseable", () => {
    expect(TrialActionV1Schema.parse(frozenV1StartAction()).schemaVersion).toBe(
      "trial-action.v1",
    );
    expect(TrialEventV1Schema.parse(frozenV1EventStream()[0]).schemaVersion).toBe(
      "trial-event.v1",
    );
    expect(TrialStateV1Schema.parse(frozenV1State()).schemaVersion).toBe(
      "trial-state.v1",
    );
  });

  it("requires a policy snapshot on every v2 START and state boundary", () => {
    const v1Action = frozenV1StartAction();
    const v1Event = frozenV1EventStream()[0];
    const v1State = frozenV1State();

    expect(
      TrialActionV2Schema.safeParse({
        ...v1Action,
        schemaVersion: "trial-action.v2",
      }).success,
    ).toBe(false);
    expect(
      TrialEventV2Schema.safeParse({
        ...v1Event,
        schemaVersion: "trial-event.v2",
      }).success,
    ).toBe(false);
    expect(
      TrialStateV2Schema.safeParse({
        ...v1State,
        schemaVersion: "trial-state.v2",
      }).success,
    ).toBe(false);
  });

  it("migrates the same v1 stream twice to byte-identical v2 events and state", () => {
    const input = frozenV1EventStream();
    const context = migrationContext();
    const before = JSON.stringify(input);

    const firstEvents = migrateTrialEventStreamV1ToV2(input, context);
    const secondEvents = migrateTrialEventStreamV1ToV2(input, context);
    const firstState = migrateAndReduceTrialV1(input, context);
    const secondState = migrateAndReduceTrialV1(input, context);

    expect(JSON.stringify(firstEvents)).toBe(JSON.stringify(secondEvents));
    expect(JSON.stringify(firstState)).toBe(JSON.stringify(secondState));
    expect(firstState).toMatchObject({
      schemaVersion: "trial-state.v2",
      version: 2,
      lastSequence: 2,
      phase: "opening",
      policySnapshot: {
        schemaVersion: "trial-policy-snapshot.v1",
        caseId: context.graph.caseId,
        caseVersion: context.graph.version,
      },
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("migrates a directly persisted v1 projection without mutating its JSON", () => {
    const input = frozenV1State();
    const before = JSON.stringify(input);

    const migrated = migrateTrialStateV1ToV2(input, migrationContext());

    expect(migrated).toMatchObject({
      schemaVersion: "trial-state.v2",
      trialId: input.trialId,
      version: input.version,
      eventIds: input.eventIds,
      policySnapshot: {
        schemaVersion: "trial-policy-snapshot.v1",
        caseId: input.caseId,
        caseVersion: input.caseVersion,
      },
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    {
      label: "graph version",
      expected: "TRIAL_V1_MIGRATION_MISMATCH:case_identity",
      mutate: (events: TrialEventV1[], context: TrialV1MigrationContext) => {
        (context.graph as unknown as { version: number }).version = 2;
      },
    },
    {
      label: "graph hash",
      expected: "TRIAL_V1_MIGRATION_MISMATCH:case_identity",
      mutate: (events: TrialEventV1[], context: TrialV1MigrationContext) => {
        context.graph.compilerMetadata.sourceContentHash =
          "0000000000000000000000000000000000000000000000000000000000000000";
      },
    },
    {
      label: "actor bindings",
      expected: "UNKNOWN_PARTY",
      mutate: (events: TrialEventV1[], context: TrialV1MigrationContext) => {
        const binding = context.actorBindings.find(
          (candidate) => candidate.actor.role === "user_counsel",
        );
        if (!binding) throw new Error("Missing user counsel binding fixture");
        binding.representedPartyIds = ["party_not_in_pinned_graph"];
      },
    },
    {
      label: "actor roster",
      expected: "TRIAL_V1_MIGRATION_MISMATCH:actor_roster",
      mutate: (events: TrialEventV1[]) => {
        const start = events[0];
        if (start.type !== "START_TRIAL") throw new Error("Missing START_TRIAL fixture");
        start.payload.actors = start.payload.actors.filter(
          (actor) => actor.actorId !== ACTORS.jury.actorId,
        );
      },
    },
    {
      label: "witness set",
      expected: "TRIAL_V1_MIGRATION_MISMATCH:witness_ids",
      mutate: (events: TrialEventV1[]) => {
        const start = events[0];
        if (start.type !== "START_TRIAL") throw new Error("Missing START_TRIAL fixture");
        start.payload.witnessIds = start.payload.witnessIds.slice(1);
      },
    },
    {
      label: "fact set",
      expected: "TRIAL_V1_MIGRATION_MISMATCH:fact_ids",
      mutate: (events: TrialEventV1[]) => {
        const start = events[0];
        if (start.type !== "START_TRIAL") throw new Error("Missing START_TRIAL fixture");
        start.payload.initialFacts = start.payload.initialFacts.slice(1);
      },
    },
    {
      label: "evidence set",
      expected: "TRIAL_V1_MIGRATION_MISMATCH:evidence_ids",
      mutate: (events: TrialEventV1[]) => {
        const start = events[0];
        if (start.type !== "START_TRIAL") throw new Error("Missing START_TRIAL fixture");
        start.payload.initialEvidence = start.payload.initialEvidence.slice(1);
      },
    },
  ])("fails closed on a mismatched $label", ({ expected, mutate }) => {
    const events = frozenV1EventStream();
    const context = migrationContext();
    mutate(events, context);

    expect(() => migrateTrialEventStreamV1ToV2(events, context)).toThrow(
      expected,
    );
  });

  it("fails closed when a direct v1 projection contains an unpinned fact", () => {
    const state = frozenV1State();
    state.facts.fact_not_in_pinned_graph = {
      ...Object.values(state.facts)[0],
      factId: "fact_not_in_pinned_graph",
    };

    expect(() => migrateTrialStateV1ToV2(state, migrationContext())).toThrow(
      "TRIAL_V1_MIGRATION_MISMATCH:fact_ids",
    );
  });
});

describe("trial engine v2 to v3 migrations", () => {
  it("composes v1 through frozen v2 into deterministic, non-mutating v3 output", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const contextV1 = migrationContext(graph);
    const contextV3 = v3MigrationContext(graph);
    const v1Events = frozenV1EventStream();
    const v2Events = migrateTrialEventStreamV1ToV2(v1Events, contextV1);
    const beforeV1 = JSON.stringify(v1Events);
    const beforeV2 = JSON.stringify(v2Events);

    const first = migrateTrialEventStreamV2ToV3(v2Events, contextV3);
    const second = migrateTrialEventStreamV2ToV3(v2Events, contextV3);
    const composed = migrateTrialEventStreamV1ToV3(v1Events, contextV3);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(composed));
    expect(JSON.stringify(v1Events)).toBe(beforeV1);
    expect(JSON.stringify(v2Events)).toBe(beforeV2);
    expect(first[0]).toMatchObject({
      schemaVersion: "trial-event.v3",
      type: "START_TRIAL",
      payload: {
        policySnapshot: {
          schemaVersion: "trial-policy-snapshot.v2",
          caseId: graph.caseId,
        },
      },
    });

    const stateFromV2 = migrateAndReduceTrialV2ToV3(v2Events, contextV3);
    const stateFromV1 = migrateAndReduceTrialV1ToV3(v1Events, contextV3);
    expect(JSON.stringify(stateFromV2)).toBe(JSON.stringify(stateFromV1));
    expect(stateFromV2).toMatchObject({
      schemaVersion: "trial-state.v3",
      version: 2,
      phase: "opening",
      policySnapshot: { schemaVersion: "trial-policy-snapshot.v2" },
      appearances: {},
      questions: {},
      strikeMotions: {},
      opposingStrategy: null,
    });
  });

  it("keeps every v3-only field outside the frozen v2 contracts", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const v2Events = migrateTrialEventStreamV1ToV2(
      frozenV1EventStream(),
      migrationContext(graph),
    );
    const v3Start = migrateTrialEventStreamV2ToV3(
      v2Events,
      v3MigrationContext(graph),
    )[0];
    const v2Start = v2Events[0];
    if (v2Start.type !== "START_TRIAL" || v3Start.type !== "START_TRIAL") {
      throw new Error("Missing versioned START fixtures");
    }
    expect(
      TrialEventV2Schema.safeParse({
        ...v2Start,
        payload: {
          ...v2Start.payload,
          policySnapshot: v3Start.payload.policySnapshot,
        },
      }).success,
    ).toBe(false);

    const revealFixture = v2RevealFixture();
    const endEvent = revealFixture.events.find(
      (event) => event.type === "END_EXAMINATION",
    );
    const revealEvent = revealFixture.events.find(
      (event) => event.type === "REVEAL_HIDDEN_FACT",
    );
    if (
      !endEvent ||
      endEvent.type !== "END_EXAMINATION" ||
      !revealEvent ||
      revealEvent.type !== "REVEAL_HIDDEN_FACT"
    ) {
      throw new Error("Missing frozen v2 payload fixtures");
    }
    expect(
      TrialEventV2Schema.safeParse({
        ...endEvent,
        payload: { ...endEvent.payload, disposition: "completed" },
      }).success,
    ).toBe(false);
    expect(
      TrialEventV2Schema.safeParse({
        ...revealEvent,
        payload: {
          ...revealEvent.payload,
          basis: {
            kind: "evidence",
            evidenceId: "evidence_revision_history",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      TrialEventV2Schema.safeParse({
        ...v2Events[1],
        type: "UPDATE_OPPOSING_STRATEGY",
        payload: {
          strategyId: "strategy_not_in_v2",
          ownerActorId: ACTORS.opposingCounsel.actorId,
          revision: 1,
          objectives: ["Keep strategy in v3"],
          witnessPriorityIds: [],
          evidencePriorityIds: [],
          settlementPosture: "avoid",
          privateNotes: [],
        },
      }).success,
    ).toBe(false);

    const v2State = migrateTrialStateV1ToV2(
      frozenV1State(),
      migrationContext(graph),
    );
    expect(
      TrialStateV2Schema.safeParse({ ...v2State, appearances: {} }).success,
    ).toBe(false);
  });

  it("migrates only pristine v2 projections directly and requires events otherwise", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const v2State = migrateTrialStateV1ToV2(
      frozenV1State(),
      migrationContext(graph),
    );
    const context = v3MigrationContext(graph);
    const before = JSON.stringify(v2State);

    const first = migrateTrialStateV2ToV3(v2State, context);
    const second = migrateTrialStateV2ToV3(v2State, context);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(v2State)).toBe(before);
    expect(TrialStateV3Schema.parse(first)).toMatchObject({
      schemaVersion: "trial-state.v3",
      policySnapshot: { schemaVersion: "trial-policy-snapshot.v2" },
      activeAppearanceId: null,
      appearances: {},
      questions: {},
    });
    expect(
      Object.values(first.evidence).every(
        (evidence) => evidence.foundationTestimonyIds.length === 0,
      ),
    ).toBe(true);
    expect(
      Object.values(first.witnesses).every(
        (witness) =>
          witness.callCount === 0 && witness.appearanceIds.length === 0,
      ),
    ).toBe(true);

    expect(() =>
      migrateTrialStateV2ToV3(
        { ...v2State, phase: "opening" },
        context,
      ),
    ).toThrow("TRIAL_V2_STATE_REQUIRES_EVENT_MIGRATION");
  });

  it("authenticates private enrichment against exact immutable CaseGraph JSON", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const events = migrateTrialEventStreamV1ToV2(
      frozenV1EventStream(),
      migrationContext(graph),
    );
    expect(() =>
      migrateTrialEventStreamV2ToV3(events, {
        ...v3MigrationContext(graph),
        expectedCaseGraphJson: JSON.stringify({
          ...graph,
          title: "Different durable content",
        }),
      }),
    ).toThrow("CASE_GRAPH_CONTENT_MISMATCH");
  });

  it("requires and verifies admitted related evidence for legacy hidden-fact reveals", () => {
    const { graph, events, revealEventId } = v2RevealFixture();
    const before = JSON.stringify(events);

    expect(() =>
      migrateTrialEventStreamV2ToV3(events, v3MigrationContext(graph)),
    ).toThrow("TRIAL_V2_REVEAL_REQUIRES_EVIDENCE_BASIS");
    expect(() =>
      migrateTrialEventStreamV2ToV3(
        events,
        v3MigrationContext(graph, actorBindings(), {
          revealEvidenceByEventId: {
            [revealEventId]: "evidence_complaint_email",
          },
        }),
      ),
    ).toThrow("TRIAL_V2_REVEAL_EVIDENCE_NOT_ADMITTED");

    const context = v3MigrationContext(graph, actorBindings(), {
      revealEvidenceByEventId: {
        [revealEventId]: "evidence_revision_history",
      },
    });
    const migrated = migrateTrialEventStreamV2ToV3(events, context);
    const migratedEnd = migrated.find(
      (event) => event.type === "END_EXAMINATION",
    );
    const migratedReveal = migrated.find(
      (event) => event.eventId === revealEventId,
    );
    expect(migratedEnd).toMatchObject({
      type: "END_EXAMINATION",
      payload: { disposition: "completed" },
    });
    expect(migratedReveal).toMatchObject({
      type: "REVEAL_HIDDEN_FACT",
      payload: {
        factId: "fact_manager_accessed_complaint",
        basis: {
          kind: "evidence",
          evidenceId: "evidence_revision_history",
        },
      },
      citations: {
        factIds: expect.arrayContaining(["fact_manager_accessed_complaint"]),
        evidenceIds: expect.arrayContaining(["evidence_revision_history"]),
      },
    });
    expect(
      migrateAndReduceTrialV2ToV3(events, context).facts
        .fact_manager_accessed_complaint,
    ).toMatchObject({ status: "proposed", visibility: "public" });
    expect(JSON.stringify(events)).toBe(before);
  });

  it("derives unambiguous settlement parties and validates explicit overrides", () => {
    const {
      graph,
      events,
      proposalEventId,
      counterEventId,
    } = v2SettlementFixture();
    const migrated = migrateTrialEventStreamV2ToV3(
      events,
      v3MigrationContext(graph),
    );
    expect(migrated.find((event) => event.eventId === proposalEventId)).toMatchObject({
      type: "PROPOSE_SETTLEMENT",
      payload: {
        proposedByPartyId: "party_rina_shah",
        recipientPartyIds: ["party_redwood_signal"],
      },
    });
    expect(migrated.find((event) => event.eventId === counterEventId)).toMatchObject({
      type: "COUNTER_SETTLEMENT",
      payload: {
        proposedByPartyId: "party_redwood_signal",
        recipientPartyIds: ["party_rina_shah"],
      },
    });

    expect(() =>
      migrateTrialEventStreamV2ToV3(
        events,
        v3MigrationContext(graph, actorBindings(), {
          settlementPartiesByEventId: {
            [proposalEventId]: {
              proposedByPartyId: "party_rina_shah",
              recipientPartyIds: ["party_rina_shah"],
            },
          },
        }),
      ),
    ).toThrow("TRIAL_V2_SETTLEMENT_INVALID_RECIPIENT");
  });

  it("rejects incomplete, interleaved, and future-version streams", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const context = v3MigrationContext(graph);
    const v2Events = migrateTrialEventStreamV1ToV2(
      frozenV1EventStream(),
      migrationContext(graph),
    );
    expect(() => migrateTrialEventStreamV2ToV3([], context)).toThrow(
      "TRIAL_V2_MIGRATION_EMPTY_STREAM",
    );
    expect(() =>
      migrateTrialEventStreamV2ToV3(v2Events.slice(1), context),
    ).toThrow("TRIAL_V2_MIGRATION_REQUIRES_START_EVENT");
    expect(() =>
      migrateTrialEventStreamV2ToV3(
        [
          v2Events[0],
          { ...v2Events[1], schemaVersion: "trial-event.v99" },
        ],
        context,
      ),
    ).toThrow();
    expect(TrialEventV3Schema.safeParse(v2Events[0]).success).toBe(false);
  });
});
