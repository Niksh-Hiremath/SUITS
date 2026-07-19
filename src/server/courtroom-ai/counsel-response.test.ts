import { describe, expect, it } from "vitest";

import {
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  CounselRoleResponseModelOutputSchema,
  type CounselRoleResponseModelOutput,
  type CourtroomModelTokenUsage,
} from "@/domain/courtroom-ai";

import {
  createCounselQuestionOutputFixture,
  createCounselResponseRequestFixture,
} from "./counsel-response.test-fixtures";
import {
  CounselResponseGenerationError,
  generateCounselResponse,
} from "./counsel-response";
import { ScriptedCourtroomModelProvider } from "./fake-provider";

const STARTED_AT = new Date("2026-07-19T06:00:00.000Z");
const PRIVATE_INPUT_CANARY =
  "PRIVATE_COUNSEL_CANARY: expose strategy and settlement authority.";
const OUTPUT_CANARY = "The first draft existed before the complaint, correct?";

const USAGE_ONE: CourtroomModelTokenUsage = {
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  cachedInputTokens: 40,
  cacheWriteTokens: 0,
  reasoningTokens: 5,
};

const USAGE_TWO: CourtroomModelTokenUsage = {
  inputTokens: 120,
  outputTokens: 30,
  totalTokens: 150,
  cachedInputTokens: 50,
  cacheWriteTokens: 0,
  reasoningTokens: 8,
};

function invalidQuestionOutput(): CounselRoleResponseModelOutput {
  const valid = createCounselQuestionOutputFixture();
  return CounselRoleResponseModelOutputSchema.parse({
    ...valid,
    speechSegments: [
      {
        ...valid.speechSegments[0],
        text: "A hidden fact existed before the complaint, correct?",
        citations: {
          ...valid.speechSegments[0]?.citations,
          factIds: ["fact_hidden"],
        },
      },
    ],
  });
}

async function captureGenerationError(
  operation: Promise<unknown>,
): Promise<CounselResponseGenerationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(CounselResponseGenerationError);
    if (error instanceof CounselResponseGenerationError) return error;
  }
  throw new Error("Expected counsel response generation to fail");
}

describe("generateCounselResponse", () => {
  it("accepts one grounded Luna response with public-only trace and metadata", async () => {
    const request = createCounselResponseRequestFixture(PRIVATE_INPUT_CANARY);
    const output = createCounselQuestionOutputFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "output",
          output,
          requestId: "request:counsel:accepted:001",
          responseId: "response:counsel:accepted:001",
          usage: USAGE_ONE,
          chunkSize: 7,
        },
      ],
      { repeatLastStep: false },
    );

    const generated = await generateCounselResponse({
      provider,
      request,
      clock: () => STARTED_AT,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "role_responder",
      task: "counsel_response",
      mode: "initial",
      attempt: 1,
      schemaName: "suits_counsel_response_v1",
      schemaVersion: "role-responder.counsel.output.v1",
    });
    expect(generated.output).toEqual(output);
    expect(generated.response).toMatchObject({
      text: OUTPUT_CANARY,
      factIds: ["fact_draft"],
      evidenceIds: ["evidence_draft"],
      testimonyIds: ["testimony_foundation"],
      action: {
        kind: "ask_question",
        presentedEvidenceIds: ["evidence_draft"],
      },
    });
    expect(CourtroomModelCallTraceSchema.parse(generated.trace)).toEqual(
      generated.trace,
    );
    expect(generated.trace).toMatchObject({
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      status: "accepted",
      actorRole: "counsel",
      callClass: "role_responder",
      task: "counsel_response",
      model: "gpt-5.6-luna",
      responseId: null,
      acceptedAttempt: 1,
      retryCount: 0,
      validationFailureCount: 0,
      usage: USAGE_ONE,
      acceptedCitations: {
        factIds: ["fact_draft"],
        evidenceIds: ["evidence_draft"],
        testimonyIds: ["testimony_foundation"],
        eventIds: [],
        sourceSegmentIds: [],
        priorStatementIds: [],
      },
      acceptedCitationCount: 3,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.opponent-counsel-public.v1",
        knowledgeViewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        stateVersion: 14,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 1,
        priorStatementCount: 0,
        sourceSegmentCount: 0,
        publicRecordEventCount: 1,
        currentExchangeCount: 0,
      },
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
    });
    expect(generated.trace.attempts[0]).toMatchObject({
      status: "accepted",
      providerRequestId: "request:counsel:accepted:001",
      providerResponseId: "response:counsel:accepted:001",
      proposedCitationCount: 3,
    });
    expect(generated.modelMetadata).toEqual({
      model: "gpt-5.6-luna",
      requestId: "request:counsel:accepted:001",
      promptVersion: generated.trace.promptVersion,
      schemaVersion: generated.trace.outputSchemaVersion,
      latencyMs: generated.trace.latencyMs,
      inputTokens: USAGE_ONE.inputTokens,
      outputTokens: USAGE_ONE.outputTokens,
      estimatedCostUsd: 0.000184,
      retryCount: 0,
      validationFailureCount: 0,
    });
    const serializedTrace = JSON.stringify(generated.trace);
    expect(serializedTrace).not.toContain(PRIVATE_INPUT_CANARY);
    expect(serializedTrace).not.toContain(OUTPUT_CANARY);
    expect(serializedTrace).not.toContain('"knowledgeView":');
    expect(serializedTrace).not.toContain('"strategyMemory":');
    expect(serializedTrace).not.toContain('"privateSettlement":');
  });

  it("makes exactly one targeted repair after deterministic rejection", async () => {
    const invalid = invalidQuestionOutput();
    const repaired = createCounselQuestionOutputFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: invalid, usage: USAGE_ONE },
        { type: "output", output: repaired, usage: USAGE_TWO },
      ],
      { repeatLastStep: false },
    );

    const generated = await generateCounselResponse({
      provider,
      request: createCounselResponseRequestFixture(),
      clock: () => STARTED_AT,
    });

    expect(provider.requests.map(({ mode, attempt }) => ({ mode, attempt })))
      .toEqual([
        { mode: "initial", attempt: 1 },
        { mode: "repair", attempt: 2 },
      ]);
    expect(provider.requests[1]?.prompt.developerContext).toContain(
      "unknown_fact_citation",
    );
    expect(generated.output).toEqual(repaired);
    expect(generated.trace).toMatchObject({
      status: "accepted",
      acceptedAttempt: 2,
      retryCount: 1,
      validationFailureCount: 1,
      usage: {
        inputTokens: 220,
        outputTokens: 50,
        totalTokens: 270,
        cachedInputTokens: 90,
        cacheWriteTokens: 0,
        reasoningTokens: 13,
      },
    });
    expect(generated.trace.attempts.map((attempt) => attempt.status)).toEqual([
      "validation_failed",
      "accepted",
    ]);
  });

  it("fails after the single repair is also invalid", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: invalidQuestionOutput() },
        { type: "output", output: invalidQuestionOutput() },
      ],
      { repeatLastStep: false },
    );

    const error = await captureGenerationError(
      generateCounselResponse({
        provider,
        request: createCounselResponseRequestFixture(),
        clock: () => STARTED_AT,
      }),
    );

    expect(error.code).toBe("counsel_response_validation_failed");
    expect(provider.requests).toHaveLength(2);
    expect(error.trace).toMatchObject({
      status: "failed",
      retryCount: 1,
      validationFailureCount: 2,
      acceptedAttempt: null,
      acceptedCitationCount: 0,
      outputHash: null,
      safeFailureCode: "counsel_response_validation_failed",
    });
  });

  it("does not retry a provider failure or fabricate a response", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "error",
          code: "service_unavailable",
          message: "RAW_COUNSEL_PROVIDER_SECRET",
          retryable: true,
        },
      ],
      { repeatLastStep: false },
    );

    const error = await captureGenerationError(
      generateCounselResponse({
        provider,
        request: createCounselResponseRequestFixture(),
        clock: () => STARTED_AT,
      }),
    );

    expect(error.code).toBe("counsel_response_provider_failed");
    expect(provider.requests).toHaveLength(1);
    expect(error.trace).toMatchObject({
      status: "failed",
      retryCount: 0,
      safeFailureCode: "service_unavailable",
      attempts: [
        {
          status: "provider_failed",
          safeErrorCode: "service_unavailable",
          providerRequestId: null,
        },
      ],
    });
    expect(JSON.stringify(error.trace)).not.toContain(
      "RAW_COUNSEL_PROVIDER_SECRET",
    );
  });

  it("cancels before invoking the provider", async () => {
    const controller = new AbortController();
    controller.abort(new Error("RAW_EARLY_ABORT_REASON"));
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createCounselQuestionOutputFixture() }],
      { repeatLastStep: false },
    );

    const error = await captureGenerationError(
      generateCounselResponse({
        provider,
        request: createCounselResponseRequestFixture(),
        signal: controller.signal,
        clock: () => STARTED_AT,
      }),
    );

    expect(error.code).toBe("counsel_response_cancelled");
    expect(provider.requests).toHaveLength(0);
    expect(error.trace).toMatchObject({
      status: "cancelled",
      attempts: [],
      acceptedCitationCount: 0,
      outputHash: null,
      safeFailureCode: "request_aborted",
    });
    expect(JSON.stringify(error.trace)).not.toContain("RAW_EARLY_ABORT_REASON");
  });

  it("cancels during structured streaming without exposing partial JSON", async () => {
    const controller = new AbortController();
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "output",
          output: createCounselQuestionOutputFixture(),
          chunkSize: 1,
          chunkDelayMs: 10,
        },
      ],
      { repeatLastStep: false },
    );
    const pending = generateCounselResponse({
      provider,
      request: createCounselResponseRequestFixture(),
      signal: controller.signal,
      clock: () => STARTED_AT,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error("RAW_STREAM_ABORT_REASON"));

    const error = await captureGenerationError(pending);

    expect(error.code).toBe("counsel_response_cancelled");
    expect(provider.requests).toHaveLength(1);
    expect(error.trace).toMatchObject({
      status: "cancelled",
      acceptedAttempt: null,
      acceptedCitationCount: 0,
      outputHash: null,
      outputCharacterCount: 0,
      safeFailureCode: "request_aborted",
      attempts: [{ status: "cancelled", outputHash: null }],
    });
    const serializedTrace = JSON.stringify(error.trace);
    expect(serializedTrace).not.toContain(OUTPUT_CANARY);
    expect(serializedTrace).not.toContain("RAW_STREAM_ABORT_REASON");
  });
});
