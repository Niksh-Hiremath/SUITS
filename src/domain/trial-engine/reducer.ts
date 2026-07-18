import {
  TRIAL_STATE_SCHEMA_VERSION,
  TrialEventSchema,
  TrialStateSchema,
  type ActorRef,
  type CitationSet,
  type TrialEvent,
  type TrialState,
} from "./schemas";

function mapById<T>(items: readonly T[], getId: (item: T) => string, label: string): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of items) {
    const id = getId(item);
    if (result[id]) throw new Error(`DUPLICATE_ENTITY_ID: Duplicate ${label} ${id}`);
    result[id] = item;
  }
  return result;
}

function finalize(state: TrialState, event: TrialEvent): TrialState {
  return TrialStateSchema.parse({
    ...state,
    version: event.stateVersion,
    lastSequence: event.sequence,
    updatedAt: event.occurredAt,
    eventIds: [...state.eventIds, event.eventId],
    committedActionIds: [...state.committedActionIds, event.actionId],
  });
}

function transcriptTurn(
  event: TrialEvent,
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

export function initializeTrialFromEvent(eventInput: unknown): TrialState {
  const event = TrialEventSchema.parse(eventInput);
  if (event.type !== "START_TRIAL") throw new Error("TRIAL_NOT_STARTED: First event must be START_TRIAL");
  if (event.sequence !== 1 || event.stateVersion !== 1) {
    throw new Error("INVALID_EVENT_ORDER: START_TRIAL must have sequence and stateVersion 1");
  }

  const actors = mapById(event.payload.actors, (actor) => actor.actorId, "actor");
  const initialFacts = event.payload.initialFacts.map((fact) => ({
    ...fact,
    sourceEventId: null,
    lastEventId: event.eventId,
  }));
  const facts = mapById(initialFacts, (fact) => fact.factId, "fact");
  const initialEvidence = event.payload.initialEvidence.map((evidence) => ({
    ...evidence,
    offeredBySide: null,
    rulingEventId: null,
    lastEventId: event.eventId,
  }));
  const evidence = mapById(initialEvidence, (item) => item.evidenceId, "evidence");
  const witnesses = mapById(
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

  return TrialStateSchema.parse({
    schemaVersion: TRIAL_STATE_SCHEMA_VERSION,
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

export function applyTrialEvent(stateInput: TrialState, eventInput: unknown): TrialState {
  const state = TrialStateSchema.parse(stateInput);
  const event = TrialEventSchema.parse(eventInput);
  if (event.type === "START_TRIAL") throw new Error("TRIAL_ALREADY_STARTED: START_TRIAL cannot be replayed into existing state");
  if (event.trialId !== state.trialId) throw new Error("TRIAL_ID_MISMATCH: Event belongs to another trial");
  if (state.eventIds.includes(event.eventId)) throw new Error(`DUPLICATE_EVENT_ID: ${event.eventId}`);
  if (state.committedActionIds.includes(event.actionId)) throw new Error(`DUPLICATE_ACTION_ID: ${event.actionId}`);
  if (event.sequence !== state.lastSequence + 1) throw new Error("INVALID_EVENT_ORDER: Event sequence is not contiguous");
  if (event.stateVersion !== state.version + 1) throw new Error("STALE_STATE_VERSION: Event stateVersion is not contiguous");

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
          [event.payload.witnessId]: { ...witness, status: "sworn", lastEventId: event.eventId },
        },
      };
      break;
    }
    case "ASK_QUESTION": {
      const witness = state.witnesses[event.payload.witnessId];
      const turn = transcriptTurn(event, event.payload.turnId, event.payload.text, event.actor, event.citations, null);
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
      const turn = transcriptTurn(
        event,
        event.payload.turnId,
        event.payload.text,
        event.actor,
        event.citations,
        event.payload.testimonyId,
      );
      const response = state.pendingResponses[event.payload.responseId];
      next = {
        ...state,
        activeQuestionId: null,
        testimony: { ...state.testimony, [testimony.testimonyId]: testimony },
        transcriptTurns: { ...state.transcriptTurns, [turn.turnId]: turn },
        transcriptTurnIds: [...state.transcriptTurnIds, turn.turnId],
        pendingResponses: {
          ...state.pendingResponses,
          [response.responseId]: { ...response, status: "committed", lastEventId: event.eventId },
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
          [event.payload.witnessId]: { ...witness, status: "sworn", examinationKind: null, lastEventId: event.eventId },
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
          [event.payload.witnessId]: { ...witness, status: "released", examinationKind: null, lastEventId: event.eventId },
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
      next = { ...state, objections: { ...state.objections, [objection.objectionId]: objection } };
      break;
    }
    case "RULE_ON_OBJECTION": {
      const objection = state.objections[event.payload.objectionId];
      next = {
        ...state,
        objections: {
          ...state.objections,
          [objection.objectionId]: {
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
      const turn = transcriptTurn(event, event.payload.turnId, event.payload.text, event.actor, event.citations, null);
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
        testimony[testimonyId] = { ...entry, status: "stricken", lastEventId: event.eventId };
        const turn = transcriptTurns[entry.turnId];
        transcriptTurns[entry.turnId] = { ...turn, status: "stricken" };
      }
      const facts = { ...state.facts };
      for (const factId of event.payload.factIds) {
        const fact = facts[factId];
        if (fact) facts[factId] = { ...fact, status: "stricken", lastEventId: event.eventId };
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
          [evidence.evidenceId]: {
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
          [evidence.evidenceId]: {
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
          [evidence.evidenceId]: { ...evidence, status: "withdrawn", lastEventId: event.eventId },
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
          [fact.factId]: { ...fact, status: "proposed", visibility: "public", lastEventId: event.eventId },
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
      const status = event.type === "VERIFY_ASSERTION"
        ? "verified"
        : event.type === "DISPUTE_ASSERTION"
          ? "disputed"
          : event.payload.ruling;
      next = {
        ...state,
        facts: { ...state.facts, [fact.factId]: { ...fact, status, lastEventId: event.eventId } },
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
      next = { ...state, pendingResponses: { ...state.pendingResponses, [response.responseId]: response } };
      break;
    }
    case "CANCEL_RESPONSE":
    case "COMPLETE_RESPONSE": {
      const response = state.pendingResponses[event.payload.responseId];
      next = {
        ...state,
        pendingResponses: {
          ...state.pendingResponses,
          [response.responseId]: {
            ...response,
            status: event.type === "CANCEL_RESPONSE" ? "cancelled" : "committed",
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "BEGIN_INTERRUPTION": {
      const response = state.pendingResponses[event.payload.interruptedResponseId];
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
          [response.responseId]: { ...response, interruptId: interruption.interruptId, lastEventId: event.eventId },
        },
      };
      break;
    }
    case "RESOLVE_INTERRUPTION": {
      const interruption = state.activeInterruption;
      if (!interruption) throw new Error("UNKNOWN_INTERRUPTION");
      const response = state.pendingResponses[interruption.interruptedResponseId];
      next = {
        ...state,
        activeInterruption: {
          ...interruption,
          status: event.payload.outcome === "cancel" ? "cancelled" : "resolved",
          lastEventId: event.eventId,
        },
        pendingResponses: event.payload.outcome === "cancel"
          ? {
              ...state.pendingResponses,
              [response.responseId]: { ...response, status: "cancelled", lastEventId: event.eventId },
            }
          : state.pendingResponses,
      };
      break;
    }
    case "RESUME_INTERRUPTED_SPEECH": {
      const interruption = state.activeInterruption;
      if (!interruption) throw new Error("UNKNOWN_INTERRUPTION");
      const response = state.pendingResponses[event.payload.interruptedResponseId];
      next = {
        ...state,
        activeInterruption: { ...interruption, status: "resumed", lastEventId: event.eventId },
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
      next = { ...state, phaseBeforeRecess: state.phase, phase: "recess" };
      break;
    case "RESUME_TRIAL":
      next = {
        ...state,
        status: "active",
        phase: state.phase === "recess" ? (state.phaseBeforeRecess ?? "case_in_chief") : state.phase,
        phaseBeforeRecess: state.phase === "recess" ? null : state.phaseBeforeRecess,
      };
      break;
    case "PROPOSE_SETTLEMENT":
    case "COUNTER_SETTLEMENT": {
      const offer = {
        offerId: event.payload.offerId,
        parentOfferId: event.payload.parentOfferId,
        proposedBySide: event.actor.side,
        visibleToSides: ["user", "opposing"] as const,
        terms: event.payload.terms,
        status: "open" as const,
        expiresAtSequence: event.payload.expiresAtSequence,
        sourceEventId: event.eventId,
        lastEventId: event.eventId,
      };
      const offers = { ...state.settlementOffers };
      if (event.type === "COUNTER_SETTLEMENT" && offer.parentOfferId) {
        const parent = offers[offer.parentOfferId];
        offers[parent.offerId] = { ...parent, status: "countered", lastEventId: event.eventId };
      }
      offers[offer.offerId] = { ...offer, visibleToSides: [...offer.visibleToSides] };
      next = { ...state, settlementOffers: offers, activeSettlementOfferId: offer.offerId };
      break;
    }
    case "ACCEPT_SETTLEMENT":
    case "REJECT_SETTLEMENT":
    case "WITHDRAW_SETTLEMENT":
    case "EXPIRE_SETTLEMENT": {
      const offer = state.settlementOffers[event.payload.offerId];
      const status = event.type === "ACCEPT_SETTLEMENT"
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
          [offer.offerId]: { ...offer, status, lastEventId: event.eventId },
        },
      };
      break;
    }
    case "REST_CASE":
      next = { ...state, restedSides: [...state.restedSides, event.payload.side] };
      break;
    case "GIVE_CLOSING": {
      const turn = transcriptTurn(event, event.payload.turnId, event.payload.text, event.actor, event.payload.citations, null);
      next = {
        ...state,
        transcriptTurns: { ...state.transcriptTurns, [turn.turnId]: turn },
        transcriptTurnIds: [...state.transcriptTurnIds, turn.turnId],
      };
      break;
    }
    case "INSTRUCT_JURY":
      next = { ...state, instructionIds: [...state.instructionIds, ...event.payload.instructionIds] };
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
      next = { ...state, status: "failed", failure: { ...event.payload, sourceEventId: event.eventId } };
      break;
    case "RECOVER_STEP":
      next = { ...state, status: "active", failure: null };
      break;
  }

  return finalize(next, event);
}
