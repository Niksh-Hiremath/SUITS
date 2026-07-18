import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

import type { CourtroomModelTokenUsage } from "@/domain/courtroom-ai/model-call-trace";

import {
  COURTROOM_FINAL_DEBRIEF_MODEL,
  COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  COURTROOM_PROMPT_CACHE_TTL,
  COURTROOM_PROVIDER_COMPONENT,
  DEFAULT_COURTROOM_MAX_OUTPUT_TOKENS,
} from "./constants";
import {
  classifyOpenAICourtroomRequestError,
  classifyOpenAICourtroomResponseFailure,
  createOpenAICourtroomProviderError,
} from "./openai-errors";
import {
  assertCourtroomModelProviderRequest,
  CourtroomModelProviderError,
  type CourtroomModelProvider,
  type CourtroomModelProviderRequest,
  type CourtroomModelProviderResponse,
} from "./provider";

export type CourtroomReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type OpenAICourtroomModelProviderOptions = Readonly<{
  maxOutputTokens?: number;
  runtimeReasoningEffort?: CourtroomReasoningEffort;
  finalDebriefReasoningEffort?: CourtroomReasoningEffort;
  monotonicNow?: () => number;
  wallClockNow?: () => number;
}>;

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new CourtroomModelProviderError(
      "server_runtime_required",
      "The OpenAI courtroom model can only run in server-side code",
      false,
    );
  }
}

function readSdkRequestId(response: object): string | null {
  if ("_request_id" in response && typeof response._request_id === "string") {
    return response._request_id;
  }
  return null;
}

function mapUsage(
  usage:
    | {
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
        input_tokens_details: {
          cached_tokens: number;
          cache_write_tokens: number;
        };
        output_tokens_details: { reasoning_tokens: number };
      }
    | undefined,
): CourtroomModelTokenUsage | null {
  if (usage === undefined) return null;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cachedInputTokens: usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: usage.input_tokens_details.cache_write_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
  };
}

export class OpenAICourtroomModelProvider implements CourtroomModelProvider {
  readonly protocolVersion = COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION;
  readonly providerName = "openai-responses";

  readonly #client: OpenAI;
  readonly #maxOutputTokens: number;
  readonly #runtimeReasoningEffort: CourtroomReasoningEffort;
  readonly #finalDebriefReasoningEffort: CourtroomReasoningEffort;
  readonly #monotonicNow: () => number;
  readonly #wallClockNow: () => number;

  constructor(client: OpenAI, options: OpenAICourtroomModelProviderOptions = {}) {
    assertServerRuntime();
    this.#client = client;
    this.#maxOutputTokens =
      options.maxOutputTokens ?? DEFAULT_COURTROOM_MAX_OUTPUT_TOKENS;
    this.#runtimeReasoningEffort = options.runtimeReasoningEffort ?? "low";
    this.#finalDebriefReasoningEffort =
      options.finalDebriefReasoningEffort ?? "high";
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#wallClockNow = options.wallClockNow ?? Date.now;

    if (
      !Number.isInteger(this.#maxOutputTokens) ||
      this.#maxOutputTokens < 256 ||
      this.#maxOutputTokens > 100_000
    ) {
      throw new CourtroomModelProviderError(
        "openai_configuration_error",
        "OpenAI courtroom maxOutputTokens must be an integer between 256 and 100000",
        false,
      );
    }
  }

  async generate<TSchema extends z.ZodObject>(
    request: CourtroomModelProviderRequest<TSchema>,
  ): Promise<CourtroomModelProviderResponse<z.output<TSchema>>> {
    assertServerRuntime();
    const model = assertCourtroomModelProviderRequest(request);
    if (request.signal?.aborted) {
      throw new CourtroomModelProviderError(
        "request_aborted",
        "The courtroom model request was cancelled",
        false,
      );
    }

    const started = this.#monotonicNow();
    const elapsedMs = () => Math.max(0, this.#monotonicNow() - started);
    let streamEventCount = 0;
    let structuredDeltaCount = 0;
    let streamedCharacterCount = 0;
    let firstStructuredDeltaMs: number | null = null;
    let activeResponseId: string | null = null;
    let failureEventEmitted = false;
    let textFormat: ReturnType<typeof zodTextFormat>;

    const emitAbortedIfNeeded = () => {
      if (failureEventEmitted || activeResponseId === null) return;
      failureEventEmitted = true;
      request.onStreamEvent?.({
        type: "response_failed",
        responseId: activeResponseId,
        code: "request_aborted",
        elapsedMs: elapsedMs(),
      });
    };
    const throwIfAborted = () => {
      if (!request.signal?.aborted) return;
      emitAbortedIfNeeded();
      throw new CourtroomModelProviderError(
        "request_aborted",
        "The courtroom model request was cancelled",
        false,
        { cause: request.signal.reason },
      );
    };

    try {
      textFormat = zodTextFormat(request.schema, request.schemaName);
    } catch (error) {
      throw createOpenAICourtroomProviderError(
        "openai_schema_invalid",
        "The OpenAI structured output schema is invalid",
        false,
        error,
      );
    }

    const reasoningEffort =
      model === COURTROOM_FINAL_DEBRIEF_MODEL
        ? this.#finalDebriefReasoningEffort
        : this.#runtimeReasoningEffort;

    try {
      const stream = this.#client.responses.stream(
        {
          model,
          store: false,
          max_output_tokens: this.#maxOutputTokens,
          reasoning: { effort: reasoningEffort },
          prompt_cache_key: request.prompt.cacheKey,
          prompt_cache_options: {
            mode: "explicit",
            ttl: COURTROOM_PROMPT_CACHE_TTL,
          },
          metadata: {
            component: COURTROOM_PROVIDER_COMPONENT,
            provider_protocol_version: this.protocolVersion,
            prompt_version: request.prompt.promptVersion,
            schema_version: request.schemaVersion,
            call_class: request.callClass,
            task: request.task,
            attempt: String(request.attempt),
            mode: request.mode,
          },
          input: [
            {
              role: "developer",
              content: [
                {
                  type: "input_text",
                  text: request.prompt.developerPrefix,
                  prompt_cache_breakpoint: { mode: "explicit" },
                },
              ],
            },
            {
              role: "developer",
              content: request.prompt.developerContext,
            },
            {
              role: "user",
              content: request.prompt.untrustedUserContent,
            },
          ],
          text: { format: textFormat },
        },
        { signal: request.signal, maxRetries: 0 },
      );

      for await (const event of stream) {
        streamEventCount += 1;
        switch (event.type) {
          case "response.created": {
            activeResponseId = event.response.id;
            request.onStreamEvent?.({
              type: "response_started",
              responseId: event.response.id,
              elapsedMs: elapsedMs(),
            });
            break;
          }
          case "response.output_text.delta": {
            structuredDeltaCount += 1;
            streamedCharacterCount += event.delta.length;
            const deltaElapsedMs = elapsedMs();
            firstStructuredDeltaMs ??= deltaElapsedMs;
            request.onStreamEvent?.({
              type: "structured_delta",
              responseId: activeResponseId,
              delta: event.delta,
              index: structuredDeltaCount,
              elapsedMs: deltaElapsedMs,
            });
            break;
          }
          case "response.completed": {
            activeResponseId = event.response.id;
            request.onStreamEvent?.({
              type: "response_completed",
              responseId: event.response.id,
              elapsedMs: elapsedMs(),
            });
            break;
          }
          case "response.failed": {
            activeResponseId = event.response.id;
            failureEventEmitted = true;
            request.onStreamEvent?.({
              type: "response_failed",
              responseId: event.response.id,
              code: event.response.error?.code ?? "response_failed",
              elapsedMs: elapsedMs(),
            });
            break;
          }
          case "error": {
            failureEventEmitted = true;
            request.onStreamEvent?.({
              type: "response_failed",
              responseId: activeResponseId,
              code: event.code ?? "stream_error",
              elapsedMs: elapsedMs(),
            });
            break;
          }
          default:
            break;
        }
        throwIfAborted();
      }

      throwIfAborted();
      const response = await stream.finalResponse();
      throwIfAborted();
      if (response.status !== "completed" || response.error !== null) {
        throw classifyOpenAICourtroomResponseFailure(response);
      }
      if (response.output_parsed === null) {
        throw new CourtroomModelProviderError(
          "openai_structured_output_missing",
          "OpenAI returned no parsed courtroom model output",
          false,
        );
      }
      const parsedOutput = request.schema.safeParse(response.output_parsed);
      if (!parsedOutput.success) {
        throw createOpenAICourtroomProviderError(
          "openai_structured_output_invalid",
          "OpenAI returned invalid structured courtroom model output",
          false,
          parsedOutput.error,
        );
      }

      return {
        model,
        output: parsedOutput.data,
        requestId: readSdkRequestId(response) ?? response.id,
        responseId: response.id,
        latencyMs: elapsedMs(),
        firstStructuredDeltaMs,
        streamEventCount,
        structuredDeltaCount,
        streamedCharacterCount,
        usage: mapUsage(response.usage),
      };
    } catch (error) {
      if (error instanceof CourtroomModelProviderError) throw error;
      if (request.signal?.aborted) {
        emitAbortedIfNeeded();
        throw new CourtroomModelProviderError(
          "request_aborted",
          "The courtroom model request was cancelled",
          false,
          { cause: error },
        );
      }
      throw classifyOpenAICourtroomRequestError(error, this.#wallClockNow());
    }
  }
}
