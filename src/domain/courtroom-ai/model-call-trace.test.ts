import { describe, expect, it } from "vitest";

import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
} from "./model-call-trace";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

function acceptedWitnessTrace() {
  return {
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: "call:witness-answer:001",
    trialId: "trial:001",
    responseId: "response:001",
    actorId: "actor:witness:rina",
    actorRole: "witness" as const,
    callClass: "role_responder" as const,
    task: "witness_answer" as const,
    inputEventIds: ["event:question:001"],
    expectedStateVersion: 8,
    expectedLastEventId: "event:request-response:001",
    provider: "openai",
    model: "gpt-5.6-luna" as const,
    providerProtocolVersion: "responses-api.v1",
    promptVersion: "role-responder.witness.v1",
    outputSchemaVersion: "witness-answer.output.v1",
    knowledgeScope: {
      knowledgeSchemaVersion: "knowledge-view.v2",
      knowledgeViewHash: HASH_A,
      stateVersion: 8,
      factCount: 4,
      evidenceCount: 2,
      testimonyCount: 3,
      priorStatementCount: 1,
      sourceSegmentCount: 0,
      publicRecordEventCount: 5,
      currentExchangeCount: 1,
    },
    promptAudit: {
      stablePrefixHash: HASH_B,
      trustedContextHash: HASH_C,
      untrustedInputHash: HASH_D,
      inputCharacterCount: 2_410,
    },
    status: "accepted" as const,
    startedAt: "2026-07-19T04:00:00.000Z",
    completedAt: "2026-07-19T04:00:01.250Z",
    latencyMs: 1_250,
    firstStructuredDeltaMs: 320,
    firstAcceptedSegmentMs: 610,
    retryCount: 1,
    validationFailureCount: 1,
    estimatedCostUsd: 0.0012,
    usage: {
      inputTokens: 600,
      outputTokens: 120,
      totalTokens: 720,
      cachedInputTokens: 250,
      cacheWriteTokens: 0,
      reasoningTokens: 40,
    },
    acceptedAttempt: 2,
    acceptedCitations: {
      factIds: ["fact:complaint-date"],
      evidenceIds: ["evidence:email"],
      testimonyIds: [],
      eventIds: ["event:question:001"],
      sourceSegmentIds: [],
      priorStatementIds: ["statement:rina:001"],
    },
    acceptedCitationCount: 4,
    outputHash: HASH_A,
    outputCharacterCount: 184,
    committedActionId: "action:answer:001",
    committedEventId: "event:action:answer:001",
    safeFailureCode: null,
    attempts: [
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 1,
        mode: "initial" as const,
        status: "validation_failed" as const,
        providerRequestId: "req_001",
        providerResponseId: "resp_001",
        startedAt: "2026-07-19T04:00:00.000Z",
        completedAt: "2026-07-19T04:00:00.600Z",
        latencyMs: 600,
        firstStructuredDeltaMs: 300,
        streamEventCount: 8,
        structuredDeltaCount: 2,
        streamedCharacterCount: 190,
        outputHash: HASH_B,
        proposedCitationCount: 1,
        usage: {
          inputTokens: 300,
          outputTokens: 60,
          totalTokens: 360,
          cachedInputTokens: 125,
          cacheWriteTokens: 0,
          reasoningTokens: 20,
        },
        validationIssueCodes: ["citation.unknown_fact"],
        safeErrorCode: null,
      },
      {
        schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 2,
        mode: "repair" as const,
        status: "accepted" as const,
        providerRequestId: "req_002",
        providerResponseId: "resp_002",
        startedAt: "2026-07-19T04:00:00.610Z",
        completedAt: "2026-07-19T04:00:01.250Z",
        latencyMs: 640,
        firstStructuredDeltaMs: 280,
        streamEventCount: 9,
        structuredDeltaCount: 3,
        streamedCharacterCount: 184,
        outputHash: HASH_A,
        proposedCitationCount: 4,
        usage: {
          inputTokens: 300,
          outputTokens: 60,
          totalTokens: 360,
          cachedInputTokens: 125,
          cacheWriteTokens: 0,
          reasoningTokens: 20,
        },
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  };
}

describe("courtroom model-call traces", () => {
  it("accepts a redacted Luna trace with timing, usage, repair, and citations", () => {
    const trace = acceptedWitnessTrace();

    expect(CourtroomModelCallTraceSchema.parse(trace)).toEqual(trace);
  });

  it("accepts Terra only for compilation and final coaching tasks", () => {
    const base = acceptedWitnessTrace();
    const debrief = {
      ...base,
      callId: "call:debrief:001",
      callClass: "debrief_generator" as const,
      task: "generate_debrief" as const,
      actorId: "actor:debrief",
      actorRole: "debrief" as const,
      responseId: null,
      model: "gpt-5.6-terra" as const,
    };

    expect(CourtroomModelCallTraceSchema.safeParse(debrief).success).toBe(true);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...debrief,
        model: "gpt-5.6-luna",
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        model: "gpt-5.6-terra",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid call-class/task combinations", () => {
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...acceptedWitnessTrace(),
        callClass: "negotiation_agent",
      }).success,
    ).toBe(false);
  });

  it("strictly rejects raw prompts, KnowledgeViews, output, and provider errors", () => {
    const base = acceptedWitnessTrace();

    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        rawPrompt: "secret prompt",
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        knowledgeScope: {
          ...base.knowledgeScope,
          knowledgeView: { hiddenFacts: ["do not persist"] },
        },
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        attempts: [
          {
            ...base.attempts[0],
            upstreamErrorMessage: "raw provider exception",
          },
          base.attempts[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        rawOutput: "model answer",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed hashes, duplicate citations, and inconsistent counts", () => {
    const base = acceptedWitnessTrace();

    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        promptAudit: { ...base.promptAudit, trustedContextHash: "not-a-hash" },
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        acceptedCitations: {
          ...base.acceptedCitations,
          factIds: ["fact:complaint-date", "fact:complaint-date"],
        },
        acceptedCitationCount: 5,
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        validationFailureCount: 0,
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        usage: { ...base.usage, totalTokens: 719 },
      }).success,
    ).toBe(false);
  });

  it("rejects impossible timing, attempt order, and terminal status metadata", () => {
    const base = acceptedWitnessTrace();

    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        firstAcceptedSegmentMs: 200,
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        attempts: [base.attempts[1], base.attempts[0]],
      }).success,
    ).toBe(false);
    expect(
      CourtroomModelCallTraceSchema.safeParse({
        ...base,
        status: "failed",
        acceptedAttempt: null,
        safeFailureCode: null,
      }).success,
    ).toBe(false);
  });
});
