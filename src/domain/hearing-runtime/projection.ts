import {
  CaseGraphV1Schema,
  type CaseGraph,
} from "../case-graph";
import { buildJuryRecord, buildKnowledgeView } from "../knowledge";
import {
  TrialStateV3Schema,
  type CitationSet,
  type ExaminationKind,
  type TrialStateV3,
} from "../trial-engine/schemas";
import {
  canActorCallWitness,
  canActorProposeSettlement,
  canActorRecallWitness,
} from "../trial-policy";
import {
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "./schema";

export type BuildHearingRuntimeViewInput = {
  caseGraph: CaseGraph;
  trialState: TrialStateV3;
  playerActorId: string;
};

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function uniqueVisibleIds(
  identifiers: readonly string[],
  visible: ReadonlySet<string>,
): string[] {
  return [...new Set(identifiers.filter((identifier) => visible.has(identifier)))];
}

function examinationKindForStage(
  stage:
    | "awaiting_oath"
    | "direct"
    | "cross"
    | "redirect"
    | "recross"
    | "ready_for_release"
    | "released",
): ExaminationKind | null {
  switch (stage) {
    case "direct":
    case "cross":
    case "redirect":
    case "recross":
      return stage;
    case "awaiting_oath":
    case "ready_for_release":
    case "released":
      return null;
  }
}

function filteredCitations(
  citations: CitationSet,
  visible: {
    factIds: ReadonlySet<string>;
    evidenceIds: ReadonlySet<string>;
    testimonyIds: ReadonlySet<string>;
    eventIds: ReadonlySet<string>;
    sourceSegmentIds: ReadonlySet<string>;
  },
): CitationSet {
  return {
    factIds: uniqueVisibleIds(citations.factIds, visible.factIds),
    evidenceIds: uniqueVisibleIds(citations.evidenceIds, visible.evidenceIds),
    testimonyIds: uniqueVisibleIds(
      citations.testimonyIds,
      visible.testimonyIds,
    ),
    eventIds: uniqueVisibleIds(citations.eventIds, visible.eventIds),
    sourceSegmentIds: uniqueVisibleIds(
      citations.sourceSegmentIds,
      visible.sourceSegmentIds,
    ),
  };
}

/**
 * Produces the complete browser-facing read model for a V3 hearing. Every
 * player-specific case material field is copied from the counsel KnowledgeView;
 * the CaseGraph and policy snapshot are never passed through.
 */
export function buildHearingRuntimeView(
  input: BuildHearingRuntimeViewInput,
): HearingRuntimeViewV1 {
  const caseGraph = CaseGraphV1Schema.parse(input.caseGraph);
  const trialState = TrialStateV3Schema.parse(input.trialState);
  const playerActor = trialState.actors[input.playerActorId];
  const expectedRole =
    trialState.userSide === "user" ? "user_counsel" : "opposing_counsel";
  if (
    !playerActor ||
    playerActor.role !== expectedRole ||
    playerActor.side !== trialState.userSide
  ) {
    throw new Error(
      `PLAYER_COUNSEL_REQUIRED:${input.playerActorId}:${trialState.userSide}`,
    );
  }
  const lastEventId = trialState.eventIds.at(-1);
  if (!lastEventId) throw new Error("TRIAL_EVENT_HEAD_REQUIRED");

  const knowledge = buildKnowledgeView(
    { caseGraph, trial: trialState },
    playerActor.actorId,
  );
  if (
    knowledge.actorRole !== "user_counsel" &&
    knowledge.actorRole !== "opposing_counsel"
  ) {
    throw new Error(`PLAYER_COUNSEL_KNOWLEDGE_REQUIRED:${playerActor.actorId}`);
  }

  const facts = new Map<
    string,
    {
      factId: string;
      proposition: string;
      status:
        | "proposed"
        | "disputed"
        | "verified"
        | "admitted"
        | "excluded"
        | "stricken";
    }
  >();
  for (const fact of knowledge.publicRecord.facts) {
    facts.set(fact.factId, {
      factId: fact.factId,
      proposition: fact.proposition,
      status: fact.status,
    });
  }
  for (const fact of knowledge.counsel.facts) {
    facts.set(fact.factId, { ...fact });
  }

  const evidence = new Map<
    string,
    {
      evidenceId: string;
      name: string;
      description: string;
      status:
        | "uploaded"
        | "indexed"
        | "offered"
        | "admitted"
        | "excluded"
        | "withdrawn";
    }
  >();
  for (const item of knowledge.publicRecord.evidence) {
    evidence.set(item.evidenceId, {
      evidenceId: item.evidenceId,
      name: item.name,
      description: item.description,
      status: item.status,
    });
  }
  for (const item of knowledge.counsel.evidence) {
    evidence.set(item.evidenceId, { ...item });
  }

  const visibleFacts = [...facts.values()].sort((left, right) =>
    compareIds(left.factId, right.factId),
  );
  const visibleEvidence = [...evidence.values()].sort((left, right) =>
    compareIds(left.evidenceId, right.evidenceId),
  );
  const visibleFactIds = new Set(visibleFacts.map((fact) => fact.factId));
  const visibleEvidenceIds = new Set(
    visibleEvidence.map((item) => item.evidenceId),
  );

  const activeAppearance = trialState.activeAppearanceId
    ? trialState.appearances[trialState.activeAppearanceId]
    : undefined;
  if (trialState.activeAppearanceId && !activeAppearance) {
    throw new Error(
      `ACTIVE_APPEARANCE_NOT_FOUND:${trialState.activeAppearanceId}`,
    );
  }
  const activeExaminationKind = activeAppearance
    ? examinationKindForStage(activeAppearance.stage)
    : null;
  const activeLeg =
    activeAppearance && activeExaminationKind
      ? activeAppearance.legs[activeExaminationKind]
      : null;

  const activeQuestion = trialState.activeQuestionId
    ? trialState.questions[trialState.activeQuestionId]
    : undefined;
  if (trialState.activeQuestionId && !activeQuestion) {
    throw new Error(`ACTIVE_QUESTION_NOT_FOUND:${trialState.activeQuestionId}`);
  }
  const questioningActor = activeQuestion
    ? trialState.actors[activeQuestion.askedByActorId]
    : undefined;
  if (activeQuestion && !questioningActor) {
    throw new Error(`QUESTION_ACTOR_NOT_FOUND:${activeQuestion.askedByActorId}`);
  }
  const activeResponse = activeQuestion?.activeResponseId
    ? trialState.pendingResponses[activeQuestion.activeResponseId]
    : undefined;
  if (activeQuestion?.activeResponseId && !activeResponse) {
    throw new Error(
      `ACTIVE_RESPONSE_NOT_FOUND:${activeQuestion.activeResponseId}`,
    );
  }
  const hasPendingObjection = activeQuestion
    ? Object.values(trialState.objections).some(
        (objection) =>
          objection.questionId === activeQuestion.questionId &&
          objection.status === "pending",
      )
    : false;
  const opposingResponseWindowOpen =
    activeQuestion !== undefined &&
    questioningActor !== undefined &&
    questioningActor.side !== trialState.userSide &&
    activeResponse !== undefined &&
    (activeResponse.status === "pending" || activeResponse.status === "streaming") &&
    activeResponse.interruptId === null &&
    !hasPendingObjection;
  const playerOwnsActiveLeg = activeLeg?.ownerSide === trialState.userSide;
  const canUseActiveLeg =
    trialState.status === "active" &&
    trialState.phase === "case_in_chief" &&
    playerOwnsActiveLeg &&
    activeLeg?.status === "in_progress" &&
    activeQuestion === undefined;
  const hasPendingStrikeMotion = Object.values(trialState.strikeMotions).some(
    (motion) => motion.status === "pending",
  );

  const witnesses = caseGraph.witnesses.map((profile) => {
    const witnessState = trialState.witnesses[profile.witnessId];
    if (!witnessState) {
      throw new Error(`WITNESS_STATE_NOT_FOUND:${profile.witnessId}`);
    }
    const isActive = activeAppearance?.witnessId === profile.witnessId;
    return {
      witnessId: profile.witnessId,
      name: profile.name,
      kind: profile.kind,
      role: profile.role,
      status: witnessState.status,
      callCount: witnessState.callCount,
      callableByPlayer: canActorCallWitness(
        trialState.policySnapshot,
        playerActor.actorId,
        profile.witnessId,
      ),
      recallableByPlayer: canActorRecallWitness(
        trialState.policySnapshot,
        playerActor.actorId,
        profile.witnessId,
      ),
      currentAppearanceId: isActive ? activeAppearance.appearanceId : null,
      currentExaminationLeg: isActive ? activeExaminationKind : null,
    };
  });

  const orderedTurns = trialState.transcriptTurnIds.map((turnId) => {
    const turn = trialState.transcriptTurns[turnId];
    if (!turn) throw new Error(`TRANSCRIPT_TURN_NOT_FOUND:${turnId}`);
    return turn;
  });
  const visibleTranscriptEventIds = new Set(
    orderedTurns.map((turn) => turn.sourceEventId),
  );
  const visibleTurnIds = new Set(orderedTurns.map((turn) => turn.turnId));
  const visibleTestimonyIds = new Set(
    Object.values(trialState.testimony)
      .filter((testimony) => visibleTurnIds.has(testimony.turnId))
      .map((testimony) => testimony.testimonyId),
  );
  const visibleSourceSegmentIds = new Set([
    ...knowledge.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...knowledge.publicRecord.evidence.flatMap(
      (item) => item.sourceSegmentIds,
    ),
  ]);
  const citationVisibility = {
    factIds: visibleFactIds,
    evidenceIds: visibleEvidenceIds,
    testimonyIds: visibleTestimonyIds,
    eventIds: visibleTranscriptEventIds,
    sourceSegmentIds: visibleSourceSegmentIds,
  };

  const transcript = orderedTurns.map((turn, index) => {
    const actor = trialState.actors[turn.actor.actorId];
    if (!actor) throw new Error(`TRANSCRIPT_ACTOR_NOT_FOUND:${turn.actor.actorId}`);
    if (turn.testimonyId && !trialState.testimony[turn.testimonyId]) {
      throw new Error(`TRANSCRIPT_TESTIMONY_NOT_FOUND:${turn.testimonyId}`);
    }
    return {
      ordinal: index + 1,
      turnId: turn.turnId,
      actor,
      text: turn.text,
      testimonyId: turn.testimonyId,
      status: turn.status,
      citations: filteredCitations(turn.citations, citationVisibility),
    };
  });

  const privateSettlement = knowledge.counsel.privateSettlement;
  const visibleOpenOffers = (privateSettlement?.offers ?? []).filter((offer) => {
    const canonical = trialState.settlementOffers[offer.offerId];
    return (
      offer.status === "open" &&
      canonical?.status === "open" &&
      canonical.expiresAtSequence >= trialState.lastSequence + 1
    );
  });
  const playerPartyId = knowledge.counsel.partyId;
  const respondableOfferIds = visibleOpenOffers
    .filter(
      (offer) =>
        offer.proposerPartyId !== playerPartyId &&
        offer.recipientPartyIds.includes(playerPartyId),
    )
    .map(({ offerId }) => offerId)
    .sort(compareIds);
  const withdrawableOfferIds = visibleOpenOffers
    .filter((offer) => offer.proposerPartyId === playerPartyId)
    .map(({ offerId }) => offerId)
    .sort(compareIds);
  const juryRecord = buildJuryRecord({
    caseGraph,
    trial: trialState,
  });
  const hasSettlementDebriefRecord =
    juryRecord.facts.length > 0 ||
    juryRecord.evidence.length > 0 ||
    juryRecord.testimony.length > 0;

  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
    case: {
      caseId: caseGraph.caseId,
      version: caseGraph.version,
      title: caseGraph.title,
      summary: caseGraph.summary,
      educationalDisclaimer: caseGraph.educationalDisclaimer,
      jurisdiction: {
        profileId: caseGraph.jurisdictionProfile.profileId,
        name: caseGraph.jurisdictionProfile.name,
        rulesVersion: caseGraph.jurisdictionProfile.rulesVersion,
        governingLaw: caseGraph.jurisdictionProfile.governingLaw,
        burdenOfProof: caseGraph.jurisdictionProfile.burdenOfProof,
      },
      issues: caseGraph.issues.map((issue) => ({
        issueId: issue.issueId,
        title: issue.title,
        question: issue.question,
        burdenPartyId: issue.burdenPartyId,
        standard: issue.standard,
      })),
    },
    trial: {
      trialId: trialState.trialId,
      phase: trialState.phase,
      status: trialState.status,
      version: trialState.version,
      sequence: trialState.lastSequence,
      lastEventId,
      userSide: trialState.userSide,
    },
    activeAppearance: activeAppearance
      ? {
          appearanceId: activeAppearance.appearanceId,
          witnessId: activeAppearance.witnessId,
          ordinal: activeAppearance.ordinal,
          invocation: activeAppearance.invocation,
          callingSide: activeAppearance.callingSide,
          stage: activeAppearance.stage,
          examinationLeg: activeLeg
            ? {
                kind: activeLeg.kind,
                ownerSide: activeLeg.ownerSide,
                status: activeLeg.status,
                answeredQuestionCount: activeLeg.answeredQuestionCount,
              }
            : null,
        }
      : null,
    activeQuestion:
      activeQuestion && questioningActor
        ? {
            questionId: activeQuestion.questionId,
            appearanceId: activeQuestion.appearanceId,
            witnessId: activeQuestion.witnessId,
            examinationKind: activeQuestion.examinationKind,
            askedBy: questioningActor,
            questionTurnId: activeQuestion.questionTurnId,
            pendingResponseId: opposingResponseWindowOpen
              ? (activeResponse?.responseId ?? null)
              : null,
            presentedEvidenceIds: activeQuestion.presentedEvidenceIds.filter(
              (evidenceId) => visibleEvidenceIds.has(evidenceId),
            ),
            status: activeQuestion.status,
          }
        : null,
    capabilities: {
      canAskQuestion: canUseActiveLeg,
      canFinishExamination: canUseActiveLeg,
      canFinishTrial:
        trialState.status === "active" &&
        trialState.phase === "case_in_chief" &&
        activeAppearance === undefined &&
        activeQuestion === undefined &&
        trialState.restedSides.length === 0 &&
        !hasPendingStrikeMotion,
      canObject: opposingResponseWindowOpen,
      canContinueResponse: opposingResponseWindowOpen,
      canProposeSettlement:
        hasSettlementDebriefRecord &&
        privateSettlement !== null &&
        trialState.status === "active" &&
        activeAppearance === undefined &&
        activeQuestion === undefined &&
        trialState.activeInterruption === null &&
        visibleOpenOffers.length === 0 &&
        canActorProposeSettlement(
          trialState.policySnapshot,
          playerActor.actorId,
          trialState.phase,
        ),
      counterableSettlementOfferIds: hasSettlementDebriefRecord
        ? respondableOfferIds
        : [],
      acceptableSettlementOfferIds: hasSettlementDebriefRecord
        ? respondableOfferIds
        : [],
      rejectableSettlementOfferIds: respondableOfferIds,
      withdrawableSettlementOfferIds: withdrawableOfferIds,
    },
    witnesses,
    player: {
      actorId: playerActor.actorId,
      actorRole: playerActor.role,
      side: playerActor.side,
      partyId: knowledge.counsel.partyId,
      facts: visibleFacts,
      evidence: visibleEvidence,
      settlement: privateSettlement
        ? {
            partyId: privateSettlement.partyId,
            currency: privateSettlement.currency,
            offers: privateSettlement.offers.map((offer) => ({
              offerId: offer.offerId,
              proposerPartyId: offer.proposerPartyId,
              recipientPartyIds: [...offer.recipientPartyIds],
              amount: offer.amount,
              nonMonetaryTerms: [...offer.nonMonetaryTerms],
              status: offer.status,
            })),
          }
        : null,
    },
    transcript,
    permittedObjectionGrounds: [
      ...caseGraph.jurisdictionProfile.permittedObjectionGrounds,
    ],
  });
}
