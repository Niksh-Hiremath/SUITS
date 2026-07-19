import { describe, expect, it } from "vitest";

import {
  CourtroomModelCallTraceSchema,
  type CourtroomModelTokenUsage,
} from "@/domain/courtroom-ai/model-call-trace";

import { ScriptedCourtroomModelProvider } from "./fake-provider";
import {
  JUDICIAL_INJECTION_CANARY,
  createObjectionRulingOutputFixture,
  createObjectionRulingRequestFixture,
} from "./judicial-response.test-fixtures";
import {
  ObjectionRulingGenerationError,
  generateObjectionRuling,
} from "./objection-ruling";

const STARTED_AT = new Date("2026-07-19T07:30:00.000Z");
const OUTPUT_CANARY = "The question calls for an out-of-court statement.";

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

function invalidRulingOutput() {
  const output = createObjectionRulingOutputFixture();
  return {
    ...output,
    citations: {
      ...output.citations,
      transcriptTurnIds: ["turn_foreign"],
    },
  };
}

async function captureGenerationError(
  operation: Promise<unknown>,
): Promise<ObjectionRulingGenerationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ObjectionRulingGenerationError);
    if (error instanceof ObjectionRulingGenerationError) return error;
  }
  throw new Error("Expected objection ruling generation to fail");
}

describe("generateObjectionRuling", () => {
  it("accepts one grounded Luna ruling with canonical event citation audit", async () => {
    const request = createObjectionRulingRequestFixture(
      JUDICIAL_INJECTION_CANARY,
    );
    const output = createObjectionRulingOutputFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "output",
          output,
          requestId: "request:objection:accepted:001",
          responseId: "response:objection:accepted:001",
          usage: USAGE_ONE,
          chunkSize: 5,
        },
      ],
      { repeatLastStep: false },
    );
    const generated = await generateObjectionRuling({
      provider,
      request,
      clock: () => STARTED_AT,
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "objection_resolver",
      task: "resolve_objection",
      mode: "initial",
      attempt: 1,
      schemaName: "suits_objection_ruling_v1",
      schemaVersion: "objection-resolver.ruling.output.v1",
    });
    expect(generated.ruling).toMatchObject({
      ruling: "sustained",
      remedy: "cancel_response",
      transcriptTurnIds: ["turn_question_fixture"],
    });
    expect(CourtroomModelCallTraceSchema.parse(generated.trace)).toEqual(
      generated.trace,
    );
    expect(generated.trace).toMatchObject({
      status: "accepted",
      actorRole: "judge",
      callClass: "objection_resolver",
      task: "resolve_objection",
      model: "gpt-5.6-luna",
      responseId: "response_fixture",
      acceptedAttempt: 1,
      retryCount: 0,
      validationFailureCount: 0,
      acceptedCitations: {
        factIds: ["fact_public"],
        evidenceIds: ["evidence_admitted"],
        testimonyIds: [],
        eventIds: ["event_question_fixture"],
        sourceSegmentIds: ["source_public_fact"],
        priorStatementIds: [],
      },
      acceptedCitationCount: 4,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        stateVersion: 12,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 1,
        sourceSegmentCount: 2,
        currentExchangeCount: 1,
      },
      safeFailureCode: null,
    });
    const serializedTrace = JSON.stringify(generated.trace);
    expect(serializedTrace).not.toContain(JUDICIAL_INJECTION_CANARY);
    expect(serializedTrace).not.toContain(OUTPUT_CANARY);
    expect(serializedTrace).not.toContain('"knowledgeView":');
    expect(serializedTrace).not.toContain("privateSettlement");
  });

  it("makes one targeted repair for a foreign question citation", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: invalidRulingOutput(), usage: USAGE_ONE },
        {
          type: "output",
          output: createObjectionRulingOutputFixture(),
          usage: USAGE_TWO,
        },
      ],
      { repeatLastStep: false },
    );
    const generated = await generateObjectionRuling({
      provider,
      request: createObjectionRulingRequestFixture(),
      clock: () => STARTED_AT,
    });
    expect(provider.requests.map(({ mode, attempt }) => ({ mode, attempt })))
      .toEqual([
        { mode: "initial", attempt: 1 },
        { mode: "repair", attempt: 2 },
      ]);
    expect(provider.requests[1]?.prompt.developerContext).toContain(
      "unknown_transcript_turn_citation",
    );
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
  });

  it("does not retry a provider failure or expose its raw message", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "error",
          code: "service_unavailable",
          message: "RAW_OBJECTION_PROVIDER_SECRET",
          retryable: true,
        },
      ],
      { repeatLastStep: false },
    );
    const error = await captureGenerationError(
      generateObjectionRuling({
        provider,
        request: createObjectionRulingRequestFixture(),
        clock: () => STARTED_AT,
      }),
    );
    expect(error.code).toBe("objection_ruling_provider_failed");
    expect(provider.requests).toHaveLength(1);
    expect(error.trace).toMatchObject({
      status: "failed",
      retryCount: 0,
      safeFailureCode: "service_unavailable",
      attempts: [{ status: "provider_failed" }],
    });
    expect(JSON.stringify(error.trace)).not.toContain(
      "RAW_OBJECTION_PROVIDER_SECRET",
    );
  });

  it("cancels during structured streaming without exposing partial output", async () => {
    const controller = new AbortController();
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "output",
          output: createObjectionRulingOutputFixture(),
          chunkSize: 1,
          chunkDelayMs: 10,
        },
      ],
      { repeatLastStep: false },
    );
    const pending = generateObjectionRuling({
      provider,
      request: createObjectionRulingRequestFixture(),
      signal: controller.signal,
      clock: () => STARTED_AT,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error("RAW_OBJECTION_ABORT_REASON"));
    const error = await captureGenerationError(pending);
    expect(error.code).toBe("objection_ruling_cancelled");
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
    expect(serializedTrace).not.toContain("RAW_OBJECTION_ABORT_REASON");
  });

  it("rejects a stale judge-view binding before invoking Luna", async () => {
    const request = createObjectionRulingRequestFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createObjectionRulingOutputFixture() }],
      { repeatLastStep: false },
    );
    await expect(
      generateObjectionRuling({
        provider,
        request: { ...request, expectedStateVersion: 11 } as never,
        clock: () => STARTED_AT,
      }),
    ).rejects.toThrow();
    expect(provider.requests).toHaveLength(0);
  });
});
