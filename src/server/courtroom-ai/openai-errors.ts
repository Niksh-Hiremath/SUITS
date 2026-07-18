import OpenAI from "openai";

import { MAX_COURTROOM_RETRY_DELAY_MS } from "./constants";
import {
  CourtroomModelProviderError,
  type CourtroomModelProviderErrorOptions,
} from "./provider";

function boundedDelay(milliseconds: number): number | null {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  return Math.min(MAX_COURTROOM_RETRY_DELAY_MS, Math.ceil(milliseconds));
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

export function createOpenAICourtroomProviderError(
  code: string,
  message: string,
  retryable: boolean,
  cause: unknown,
  options: Omit<CourtroomModelProviderErrorOptions, "cause"> = {},
): CourtroomModelProviderError {
  return new CourtroomModelProviderError(code, message, retryable, {
    ...options,
    cause,
  });
}

export function classifyOpenAICourtroomRequestError(
  error: unknown,
  now: number,
): CourtroomModelProviderError {
  if (error instanceof OpenAI.APIUserAbortError) {
    return createOpenAICourtroomProviderError(
      "request_aborted",
      "The courtroom model request was cancelled",
      false,
      error,
    );
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return createOpenAICourtroomProviderError(
      "openai_timeout",
      "The OpenAI courtroom model request timed out",
      true,
      error,
    );
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return createOpenAICourtroomProviderError(
      "openai_connection_error",
      "The OpenAI courtroom model could not be reached",
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
      return createOpenAICourtroomProviderError(
        schemaRelated ? "openai_schema_invalid" : "openai_bad_request",
        schemaRelated
          ? "The OpenAI structured output schema was rejected"
          : "The OpenAI courtroom model request was invalid",
        false,
        error,
      );
    }
    if (error.status === 401) {
      return createOpenAICourtroomProviderError(
        "openai_authentication_failed",
        "OpenAI authentication failed",
        false,
        error,
      );
    }
    if (error.status === 403) {
      return createOpenAICourtroomProviderError(
        "openai_permission_denied",
        "The OpenAI project cannot use the courtroom model",
        false,
        error,
      );
    }
    if (error.status === 408) {
      return createOpenAICourtroomProviderError(
        "openai_timeout",
        "The OpenAI courtroom model request timed out",
        true,
        error,
        { retryAfterMs: retryDelay },
      );
    }
    if (error.status === 429) {
      return createOpenAICourtroomProviderError(
        "openai_rate_limited",
        "The OpenAI courtroom model was rate limited",
        true,
        error,
        { retryAfterMs: retryDelay },
      );
    }
    if (typeof error.status === "number" && error.status >= 500) {
      return createOpenAICourtroomProviderError(
        "openai_server_error",
        "The OpenAI courtroom model service failed",
        true,
        error,
        { retryAfterMs: retryDelay },
      );
    }
    return createOpenAICourtroomProviderError(
      "openai_request_rejected",
      "The OpenAI courtroom model request was rejected",
      false,
      error,
    );
  }
  return createOpenAICourtroomProviderError(
    "openai_configuration_error",
    "The OpenAI courtroom model is misconfigured",
    false,
    error,
  );
}

export function classifyOpenAICourtroomResponseFailure(
  response: Readonly<{
    status?: string;
    error: Readonly<{ code: string }> | null;
    incomplete_details?: Readonly<{ reason?: string }> | null;
  }>,
): CourtroomModelProviderError {
  switch (response.error?.code) {
    case "rate_limit_exceeded":
      return createOpenAICourtroomProviderError(
        "openai_rate_limited",
        "The OpenAI courtroom model was rate limited",
        true,
        response,
      );
    case "server_error":
      return createOpenAICourtroomProviderError(
        "openai_server_error",
        "The OpenAI courtroom model service failed",
        true,
        response,
      );
    case "vector_store_timeout":
      return createOpenAICourtroomProviderError(
        "openai_timeout",
        "The OpenAI courtroom model request timed out",
        true,
        response,
      );
    default:
      break;
  }
  if (response.incomplete_details?.reason === "max_output_tokens") {
    return createOpenAICourtroomProviderError(
      "openai_output_limit_reached",
      "The OpenAI courtroom model exceeded its output limit",
      false,
      response,
    );
  }
  if (response.incomplete_details?.reason === "content_filter") {
    return createOpenAICourtroomProviderError(
      "openai_content_filtered",
      "The OpenAI courtroom model response was filtered",
      false,
      response,
    );
  }
  if (response.error !== null) {
    return createOpenAICourtroomProviderError(
      "openai_response_rejected",
      "The OpenAI courtroom model rejected the response",
      false,
      response,
    );
  }
  return createOpenAICourtroomProviderError(
    "openai_response_incomplete",
    `The OpenAI courtroom model response ended with status ${response.status ?? "unknown"}`,
    true,
    response,
  );
}
