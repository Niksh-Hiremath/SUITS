import {
  assertCaseGraphContentHash,
  type CaseGraph,
  type Fact,
  type Party,
} from "../case-graph";
import type {
  ActorRef,
  EvidenceStateEntry,
  FactStateEntry,
  TestimonyStateEntry,
  TranscriptTurn,
  TrialState,
} from "../trial-engine/schemas";
import {
  JURY_RECORD_SCHEMA_VERSION,
  KNOWLEDGE_VIEW_SCHEMA_VERSION,
  parseJuryRecord,
  parseKnowledgeView,
  type JuryRecord,
  type KnowledgeView,
} from "./schema";

export interface CoachingInferenceProjection {
  inferenceId: string;
  text: string;
  transcriptEventIds: readonly string[];
  evidenceIds: readonly string[];
}

export interface KnowledgeStateProjection {
  trial: TrialState;
  caseGraph: CaseGraph;
  partyIdByActorId?: Readonly<Record<string, string>>;
  strategyMemoryByActorId?: Readonly<Record<string, readonly string[]>>;
  coachingInferences?: readonly CoachingInferenceProjection[];
  currentExchangeTurnId?: string | null;
  emotionalStateByWitnessId?: Readonly<
    Record<string, "neutral" | "confident" | "nervous" | "defensive" | "empathetic">
  >;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(compareIds);
}

function sortedValues<T>(record: Readonly<Record<string, T>>, getId: (value: T) => string): T[] {
  return Object.values(record).sort((left, right) => compareIds(getId(left), getId(right)));
}

function sourceSegmentIdsForFact(fact: Fact | undefined): string[] {
  if (!fact) return [];
  return uniqueSorted(fact.provenance.flatMap((provenance) => provenance.sourceSegmentIds));
}

function sourceSegmentIdsForEvidence(
  evidence: CaseGraph["evidence"][number] | undefined,
): string[] {
  if (!evidence) return [];
  return uniqueSorted(evidence.provenance.flatMap((provenance) => provenance.sourceSegmentIds));
}

function assertMatchingCase(state: KnowledgeStateProjection): void {
  const graph = assertCaseGraphContentHash(
    state.caseGraph,
    state.trial.caseGraphContentHash,
  );
  if (state.trial.caseId !== graph.caseId || state.trial.caseVersion !== graph.version) {
    throw new Error(
      `Knowledge context case mismatch: trial ${state.trial.caseId}@${state.trial.caseVersion}, graph ${state.caseGraph.caseId}@${state.caseGraph.version}`,
    );
  }
}

function actorFor(state: KnowledgeStateProjection, actorId: string): ActorRef {
  const actor = state.trial.actors[actorId];
  if (!actor) throw new Error(`Unknown knowledge actor: ${actorId}`);
  return actor;
}

function partyForActor(
  state: KnowledgeStateProjection,
  actor: ActorRef,
): Party {
  const policyBinding = state.trial.policySnapshot.mappings.actors.find(
    (binding) => binding.actorId === actor.actorId,
  );
  if (!policyBinding) {
    throw new Error(`Actor ${actor.actorId} is absent from the pinned trial policy`);
  }
  const representedPartyIds = new Set(policyBinding.representedPartyIds);
  const explicitPartyId = state.partyIdByActorId?.[actor.actorId];
  if (explicitPartyId) {
    if (!representedPartyIds.has(explicitPartyId)) {
      throw new Error(
        `Actor ${actor.actorId} does not represent pinned party ${explicitPartyId}`,
      );
    }
    const explicitParty = state.caseGraph.parties.find((party) => party.partyId === explicitPartyId);
    if (!explicitParty) {
      throw new Error(`Unknown party mapping for actor ${actor.actorId}: ${explicitPartyId}`);
    }
    if (explicitParty.simulationSide !== actor.side) {
      throw new Error(`Actor ${actor.actorId} is mapped to a party on a different side`);
    }
    return explicitParty;
  }

  const candidates = state.caseGraph.parties.filter(
    (party) => representedPartyIds.has(party.partyId),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Actor ${actor.actorId} requires an explicit party mapping for side ${actor.side}`,
    );
  }
  return candidates[0];
}

function currentExchange(
  state: KnowledgeStateProjection,
  allowedFactIds?: ReadonlySet<string>,
  allowedEvidenceIds?: ReadonlySet<string>,
): {
  exchangeId: string;
  speakerActorId: string;
  text: string;
  factIds: string[];
  evidenceIds: string[];
} | null {
  const requestedTurnId =
    state.currentExchangeTurnId ?? state.trial.transcriptTurnIds.at(-1) ?? null;
  if (requestedTurnId === null) return null;

  const turn: TranscriptTurn | undefined = state.trial.transcriptTurns[requestedTurnId];
  if (!turn) throw new Error(`Unknown current exchange turn: ${requestedTurnId}`);

  return {
    exchangeId: turn.turnId,
    speakerActorId: turn.actor.actorId,
    text: turn.text,
    factIds: uniqueSorted(
      turn.citations.factIds.filter((factId) => !allowedFactIds || allowedFactIds.has(factId)),
    ),
    evidenceIds: uniqueSorted(
      turn.citations.evidenceIds.filter(
        (evidenceId) => !allowedEvidenceIds || allowedEvidenceIds.has(evidenceId),
      ),
    ),
  };
}

export function buildJuryRecord(state: KnowledgeStateProjection): JuryRecord {
  assertMatchingCase(state);

  const graphFacts = new Map(state.caseGraph.facts.map((fact) => [fact.factId, fact]));
  const graphEvidence = new Map(
    state.caseGraph.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );

  const admittedFacts = sortedValues(state.trial.facts, (fact) => fact.factId).filter(
    (fact) => fact.status === "admitted",
  );
  const admittedEvidence = sortedValues(
    state.trial.evidence,
    (evidence) => evidence.evidenceId,
  ).filter((evidence) => evidence.status === "admitted");
  const admittedFactIds = new Set(admittedFacts.map((fact) => fact.factId));
  const admittedEvidenceIds = new Set(admittedEvidence.map((evidence) => evidence.evidenceId));

  return parseJuryRecord({
    schemaVersion: JURY_RECORD_SCHEMA_VERSION,
    trialId: state.trial.trialId,
    stateVersion: state.trial.version,
    facts: admittedFacts.map((fact) => ({
      factId: fact.factId,
      proposition: fact.proposition,
      status: "admitted" as const,
      sourceSegmentIds: sourceSegmentIdsForFact(graphFacts.get(fact.factId)),
    })),
    evidence: admittedEvidence.map((evidence) => {
      const authoredEvidence = graphEvidence.get(evidence.evidenceId);
      return {
        evidenceId: evidence.evidenceId,
        name: evidence.name,
        description: authoredEvidence?.description ?? evidence.name,
        status: "admitted" as const,
        sourceSegmentIds: sourceSegmentIdsForEvidence(authoredEvidence),
      };
    }),
    testimony: sortedValues(state.trial.testimony, (testimony) => testimony.testimonyId)
      .filter(
        (testimony) =>
          testimony.status === "active" &&
          state.trial.transcriptTurns[testimony.turnId]?.status === "active",
      )
      .map((testimony) => {
        const witnessActor = Object.values(state.trial.actors).find(
          (actor) => actor.role === "witness" && actor.witnessId === testimony.witnessId,
        );
        return {
          testimonyId: testimony.testimonyId,
          witnessId: testimony.witnessId,
          speakerActorId: witnessActor?.actorId ?? testimony.witnessId,
          text: testimony.text,
          status: "active" as const,
          factIds: uniqueSorted(
            testimony.factIds.filter((factId) => admittedFactIds.has(factId)),
          ),
          evidenceIds: uniqueSorted(
            testimony.evidenceIds.filter((evidenceId) => admittedEvidenceIds.has(evidenceId)),
          ),
          transcriptEventId: testimony.sourceEventId,
        };
      }),
    instructions: uniqueSorted(state.trial.instructionIds).flatMap((instructionId) => {
      const instruction = state.caseGraph.juryInstructions.find(
        (candidate) => candidate.instructionId === instructionId,
      );
      return instruction
        ? [
            {
              instructionId: instruction.instructionId,
              title: instruction.title,
              text: instruction.text,
            },
          ]
        : [];
    }),
  });
}

function buildWitnessView(
  state: KnowledgeStateProjection,
  actor: ActorRef,
  publicRecord: JuryRecord,
): KnowledgeView {
  if (!actor.witnessId) throw new Error(`Witness actor ${actor.actorId} has no witnessId`);
  const witness = state.caseGraph.witnesses.find(
    (candidate) => candidate.witnessId === actor.witnessId,
  );
  if (!witness) throw new Error(`Unknown witness profile: ${actor.witnessId}`);

  const authoredFacts = new Map(state.caseGraph.facts.map((fact) => [fact.factId, fact]));
  const authoredEvidence = new Map(
    state.caseGraph.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const perceivedFactIds = new Set(witness.knowledgeBoundary.perceivedFactIds);
  const knownFactIds = uniqueSorted(witness.knowledgeBoundary.knownFactIds);
  const admittedSeenEvidenceIds = new Set(
    witness.knowledgeBoundary.seenEvidenceIds.filter(
      (evidenceId) => state.trial.evidence[evidenceId]?.status === "admitted",
    ),
  );
  const activeQuestion = state.trial.activeQuestionId
    ? state.trial.questions[state.trial.activeQuestionId]
    : undefined;
  const presentedEvidenceIds = new Set(
    activeQuestion?.witnessId === witness.witnessId
      ? activeQuestion.presentedEvidenceIds.filter((evidenceId) => {
          const evidence = state.trial.evidence[evidenceId];
          return (
            witness.knowledgeBoundary.seenEvidenceIds.includes(evidenceId) &&
            evidence !== undefined &&
            evidence.status !== "excluded" &&
            evidence.status !== "withdrawn"
          );
        })
      : [],
  );
  const availablePriorStatementIds = new Set(
    witness.knowledgeBoundary.availablePriorStatementIds,
  );
  const scopedPublicRecord = parseJuryRecord({
    ...publicRecord,
    facts: publicRecord.facts.filter((fact) => knownFactIds.includes(fact.factId)),
    evidence: publicRecord.evidence.filter((evidence) =>
      admittedSeenEvidenceIds.has(evidence.evidenceId),
    ),
    testimony: [],
    instructions: [],
  });

  return parseKnowledgeView({
    schemaVersion: KNOWLEDGE_VIEW_SCHEMA_VERSION,
    trialId: state.trial.trialId,
    stateVersion: state.trial.version,
    actorId: actor.actorId,
    actorRole: "witness",
    case: {
      caseId: state.caseGraph.caseId,
      caseVersion: state.caseGraph.version,
      title: state.caseGraph.title,
    },
    publicRecord: scopedPublicRecord,
    witness: {
      witnessId: witness.witnessId,
      name: witness.name,
      role: witness.role,
      emotionalState:
        state.emotionalStateByWitnessId?.[witness.witnessId] ?? witness.emotionalBaseline,
      facts: knownFactIds.flatMap((factId) => {
        const factState = state.trial.facts[factId];
        const authoredFact = authoredFacts.get(factId);
        if (!factState && !authoredFact) return [];
        return [
          {
            factId,
            proposition: factState?.proposition ?? authoredFact!.proposition,
            knowledgeBasis: perceivedFactIds.has(factId) ? "perceived" : "known",
          },
        ];
      }),
      admittedSeenEvidence: uniqueSorted([...admittedSeenEvidenceIds]).flatMap(
        (evidenceId) => {
          const evidenceState = state.trial.evidence[evidenceId];
          const authoredItem = authoredEvidence.get(evidenceId);
          if (!evidenceState || !authoredItem) return [];
          return [
            {
              evidenceId,
              name: evidenceState.name,
              description: authoredItem.description,
              status: "admitted" as const,
            },
          ];
        },
      ),
      priorStatements: witness.priorStatements
        .filter((statement) => availablePriorStatementIds.has(statement.priorStatementId))
        .sort((left, right) => compareIds(left.priorStatementId, right.priorStatementId))
        .map((statement) => ({
          priorStatementId: statement.priorStatementId,
          madeAt: statement.madeAt,
          kind: statement.kind,
          text: statement.text,
          relatedFactIds: uniqueSorted(
            statement.relatedFactIds.filter((factId) => knownFactIds.includes(factId)),
          ),
          relatedEvidenceIds: uniqueSorted(
            statement.relatedEvidenceIds.filter((evidenceId) =>
              admittedSeenEvidenceIds.has(evidenceId),
            ),
          ),
        })),
      allowedTopics: [...witness.knowledgeBoundary.allowedTopics],
      forbiddenTopics: [...witness.knowledgeBoundary.forbiddenTopics],
    },
    presentedEvidence: uniqueSorted([...presentedEvidenceIds]).flatMap(
      (evidenceId) => {
        const evidenceState = state.trial.evidence[evidenceId];
        const authoredItem = authoredEvidence.get(evidenceId);
        if (!evidenceState || !authoredItem) return [];
        if (
          evidenceState.status === "excluded" ||
          evidenceState.status === "withdrawn"
        ) {
          return [];
        }
        return [
          {
            evidenceId,
            name: evidenceState.name,
            description: authoredItem.description,
            status: evidenceState.status,
          },
        ];
      },
    ),
    currentExchange: currentExchange(
      state,
      new Set(knownFactIds),
      new Set([...admittedSeenEvidenceIds, ...presentedEvidenceIds]),
    ),
  });
}

function buildCounselView(
  state: KnowledgeStateProjection,
  actor: ActorRef,
  publicRecord: JuryRecord,
): KnowledgeView {
  const party = partyForActor(state, actor);
  const authoredFacts = new Map(state.caseGraph.facts.map((fact) => [fact.factId, fact]));
  const authoredEvidence = new Map(
    state.caseGraph.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const permittedFacts = sortedValues(state.trial.facts, (fact) => fact.factId).filter(
    (fact) => {
      if (fact.status === "hidden") return false;
      const authoredFact = authoredFacts.get(fact.factId);
      return (
        fact.visibility === "public" || authoredFact?.assertedByPartyIds.includes(party.partyId)
      );
    },
  );
  const permittedEvidence = sortedValues(
    state.trial.evidence,
    (evidence) => evidence.evidenceId,
  ).filter((evidence) =>
    authoredEvidence.get(evidence.evidenceId)?.offeredByPartyIds.includes(party.partyId),
  );
  const privatePosition = state.caseGraph.settlement.participants.find(
    (position) => position.partyId === party.partyId,
  );
  const canonicalStrategy =
    actor.role === "opposing_counsel" &&
    state.trial.opposingStrategy?.ownerActorId === actor.actorId
      ? state.trial.opposingStrategy
      : null;
  const strategyMemory = canonicalStrategy
    ? [
        ...canonicalStrategy.objectives.map((objective) => `Objective: ${objective}`),
        ...canonicalStrategy.witnessPriorityIds.map((witnessId) => `Witness priority: ${witnessId}`),
        ...canonicalStrategy.evidencePriorityIds.map((evidenceId) => `Evidence priority: ${evidenceId}`),
        `Settlement posture: ${canonicalStrategy.settlementPosture}`,
        ...canonicalStrategy.privateNotes.map((note) => `Private note: ${note}`),
      ]
    : [...(state.strategyMemoryByActorId?.[actor.actorId] ?? [])];

  return parseKnowledgeView({
    schemaVersion: KNOWLEDGE_VIEW_SCHEMA_VERSION,
    trialId: state.trial.trialId,
    stateVersion: state.trial.version,
    actorId: actor.actorId,
    actorRole: actor.role,
    case: {
      caseId: state.caseGraph.caseId,
      caseVersion: state.caseGraph.version,
      title: state.caseGraph.title,
    },
    publicRecord,
    counsel: {
      partyId: party.partyId,
      facts: permittedFacts.map((fact) => ({
        factId: fact.factId,
        proposition: fact.proposition,
        status: fact.status,
      })),
      evidence: permittedEvidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        name: evidence.name,
        description: authoredEvidence.get(evidence.evidenceId)?.description ?? evidence.name,
        status: evidence.status,
      })),
      strategyMemory,
      privateSettlement:
        state.caseGraph.settlement.enabled && privatePosition
          ? {
              partyId: party.partyId,
              currency: state.caseGraph.settlement.currency,
              authority: {
                minimum: privatePosition.minimumAuthority,
                maximum: privatePosition.maximumAuthority,
                reservationValue: privatePosition.reservationValue,
                targetValue: privatePosition.targetValue,
              },
              confidentialPriorities: [...privatePosition.confidentialPriorities],
              permittedNonMonetaryTerms: [...privatePosition.permittedNonMonetaryTerms],
              offers: sortedValues(
                state.trial.settlementOffers,
                (offer) => offer.offerId,
              )
                .filter(
                  (offer) =>
                    offer.visibleToSides.includes(actor.side) &&
                    (offer.proposedByPartyId === party.partyId ||
                      offer.recipientPartyIds.includes(party.partyId)),
                )
                 .map((offer) => {
                   const proposer = state.caseGraph.parties.find(
                     (candidate) => candidate.partyId === offer.proposedByPartyId,
                   );
                   if (!proposer) {
                     throw new Error(`Settlement offer ${offer.offerId} has no proposing party`);
                  }
                  return {
                    offerId: offer.offerId,
                    proposerPartyId: proposer.partyId,
                    recipientPartyIds: uniqueSorted(offer.recipientPartyIds),
                    amount: offer.terms.amount,
                    nonMonetaryTerms: [...offer.terms.nonMonetaryTerms],
                    status: offer.status,
                  };
                }),
            }
          : null,
    },
    currentExchange: currentExchange(
      state,
      new Set(permittedFacts.map((fact) => fact.factId)),
      new Set([
        ...publicRecord.evidence.map((evidence) => evidence.evidenceId),
        ...permittedEvidence.map((evidence) => evidence.evidenceId),
      ]),
    ),
  });
}

function buildJudgeView(
  state: KnowledgeStateProjection,
  actor: ActorRef,
  publicRecord: JuryRecord,
): KnowledgeView {
  const visibleFactIds = new Set(
    Object.values(state.trial.facts)
      .filter((fact) => fact.status !== "hidden")
      .map((fact) => fact.factId),
  );
  const evidenceIds = new Set(Object.keys(state.trial.evidence));
  const rules = state.caseGraph.jurisdictionProfile;

  return parseKnowledgeView({
    schemaVersion: KNOWLEDGE_VIEW_SCHEMA_VERSION,
    trialId: state.trial.trialId,
    stateVersion: state.trial.version,
    actorId: actor.actorId,
    actorRole: "judge",
    case: {
      caseId: state.caseGraph.caseId,
      caseVersion: state.caseGraph.version,
      title: state.caseGraph.title,
    },
    publicRecord,
    rules: {
      profileId: rules.profileId,
      name: rules.name,
      rulesVersion: rules.rulesVersion,
      governingLaw: rules.governingLaw,
      burdenOfProof: rules.burdenOfProof,
      permittedObjectionGrounds: [...rules.permittedObjectionGrounds],
    },
    proceduralRecord: {
      excludedFactIds: sortedValues(state.trial.facts, (fact) => fact.factId)
        .filter((fact) => fact.status === "excluded" || fact.status === "stricken")
        .map((fact) => fact.factId),
      excludedEvidenceIds: sortedValues(
        state.trial.evidence,
        (evidence) => evidence.evidenceId,
      )
        .filter((evidence) => evidence.status === "excluded")
        .map((evidence) => evidence.evidenceId),
      strickenTestimonyIds: sortedValues(
        state.trial.testimony,
        (testimony) => testimony.testimonyId,
      )
        .filter((testimony) => testimony.status === "stricken")
        .map((testimony) => testimony.testimonyId),
    },
    currentExchange: currentExchange(state, visibleFactIds, evidenceIds),
  });
}

function buildJuryView(
  state: KnowledgeStateProjection,
  actor: ActorRef,
  publicRecord: JuryRecord,
): KnowledgeView {
  return parseKnowledgeView({
    schemaVersion: KNOWLEDGE_VIEW_SCHEMA_VERSION,
    trialId: state.trial.trialId,
    stateVersion: state.trial.version,
    actorId: actor.actorId,
    actorRole: "jury",
    case: {
      caseId: state.caseGraph.caseId,
      caseVersion: state.caseGraph.version,
      title: state.caseGraph.title,
    },
    publicRecord,
  });
}

function buildDebriefView(
  state: KnowledgeStateProjection,
  actor: ActorRef,
  publicRecord: JuryRecord,
): KnowledgeView {
  const authoredFacts = new Map(state.caseGraph.facts.map((fact) => [fact.factId, fact]));
  const authoredEvidence = new Map(
    state.caseGraph.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const factStates = sortedValues(state.trial.facts, (fact) => fact.factId);
  const evidenceStates = sortedValues(state.trial.evidence, (evidence) => evidence.evidenceId);
  const testimonyStates = sortedValues(
    state.trial.testimony,
    (testimony) => testimony.testimonyId,
  );

  return parseKnowledgeView({
    schemaVersion: KNOWLEDGE_VIEW_SCHEMA_VERSION,
    trialId: state.trial.trialId,
    stateVersion: state.trial.version,
    actorId: actor.actorId,
    actorRole: "debrief",
    case: {
      caseId: state.caseGraph.caseId,
      caseVersion: state.caseGraph.version,
      title: state.caseGraph.title,
    },
    strata: {
      admittedRecord: {
        label: "admitted_record",
        record: publicRecord,
      },
      unadmittedRecord: {
        label: "unadmitted_record",
        facts: factStates
          .filter(
            (fact) =>
              fact.status === "proposed" ||
              fact.status === "disputed" ||
              fact.status === "verified",
          )
          .map((fact) => ({
            factId: fact.factId,
            proposition: fact.proposition,
            status: fact.status,
          })),
        evidence: evidenceStates
          .filter(
            (evidence) =>
              evidence.status === "uploaded" ||
              evidence.status === "indexed" ||
              evidence.status === "offered" ||
              evidence.status === "withdrawn",
          )
          .map((evidence) => ({
            evidenceId: evidence.evidenceId,
            name: evidence.name,
            status: evidence.status,
          })),
      },
      excludedOrStricken: {
        label: "excluded_or_stricken",
        facts: factStates
          .filter((fact) => fact.status === "excluded" || fact.status === "stricken")
          .map((fact) => ({
            factId: fact.factId,
            proposition: fact.proposition,
            status: fact.status,
          })),
        evidence: evidenceStates
          .filter((evidence) => evidence.status === "excluded")
          .map((evidence) => ({
            evidenceId: evidence.evidenceId,
            name: evidence.name,
            status: "excluded" as const,
          })),
        testimony: testimonyStates
          .filter((testimony) => testimony.status === "stricken")
          .map((testimony) => ({
            testimonyId: testimony.testimonyId,
            witnessId: testimony.witnessId,
            text: testimony.text,
            status: "stricken" as const,
            transcriptEventId: testimony.sourceEventId,
          })),
      },
      hiddenAuthoringTruth: {
        label: "hidden_authoring_truth",
        facts: factStates.flatMap((fact) => {
          const authoredFact = authoredFacts.get(fact.factId);
          if (
            fact.status !== "hidden" ||
            authoredFact?.classification !== "authoring_truth"
          ) {
            return [];
          }
          return [
            {
              factId: fact.factId,
              proposition: fact.proposition,
              sourceSegmentIds: sourceSegmentIdsForFact(authoredFact),
            },
          ];
        }),
      },
      coachingInference: {
        label: "coaching_inference",
        items: [...(state.coachingInferences ?? [])]
          .sort((left, right) => compareIds(left.inferenceId, right.inferenceId))
          .map((inference) => ({
            inferenceId: inference.inferenceId,
            text: inference.text,
            transcriptEventIds: uniqueSorted(inference.transcriptEventIds),
            evidenceIds: uniqueSorted(
              inference.evidenceIds.filter((evidenceId) => authoredEvidence.has(evidenceId)),
            ),
          })),
      },
    },
  });
}

export function buildKnowledgeView(
  state: KnowledgeStateProjection,
  actorId: string,
): KnowledgeView {
  assertMatchingCase(state);
  const actor = actorFor(state, actorId);
  const publicRecord = buildJuryRecord(state);

  switch (actor.role) {
    case "witness":
      return buildWitnessView(state, actor, publicRecord);
    case "user_counsel":
    case "opposing_counsel":
      return buildCounselView(state, actor, publicRecord);
    case "judge":
      return buildJudgeView(state, actor, publicRecord);
    case "jury":
      return buildJuryView(state, actor, publicRecord);
    case "debrief_coach":
      return buildDebriefView(state, actor, publicRecord);
    case "clerk":
    case "system":
      throw new Error(`Actor role ${actor.role} does not receive a model KnowledgeView`);
  }
}

export type {
  EvidenceStateEntry,
  FactStateEntry,
  TestimonyStateEntry,
};
