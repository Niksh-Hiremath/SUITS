import { createThreeWitnessCaseGraphV1Fixture } from "../domain/case-graph";
import {
  FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
  FinalBoundInterruptionCandidateWithdrawnSchema,
} from "../domain/objections/final-bound-contracts";
import {
  PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION,
  PartialObjectionCoordinator,
  type OpenPartialObjectionUtterance,
  type PartialObjectionHead,
  type PartialObjectionMetrics,
} from "../domain/objections/partial-coordinator";
import {
  PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION,
  type PartialObjectionCandidate,
  type PartialObjectionDetectorInput,
} from "../domain/objections/partial-detector";
import type { TrialPolicyActorBindingInput } from "../domain/trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  commitAction,
  createStartTrialAction,
  type ActorRef,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialEvent,
  type TrialState,
} from "../domain/trial-engine";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

type EngineFlowFixture = Readonly<{
  eventTypes: readonly string[];
  questionId: string;
  questionStatus: string;
  responseId: string;
  responseStatus: string;
  interruptId: string;
  interruptedResponseId: string;
  interruptionStatus: string;
  rephrasedQuestionId: string | null;
  rephrasesQuestionId: string | null;
  rephrasedQuestionStatus: string | null;
}>;

type StrikeFlowFixture = Readonly<{
  eventTypes: readonly string[];
  motionStatus: string;
  targetTestimonyId: string;
  targetTestimonyStatus: string;
  targetTurnStatus: string;
  targetRetainedInHistory: boolean;
}>;

export type Milestone6ObjectionEvalFixture = Readonly<{
  candidateWithdrawal: Readonly<{
    disposition: "candidate_withdrawn";
    sourceStateVersion: number;
    completedStateVersion: number;
    sourceLastEventId: string;
    completedLastEventId: string;
    durableEventTypes: readonly string[];
    neutralCorrectionPlayed: boolean;
    rulingClipPlayed: boolean;
  }>;
  coordinatorOrdering: Readonly<{
    order: readonly string[];
    sealed: boolean;
    metrics: PartialObjectionMetrics;
  }>;
  staleSuppression: Readonly<{
    staleRevisionDisposition: string;
    requestCount: number;
    abortedRequestCount: number;
    deliveredResultCount: number;
    lateAudio: Readonly<{
      targetStateVersion: number;
      canonicalStateVersion: number;
      played: boolean;
      mutatedCanonicalState: boolean;
    }>;
    metrics: PartialObjectionMetrics;
  }>;
  sustained: EngineFlowFixture;
  overruled: EngineFlowFixture;
  strikeGranted: StrikeFlowFixture;
  strikeDenied: StrikeFlowFixture;
}>;

const TRIAL_ID = "trial_eval_objection_fixture";
const BASE_TIME_MS = Date.parse("2026-07-19T00:00:00.000Z");
const GRAPH = createThreeWitnessCaseGraphV1Fixture();
const WITNESS = GRAPH.witnesses[0];

if (WITNESS === undefined) {
  throw new Error("The deterministic objection eval requires one witness");
}

const USER_PARTY_IDS = GRAPH.parties
  .filter((party) => party.simulationSide === "user")
  .map((party) => party.partyId);
const OPPOSING_PARTY_IDS = GRAPH.parties
  .filter((party) => party.simulationSide === "opposing")
  .map((party) => party.partyId);
const WITNESS_FACT_ID = WITNESS.knowledgeBoundary.knownFactIds[0];

if (WITNESS_FACT_ID === undefined) {
  throw new Error("The deterministic objection eval witness needs one known fact");
}

function witnessSide(witnessId: string): ActorRef["side"] {
  const witness = GRAPH.witnesses.find((candidate) => candidate.witnessId === witnessId);
  const alignedParty = GRAPH.parties.find(
    (party) => party.partyId === witness?.alignedPartyId,
  );
  return alignedParty?.simulationSide ?? "neutral";
}

const WITNESS_ACTORS: ActorRef[] = GRAPH.witnesses.map((witness, index) => ({
  actorId: `actor_eval_witness_${index + 1}`,
  role: "witness",
  side: witnessSide(witness.witnessId),
  witnessId: witness.witnessId,
}));
const PRIMARY_WITNESS_ACTOR = WITNESS_ACTORS[0];

if (PRIMARY_WITNESS_ACTOR === undefined) {
  throw new Error("The deterministic objection eval needs a witness actor");
}

const ACTORS = {
  system: {
    actorId: "actor_eval_system",
    role: "system",
    side: "neutral",
    witnessId: null,
  },
  judge: {
    actorId: "actor_eval_judge",
    role: "judge",
    side: "neutral",
    witnessId: null,
  },
  userCounsel: {
    actorId: "actor_eval_user_counsel",
    role: "user_counsel",
    side: "user",
    witnessId: null,
  },
  opposingCounsel: {
    actorId: "actor_eval_opposing_counsel",
    role: "opposing_counsel",
    side: "opposing",
    witnessId: null,
  },
  jury: {
    actorId: "actor_eval_jury",
    role: "jury",
    side: "neutral",
    witnessId: null,
  },
  debriefCoach: {
    actorId: "actor_eval_debrief_coach",
    role: "debrief_coach",
    side: "neutral",
    witnessId: null,
  },
  witness: PRIMARY_WITNESS_ACTOR,
} as const satisfies Record<string, ActorRef>;

const ALL_ACTORS: ActorRef[] = [
  ACTORS.system,
  ACTORS.judge,
  ACTORS.userCounsel,
  ACTORS.opposingCounsel,
  ACTORS.jury,
  ACTORS.debriefCoach,
  ...WITNESS_ACTORS,
];

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolve === null) throw new Error("Deferred promise was not initialized");
      resolve(value);
    },
  };
}

function actorBindings(): TrialPolicyActorBindingInput[] {
  return ALL_ACTORS.map((actor) => ({
    actor,
    representedPartyIds:
      actor.role === "user_counsel"
        ? USER_PARTY_IDS
        : actor.role === "opposing_counsel"
          ? OPPOSING_PARTY_IDS
          : [],
  }));
}

function createEngineHarness() {
  let state: TrialState | null = null;
  let identity = 0;
  const events: TrialEvent[] = [];

  const nextIdentity = (type: string) => {
    identity += 1;
    return {
      actionId: `action_eval_${String(identity).padStart(3, "0")}_${type.toLowerCase()}`,
      requestedAt: new Date(BASE_TIME_MS + identity * 1_000).toISOString(),
    };
  };

  const commit = <K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
  ) => {
    if (state === null) throw new Error("Start the eval trial before committing");
    const payloadRecord = payload as unknown as Record<string, unknown>;
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
    }) as TrialAction;
    const result = commitAction(state, action);
    state = result.state;
    events.push(result.event);
    return result;
  };

  const start = (): void => {
    const result = commitAction(
      null,
      createStartTrialAction({
        trialId: TRIAL_ID,
        ...nextIdentity("START_TRIAL"),
        graph: GRAPH,
        actors: ALL_ACTORS,
        actorBindings: actorBindings(),
      }),
    );
    state = result.state;
    events.push(result.event);
    commit("BEGIN_PHASE", { phase: "case_in_chief" }, ACTORS.judge);
    commit(
      "CALL_WITNESS",
      { witnessId: WITNESS.witnessId, calledBySide: "user" },
      ACTORS.userCounsel,
    );
    commit(
      "SWEAR_WITNESS",
      { witnessId: WITNESS.witnessId },
      ACTORS.judge,
    );
  };

  start();
  return {
    commit,
    events,
    get state(): TrialState {
      if (state === null) throw new Error("The eval trial did not start");
      return state;
    },
  };
}

function openQuestion(
  harness: ReturnType<typeof createEngineHarness>,
  suffix: string,
) {
  const questionId = `question_eval_${suffix}`;
  const responseId = `response_eval_${suffix}`;
  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId: WITNESS.witnessId,
      examinationKind: "direct",
      text: "fixture-question",
      turnId: `turn_eval_question_${suffix}`,
      presentedEvidenceIds: [],
    },
    ACTORS.userCounsel,
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId,
      actorId: ACTORS.witness.actorId,
      purpose: "answer_question",
    },
    ACTORS.system,
  );
  return { questionId, responseId };
}

function interruptQuestion(
  harness: ReturnType<typeof createEngineHarness>,
  suffix: string,
) {
  const { questionId, responseId } = openQuestion(harness, suffix);
  const objectionId = `objection_eval_${suffix}`;
  const interruptId = `interrupt_eval_${suffix}`;
  harness.commit(
    "OBJECT",
    {
      objectionId,
      questionId,
      ground: "leading",
      interruptedResponseId: responseId,
    },
    ACTORS.opposingCounsel,
  );
  harness.commit(
    "BEGIN_INTERRUPTION",
    { interruptId, interruptedResponseId: responseId, objectionId },
    ACTORS.system,
  );
  return { questionId, responseId, objectionId, interruptId };
}

function engineEventTypesFrom(
  harness: ReturnType<typeof createEngineHarness>,
  firstType: string,
): string[] {
  const start = harness.events.findIndex((event) => event.type === firstType);
  if (start < 0) throw new Error(`Missing eval event ${firstType}`);
  return harness.events.slice(start).map((event) => event.type);
}

function createSustainedFixture(): EngineFlowFixture {
  const harness = createEngineHarness();
  const identifiers = interruptQuestion(harness, "sustained");
  harness.commit(
    "RULE_ON_OBJECTION",
    {
      objectionId: identifiers.objectionId,
      ruling: "sustained",
      remedy: "rephrase",
      reason: "fixture-ruling",
    },
    ACTORS.judge,
  );
  harness.commit(
    "RESOLVE_INTERRUPTION",
    { interruptId: identifiers.interruptId, outcome: "cancel" },
    ACTORS.system,
  );
  const rephrasedQuestionId = "question_eval_rephrased";
  harness.commit(
    "REPHRASE_QUESTION",
    {
      originalQuestionId: identifiers.questionId,
      questionId: rephrasedQuestionId,
      text: "fixture-rephrased-question",
      turnId: "turn_eval_rephrased_question",
    },
    ACTORS.userCounsel,
  );

  return {
    eventTypes: engineEventTypesFrom(harness, "ASK_QUESTION"),
    questionId: identifiers.questionId,
    questionStatus: harness.state.questions[identifiers.questionId]?.status ?? "missing",
    responseId: identifiers.responseId,
    responseStatus:
      harness.state.pendingResponses[identifiers.responseId]?.status ?? "missing",
    interruptId: identifiers.interruptId,
    interruptedResponseId:
      harness.state.activeInterruption?.interruptedResponseId ?? "missing",
    interruptionStatus: harness.state.activeInterruption?.status ?? "missing",
    rephrasedQuestionId,
    rephrasesQuestionId:
      harness.state.questions[rephrasedQuestionId]?.rephrasesQuestionId ?? null,
    rephrasedQuestionStatus:
      harness.state.questions[rephrasedQuestionId]?.status ?? "missing",
  };
}

function createOverruledFixture(): EngineFlowFixture {
  const harness = createEngineHarness();
  const identifiers = interruptQuestion(harness, "overruled");
  harness.commit(
    "RULE_ON_OBJECTION",
    {
      objectionId: identifiers.objectionId,
      ruling: "overruled",
      remedy: "resume_response",
      reason: "fixture-ruling",
    },
    ACTORS.judge,
  );
  harness.commit(
    "RESOLVE_INTERRUPTION",
    { interruptId: identifiers.interruptId, outcome: "resume" },
    ACTORS.system,
  );
  harness.commit(
    "RESUME_INTERRUPTED_SPEECH",
    {
      interruptId: identifiers.interruptId,
      interruptedResponseId: identifiers.responseId,
    },
    ACTORS.system,
  );

  return {
    eventTypes: engineEventTypesFrom(harness, "ASK_QUESTION"),
    questionId: identifiers.questionId,
    questionStatus: harness.state.questions[identifiers.questionId]?.status ?? "missing",
    responseId: identifiers.responseId,
    responseStatus:
      harness.state.pendingResponses[identifiers.responseId]?.status ?? "missing",
    interruptId: identifiers.interruptId,
    interruptedResponseId:
      harness.state.activeInterruption?.interruptedResponseId ?? "missing",
    interruptionStatus: harness.state.activeInterruption?.status ?? "missing",
    rephrasedQuestionId: null,
    rephrasesQuestionId: null,
    rephrasedQuestionStatus: null,
  };
}

function answerQuestion(
  harness: ReturnType<typeof createEngineHarness>,
  suffix: string,
) {
  const { questionId, responseId } = openQuestion(harness, suffix);
  const testimonyId = `testimony_eval_${suffix}`;
  const turnId = `turn_eval_answer_${suffix}`;
  harness.commit(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId,
      witnessId: WITNESS.witnessId,
      testimonyId,
      turnId,
      text: "fixture-answer",
      factIds: [WITNESS_FACT_ID],
      evidenceIds: [],
    },
    ACTORS.witness,
  );
  return { testimonyId, turnId };
}

function createStrikeFixture(ruling: "granted" | "denied"): StrikeFlowFixture {
  const harness = createEngineHarness();
  const { testimonyId, turnId } = answerQuestion(harness, `strike_${ruling}`);
  const motionId = `motion_eval_${ruling}`;
  harness.commit(
    "MOVE_TO_STRIKE",
    {
      motionId,
      testimonyIds: [testimonyId],
      reason: "fixture-motion",
    },
    ACTORS.opposingCounsel,
  );
  if (ruling === "granted") {
    harness.commit(
      "STRIKE_TESTIMONY",
      {
        motionId,
        testimonyIds: [testimonyId],
        factIds: [WITNESS_FACT_ID],
      },
      ACTORS.judge,
    );
  } else {
    harness.commit(
      "DENY_STRIKE_MOTION",
      { motionId, reason: "fixture-denial" },
      ACTORS.judge,
    );
  }

  return {
    eventTypes: engineEventTypesFrom(harness, "MOVE_TO_STRIKE"),
    motionStatus: harness.state.strikeMotions[motionId]?.status ?? "missing",
    targetTestimonyId: testimonyId,
    targetTestimonyStatus: harness.state.testimony[testimonyId]?.status ?? "missing",
    targetTurnStatus: harness.state.transcriptTurns[turnId]?.status ?? "missing",
    targetRetainedInHistory: Object.hasOwn(harness.state.testimony, testimonyId),
  };
}

const COORDINATOR_HEAD: PartialObjectionHead = {
  trialId: "trial_eval_coordinator",
  stateVersion: 7,
  lastEventId: "event_eval_head_007",
};

function coordinatorOpen(
  generation: number,
  utteranceId: string,
): OpenPartialObjectionUtterance {
  return {
    schemaVersion: PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION,
    generation,
    head: COORDINATOR_HEAD,
    utteranceId,
    detectorContext: {
      speechKind: "question",
      examinationLeg: "direct",
      permittedGrounds: ["leading"],
      recentQuestionTexts: [],
      evidenceFoundationMissing: false,
      topicRelation: "unknown",
      privilegeContext: "unknown",
      thirdPartyStatementPurpose: "unknown",
      thirdPartyStatementException: "unknown",
      argumentativeContext: "unknown",
      personalKnowledgeContext: "unknown",
    },
  };
}

function fixtureDetector(
  input: PartialObjectionDetectorInput,
): PartialObjectionCandidate | null {
  if (input.partialText !== "candidate") return null;
  return {
    schemaVersion: PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION,
    ground: "leading",
    signal: "leading_tag_or_assumption",
    partialText: input.partialText,
    normalizedText: input.partialText,
    sttConfidence: input.sttConfidence ?? 1,
  };
}

async function createCoordinatorOrderingFixture() {
  const reaction = deferred<void>();
  const order: string[] = [];
  const coordinator = new PartialObjectionCoordinator<string>({
    detectCandidate: fixtureDetector,
    modelDispatch: "after_final_seal",
    onCachedReaction: async () => {
      order.push("cached_reaction_started");
      await reaction.promise;
      order.push("cached_reaction_completed");
    },
    requestModelCandidate: async () => {
      order.push("model_requested");
      return "fixture-result";
    },
    onModelResult: () => {
      order.push("model_result_delivered");
    },
    onError: () => undefined,
  });
  coordinator.openUtterance(coordinatorOpen(1, "utterance_eval_ordering"));
  coordinator.acceptPartial({
    generation: 1,
    head: COORDINATOR_HEAD,
    utteranceId: "utterance_eval_ordering",
    revision: 1,
    text: "candidate",
    confidence: 1,
  });
  const sealed = coordinator.sealFinalCandidate({
    generation: 1,
    head: COORDINATOR_HEAD,
    utteranceId: "utterance_eval_ordering",
    revision: 2,
  });
  order.push("final_sealed");
  reaction.resolve();
  await coordinator.waitForIdle();
  return { order, sealed, metrics: coordinator.getMetrics() };
}

async function createStaleSuppressionFixture() {
  const requests: Array<Readonly<{ signal: AbortSignal; result: Deferred<string> }>> = [];
  const delivered: string[] = [];
  const coordinator = new PartialObjectionCoordinator<string>({
    detectCandidate: fixtureDetector,
    onCachedReaction: () => undefined,
    requestModelCandidate: (_envelope, signal) => {
      const result = deferred<string>();
      requests.push({ signal, result });
      return result.promise;
    },
    onModelResult: (_envelope, result) => {
      delivered.push(result);
    },
    onError: () => undefined,
  });
  const utteranceId = "utterance_eval_stale";
  coordinator.openUtterance(coordinatorOpen(2, utteranceId));
  coordinator.acceptPartial({
    generation: 2,
    head: COORDINATOR_HEAD,
    utteranceId,
    revision: 1,
    text: "candidate",
    confidence: 1,
  });
  const staleRevisionDisposition = coordinator.acceptPartial({
    generation: 2,
    head: COORDINATOR_HEAD,
    utteranceId,
    revision: 1,
    text: "candidate",
    confidence: 1,
  }).disposition;
  coordinator.acceptPartial({
    generation: 2,
    head: COORDINATOR_HEAD,
    utteranceId,
    revision: 2,
    text: "candidate",
    confidence: 1,
  });
  coordinator.finalize({
    generation: 2,
    head: COORDINATOR_HEAD,
    utteranceId,
    revision: 3,
  });
  for (const [index, request] of requests.entries()) {
    request.result.resolve(`late-result-${index + 1}`);
  }
  await coordinator.waitForIdle();
  return {
    staleRevisionDisposition,
    requestCount: requests.length,
    abortedRequestCount: requests.filter((request) => request.signal.aborted).length,
    deliveredResultCount: delivered.length,
    lateAudio: {
      targetStateVersion: 12,
      canonicalStateVersion: 13,
      played: false,
      mutatedCanonicalState: false,
    },
    metrics: coordinator.getMetrics(),
  };
}

/**
 * Builds deterministic, dialogue-free evaluation observations. This function
 * performs no network, browser, microphone, audio-device, model, or durable
 * database work; those remain separate integration and E2E gates.
 */
export async function createMilestone6ObjectionEvalFixture(): Promise<Milestone6ObjectionEvalFixture> {
  const sourceHead = {
    trialId: "trial_00000000000000000000000000000000",
    stateVersion: 11,
    lastEventId: "event_eval_source_head",
  };
  const withdrawal = FinalBoundInterruptionCandidateWithdrawnSchema.parse({
    schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
    disposition: "candidate_withdrawn",
    withdrawalId: "withdrawal_eval_001",
    head: sourceHead,
  });

  const [coordinatorOrdering, staleSuppression] = await Promise.all([
    createCoordinatorOrderingFixture(),
    createStaleSuppressionFixture(),
  ]);
  return {
    candidateWithdrawal: {
      disposition: withdrawal.disposition,
      sourceStateVersion: sourceHead.stateVersion,
      completedStateVersion: withdrawal.head.stateVersion,
      sourceLastEventId: sourceHead.lastEventId,
      completedLastEventId: withdrawal.head.lastEventId,
      durableEventTypes: [],
      neutralCorrectionPlayed: true,
      rulingClipPlayed: false,
    },
    coordinatorOrdering,
    staleSuppression,
    sustained: createSustainedFixture(),
    overruled: createOverruledFixture(),
    strikeGranted: createStrikeFixture("granted"),
    strikeDenied: createStrikeFixture("denied"),
  };
}
