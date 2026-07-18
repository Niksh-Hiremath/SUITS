import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import {
  CASE_COMPILER_MODEL,
  CASE_COMPILER_PROMPT_CACHE_KEY,
  CASE_COMPILER_PROMPT_VERSION,
  CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
  MAX_CASE_COMPILER_RETRY_DELAY_MS,
} from "./constants";
import { OpenAICaseCompilerProvider } from "./openai-provider";
import {
  CaseCompilerProviderError,
  type CaseCompilerProviderRequest,
} from "./provider";

const REQUEST = {
  protocolVersion: CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
  model: CASE_COMPILER_MODEL,
  mode: "compile",
  attempt: 1,
  prompt: {
    promptVersion: CASE_COMPILER_PROMPT_VERSION,
    cacheKey: CASE_COMPILER_PROMPT_CACHE_KEY,
    developerPrefix: "Stable compiler policy",
    developerContext: "Trusted compiler manifest",
    untrustedUserContent: "Untrusted fictional packet",
  },
} as const satisfies CaseCompilerProviderRequest;

async function captureProviderError(
  provider: OpenAICaseCompilerProvider,
): Promise<CaseCompilerProviderError> {
  try {
    await provider.generate(REQUEST);
  } catch (error) {
    expect(error).toBeInstanceOf(CaseCompilerProviderError);
    if (error instanceof CaseCompilerProviderError) return error;
    throw error;
  }
  throw new Error("Expected the provider to reject");
}

function apiFailureProvider(options: Readonly<{
  status: number;
  errorCode: string;
  errorParam?: string;
  headers?: HeadersInit;
  wallClockNow?: () => number;
}>): { provider: OpenAICaseCompilerProvider; fetchCalls: () => number } {
  let calls = 0;
  const client = new OpenAI({
    apiKey: "test-only-key",
    maxRetries: 2,
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        error: {
          message: "Sensitive upstream detail",
          type: "invalid_request_error",
          code: options.errorCode,
          param: options.errorParam ?? null,
        },
      }), {
        status: options.status,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    },
  });
  return {
    provider: new OpenAICaseCompilerProvider(client, {
      wallClockNow: options.wallClockNow,
    }),
    fetchCalls: () => calls,
  };
}

function throwingClient(error: unknown): OpenAI {
  // This test double implements only the synchronous stream-construction seam.
  return {
    responses: {
      stream: () => {
        throw error;
      },
    },
  } as unknown as OpenAI;
}

describe("OpenAI CaseCompiler error classification", () => {
  it.each([
    { status: 400, expectedCode: "openai_bad_request", retryable: false },
    { status: 401, expectedCode: "openai_authentication_failed", retryable: false },
    { status: 403, expectedCode: "openai_permission_denied", retryable: false },
    { status: 408, expectedCode: "openai_timeout", retryable: true },
    { status: 404, expectedCode: "openai_request_rejected", retryable: false },
    { status: 429, expectedCode: "openai_rate_limited", retryable: true },
    { status: 500, expectedCode: "openai_server_error", retryable: true },
    { status: 503, expectedCode: "openai_server_error", retryable: true },
  ])("maps HTTP $status to $expectedCode", async ({ status, expectedCode, retryable }) => {
    const { provider, fetchCalls } = apiFailureProvider({
      status,
      errorCode: "upstream_error",
    });

    const error = await captureProviderError(provider);

    expect(error.code).toBe(expectedCode);
    expect(error.retryable).toBe(retryable);
    expect(error.message).not.toContain("Sensitive upstream detail");
    expect(fetchCalls()).toBe(1);
  });

  it("classifies a rejected Structured Output schema as non-retryable", async () => {
    const { provider } = apiFailureProvider({
      status: 400,
      errorCode: "invalid_json_schema",
      errorParam: "text.format.schema",
    });

    const error = await captureProviderError(provider);

    expect(error.code).toBe("openai_schema_invalid");
    expect(error.retryable).toBe(false);
  });

  it("carries a bounded Retry-After hint and disables hidden SDK retries", async () => {
    const { provider, fetchCalls } = apiFailureProvider({
      status: 429,
      errorCode: "rate_limit_exceeded",
      headers: { "Retry-After": "7.5" },
    });

    const error = await captureProviderError(provider);

    expect(error.code).toBe("openai_rate_limited");
    expect(error.retryAfterMs).toBe(7_500);
    expect(fetchCalls()).toBe(1);
  });

  it("caps an excessive Retry-After hint", async () => {
    const { provider } = apiFailureProvider({
      status: 503,
      errorCode: "server_error",
      headers: { "Retry-After-Ms": "60000" },
    });

    const error = await captureProviderError(provider);

    expect(error.retryAfterMs).toBe(MAX_CASE_COMPILER_RETRY_DELAY_MS);
  });

  it("parses an HTTP-date Retry-After against the injected wall clock", async () => {
    const now = Date.parse("2026-07-18T13:00:00.000Z");
    const { provider } = apiFailureProvider({
      status: 429,
      errorCode: "rate_limit_exceeded",
      headers: { "Retry-After": new Date(now + 4_000).toUTCString() },
      wallClockNow: () => now,
    });

    const error = await captureProviderError(provider);

    expect(error.retryAfterMs).toBe(4_000);
  });

  it("maps SDK connection and timeout failures to retryable stable codes", async () => {
    const networkProvider = new OpenAICaseCompilerProvider(new OpenAI({
      apiKey: "test-only-key",
      maxRetries: 2,
      fetch: async () => {
        throw new TypeError("Sensitive network detail");
      },
    }));
    const timeoutProvider = new OpenAICaseCompilerProvider(
      throwingClient(new OpenAI.APIConnectionTimeoutError({ message: "Sensitive timeout detail" })),
    );

    const [networkError, timeoutError] = await Promise.all([
      captureProviderError(networkProvider),
      captureProviderError(timeoutProvider),
    ]);

    expect(networkError).toMatchObject({ code: "openai_connection_error", retryable: true });
    expect(timeoutError).toMatchObject({ code: "openai_timeout", retryable: true });
  });

  it("maps an unexpected local client/configuration failure to a non-retryable stable code", async () => {
    const provider = new OpenAICaseCompilerProvider(
      throwingClient(new Error("Sensitive local configuration detail")),
    );

    const error = await captureProviderError(provider);

    expect(error).toMatchObject({ code: "openai_configuration_error", retryable: false });
    expect(error.message).not.toContain("Sensitive local configuration detail");
  });

  it("rejects invalid provider options with a stable non-retryable configuration code", () => {
    const client = new OpenAI({ apiKey: "test-only-key" });

    expect(() => new OpenAICaseCompilerProvider(client, { maxOutputTokens: 1 })).toThrow(
      expect.objectContaining({
        code: "openai_configuration_error",
        retryable: false,
      }),
    );
  });
});
