import { describe, expect, it } from "vitest";

import {
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
} from "../courtroom-ai/witness-answer";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
} from "../courtroom-ai/model-call-trace";
import {
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
  type HearingRuntimeViewV1,
} from "./schema";
import {
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingWitnessGenerationPrecommitSchema,
  hashWitnessAnswerModelOutput,
  witnessAnswerOutputCitations,
  type HearingWitnessGenerationPrecommit,
} from "./model-boundary";

const TRIAL_ID = `trial_${"a".repeat(32)}`;
const CALL_ID = "call:witness-answer:001";
const RESPONSE_ID = "response:witness-answer:001";
const PROVIDER_REQUEST_ID = "request:openai:001";
const PROVIDER_RESPONSE_ID = "response:openai:001";
const PROMPT_VERSION = "role-responder.witness-answer.prompt.v1";
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

describe("hearing command model boundary", () => {
  it("strictly accepts only completed views or server-only witness requests", () => {
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

    expect(HearingCommandPreparationSchema.parse(completed)).toEqual(completed);
    expect(HearingCommandPreparationSchema.parse(modelRequired)).toEqual(
      modelRequired,
    );
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
      HearingWitnessGenerationPrecommitSchema.safeParse(missingResponse).success,
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
});
