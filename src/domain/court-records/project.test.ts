import { describe, expect, it } from "vitest";

import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DebriefGeneratorModelOutputSchema,
  type CourtroomModelCallTrace,
} from "../courtroom-ai";
import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
  sha256Utf8,
} from "../case-graph";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionV3Schema,
  commitAction,
  createStartTrialAction,
  type ActorRef,
  type ModelMetadata,
  type TrialActionByType,
  type TrialActionType,
  type TrialEvent,
  type TrialStateV3,
} from "../trial-engine";
import {
  actorFromBindings,
  deriveTrialActorBindings,
} from "../hearing-runtime/actors";
import { buildKnowledgeView } from "../knowledge";
import {
  HEARING_AUDIO_AUDIT_AUTHORITY,
  HEARING_AUDIO_AUDIT_SCHEMA_VERSION,
  HEARING_AUDIO_AUDIT_SOURCE,
  HearingAudioAuditRecordSchema,
  type HearingAudioAuditRecord,
} from "../../lib/speech/hearing-audio-audit";
import {
  HEARING_COURTROOM_DIRECTOR_ACTOR_ID,
  HEARING_JUDGE_ACTOR_ID,
  HEARING_OBJECTION_ACTOR_ID,
  hearingPerformanceActorAlias,
  type HearingPerformanceSceneActor,
  type HearingPlaybackPurpose,
} from "../../lib/speech/hearing-performance";
import {
  COURT_RECORDS_INPUT_SCHEMA_VERSION,
  CourtRecordsModelCallSchema,
  CourtRecordsProjectorInputSchema,
  type CourtRecordsProjectorInput,
} from "./schemas";
import {
  adaptCourtRecordsAudioAudits,
  projectCourtRecords,
  projectCourtRecordsTrialSummaries,
} from "./project";

const OWNER_ID = "owner:court-records";
const BASE_TIME = Date.parse("2026-07-20T01:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const PRIVATE_CANARY = "PRIVATE_STRATEGY_CANARY_MUST_NOT_LEAVE_SERVER";

function createHarness(
  suffix: string,
  graphInput: unknown = createThreeWitnessCaseGraphV1Fixture(),
) {
  const graph = CaseGraphV1Schema.parse(graphInput);
  const bindings = deriveTrialActorBindings(graph);
  const trialId = `trial:records:${suffix}`;
  const started = commitAction(
    null,
    createStartTrialAction({
      trialId,
      actionId: `action:records:${suffix}:start`,
      requestedAt: new Date(BASE_TIME).toISOString(),
      graph,
      actors: bindings.map((binding) => binding.actor),
      actorBindings: bindings,
      userSide: "user",
    }),
  );
  let state = started.state;
  const events: TrialEvent[] = [started.event];
  let identity = 0;

  function actor(
    predicate: (candidate: ActorRef) => boolean,
    code: string,
  ): ActorRef {
    return actorFromBindings(bindings, predicate, code);
  }

  function commit<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actionActor: ActorRef,
    options: Readonly<{
      source?: "user" | "ai" | "deterministic" | "speech" | "system";
      modelMetadata?: ModelMetadata | null;
      responseId?: string | null;
      interruptId?: string | null;
    }> = {},
  ): TrialEvent {
    identity += 1;
    const payloadRecord = payload as unknown as Record<string, unknown>;
    const action = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId: `action:records:${suffix}:${identity}:${type.toLowerCase()}`,
      trialId,
      expectedStateVersion: state.version,
      actor: actionActor,
      source: options.source ?? "deterministic",
      requestedAt: new Date(BASE_TIME + identity * 1_000).toISOString(),
      causationId: state.eventIds.at(-1) ?? null,
      correlationId: trialId,
      responseId:
        options.responseId !== undefined
          ? options.responseId
          : typeof payloadRecord.responseId === "string"
            ? payloadRecord.responseId
            : null,
      interruptId:
        options.interruptId !== undefined
          ? options.interruptId
          : typeof payloadRecord.interruptId === "string"
            ? payloadRecord.interruptId
            : null,
      modelMetadata: options.modelMetadata ?? null,
      type,
      payload,
    });
    const committed = commitAction(state, action);
    state = committed.state;
    events.push(committed.event);
    return committed.event;
  }

  return {
    graph,
    trialId,
    events,
    actor,
    commit,
    get state(): TrialStateV3 {
      return state;
    },
  };
}

function replaceExactIdentifier(
  value: unknown,
  from: string,
  to: string,
): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) {
    return value.map((child) => replaceExactIdentifier(child, from, to));
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      replaceExactIdentifier(child, from, to),
    ]),
  );
}

function acceptedTrace(input: Readonly<{
  callId: string;
  trialId: string;
  actorId: string;
  actorRole: "witness" | "judge" | "debrief";
  task:
    | "witness_answer"
    | "judge_response"
    | "resolve_objection"
    | "generate_debrief";
  model: "gpt-5.6-luna" | "gpt-5.6-terra";
  expectedStateVersion: number;
  expectedLastEventId: string;
  inputEventIds: string[];
  committedActionId: string;
  committedEventId: string;
  outputHash: string;
  outputSchemaVersion: string;
  promptVersion: string;
  acceptedFactIds?: string[];
  acceptedEvidenceIds?: string[];
  acceptedTestimonyIds?: string[];
  acceptedEventIds?: string[];
  responseId?: string | null;
  providerRequestId?: string;
}>): CourtroomModelCallTrace {
  const acceptedFactIds = input.acceptedFactIds ?? [];
  const acceptedEvidenceIds = input.acceptedEvidenceIds ?? [];
  const acceptedTestimonyIds = input.acceptedTestimonyIds ?? [];
  const acceptedEventIds = input.acceptedEventIds ?? [];
  const acceptedCitationCount =
    acceptedFactIds.length +
    acceptedEvidenceIds.length +
    acceptedTestimonyIds.length +
    acceptedEventIds.length;
  const providerRequestId = input.providerRequestId ?? "request:records:1";
  return {
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: input.callId,
    trialId: input.trialId,
    responseId:
      input.responseId === undefined
        ? input.task === "witness_answer"
          ? "response:records"
          : null
        : input.responseId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    callClass:
      input.task === "generate_debrief"
        ? "debrief_generator"
        : input.task === "resolve_objection"
          ? "objection_resolver"
          : "role_responder",
    task: input.task,
    inputEventIds: input.inputEventIds,
    expectedStateVersion: input.expectedStateVersion,
    expectedLastEventId: input.expectedLastEventId,
    provider: "openai",
    model: input.model,
    providerProtocolVersion: "responses-api.v1",
    promptVersion: input.promptVersion,
    outputSchemaVersion: input.outputSchemaVersion,
    knowledgeScope: {
      knowledgeSchemaVersion: "knowledge-view.v2",
      knowledgeViewHash: HASH_A,
      stateVersion: input.expectedStateVersion,
      factCount: 4,
      evidenceCount: 3,
      testimonyCount: 1,
      priorStatementCount: 1,
      sourceSegmentCount: 2,
      publicRecordEventCount: input.expectedStateVersion,
      currentExchangeCount: 1,
    },
    promptAudit: {
      stablePrefixHash: HASH_B,
      trustedContextHash: HASH_C,
      untrustedInputHash: HASH_D,
      inputCharacterCount: 2_000,
    },
    status: "accepted",
    startedAt: new Date(BASE_TIME + 20_000).toISOString(),
    completedAt: new Date(BASE_TIME + 21_000).toISOString(),
    latencyMs: 1_000,
    firstStructuredDeltaMs: 200,
    firstAcceptedSegmentMs: 400,
    retryCount: 0,
    validationFailureCount: 0,
    estimatedCostUsd: 0.001,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 10,
      cacheWriteTokens: 0,
      reasoningTokens: 5,
    },
    acceptedAttempt: 1,
    acceptedCitations: {
      factIds: acceptedFactIds,
      evidenceIds: acceptedEvidenceIds,
      testimonyIds: acceptedTestimonyIds,
      eventIds: acceptedEventIds,
      sourceSegmentIds: [],
      priorStatementIds: [],
    },
    acceptedCitationCount,
    outputHash: input.outputHash,
    outputCharacterCount: 120,
    committedActionId: input.committedActionId,
    committedEventId: input.committedEventId,
    safeFailureCode: null,
    attempts: [
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 1,
        mode: "initial",
        status: "accepted",
        providerRequestId,
        providerResponseId: "response:records:1",
        startedAt: new Date(BASE_TIME + 20_000).toISOString(),
        completedAt: new Date(BASE_TIME + 21_000).toISOString(),
        latencyMs: 1_000,
        firstStructuredDeltaMs: 200,
        streamEventCount: 5,
        structuredDeltaCount: 2,
        streamedCharacterCount: 120,
        outputHash: input.outputHash,
        proposedCitationCount: acceptedCitationCount,
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          cachedInputTokens: 10,
          cacheWriteTokens: 0,
          reasoningTokens: 5,
        },
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  };
}

function playbackAudioRecord(input: Readonly<{
  actor: string;
  turnId: string | null;
  interruptId?: string | null;
  sceneActor?: HearingPerformanceSceneActor;
  purpose?: HearingPlaybackPurpose;
}>): HearingAudioAuditRecord {
  const identity = {
    eventSchemaVersion: "hearing-performance-event.v1" as const,
    generation: 1,
    playbackFence: 1,
    jobId: "job:records:1",
    responseId: "response:audio:records:1",
    actor: input.actor,
    sequence: 0,
    turnId: input.turnId,
    interruptId: input.interruptId ?? null,
  };
  const recordId = sha256Utf8(
    JSON.stringify({
      schemaVersion: HEARING_AUDIO_AUDIT_SCHEMA_VERSION,
      kind: "playback",
      identity,
      sceneActor: input.sceneActor ?? "witness",
      purpose: input.purpose ?? "testimony",
    }),
  );
  const content = {
    schemaVersion: HEARING_AUDIO_AUDIT_SCHEMA_VERSION,
    recordId,
    observationSource: HEARING_AUDIO_AUDIT_SOURCE,
    authority: HEARING_AUDIO_AUDIT_AUTHORITY,
    observedAtEpochMs: BASE_TIME + 30_000,
    requestedAtEpochMs: BASE_TIME + 30_000,
    startedAtEpochMs: BASE_TIME + 30_020,
    endedAtEpochMs: BASE_TIME + 31_000,
    aggregateDurationMs: 980,
    kind: "playback" as const,
    identity,
    sceneActor: input.sceneActor ?? ("witness" as const),
    purpose: input.purpose ?? ("testimony" as const),
    timingEventCount: 1,
    markCount: 4,
    markKinds: ["word"] as const,
    markCounts: { phrase: 0, word: 4, viseme: 0 },
    scheduledAudioDurationMs: 900,
    timingTruncated: false,
    terminalStatus: "completed" as const,
    terminalReason: "completed" as const,
    terminalTimestampSource: "client_observed" as const,
  };
  return HearingAudioAuditRecordSchema.parse({
    ...content,
    contentHash: sha256Utf8(JSON.stringify(content)),
  });
}

function activeRecordsInput(
  includeJudgeTrace = false,
  includeObjectionTrace = false,
): CourtRecordsProjectorInput {
  const harness = createHarness("active");
  const userCounsel = harness.actor(
    (actor) => actor.role === "user_counsel",
    "USER_COUNSEL_MISSING",
  );
  const opposingCounsel = harness.actor(
    (actor) => actor.role === "opposing_counsel",
    "OPPOSING_COUNSEL_MISSING",
  );
  const judge = harness.actor(
    (actor) => actor.role === "judge",
    "JUDGE_MISSING",
  );
  const system = harness.actor(
    (actor) => actor.role === "system",
    "SYSTEM_MISSING",
  );
  const witness = harness.actor(
    (actor) => actor.witnessId === "witness_rina_shah",
    "WITNESS_MISSING",
  );
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, judge);
  harness.commit(
    "UPDATE_OPPOSING_STRATEGY",
    {
      strategyId: "strategy:private:records",
      revision: 1,
      objectives: [PRIVATE_CANARY],
      witnessPriorityIds: ["witness_rina_shah"],
      evidencePriorityIds: ["evidence_complaint_email"],
      settlementPosture: "avoid",
      privateNotes: [PRIVATE_CANARY],
      pendingDirectiveJson: `private:${PRIVATE_CANARY}`,
    },
    opposingCounsel,
  );
  harness.commit(
    "CALL_WITNESS",
    { witnessId: "witness_rina_shah", calledBySide: "user" },
    userCounsel,
  );
  harness.commit("SWEAR_WITNESS", { witnessId: "witness_rina_shah" }, judge);
  if (includeObjectionTrace) {
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question:records:prior",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "Did you raise the concern before that morning?",
        turnId: "turn:records:prior-question",
        presentedEvidenceIds: [],
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response:records:prior",
        actorId: witness.actorId,
        purpose: "answer:records:prior",
      },
      system,
    );
    harness.commit(
      "ANSWER_QUESTION",
      {
        responseId: "response:records:prior",
        questionId: "question:records:prior",
        witnessId: "witness_rina_shah",
        testimonyId: "testimony:records:prior",
        turnId: "turn:records:prior-answer",
        text: "Yes, I raised it earlier.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      witness,
    );
  }
  const question = harness.commit(
    "ASK_QUESTION",
    {
      questionId: "question:records",
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
      text: "When did you send the complaint?",
      turnId: "turn:records:question",
      presentedEvidenceIds: ["evidence_complaint_email"],
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    },
    userCounsel,
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId: "response:records",
      actorId: witness.actorId,
      purpose: "answer:records",
    },
    system,
  );
  const objection = harness.commit(
    "OBJECT",
    {
      objectionId: "objection:records",
      questionId: "question:records",
      ground: "leading",
      interruptedResponseId: "response:records",
    },
    opposingCounsel,
  );
  const interruption = harness.commit(
    "BEGIN_INTERRUPTION",
    {
      interruptId: "interrupt:records",
      interruptedResponseId: "response:records",
      objectionId: "objection:records",
    },
    opposingCounsel,
  );
  const objectionSourceState = harness.state;
  const objectionRuling = harness.commit(
    "RULE_ON_OBJECTION",
    {
      objectionId: "objection:records",
      ruling: "overruled",
      remedy: "resume_response",
      reason: "The question may proceed in this fictional simulation.",
    },
    judge,
    includeObjectionTrace
      ? {
          source: "ai",
          responseId: "response:records",
          interruptId: "interrupt:records",
          modelMetadata: {
            model: "gpt-5.6-luna",
            requestId: "request:records:objection",
            promptVersion: "objection-resolver.ruling.prompt.v1",
            schemaVersion: "objection-resolver.ruling.output.v1",
            latencyMs: 1_000,
            inputTokens: 100,
            outputTokens: 20,
            estimatedCostUsd: 0.001,
            retryCount: 0,
            validationFailureCount: 0,
          },
        }
      : undefined,
  );
  harness.commit(
    "RESOLVE_INTERRUPTION",
    { interruptId: "interrupt:records", outcome: "resume" },
    judge,
  );
  harness.commit(
    "RESUME_INTERRUPTED_SPEECH",
    {
      interruptId: "interrupt:records",
      interruptedResponseId: "response:records",
    },
    system,
  );
  const expectedHead = harness.state.eventIds.at(-1);
  if (expectedHead === undefined) throw new Error("Expected a response head");
  const expectedStateVersion = harness.state.version;
  const sourceState = harness.state;
  const answer = harness.commit(
    "ANSWER_QUESTION",
    {
      responseId: "response:records",
      questionId: "question:records",
      witnessId: "witness_rina_shah",
      testimonyId: "testimony:records",
      turnId: "turn:records:answer",
      text: "I sent it at 10:14 that morning.",
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    },
    witness,
    {
      source: "ai",
      modelMetadata: {
        model: "gpt-5.6-luna",
        requestId: "request:records:witness",
        promptVersion: "role-responder.witness.v1",
        schemaVersion: "role-responder.witness-answer.output.v1",
        latencyMs: 1_000,
        inputTokens: 100,
        outputTokens: 20,
        estimatedCostUsd: 0.001,
        retryCount: 0,
        validationFailureCount: 0,
      },
    },
  );
  const trace = acceptedTrace({
    callId: "call:records:witness",
    trialId: harness.trialId,
    actorId: witness.actorId,
    actorRole: "witness",
    task: "witness_answer",
    model: "gpt-5.6-luna",
    expectedStateVersion,
    expectedLastEventId: expectedHead,
    inputEventIds: [...new Set([question.eventId, expectedHead])].sort(
      (left, right) => left.localeCompare(right),
    ),
    committedActionId: answer.actionId,
    committedEventId: answer.eventId,
    outputHash: HASH_A,
    outputSchemaVersion: "role-responder.witness-answer.output.v1",
    promptVersion: "role-responder.witness.v1",
    acceptedFactIds: ["fact_complaint_sent"],
    acceptedEvidenceIds: ["evidence_complaint_email"],
    providerRequestId: "request:records:witness",
  });
  const witnessView = buildKnowledgeView(
    { caseGraph: harness.graph, trial: sourceState },
    witness.actorId,
  );
  if (witnessView.actorRole !== "witness") {
    throw new Error("Expected witness knowledge fixture");
  }
  trace.knowledgeScope = {
    knowledgeSchemaVersion: witnessView.schemaVersion,
    knowledgeViewHash: sha256Utf8(JSON.stringify(witnessView)),
    stateVersion: witnessView.stateVersion,
    factCount: witnessView.witness.facts.length,
    evidenceCount: new Set([
      ...witnessView.witness.admittedSeenEvidence.map(
        (evidence) => evidence.evidenceId,
      ),
      ...witnessView.presentedEvidence.map((evidence) => evidence.evidenceId),
    ]).size,
    testimonyCount: witnessView.publicRecord.testimony.length,
    priorStatementCount: witnessView.witness.priorStatements.length,
    sourceSegmentCount: new Set([
      ...witnessView.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
      ...witnessView.publicRecord.evidence.flatMap(
        (evidence) => evidence.sourceSegmentIds,
      ),
    ]).size,
    publicRecordEventCount: new Set(
      witnessView.publicRecord.testimony.map(
        (testimony) => testimony.transcriptEventId,
      ),
    ).size,
    currentExchangeCount: witnessView.currentExchange === null ? 0 : 1,
  };
  const modelCalls: CourtRecordsProjectorInput["modelCalls"] = [
    { ownerId: OWNER_ID, trace },
  ];
  const citationResources: CourtRecordsProjectorInput["citationResources"] = [
    {
      ownerId: OWNER_ID,
      trialId: harness.trialId,
      resourceId: "fact_complaint_sent",
      kind: "unadmitted_fact",
      scope: "owner_record",
    },
    {
      ownerId: OWNER_ID,
      trialId: harness.trialId,
      resourceId: "evidence_complaint_email",
      kind: "unadmitted_evidence",
      scope: "owner_record",
    },
    {
      ownerId: OWNER_ID,
      trialId: harness.trialId,
      resourceId: "turn:records:question",
      kind: "transcript_turn",
      scope: "owner_record",
    },
  ];
  if (includeObjectionTrace) {
    const objectionView = buildKnowledgeView(
      {
        caseGraph: harness.graph,
        trial: objectionSourceState,
        currentExchangeTurnId: "turn:records:question",
      },
      judge.actorId,
    );
    if (objectionView.actorRole !== "judge") {
      throw new Error("Expected objection judge knowledge fixture");
    }
    const objectionTrace = acceptedTrace({
      callId: "call:records:objection",
      trialId: harness.trialId,
      actorId: judge.actorId,
      actorRole: "judge",
      task: "resolve_objection",
      model: "gpt-5.6-luna",
      expectedStateVersion: objectionSourceState.version,
      expectedLastEventId: interruption.eventId,
      inputEventIds: [
        question.eventId,
        objection.eventId,
        interruption.eventId,
      ].sort((left, right) => left.localeCompare(right)),
      committedActionId: objectionRuling.actionId,
      committedEventId: objectionRuling.eventId,
      outputHash: HASH_C,
      outputSchemaVersion: "objection-resolver.ruling.output.v1",
      promptVersion: "objection-resolver.ruling.prompt.v1",
      acceptedEventIds: [question.eventId],
      responseId: "response:records",
      providerRequestId: "request:records:objection",
    });
    const objectionSourceSegmentIds = [
      ...objectionView.publicRecord.facts.flatMap(
        (fact) => fact.sourceSegmentIds,
      ),
      ...objectionView.publicRecord.evidence.flatMap(
        (evidence) => evidence.sourceSegmentIds,
      ),
    ];
    objectionTrace.knowledgeScope = {
      knowledgeSchemaVersion: objectionView.schemaVersion,
      knowledgeViewHash: sha256Utf8(JSON.stringify(objectionView)),
      stateVersion: objectionView.stateVersion,
      factCount: objectionView.publicRecord.facts.length,
      evidenceCount: objectionView.publicRecord.evidence.length,
      testimonyCount: objectionView.publicRecord.testimony.length,
      priorStatementCount: 0,
      sourceSegmentCount: new Set(objectionSourceSegmentIds).size,
      publicRecordEventCount: new Set(
        objectionView.publicRecord.testimony.map(
          (testimony) => testimony.transcriptEventId,
        ),
      ).size,
      currentExchangeCount: objectionView.currentExchange === null ? 0 : 1,
    };
    modelCalls.push({ ownerId: OWNER_ID, trace: objectionTrace });
    citationResources.push({
      ownerId: OWNER_ID,
      trialId: harness.trialId,
      resourceId: question.eventId,
      kind: "event",
      scope: "owner_record",
    });
  }
  if (includeJudgeTrace) {
    harness.commit(
      "OFFER_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        offeredBySide: "user",
        foundationTestimonyIds: ["testimony:records"],
      },
      userCounsel,
    );
    harness.commit(
      "RULE_ON_EVIDENCE",
      {
        evidenceId: "evidence_complaint_email",
        ruling: "admitted",
        reason: "The fictional exhibit has a sufficient foundation.",
      },
      judge,
    );
    const strikeCitations = {
      factIds: [],
      evidenceIds: [],
      testimonyIds: ["testimony:records"],
      eventIds: [],
      sourceSegmentIds: [],
    };
    const motion = harness.commit(
      "MOVE_TO_STRIKE",
      {
        motionId: "motion:records:judge",
        testimonyIds: ["testimony:records"],
        reason: "The answer should be stricken for this educational motion.",
        speech: {
          turnId: "turn:records:strike-motion",
          text: "Move to strike the answer.",
          citations: strikeCitations,
        },
      },
      opposingCounsel,
    );
    const judgeSourceState = harness.state;
    const rawJudgeView = buildKnowledgeView(
      {
        caseGraph: harness.graph,
        trial: judgeSourceState,
        currentExchangeTurnId: "turn:records:strike-motion",
      },
      judge.actorId,
    );
    if (rawJudgeView.actorRole !== "judge") {
      throw new Error("Expected judge knowledge fixture");
    }
    const rawSourceSegmentIds = [
      ...rawJudgeView.publicRecord.facts.flatMap(
        (fact) => fact.sourceSegmentIds,
      ),
      ...rawJudgeView.publicRecord.evidence.flatMap(
        (evidence) => evidence.sourceSegmentIds,
      ),
    ];
    if (rawSourceSegmentIds.length === 0) {
      throw new Error("Expected judge provenance to redact");
    }
    const judgeView = {
      ...rawJudgeView,
      publicRecord: {
        ...rawJudgeView.publicRecord,
        facts: rawJudgeView.publicRecord.facts.map((fact) => ({
          ...fact,
          sourceSegmentIds: [],
        })),
        evidence: rawJudgeView.publicRecord.evidence.map((evidence) => ({
          ...evidence,
          sourceSegmentIds: [],
        })),
      },
    };
    const ruling = harness.commit(
      "DENY_STRIKE_MOTION",
      {
        motionId: "motion:records:judge",
        reason: "The testimony remains part of the fictional record.",
        speech: {
          turnId: "turn:records:strike-ruling",
          text: "Denied. The testimony remains in the record.",
          citations: strikeCitations,
        },
      },
      judge,
      {
        source: "ai",
        modelMetadata: {
          model: "gpt-5.6-luna",
          requestId: "request:records:judge",
          promptVersion: "role-responder.judge.prompt.v1",
          schemaVersion: "role-responder.judge.output.v1",
          latencyMs: 1_000,
          inputTokens: 100,
          outputTokens: 20,
          estimatedCostUsd: 0.001,
          retryCount: 0,
          validationFailureCount: 0,
        },
      },
    );
    const judgeTrace = acceptedTrace({
      callId: "call:records:judge",
      trialId: harness.trialId,
      actorId: judge.actorId,
      actorRole: "judge",
      task: "judge_response",
      model: "gpt-5.6-luna",
      expectedStateVersion: judgeSourceState.version,
      expectedLastEventId: motion.eventId,
      inputEventIds: [motion.eventId],
      committedActionId: ruling.actionId,
      committedEventId: ruling.eventId,
      outputHash: HASH_B,
      outputSchemaVersion: "role-responder.judge.output.v1",
      promptVersion: "role-responder.judge.prompt.v1",
      acceptedTestimonyIds: ["testimony:records"],
      providerRequestId: "request:records:judge",
    });
    judgeTrace.knowledgeScope = {
      knowledgeSchemaVersion: judgeView.schemaVersion,
      knowledgeViewHash: sha256Utf8(JSON.stringify(judgeView)),
      stateVersion: judgeView.stateVersion,
      factCount: judgeView.publicRecord.facts.length,
      evidenceCount: judgeView.publicRecord.evidence.length,
      testimonyCount: judgeView.publicRecord.testimony.length,
      priorStatementCount: 0,
      sourceSegmentCount: 0,
      publicRecordEventCount: new Set(
        judgeView.publicRecord.testimony.map(
          (testimony) => testimony.transcriptEventId,
        ),
      ).size,
      currentExchangeCount: judgeView.currentExchange === null ? 0 : 1,
    };
    modelCalls.push({ ownerId: OWNER_ID, trace: judgeTrace });
    const evidenceResource = citationResources.find(
      (resource) => resource.resourceId === "evidence_complaint_email",
    );
    if (evidenceResource === undefined) {
      throw new Error("Expected evidence resource");
    }
    evidenceResource.kind = "admitted_evidence";
    citationResources.push({
      ownerId: OWNER_ID,
      trialId: harness.trialId,
      resourceId: "testimony:records",
      kind: "active_testimony",
      scope: "owner_record",
    });
  }
  return CourtRecordsProjectorInputSchema.parse({
    schemaVersion: COURT_RECORDS_INPUT_SCHEMA_VERSION,
    ownerId: OWNER_ID,
    caseGraph: harness.graph,
    trialState: harness.state,
    events: harness.events,
    modelCalls,
    citationResources,
    finalDebriefArtifact: null,
    audioAudits: [
      {
        ownerId: OWNER_ID,
        trialId: harness.trialId,
        record: playbackAudioRecord({
          actor: hearingPerformanceActorAlias(witness),
          turnId: "turn:records:answer",
        }),
      },
    ],
  });
}

function emptyDebrief() {
  const citations = {
    admittedFactIds: [],
    admittedEvidenceIds: [],
    activeTestimonyIds: [],
    transcriptTurnIds: [],
    unadmittedFactIds: ["fact_complaint_sent"],
    unadmittedEvidenceIds: [],
    excludedFactIds: [],
    excludedEvidenceIds: [],
    strickenTestimonyIds: [],
    hiddenFactIds: [],
    hiddenSourceSegmentIds: [],
    coachingInferenceIds: [],
  };
  return DebriefGeneratorModelOutputSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    overallAssessment: {
      text: "The early settlement occurred while a material assertion remained unadmitted.",
      basis: "unadmitted_record",
      citations,
    },
    strengths: [
      {
        title: "Efficient resolution",
        assessment: "The offer was evaluated against an explicitly unadmitted record.",
        recommendation: "Keep distinguishing unadmitted assertions from admitted proof.",
        basis: "unadmitted_record",
        citations,
      },
    ],
    weakQuestions: [],
    missedEvidence: [],
    contradictions: [],
    objectionAccuracy: [],
    witnessStrategy: [],
    settlementChoices: [],
    juryMovement: [],
    improvedClosing: { segments: [] },
    limitations: ["Fictional educational simulation; not legal advice."],
  });
}

function transcriptOrderDebrief() {
  const admittedCitations = {
    admittedFactIds: [],
    admittedEvidenceIds: [],
    activeTestimonyIds: ["testimony:debrief:answer"],
    transcriptTurnIds: ["turn:z:debrief-question", "turn:a:debrief-answer"],
    unadmittedFactIds: [],
    unadmittedEvidenceIds: [],
    excludedFactIds: [],
    excludedEvidenceIds: [],
    strickenTestimonyIds: [],
    hiddenFactIds: [],
    hiddenSourceSegmentIds: [],
    coachingInferenceIds: [],
  };
  return DebriefGeneratorModelOutputSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    overallAssessment: {
      text: "The active testimony supplies admitted support for the coaching review.",
      basis: "admitted_record",
      citations: admittedCitations,
    },
    strengths: [
      {
        title: "Grounded examination",
        assessment: "The active question and answer remain in the admitted record.",
        recommendation: "Keep the closing tied to active testimony.",
        basis: "admitted_record",
        citations: admittedCitations,
      },
    ],
    weakQuestions: [],
    missedEvidence: [],
    contradictions: [],
    objectionAccuracy: [],
    witnessStrategy: [],
    settlementChoices: [],
    juryMovement: [],
    improvedClosing: {
      segments: [
        {
          text: "The active testimony supports the requested fictional result.",
          citations: {
            ...admittedCitations,
            transcriptTurnIds: [],
          },
        },
      ],
    },
    limitations: ["Fictional educational simulation; not legal advice."],
  });
}

function completedDebriefInput(
  includeNonLexicalTranscript = false,
): CourtRecordsProjectorInput {
  const harness = createHarness("debrief");
  const userCounsel = harness.actor(
    (actor) => actor.role === "user_counsel",
    "USER_COUNSEL_MISSING",
  );
  const opposingCounsel = harness.actor(
    (actor) => actor.role === "opposing_counsel",
    "OPPOSING_COUNSEL_MISSING",
  );
  const debriefCoach = harness.actor(
    (actor) => actor.role === "debrief_coach",
    "DEBRIEF_COACH_MISSING",
  );
  if (includeNonLexicalTranscript) {
    const judge = harness.actor(
      (actor) => actor.role === "judge",
      "JUDGE_MISSING",
    );
    const system = harness.actor(
      (actor) => actor.role === "system",
      "SYSTEM_MISSING",
    );
    const witness = harness.actor(
      (actor) => actor.witnessId === "witness_rina_shah",
      "WITNESS_MISSING",
    );
    harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, judge);
    harness.commit(
      "CALL_WITNESS",
      { witnessId: "witness_rina_shah", calledBySide: "user" },
      userCounsel,
    );
    harness.commit(
      "SWEAR_WITNESS",
      { witnessId: "witness_rina_shah" },
      judge,
    );
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question:debrief:order",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "When did you send the complaint?",
        turnId: "turn:z:debrief-question",
        presentedEvidenceIds: [],
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      userCounsel,
    );
    harness.commit(
      "REQUEST_RESPONSE",
      {
        responseId: "response:debrief:order",
        actorId: witness.actorId,
        purpose: "answer:debrief:order",
      },
      system,
    );
    harness.commit(
      "ANSWER_QUESTION",
      {
        responseId: "response:debrief:order",
        questionId: "question:debrief:order",
        witnessId: "witness_rina_shah",
        testimonyId: "testimony:debrief:answer",
        turnId: "turn:a:debrief-answer",
        text: "I sent it that morning.",
        factIds: ["fact_complaint_sent"],
        evidenceIds: [],
      },
      witness,
    );
  }
  harness.commit(
    "PROPOSE_SETTLEMENT",
    {
      offerId: "offer:records:accepted",
      parentOfferId: null,
      proposedByPartyId: "party_rina_shah",
      recipientPartyIds: ["party_redwood_signal"],
      terms: {
        amount: 85_000,
        currency: "USD",
        nonMonetaryTerms: ["Neutral reference"],
        summary: "Resolve the fictional matter.",
      },
      expiresAtSequence:
        harness.state.lastSequence +
        1 +
        harness.state.policySnapshot.settlement.expiresAfterEventCount,
    },
    userCounsel,
  );
  harness.commit(
    "ACCEPT_SETTLEMENT",
    { offerId: "offer:records:accepted" },
    opposingCounsel,
  );
  const sourceStateVersion = harness.state.version;
  const sourceLastEventId = harness.state.eventIds.at(-1);
  const sourceState = harness.state;
  if (sourceLastEventId === undefined) throw new Error("Expected source head");
  const output = includeNonLexicalTranscript
    ? transcriptOrderDebrief()
    : emptyDebrief();
  const outputHash = sha256Utf8(JSON.stringify(output));
  const promptVersion = "debrief-generator.prompt.v1";
  const modelMetadata: ModelMetadata = {
    model: "gpt-5.6-terra",
    requestId: "request:debrief:records",
    promptVersion,
    schemaVersion: output.schemaVersion,
    latencyMs: 1_000,
    inputTokens: 100,
    outputTokens: 20,
    estimatedCostUsd: 0.001,
    retryCount: 0,
    validationFailureCount: 0,
  };
  const event = harness.commit(
    "GENERATE_DEBRIEF",
    { debriefId: "debrief:records:final" },
    debriefCoach,
    { source: "ai", modelMetadata },
  );
  const callId = "call:records:debrief";
  const trace = acceptedTrace({
    callId,
    trialId: harness.trialId,
    actorId: debriefCoach.actorId,
    actorRole: "debrief",
    task: "generate_debrief",
    model: "gpt-5.6-terra",
    expectedStateVersion: sourceStateVersion,
    expectedLastEventId: sourceLastEventId,
    inputEventIds: [sourceLastEventId],
    committedActionId: event.actionId,
    committedEventId: event.eventId,
    outputHash,
    outputSchemaVersion: output.schemaVersion,
    promptVersion,
    acceptedFactIds: includeNonLexicalTranscript
      ? []
      : ["fact_complaint_sent"],
    acceptedTestimonyIds: includeNonLexicalTranscript
      ? ["testimony:debrief:answer"]
      : [],
    acceptedEventIds: includeNonLexicalTranscript
      ? ["turn:z:debrief-question", "turn:a:debrief-answer"]
          .map((turnId) => {
            const turn = sourceState.transcriptTurns[turnId];
            if (turn === undefined) throw new Error("Missing transcript fixture");
            return turn.sourceEventId;
          })
          .sort((left, right) => left.localeCompare(right))
      : [],
    providerRequestId: "request:debrief:records",
  });
  const knowledgeView = buildKnowledgeView(
    { caseGraph: harness.graph, trial: sourceState },
    debriefCoach.actorId,
  );
  if (knowledgeView.actorRole !== "debrief") {
    throw new Error("Expected debrief knowledge fixture");
  }
  const { strata } = knowledgeView;
  const admitted = strata.admittedRecord.record;
  const distinctCount = (...lists: readonly string[][]) =>
    new Set(lists.flat()).size;
  const proceduralEventIds = new Set([
    ...sourceState.transcriptTurnIds.map(
      (turnId) => sourceState.transcriptTurns[turnId].sourceEventId,
    ),
    ...Object.values(sourceState.objections).flatMap((objection) => [
      objection.sourceEventId,
      ...(objection.rulingEventId === null ? [] : [objection.rulingEventId]),
    ]),
    ...Object.values(sourceState.settlementOffers).flatMap((offer) => [
      offer.sourceEventId,
      offer.lastEventId,
    ]),
  ]);
  trace.knowledgeScope = {
    knowledgeSchemaVersion: knowledgeView.schemaVersion,
    knowledgeViewHash: sha256Utf8(JSON.stringify(knowledgeView)),
    stateVersion: knowledgeView.stateVersion,
    factCount: distinctCount(
      admitted.facts.map(({ factId }) => factId),
      strata.unadmittedRecord.facts.map(({ factId }) => factId),
      strata.excludedOrStricken.facts.map(({ factId }) => factId),
      strata.hiddenAuthoringTruth.facts.map(({ factId }) => factId),
    ),
    evidenceCount: distinctCount(
      admitted.evidence.map(({ evidenceId }) => evidenceId),
      strata.unadmittedRecord.evidence.map(({ evidenceId }) => evidenceId),
      strata.excludedOrStricken.evidence.map(({ evidenceId }) => evidenceId),
    ),
    testimonyCount: distinctCount(
      admitted.testimony.map(({ testimonyId }) => testimonyId),
      strata.excludedOrStricken.testimony.map(({ testimonyId }) => testimonyId),
    ),
    priorStatementCount: 0,
    sourceSegmentCount: new Set([
      ...admitted.facts.flatMap((fact) => fact.sourceSegmentIds),
      ...admitted.evidence.flatMap((evidence) => evidence.sourceSegmentIds),
      ...strata.hiddenAuthoringTruth.facts.flatMap(
        (fact) => fact.sourceSegmentIds,
      ),
    ]).size,
    publicRecordEventCount: proceduralEventIds.size,
    currentExchangeCount: 0,
  };
  return CourtRecordsProjectorInputSchema.parse({
    schemaVersion: COURT_RECORDS_INPUT_SCHEMA_VERSION,
    ownerId: OWNER_ID,
    caseGraph: harness.graph,
    trialState: harness.state,
    events: harness.events,
    modelCalls: [{ ownerId: OWNER_ID, trace }],
    citationResources: includeNonLexicalTranscript
      ? [
          {
            ownerId: OWNER_ID,
            trialId: harness.trialId,
            resourceId: "testimony:debrief:answer",
            kind: "active_testimony",
            scope: "owner_record",
          },
          {
            ownerId: OWNER_ID,
            trialId: harness.trialId,
            resourceId: "fact_complaint_sent",
            kind: "unadmitted_fact",
            scope: "owner_record",
          },
          ...["turn:z:debrief-question", "turn:a:debrief-answer"].map(
            (resourceId) => ({
              ownerId: OWNER_ID,
              trialId: harness.trialId,
              resourceId,
              kind: "transcript_turn" as const,
              scope: "owner_record" as const,
            }),
          ),
          ...["turn:z:debrief-question", "turn:a:debrief-answer"].map(
            (turnId) => {
              const turn = sourceState.transcriptTurns[turnId];
              if (turn === undefined) {
                throw new Error("Missing transcript resource fixture");
              }
              return {
                ownerId: OWNER_ID,
                trialId: harness.trialId,
                resourceId: turn.sourceEventId,
                kind: "event" as const,
                scope: "owner_record" as const,
              };
            },
          ),
        ]
      : [
          {
            ownerId: OWNER_ID,
            trialId: harness.trialId,
            resourceId: "fact_complaint_sent",
            kind: "unadmitted_fact",
            scope: "owner_record",
          },
        ],
    finalDebriefArtifact: {
      artifactId: "debrief:records:final",
      artifactKind: "final_debrief",
      ownerId: OWNER_ID,
      trialId: harness.trialId,
      callId,
      decisionId: null,
      actionId: event.actionId,
      eventId: event.eventId,
      sourceStateVersion,
      sourceLastEventId,
      committedStateVersion: event.stateVersion,
      artifactJson: JSON.stringify(output),
      artifactHash: outputHash,
      artifactSchemaVersion: output.schemaVersion,
      promptVersion,
      model: "gpt-5.6-terra",
      createdAt: BASE_TIME + 21_000,
    },
    audioAudits: [],
  });
}

describe("Court Records privacy-safe projection", () => {
  it("projects payload-free records and filters every public citation allowlist", () => {
    const input = activeRecordsInput();
    const view = projectCourtRecords(input);
    const serialized = JSON.stringify(view);

    expect(view.eventTree.nodes.map((node) => node.type)).toContain(
      "UPDATE_OPPOSING_STRATEGY",
    );
    expect(view.procedure.objections).toMatchObject([
      { objectionId: "objection:records", status: "overruled" },
    ]);
    expect(view.procedure.interruptions).toMatchObject([
      { interruptId: "interrupt:records", status: "resumed" },
    ]);
    expect(view.transcript).toHaveLength(2);
    expect(view.transcript[0].citations).toMatchObject({
      factIds: ["fact_complaint_sent"],
      evidenceIds: ["evidence_complaint_email"],
    });
    expect(view.modelCalls[0]).toMatchObject({
      provider: "openai",
      providerProtocolVersion: "responses-api.v1",
      retryCount: 0,
      validationFailureCount: 0,
      knowledgeScope: {
        integrity: "verified",
        factCount: input.modelCalls[0].trace.knowledgeScope.factCount,
      },
      acceptedCitationCount: 2,
      visibleCitationCount: 2,
      restrictedCitationCount: 0,
      acceptedCitations: {
        factIds: ["fact_complaint_sent"],
        evidenceIds: ["evidence_complaint_email"],
      },
    });
    expect(view.audio.entries[0]).toMatchObject({
      record: {
        observationSource: "client_observed",
        authority: "noncanonical",
        kind: "playback",
        purpose: "testimony",
        aggregateDurationMs: 980,
      },
      canonicalBinding: {
        status: "transcript_turn_verified",
        turnId: "turn:records:answer",
      },
      rawAudioRetained: false,
    });
    expect(view.replayIntegrity.status).toBe("verified");
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.eventTree.nodes)).toBe(true);
    expect(serialized).not.toContain(PRIVATE_CANARY);
    expect(serialized).not.toContain("privateNotes");
    expect(serialized).not.toContain("pendingDirectiveJson");
    expect(serialized).not.toContain("promptAudit");
    expect(serialized).not.toContain("payload");
    expect(view.citationResources.map((resource) => resource.resourceId)).not.toContain(
      "turn:records:question",
    );
    expect(
      view.citationResources.find(
        (resource) => resource.resourceId === "fact_complaint_sent",
      )?.title,
    ).toBe(input.trialState.facts.fact_complaint_sent?.proposition);
    expect(serialized).not.toContain("eventStreamHash");
    expect(serialized).not.toContain("replayedStateHash");
    expect(serialized).not.toContain(
      input.modelCalls[0].trace.knowledgeScope.knowledgeViewHash,
    );
    expect(view.replayIntegrity.privacySafeProjectionHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("derives display titles and rejects caller-supplied title text", () => {
    const input = activeRecordsInput();
    const injected = {
      ...input,
      citationResources: input.citationResources.map((resource, index) =>
        index === 0 ? { ...resource, title: PRIVATE_CANARY } : resource,
      ),
    };

    expect(CourtRecordsProjectorInputSchema.safeParse(injected).success).toBe(
      false,
    );
    expect(JSON.stringify(projectCourtRecords(input))).not.toContain(
      PRIVATE_CANARY,
    );
  });

  it("keeps fact and evidence resources distinct when their IDs collide", () => {
    const collisionId = "fact_complaint_sent";
    const graph = CaseGraphV1Schema.parse(
      replaceExactIdentifier(
        createThreeWitnessCaseGraphV1Fixture(),
        "evidence_complaint_email",
        collisionId,
      ),
    );
    const harness = createHarness("resource-collision", graph);
    const userCounsel = harness.actor(
      (actor) => actor.role === "user_counsel",
      "USER_COUNSEL_MISSING",
    );
    const judge = harness.actor(
      (actor) => actor.role === "judge",
      "JUDGE_MISSING",
    );
    harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, judge);
    harness.commit(
      "CALL_WITNESS",
      { witnessId: "witness_rina_shah", calledBySide: "user" },
      userCounsel,
    );
    harness.commit(
      "SWEAR_WITNESS",
      { witnessId: "witness_rina_shah" },
      judge,
    );
    harness.commit(
      "ASK_QUESTION",
      {
        questionId: "question:records:collision",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "When did you send the complaint?",
        turnId: "turn:records:collision",
        presentedEvidenceIds: [collisionId],
        factIds: [collisionId],
        evidenceIds: [collisionId],
      },
      userCounsel,
    );
    const input = CourtRecordsProjectorInputSchema.parse({
      schemaVersion: COURT_RECORDS_INPUT_SCHEMA_VERSION,
      ownerId: OWNER_ID,
      caseGraph: harness.graph,
      trialState: harness.state,
      events: harness.events,
      modelCalls: [],
      citationResources: [
        {
          ownerId: OWNER_ID,
          trialId: harness.trialId,
          resourceId: collisionId,
          kind: "unadmitted_fact",
          scope: "owner_record",
        },
        {
          ownerId: OWNER_ID,
          trialId: harness.trialId,
          resourceId: collisionId,
          kind: "unadmitted_evidence",
          scope: "owner_record",
        },
      ],
      finalDebriefArtifact: null,
      audioAudits: [],
    });

    const view = projectCourtRecords(input);
    expect(view.transcript.at(-1)?.citations).toMatchObject({
      factIds: [collisionId],
      evidenceIds: [collisionId],
    });
    expect(
      view.citationResources
        .filter((resource) => resource.resourceId === collisionId)
        .map((resource) => resource.kind),
    ).toEqual(["unadmitted_evidence", "unadmitted_fact"]);
  });

  it("keeps full owner-visible lifecycles while suppressing uncited resources", () => {
    const input = structuredClone(activeRecordsInput());
    const hiddenFact = Object.values(input.trialState.facts).find(
      (fact) => fact.status === "hidden",
    );
    if (hiddenFact === undefined) throw new Error("Missing hidden fact fixture");
    input.citationResources.push({
      ownerId: OWNER_ID,
      trialId: input.trialState.trialId,
      resourceId: hiddenFact.factId,
      kind: "hidden_fact",
      scope: "debrief_only",
    });

    const view = projectCourtRecords(input);
    const playerActor = Object.values(input.trialState.actors).find(
      (actor) =>
        (actor.role === "user_counsel" ||
          actor.role === "opposing_counsel") &&
        actor.side === input.trialState.userSide,
    );
    if (playerActor === undefined) throw new Error("Missing player actor");
    const playerView = buildKnowledgeView(
      { caseGraph: input.caseGraph, trial: input.trialState },
      playerActor.actorId,
    );
    if (
      playerView.actorRole !== "user_counsel" &&
      playerView.actorRole !== "opposing_counsel"
    ) {
      throw new Error("Expected counsel view");
    }
    const expectedFactIds = [
      ...new Set([
        ...playerView.counsel.facts.map((fact) => fact.factId),
        ...playerView.publicRecord.facts.map((fact) => fact.factId),
        ...Object.values(input.trialState.transcriptTurns).flatMap(
          (turn) => turn.citations.factIds,
        ),
      ]),
    ].sort();
    const expectedEvidenceIds = [
      ...new Set([
        ...playerView.counsel.evidence.map((evidence) => evidence.evidenceId),
        ...playerView.publicRecord.evidence.map(
          (evidence) => evidence.evidenceId,
        ),
        ...Object.values(input.trialState.evidence).flatMap((evidence) =>
          evidence.offeredBySide === null ? [] : [evidence.evidenceId],
        ),
        ...Object.values(input.trialState.transcriptTurns).flatMap(
          (turn) => turn.citations.evidenceIds,
        ),
      ]),
    ].sort();

    expect(view.lifecycles.facts.map((fact) => fact.factId)).toEqual(
      expectedFactIds,
    );
    expect(view.lifecycles.evidence.map((item) => item.evidenceId)).toEqual(
      expectedEvidenceIds,
    );
    expect(view.lifecycles.facts.map((fact) => fact.factId)).not.toContain(
      hiddenFact.factId,
    );
    expect(view.citationResources.map((resource) => resource.resourceId)).not.toContain(
      "turn:records:question",
    );
  });

  it("does not expose an opposing restricted assertion through lifecycles or resources", () => {
    const input = activeRecordsInput();
    const opposingCounsel = Object.values(input.trialState.actors).find(
      (actor) =>
        (actor.role === "user_counsel" ||
          actor.role === "opposing_counsel") &&
        actor.side !== input.trialState.userSide &&
        actor.side !== "neutral",
    );
    const provenanceId = "testimony:records";
    if (opposingCounsel === undefined || provenanceId === undefined) {
      throw new Error("Missing restricted assertion fixture data");
    }
    const factId = "fact:opposing:restricted:records";
    const proposition = "OPPOSING_RESTRICTED_ASSERTION_MUST_NOT_LEAK";
    const lastEventId = input.trialState.eventIds.at(-1);
    if (lastEventId === undefined) throw new Error("Missing trial head");
    const action = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId: "action:records:restricted-assertion",
      trialId: input.trialState.trialId,
      expectedStateVersion: input.trialState.version,
      actor: opposingCounsel,
      source: "deterministic",
      requestedAt: new Date(BASE_TIME + 40_000).toISOString(),
      causationId: lastEventId,
      correlationId: input.trialState.trialId,
      responseId: null,
      interruptId: null,
      modelMetadata: null,
      type: "PROPOSE_ASSERTION",
      payload: {
        factId,
        proposition,
        provenanceIds: [provenanceId],
        visibility: "restricted",
      },
    });
    const committed = commitAction(input.trialState, action);
    input.trialState = committed.state;
    input.events.push(committed.event);
    expect(() => projectCourtRecords(input)).toThrow(
      "COURT_RECORDS_CITATION_RESOURCE_MISSING",
    );
    input.citationResources.push({
      ownerId: OWNER_ID,
      trialId: input.trialState.trialId,
      resourceId: factId,
      kind: "unadmitted_fact",
      scope: "debrief_only",
    });

    const view = projectCourtRecords(input);
    expect(view.lifecycles.facts.map((fact) => fact.factId)).not.toContain(
      factId,
    );
    expect(JSON.stringify(view)).not.toContain(proposition);

    const laundering = structuredClone(input);
    const restrictedResource = laundering.citationResources.find(
      (resource) =>
        resource.resourceId === factId && resource.kind === "unadmitted_fact",
    );
    if (restrictedResource === undefined) {
      throw new Error("Missing restricted resource fixture");
    }
    restrictedResource.scope = "owner_record";
    expect(() => projectCourtRecords(laundering)).toThrow(
      "COURT_RECORDS_CITATION_RESOURCE_SCOPE_INVALID",
    );
  });

  it("keeps opposing-only unoffered exhibits out of the owner record", () => {
    const input = activeRecordsInput();
    const view = projectCourtRecords(input);
    const serialized = JSON.stringify(view);
    for (const evidenceId of [
      "evidence_draft_metadata",
      "evidence_report_history",
    ]) {
      const authored = input.caseGraph.evidence.find(
        (evidence) => evidence.evidenceId === evidenceId,
      );
      if (authored === undefined) throw new Error("Missing private evidence");
      expect(view.lifecycles.evidence.map((item) => item.evidenceId)).not.toContain(
        evidenceId,
      );
      expect(serialized).not.toContain(authored.name);
    }

    const laundering = activeRecordsInput();
    laundering.citationResources.push({
      ownerId: OWNER_ID,
      trialId: laundering.trialState.trialId,
      resourceId: "evidence_draft_metadata",
      kind: "unadmitted_evidence",
      scope: "owner_record",
    });
    expect(() => projectCourtRecords(laundering)).toThrow(
      "COURT_RECORDS_CITATION_RESOURCE_SCOPE_INVALID",
    );
  });

  it("keeps model-call citation counts self-consistent at the DTO boundary", () => {
    const view = projectCourtRecords(activeRecordsInput());
    const call = view.modelCalls[0];
    if (call === undefined) throw new Error("Missing model call fixture");
    expect(
      CourtRecordsModelCallSchema.safeParse({
        ...call,
        visibleCitationCount: call.visibleCitationCount - 1,
      }).success,
    ).toBe(false);
    expect(
      CourtRecordsModelCallSchema.safeParse({
        ...call,
        acceptedCitationCount: call.acceptedCitationCount + 1,
      }).success,
    ).toBe(false);
  });

  it("rejects foreign, duplicate, and out-of-order canonical event rows", () => {
    const base = activeRecordsInput();
    const foreign = structuredClone(base);
    foreign.events[1].trialId = "trial:foreign";
    expect(() => projectCourtRecords(foreign)).toThrow(
      "COURT_RECORDS_FOREIGN_EVENT",
    );

    const duplicate = structuredClone(base);
    duplicate.events.splice(2, 0, duplicate.events[1]);
    expect(() => projectCourtRecords(duplicate)).toThrow(
      "COURT_RECORDS_EVENT_STREAM_INVALID",
    );

    const outOfOrder = structuredClone(base);
    [outOfOrder.events[1], outOfOrder.events[2]] = [
      outOfOrder.events[2],
      outOfOrder.events[1],
    ];
    expect(() => projectCourtRecords(outOfOrder)).toThrow(
      "COURT_RECORDS_EVENT_STREAM_INVALID",
    );

    const wrongGraph = activeRecordsInput();
    wrongGraph.caseGraph.title = "A different valid graph title";
    expect(() => projectCourtRecords(wrongGraph)).toThrow(
      "COURT_RECORDS_CASE_GRAPH_BINDING_INVALID",
    );

    for (const patchState of [
      { caseId: "case:records:tampered" },
      { caseVersion: 999 },
      { caseGraphHash: "f".repeat(64) },
    ]) {
      const mismatch = activeRecordsInput();
      mismatch.trialState = { ...mismatch.trialState, ...patchState };
      expect(() => projectCourtRecords(mismatch)).toThrow(
        "COURT_RECORDS_CASE_GRAPH_BINDING_INVALID",
      );
    }
  });

  it("rejects foreign owner rows and duplicate redacted records", () => {
    const foreignCall = structuredClone(activeRecordsInput());
    foreignCall.modelCalls[0].ownerId = "owner:foreign";
    expect(() => projectCourtRecords(foreignCall)).toThrow(
      "COURT_RECORDS_FOREIGN_MODEL_CALL",
    );

    const duplicateCall = structuredClone(activeRecordsInput());
    duplicateCall.modelCalls.push(duplicateCall.modelCalls[0]);
    expect(() => projectCourtRecords(duplicateCall)).toThrow(
      "COURT_RECORDS_DUPLICATE_MODEL_CALL",
    );

    const duplicateResource = structuredClone(activeRecordsInput());
    duplicateResource.citationResources.push(
      duplicateResource.citationResources[0],
    );
    expect(() => projectCourtRecords(duplicateResource)).toThrow(
      "COURT_RECORDS_DUPLICATE_CITATION_RESOURCE",
    );

    const foreignAudio = structuredClone(activeRecordsInput());
    foreignAudio.audioAudits[0].trialId = "trial:foreign";
    expect(() => projectCourtRecords(foreignAudio)).toThrow(
      "COURT_RECORDS_FOREIGN_AUDIO_AUDIT",
    );
  });

  it("rejects citation-stratum laundering and model/event binding drift", () => {
    const resource = structuredClone(activeRecordsInput());
    resource.citationResources[0].kind = "admitted_fact";
    expect(() => projectCourtRecords(resource)).toThrow(
      "COURT_RECORDS_CITATION_RESOURCE_BINDING_INVALID",
    );

    const model = structuredClone(activeRecordsInput());
    model.modelCalls[0].trace.promptVersion = "role-responder.witness.tampered";
    expect(() => projectCourtRecords(model)).toThrow(
      "COURT_RECORDS_MODEL_CALL_COMMIT_BINDING_INVALID",
    );

    const priorScope = structuredClone(activeRecordsInput());
    const priorStatementId =
      priorScope.caseGraph.witnesses[0]?.priorStatements[0]?.priorStatementId;
    if (priorStatementId === undefined) throw new Error("Missing prior statement");
    priorScope.citationResources.push({
      ownerId: OWNER_ID,
      trialId: priorScope.trialState.trialId,
      resourceId: priorStatementId,
      kind: "prior_statement",
      scope: "owner_record",
    });
    expect(() => projectCourtRecords(priorScope)).toThrow(
      "COURT_RECORDS_CITATION_RESOURCE_BINDING_INVALID",
    );

    const sourceScope = structuredClone(activeRecordsInput());
    const sourceSegmentId = sourceScope.caseGraph.sourceSegments[0]?.sourceSegmentId;
    if (sourceSegmentId === undefined) throw new Error("Missing source segment");
    sourceScope.citationResources.push({
      ownerId: OWNER_ID,
      trialId: sourceScope.trialState.trialId,
      resourceId: sourceSegmentId,
      kind: "source_segment",
      scope: "owner_record",
    });
    expect(() => projectCourtRecords(sourceScope)).toThrow(
      "COURT_RECORDS_CITATION_RESOURCE_BINDING_INVALID",
    );
  });

  it("binds generic traces to the exact task, input head, KnowledgeView, and resources", () => {
    const task = structuredClone(activeRecordsInput());
    task.modelCalls[0].trace.task = "counsel_response";
    task.modelCalls[0].trace.actorRole = "counsel";
    expect(() => projectCourtRecords(task)).toThrow(
      "COURT_RECORDS_MODEL_CALL_ACTOR_INVALID",
    );

    const inputs = structuredClone(activeRecordsInput());
    inputs.modelCalls[0].trace.inputEventIds = [
      inputs.modelCalls[0].trace.expectedLastEventId ?? "missing",
    ];
    expect(() => projectCourtRecords(inputs)).toThrow(
      "COURT_RECORDS_MODEL_CALL_INPUT_EVENT_INVALID",
    );

    const knowledge = structuredClone(activeRecordsInput());
    knowledge.modelCalls[0].trace.knowledgeScope.factCount += 1;
    expect(() => projectCourtRecords(knowledge)).toThrow(
      "COURT_RECORDS_MODEL_CALL_KNOWLEDGE_INVALID",
    );

    const missingResource = structuredClone(activeRecordsInput());
    missingResource.citationResources = missingResource.citationResources.filter(
      (resource) => resource.resourceId !== "evidence_complaint_email",
    );
    expect(() => projectCourtRecords(missingResource)).toThrow(
      "COURT_RECORDS_MODEL_CALL_CITATION_RESOURCE_INVALID",
    );
  });

  it("requires one accepted trace for every generated event", () => {
    const missing = activeRecordsInput();
    missing.modelCalls = [];
    expect(() => projectCourtRecords(missing)).toThrow(
      "COURT_RECORDS_MODEL_CALL_COVERAGE_INVALID",
    );

    const duplicated = activeRecordsInput();
    duplicated.modelCalls.push({
      ownerId: OWNER_ID,
      trace: {
        ...structuredClone(duplicated.modelCalls[0].trace),
        callId: "call:records:duplicate-target",
      },
    });
    expect(() => projectCourtRecords(duplicated)).toThrow(
      "COURT_RECORDS_MODEL_CALL_COVERAGE_INVALID",
    );

    const relabeled = activeRecordsInput();
    const generatedEvent = relabeled.events.find(
      (event) => event.type === "ANSWER_QUESTION",
    );
    if (generatedEvent === undefined || generatedEvent.modelMetadata === null) {
      throw new Error("Missing generated-event fixture");
    }
    generatedEvent.source = "deterministic";
    relabeled.modelCalls = [];
    expect(() => projectCourtRecords(relabeled)).toThrow(
      "COURT_RECORDS_MODEL_CALL_COVERAGE_INVALID",
    );
  });

  it("reconstructs the provenance-redacted judge request used by the writer", () => {
    const view = projectCourtRecords(activeRecordsInput(true));
    const judgeCall = view.modelCalls.find(
      (call) => call.task === "judge_response",
    );
    expect(judgeCall).toMatchObject({
      actorRole: "judge",
      status: "accepted",
      knowledgeScope: {
        integrity: "verified",
        sourceSegmentCount: 0,
        testimonyCount: 1,
      },
      acceptedCitations: {
        testimonyIds: ["testimony:records"],
      },
    });
  });

  it("allows only the pending question event in objection-ruling citations", () => {
    const input = activeRecordsInput(false, true);
    const view = projectCourtRecords(input);
    const objectionCall = view.modelCalls.find(
      (call) => call.task === "resolve_objection",
    );
    const pendingQuestionEvent = input.events.find(
      (event) =>
        event.type === "ASK_QUESTION" &&
        event.payload.questionId === "question:records",
    );
    expect(objectionCall?.acceptedCitations.eventIds).toEqual([
      pendingQuestionEvent?.eventId,
    ]);

    const priorQuestion = input.events.find(
      (event) =>
        event.type === "ASK_QUESTION" &&
        event.payload.questionId === "question:records:prior",
    );
    const tampered = structuredClone(input);
    const trace = tampered.modelCalls.find(
      (row) => row.trace.task === "resolve_objection",
    )?.trace;
    if (priorQuestion === undefined || trace === undefined) {
      throw new Error("Missing objection citation fixture");
    }
    trace.acceptedCitations.eventIds = [priorQuestion.eventId];
    tampered.citationResources.push({
      ownerId: OWNER_ID,
      trialId: tampered.trialState.trialId,
      resourceId: priorQuestion.eventId,
      kind: "event",
      scope: "owner_record",
    });
    expect(() => projectCourtRecords(tampered)).toThrow(
      "COURT_RECORDS_MODEL_CALL_CITATION_RESOURCE_INVALID",
    );
  });

  it("preserves failed terminal calls but never invents a committed result", () => {
    const input = structuredClone(activeRecordsInput());
    const trace = structuredClone(input.modelCalls[0].trace);
    trace.callId = "call:records:witness:failed";
    trace.status = "failed";
    trace.acceptedAttempt = null;
    trace.acceptedCitations = {
      factIds: [],
      evidenceIds: [],
      testimonyIds: [],
      eventIds: [],
      sourceSegmentIds: [],
      priorStatementIds: [],
    };
    trace.acceptedCitationCount = 0;
    trace.outputHash = null;
    trace.outputCharacterCount = 0;
    trace.committedActionId = null;
    trace.committedEventId = null;
    trace.safeFailureCode = "provider_failed";
    trace.attempts[0].status = "provider_failed";
    trace.attempts[0].providerResponseId = null;
    trace.attempts[0].firstStructuredDeltaMs = null;
    trace.attempts[0].structuredDeltaCount = 0;
    trace.attempts[0].streamedCharacterCount = 0;
    trace.attempts[0].outputHash = null;
    trace.attempts[0].proposedCitationCount = 0;
    trace.attempts[0].safeErrorCode = "provider_failed";
    input.modelCalls.push({ ownerId: OWNER_ID, trace });

    expect(
      projectCourtRecords(input).modelCalls.find(
        (call) => call.callId === trace.callId,
      ),
    ).toMatchObject({
      status: "failed",
      acceptedCitationCount: 0,
      visibleCitationCount: 0,
      restrictedCitationCount: 0,
      safeFailureCode: "provider_failed",
    });
  });

  it("redacts valid private role citations while reporting exact totals", () => {
    const input = structuredClone(activeRecordsInput());
    const priorStatementId =
      input.caseGraph.witnesses.find(
        (witness) => witness.witnessId === "witness_rina_shah",
      )?.priorStatements[0]?.priorStatementId;
    if (priorStatementId === undefined) throw new Error("Missing prior statement");
    input.citationResources.push({
      ownerId: OWNER_ID,
      trialId: input.trialState.trialId,
      resourceId: priorStatementId,
      kind: "prior_statement",
      scope: "debrief_only",
    });
    input.modelCalls[0].trace.acceptedCitations.priorStatementIds = [
      priorStatementId,
    ];
    input.modelCalls[0].trace.acceptedCitationCount += 1;
    input.modelCalls[0].trace.attempts[0].proposedCitationCount += 1;

    const view = projectCourtRecords(input);
    expect(view.modelCalls[0]).toMatchObject({
      acceptedCitationCount: 3,
      visibleCitationCount: 2,
      restrictedCitationCount: 1,
      acceptedCitations: { priorStatementIds: [] },
    });
    expect(JSON.stringify(view)).not.toContain(priorStatementId);
    expect(JSON.stringify(view)).not.toContain(PRIVATE_CANARY);
  });

  it("adapts exact durable audio records and rejects tampered or foreign bindings", () => {
    const input = activeRecordsInput();
    const record = input.audioAudits[0].record;
    expect(
      adaptCourtRecordsAudioAudits(OWNER_ID, input.trialState.trialId, [record]),
    ).toEqual(input.audioAudits);

    const tampered = structuredClone(input);
    tampered.audioAudits[0].record.contentHash = HASH_D;
    expect(
      CourtRecordsProjectorInputSchema.safeParse(tampered).success,
    ).toBe(false);

    const unbound = structuredClone(input);
    unbound.audioAudits[0].record = playbackAudioRecord({
      actor: "actor.witness.records",
      turnId: "turn:missing",
    });
    expect(() => projectCourtRecords(unbound)).toThrow(
      "COURT_RECORDS_AUDIO_TURN_BINDING_INVALID",
    );

    const wrongActor = structuredClone(input);
    wrongActor.audioAudits[0].record = playbackAudioRecord({
      actor: "actor.witness.tampered",
      turnId: "turn:records:answer",
    });
    expect(() => projectCourtRecords(wrongActor)).toThrow(
      "COURT_RECORDS_AUDIO_TURN_BINDING_INVALID",
    );
  });

  it("verifies only canonical interruption playback semantics", () => {
    const resumed = activeRecordsInput();
    const turn = resumed.trialState.transcriptTurns["turn:records:answer"];
    if (turn === undefined) throw new Error("Expected answer turn");
    resumed.audioAudits[0].record = playbackAudioRecord({
      actor: hearingPerformanceActorAlias(turn.actor),
      turnId: turn.turnId,
      interruptId: "interrupt:records",
    });
    expect(projectCourtRecords(resumed).audio.entries[0].canonicalBinding).toEqual(
      {
        status: "interruption_verified",
        turnId: turn.turnId,
        interruptId: "interrupt:records",
      },
    );

    for (const semantic of [
      {
        actor: HEARING_OBJECTION_ACTOR_ID,
        sceneActor: "opposing_counsel" as const,
        purpose: "objection" as const,
      },
      {
        actor: HEARING_COURTROOM_DIRECTOR_ACTOR_ID,
        sceneActor: "clerk" as const,
        purpose: "correction" as const,
      },
    ]) {
      const input = activeRecordsInput();
      input.audioAudits[0].record = playbackAudioRecord({
        ...semantic,
        turnId: null,
        interruptId: "interrupt:records",
      });
      expect(
        projectCourtRecords(input).audio.entries[0].canonicalBinding,
      ).toEqual({
        status: "local_observation",
        turnId: null,
        interruptId: null,
      });
    }

    const ruling = activeRecordsInput();
    ruling.audioAudits[0].record = playbackAudioRecord({
      actor: HEARING_JUDGE_ACTOR_ID,
      sceneActor: "judge",
      purpose: "ruling",
      turnId: null,
      interruptId: "interrupt:records",
    });
    expect(projectCourtRecords(ruling).audio.entries[0].canonicalBinding).toEqual(
      {
        status: "interruption_verified",
        turnId: null,
        interruptId: "interrupt:records",
      },
    );

    const invalid = activeRecordsInput();
    invalid.audioAudits[0].record = playbackAudioRecord({
      actor: HEARING_JUDGE_ACTOR_ID,
      sceneActor: "opposing_counsel",
      purpose: "objection",
      turnId: null,
      interruptId: "interrupt:records",
    });
    expect(() => projectCourtRecords(invalid)).toThrow(
      "COURT_RECORDS_AUDIO_PLAYBACK_SEMANTICS_INVALID",
    );

    const unknown = activeRecordsInput();
    unknown.audioAudits[0].record = playbackAudioRecord({
      actor: HEARING_OBJECTION_ACTOR_ID,
      sceneActor: "opposing_counsel",
      purpose: "objection",
      turnId: null,
      interruptId: "interrupt:unknown",
    });
    expect(projectCourtRecords(unknown).audio.entries[0].canonicalBinding).toEqual(
      {
        status: "local_observation",
        turnId: null,
        interruptId: null,
      },
    );

    const unrelatedResume = activeRecordsInput();
    unrelatedResume.audioAudits[0].record = playbackAudioRecord({
      actor: hearingPerformanceActorAlias(turn.actor),
      turnId: turn.turnId,
      interruptId: "interrupt:unknown",
    });
    expect(() => projectCourtRecords(unrelatedResume)).toThrow(
      "COURT_RECORDS_AUDIO_INTERRUPTION_BINDING_INVALID",
    );

    const playerTurn = activeRecordsInput();
    const questionTurn =
      playerTurn.trialState.transcriptTurns["turn:records:question"];
    if (questionTurn === undefined) throw new Error("Expected question turn");
    playerTurn.audioAudits[0].record = playbackAudioRecord({
      actor: hearingPerformanceActorAlias(questionTurn.actor),
      sceneActor: "user_counsel",
      purpose: "transcript",
      turnId: questionTurn.turnId,
    });
    expect(() => projectCourtRecords(playerTurn)).toThrow(
      "COURT_RECORDS_AUDIO_TURN_BINDING_INVALID",
    );
  });

  it("returns owner-bound summaries and rejects foreign or duplicate trials", () => {
    const view = projectCourtRecords(activeRecordsInput());
    const summaryRow = {
      ownerId: OWNER_ID,
      trialId: view.summary.trialId,
      caseId: view.summary.caseId,
      caseTitle: view.summary.caseTitle,
      phase: view.summary.phase,
      status: view.summary.status,
      stateVersion: view.summary.stateVersion,
      lastSequence: view.summary.lastSequence,
      lastEventId: view.summary.lastEventId,
      startedAt: view.summary.startedAt,
      updatedAt: view.summary.updatedAt,
      transcriptTurnCount: view.summary.transcriptTurnCount,
      modelCallCount: view.summary.modelCallCount,
      hasFinalDebrief: view.summary.hasFinalDebrief,
    };
    expect(projectCourtRecordsTrialSummaries(OWNER_ID, [summaryRow])).toEqual([
      view.summary,
    ]);
    expect(() =>
      projectCourtRecordsTrialSummaries(OWNER_ID, [
        { ...summaryRow, ownerId: "owner:foreign" },
      ]),
    ).toThrow("COURT_RECORDS_FOREIGN_TRIAL_SUMMARY");
    expect(() =>
      projectCourtRecordsTrialSummaries(OWNER_ID, [summaryRow, summaryRow]),
    ).toThrow("COURT_RECORDS_DUPLICATE_TRIAL_SUMMARY");
  });

  it("validates and labels the exact final debrief artifact", () => {
    const view = projectCourtRecords(completedDebriefInput());
    expect(view.finalDebrief).toMatchObject({
      artifactId: "debrief:records:final",
      model: "gpt-5.6-terra",
      citationResources: [
        {
          resourceId: "fact_complaint_sent",
          stratum: "unadmitted_record",
          stratumLabel: "Unadmitted fact",
        },
      ],
    });
    expect(view.citationResources).toEqual([
      expect.objectContaining({ resourceId: "fact_complaint_sent" }),
    ]);
    expect(JSON.stringify(view)).not.toContain("artifactJson");
  });

  it("reconstructs debrief transcript bindings in the writer's lexical order", () => {
    const input = completedDebriefInput(true);
    expect(input.trialState.transcriptTurnIds).toEqual([
      "turn:z:debrief-question",
      "turn:a:debrief-answer",
    ]);

    const view = projectCourtRecords(input);
    expect(view.finalDebrief?.citationResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "turn:z:debrief-question",
          kind: "transcript_turn",
        }),
        expect.objectContaining({
          resourceId: "turn:a:debrief-answer",
          kind: "transcript_turn",
        }),
      ]),
    );
  });

  it("rejects debrief content, hash, event, trace, and citation-resource tampering", () => {
    const content = structuredClone(completedDebriefInput());
    if (content.finalDebriefArtifact === null) throw new Error("Missing fixture");
    content.finalDebriefArtifact.artifactJson = content.finalDebriefArtifact.artifactJson.replace(
      "early settlement",
      "tampered settlement",
    );
    expect(() => projectCourtRecords(content)).toThrow(
      "COURT_RECORDS_DEBRIEF_HASH_INVALID",
    );

    const noncanonicalOrder = structuredClone(completedDebriefInput());
    const orderedArtifact = noncanonicalOrder.finalDebriefArtifact;
    if (orderedArtifact === null) throw new Error("Missing fixture");
    const orderedOutput = JSON.parse(orderedArtifact.artifactJson) as Record<
      string,
      unknown
    >;
    orderedArtifact.artifactJson = JSON.stringify(
      Object.fromEntries(Object.entries(orderedOutput).reverse()),
    );
    expect(() => projectCourtRecords(noncanonicalOrder)).toThrow(
      "COURT_RECORDS_DEBRIEF_HASH_INVALID",
    );

    const binding = structuredClone(completedDebriefInput());
    if (binding.finalDebriefArtifact === null) throw new Error("Missing fixture");
    binding.finalDebriefArtifact.actionId = "action:tampered";
    expect(() => projectCourtRecords(binding)).toThrow(
      "COURT_RECORDS_DEBRIEF_EVENT_BINDING_INVALID",
    );

    const trace = structuredClone(completedDebriefInput());
    trace.modelCalls[0].trace.outputHash = HASH_D;
    expect(() => projectCourtRecords(trace)).toThrow(
      "COURT_RECORDS_MODEL_CALL_COMMIT_BINDING_INVALID",
    );

    const citation = structuredClone(completedDebriefInput());
    citation.citationResources = [];
    expect(() => projectCourtRecords(citation)).toThrow(
      "COURT_RECORDS_MODEL_CALL_CITATION_RESOURCE_INVALID",
    );

    const inventedScope = structuredClone(completedDebriefInput());
    const inventedArtifact = inventedScope.finalDebriefArtifact;
    if (inventedArtifact === null) throw new Error("Missing fixture");
    const inventedOutput = DebriefGeneratorModelOutputSchema.parse(
      JSON.parse(inventedArtifact.artifactJson) as unknown,
    );
    const inventedCitations = {
      admittedFactIds: [],
      admittedEvidenceIds: [],
      activeTestimonyIds: [],
      transcriptTurnIds: [],
      unadmittedFactIds: [],
      unadmittedEvidenceIds: [],
      excludedFactIds: [],
      excludedEvidenceIds: [],
      strickenTestimonyIds: [],
      hiddenFactIds: [],
      hiddenSourceSegmentIds: [],
      coachingInferenceIds: ["inference:invented"],
    };
    inventedOutput.overallAssessment = {
      ...inventedOutput.overallAssessment,
      basis: "coaching_inference",
      citations: inventedCitations,
    };
    inventedOutput.strengths = inventedOutput.strengths.map((strength) => ({
      ...strength,
      basis: "coaching_inference" as const,
      citations: inventedCitations,
    }));
    const inventedHash = sha256Utf8(JSON.stringify(inventedOutput));
    inventedArtifact.artifactJson = JSON.stringify(inventedOutput);
    inventedArtifact.artifactHash = inventedHash;
    inventedScope.citationResources.push({
      ownerId: OWNER_ID,
      trialId: inventedScope.trialState.trialId,
      resourceId: "inference:invented",
      kind: "coaching_inference",
      scope: "debrief_only",
    });
    const inventedTrace = inventedScope.modelCalls[0].trace;
    inventedTrace.outputHash = inventedHash;
    inventedTrace.acceptedCitations.factIds = [];
    inventedTrace.acceptedCitationCount = 0;
    inventedTrace.attempts[0].outputHash = inventedHash;
    inventedTrace.attempts[0].proposedCitationCount = 0;
    expect(() => projectCourtRecords(inventedScope)).toThrow(
      "COURT_RECORDS_DEBRIEF_OUTPUT_INVALID",
    );
  });

  it("strictly rejects raw audio, raw jury artifacts, and unknown payload fields", () => {
    const base = activeRecordsInput();
    expect(
      CourtRecordsProjectorInputSchema.safeParse({
        ...base,
        rawJuryArtifact: { reasoning: "secret" },
      }).success,
    ).toBe(false);
    expect(
      CourtRecordsProjectorInputSchema.safeParse({
        ...base,
        audioAudits: [
          { ...base.audioAudits[0], rawAudio: "base64-secret-audio" },
        ],
      }).success,
    ).toBe(false);
    expect(
      CourtRecordsProjectorInputSchema.safeParse({
        ...base,
        events: [
          { ...base.events[0], rawPayloadJson: PRIVATE_CANARY },
          ...base.events.slice(1),
        ],
      }).success,
    ).toBe(false);
  });
});
