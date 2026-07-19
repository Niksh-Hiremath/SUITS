import { describe, expect, it } from "vitest";

import { sha256Utf8 } from "../case-graph";
import {
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  ObjectionRulingModelOutputSchema,
} from "../courtroom-ai/call-contracts";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
} from "../courtroom-ai/model-call-trace";
import {
  HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OBJECTION_RULING_PROMPT_VERSION,
  HEARING_OBJECTION_RULING_PROVIDER_PROTOCOL_VERSION,
  HearingObjectionRulingPrecommitSchema,
  hashObjectionRulingModelOutput,
  objectionRulingOutputCitations,
  type HearingObjectionRulingPrecommit,
} from "./objection-boundary";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function outputFixture() {
  return ObjectionRulingModelOutputSchema.parse({
    schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
    ruling: "sustained",
    remedy: "cancel_response",
    reason: "The question calls for an out-of-court statement.",
    citations: {
      factIds: ["fact:dispatch"],
      evidenceIds: ["evidence:dispatch-log"],
      testimonyIds: [],
      transcriptTurnIds: ["turn:question"],
      sourceSegmentIds: ["source:dispatch"],
      priorStatementIds: [],
      issueIds: [],
      instructionIds: [],
      ruleIds: [],
      settlementOfferIds: [],
    },
    performance: {
      activity: "ruling",
      emotion: "neutral",
      intensity: 0.5,
      gazeTarget: "questioning_counsel",
      gesture: "gavel",
      speakingStyle: "formal",
    },
  });
}

function proposedCitationCount(output: ReturnType<typeof outputFixture>) {
  return Object.values(output.citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function validPrecommit(): HearingObjectionRulingPrecommit {
  const output = outputFixture();
  const questionEventBinding = {
    turnId: "turn:question",
    sourceEventId: "event:question",
  };
  const outputHash = hashObjectionRulingModelOutput(output);
  const acceptedCitations = objectionRulingOutputCitations(
    output,
    questionEventBinding,
  );
  const outputCharacterCount = JSON.stringify(output).length;
  const usage = {
    inputTokens: 140,
    outputTokens: 35,
    totalTokens: 175,
    cachedInputTokens: 50,
    cacheWriteTokens: 0,
    reasoningTokens: 8,
  };
  const latencyMs = 480;
  const providerRequestId = "request:objection:001";
  return HearingObjectionRulingPrecommitSchema.parse({
    schemaVersion: HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
    trialId: "trial:objection",
    callId: "call:objection:001",
    decisionId: "decision:objection:001",
    expectedStateVersion: 12,
    expectedLastEventId: "event:interruption",
    objectionEventId: "event:objection",
    responseId: "response:witness:001",
    questionEventBinding,
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId: providerRequestId,
      promptVersion: HEARING_OBJECTION_RULING_PROMPT_VERSION,
      schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: 0.0012,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId: "call:objection:001",
      trialId: "trial:objection",
      responseId: "response:witness:001",
      actorId: "actor:judge",
      actorRole: "judge",
      callClass: "objection_resolver",
      task: "resolve_objection",
      inputEventIds: [
        "event:interruption",
        "event:objection",
        "event:question",
      ],
      expectedStateVersion: 12,
      expectedLastEventId: "event:interruption",
      provider: "openai-responses",
      model: "gpt-5.6-luna",
      providerProtocolVersion:
        HEARING_OBJECTION_RULING_PROVIDER_PROTOCOL_VERSION,
      promptVersion: HEARING_OBJECTION_RULING_PROMPT_VERSION,
      outputSchemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: sha256Utf8("judge-view"),
        stateVersion: 12,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 0,
        priorStatementCount: 0,
        sourceSegmentCount: 1,
        publicRecordEventCount: 0,
        currentExchangeCount: 1,
      },
      promptAudit: {
        stablePrefixHash: HASH_A,
        trustedContextHash: HASH_B,
        untrustedInputHash: HASH_C,
        inputCharacterCount: 2_400,
      },
      status: "accepted",
      startedAt: "2026-07-19T07:00:00.000Z",
      completedAt: "2026-07-19T07:00:00.480Z",
      latencyMs,
      firstStructuredDeltaMs: 150,
      firstAcceptedSegmentMs: null,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd: 0.0012,
      usage,
      acceptedAttempt: 1,
      acceptedCitations,
      acceptedCitationCount: 4,
      outputHash,
      outputCharacterCount,
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
      attempts: [
        {
          schemaVersion:
            COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
          attempt: 1,
          mode: "initial",
          status: "accepted",
          providerRequestId,
          providerResponseId: "response:openai:objection:001",
          startedAt: "2026-07-19T07:00:00.000Z",
          completedAt: "2026-07-19T07:00:00.480Z",
          latencyMs,
          firstStructuredDeltaMs: 150,
          streamEventCount: 12,
          structuredDeltaCount: 5,
          streamedCharacterCount: outputCharacterCount,
          outputHash,
          proposedCitationCount: proposedCitationCount(output),
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

function validRepairedPrecommit(): HearingObjectionRulingPrecommit {
  const envelope = validPrecommit();
  const acceptedAttempt = envelope.trace.attempts[0];
  if (acceptedAttempt === undefined) {
    throw new Error("Fixture requires an accepted attempt");
  }
  const emptyUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };

  envelope.trace.attempts = [
    {
      ...acceptedAttempt,
      status: "validation_failed",
      providerRequestId: "request:objection:invalid:001",
      providerResponseId: "response:openai:objection:invalid:001",
      outputHash: HASH_A,
      proposedCitationCount: 0,
      usage: emptyUsage,
      validationIssueCodes: ["invalid_ruling_semantics"],
    },
    {
      ...acceptedAttempt,
      attempt: 2,
      mode: "repair",
    },
  ];
  envelope.trace.acceptedAttempt = 2;
  envelope.trace.retryCount = 1;
  envelope.trace.validationFailureCount = 1;
  envelope.modelMetadata.retryCount = 1;
  envelope.modelMetadata.validationFailureCount = 1;

  return HearingObjectionRulingPrecommitSchema.parse(envelope);
}

describe("HearingObjectionRulingPrecommitSchema", () => {
  it("accepts one uncommitted Luna ruling with exact event bindings", () => {
    const envelope = validPrecommit();

    expect(HearingObjectionRulingPrecommitSchema.parse(envelope)).toEqual(
      envelope,
    );
    expect(envelope.trace.outputHash).toBe(
      hashObjectionRulingModelOutput(envelope.output),
    );
    expect(envelope.trace.acceptedCitations).toEqual(
      objectionRulingOutputCitations(
        envelope.output,
        envelope.questionEventBinding,
      ),
    );
  });

  it("pins the provider protocol and permits at most one validation repair", () => {
    const repaired = validRepairedPrecommit();
    expect(HearingObjectionRulingPrecommitSchema.parse(repaired)).toEqual(
      repaired,
    );

    const wrongProtocol = validPrecommit();
    wrongProtocol.trace.providerProtocolVersion =
      "courtroom-model-provider.v2";

    const providerRetry = validRepairedPrecommit();
    const providerFailure = providerRetry.trace.attempts[0];
    if (providerFailure === undefined) {
      throw new Error("Fixture requires a failed initial attempt");
    }
    providerFailure.status = "provider_failed";
    providerFailure.outputHash = null;
    providerFailure.validationIssueCodes = [];
    providerFailure.safeErrorCode = "provider_failed";
    providerRetry.trace.validationFailureCount = 0;
    providerRetry.modelMetadata.validationFailureCount = 0;

    const tooManyRepairs = validRepairedPrecommit();
    const firstFailure = tooManyRepairs.trace.attempts[0];
    const acceptedAttempt = tooManyRepairs.trace.attempts[1];
    if (firstFailure === undefined || acceptedAttempt === undefined) {
      throw new Error("Fixture requires one failed and one accepted attempt");
    }
    tooManyRepairs.trace.attempts = [
      firstFailure,
      {
        ...firstFailure,
        attempt: 2,
        mode: "repair",
        providerRequestId: "request:objection:invalid:002",
        providerResponseId: "response:openai:objection:invalid:002",
      },
      {
        ...acceptedAttempt,
        attempt: 3,
      },
    ];
    tooManyRepairs.trace.acceptedAttempt = 3;
    tooManyRepairs.trace.retryCount = 2;
    tooManyRepairs.trace.validationFailureCount = 2;
    tooManyRepairs.modelMetadata.retryCount = 2;
    tooManyRepairs.modelMetadata.validationFailureCount = 2;

    expect(CourtroomModelCallTraceSchema.safeParse(wrongProtocol.trace).success).toBe(
      true,
    );
    expect(CourtroomModelCallTraceSchema.safeParse(providerRetry.trace).success).toBe(
      true,
    );
    expect(CourtroomModelCallTraceSchema.safeParse(tooManyRepairs.trace).success).toBe(
      true,
    );
    for (const envelope of [wrongProtocol, providerRetry, tooManyRepairs]) {
      expect(
        HearingObjectionRulingPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });

  it.each([
    "ownerId",
    "actorId",
    "actionId",
    "eventId",
    "interruptId",
    "knowledgeView",
    "request",
    "stateJson",
  ])("rejects forbidden precommit %s data", (field) => {
    expect(
      HearingObjectionRulingPrecommitSchema.safeParse({
        ...validPrecommit(),
        [field]: "canonical-or-secret-data",
      }).success,
    ).toBe(false);
  });

  it("requires the decision and exact response/head/input-event bindings", () => {
    const missingDecision = {
      ...validPrecommit(),
      decisionId: undefined,
    };
    const wrongResponse = validPrecommit();
    wrongResponse.trace.responseId = "response:other";
    const wrongHead = validPrecommit();
    wrongHead.trace.expectedLastEventId = "event:other";
    const wrongInputs = validPrecommit();
    wrongInputs.trace.inputEventIds = [
      "event:interruption",
      "event:other",
      "event:question",
    ];

    for (const envelope of [
      missingDecision,
      wrongResponse,
      wrongHead,
      wrongInputs,
    ]) {
      expect(
        HearingObjectionRulingPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });

  it("rejects stale question-turn and question-event bindings", () => {
    const wrongTurn = validPrecommit();
    wrongTurn.questionEventBinding.turnId = "turn:other";
    const wrongEvent = validPrecommit();
    wrongEvent.questionEventBinding.sourceEventId = "event:other-question";

    expect(
      HearingObjectionRulingPrecommitSchema.safeParse(wrongTurn).success,
    ).toBe(false);
    expect(
      HearingObjectionRulingPrecommitSchema.safeParse(wrongEvent).success,
    ).toBe(false);
  });

  it("rejects resolver identity, role, model, prompt, and schema tampering", () => {
    const wrongTask = validPrecommit();
    wrongTask.trace.callClass = "role_responder";
    wrongTask.trace.task = "judge_response";
    const wrongRole = validPrecommit();
    wrongRole.trace.actorRole = "counsel";
    const wrongModel = validPrecommit();
    wrongModel.trace.model = "gpt-5.6-terra";
    wrongModel.modelMetadata.model = "gpt-5.6-terra";
    const wrongPrompt = validPrecommit();
    wrongPrompt.trace.promptVersion = "objection-resolver.ruling.prompt.v2";
    wrongPrompt.modelMetadata.promptVersion =
      "objection-resolver.ruling.prompt.v2";
    const wrongSchema = validPrecommit();
    wrongSchema.trace.outputSchemaVersion =
      "objection-resolver.ruling.output.v2";
    wrongSchema.modelMetadata.schemaVersion =
      "objection-resolver.ruling.output.v2";

    for (const envelope of [
      wrongTask,
      wrongRole,
      wrongModel,
      wrongPrompt,
      wrongSchema,
    ]) {
      expect(
        HearingObjectionRulingPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });

  it("rejects output hash, citation, raw-count, and length tampering", () => {
    const wrongHash = validPrecommit();
    wrongHash.trace.outputHash = "f".repeat(64);
    wrongHash.trace.attempts[0].outputHash = "f".repeat(64);
    const wrongCitation = validPrecommit();
    wrongCitation.trace.acceptedCitations.eventIds = ["event:other"];
    const wrongCount = validPrecommit();
    wrongCount.trace.attempts[0].proposedCitationCount += 1;
    const wrongLength = validPrecommit();
    wrongLength.trace.outputCharacterCount += 1;

    for (const envelope of [
      wrongHash,
      wrongCitation,
      wrongCount,
      wrongLength,
    ]) {
      expect(
        HearingObjectionRulingPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });

  it("rejects usage, provider identity, semantic, and commit tampering", () => {
    const wrongUsage = validPrecommit();
    if (wrongUsage.trace.usage === null) {
      throw new Error("Fixture requires usage");
    }
    wrongUsage.trace.usage.inputTokens += 1;
    wrongUsage.trace.usage.totalTokens += 1;
    wrongUsage.modelMetadata.inputTokens =
      wrongUsage.trace.usage.inputTokens;
    const missingProviderResponse = validPrecommit();
    missingProviderResponse.trace.attempts[0].providerResponseId = null;
    const wrongRemedy = validPrecommit();
    wrongRemedy.output.remedy = "none";
    const committed = validPrecommit();
    committed.trace.committedEventId = "event:already-committed";

    for (const envelope of [
      wrongUsage,
      missingProviderResponse,
      wrongRemedy,
      committed,
    ]) {
      expect(
        HearingObjectionRulingPrecommitSchema.safeParse(envelope).success,
      ).toBe(false);
    }
  });
});
