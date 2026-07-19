import { describe, expect, it } from "vitest";

import {
  DebriefGeneratorModelOutputSchema,
  type DebriefGeneratorModelOutput,
} from "@/domain/courtroom-ai/call-contracts";
import {
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  type CourtroomModelTokenUsage,
} from "@/domain/courtroom-ai/model-call-trace";
import {
  DEBRIEF_GENERATOR_INJECTION_CANARY,
  createDebriefCitationFixture,
  createDebriefGeneratorOutputFixture,
  createDebriefGeneratorRequestFixture,
} from "@/domain/courtroom-ai/debrief-generator.test-fixtures";

import { ScriptedCourtroomModelProvider } from "./fake-provider";
import { DebriefGenerationError, generateDebrief } from "./debrief-generator";

const STARTED_AT = new Date("2026-07-19T09:00:00.000Z");
const OUTPUT_CANARY = "The examination used an efficient exhibit foundation.";

const USAGE_ONE: CourtroomModelTokenUsage = {
  inputTokens: 600,
  outputTokens: 200,
  totalTokens: 800,
  cachedInputTokens: 100,
  cacheWriteTokens: 0,
  reasoningTokens: 40,
};

const USAGE_TWO: CourtroomModelTokenUsage = {
  inputTokens: 650,
  outputTokens: 180,
  totalTokens: 830,
  cachedInputTokens: 120,
  cacheWriteTokens: 0,
  reasoningTokens: 30,
};

function invalidDebriefOutput(): DebriefGeneratorModelOutput {
  const valid = createDebriefGeneratorOutputFixture();
  return DebriefGeneratorModelOutputSchema.parse({
    ...valid,
    improvedClosing: {
      segments: [
        {
          text: "Use hidden authoring truth as though it were admitted.",
          citations: createDebriefCitationFixture({
            hiddenFactIds: ["fact_hidden"],
          }),
        },
      ],
    },
  });
}

async function captureGenerationError(
  operation: Promise<unknown>,
): Promise<DebriefGenerationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(DebriefGenerationError);
    if (error instanceof DebriefGenerationError) return error;
  }
  throw new Error("Expected debrief generation to fail");
}

describe("generateDebrief", () => {
  it("accepts a grounded streamed Terra artifact with safe stratum trace mapping", async () => {
    const request = createDebriefGeneratorRequestFixture(
      DEBRIEF_GENERATOR_INJECTION_CANARY,
    );
    const output = createDebriefGeneratorOutputFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "output",
          output,
          requestId: "request:debrief:accepted:001",
          responseId: "response:debrief:accepted:001",
          usage: USAGE_ONE,
          chunkSize: 11,
        },
      ],
      { repeatLastStep: false },
    );

    const generated = await generateDebrief({
      provider,
      request,
      clock: () => STARTED_AT,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "debrief_generator",
      task: "generate_debrief",
      mode: "initial",
      attempt: 1,
      schemaName: "suits_final_debrief_v1",
      schemaVersion: "debrief-generator.output.v1",
    });
    expect(generated.output).toEqual(output);
    expect(CourtroomModelCallTraceSchema.parse(generated.trace)).toEqual(
      generated.trace,
    );
    expect(generated.trace).toMatchObject({
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      status: "accepted",
      actorRole: "debrief",
      callClass: "debrief_generator",
      task: "generate_debrief",
      model: "gpt-5.6-terra",
      responseId: null,
      acceptedAttempt: 1,
      retryCount: 0,
      validationFailureCount: 0,
      usage: USAGE_ONE,
      acceptedCitations: {
        factIds: [
          "fact_admitted",
          "fact_disputed",
          "fact_excluded",
          "fact_hidden",
        ],
        evidenceIds: [
          "evidence_admitted",
          "evidence_excluded",
          "evidence_unadmitted",
        ],
        testimonyIds: ["testimony_active", "testimony_stricken"],
        eventIds: ["event:answer", "event:question"],
        sourceSegmentIds: ["segment_hidden"],
        priorStatementIds: [],
      },
      acceptedCitationCount: 12,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        stateVersion: 42,
        factCount: 4,
        evidenceCount: 3,
        testimonyCount: 2,
        priorStatementCount: 0,
        sourceSegmentCount: 2,
        publicRecordEventCount: 6,
        currentExchangeCount: 0,
      },
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
    });
    expect(generated.trace.attempts[0]).toMatchObject({
      status: "accepted",
      providerRequestId: "request:debrief:accepted:001",
      providerResponseId: "response:debrief:accepted:001",
    });
    expect(generated.trace.attempts[0]?.proposedCitationCount).toBeGreaterThan(
      generated.trace.acceptedCitationCount,
    );
    expect(generated.modelMetadata).toMatchObject({
      model: "gpt-5.6-terra",
      requestId: "request:debrief:accepted:001",
      promptVersion: generated.trace.promptVersion,
      schemaVersion: generated.trace.outputSchemaVersion,
      retryCount: 0,
      validationFailureCount: 0,
    });
    const serializedTrace = JSON.stringify(generated.trace);
    expect(serializedTrace).not.toContain(DEBRIEF_GENERATOR_INJECTION_CANARY);
    expect(serializedTrace).not.toContain(OUTPUT_CANARY);
    expect(serializedTrace).not.toContain('"knowledgeView":');
    expect(serializedTrace).not.toContain(
      "Hidden authoring truth for coaching only",
    );
  });

  it("makes exactly one targeted repair after deterministic rejection", async () => {
    const repaired = createDebriefGeneratorOutputFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: invalidDebriefOutput(), usage: USAGE_ONE },
        { type: "output", output: repaired, usage: USAGE_TWO },
      ],
      { repeatLastStep: false },
    );

    const generated = await generateDebrief({
      provider,
      request: createDebriefGeneratorRequestFixture(),
      clock: () => STARTED_AT,
    });

    expect(
      provider.requests.map(({ mode, attempt }) => ({ mode, attempt })),
    ).toEqual([
      { mode: "initial", attempt: 1 },
      { mode: "repair", attempt: 2 },
    ]);
    expect(provider.requests[1]?.prompt.developerContext).toContain(
      "semantic_contract_invalid",
    );
    expect(generated.output).toEqual(repaired);
    expect(generated.trace).toMatchObject({
      status: "accepted",
      acceptedAttempt: 2,
      retryCount: 1,
      validationFailureCount: 1,
      usage: {
        inputTokens: 1_250,
        outputTokens: 380,
        totalTokens: 1_630,
        cachedInputTokens: 220,
        cacheWriteTokens: 0,
        reasoningTokens: 70,
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
        { type: "output", output: invalidDebriefOutput() },
        { type: "output", output: invalidDebriefOutput() },
      ],
      { repeatLastStep: false },
    );

    const error = await captureGenerationError(
      generateDebrief({
        provider,
        request: createDebriefGeneratorRequestFixture(),
        clock: () => STARTED_AT,
      }),
    );

    expect(error.code).toBe("debrief_generation_validation_failed");
    expect(provider.requests).toHaveLength(2);
    expect(error.trace).toMatchObject({
      status: "failed",
      retryCount: 1,
      validationFailureCount: 2,
      acceptedAttempt: null,
      acceptedCitationCount: 0,
      outputHash: null,
      safeFailureCode: "debrief_generation_validation_failed",
    });
  });

  it("does not retry a provider failure or expose its raw message", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "error",
          code: "service_unavailable",
          message: "RAW_DEBRIEF_PROVIDER_SECRET",
          retryable: true,
        },
      ],
      { repeatLastStep: false },
    );

    const error = await captureGenerationError(
      generateDebrief({
        provider,
        request: createDebriefGeneratorRequestFixture(),
        clock: () => STARTED_AT,
      }),
    );

    expect(error.code).toBe("debrief_generation_provider_failed");
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
      "RAW_DEBRIEF_PROVIDER_SECRET",
    );
  });

  it("cancels during structured streaming without exposing partial output", async () => {
    const controller = new AbortController();
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "output",
          output: createDebriefGeneratorOutputFixture(),
          chunkSize: 1,
          chunkDelayMs: 10,
        },
      ],
      { repeatLastStep: false },
    );
    const pending = generateDebrief({
      provider,
      request: createDebriefGeneratorRequestFixture(),
      signal: controller.signal,
      clock: () => STARTED_AT,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error("RAW_DEBRIEF_ABORT_REASON"));

    const error = await captureGenerationError(pending);

    expect(error.code).toBe("debrief_generation_cancelled");
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
    expect(serializedTrace).not.toContain("RAW_DEBRIEF_ABORT_REASON");
  });
});
