import {
  TRIAL_STATE_SCHEMA_VERSION,
  TrialEventSchema,
  TrialStateSchema,
  type ActorRef,
  type CitationSet,
  type ExaminationKind,
  type TrialEvent,
  type TrialEventByType,
  type TrialState,
  type WitnessAppearanceState,
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

function opposingSide(side: "user" | "opposing"): "user" | "opposing" {
  return side === "user" ? "opposing" : "user";
}

function partySideForPolicy(
  state: TrialState,
  partyId: string,
): "user" | "opposing" | "neutral" {
  const party = state.policySnapshot.mappings.parties.find(
    (binding) => binding.partyId === partyId,
  );
  if (!party) throw new Error(`UNKNOWN_SETTLEMENT_PARTY: ${partyId}`);
  return party.side;
}

function examinationLeg(
  kind: ExaminationKind,
  ownerSide: "user" | "opposing",
) {
  return {
    kind,
    ownerSide,
    status: "not_available" as const,
    questionIds: [],
    answeredQuestionCount: 0,
    startedEventId: null,
    endedEventId: null,
  };
}

function appearanceFromCallEvent(
  event: TrialEventByType<"CALL_WITNESS"> | TrialEventByType<"RECALL_WITNESS">,
  ordinal: number,
): WitnessAppearanceState {
  const callingSide = event.payload.calledBySide;
  return {
    appearanceId: `appearance:${event.actionId}`,
    witnessId: event.payload.witnessId,
    ordinal,
    invocation: event.type === "CALL_WITNESS" ? "call" : "recall",
    callingSide,
    stage: "awaiting_oath",
    legs: {
      direct: examinationLeg("direct", callingSide),
      cross: examinationLeg("cross", opposingSide(callingSide)),
      redirect: examinationLeg("redirect", callingSide),
      recross: examinationLeg("recross", opposingSide(callingSide)),
    },
    calledEventId: event.eventId,
    swornEventId: null,
    releasedEventId: null,
  };
}

function finishExaminationLeg(
  appearance: WitnessAppearanceState,
  kind: ExaminationKind,
  disposition: "completed" | "waived",
  eventId: string,
): WitnessAppearanceState {
  const legs = {
    ...appearance.legs,
    [kind]: {
      ...appearance.legs[kind],
      status: disposition,
      endedEventId: eventId,
    },
  };
  if (disposition === "waived" || kind === "recross") {
    return { ...appearance, stage: "ready_for_release", legs };
  }
  const nextKind: ExaminationKind = kind === "direct"
    ? "cross"
    : kind === "cross"
      ? "redirect"
      : "recross";
  return {
    ...appearance,
    stage: nextKind,
    legs: {
      ...legs,
      [nextKind]: {
        ...legs[nextKind],
        status: "available",
      },
    },
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
    foundationTestimonyIds: [],
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
      appearanceIds: [],
      callCount: 0,
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
    caseGraphContentHash: event.payload.caseGraphContentHash,
    juryInstructionIds: [...event.payload.juryInstructionIds],
    caseProvenanceIds: [...event.payload.caseProvenanceIds],
    sourceSegmentIds: [...event.payload.sourceSegmentIds],
    closingSides: [],
    deliberated: false,
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
    appearances: {},
    questions: {},
    strikeMotions: {},
    opposingStrategy: null,
    activeAppearanceId: null,
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
      const appearance = appearanceFromCallEvent(
        event,
        witness.callCount + 1,
      );
      next = {
        ...state,
        activeWitnessId: event.payload.witnessId,
        activeAppearanceId: appearance.appearanceId,
        appearances: {
          ...state.appearances,
          [appearance.appearanceId]: appearance,
        },
        witnesses: {
          ...state.witnesses,
          [event.payload.witnessId]: {
            ...witness,
            status: "called",
            calledBySide: event.payload.calledBySide,
            examinationKind: null,
            appearanceIds: [...witness.appearanceIds, appearance.appearanceId],
            callCount: witness.callCount + 1,
            lastEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "SWEAR_WITNESS": {
      const witness = state.witnesses[event.payload.witnessId];
      const appearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      if (!appearance) throw new Error("UNKNOWN_APPEARANCE");
      next = {
        ...state,
        appearances: {
          ...state.appearances,
          [appearance.appearanceId]: {
            ...appearance,
            stage: "direct",
            swornEventId: event.eventId,
            legs: {
              ...appearance.legs,
              direct: {
                ...appearance.legs.direct,
                status: "available",
              },
            },
          },
        },
        witnesses: {
          ...state.witnesses,
          [event.payload.witnessId]: { ...witness, status: "sworn", lastEventId: event.eventId },
        },
      };
      break;
    }
    case "ASK_QUESTION": {
      const witness = state.witnesses[event.payload.witnessId];
      const appearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      if (!appearance) throw new Error("UNKNOWN_APPEARANCE");
      const kind = event.payload.examinationKind;
      const leg = appearance.legs[kind];
      const turn = transcriptTurn(event, event.payload.turnId, event.payload.text, event.actor, event.citations, null);
      const question = {
        questionId: event.payload.questionId,
        appearanceId: appearance.appearanceId,
        witnessId: event.payload.witnessId,
        examinationKind: kind,
        askedByActorId: event.actor.actorId,
        askedBySide: event.actor.side as "user" | "opposing",
        questionTurnId: event.payload.turnId,
        presentedEvidenceIds: [...event.payload.presentedEvidenceIds],
        rephrasesQuestionId: null,
        status: "open" as const,
        responseIds: [],
        activeResponseId: null,
        testimonyId: null,
        lastEventId: event.eventId,
      };
      next = {
        ...state,
        activeQuestionId: event.payload.questionId,
        appearances: {
          ...state.appearances,
          [appearance.appearanceId]: {
            ...appearance,
            legs: {
              ...appearance.legs,
              [kind]: {
                ...leg,
                status: "in_progress",
                questionIds: [...leg.questionIds, question.questionId],
                startedEventId: leg.startedEventId ?? event.eventId,
              },
            },
          },
        },
        questions: { ...state.questions, [question.questionId]: question },
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
      const question = state.questions[event.payload.questionId];
      const appearance = state.appearances[question.appearanceId];
      const leg = appearance.legs[question.examinationKind];
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
      const facts = { ...state.facts };
      for (const factId of event.payload.factIds) {
        const fact = facts[factId];
        if (fact.status === "hidden") {
          facts[factId] = {
            ...fact,
            status: "proposed",
            visibility: "public",
            lastEventId: event.eventId,
          };
        }
      }
      next = {
        ...state,
        activeQuestionId: null,
        appearances: {
          ...state.appearances,
          [appearance.appearanceId]: {
            ...appearance,
            legs: {
              ...appearance.legs,
              [question.examinationKind]: {
                ...leg,
                answeredQuestionCount: leg.answeredQuestionCount + 1,
              },
            },
          },
        },
        questions: {
          ...state.questions,
          [question.questionId]: {
            ...question,
            status: "answered",
            activeResponseId: null,
            testimonyId: testimony.testimonyId,
            lastEventId: event.eventId,
          },
        },
        testimony: { ...state.testimony, [testimony.testimonyId]: testimony },
        facts,
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
      const appearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      if (!appearance) throw new Error("UNKNOWN_APPEARANCE");
      const finishedAppearance = finishExaminationLeg(
        appearance,
        event.payload.examinationKind,
        event.payload.disposition,
        event.eventId,
      );
      const speechTurn =
        event.payload.turnId !== undefined &&
        event.payload.text !== undefined &&
        event.payload.citations !== undefined
          ? transcriptTurn(
              event,
              event.payload.turnId,
              event.payload.text,
              event.actor,
              event.payload.citations,
              null,
            )
          : null;
      next = {
        ...state,
        activeQuestionId: null,
        appearances: {
          ...state.appearances,
          [appearance.appearanceId]: finishedAppearance,
        },
        witnesses: {
          ...state.witnesses,
          [event.payload.witnessId]: { ...witness, status: "sworn", examinationKind: null, lastEventId: event.eventId },
        },
        transcriptTurns:
          speechTurn === null
            ? state.transcriptTurns
            : {
                ...state.transcriptTurns,
                [speechTurn.turnId]: speechTurn,
              },
        transcriptTurnIds:
          speechTurn === null
            ? state.transcriptTurnIds
            : [...state.transcriptTurnIds, speechTurn.turnId],
      };
      break;
    }
    case "RELEASE_WITNESS": {
      const witness = state.witnesses[event.payload.witnessId];
      const appearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      if (!appearance) throw new Error("UNKNOWN_APPEARANCE");
      next = {
        ...state,
        activeWitnessId: null,
        activeAppearanceId: null,
        activeQuestionId: null,
        appearances: {
          ...state.appearances,
          [appearance.appearanceId]: {
            ...appearance,
            stage: "released",
            releasedEventId: event.eventId,
          },
        },
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
        interruptedResponseId: event.payload.interruptedResponseId,
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
      const question = state.questions[objection.questionId];
      next = {
        ...state,
        activeQuestionId:
          event.payload.ruling === "sustained"
            ? null
            : state.activeQuestionId,
        questions: question
          ? {
              ...state.questions,
              [question.questionId]: {
                ...question,
                status:
                  event.payload.ruling === "sustained"
                    ? "sustained"
                    : question.status,
                activeResponseId:
                  event.payload.ruling === "sustained"
                    ? null
                    : question.activeResponseId,
                lastEventId: event.eventId,
              },
            }
          : state.questions,
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
      const original = state.questions[event.payload.originalQuestionId];
      const appearance = state.appearances[original.appearanceId];
      const leg = appearance.legs[original.examinationKind];
      const turn = transcriptTurn(event, event.payload.turnId, event.payload.text, event.actor, event.citations, null);
      const question = {
        ...original,
        questionId: event.payload.questionId,
        askedByActorId: event.actor.actorId,
        questionTurnId: event.payload.turnId,
        rephrasesQuestionId: original.questionId,
        status: "open" as const,
        responseIds: [],
        activeResponseId: null,
        testimonyId: null,
        lastEventId: event.eventId,
      };
      next = {
        ...state,
        activeQuestionId: event.payload.questionId,
        appearances: {
          ...state.appearances,
          [appearance.appearanceId]: {
            ...appearance,
            legs: {
              ...appearance.legs,
              [original.examinationKind]: {
                ...leg,
                questionIds: [...leg.questionIds, question.questionId],
              },
            },
          },
        },
        questions: { ...state.questions, [question.questionId]: question },
        transcriptTurns: { ...state.transcriptTurns, [turn.turnId]: turn },
        transcriptTurnIds: [...state.transcriptTurnIds, turn.turnId],
      };
      break;
    }
    case "MOVE_TO_STRIKE": {
      const motion = {
        motionId: event.payload.motionId,
        movedByActorId: event.actor.actorId,
        testimonyIds: [...event.payload.testimonyIds],
        reason: event.payload.reason,
        status: "pending" as const,
        sourceEventId: event.eventId,
        rulingEventId: null,
      };
      next = {
        ...state,
        strikeMotions: {
          ...state.strikeMotions,
          [motion.motionId]: motion,
        },
      };
      break;
    }
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
        const hasActiveTestimonySupport = Object.values(testimony).some(
          (entry) => entry.status === "active" && entry.factIds.includes(factId),
        );
        const hasAdmittedEvidenceSupport = Object.values(state.evidence).some(
          (evidence) =>
            evidence.status === "admitted" &&
            state.policySnapshot.evidencePermissions.some(
              (rule) =>
                rule.evidenceId === evidence.evidenceId &&
                rule.relatedFactIds.includes(factId),
            ),
        );
        if (fact && !hasActiveTestimonySupport && !hasAdmittedEvidenceSupport) {
          facts[factId] = {
            ...fact,
            status: "stricken",
            lastEventId: event.eventId,
          };
        }
      }
      const motion = state.strikeMotions[event.payload.motionId];
      next = {
        ...state,
        testimony,
        transcriptTurns,
        facts,
        strikeMotions: {
          ...state.strikeMotions,
          [motion.motionId]: {
            ...motion,
            status: "granted",
            rulingEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "DENY_STRIKE_MOTION": {
      const motion = state.strikeMotions[event.payload.motionId];
      next = {
        ...state,
        strikeMotions: {
          ...state.strikeMotions,
          [motion.motionId]: {
            ...motion,
            status: "denied",
            rulingEventId: event.eventId,
          },
        },
      };
      break;
    }
    case "WITHDRAW_STRIKE_MOTION": {
      const motion = state.strikeMotions[event.payload.motionId];
      next = {
        ...state,
        strikeMotions: {
          ...state.strikeMotions,
          [motion.motionId]: {
            ...motion,
            status: "withdrawn",
            rulingEventId: event.eventId,
          },
        },
      };
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
            foundationTestimonyIds: [...event.payload.foundationTestimonyIds],
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
      const question = state.activeQuestionId
        ? state.questions[state.activeQuestionId]
        : undefined;
      const response = {
        responseId: event.payload.responseId,
        actorId: event.payload.actorId,
        requestEventId: event.eventId,
        expectedStateVersion: event.stateVersion,
        status: "pending" as const,
        interruptId: null,
        appearanceId: question?.appearanceId ?? null,
        questionId: question?.questionId ?? null,
        witnessId: question?.witnessId ?? null,
        lastEventId: event.eventId,
      };
      next = {
        ...state,
        questions: question
          ? {
              ...state.questions,
              [question.questionId]: {
                ...question,
                responseIds: [...question.responseIds, response.responseId],
                activeResponseId: response.responseId,
                lastEventId: event.eventId,
              },
            }
          : state.questions,
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
      const question = response.questionId
        ? state.questions[response.questionId]
        : undefined;
      next = {
        ...state,
        questions: question
          ? {
              ...state.questions,
              [question.questionId]: {
                ...question,
                activeResponseId: null,
                lastEventId: event.eventId,
              },
            }
          : state.questions,
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
      const question = response.questionId
        ? state.questions[response.questionId]
        : undefined;
      next = {
        ...state,
        questions:
          event.payload.outcome === "cancel" && question
            ? {
                ...state.questions,
                [question.questionId]: {
                  ...question,
                  activeResponseId: null,
                  lastEventId: event.eventId,
                },
              }
            : state.questions,
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
      const visibleToSides = [
        event.actor.side,
        ...event.payload.recipientPartyIds.map((partyId) =>
          partySideForPolicy(state, partyId),
        ),
      ].filter(
        (side, index, sides): side is "user" | "opposing" =>
          side !== "neutral" && sides.indexOf(side) === index,
      );
      const offer = {
        offerId: event.payload.offerId,
        parentOfferId: event.payload.parentOfferId,
        proposedBySide: event.actor.side,
        proposedByPartyId: event.payload.proposedByPartyId,
        recipientPartyIds: [...event.payload.recipientPartyIds],
        visibleToSides,
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
      const accepted = event.type === "ACCEPT_SETTLEMENT";
      const activeAppearance = state.activeAppearanceId
        ? state.appearances[state.activeAppearanceId]
        : undefined;
      const activeLeg =
        activeAppearance &&
        (activeAppearance.stage === "direct" ||
          activeAppearance.stage === "cross" ||
          activeAppearance.stage === "redirect" ||
          activeAppearance.stage === "recross")
          ? activeAppearance.stage
          : null;
      const pendingResponses = accepted
        ? Object.fromEntries(
            Object.entries(state.pendingResponses).map(([responseId, response]) => [
              responseId,
              response.status === "pending" || response.status === "streaming"
                ? { ...response, status: "cancelled" as const, lastEventId: event.eventId }
                : response,
            ]),
          )
        : state.pendingResponses;
      const questions = accepted
        ? Object.fromEntries(
            Object.entries(state.questions).map(([questionId, question]) => [
              questionId,
              question.status === "open"
                ? {
                    ...question,
                    status: "withdrawn" as const,
                    activeResponseId: null,
                    lastEventId: event.eventId,
                  }
                : question,
            ]),
          )
        : state.questions;
      const objections = accepted
        ? Object.fromEntries(
            Object.entries(state.objections).map(([objectionId, objection]) => [
              objectionId,
              objection.status === "pending"
                ? {
                    ...objection,
                    status: "withdrawn" as const,
                  }
                : objection,
            ]),
          )
        : state.objections;
      const strikeMotions = accepted
        ? Object.fromEntries(
            Object.entries(state.strikeMotions).map(([motionId, motion]) => [
              motionId,
              motion.status === "pending"
                ? { ...motion, status: "withdrawn" as const }
                : motion,
            ]),
          )
        : state.strikeMotions;
      next = {
        ...state,
        status: accepted ? "settled" : state.status,
        phase: accepted ? "debrief" : state.phase,
        phaseBeforeRecess: accepted ? null : state.phaseBeforeRecess,
        activeWitnessId: accepted ? null : state.activeWitnessId,
        activeAppearanceId: accepted ? null : state.activeAppearanceId,
        activeQuestionId: accepted ? null : state.activeQuestionId,
        activeInterruption: accepted ? null : state.activeInterruption,
        activeSettlementOfferId: null,
        appearances:
          accepted && activeAppearance
            ? {
                ...state.appearances,
                [activeAppearance.appearanceId]: {
                  ...activeAppearance,
                  stage: "released",
                  legs: activeLeg
                    ? {
                        ...activeAppearance.legs,
                        [activeLeg]: {
                          ...activeAppearance.legs[activeLeg],
                          status: "terminated",
                          endedEventId: event.eventId,
                        },
                      }
                    : activeAppearance.legs,
                  releasedEventId: event.eventId,
                },
              }
            : state.appearances,
        witnesses:
          accepted && state.activeWitnessId
            ? {
                ...state.witnesses,
                [state.activeWitnessId]: {
                  ...state.witnesses[state.activeWitnessId],
                  status: "released",
                  examinationKind: null,
                  lastEventId: event.eventId,
                },
              }
            : state.witnesses,
        pendingResponses,
        questions,
        objections,
        strikeMotions,
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
        closingSides: [...state.closingSides, event.payload.side],
        transcriptTurns: { ...state.transcriptTurns, [turn.turnId]: turn },
        transcriptTurnIds: [...state.transcriptTurnIds, turn.turnId],
      };
      break;
    }
    case "INSTRUCT_JURY":
      next = { ...state, instructionIds: [...state.instructionIds, ...event.payload.instructionIds] };
      break;
    case "DELIBERATE":
      next = { ...state, deliberated: true };
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
    case "UPDATE_OPPOSING_STRATEGY":
      next = {
        ...state,
        opposingStrategy: {
          ...event.payload,
          ownerActorId: event.actor.actorId,
          sourceEventId:
            state.opposingStrategy?.sourceEventId ?? event.eventId,
          lastEventId: event.eventId,
        },
      };
      break;
  }

  return finalize(next, event);
}
