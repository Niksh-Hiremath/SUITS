import { describe, expect, it } from "vitest";

import {
  COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
} from "../courtroom-ai";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
} from "../courtroom-ai/model-call-trace";
import {
  createDebriefGeneratorOutputFixture,
  createDebriefGeneratorRequestFixture,
} from "../courtroom-ai/debrief-generator.test-fixtures";
import {
  createJuryResponseOutputFixture,
  createJuryResponseRequestFixture,
} from "../courtroom-ai/jury-response.test-fixtures";
import {
  createCounselQuestionOutputFixture,
  createCounselResponseRequestFixture,
} from "../../server/courtroom-ai/counsel-response.test-fixtures";
import {
  createOpponentPlannerOutputFixture,
  createOpponentPlannerRequestFixture,
} from "../../server/courtroom-ai/opponent-planner.test-fixtures";
import {
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
  type HearingRuntimeViewV1,
} from "./schema";
import {
  HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
  HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HearingCounselResponsePrecommitSchema,
  HearingCommandPreparationSchema,
  HearingDebriefGeneratorPrecommitSchema,
  HearingJuryResponsePrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingWitnessGenerationPrecommitSchema,
  counselResponseOutputCitations,
  debriefGeneratorOutputCitations,
  hashCounselResponseModelOutput,
  hashDebriefGeneratorModelOutput,
  hashJuryResponseModelOutput,
  hashOpponentPlannerModelOutput,
  hashWitnessAnswerModelOutput,
  isHearingCounselResponseModelRequiredPreparation,
  isHearingDebriefGeneratorModelRequiredPreparation,
  isHearingJuryResponseModelRequiredPreparation,
  isHearingOpponentPlanModelRequiredPreparation,
  isHearingWitnessModelRequiredPreparation,
  opponentPlannerOutputCitations,
  juryResponseOutputCitations,
  witnessAnswerOutputCitations,
  type HearingCounselResponsePrecommit,
  type HearingDebriefGeneratorPrecommit,
  type HearingJuryResponsePrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingWitnessGenerationPrecommit,
} from "./model-boundary";

const TRIAL_ID = `trial_${"a".repeat(32)}`;
const CALL_ID = "call:witness-answer:001";
const RESPONSE_ID = "response:witness-answer:001";
const PROVIDER_REQUEST_ID = "request:openai:001";
const PROVIDER_RESPONSE_ID = "response:openai:001";
const PROMPT_VERSION = "role-responder.witness-answer.prompt.v1";
const OPPONENT_PROMPT_VERSION = "opponent-planner.prompt.v2";
const COUNSEL_PROMPT_VERSION = "role-responder.counsel.prompt.v2";
const JURY_PROMPT_VERSION = "role-responder.jury.prompt.v1";
const DEBRIEF_PROMPT_VERSION = "debrief-generator.prompt.v1";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function runtimeView(): HearingRuntimeViewV1 {
  return {
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
    case: {
      caseId: "case:model-boundary",
      version: 1,
      title: "Model boundary fixture",
      summary: "A fictional educational hearing.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction:fixture",
        name: "Fixture Court",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional procedure",
        burdenOfProof: "preponderance",
      },
      issues: [],
    },
    trial: {
      trialId: TRIAL_ID,
      phase: "case_in_chief",
      status: "active",
      version: 8,
      sequence: 8,
      lastEventId: "event:request-response:001",
      userSide: "user",
    },
    activeAppearance: null,
    activeQuestion: null,
    capabilities: {
      canAskQuestion: false,
      canFinishExamination: false,
      canFinishTrial: false,
      canObject: false,
      canContinueResponse: false,
      canProposeSettlement: false,
      counterableSettlementOfferIds: [],
      acceptableSettlementOfferIds: [],
      rejectableSettlementOfferIds: [],
      withdrawableSettlementOfferIds: [],
    },
    witnesses: [],
    player: {
      actorId: "actor:user-counsel",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party:claimant",
      facts: [],
      evidence: [],
      settlement: null,
    },
    transcript: [],
    permittedObjectionGrounds: [],
  };
}

function witnessRequest() {
  return {
    schemaVersion: WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
    callId: CALL_ID,
    trialId: TRIAL_ID,
    responseId: RESPONSE_ID,
    expectedStateVersion: 8,
    expectedLastEventId: "event:request-response:001",
    actorId: "actor:witness:rina",
    witnessId: "witness:rina",
    question: {
      questionId: "question:001",
      appearanceId: "appearance:001",
      turnId: "turn:question:001",
      eventId: "event:question:001",
      examinationKind: "direct" as const,
      text: "What did you observe, and do you recognize this record?",
      presentedEvidenceIds: ["evidence:email"],
    },
    knowledgeView: {
      schemaVersion: "knowledge-view.v2" as const,
      trialId: TRIAL_ID,
      stateVersion: 8,
      actorId: "actor:witness:rina",
      actorRole: "witness" as const,
      case: {
        caseId: "case:model-boundary",
        caseVersion: 1,
        title: "Model boundary fixture",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1" as const,
        trialId: TRIAL_ID,
        stateVersion: 8,
        facts: [],
        evidence: [],
        testimony: [],
        instructions: [],
      },
      witness: {
        witnessId: "witness:rina",
        name: "Rina Shah",
        role: "Fact witness",
        emotionalState: "confident" as const,
        facts: [
          {
            factId: "fact:observed-condition",
            proposition: "Rina personally observed the condition.",
            knowledgeBasis: "perceived" as const,
          },
        ],
        admittedSeenEvidence: [],
        priorStatements: [
          {
            priorStatementId: "statement:rina:001",
            madeAt: "2026-07-18T10:00:00.000Z",
            kind: "interview" as const,
            text: "I saw the condition before the incident.",
            relatedFactIds: ["fact:observed-condition"],
            relatedEvidenceIds: ["evidence:email"],
          },
        ],
        allowedTopics: ["personal observations"],
        forbiddenTopics: ["another witness's private account"],
      },
      presentedEvidence: [
        {
          evidenceId: "evidence:email",
          name: "Condition email",
          description: "A fictional email shown for identification.",
          status: "admitted" as const,
        },
      ],
      currentExchange: {
        exchangeId: "question:001",
        speakerActorId: "actor:user-counsel",
        text: "What did you observe, and do you recognize this record?",
        factIds: [],
        evidenceIds: ["evidence:email"],
      },
    },
  };
}

function witnessOutput() {
  return {
    schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    disposition: "substantive" as const,
    performance: {
      emotion: "confident" as const,
      intensity: 0.4,
      delivery: "measured" as const,
      gesture: "indicate_evidence" as const,
      gazeTarget: "evidence_display" as const,
    },
    segments: [
      {
        text: "I personally observed the condition before the incident.",
        factIds: ["fact:observed-condition"],
        evidenceIds: [],
        priorStatementIds: ["statement:rina:001"],
      },
      {
        text: "I also recognize the email shown to me.",
        factIds: ["fact:observed-condition"],
        evidenceIds: ["evidence:email"],
        priorStatementIds: [],
      },
    ],
  };
}

function validPrecommit(): HearingWitnessGenerationPrecommit {
  const output = witnessOutput();
  const outputHash = hashWitnessAnswerModelOutput(output);
  const citations = witnessAnswerOutputCitations(output);
  const citationCount = Object.values(citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
  const proposedCitationCount = output.segments.reduce(
    (total, segment) =>
      total +
      segment.factIds.length +
      segment.evidenceIds.length +
      segment.priorStatementIds.length,
    0,
  );
  const usage = {
    inputTokens: 480,
    outputTokens: 72,
    totalTokens: 552,
    cachedInputTokens: 200,
    cacheWriteTokens: 0,
    reasoningTokens: 12,
  };
  return HearingWitnessGenerationPrecommitSchema.parse({
    schemaVersion: HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
    trialId: TRIAL_ID,
    callId: CALL_ID,
    responseId: RESPONSE_ID,
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId: PROVIDER_REQUEST_ID,
      promptVersion: PROMPT_VERSION,
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      latencyMs: 640,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: 0.0012,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId: CALL_ID,
      trialId: TRIAL_ID,
      responseId: RESPONSE_ID,
      actorId: "actor:witness:rina",
      actorRole: "witness",
      callClass: "role_responder",
      task: "witness_answer",
      inputEventIds: ["event:question:001"],
      expectedStateVersion: 8,
      expectedLastEventId: "event:request-response:001",
      provider: "openai",
      model: "gpt-5.6-luna",
      providerProtocolVersion: "responses-api.v1",
      promptVersion: PROMPT_VERSION,
      outputSchemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: HASH_A,
        stateVersion: 8,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 0,
        priorStatementCount: 1,
        sourceSegmentCount: 0,
        publicRecordEventCount: 0,
        currentExchangeCount: 1,
      },
      promptAudit: {
        stablePrefixHash: HASH_A,
        trustedContextHash: HASH_B,
        untrustedInputHash: HASH_C,
        inputCharacterCount: 1_200,
      },
      status: "accepted",
      startedAt: "2026-07-19T05:00:00.000Z",
      completedAt: "2026-07-19T05:00:00.640Z",
      latencyMs: 640,
      firstStructuredDeltaMs: 220,
      firstAcceptedSegmentMs: 430,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd: 0.0012,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: citations,
      acceptedCitationCount: citationCount,
      outputHash,
      outputCharacterCount: output.segments.reduce(
        (total, segment) => total + segment.text.length,
        0,
      ),
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
      attempts: [
        {
          schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
          attempt: 1,
          mode: "initial",
          status: "accepted",
          providerRequestId: PROVIDER_REQUEST_ID,
          providerResponseId: PROVIDER_RESPONSE_ID,
          startedAt: "2026-07-19T05:00:00.000Z",
          completedAt: "2026-07-19T05:00:00.640Z",
          latencyMs: 640,
          firstStructuredDeltaMs: 220,
          streamEventCount: 10,
          structuredDeltaCount: 3,
          streamedCharacterCount: 320,
          outputHash,
          proposedCitationCount,
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

function opponentPlanProposedCitationCount(
  output: ReturnType<typeof createOpponentPlannerOutputFixture>,
): number {
  return output.proposedMoves.reduce(
    (total, move) =>
      total +
      Object.values(move.citations).reduce(
        (moveTotal, identifiers) => moveTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function validOpponentPlanPrecommit(): HearingOpponentPlanPrecommit {
  const request = createOpponentPlannerRequestFixture();
  const output = createOpponentPlannerOutputFixture();
  const outputHash = hashOpponentPlannerModelOutput(output);
  const citations = opponentPlannerOutputCitations(output);
  const citationCount = Object.values(citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
  const usage = {
    inputTokens: 620,
    outputTokens: 140,
    totalTokens: 760,
    cachedInputTokens: 200,
    cacheWriteTokens: 0,
    reasoningTokens: 20,
  };
  const providerRequestId = "request:openai:opponent-plan:001";
  const providerResponseId = "response:openai:opponent-plan:001";

  return HearingOpponentPlanPrecommitSchema.parse({
    schemaVersion: HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId: providerRequestId,
      promptVersion: OPPONENT_PROMPT_VERSION,
      schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
      latencyMs: 720,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: 0.002,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId: request.callId,
      trialId: request.trialId,
      responseId: null,
      actorId: request.actorId,
      actorRole: "counsel",
      callClass: "opponent_planner",
      task: "plan_opponent",
      inputEventIds: [request.expectedLastEventId],
      expectedStateVersion: request.expectedStateVersion,
      expectedLastEventId: request.expectedLastEventId,
      provider: "openai-responses",
      model: "gpt-5.6-luna",
      providerProtocolVersion: "courtroom-model-provider.v1",
      promptVersion: OPPONENT_PROMPT_VERSION,
      outputSchemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: request.knowledgeView.schemaVersion,
        knowledgeViewHash: HASH_A,
        stateVersion: request.expectedStateVersion,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 0,
        priorStatementCount: 0,
        sourceSegmentCount: 0,
        publicRecordEventCount: 0,
        currentExchangeCount: 0,
      },
      promptAudit: {
        stablePrefixHash: HASH_A,
        trustedContextHash: HASH_B,
        untrustedInputHash: HASH_C,
        inputCharacterCount: 1_600,
      },
      status: "accepted",
      startedAt: "2026-07-19T06:00:00.000Z",
      completedAt: "2026-07-19T06:00:00.720Z",
      latencyMs: 720,
      firstStructuredDeltaMs: 240,
      firstAcceptedSegmentMs: null,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd: 0.002,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: citations,
      acceptedCitationCount: citationCount,
      outputHash,
      outputCharacterCount: JSON.stringify(output).length,
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
      attempts: [
        {
          schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
          attempt: 1,
          mode: "initial",
          status: "accepted",
          providerRequestId,
          providerResponseId,
          startedAt: "2026-07-19T06:00:00.000Z",
          completedAt: "2026-07-19T06:00:00.720Z",
          latencyMs: 720,
          firstStructuredDeltaMs: 240,
          streamEventCount: 12,
          structuredDeltaCount: 4,
          streamedCharacterCount: 560,
          outputHash,
          proposedCitationCount: opponentPlanProposedCitationCount(output),
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

function counselProposedCitationCount(
  output: ReturnType<typeof createCounselQuestionOutputFixture>,
): number {
  return output.speechSegments.reduce(
    (total, segment) =>
      total +
      Object.values(segment.citations).reduce(
        (segmentTotal, identifiers) => segmentTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function validCounselResponsePrecommit(): HearingCounselResponsePrecommit {
  const request = createCounselResponseRequestFixture();
  const output = createCounselQuestionOutputFixture();
  const outputHash = hashCounselResponseModelOutput(output);
  const citations = counselResponseOutputCitations(output);
  const citationCount = Object.values(citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
  const usage = {
    inputTokens: 540,
    outputTokens: 96,
    totalTokens: 636,
    cachedInputTokens: 180,
    cacheWriteTokens: 0,
    reasoningTokens: 12,
  };
  const providerRequestId = "request:openai:counsel-response:001";
  const providerResponseId = "response:openai:counsel-response:001";

  return HearingCounselResponsePrecommitSchema.parse({
    schemaVersion: HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    planBinding: request.planBinding,
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId: providerRequestId,
      promptVersion: COUNSEL_PROMPT_VERSION,
      schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      latencyMs: 680,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: 0.0018,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId: request.callId,
      trialId: request.trialId,
      responseId: null,
      actorId: request.actorId,
      actorRole: "counsel",
      callClass: "role_responder",
      task: "counsel_response",
      inputEventIds: [request.expectedLastEventId],
      expectedStateVersion: request.expectedStateVersion,
      expectedLastEventId: request.expectedLastEventId,
      provider: "openai-responses",
      model: "gpt-5.6-luna",
      providerProtocolVersion: "courtroom-model-provider.v1",
      promptVersion: COUNSEL_PROMPT_VERSION,
      outputSchemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: request.knowledgeView.schemaVersion,
        knowledgeViewHash: HASH_A,
        stateVersion: request.expectedStateVersion,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 1,
        priorStatementCount: 0,
        sourceSegmentCount: 0,
        publicRecordEventCount: 0,
        currentExchangeCount: 0,
      },
      promptAudit: {
        stablePrefixHash: HASH_A,
        trustedContextHash: HASH_B,
        untrustedInputHash: HASH_C,
        inputCharacterCount: 1_400,
      },
      status: "accepted",
      startedAt: "2026-07-19T06:30:00.000Z",
      completedAt: "2026-07-19T06:30:00.680Z",
      latencyMs: 680,
      firstStructuredDeltaMs: 210,
      firstAcceptedSegmentMs: null,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd: 0.0018,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: citations,
      acceptedCitationCount: citationCount,
      outputHash,
      outputCharacterCount: JSON.stringify(output).length,
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
      attempts: [
        {
          schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
          attempt: 1,
          mode: "initial",
          status: "accepted",
          providerRequestId,
          providerResponseId,
          startedAt: "2026-07-19T06:30:00.000Z",
          completedAt: "2026-07-19T06:30:00.680Z",
          latencyMs: 680,
          firstStructuredDeltaMs: 210,
          streamEventCount: 11,
          structuredDeltaCount: 4,
          streamedCharacterCount: 460,
          outputHash,
          proposedCitationCount: counselProposedCitationCount(output),
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

function citationCount(
  citations: ReturnType<typeof juryResponseOutputCitations>,
): number {
  return Object.values(citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function juryProposedCitationCount(
  output: ReturnType<typeof createJuryResponseOutputFixture>,
): number {
  return [
    ...output.deliberationSegments.map(({ citations }) => citations),
    ...output.findings.map(({ citations }) => citations),
  ].reduce(
    (total, citations) =>
      total +
      Object.values(citations).reduce(
        (citationTotal, identifiers) =>
          citationTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function debriefCitationSets(
  output: ReturnType<typeof createDebriefGeneratorOutputFixture>,
) {
  const citations = [output.overallAssessment.citations];
  for (const field of [
    "strengths",
    "weakQuestions",
    "missedEvidence",
    "contradictions",
    "objectionAccuracy",
    "witnessStrategy",
    "settlementChoices",
    "juryMovement",
  ] as const) {
    citations.push(...output[field].map((point) => point.citations));
  }
  citations.push(
    ...output.improvedClosing.segments.map((segment) => segment.citations),
  );
  return citations;
}

function debriefProposedCitationCount(
  output: ReturnType<typeof createDebriefGeneratorOutputFixture>,
): number {
  return debriefCitationSets(output).reduce(
    (total, citations) =>
      total +
      Object.values(citations).reduce(
        (citationTotal, identifiers) =>
          citationTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function acceptedFinalTrace(input: {
  callId: string;
  trialId: string;
  actorId: string;
  actorRole: "jury" | "debrief";
  callClass: "role_responder" | "debrief_generator";
  task: "jury_deliberation" | "generate_debrief";
  expectedStateVersion: number;
  expectedLastEventId: string;
  model: "gpt-5.6-luna" | "gpt-5.6-terra";
  promptVersion: string;
  outputSchemaVersion: string;
  outputHash: string;
  outputCharacterCount: number;
  proposedCitationCount: number;
  citations: ReturnType<typeof juryResponseOutputCitations>;
  providerRequestId: string;
  providerResponseId: string;
}) {
  const usage = {
    inputTokens: 1_200,
    outputTokens: 260,
    totalTokens: 1_460,
    cachedInputTokens: 400,
    cacheWriteTokens: 0,
    reasoningTokens: 40,
  };
  const latencyMs = 920;
  const estimatedCostUsd = 0.0042;
  return {
    modelMetadata: {
      model: input.model,
      requestId: input.providerRequestId,
      promptVersion: input.promptVersion,
      schemaVersion: input.outputSchemaVersion,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId: input.callId,
      trialId: input.trialId,
      responseId: null,
      actorId: input.actorId,
      actorRole: input.actorRole,
      callClass: input.callClass,
      task: input.task,
      inputEventIds: [input.expectedLastEventId],
      expectedStateVersion: input.expectedStateVersion,
      expectedLastEventId: input.expectedLastEventId,
      provider: "openai-responses",
      model: input.model,
      providerProtocolVersion: "courtroom-model-provider.v1",
      promptVersion: input.promptVersion,
      outputSchemaVersion: input.outputSchemaVersion,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: HASH_A,
        stateVersion: input.expectedStateVersion,
        factCount: 4,
        evidenceCount: 3,
        testimonyCount: 2,
        priorStatementCount: 0,
        sourceSegmentCount: 2,
        publicRecordEventCount: 4,
        currentExchangeCount: 0,
      },
      promptAudit: {
        stablePrefixHash: HASH_A,
        trustedContextHash: HASH_B,
        untrustedInputHash: HASH_C,
        inputCharacterCount: 4_200,
      },
      status: "accepted" as const,
      startedAt: "2026-07-19T07:00:00.000Z",
      completedAt: "2026-07-19T07:00:00.920Z",
      latencyMs,
      firstStructuredDeltaMs: 310,
      firstAcceptedSegmentMs: null,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: input.citations,
      acceptedCitationCount: citationCount(input.citations),
      outputHash: input.outputHash,
      outputCharacterCount: input.outputCharacterCount,
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
      attempts: [
        {
          schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
          attempt: 1,
          mode: "initial" as const,
          status: "accepted" as const,
          providerRequestId: input.providerRequestId,
          providerResponseId: input.providerResponseId,
          startedAt: "2026-07-19T07:00:00.000Z",
          completedAt: "2026-07-19T07:00:00.920Z",
          latencyMs,
          firstStructuredDeltaMs: 310,
          streamEventCount: 18,
          structuredDeltaCount: 6,
          streamedCharacterCount: input.outputCharacterCount,
          outputHash: input.outputHash,
          proposedCitationCount: input.proposedCitationCount,
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  };
}

function validJuryResponsePrecommit(): HearingJuryResponsePrecommit {
  const request = createJuryResponseRequestFixture();
  const output = createJuryResponseOutputFixture();
  const outputHash = hashJuryResponseModelOutput(output);
  const citations = juryResponseOutputCitations(output);
  const generated = acceptedFinalTrace({
    callId: request.callId,
    trialId: request.trialId,
    actorId: request.actorId,
    actorRole: "jury",
    callClass: "role_responder",
    task: "jury_deliberation",
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    model: "gpt-5.6-luna",
    promptVersion: JURY_PROMPT_VERSION,
    outputSchemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    outputHash,
    outputCharacterCount: JSON.stringify(output).length,
    proposedCitationCount: juryProposedCitationCount(output),
    citations,
    providerRequestId: "request:openai:jury:001",
    providerResponseId: "response:openai:jury:001",
  });
  return HearingJuryResponsePrecommitSchema.parse({
    schemaVersion: HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    output,
    ...generated,
  });
}

function validDebriefGeneratorPrecommit(): HearingDebriefGeneratorPrecommit {
  const request = createDebriefGeneratorRequestFixture();
  const output = createDebriefGeneratorOutputFixture();
  const transcriptEventBindings = [
    { turnId: "turn_answer", sourceEventId: "event:answer" },
    { turnId: "turn_question", sourceEventId: "event:question" },
  ];
  const outputHash = hashDebriefGeneratorModelOutput(output);
  const citations = debriefGeneratorOutputCitations(
    output,
    transcriptEventBindings,
  );
  const generated = acceptedFinalTrace({
    callId: request.callId,
    trialId: request.trialId,
    actorId: request.actorId,
    actorRole: "debrief",
    callClass: "debrief_generator",
    task: "generate_debrief",
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    model: "gpt-5.6-terra",
    promptVersion: DEBRIEF_PROMPT_VERSION,
    outputSchemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    outputHash,
    outputCharacterCount: JSON.stringify(output).length,
    proposedCitationCount: debriefProposedCitationCount(output),
    citations,
    providerRequestId: "request:openai:debrief:001",
    providerResponseId: "response:openai:debrief:001",
  });
  return HearingDebriefGeneratorPrecommitSchema.parse({
    schemaVersion: HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    transcriptEventBindings,
    output,
    ...generated,
  });
}

describe("hearing command model boundary", () => {
  it("strictly accepts completed views and every server-only model request", () => {
    const completed = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "completed" as const,
      view: runtimeView(),
    };
    const modelRequired = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required" as const,
      request: witnessRequest(),
    };
    const opponentModelRequired = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required" as const,
      request: createOpponentPlannerRequestFixture(),
    };
    const counselModelRequired = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required" as const,
      request: createCounselResponseRequestFixture(),
    };
    const juryModelRequired = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required" as const,
      request: createJuryResponseRequestFixture(),
    };
    const debriefModelRequired = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required" as const,
      request: createDebriefGeneratorRequestFixture(),
    };

    expect(HearingCommandPreparationSchema.parse(completed)).toEqual(completed);
    expect(HearingCommandPreparationSchema.parse(modelRequired)).toEqual(
      modelRequired,
    );
    expect(
      HearingCommandPreparationSchema.parse(opponentModelRequired),
    ).toEqual(opponentModelRequired);
    expect(HearingCommandPreparationSchema.parse(counselModelRequired)).toEqual(
      counselModelRequired,
    );
    expect(HearingCommandPreparationSchema.parse(juryModelRequired)).toEqual(
      juryModelRequired,
    );
    expect(
      HearingCommandPreparationSchema.parse(debriefModelRequired),
    ).toEqual(debriefModelRequired);
    expect(
      isHearingWitnessModelRequiredPreparation(
        HearingCommandPreparationSchema.parse(modelRequired),
      ),
    ).toBe(true);
    expect(
      isHearingOpponentPlanModelRequiredPreparation(
        HearingCommandPreparationSchema.parse(opponentModelRequired),
      ),
    ).toBe(true);
    expect(
      isHearingCounselResponseModelRequiredPreparation(
        HearingCommandPreparationSchema.parse(counselModelRequired),
      ),
    ).toBe(true);
    expect(
      isHearingJuryResponseModelRequiredPreparation(
        HearingCommandPreparationSchema.parse(juryModelRequired),
      ),
    ).toBe(true);
    expect(
      isHearingDebriefGeneratorModelRequiredPreparation(
        HearingCommandPreparationSchema.parse(debriefModelRequired),
      ),
    ).toBe(true);
    expect(
      HearingCommandPreparationSchema.safeParse({
        ...opponentModelRequired,
        request: {
          ...opponentModelRequired.request,
          responseId: "response:forged-witness-field",
        },
      }).success,
    ).toBe(false);
  });

  it.each(["ownerId", "stateJson", "graphJson", "policyJson"])(
    "rejects a preparation containing forbidden %s data",
    (field) => {
      expect(
        HearingCommandPreparationSchema.safeParse({
          schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
          status: "model_required",
          request: witnessRequest(),
          [field]: "must-not-cross-boundary",
        }).success,
      ).toBe(false);
    },
  );

  it("accepts a mutually bound, uncommitted witness generation", () => {
    const envelope = validPrecommit();

    expect(HearingWitnessGenerationPrecommitSchema.parse(envelope)).toEqual(
      envelope,
    );
    expect(envelope.trace.outputHash).toBe(
      hashWitnessAnswerModelOutput(envelope.output),
    );
    expect(envelope.trace.acceptedCitations).toEqual(
      witnessAnswerOutputCitations(envelope.output),
    );
  });

  it("accepts absent optional usage when model metadata also omits it", () => {
    const envelope = validPrecommit();
    envelope.trace.usage = null;
    envelope.trace.attempts[0].usage = null;
    envelope.modelMetadata.inputTokens = null;
    envelope.modelMetadata.outputTokens = null;

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(envelope).success,
    ).toBe(true);
  });

  it.each([
    "ownerId",
    "actorId",
    "actionId",
    "testimonyId",
    "turnId",
    "stateJson",
    "graphJson",
    "policyJson",
  ])("strictly rejects forbidden top-level %s data", (field) => {
    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse({
        ...validPrecommit(),
        [field]: "must-be-derived-server-side",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["trialId", "trial:other"],
    ["callId", "call:witness-answer:other"],
    ["responseId", "response:witness-answer:other"],
  ] as const)("rejects a mismatched trace %s", (field, value) => {
    const envelope = validPrecommit();
    envelope.trace[field] = value;

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it("rejects non-witness and non-accepted traces", () => {
    const wrongTask = validPrecommit();
    wrongTask.trace.callClass = "opponent_planner";
    wrongTask.trace.task = "plan_opponent";
    const failed = validPrecommit();
    failed.trace.status = "failed";
    failed.trace.acceptedAttempt = null;
    failed.trace.safeFailureCode = "provider_failed";

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(wrongTask).success,
    ).toBe(false);
    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(failed).success,
    ).toBe(false);
  });

  it.each<{
    field: string;
    mutate: (envelope: HearingWitnessGenerationPrecommit) => void;
  }>([
    {
      field: "model",
      mutate: (envelope) => {
        envelope.modelMetadata.model = "gpt-5.6-terra";
      },
    },
    {
      field: "promptVersion",
      mutate: (envelope) => {
        envelope.modelMetadata.promptVersion = "wrong.prompt.v1";
      },
    },
    {
      field: "schemaVersion",
      mutate: (envelope) => {
        envelope.modelMetadata.schemaVersion = "wrong.schema.v1";
      },
    },
    {
      field: "retryCount",
      mutate: (envelope) => {
        envelope.modelMetadata.retryCount = 1;
      },
    },
    {
      field: "validationFailureCount",
      mutate: (envelope) => {
        envelope.modelMetadata.validationFailureCount = 1;
      },
    },
    {
      field: "latencyMs",
      mutate: (envelope) => {
        envelope.modelMetadata.latencyMs = 641;
      },
    },
    {
      field: "inputTokens",
      mutate: (envelope) => {
        envelope.modelMetadata.inputTokens = 481;
      },
    },
    {
      field: "outputTokens",
      mutate: (envelope) => {
        envelope.modelMetadata.outputTokens = 73;
      },
    },
    {
      field: "estimatedCostUsd",
      mutate: (envelope) => {
        envelope.modelMetadata.estimatedCostUsd = 0.1;
      },
    },
    {
      field: "requestId",
      mutate: (envelope) => {
        envelope.modelMetadata.requestId = "request:wrong";
      },
    },
  ])("rejects mismatched model metadata $field", ({ mutate }) => {
    const envelope = validPrecommit();
    mutate(envelope);

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it("rejects a missing accepted provider request or response ID", () => {
    const missingRequest = validPrecommit();
    missingRequest.trace.attempts[0].providerRequestId = null;
    const missingResponse = validPrecommit();
    missingResponse.trace.attempts[0].providerResponseId = null;

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(missingRequest).success,
    ).toBe(false);
    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(missingResponse)
        .success,
    ).toBe(false);
  });

  it("rejects aggregate usage that is not accounted for by its attempts", () => {
    const envelope = validPrecommit();
    if (envelope.trace.usage === null) {
      throw new Error("Fixture requires trace usage");
    }
    envelope.trace.usage.inputTokens += 1;
    envelope.trace.usage.totalTokens += 1;
    envelope.modelMetadata.inputTokens = envelope.trace.usage.inputTokens;

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it("rejects output hashes that do not match the validated candidate", () => {
    const envelope = validPrecommit();
    envelope.trace.outputHash = "f".repeat(64);
    envelope.trace.attempts[0].outputHash = "f".repeat(64);

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it("rejects accepted citations that do not match the validated candidate", () => {
    const envelope = validPrecommit();
    envelope.trace.acceptedCitations.factIds = ["fact:unrelated"];

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it("binds raw proposed citation count separately from deduped citations", () => {
    const envelope = validPrecommit();
    expect(envelope.trace.attempts[0].proposedCitationCount).toBeGreaterThan(
      envelope.trace.acceptedCitationCount,
    );
    envelope.trace.attempts[0].proposedCitationCount =
      envelope.trace.acceptedCitationCount;

    expect(
      HearingWitnessGenerationPrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it.each(["committedActionId", "committedEventId"] as const)(
    "rejects a pre-commit trace with %s already populated",
    (field) => {
      const envelope = validPrecommit();
      envelope.trace[field] = `${field}:already-committed`;

      expect(
        HearingWitnessGenerationPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    },
  );

  it("accepts a mutually bound, uncommitted opponent plan", () => {
    const envelope = validOpponentPlanPrecommit();

    expect(HearingOpponentPlanPrecommitSchema.parse(envelope)).toEqual(
      envelope,
    );
    expect(envelope.trace.outputHash).toBe(
      hashOpponentPlannerModelOutput(envelope.output),
    );
    expect(envelope.trace.acceptedCitations).toEqual(
      opponentPlannerOutputCitations(envelope.output),
    );
  });

  it.each(["ownerId", "actorId", "actionId", "strategyId", "stateJson"])(
    "rejects forbidden opponent-plan precommit %s data",
    (field) => {
      expect(
        HearingOpponentPlanPrecommitSchema.safeParse({
          ...validOpponentPlanPrecommit(),
          [field]: "must-be-derived-server-side",
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["trialId", "trial:other"],
    ["callId", "call:opponent-plan:other"],
  ] as const)("rejects a mismatched opponent trace %s", (field, value) => {
    const envelope = validOpponentPlanPrecommit();
    envelope.trace[field] = value;

    expect(HearingOpponentPlanPrecommitSchema.safeParse(envelope).success).toBe(
      false,
    );
  });

  it("rejects the wrong task, model, or response identity", () => {
    const wrongTask = validOpponentPlanPrecommit();
    wrongTask.trace.callClass = "role_responder";
    wrongTask.trace.task = "witness_answer";
    wrongTask.trace.actorRole = "witness";
    const wrongModel = validOpponentPlanPrecommit();
    wrongModel.trace.model = "gpt-5.6-terra";
    wrongModel.modelMetadata.model = "gpt-5.6-terra";
    const responseBound = validOpponentPlanPrecommit();
    responseBound.trace.responseId = "response:forged";

    expect(
      HearingOpponentPlanPrecommitSchema.safeParse(wrongTask).success,
    ).toBe(false);
    expect(
      HearingOpponentPlanPrecommitSchema.safeParse(wrongModel).success,
    ).toBe(false);
    expect(
      HearingOpponentPlanPrecommitSchema.safeParse(responseBound).success,
    ).toBe(false);
  });

  it.each<{
    field: string;
    mutate: (envelope: HearingOpponentPlanPrecommit) => void;
  }>([
    {
      field: "promptVersion",
      mutate: (envelope) => {
        envelope.modelMetadata.promptVersion = "wrong.prompt.v1";
      },
    },
    {
      field: "schemaVersion",
      mutate: (envelope) => {
        envelope.modelMetadata.schemaVersion = "wrong.schema.v1";
      },
    },
    {
      field: "latencyMs",
      mutate: (envelope) => {
        envelope.modelMetadata.latencyMs =
          (envelope.modelMetadata.latencyMs ?? 0) + 1;
      },
    },
    {
      field: "estimatedCostUsd",
      mutate: (envelope) => {
        envelope.modelMetadata.estimatedCostUsd = 0.5;
      },
    },
    {
      field: "requestId",
      mutate: (envelope) => {
        envelope.modelMetadata.requestId = "request:wrong";
      },
    },
  ])("rejects opponent metadata $field mismatches", ({ mutate }) => {
    const envelope = validOpponentPlanPrecommit();
    mutate(envelope);

    expect(HearingOpponentPlanPrecommitSchema.safeParse(envelope).success).toBe(
      false,
    );
  });

  it("rejects a mutually matching but unsupported planner prompt version", () => {
    const envelope = validOpponentPlanPrecommit();
    envelope.trace.promptVersion = "opponent-planner.prompt.v3";
    envelope.modelMetadata.promptVersion = "opponent-planner.prompt.v3";

    expect(HearingOpponentPlanPrecommitSchema.safeParse(envelope).success).toBe(
      false,
    );
  });

  it("rejects opponent output hash and proposed-citation mismatches", () => {
    const wrongHash = validOpponentPlanPrecommit();
    wrongHash.trace.outputHash = "f".repeat(64);
    wrongHash.trace.attempts[0].outputHash = "f".repeat(64);
    const wrongCount = validOpponentPlanPrecommit();
    wrongCount.trace.attempts[0].proposedCitationCount += 1;

    expect(
      HearingOpponentPlanPrecommitSchema.safeParse(wrongHash).success,
    ).toBe(false);
    expect(
      HearingOpponentPlanPrecommitSchema.safeParse(wrongCount).success,
    ).toBe(false);
  });

  it("rejects opponent citations outside the durable audit fields", () => {
    const wrongDurableCitation = validOpponentPlanPrecommit();
    wrongDurableCitation.trace.acceptedCitations.factIds = ["fact:other"];
    const unauditableCitation = validOpponentPlanPrecommit();
    unauditableCitation.output.proposedMoves[0].citations.issueIds = [
      "issue:private",
    ];
    const unauditableHash = hashOpponentPlannerModelOutput(
      unauditableCitation.output,
    );
    unauditableCitation.trace.outputHash = unauditableHash;
    unauditableCitation.trace.attempts[0].outputHash = unauditableHash;
    unauditableCitation.trace.attempts[0].proposedCitationCount += 1;

    expect(
      HearingOpponentPlanPrecommitSchema.safeParse(wrongDurableCitation)
        .success,
    ).toBe(false);
    expect(
      HearingOpponentPlanPrecommitSchema.safeParse(unauditableCitation).success,
    ).toBe(false);
  });

  it("rejects opponent usage not accounted for by its attempts", () => {
    const envelope = validOpponentPlanPrecommit();
    if (envelope.trace.usage === null) {
      throw new Error("Fixture requires opponent-plan usage");
    }
    envelope.trace.usage.inputTokens += 1;
    envelope.trace.usage.totalTokens += 1;
    envelope.modelMetadata.inputTokens = envelope.trace.usage.inputTokens;

    expect(HearingOpponentPlanPrecommitSchema.safeParse(envelope).success).toBe(
      false,
    );
  });

  it.each(["committedActionId", "committedEventId"] as const)(
    "rejects an opponent-plan precommit with %s populated",
    (field) => {
      const envelope = validOpponentPlanPrecommit();
      envelope.trace[field] = `${field}:already-committed`;

      expect(
        HearingOpponentPlanPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    },
  );

  it("accepts a planner-bound, uncommitted counsel response", () => {
    const envelope = validCounselResponsePrecommit();

    expect(HearingCounselResponsePrecommitSchema.parse(envelope)).toEqual(
      envelope,
    );
    expect(envelope.trace.outputHash).toBe(
      hashCounselResponseModelOutput(envelope.output),
    );
    expect(envelope.trace.acceptedCitations).toEqual(
      counselResponseOutputCitations(envelope.output),
    );
    expect(envelope.trace.expectedStateVersion).toBe(
      envelope.expectedStateVersion,
    );
    expect(envelope.trace.expectedLastEventId).toBe(
      envelope.expectedLastEventId,
    );
  });

  it("accepts absent optional counsel usage only when metadata also omits it", () => {
    const envelope = validCounselResponsePrecommit();
    envelope.trace.usage = null;
    envelope.trace.attempts[0].usage = null;
    envelope.modelMetadata.inputTokens = null;
    envelope.modelMetadata.outputTokens = null;

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(envelope).success,
    ).toBe(true);
  });

  it.each([
    "ownerId",
    "actorId",
    "actionId",
    "eventId",
    "stateJson",
    "graphJson",
    "policyJson",
    "knowledgeView",
    "privateSettlement",
  ])("rejects forbidden counsel precommit %s data", (field) => {
    expect(
      HearingCounselResponsePrecommitSchema.safeParse({
        ...validCounselResponsePrecommit(),
        [field]: "must-be-derived-or-revalidated-server-side",
      }).success,
    ).toBe(false);
  });

  it("requires a strict decision and private planner binding", () => {
    const missingDecision = {
      ...validCounselResponsePrecommit(),
    } as Record<string, unknown>;
    delete missingDecision.decisionId;
    const forgedPrivatePlan = validCounselResponsePrecommit();
    const duplicateCallIdentity = validCounselResponsePrecommit();
    duplicateCallIdentity.planBinding.plannerCallId =
      duplicateCallIdentity.callId;

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(missingDecision).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse({
        ...forgedPrivatePlan,
        planBinding: {
          ...forgedPrivatePlan.planBinding,
          privateStrategy: "never cross this boundary",
        },
      }).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(duplicateCallIdentity)
        .success,
    ).toBe(false);
  });

  it.each([
    ["trialId", "trial:other"],
    ["callId", "call:counsel-response:other"],
    ["expectedStateVersion", 99],
    ["expectedLastEventId", "event:other"],
  ] as const)("rejects a mismatched counsel trace %s", (field, value) => {
    const envelope = validCounselResponsePrecommit();
    Object.assign(envelope.trace, { [field]: value });

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it("rejects a counsel trace without the exact event-head input", () => {
    const missingHead = validCounselResponsePrecommit();
    missingHead.trace.inputEventIds = [];
    const extraHead = validCounselResponsePrecommit();
    extraHead.trace.inputEventIds.push("event:unrelated");

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(missingHead).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(extraHead).success,
    ).toBe(false);
  });

  it("rejects the wrong counsel task, role, model, or response identity", () => {
    const wrongTask = validCounselResponsePrecommit();
    wrongTask.trace.task = "witness_answer";
    const wrongRole = validCounselResponsePrecommit();
    wrongRole.trace.actorRole = "witness";
    const wrongModel = validCounselResponsePrecommit();
    wrongModel.trace.model = "gpt-5.6-terra";
    wrongModel.modelMetadata.model = "gpt-5.6-terra";
    const responseBound = validCounselResponsePrecommit();
    responseBound.trace.responseId = "response:forged";

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(wrongTask).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(wrongRole).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(wrongModel).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(responseBound).success,
    ).toBe(false);
  });

  it("requires the public counsel KnowledgeView audit at the bound head", () => {
    const privateView = validCounselResponsePrecommit();
    privateView.trace.knowledgeScope.knowledgeSchemaVersion =
      "knowledge-view.opponent-planner.v1";
    const staleView = validCounselResponsePrecommit();
    if (staleView.trace.knowledgeScope.stateVersion === null) {
      throw new Error("Fixture requires a counsel KnowledgeView state version");
    }
    staleView.trace.knowledgeScope.stateVersion += 1;

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(privateView).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(staleView).success,
    ).toBe(false);
  });

  it.each<{
    field: string;
    mutate: (envelope: HearingCounselResponsePrecommit) => void;
  }>([
    {
      field: "promptVersion",
      mutate: (envelope) => {
        envelope.trace.promptVersion = "role-responder.counsel.prompt.v1";
        envelope.modelMetadata.promptVersion =
          "role-responder.counsel.prompt.v1";
      },
    },
    {
      field: "schemaVersion",
      mutate: (envelope) => {
        envelope.trace.outputSchemaVersion = "wrong.schema.v1";
        envelope.modelMetadata.schemaVersion = "wrong.schema.v1";
      },
    },
    {
      field: "latencyMs",
      mutate: (envelope) => {
        envelope.modelMetadata.latencyMs =
          (envelope.modelMetadata.latencyMs ?? 0) + 1;
      },
    },
    {
      field: "estimatedCostUsd",
      mutate: (envelope) => {
        envelope.modelMetadata.estimatedCostUsd = 0.5;
      },
    },
    {
      field: "requestId",
      mutate: (envelope) => {
        envelope.modelMetadata.requestId = "request:wrong";
      },
    },
    {
      field: "retryCount",
      mutate: (envelope) => {
        envelope.modelMetadata.retryCount += 1;
      },
    },
  ])("rejects counsel metadata $field mismatches", ({ mutate }) => {
    const envelope = validCounselResponsePrecommit();
    mutate(envelope);

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it("requires accepted provider request and response identities", () => {
    const missingRequest = validCounselResponsePrecommit();
    missingRequest.trace.attempts[0].providerRequestId = null;
    missingRequest.modelMetadata.requestId = null;
    const missingResponse = validCounselResponsePrecommit();
    missingResponse.trace.attempts[0].providerResponseId = null;

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(missingRequest).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(missingResponse).success,
    ).toBe(false);
  });

  it("rejects counsel output hash, citation, and raw-count mismatches", () => {
    const wrongHash = validCounselResponsePrecommit();
    wrongHash.trace.outputHash = "f".repeat(64);
    wrongHash.trace.attempts[0].outputHash = "f".repeat(64);
    const wrongCitation = validCounselResponsePrecommit();
    wrongCitation.trace.acceptedCitations.factIds = ["fact:other"];
    const wrongCount = validCounselResponsePrecommit();
    wrongCount.trace.attempts[0].proposedCitationCount += 1;

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(wrongHash).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(wrongCitation).success,
    ).toBe(false);
    expect(
      HearingCounselResponsePrecommitSchema.safeParse(wrongCount).success,
    ).toBe(false);
  });

  it.each([
    "transcriptTurnIds",
    "sourceSegmentIds",
    "priorStatementIds",
    "issueIds",
    "instructionIds",
    "ruleIds",
    "settlementOfferIds",
  ] as const)("rejects unsupported/private counsel %s", (field) => {
    const envelope = validCounselResponsePrecommit();
    envelope.output.speechSegments[0].citations[field] = [`${field}:forbidden`];
    const outputHash = hashCounselResponseModelOutput(envelope.output);
    envelope.trace.outputHash = outputHash;
    envelope.trace.attempts[0].outputHash = outputHash;
    envelope.trace.attempts[0].proposedCitationCount =
      counselProposedCitationCount(envelope.output);

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it("rejects counsel usage not accounted for by its attempts", () => {
    const envelope = validCounselResponsePrecommit();
    if (envelope.trace.usage === null) {
      throw new Error("Fixture requires counsel-response usage");
    }
    envelope.trace.usage.inputTokens += 1;
    envelope.trace.usage.totalTokens += 1;
    envelope.modelMetadata.inputTokens = envelope.trace.usage.inputTokens;

    expect(
      HearingCounselResponsePrecommitSchema.safeParse(envelope).success,
    ).toBe(false);
  });

  it.each(["committedActionId", "committedEventId"] as const)(
    "rejects a counsel precommit with %s populated",
    (field) => {
      const envelope = validCounselResponsePrecommit();
      envelope.trace[field] = `${field}:already-committed`;

      expect(
        HearingCounselResponsePrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    },
  );

  it("accepts a Luna jury deliberation bound to the exact final-trial head", () => {
    const envelope = validJuryResponsePrecommit();

    expect(HearingJuryResponsePrecommitSchema.parse(envelope)).toEqual(
      envelope,
    );
    expect(envelope.trace.outputHash).toBe(
      hashJuryResponseModelOutput(envelope.output),
    );
    expect(envelope.trace.acceptedCitations).toEqual(
      juryResponseOutputCitations(envelope.output),
    );
  });

  it.each(["ownerId", "actionId", "eventId", "knowledgeView", "stateJson"])(
    "rejects forbidden jury precommit %s data",
    (field) => {
      expect(
        HearingJuryResponsePrecommitSchema.safeParse({
          ...validJuryResponsePrecommit(),
          [field]: "must-be-derived-or-revalidated-server-side",
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["trialId", "trial:other"],
    ["callId", "call:jury:other"],
    ["expectedStateVersion", 99],
    ["expectedLastEventId", "event:other"],
  ] as const)("rejects a mismatched jury trace %s", (field, value) => {
    const envelope = validJuryResponsePrecommit();
    Object.assign(envelope.trace, { [field]: value });

    expect(HearingJuryResponsePrecommitSchema.safeParse(envelope).success).toBe(
      false,
    );
  });

  it("rejects jury task, role, model, prompt, and knowledge-view tampering", () => {
    const wrongTask = validJuryResponsePrecommit();
    wrongTask.trace.task = "counsel_response";
    const wrongRole = validJuryResponsePrecommit();
    wrongRole.trace.actorRole = "counsel";
    const wrongModel = validJuryResponsePrecommit();
    wrongModel.trace.model = "gpt-5.6-terra";
    wrongModel.modelMetadata.model = "gpt-5.6-terra";
    const wrongPrompt = validJuryResponsePrecommit();
    wrongPrompt.trace.promptVersion = "role-responder.jury.prompt.v2";
    wrongPrompt.modelMetadata.promptVersion =
      "role-responder.jury.prompt.v2";
    const wrongKnowledge = validJuryResponsePrecommit();
    wrongKnowledge.trace.knowledgeScope.stateVersion = 41;

    for (const envelope of [
      wrongTask,
      wrongRole,
      wrongModel,
      wrongPrompt,
      wrongKnowledge,
    ]) {
      expect(
        HearingJuryResponsePrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });

  it("rejects jury hash, citation, raw-count, and output-length tampering", () => {
    const wrongHash = validJuryResponsePrecommit();
    wrongHash.trace.outputHash = "f".repeat(64);
    wrongHash.trace.attempts[0].outputHash = "f".repeat(64);
    const wrongCitation = validJuryResponsePrecommit();
    wrongCitation.trace.acceptedCitations.factIds = ["fact:other"];
    const wrongCount = validJuryResponsePrecommit();
    wrongCount.trace.attempts[0].proposedCitationCount += 1;
    const wrongLength = validJuryResponsePrecommit();
    wrongLength.trace.outputCharacterCount += 1;

    for (const envelope of [
      wrongHash,
      wrongCitation,
      wrongCount,
      wrongLength,
    ]) {
      expect(
        HearingJuryResponsePrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });

  it("rejects an unauditable jury citation even when hashes and counts match", () => {
    const envelope = validJuryResponsePrecommit();
    envelope.output.deliberationSegments[0].citations.transcriptTurnIds = [
      "turn:forbidden",
    ];
    const outputHash = hashJuryResponseModelOutput(envelope.output);
    envelope.trace.outputHash = outputHash;
    envelope.trace.attempts[0].outputHash = outputHash;
    envelope.trace.outputCharacterCount = JSON.stringify(
      envelope.output,
    ).length;
    envelope.trace.attempts[0].proposedCitationCount =
      juryProposedCitationCount(envelope.output);

    expect(HearingJuryResponsePrecommitSchema.safeParse(envelope).success).toBe(
      false,
    );
  });

  it("requires accepted jury provider identities and an uncommitted trace", () => {
    const missingResponse = validJuryResponsePrecommit();
    missingResponse.trace.attempts[0].providerResponseId = null;
    const committed = validJuryResponsePrecommit();
    committed.trace.committedActionId = "action:already-committed";

    expect(
      HearingJuryResponsePrecommitSchema.safeParse(missingResponse).success,
    ).toBe(false);
    expect(HearingJuryResponsePrecommitSchema.safeParse(committed).success).toBe(
      false,
    );
  });

  it("accepts a Terra debrief with exact cited turn-to-event bindings", () => {
    const envelope = validDebriefGeneratorPrecommit();

    expect(HearingDebriefGeneratorPrecommitSchema.parse(envelope)).toEqual(
      envelope,
    );
    expect(envelope.trace.outputHash).toBe(
      hashDebriefGeneratorModelOutput(envelope.output),
    );
    expect(envelope.trace.acceptedCitations).toEqual(
      debriefGeneratorOutputCitations(
        envelope.output,
        envelope.transcriptEventBindings,
      ),
    );
  });

  it.each([
    "ownerId",
    "actorId",
    "actionId",
    "eventId",
    "knowledgeView",
    "request",
    "stateJson",
  ])("rejects forbidden debrief precommit %s data", (field) => {
    expect(
      HearingDebriefGeneratorPrecommitSchema.safeParse({
        ...validDebriefGeneratorPrecommit(),
        [field]: "hidden-or-canonical-data-must-not-cross",
      }).success,
    ).toBe(false);
  });

  it("rejects missing, extra, duplicate, and stale debrief event bindings", () => {
    const missing = validDebriefGeneratorPrecommit();
    missing.transcriptEventBindings.pop();
    const extra = validDebriefGeneratorPrecommit();
    extra.transcriptEventBindings.push({
      turnId: "turn_zextra",
      sourceEventId: "event:extra",
    });
    const duplicate = validDebriefGeneratorPrecommit();
    duplicate.transcriptEventBindings.splice(1, 0, {
      ...duplicate.transcriptEventBindings[0],
    });
    const stale = validDebriefGeneratorPrecommit();
    stale.transcriptEventBindings[0].sourceEventId = "event:stale";

    for (const envelope of [missing, extra, duplicate, stale]) {
      expect(
        HearingDebriefGeneratorPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });

  it("rejects debrief head, task, role, model, prompt, and schema tampering", () => {
    const wrongHead = validDebriefGeneratorPrecommit();
    wrongHead.trace.inputEventIds = ["event:other"];
    const wrongTask = validDebriefGeneratorPrecommit();
    wrongTask.trace.callClass = "role_responder";
    wrongTask.trace.task = "jury_deliberation";
    const wrongRole = validDebriefGeneratorPrecommit();
    wrongRole.trace.actorRole = "jury";
    const wrongModel = validDebriefGeneratorPrecommit();
    wrongModel.trace.model = "gpt-5.6-luna";
    wrongModel.modelMetadata.model = "gpt-5.6-luna";
    const wrongPrompt = validDebriefGeneratorPrecommit();
    wrongPrompt.trace.promptVersion = "debrief-generator.prompt.v2";
    wrongPrompt.modelMetadata.promptVersion = "debrief-generator.prompt.v2";
    const wrongSchema = validDebriefGeneratorPrecommit();
    wrongSchema.trace.outputSchemaVersion = "debrief-generator.output.v2";
    wrongSchema.modelMetadata.schemaVersion =
      "debrief-generator.output.v2";

    for (const envelope of [
      wrongHead,
      wrongTask,
      wrongRole,
      wrongModel,
      wrongPrompt,
      wrongSchema,
    ]) {
      expect(
        HearingDebriefGeneratorPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });

  it("rejects debrief hash, citation, raw-count, usage, and commit tampering", () => {
    const wrongHash = validDebriefGeneratorPrecommit();
    wrongHash.trace.outputHash = "f".repeat(64);
    wrongHash.trace.attempts[0].outputHash = "f".repeat(64);
    const wrongCitation = validDebriefGeneratorPrecommit();
    wrongCitation.trace.acceptedCitations.eventIds = ["event:other"];
    const wrongCount = validDebriefGeneratorPrecommit();
    wrongCount.trace.attempts[0].proposedCitationCount += 1;
    const wrongUsage = validDebriefGeneratorPrecommit();
    if (wrongUsage.trace.usage === null) {
      throw new Error("Fixture requires debrief usage");
    }
    wrongUsage.trace.usage.inputTokens += 1;
    wrongUsage.trace.usage.totalTokens += 1;
    wrongUsage.modelMetadata.inputTokens =
      wrongUsage.trace.usage.inputTokens;
    const committed = validDebriefGeneratorPrecommit();
    committed.trace.committedEventId = "event:already-committed";

    for (const envelope of [
      wrongHash,
      wrongCitation,
      wrongCount,
      wrongUsage,
      committed,
    ]) {
      expect(
        HearingDebriefGeneratorPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });
});
