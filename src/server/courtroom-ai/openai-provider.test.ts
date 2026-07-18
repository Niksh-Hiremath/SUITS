import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  COURTROOM_FINAL_DEBRIEF_MODEL,
  COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  COURTROOM_RUNTIME_MODEL,
  MAX_COURTROOM_RETRY_DELAY_MS,
} from "./constants";
import { OpenAICourtroomModelProvider } from "./openai-provider";
import {
  CourtroomModelProviderError,
  type CourtroomModelProviderRequest,
  type CourtroomModelStreamEvent,
} from "./provider";

const OUTPUT_SCHEMA = z
  .object({
    dialogue: z.string(),
    citations: z.array(z.string()),
  })
  .strict();

const REQUEST = {
  protocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  mode: "initial",
  attempt: 1,
  prompt: {
    promptVersion: "witness-answer.prompt.v1",
    cacheKey: "suits.witness-answer.v1",
    developerPrefix: "Stable courtroom policy",
    developerContext: "Role-scoped trusted context",
    untrustedUserContent: "Untrusted transcript text",
  },
  schema: OUTPUT_SCHEMA,
  schemaName: "suits_witness_answer_v1",
  schemaVersion: "witness-answer.output.v1",
  callClass: "role_responder",
  task: "witness_answer",
} as const satisfies CourtroomModelProviderRequest<typeof OUTPUT_SCHEMA>;

type CapturedRequest = Readonly<{
  body: unknown;
  options: unknown;
}>;

function successfulStreamingClient(captured: CapturedRequest[]): OpenAI {
  const response = {
    id: "resp-courtroom-1",
    _request_id: "req-courtroom-1",
    status: "completed",
    error: null,
    output_parsed: {
      dialogue: "I saw the signal change.",
      citations: ["fact_signal"],
    },
    usage: {
      input_tokens: 80,
      output_tokens: 20,
      total_tokens: 100,
      input_tokens_details: {
        cached_tokens: 30,
        cache_write_tokens: 10,
      },
      output_tokens_details: { reasoning_tokens: 5 },
    },
  };
  const events = [
    { type: "response.created", response },
    { type: "response.output_text.delta", delta: '{"dialogue":"I saw' },
    {
      type: "response.output_text.delta",
      delta: ' the signal change.","citations":["fact_signal"]}',
    },
    { type: "response.completed", response },
  ];

  return {
    responses: {
      stream: (body: unknown, options: unknown) => {
        captured.push({ body, options });
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
          },
          finalResponse: async () => response,
        };
      },
    },
  } as unknown as OpenAI;
}

function monotonicSequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

async function captureProviderError(
  provider: OpenAICourtroomModelProvider,
  request: CourtroomModelProviderRequest = REQUEST,
): Promise<CourtroomModelProviderError> {
  try {
    await provider.generate(request);
  } catch (error) {
    expect(error).toBeInstanceOf(CourtroomModelProviderError);
    if (error instanceof CourtroomModelProviderError) return error;
    throw error;
  }
  throw new Error("Expected the provider to reject");
}

describe("OpenAI courtroom model streaming provider", () => {
  it("streams a strict root schema with explicit caching and complete metrics", async () => {
    const captured: CapturedRequest[] = [];
    const streamEvents: CourtroomModelStreamEvent[] = [];
    const signal = new AbortController().signal;
    const provider = new OpenAICourtroomModelProvider(
      successfulStreamingClient(captured),
      {
        maxOutputTokens: 2_048,
        monotonicNow: monotonicSequence([100, 110, 120, 130, 140, 150]),
      },
    );

    const response = await provider.generate({
      ...REQUEST,
      signal,
      onStreamEvent: (event) => streamEvents.push(event),
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      body: {
        model: COURTROOM_RUNTIME_MODEL,
        store: false,
        max_output_tokens: 2_048,
        reasoning: { effort: "low" },
        prompt_cache_key: REQUEST.prompt.cacheKey,
        prompt_cache_options: { mode: "explicit", ttl: "30m" },
        metadata: {
          component: "suits-courtroom-ai",
          provider_protocol_version: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
          prompt_version: REQUEST.prompt.promptVersion,
          schema_version: REQUEST.schemaVersion,
          call_class: REQUEST.callClass,
          task: REQUEST.task,
          attempt: "1",
          mode: "initial",
        },
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text: REQUEST.prompt.developerPrefix,
                prompt_cache_breakpoint: { mode: "explicit" },
              },
            ],
          },
          { role: "developer", content: REQUEST.prompt.developerContext },
          { role: "user", content: REQUEST.prompt.untrustedUserContent },
        ],
        text: {
          format: {
            type: "json_schema",
            name: REQUEST.schemaName,
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
            },
          },
        },
      },
      options: { signal, maxRetries: 0 },
    });
    expect(response).toEqual({
      model: COURTROOM_RUNTIME_MODEL,
      output: {
        dialogue: "I saw the signal change.",
        citations: ["fact_signal"],
      },
      requestId: "req-courtroom-1",
      responseId: "resp-courtroom-1",
      latencyMs: 50,
      firstStructuredDeltaMs: 20,
      streamEventCount: 4,
      structuredDeltaCount: 2,
      streamedCharacterCount: 67,
      usage: {
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        cachedInputTokens: 30,
        cacheWriteTokens: 10,
        reasoningTokens: 5,
      },
    });
    expect(streamEvents.map((event) => event.type)).toEqual([
      "response_started",
      "structured_delta",
      "structured_delta",
      "response_completed",
    ]);
    expect(streamEvents[1]).toMatchObject({
      responseId: "resp-courtroom-1",
      index: 1,
      elapsedMs: 20,
    });
  });

  it("uses Terra with a separate explicit effort only for final debrief", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new OpenAICourtroomModelProvider(
      successfulStreamingClient(captured),
      { finalDebriefReasoningEffort: "xhigh" },
    );

    const result = await provider.generate({
      ...REQUEST,
      callClass: "debrief_generator",
      task: "generate_debrief",
    });

    expect(result.model).toBe(COURTROOM_FINAL_DEBRIEF_MODEL);
    expect(captured[0]).toMatchObject({
      body: {
        model: COURTROOM_FINAL_DEBRIEF_MODEL,
        reasoning: { effort: "xhigh" },
      },
    });
  });

  it("honors a pre-aborted signal before opening a stream", async () => {
    const captured: CapturedRequest[] = [];
    const controller = new AbortController();
    controller.abort("test cancellation");
    const provider = new OpenAICourtroomModelProvider(
      successfulStreamingClient(captured),
    );

    const error = await captureProviderError(provider, {
      ...REQUEST,
      signal: controller.signal,
    });

    expect(error).toMatchObject({ code: "request_aborted", retryable: false });
    expect(captured).toHaveLength(0);
  });

  it("stops an SDK stream immediately when cancellation lands on a delta", async () => {
    const captured: CapturedRequest[] = [];
    const controller = new AbortController();
    const streamEvents: CourtroomModelStreamEvent[] = [];
    const provider = new OpenAICourtroomModelProvider(
      successfulStreamingClient(captured),
    );

    const error = await captureProviderError(provider, {
      ...REQUEST,
      signal: controller.signal,
      onStreamEvent: (event) => {
        streamEvents.push(event);
        if (event.type === "structured_delta") controller.abort("stale revision");
      },
    });

    expect(error).toMatchObject({ code: "request_aborted", retryable: false });
    expect(streamEvents.map((event) => event.type)).toEqual([
      "response_started",
      "structured_delta",
      "response_failed",
    ]);
    expect(streamEvents.at(-1)).toMatchObject({ code: "request_aborted" });
  });

  it("returns safe bounded HTTP errors and disables hidden SDK retries", async () => {
    let fetchCalls = 0;
    const client = new OpenAI({
      apiKey: "test-only-key",
      maxRetries: 3,
      fetch: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            error: {
              message: "Sensitive upstream detail",
              type: "rate_limit_error",
              code: "rate_limit_exceeded",
              param: null,
            },
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After-Ms": "60000",
            },
          },
        );
      },
    });
    const provider = new OpenAICourtroomModelProvider(client);

    const error = await captureProviderError(provider);

    expect(error).toMatchObject({
      code: "openai_rate_limited",
      retryable: true,
      retryAfterMs: MAX_COURTROOM_RETRY_DELAY_MS,
    });
    expect(error.message).not.toContain("Sensitive upstream detail");
    expect(fetchCalls).toBe(1);
  });
});
