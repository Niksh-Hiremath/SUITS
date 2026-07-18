import {
  collectCaseGraphProvenanceIds,
  computeCaseGraphContentHash,
  type CaseGraphV1,
} from "../case-graph";
import {
  createTrialPolicySnapshotV1,
  migrateTrialPolicySnapshotV1ToV2,
  type TrialPolicyActorBindingInput,
  type TrialPolicySnapshotV1,
} from "../trial-policy";
import { eventIdForAction, reduceTrial } from "./engine";
import {
  TRIAL_EVENT_SCHEMA_VERSION_V2,
  TRIAL_EVENT_SCHEMA_VERSION_V3,
  TRIAL_STATE_SCHEMA_VERSION_V2,
  TRIAL_STATE_SCHEMA_VERSION_V3,
  TrialEventV1Schema,
  TrialEventV2Schema,
  TrialEventV3Schema,
  TrialStateV1Schema,
  TrialStateV2Schema,
  TrialStateV3Schema,
  type ActorRef,
  type CitationSet,
  type TrialEventV1,
  type TrialEventV2,
  type TrialEventV3,
  type TrialStateV1,
  type TrialStateV2,
  type TrialStateV3,
} from "./schemas";

export type TrialV1MigrationContext = Readonly<{
  graph: CaseGraphV1;
  actorBindings: readonly TrialPolicyActorBindingInput[];
}>;

export type TrialV2SettlementPartyMigration = Readonly<{
  proposedByPartyId: string;
  recipientPartyIds: readonly string[];
}>;

/**
 * Historical v2 rows did not persist evidence reveal provenance or exact
 * settlement parties. These maps are keyed by immutable event ID so operators
 * must resolve ambiguous history explicitly instead of relying on order or
 * mutable projection state.
 */
export type TrialV2ToV3MigrationContext = TrialV1MigrationContext &
  Readonly<{
    /** Exact JSON from the immutable durable CaseGraph version row. */
    expectedCaseGraphJson: string;
    revealEvidenceByEventId?: Readonly<Record<string, string>>;
    settlementPartiesByEventId?: Readonly<
      Record<string, TrialV2SettlementPartyMigration>
    >;
  }>;

export type TrialV3MigrationContext = TrialV2ToV3MigrationContext;

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
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
): TrialPolicySnapshotV1 {
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

  return createTrialPolicySnapshotV1({
    graph,
    actorBindings: context.actorBindings,
  });
}

function assertContextMatchesState(
  state: TrialStateV1 | TrialStateV2,
  context: TrialV1MigrationContext,
): TrialPolicySnapshotV1 {
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
  return createTrialPolicySnapshotV1({
    graph: context.graph,
    actorBindings: context.actorBindings,
  });
}

/**
 * Explicitly upgrades an immutable v1 event stream. Historical input objects
 * are never mutated; every upgraded row is parsed through the frozen v2 schema.
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
    const payload =
      event.type === "START_TRIAL"
        ? { ...event.payload, policySnapshot }
        : event.payload;
    return TrialEventV2Schema.parse({
      ...event,
      schemaVersion: TRIAL_EVENT_SCHEMA_VERSION_V2,
      payload,
    });
  });
}

function legacyMapById<T>(
  items: readonly T[],
  getId: (item: T) => string,
  label: string,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of items) {
    const id = getId(item);
    if (result[id]) {
      throw new Error(`DUPLICATE_ENTITY_ID: Duplicate ${label} ${id}`);
    }
    result[id] = item;
  }
  return result;
}

function legacyFinalize(
  state: TrialStateV2,
  event: TrialEventV2,
): TrialStateV2 {
  return TrialStateV2Schema.parse({
    ...state,
    version: event.stateVersion,
    lastSequence: event.sequence,
    updatedAt: event.occurredAt,
    eventIds: [...state.eventIds, event.eventId],
    committedActionIds: [...state.committedActionIds, event.actionId],
  });
}

function legacyTranscriptTurn(
  event: TrialEventV2,
  turnId: string,
  text: string,
  actor: ActorRef,
  citations: CitationSet,
  testimonyId: string | null,
) {
  return {
    turnId,
    actor,
    text,
    testimonyId,
    citations,
    status: "active" as const,
    sourceEventId: event.eventId,
  };
}

function initializeLegacyTrialV2(eventInput: unknown): TrialStateV2 {
  const event = TrialEventV2Schema.parse(eventInput);
  if (event.type !== "START_TRIAL") {
    throw new Error("TRIAL_NOT_STARTED: First event must be START_TRIAL");
  }
  if (event.sequence !== 1 || event.stateVersion !== 1) {
    throw new Error(
      "INVALID_EVENT_ORDER: START_TRIAL must have sequence and stateVersion 1",
    );
  }

  const actors = legacyMapById(
    event.payload.actors,
    (actor) => actor.actorId,
    "actor",
  );
  const facts = legacyMapById(
    event.payload.initialFacts.map((fact) => ({
      ...fact,
      sourceEventId: null,
      lastEventId: event.eventId,
    })),
    (fact) => fact.factId,
    "fact",
  );
  const evidence = legacyMapById(
    event.payload.initialEvidence.map((item) => ({
      ...item,
      offeredBySide: null,
      rulingEventId: null,
      lastEventId: event.eventId,
    })),
    (item) => item.evidenceId,
    "evidence",
  );
  const witnesses = legacyMapById(
    event.payload.witnessIds.map((witnessId) => ({
      witnessId,
      status: "available" as const,
      calledBySide: null,
      examinationKind: null,
      lastEventId: event.eventId,
    })),
    (witness) => witness.witnessId,
    "witness",
  );

  return TrialStateV2Schema.parse({
    schemaVersion: TRIAL_STATE_SCHEMA_VERSION_V2,
    trialId: event.trialId,
    caseId: event.payload.caseId,
    caseVersion: event.payload.caseVersion,
    caseGraphHash: event.payload.caseGraphHash,
    version: 1,
    lastSequence: 1,
    phase: "pretrial",
    phaseBeforeRecess: null,
    status: "active",
    startedAt: event.occurredAt,
    updatedAt: event.occurredAt,
    userSide: event.payload.userSide,
    policySnapshot: event.payload.policySnapshot,
    actors,
    facts,
    evidence,
    witnesses,
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
    eventIds: [event.eventId],
    committedActionIds: [event.actionId],
    transcriptTurnIds: [],
    instructionIds: [],
    verdictId: null,
    debriefId: null,
    failure: null,
  });
}

function applyLegacyTrialEventV2(
  stateInput: TrialStateV2,
  eventInput: unknown,
): TrialStateV2 {
  const state = TrialStateV2Schema.parse(stateInput);
  const event = TrialEventV2Schema.parse(eventInput);
  if (event.type === "START_TRIAL") {
    throw new Error(
      "TRIAL_ALREADY_STARTED: START_TRIAL cannot be replayed into existing state",
    );
  }
  if (event.trialId !== state.trialId) {
    throw new Error("TRIAL_ID_MISMATCH: Event belongs to another trial");
  }
  if (state.eventIds.includes(event.eventId)) {
    throw new Error(`DUPLICATE_EVENT_ID: ${event.eventId}`);
  }
  if (state.committedActionIds.includes(event.actionId)) {
    throw new Error(`DUPLICATE_ACTION_ID: ${event.actionId}`);
  }
  if (event.sequence !== state.lastSequence + 1) {
    throw new Error("INVALID_EVENT_ORDER: Event sequence is not contiguous");
  }
  if (event.stateVersion !== state.version + 1) {
    throw new Error(
      "STALE_STATE_VERSION: Event stateVersion is not contiguous",
    );
  }

  let next = state;
  switch (event.type) {
    case "BEGIN_PHASE":
      next = {
        ...state,
        phase: event.payload.phase,
        status: event.payload.phase === "complete" ? "complete" : state.status,
      };
      break;
    case "CALL_WITNESS":
    case "RECALL_WITNESS": {
      const witness = state.witnesses[event.payload.witnessId];
      next = {
        ...state,
        activeWitnessId: event.payload.witnessId,
        witnesses: {
          ...state.witnesses,
          [event.payload.witnessId]: {
            ...witness,
            status: "called",
            calledBySide: event.payload.calledBySide,
            examinationKind: null,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "SWEAR_WITNESS": {
      const witness = state.witnesses[event.payload.witnessId];
      next = {
        ...state,
        witnesses: {
          ...state.witnesses,
          [event.payload.witnessId]: {
            ...witness,
            status: "sworn",
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "ASK_QUESTION": {
      const witness = state.witnesses[event.payload.witnessId];
      const turn = legacyTranscriptTurn(
        event,
        event.payload.turnId,
        event.payload.text,
        event.actor,
        event.citations,
        null,
      );
      next = {
        ...state,
        activeQuestionId: event.payload.questionId,
        witnesses: {
          ...state.witnesses,
          [event.payload.witnessId]: {
            ...witness,
            status: "testifying",
            examinationKind: event.payload.examinationKind,
            lastEventId: event.eventId,
          },
        },
        transcriptTurns: { ...state.transcriptTurns, [turn.turnId]: turn },
        transcriptTurnIds: [...state.transcriptTurnIds, turn.turnId],
      };
      break;
    }
    case "ANSWER_QUESTION": {
      const testimony = {
        testimonyId: event.payload.testimonyId,
        turnId: event.payload.turnId,
        witnessId: event.payload.witnessId,
        questionId: event.payload.questionId,
        text: event.payload.text,
        status: "active" as const,
        factIds: [...event.payload.factIds],
        evidenceIds: [...event.payload.evidenceIds],
        sourceEventId: event.eventId,
        lastEventId: event.eventId,
      };
      const turn = legacyTranscriptTurn(
        event,
        event.payload.turnId,
        event.payload.text,
        event.actor,
        event.citations,
        event.payload.testimonyId,
      );
      const response = state.pendingResponses[event.payload.responseId];
      if (!response) {
        throw new Error(`UNKNOWN_RESPONSE: ${event.payload.responseId}`);
      }
      next = {
        ...state,
        activeQuestionId: null,
        testimony: { ...state.testimony, [testimony.testimonyId]: testimony },
        transcriptTurns: { ...state.transcriptTurns, [turn.turnId]: turn },
        transcriptTurnIds: [...state.transcriptTurnIds, turn.turnId],
        pendingResponses: {
          ...state.pendingResponses,
          [response.responseId]: {
            ...response,
            status: "committed",
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "END_EXAMINATION": {
      const witness = state.witnesses[event.payload.witnessId];
      next = {
        ...state,
        activeQuestionId: null,
        witnesses: {
          ...state.witnesses,
          [event.payload.witnessId]: {
            ...witness,
            status: "sworn",
            examinationKind: null,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "RELEASE_WITNESS": {
      const witness = state.witnesses[event.payload.witnessId];
      next = {
        ...state,
        activeWitnessId: null,
        activeQuestionId: null,
        witnesses: {
          ...state.witnesses,
          [event.payload.witnessId]: {
            ...witness,
            status: "released",
            examinationKind: null,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "OBJECT": {
      const objection = {
        objectionId: event.payload.objectionId,
        questionId: event.payload.questionId,
        objectorActorId: event.actor.actorId,
        ground: event.payload.ground,
        status: "pending" as const,
        remedy: null,
        rulingReason: null,
        sourceEventId: event.eventId,
        rulingEventId: null,
      };
      next = {
        ...state,
        objections: { ...state.objections, [objection.objectionId]: objection },
      };
      break;
    }
    case "RULE_ON_OBJECTION": {
      const objection = state.objections[event.payload.objectionId];
      next = {
        ...state,
        objections: {
          ...state.objections,
          [event.payload.objectionId]: {
            ...objection,
            status: event.payload.ruling,
            remedy: event.payload.remedy,
            rulingReason: event.payload.reason,
            rulingEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "REPHRASE_QUESTION": {
      const turn = legacyTranscriptTurn(
        event,
        event.payload.turnId,
        event.payload.text,
        event.actor,
        event.citations,
        null,
      );
      next = {
        ...state,
        activeQuestionId: event.payload.questionId,
        transcriptTurns: { ...state.transcriptTurns, [turn.turnId]: turn },
        transcriptTurnIds: [...state.transcriptTurnIds, turn.turnId],
      };
      break;
    }
    case "MOVE_TO_STRIKE":
      break;
    case "STRIKE_TESTIMONY": {
      const testimony = { ...state.testimony };
      const transcriptTurns = { ...state.transcriptTurns };
      for (const testimonyId of event.payload.testimonyIds) {
        const entry = testimony[testimonyId];
        if (!entry) throw new Error(`UNKNOWN_TESTIMONY: ${testimonyId}`);
        testimony[testimonyId] = {
          ...entry,
          status: "stricken",
          lastEventId: event.eventId,
        };
        const turn = transcriptTurns[entry.turnId];
        if (!turn) throw new Error(`UNKNOWN_TRANSCRIPT_TURN: ${entry.turnId}`);
        transcriptTurns[entry.turnId] = { ...turn, status: "stricken" };
      }
      const facts = { ...state.facts };
      for (const factId of event.payload.factIds) {
        const fact = facts[factId];
        if (fact) {
          facts[factId] = {
            ...fact,
            status: "stricken",
            lastEventId: event.eventId,
          };
        }
      }
      next = { ...state, testimony, transcriptTurns, facts };
      break;
    }
    case "OFFER_EVIDENCE": {
      const evidence = state.evidence[event.payload.evidenceId];
      next = {
        ...state,
        evidence: {
          ...state.evidence,
          [event.payload.evidenceId]: {
            ...evidence,
            status: "offered",
            offeredBySide: event.payload.offeredBySide,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "RULE_ON_EVIDENCE": {
      const evidence = state.evidence[event.payload.evidenceId];
      next = {
        ...state,
        evidence: {
          ...state.evidence,
          [event.payload.evidenceId]: {
            ...evidence,
            status: event.payload.ruling,
            rulingEventId: event.eventId,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "WITHDRAW_EVIDENCE": {
      const evidence = state.evidence[event.payload.evidenceId];
      next = {
        ...state,
        evidence: {
          ...state.evidence,
          [event.payload.evidenceId]: {
            ...evidence,
            status: "withdrawn",
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "REVEAL_HIDDEN_FACT": {
      const fact = state.facts[event.payload.factId];
      next = {
        ...state,
        facts: {
          ...state.facts,
          [event.payload.factId]: {
            ...fact,
            status: "proposed",
            visibility: "public",
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "PROPOSE_ASSERTION": {
      const fact = {
        factId: event.payload.factId,
        proposition: event.payload.proposition,
        status: "proposed" as const,
        visibility: event.payload.visibility,
        provenanceIds: [...event.payload.provenanceIds],
        sourceEventId: event.eventId,
        lastEventId: event.eventId,
      };
      next = { ...state, facts: { ...state.facts, [fact.factId]: fact } };
      break;
    }
    case "VERIFY_ASSERTION":
    case "DISPUTE_ASSERTION":
    case "RULE_ON_ASSERTION": {
      const fact = state.facts[event.payload.factId];
      const status =
        event.type === "VERIFY_ASSERTION"
          ? "verified"
          : event.type === "DISPUTE_ASSERTION"
            ? "disputed"
            : event.payload.ruling;
      next = {
        ...state,
        facts: {
          ...state.facts,
          [event.payload.factId]: {
            ...fact,
            status,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "REQUEST_RESPONSE": {
      const response = {
        responseId: event.payload.responseId,
        actorId: event.payload.actorId,
        requestEventId: event.eventId,
        expectedStateVersion: event.stateVersion,
        status: "pending" as const,
        interruptId: null,
        lastEventId: event.eventId,
      };
      next = {
        ...state,
        pendingResponses: {
          ...state.pendingResponses,
          [response.responseId]: response,
        },
      };
      break;
    }
    case "CANCEL_RESPONSE":
    case "COMPLETE_RESPONSE": {
      const response = state.pendingResponses[event.payload.responseId];
      if (!response) {
        throw new Error(`UNKNOWN_RESPONSE: ${event.payload.responseId}`);
      }
      next = {
        ...state,
        pendingResponses: {
          ...state.pendingResponses,
          [response.responseId]: {
            ...response,
            status:
              event.type === "CANCEL_RESPONSE" ? "cancelled" : "committed",
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "BEGIN_INTERRUPTION": {
      const response =
        state.pendingResponses[event.payload.interruptedResponseId];
      if (!response) {
        throw new Error(
          `UNKNOWN_RESPONSE: ${event.payload.interruptedResponseId}`,
        );
      }
      const interruption = {
        interruptId: event.payload.interruptId,
        interruptedResponseId: event.payload.interruptedResponseId,
        objectionId: event.payload.objectionId,
        status: "active" as const,
        sourceEventId: event.eventId,
        lastEventId: event.eventId,
      };
      next = {
        ...state,
        activeInterruption: interruption,
        pendingResponses: {
          ...state.pendingResponses,
          [response.responseId]: {
            ...response,
            interruptId: interruption.interruptId,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "RESOLVE_INTERRUPTION": {
      const interruption = state.activeInterruption;
      if (!interruption) throw new Error("UNKNOWN_INTERRUPTION");
      const response =
        state.pendingResponses[interruption.interruptedResponseId];
      if (!response) {
        throw new Error(`UNKNOWN_RESPONSE: ${interruption.interruptedResponseId}`);
      }
      next = {
        ...state,
        activeInterruption: {
          ...interruption,
          status:
            event.payload.outcome === "cancel" ? "cancelled" : "resolved",
          lastEventId: event.eventId,
        },
        pendingResponses:
          event.payload.outcome === "cancel"
            ? {
                ...state.pendingResponses,
                [response.responseId]: {
                  ...response,
                  status: "cancelled",
                  lastEventId: event.eventId,
                },
              }
            : state.pendingResponses,
      };
      break;
    }
    case "RESUME_INTERRUPTED_SPEECH": {
      const interruption = state.activeInterruption;
      if (!interruption) throw new Error("UNKNOWN_INTERRUPTION");
      const response =
        state.pendingResponses[event.payload.interruptedResponseId];
      if (!response) {
        throw new Error(
          `UNKNOWN_RESPONSE: ${event.payload.interruptedResponseId}`,
        );
      }
      next = {
        ...state,
        activeInterruption: {
          ...interruption,
          status: "resumed",
          lastEventId: event.eventId,
        },
        pendingResponses: {
          ...state.pendingResponses,
          [response.responseId]: {
            ...response,
            status: "streaming",
            expectedStateVersion: event.stateVersion,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "PAUSE_TRIAL":
      next = { ...state, status: "paused" };
      break;
    case "REQUEST_RECESS":
      next = {
        ...state,
        phaseBeforeRecess: state.phase,
        phase: "recess",
      };
      break;
    case "RESUME_TRIAL":
      next = {
        ...state,
        status: "active",
        phase:
          state.phase === "recess"
            ? (state.phaseBeforeRecess ?? "case_in_chief")
            : state.phase,
        phaseBeforeRecess:
          state.phase === "recess" ? null : state.phaseBeforeRecess,
      };
      break;
    case "PROPOSE_SETTLEMENT":
    case "COUNTER_SETTLEMENT": {
      const offer = {
        offerId: event.payload.offerId,
        parentOfferId: event.payload.parentOfferId,
        proposedBySide: event.actor.side,
        visibleToSides: ["user", "opposing"] as Array<"user" | "opposing">,
        terms: event.payload.terms,
        status: "open" as const,
        expiresAtSequence: event.payload.expiresAtSequence,
        sourceEventId: event.eventId,
        lastEventId: event.eventId,
      };
      const offers = { ...state.settlementOffers };
      if (event.type === "COUNTER_SETTLEMENT" && offer.parentOfferId) {
        const parent = offers[offer.parentOfferId];
        if (!parent) {
          throw new Error(`UNKNOWN_SETTLEMENT_OFFER: ${offer.parentOfferId}`);
        }
        offers[parent.offerId] = {
          ...parent,
          status: "countered",
          lastEventId: event.eventId,
        };
      }
      offers[offer.offerId] = offer;
      next = {
        ...state,
        settlementOffers: offers,
        activeSettlementOfferId: offer.offerId,
      };
      break;
    }
    case "ACCEPT_SETTLEMENT":
    case "REJECT_SETTLEMENT":
    case "WITHDRAW_SETTLEMENT":
    case "EXPIRE_SETTLEMENT": {
      const offer = state.settlementOffers[event.payload.offerId];
      if (!offer) {
        throw new Error(`UNKNOWN_SETTLEMENT_OFFER: ${event.payload.offerId}`);
      }
      const status =
        event.type === "ACCEPT_SETTLEMENT"
          ? "accepted"
          : event.type === "REJECT_SETTLEMENT"
            ? "rejected"
            : event.type === "WITHDRAW_SETTLEMENT"
              ? "withdrawn"
              : "expired";
      next = {
        ...state,
        status: event.type === "ACCEPT_SETTLEMENT" ? "settled" : state.status,
        activeSettlementOfferId: null,
        settlementOffers: {
          ...state.settlementOffers,
          [offer.offerId]: {
            ...offer,
            status,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "REST_CASE":
      next = {
        ...state,
        restedSides: [...state.restedSides, event.payload.side],
      };
      break;
    case "GIVE_CLOSING": {
      const turn = legacyTranscriptTurn(
        event,
        event.payload.turnId,
        event.payload.text,
        event.actor,
        event.payload.citations,
        null,
      );
      next = {
        ...state,
        transcriptTurns: { ...state.transcriptTurns, [turn.turnId]: turn },
        transcriptTurnIds: [...state.transcriptTurnIds, turn.turnId],
      };
      break;
    }
    case "INSTRUCT_JURY":
      next = {
        ...state,
        instructionIds: [
          ...state.instructionIds,
          ...event.payload.instructionIds,
        ],
      };
      break;
    case "DELIBERATE":
      break;
    case "RENDER_VERDICT":
      next = { ...state, verdictId: event.payload.verdictId };
      break;
    case "GENERATE_DEBRIEF":
      next = { ...state, debriefId: event.payload.debriefId };
      break;
    case "FAIL_STEP":
      next = {
        ...state,
        status: "failed",
        failure: { ...event.payload, sourceEventId: event.eventId },
      };
      break;
    case "RECOVER_STEP":
      next = { ...state, status: "active", failure: null };
      break;
  }

  return legacyFinalize(next, event);
}

function reduceLegacyTrialV2(eventInputs: readonly unknown[]): TrialStateV2 {
  if (eventInputs.length === 0) {
    throw new Error("TRIAL_NOT_STARTED: Event stream is empty");
  }
  let state: TrialStateV2 | null = null;
  for (const eventInput of eventInputs) {
    state =
      state === null
        ? initializeLegacyTrialV2(eventInput)
        : applyLegacyTrialEventV2(state, eventInput);
  }
  if (state === null) throw new Error("TRIAL_NOT_STARTED");
  return state;
}

export function migrateAndReduceTrialV1ToV2(
  eventInputs: readonly unknown[],
  context: TrialV1MigrationContext,
): TrialStateV2 {
  return reduceLegacyTrialV2(
    migrateTrialEventStreamV1ToV2(eventInputs, context),
  );
}

/** @deprecated Prefer the destination-specific migrateAndReduceTrialV1ToV2. */
export const migrateAndReduceTrialV1 = migrateAndReduceTrialV1ToV2;

/**
 * Upgrades a trusted v1 projection after matching it to the pinned graph and
 * explicit actor bindings. This remains the exact v1 -> frozen-v2 operation.
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

function migrationError(code: string, detail?: string): Error {
  return new Error(detail ? `${code}:${detail}` : code);
}

function migratePolicyForV3(
  policySnapshot: TrialPolicySnapshotV1,
  caseGraphHash: string,
  context: TrialV2ToV3MigrationContext,
) {
  return migrateTrialPolicySnapshotV1ToV2(policySnapshot, {
    graph: context.graph,
    actorBindings: context.actorBindings,
    expectedCaseGraphHash: caseGraphHash,
    expectedCaseGraphJson: context.expectedCaseGraphJson,
  });
}

function assertV2StartContext(
  event: Extract<TrialEventV2, { type: "START_TRIAL" }>,
  context: TrialV1MigrationContext,
): void {
  const canonicalV1 = assertContextMatchesStart(event.payload, context);
  if (JSON.stringify(event.payload.policySnapshot) !== JSON.stringify(canonicalV1)) {
    throw migrationError("TRIAL_V2_MIGRATION_MISMATCH", "policy_snapshot");
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return sorted([...new Set(values)]);
}

function citationsWithRevealBasis(
  citations: CitationSet,
  factId: string,
  evidenceId: string,
): CitationSet {
  return {
    ...citations,
    factIds: uniqueSorted([...citations.factIds, factId]),
    evidenceIds: uniqueSorted([...citations.evidenceIds, evidenceId]),
  };
}

function settlementPartyMigration(
  event: Extract<
    TrialEventV2,
    { type: "PROPOSE_SETTLEMENT" | "COUNTER_SETTLEMENT" }
  >,
  state: TrialStateV3,
  context: TrialV2ToV3MigrationContext,
): TrialV2SettlementPartyMigration {
  const participantPartyIds = new Set(
    state.policySnapshot.settlement.participantPartyIds,
  );
  const actorBinding = state.policySnapshot.mappings.actors.find(
    (binding) => binding.actorId === event.actor.actorId,
  );
  if (!actorBinding) {
    throw migrationError(
      "TRIAL_V2_SETTLEMENT_ACTOR_NOT_MAPPED",
      event.eventId,
    );
  }
  const representedParticipants = actorBinding.representedPartyIds.filter(
    (partyId) => participantPartyIds.has(partyId),
  );
  const explicit = context.settlementPartiesByEventId?.[event.eventId];
  const proposedByPartyId = explicit?.proposedByPartyId ??
    (representedParticipants.length === 1
      ? representedParticipants[0]
      : undefined);
  if (!proposedByPartyId) {
    throw migrationError(
      "TRIAL_V2_SETTLEMENT_REQUIRES_EXPLICIT_PARTIES",
      event.eventId,
    );
  }
  if (!representedParticipants.includes(proposedByPartyId)) {
    throw migrationError(
      "TRIAL_V2_SETTLEMENT_PROPOSER_NOT_REPRESENTED",
      event.eventId,
    );
  }

  const proposerParty = state.policySnapshot.mappings.parties.find(
    (party) => party.partyId === proposedByPartyId,
  );
  if (!proposerParty) {
    throw migrationError(
      "TRIAL_V2_SETTLEMENT_PARTY_NOT_MAPPED",
      proposedByPartyId,
    );
  }

  let derivedRecipients: string[];
  if (event.type === "COUNTER_SETTLEMENT") {
    const parentOfferId = event.payload.parentOfferId;
    const parent = parentOfferId
      ? state.settlementOffers[parentOfferId]
      : undefined;
    if (!parent) {
      throw migrationError(
        "TRIAL_V2_SETTLEMENT_PARENT_NOT_FOUND",
        event.eventId,
      );
    }
    derivedRecipients = [parent.proposedByPartyId];
  } else {
    derivedRecipients = state.policySnapshot.settlement.participantPartyIds
      .filter((partyId) => partyId !== proposedByPartyId)
      .filter((partyId) => {
        const party = state.policySnapshot.mappings.parties.find(
          (candidate) => candidate.partyId === partyId,
        );
        return party?.side !== proposerParty.side;
      });
  }

  const recipientPartyIds = explicit
    ? uniqueSorted(explicit.recipientPartyIds)
    : derivedRecipients.length === 1
      ? derivedRecipients
      : [];
  if (recipientPartyIds.length === 0) {
    throw migrationError(
      "TRIAL_V2_SETTLEMENT_REQUIRES_EXPLICIT_PARTIES",
      event.eventId,
    );
  }
  if (
    explicit &&
    explicit.recipientPartyIds.length !== recipientPartyIds.length
  ) {
    throw migrationError(
      "TRIAL_V2_SETTLEMENT_DUPLICATE_RECIPIENT",
      event.eventId,
    );
  }
  for (const recipientPartyId of recipientPartyIds) {
    const recipient = state.policySnapshot.mappings.parties.find(
      (party) => party.partyId === recipientPartyId,
    );
    if (
      !recipient ||
      !participantPartyIds.has(recipientPartyId) ||
      recipientPartyId === proposedByPartyId ||
      recipient.side === proposerParty.side
    ) {
      throw migrationError(
        "TRIAL_V2_SETTLEMENT_INVALID_RECIPIENT",
        `${event.eventId}:${recipientPartyId}`,
      );
    }
  }
  if (
    event.type === "COUNTER_SETTLEMENT" &&
    !sameIds(recipientPartyIds, derivedRecipients)
  ) {
    throw migrationError(
      "TRIAL_V2_SETTLEMENT_COUNTER_RECIPIENT_MISMATCH",
      event.eventId,
    );
  }

  return { proposedByPartyId, recipientPartyIds };
}

function endExaminationDisposition(
  event: Extract<TrialEventV2, { type: "END_EXAMINATION" }>,
  state: TrialStateV3,
): "completed" | "waived" {
  const appearance = state.activeAppearanceId
    ? state.appearances[state.activeAppearanceId]
    : undefined;
  if (!appearance || appearance.witnessId !== event.payload.witnessId) {
    throw migrationError(
      "TRIAL_V2_END_EXAMINATION_REQUIRES_ACTIVE_APPEARANCE",
      event.eventId,
    );
  }
  const leg = appearance.legs[event.payload.examinationKind];
  const hasOpenQuestion = Object.values(state.questions).some(
    (question) =>
      question.appearanceId === appearance.appearanceId &&
      question.status === "open",
  );
  const hasOpenResponse = Object.values(state.pendingResponses).some(
    (response) =>
      response.appearanceId === appearance.appearanceId &&
      (response.status === "pending" || response.status === "streaming"),
  );
  if (
    hasOpenQuestion ||
    hasOpenResponse ||
    state.activeInterruption?.status === "active"
  ) {
    throw migrationError(
      "TRIAL_V2_END_EXAMINATION_OPEN_WORK",
      event.eventId,
    );
  }
  return leg.answeredQuestionCount > 0 ? "completed" : "waived";
}

function migrateV2EventPayload(
  event: TrialEventV2,
  state: TrialStateV3 | null,
  context: TrialV2ToV3MigrationContext,
): { payload: unknown; citations: CitationSet } {
  switch (event.type) {
    case "START_TRIAL": {
      assertV2StartContext(event, context);
      return {
        payload: {
          ...event.payload,
          caseGraphContentHash: computeCaseGraphContentHash(context.graph),
          juryInstructionIds: context.graph.juryInstructions.map(
            (instruction) => instruction.instructionId,
          ),
          caseProvenanceIds: collectCaseGraphProvenanceIds(context.graph),
          sourceSegmentIds: context.graph.sourceSegments.map(
            (segment) => segment.sourceSegmentId,
          ),
          policySnapshot: migratePolicyForV3(
            event.payload.policySnapshot,
            event.payload.caseGraphHash,
            context,
          ),
        },
        citations: event.citations,
      };
    }
    case "ASK_QUESTION":
      return {
        payload: {
          ...event.payload,
          presentedEvidenceIds: uniqueSorted(event.citations.evidenceIds),
        },
        citations: event.citations,
      };
    case "END_EXAMINATION":
      if (!state) {
        throw migrationError("TRIAL_V2_MIGRATION_REQUIRES_START_EVENT");
      }
      return {
        payload: {
          ...event.payload,
          disposition: endExaminationDisposition(event, state),
        },
        citations: event.citations,
      };
    case "REVEAL_HIDDEN_FACT": {
      if (!state) {
        throw migrationError("TRIAL_V2_MIGRATION_REQUIRES_START_EVENT");
      }
      const evidenceId = context.revealEvidenceByEventId?.[event.eventId];
      if (!evidenceId) {
        throw migrationError(
          "TRIAL_V2_REVEAL_REQUIRES_EVIDENCE_BASIS",
          event.eventId,
        );
      }
      const evidence = state.evidence[evidenceId];
      if (!evidence || evidence.status !== "admitted") {
        throw migrationError(
          "TRIAL_V2_REVEAL_EVIDENCE_NOT_ADMITTED",
          `${event.eventId}:${evidenceId}`,
        );
      }
      const permission = state.policySnapshot.evidencePermissions.find(
        (candidate) => candidate.evidenceId === evidenceId,
      );
      if (!permission?.relatedFactIds.includes(event.payload.factId)) {
        throw migrationError(
          "TRIAL_V2_REVEAL_EVIDENCE_UNRELATED",
          `${event.eventId}:${evidenceId}:${event.payload.factId}`,
        );
      }
      return {
        payload: {
          factId: event.payload.factId,
          basis: { kind: "evidence", evidenceId },
        },
        citations: citationsWithRevealBasis(
          event.citations,
          event.payload.factId,
          evidenceId,
        ),
      };
    }
    case "PROPOSE_SETTLEMENT":
    case "COUNTER_SETTLEMENT": {
      if (!state) {
        throw migrationError("TRIAL_V2_MIGRATION_REQUIRES_START_EVENT");
      }
      return {
        payload: {
          ...event.payload,
          ...settlementPartyMigration(event, state, context),
        },
        citations: event.citations,
      };
    }
    default:
      return { payload: event.payload, citations: event.citations };
  }
}

/**
 * Upgrades an entire frozen-v2 history to v3 and validates the resulting
 * stream after every event. Histories that need unavailable provenance or
 * cannot satisfy current invariants are rejected rather than guessed.
 */
export function migrateTrialEventStreamV2ToV3(
  eventInputs: readonly unknown[],
  context: TrialV2ToV3MigrationContext,
): TrialEventV3[] {
  if (eventInputs.length === 0) {
    throw migrationError("TRIAL_V2_MIGRATION_EMPTY_STREAM");
  }
  const events = eventInputs.map((input) => TrialEventV2Schema.parse(input));
  if (events[0].type !== "START_TRIAL") {
    throw migrationError("TRIAL_V2_MIGRATION_REQUIRES_START_EVENT");
  }

  const canonicalEventIds = new Map(
    events.map((event) => [event.eventId, eventIdForAction(event.actionId)]),
  );
  if (new Set(canonicalEventIds.values()).size !== canonicalEventIds.size) {
    throw migrationError("TRIAL_V2_MIGRATION_DUPLICATE_CANONICAL_EVENT_ID");
  }

  const migrated: TrialEventV3[] = [];
  let state: TrialStateV3 | null = null;
  for (const event of events) {
    const { payload, citations } = migrateV2EventPayload(
      event,
      state,
      context,
    );
    const canonicalCitations = {
      ...citations,
      eventIds: citations.eventIds.map((eventId) => {
        const canonicalEventId = canonicalEventIds.get(eventId);
        if (!canonicalEventId) {
          throw migrationError(
            "TRIAL_V2_MIGRATION_UNKNOWN_CITATION_EVENT",
            `${event.eventId}:${eventId}`,
          );
        }
        return canonicalEventId;
      }),
    };
    const canonicalPayload =
      event.type === "GIVE_CLOSING" || event.type === "RENDER_VERDICT"
        ? { ...payload as object, citations: canonicalCitations }
        : payload;
    const migratedEvent = TrialEventV3Schema.parse({
      ...event,
      schemaVersion: TRIAL_EVENT_SCHEMA_VERSION_V3,
      eventId: canonicalEventIds.get(event.eventId),
      causationId: migrated.at(-1)?.eventId ?? null,
      correlationId: event.trialId,
      citations: canonicalCitations,
      payload: canonicalPayload,
    });
    migrated.push(migratedEvent);
    try {
      state = TrialStateV3Schema.parse(reduceTrial(migrated));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw migrationError(
        "TRIAL_V2_EVENT_MIGRATION_INVALID",
        `${event.eventId}:${message}`,
      );
    }
  }
  return migrated;
}

export function migrateTrialEventStreamV1ToV3(
  eventInputs: readonly unknown[],
  context: TrialV3MigrationContext,
): TrialEventV3[] {
  return migrateTrialEventStreamV2ToV3(
    migrateTrialEventStreamV1ToV2(eventInputs, context),
    context,
  );
}

export function migrateAndReduceTrialV2ToV3(
  eventInputs: readonly unknown[],
  context: TrialV2ToV3MigrationContext,
): TrialStateV3 {
  return TrialStateV3Schema.parse(
    reduceTrial(migrateTrialEventStreamV2ToV3(eventInputs, context)),
  );
}

export function migrateAndReduceTrialV1ToV3(
  eventInputs: readonly unknown[],
  context: TrialV3MigrationContext,
): TrialStateV3 {
  return TrialStateV3Schema.parse(
    reduceTrial(migrateTrialEventStreamV1ToV3(eventInputs, context)),
  );
}

function isPristineV2State(state: TrialStateV2): boolean {
  if (
    state.version !== 1 ||
    state.lastSequence !== 1 ||
    state.phase !== "pretrial" ||
    state.phaseBeforeRecess !== null ||
    state.status !== "active" ||
    state.startedAt !== state.updatedAt ||
    state.eventIds.length !== 1 ||
    state.committedActionIds.length !== 1 ||
    state.activeWitnessId !== null ||
    state.activeQuestionId !== null ||
    state.activeInterruption !== null ||
    state.activeSettlementOfferId !== null ||
    state.restedSides.length !== 0 ||
    state.transcriptTurnIds.length !== 0 ||
    state.instructionIds.length !== 0 ||
    state.verdictId !== null ||
    state.debriefId !== null ||
    state.failure !== null ||
    Object.keys(state.testimony).length !== 0 ||
    Object.keys(state.settlementOffers).length !== 0 ||
    Object.keys(state.objections).length !== 0 ||
    Object.keys(state.pendingResponses).length !== 0 ||
    Object.keys(state.transcriptTurns).length !== 0
  ) {
    return false;
  }
  const startEventId = state.eventIds[0];
  return (
    Object.values(state.facts).every(
      (fact) =>
        fact.sourceEventId === null && fact.lastEventId === startEventId,
    ) &&
    Object.values(state.evidence).every(
      (evidence) =>
        evidence.offeredBySide === null &&
        evidence.rulingEventId === null &&
        evidence.lastEventId === startEventId,
    ) &&
    Object.values(state.witnesses).every(
      (witness) =>
        witness.status === "available" &&
        witness.calledBySide === null &&
        witness.examinationKind === null &&
        witness.lastEventId === startEventId,
    )
  );
}

/**
 * A coarse v2 projection cannot reconstruct examinations, evidence
 * foundations, strike motions, or exact negotiation parties. Only the
 * START-only projection is therefore safe to enrich directly.
 */
export function migrateTrialStateV2ToV3(
  stateInput: unknown,
  context: TrialV2ToV3MigrationContext,
): TrialStateV3 {
  const state = TrialStateV2Schema.parse(stateInput);
  assertContextMatchesState(state, context);
  if (!isPristineV2State(state)) {
    throw migrationError("TRIAL_V2_STATE_REQUIRES_EVENT_MIGRATION");
  }
  const policySnapshot = migratePolicyForV3(
    state.policySnapshot,
    state.caseGraphHash,
    context,
  );
  const evidence = Object.fromEntries(
    Object.entries(state.evidence).map(([evidenceId, item]) => [
      evidenceId,
      { ...item, foundationTestimonyIds: [] },
    ]),
  );
  const witnesses = Object.fromEntries(
    Object.entries(state.witnesses).map(([witnessId, witness]) => [
      witnessId,
      { ...witness, appearanceIds: [], callCount: 0 },
    ]),
  );
  return TrialStateV3Schema.parse({
    ...state,
    schemaVersion: TRIAL_STATE_SCHEMA_VERSION_V3,
    caseGraphContentHash: computeCaseGraphContentHash(context.graph),
    juryInstructionIds: context.graph.juryInstructions.map(
      (instruction) => instruction.instructionId,
    ),
    caseProvenanceIds: collectCaseGraphProvenanceIds(context.graph),
    sourceSegmentIds: context.graph.sourceSegments.map(
      (segment) => segment.sourceSegmentId,
    ),
    closingSides: [],
    deliberated: false,
    policySnapshot,
    evidence,
    witnesses,
    appearances: {},
    questions: {},
    strikeMotions: {},
    opposingStrategy: null,
    activeAppearanceId: null,
  });
}

export function migrateTrialStateV1ToV3(
  stateInput: unknown,
  context: TrialV3MigrationContext,
): TrialStateV3 {
  return migrateTrialStateV2ToV3(
    migrateTrialStateV1ToV2(stateInput, context),
    context,
  );
}
