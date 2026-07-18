import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  CASE_COMPILER_MODEL,
  CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
  CASE_COMPILER_SCHEMA_NAME,
} from "./constants";
import {
  classifyOpenAIRequestError,
  classifyOpenAIResponseFailure,
  createOpenAIProviderError,
} from "./openai-errors";
import {
  CaseCompilerProviderError,
  type CaseCompilerProvider,
  type CaseCompilerProviderRequest,
  type CaseCompilerProviderResponse,
} from "./provider";
import {
  CaseCompilerModelOutputSchema,
  type CaseCompilerTokenUsage,
} from "./schemas";

export type OpenAICaseCompilerProviderOptions = Readonly<{
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  monotonicNow?: () => number;
  wallClockNow?: () => number;
}>;

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new CaseCompilerProviderError(
      "server_runtime_required",
      "The OpenAI case compiler can only run in server-side code",
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

function mapUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: { cached_tokens: number; cache_write_tokens: number };
  output_tokens_details: { reasoning_tokens: number };
} | undefined): CaseCompilerTokenUsage | null {
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

export class OpenAICaseCompilerProvider implements CaseCompilerProvider {
  readonly protocolVersion = CASE_COMPILER_PROVIDER_PROTOCOL_VERSION;
  readonly model = CASE_COMPILER_MODEL;
  readonly providerName = "openai-responses";

  readonly #client: OpenAI;
  readonly #maxOutputTokens: number;
  readonly #reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
  readonly #monotonicNow: () => number;
  readonly #wallClockNow: () => number;

  constructor(client: OpenAI, options: OpenAICaseCompilerProviderOptions = {}) {
    assertServerRuntime();
    this.#client = client;
    this.#maxOutputTokens = options.maxOutputTokens ?? 32_000;
    this.#reasoningEffort = options.reasoningEffort ?? "high";
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#wallClockNow = options.wallClockNow ?? Date.now;

    if (!Number.isInteger(this.#maxOutputTokens) || this.#maxOutputTokens < 4_000 || this.#maxOutputTokens > 100_000) {
      throw new CaseCompilerProviderError(
        "openai_configuration_error",
        "OpenAI case compiler maxOutputTokens must be an integer between 4000 and 100000",
        false,
      );
    }
  }

  async generate(request: CaseCompilerProviderRequest): Promise<CaseCompilerProviderResponse> {
    assertServerRuntime();
    if (request.model !== CASE_COMPILER_MODEL || request.protocolVersion !== this.protocolVersion) {
      throw new CaseCompilerProviderError(
        "provider_contract_mismatch",
        "Case compiler provider contract mismatch",
        false,
      );
    }
    if (request.signal?.aborted) {
      throw new CaseCompilerProviderError("request_aborted", "Case compilation was cancelled", false);
    }

    const started = this.#monotonicNow();
    let streamEventCount = 0;
    let streamedCharacterCount = 0;
    let textFormat: ReturnType<typeof zodTextFormat>;
    try {
      textFormat = zodTextFormat(CaseCompilerModelOutputSchema, CASE_COMPILER_SCHEMA_NAME);
    } catch (error) {
      throw createOpenAIProviderError(
        "openai_schema_invalid",
        "The OpenAI structured output schema is invalid",
        false,
        error,
      );
    }

    try {
      const stream = this.#client.responses.stream(
        {
          model: CASE_COMPILER_MODEL,
          store: false,
          max_output_tokens: this.#maxOutputTokens,
          reasoning: { effort: this.#reasoningEffort },
          prompt_cache_key: request.prompt.cacheKey,
          prompt_cache_options: { mode: "explicit", ttl: "30m" },
          metadata: {
            component: "suits-case-compiler",
            prompt_version: request.prompt.promptVersion,
            schema_version: CASE_COMPILER_SCHEMA_NAME,
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
            { role: "developer", content: request.prompt.developerContext },
            { role: "user", content: request.prompt.untrustedUserContent },
          ],
          text: {
            format: textFormat,
          },
        },
        { signal: request.signal, maxRetries: 0 },
      );

      for await (const event of stream) {
        streamEventCount += 1;
        switch (event.type) {
          case "response.created":
            request.onStreamEvent?.({ type: "response_started", responseId: event.response.id });
            break;
          case "response.output_text.delta":
            streamedCharacterCount += event.delta.length;
            request.onStreamEvent?.({ type: "structured_delta", delta: event.delta });
            break;
          case "response.completed":
            request.onStreamEvent?.({ type: "response_completed", responseId: event.response.id });
            break;
          case "response.failed":
            request.onStreamEvent?.({ type: "response_failed", code: "response_failed" });
            break;
          case "error":
            request.onStreamEvent?.({ type: "response_failed", code: event.code ?? "stream_error" });
            break;
          default:
            break;
        }
      }

      const response = await stream.finalResponse();
      if (response.status !== "completed" || response.error !== null) {
        throw classifyOpenAIResponseFailure(response);
      }
      if (response.output_parsed === null) {
        throw new CaseCompilerProviderError(
          "openai_structured_output_missing",
          "OpenAI returned no parsed case compiler output",
          false,
        );
      }

      return {
        output: response.output_parsed,
        requestId: readSdkRequestId(response) ?? response.id,
        responseId: response.id,
        latencyMs: Math.max(0, this.#monotonicNow() - started),
        streamEventCount,
        streamedCharacterCount,
        usage: mapUsage(response.usage),
      };
    } catch (error) {
      if (error instanceof CaseCompilerProviderError) throw error;
      if (request.signal?.aborted) {
        throw new CaseCompilerProviderError("request_aborted", "Case compilation was cancelled", false, {
          cause: error,
        });
      }
      throw classifyOpenAIRequestError(error, this.#wallClockNow());
    }
  }
}
