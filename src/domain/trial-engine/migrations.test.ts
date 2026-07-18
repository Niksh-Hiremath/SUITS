import { describe, expect, it } from "vitest";

import {
  createThreeWitnessCaseGraphV1Fixture,
} from "../case-graph";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import {
  TrialActionV1Schema,
  TrialActionV2Schema,
  TrialEventV1Schema,
  TrialEventV2Schema,
  TrialStateV1Schema,
  TrialStateV2Schema,
  migrateAndReduceTrialV1,
  migrateTrialEventStreamV1ToV2,
  migrateTrialStateV1ToV2,
  type ActorRef,
  type TrialEventV1,
  type TrialStateV1,
  type TrialV1MigrationContext,
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
