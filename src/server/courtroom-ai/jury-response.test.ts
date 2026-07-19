import { describe, expect, it } from "vitest";

import {
  JuryRoleResponseModelOutputSchema,
  type JuryRoleResponseModelOutput,
} from "@/domain/courtroom-ai/call-contracts";
import {
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  type CourtroomModelTokenUsage,
} from "@/domain/courtroom-ai/model-call-trace";
import {
  JURY_RESPONSE_INJECTION_CANARY,
  createJuryResponseOutputFixture,
  createJuryResponseRequestFixture,
} from "@/domain/courtroom-ai/jury-response.test-fixtures";

import { ScriptedCourtroomModelProvider } from "./fake-provider";
import {
  JuryResponseGenerationError,
  generateJuryResponse,
} from "./jury-response";

const STARTED_AT = new Date("2026-07-19T08:00:00.000Z");
const OUTPUT_CANARY =
  "The admitted delivery record and testimony support the timing.";

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

function invalidJuryOutput(): JuryRoleResponseModelOutput {
  const valid = createJuryResponseOutputFixture();
  return JuryRoleResponseModelOutputSchema.parse({
    ...valid,
    deliberationSegments: [
      {
        ...valid.deliberationSegments[0],
        text: "A hidden fact controls the result.",
        citations: {
          ...valid.deliberationSegments[0]?.citations,
          factIds: ["fact_hidden"],
        },
      },
    ],
  });
}

async function captureGenerationError(
  operation: Promise<unknown>,
): Promise<JuryResponseGenerationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(JuryResponseGenerationError);
    if (error instanceof JuryResponseGenerationError) return error;
  }
  throw new Error("Expected jury response generation to fail");
}

describe("generateJuryResponse", () => {
  it("accepts one grounded streamed Luna response with a redacted trace", async () => {
    const request = createJuryResponseRequestFixture(
      JURY_RESPONSE_INJECTION_CANARY,
    );
    const output = createJuryResponseOutputFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "output",
          output,
          requestId: "request:jury:accepted:001",
          responseId: "response:jury:accepted:001",
          usage: USAGE_ONE,
          chunkSize: 7,
        },
      ],
      { repeatLastStep: false },
    );

    const generated = await generateJuryResponse({
      provider,
      request,
      clock: () => STARTED_AT,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "role_responder",
      task: "jury_deliberation",
      mode: "initial",
      attempt: 1,
      schemaName: "suits_jury_response_v1",
      schemaVersion: "role-responder.jury.output.v1",
    });
    expect(generated.output).toEqual(output);
    expect(generated.response).toMatchObject({
      deliberationText: OUTPUT_CANARY,
      findings: [
        {
          issueId: "issue_causation",
          citations: {
            factIds: ["fact_admitted"],
            evidenceIds: ["evidence_admitted"],
            testimonyIds: ["testimony_active"],
            instructionIds: ["instruction_burden"],
          },
        },
      ],
      recommendation: {
        outcome: "user_prevails",
        citations: {
          instructionIds: ["instruction_burden"],
        },
      },
    });
    expect(CourtroomModelCallTraceSchema.parse(generated.trace)).toEqual(
      generated.trace,
    );
    expect(generated.trace).toMatchObject({
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      status: "accepted",
      actorRole: "jury",
      callClass: "role_responder",
      task: "jury_deliberation",
      model: "gpt-5.6-luna",
      responseId: null,
      acceptedAttempt: 1,
      retryCount: 0,
      validationFailureCount: 0,
      usage: USAGE_ONE,
      acceptedCitations: {
        factIds: ["fact_admitted"],
        evidenceIds: ["evidence_admitted"],
        testimonyIds: ["testimony_active"],
        eventIds: [],
        sourceSegmentIds: [],
        priorStatementIds: [],
      },
      acceptedCitationCount: 3,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        stateVersion: 42,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 1,
        priorStatementCount: 0,
        sourceSegmentCount: 2,
        publicRecordEventCount: 1,
        currentExchangeCount: 0,
      },
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
    });
    expect(generated.trace.attempts[0]).toMatchObject({
      status: "accepted",
      providerRequestId: "request:jury:accepted:001",
      providerResponseId: "response:jury:accepted:001",
      proposedCitationCount: 8,
    });
    expect(generated.modelMetadata).toEqual({
      model: "gpt-5.6-luna",
      requestId: "request:jury:accepted:001",
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
    expect(serializedTrace).not.toContain(JURY_RESPONSE_INJECTION_CANARY);
    expect(serializedTrace).not.toContain(OUTPUT_CANARY);
    expect(serializedTrace).not.toContain('"knowledgeView":');
    expect(serializedTrace).not.toContain('"decisionManifest":');
  });

  it("makes exactly one targeted repair after deterministic rejection", async () => {
    const repaired = createJuryResponseOutputFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: invalidJuryOutput(), usage: USAGE_ONE },
        { type: "output", output: repaired, usage: USAGE_TWO },
      ],
      { repeatLastStep: false },
    );

    const generated = await generateJuryResponse({
      provider,
      request: createJuryResponseRequestFixture(),
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
        { type: "output", output: invalidJuryOutput() },
        { type: "output", output: invalidJuryOutput() },
      ],
      { repeatLastStep: false },
    );

    const error = await captureGenerationError(
      generateJuryResponse({
        provider,
        request: createJuryResponseRequestFixture(),
        clock: () => STARTED_AT,
      }),
    );

    expect(error.code).toBe("jury_response_validation_failed");
    expect(provider.requests).toHaveLength(2);
    expect(error.trace).toMatchObject({
      status: "failed",
      retryCount: 1,
      validationFailureCount: 2,
      acceptedAttempt: null,
      acceptedCitationCount: 0,
      outputHash: null,
      safeFailureCode: "jury_response_validation_failed",
    });
  });

  it("does not retry a provider failure or expose its raw message", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "error",
          code: "service_unavailable",
          message: "RAW_JURY_PROVIDER_SECRET",
          retryable: true,
        },
      ],
      { repeatLastStep: false },
    );

    const error = await captureGenerationError(
      generateJuryResponse({
        provider,
        request: createJuryResponseRequestFixture(),
        clock: () => STARTED_AT,
      }),
    );

    expect(error.code).toBe("jury_response_provider_failed");
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
      "RAW_JURY_PROVIDER_SECRET",
    );
  });

  it("cancels before invoking the provider", async () => {
    const controller = new AbortController();
    controller.abort(new Error("RAW_EARLY_ABORT_REASON"));
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createJuryResponseOutputFixture() }],
      { repeatLastStep: false },
    );

    const error = await captureGenerationError(
      generateJuryResponse({
        provider,
        request: createJuryResponseRequestFixture(),
        signal: controller.signal,
        clock: () => STARTED_AT,
      }),
    );

    expect(error.code).toBe("jury_response_cancelled");
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
          output: createJuryResponseOutputFixture(),
          chunkSize: 1,
          chunkDelayMs: 10,
        },
      ],
      { repeatLastStep: false },
    );
    const pending = generateJuryResponse({
      provider,
      request: createJuryResponseRequestFixture(),
      signal: controller.signal,
      clock: () => STARTED_AT,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error("RAW_STREAM_ABORT_REASON"));

    const error = await captureGenerationError(pending);

    expect(error.code).toBe("jury_response_cancelled");
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
