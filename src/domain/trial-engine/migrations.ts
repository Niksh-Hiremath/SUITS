import type { CaseGraphV1 } from "../case-graph";
import {
  createTrialPolicySnapshot,
  type TrialPolicyActorBindingInput,
  type TrialPolicySnapshot,
} from "../trial-policy";
import { reduceTrial } from "./engine";
import {
  TRIAL_EVENT_SCHEMA_VERSION_V2,
  TRIAL_STATE_SCHEMA_VERSION_V2,
  TrialEventV1Schema,
  TrialEventV2Schema,
  TrialStateV1Schema,
  TrialStateV2Schema,
  type ActorRef,
  type TrialEventV1,
  type TrialEventV2,
  type TrialStateV1,
  type TrialStateV2,
} from "./schemas";

export type TrialV1MigrationContext = Readonly<{
  graph: CaseGraphV1;
  actorBindings: readonly TrialPolicyActorBindingInput[];
}>;

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertSameIds(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const sortedActual = sorted(actual);
  const sortedExpected = sorted(expected);
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `TRIAL_V1_MIGRATION_MISMATCH:${label}:${JSON.stringify(sortedActual)}:${JSON.stringify(sortedExpected)}`,
    );
  }
}

function actorKey(actor: ActorRef): string {
  return JSON.stringify([
    actor.actorId,
    actor.role,
    actor.side,
    actor.witnessId,
  ]);
}

function assertContextMatchesStart(
  start: Extract<TrialEventV1, { type: "START_TRIAL" }>["payload"],
  context: TrialV1MigrationContext,
): TrialPolicySnapshot {
  const { graph } = context;
  if (
    graph.caseId !== start.caseId ||
    graph.version !== start.caseVersion ||
    graph.compilerMetadata.sourceContentHash !== start.caseGraphHash
  ) {
    throw new Error("TRIAL_V1_MIGRATION_MISMATCH:case_identity");
  }

  const bindingActors = context.actorBindings.map((binding) => binding.actor);
  assertSameIds(
    start.actors.map(actorKey),
    bindingActors.map(actorKey),
    "actor_roster",
  );
  assertSameIds(
    start.witnessIds,
    graph.witnesses.map((witness) => witness.witnessId),
    "witness_ids",
  );
  assertSameIds(
    start.initialFacts.map((fact) => fact.factId),
    graph.facts.map((fact) => fact.factId),
    "fact_ids",
  );
  assertSameIds(
    start.initialEvidence.map((evidence) => evidence.evidenceId),
    graph.evidence.map((evidence) => evidence.evidenceId),
    "evidence_ids",
  );

  return createTrialPolicySnapshot({
    graph,
    actorBindings: context.actorBindings,
  });
}

function assertContextMatchesState(
  state: TrialStateV1,
  context: TrialV1MigrationContext,
): TrialPolicySnapshot {
  if (
    context.graph.caseId !== state.caseId ||
    context.graph.version !== state.caseVersion ||
    context.graph.compilerMetadata.sourceContentHash !== state.caseGraphHash
  ) {
    throw new Error("TRIAL_V1_MIGRATION_MISMATCH:case_identity");
  }
  assertSameIds(
    Object.values(state.actors).map(actorKey),
    context.actorBindings.map((binding) => actorKey(binding.actor)),
    "actor_roster",
  );
  assertSameIds(
    Object.keys(state.witnesses),
    context.graph.witnesses.map((witness) => witness.witnessId),
    "witness_ids",
  );
  assertSameIds(
    Object.keys(state.evidence),
    context.graph.evidence.map((evidence) => evidence.evidenceId),
    "evidence_ids",
  );
  assertSameIds(
    Object.values(state.facts)
      .filter((fact) => fact.sourceEventId === null)
      .map((fact) => fact.factId),
    context.graph.facts.map((fact) => fact.factId),
    "fact_ids",
  );
  return createTrialPolicySnapshot({
    graph: context.graph,
    actorBindings: context.actorBindings,
  });
}

/**
 * Explicitly upgrades an immutable v1 event stream. Historical input objects
 * are never mutated; every upgraded row is parsed through the strict v2 schema.
 */
export function migrateTrialEventStreamV1ToV2(
  eventInputs: readonly unknown[],
  context: TrialV1MigrationContext,
): TrialEventV2[] {
  if (eventInputs.length === 0) {
    throw new Error("TRIAL_V1_MIGRATION_EMPTY_STREAM");
  }
  const events = eventInputs.map((input) => TrialEventV1Schema.parse(input));
  const first = events[0];
  if (first.type !== "START_TRIAL") {
    throw new Error("TRIAL_V1_MIGRATION_REQUIRES_START_EVENT");
  }
  const policySnapshot = assertContextMatchesStart(first.payload, context);

  return events.map((event) => {
    const payload = event.type === "START_TRIAL"
      ? { ...event.payload, policySnapshot }
      : event.payload;
    return TrialEventV2Schema.parse({
      ...event,
      schemaVersion: TRIAL_EVENT_SCHEMA_VERSION_V2,
      payload,
    });
  });
}

export function migrateAndReduceTrialV1(
  eventInputs: readonly unknown[],
  context: TrialV1MigrationContext,
): TrialStateV2 {
  return reduceTrial(migrateTrialEventStreamV1ToV2(eventInputs, context));
}

/**
 * Upgrades a trusted v1 projection only after matching it to the pinned graph
 * and explicit actor bindings. Event-stream migration remains the audit source
 * of truth whenever the historical events are available.
 */
export function migrateTrialStateV1ToV2(
  stateInput: unknown,
  context: TrialV1MigrationContext,
): TrialStateV2 {
  const state = TrialStateV1Schema.parse(stateInput);
  const policySnapshot = assertContextMatchesState(state, context);
  return TrialStateV2Schema.parse({
    ...state,
    schemaVersion: TRIAL_STATE_SCHEMA_VERSION_V2,
    policySnapshot,
  });
}
