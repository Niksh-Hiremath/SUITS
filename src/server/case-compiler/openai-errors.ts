import OpenAI from "openai";

import { MAX_CASE_COMPILER_RETRY_DELAY_MS } from "./constants";
import { CaseCompilerProviderError } from "./provider";

function boundedDelay(milliseconds: number): number | null {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  return Math.min(MAX_CASE_COMPILER_RETRY_DELAY_MS, Math.ceil(milliseconds));
}

function retryAfterMs(headers: Headers | undefined, now: number): number | null {
  const millisecondsHeader = headers?.get("retry-after-ms");
  if (millisecondsHeader !== null && millisecondsHeader !== undefined) {
    const parsed = boundedDelay(Number(millisecondsHeader));
    if (parsed !== null) return parsed;
  }

  const retryAfterHeader = headers?.get("retry-after");
  if (!retryAfterHeader) return null;
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds)) return boundedDelay(seconds * 1_000);
  const retryAt = Date.parse(retryAfterHeader);
  return Number.isFinite(retryAt) ? boundedDelay(retryAt - now) : null;
}

export function createOpenAIProviderError(
  code: string,
  message: string,
  retryable: boolean,
  cause: unknown,
  retryDelay: number | null = null,
): CaseCompilerProviderError {
  return new CaseCompilerProviderError(code, message, retryable, {
    cause,
    retryAfterMs: retryDelay,
  });
}

export function classifyOpenAIRequestError(error: unknown, now: number): CaseCompilerProviderError {
  if (error instanceof OpenAI.APIUserAbortError) {
    return createOpenAIProviderError("request_aborted", "Case compilation was cancelled", false, error);
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return createOpenAIProviderError(
      "openai_timeout",
      "The OpenAI case compiler request timed out",
      true,
      error,
    );
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return createOpenAIProviderError(
      "openai_connection_error",
      "The OpenAI case compiler could not be reached",
      true,
      error,
    );
  }
  if (error instanceof OpenAI.APIError) {
    const retryDelay = retryAfterMs(error.headers, now);
    if (error.status === 400) {
      const responseCode = typeof error.code === "string" ? error.code.toLowerCase() : "";
      const responseParam = typeof error.param === "string" ? error.param.toLowerCase() : "";
      const schemaRelated = responseCode.includes("schema") || responseParam.includes("schema");
      return createOpenAIProviderError(
        schemaRelated ? "openai_schema_invalid" : "openai_bad_request",
        schemaRelated
          ? "The OpenAI structured output schema was rejected"
          : "The OpenAI case compiler request was invalid",
        false,
        error,
      );
    }
    if (error.status === 401) {
      return createOpenAIProviderError(
        "openai_authentication_failed",
        "OpenAI authentication failed",
        false,
        error,
      );
    }
    if (error.status === 403) {
      return createOpenAIProviderError(
        "openai_permission_denied",
        "The OpenAI project cannot use the case compiler",
        false,
        error,
      );
    }
    if (error.status === 408) {
      return createOpenAIProviderError(
        "openai_timeout",
        "The OpenAI case compiler request timed out",
        true,
        error,
        retryDelay,
      );
    }
    if (error.status === 429) {
      return createOpenAIProviderError(
        "openai_rate_limited",
        "The OpenAI case compiler was rate limited",
        true,
        error,
        retryDelay,
      );
    }
    if (typeof error.status === "number" && error.status >= 500) {
      return createOpenAIProviderError(
        "openai_server_error",
        "The OpenAI case compiler service failed",
        true,
        error,
        retryDelay,
      );
    }
    return createOpenAIProviderError(
      "openai_request_rejected",
      "The OpenAI case compiler request was rejected",
      false,
      error,
    );
  }
  return createOpenAIProviderError(
    "openai_configuration_error",
    "The OpenAI case compiler is misconfigured",
    false,
    error,
  );
}

export function classifyOpenAIResponseFailure(response: Readonly<{
  status?: string;
  error: Readonly<{ code: string }> | null;
  incomplete_details?: Readonly<{ reason?: string }> | null;
}>): CaseCompilerProviderError {
  switch (response.error?.code) {
    case "rate_limit_exceeded":
      return createOpenAIProviderError(
        "openai_rate_limited",
        "The OpenAI case compiler was rate limited",
        true,
        response,
      );
    case "server_error":
      return createOpenAIProviderError(
        "openai_server_error",
        "The OpenAI case compiler service failed",
        true,
        response,
      );
    case "vector_store_timeout":
      return createOpenAIProviderError(
        "openai_timeout",
        "The OpenAI case compiler request timed out",
        true,
        response,
      );
    default:
      break;
  }
  if (response.incomplete_details?.reason === "max_output_tokens") {
    return createOpenAIProviderError(
      "openai_output_limit_reached",
      "The OpenAI case compiler exceeded its output limit",
      false,
      response,
    );
  }
  if (response.incomplete_details?.reason === "content_filter") {
    return createOpenAIProviderError(
      "openai_content_filtered",
      "The OpenAI case compiler response was filtered",
      false,
      response,
    );
  }
  if (response.error !== null) {
    return createOpenAIProviderError(
      "openai_response_rejected",
      "The OpenAI case compiler rejected the response",
      false,
      response,
    );
  }
  return createOpenAIProviderError(
    "openai_response_incomplete",
    `The OpenAI case compiler response ended with status ${response.status ?? "unknown"}`,
    true,
    response,
  );
}
