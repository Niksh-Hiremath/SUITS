import { describe, expect, it } from "vitest";

import {
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  type CourtroomModelTokenUsage,
} from "@/domain/courtroom-ai/model-call-trace";

import { ScriptedCourtroomModelProvider } from "./fake-provider";
import {
  JudgeResponseGenerationError,
  generateJudgeResponse,
} from "./judge-response";
import {
  JUDICIAL_INJECTION_CANARY,
  createJudgeResponseOutputFixture,
  createJudgeResponseRequestFixture,
} from "./judicial-response.test-fixtures";

const STARTED_AT = new Date("2026-07-19T07:30:00.000Z");
const OUTPUT_CANARY = "The exhibit is excluded for lack of foundation.";

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

function invalidJudgeOutput() {
  const output = createJudgeResponseOutputFixture();
  return {
    ...output,
    speechSegments: [
      {
        ...output.speechSegments[0],
        citations: {
          ...output.speechSegments[0]?.citations,
          evidenceIds: ["evidence_hidden"],
        },
      },
    ],
  };
}

async function captureGenerationError(
  operation: Promise<unknown>,
): Promise<JudgeResponseGenerationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(JudgeResponseGenerationError);
    if (error instanceof JudgeResponseGenerationError) return error;
  }
  throw new Error("Expected judge response generation to fail");
}

describe("generateJudgeResponse", () => {
  it("accepts one grounded Luna response with a redacted judge trace", async () => {
    const request = createJudgeResponseRequestFixture(
      JUDICIAL_INJECTION_CANARY,
    );
    const output = createJudgeResponseOutputFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "output",
          output,
          requestId: "request:judge:accepted:001",
          responseId: "response:judge:accepted:001",
          usage: USAGE_ONE,
          chunkSize: 7,
        },
      ],
      { repeatLastStep: false },
    );

    const generated = await generateJudgeResponse({
      provider,
      request,
      clock: () => STARTED_AT,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "role_responder",
      task: "judge_response",
      mode: "initial",
      attempt: 1,
      schemaName: "suits_judge_response_v1",
      schemaVersion: "role-responder.judge.output.v1",
    });
    expect(generated.output).toEqual(output);
    expect(generated.response).toMatchObject({
      text: OUTPUT_CANARY,
      evidenceIds: ["evidence_pending"],
      action: { kind: "rule_on_evidence", ruling: "excluded" },
    });
    expect(CourtroomModelCallTraceSchema.parse(generated.trace)).toEqual(
      generated.trace,
    );
    expect(generated.trace).toMatchObject({
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      status: "accepted",
      actorRole: "judge",
      callClass: "role_responder",
      task: "judge_response",
      model: "gpt-5.6-luna",
      responseId: null,
      acceptedAttempt: 1,
      retryCount: 0,
      validationFailureCount: 0,
      acceptedCitations: {
        factIds: [],
        evidenceIds: ["evidence_pending"],
        testimonyIds: [],
        eventIds: [],
        sourceSegmentIds: [],
        priorStatementIds: [],
      },
      acceptedCitationCount: 1,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        stateVersion: 20,
        factCount: 1,
        evidenceCount: 1,
        testimonyCount: 1,
        priorStatementCount: 0,
        sourceSegmentCount: 2,
        publicRecordEventCount: 1,
        currentExchangeCount: 1,
      },
      safeFailureCode: null,
    });
    const serializedTrace = JSON.stringify(generated.trace);
    expect(serializedTrace).not.toContain(JUDICIAL_INJECTION_CANARY);
    expect(serializedTrace).not.toContain(OUTPUT_CANARY);
    expect(serializedTrace).not.toContain('"knowledgeView":');
    expect(serializedTrace).not.toContain("privateSettlement");
    expect(serializedTrace).not.toContain("strategyMemory");
  });

  it("makes exactly one targeted repair after scoped validation rejects", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: invalidJudgeOutput(), usage: USAGE_ONE },
        {
          type: "output",
          output: createJudgeResponseOutputFixture(),
          usage: USAGE_TWO,
        },
      ],
      { repeatLastStep: false },
    );
    const generated = await generateJudgeResponse({
      provider,
      request: createJudgeResponseRequestFixture(),
      clock: () => STARTED_AT,
    });
    expect(provider.requests.map(({ mode, attempt }) => ({ mode, attempt })))
      .toEqual([
        { mode: "initial", attempt: 1 },
        { mode: "repair", attempt: 2 },
      ]);
    expect(provider.requests[1]?.prompt.developerContext).toContain(
      "unknown_evidence_citation",
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

  it("fails safely after the only repair is also invalid", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: invalidJudgeOutput() },
        { type: "output", output: invalidJudgeOutput() },
      ],
      { repeatLastStep: false },
    );
    const error = await captureGenerationError(
      generateJudgeResponse({
        provider,
        request: createJudgeResponseRequestFixture(),
        clock: () => STARTED_AT,
      }),
    );
    expect(error.code).toBe("judge_response_validation_failed");
    expect(provider.requests).toHaveLength(2);
    expect(error.trace).toMatchObject({
      status: "failed",
      retryCount: 1,
      validationFailureCount: 2,
      acceptedAttempt: null,
      acceptedCitationCount: 0,
      outputHash: null,
      safeFailureCode: "judge_response_validation_failed",
    });
  });

  it("cancels before provider invocation without leaking the abort reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error("RAW_JUDGE_ABORT_REASON"));
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createJudgeResponseOutputFixture() }],
      { repeatLastStep: false },
    );
    const error = await captureGenerationError(
      generateJudgeResponse({
        provider,
        request: createJudgeResponseRequestFixture(),
        signal: controller.signal,
        clock: () => STARTED_AT,
      }),
    );
    expect(error.code).toBe("judge_response_cancelled");
    expect(provider.requests).toHaveLength(0);
    expect(error.trace).toMatchObject({
      status: "cancelled",
      attempts: [],
      acceptedCitationCount: 0,
      outputHash: null,
      safeFailureCode: "request_aborted",
    });
    expect(JSON.stringify(error.trace)).not.toContain("RAW_JUDGE_ABORT_REASON");
  });

  it("rejects a stale head binding before invoking Luna", async () => {
    const request = createJudgeResponseRequestFixture();
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createJudgeResponseOutputFixture() }],
      { repeatLastStep: false },
    );
    await expect(
      generateJudgeResponse({
        provider,
        request: { ...request, expectedLastEventId: "event_stale" } as never,
        clock: () => STARTED_AT,
      }),
    ).rejects.toThrow();
    expect(provider.requests).toHaveLength(0);
  });
});
