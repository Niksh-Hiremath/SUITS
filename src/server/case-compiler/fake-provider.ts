import {
  CASE_COMPILER_MODEL,
  CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
} from "./constants";
import {
  CaseCompilerProviderError,
  type CaseCompilerProvider,
  type CaseCompilerProviderRequest,
  type CaseCompilerProviderResponse,
} from "./provider";

export type DeterministicCaseCompilerOutputFactory = (
  request: CaseCompilerProviderRequest,
) => unknown | Promise<unknown>;

export type DeterministicCaseCompilerStep =
  | Readonly<{ type: "output"; output: unknown | DeterministicCaseCompilerOutputFactory }>
  | Readonly<{ type: "error"; code: string; message: string; retryable: boolean }>;

function approximateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export class DeterministicCaseCompilerProvider implements CaseCompilerProvider {
  readonly protocolVersion = CASE_COMPILER_PROVIDER_PROTOCOL_VERSION;
  readonly model = CASE_COMPILER_MODEL;
  readonly providerName = "deterministic-case-compiler";
  readonly requests: CaseCompilerProviderRequest[] = [];

  readonly #steps: readonly DeterministicCaseCompilerStep[];
  #nextStep = 0;

  constructor(steps: readonly DeterministicCaseCompilerStep[]) {
    if (steps.length === 0) {
      throw new Error("The deterministic compiler provider requires at least one step");
    }
    this.#steps = steps;
  }

  async generate(request: CaseCompilerProviderRequest): Promise<CaseCompilerProviderResponse> {
    if (request.signal?.aborted) {
      throw new CaseCompilerProviderError("request_aborted", "Case compilation was cancelled", false);
    }

    this.requests.push(request);
    const step = this.#steps[Math.min(this.#nextStep, this.#steps.length - 1)];
    this.#nextStep += 1;

    if (step.type === "error") {
      request.onStreamEvent?.({ type: "response_failed", code: step.code });
      throw new CaseCompilerProviderError(step.code, step.message, step.retryable);
    }

    const output =
      typeof step.output === "function" ? await step.output(request) : step.output;
    const serialized = JSON.stringify(output) ?? "null";
    const responseId = `fake-compiler-response-${request.attempt}`;
    const requestId = `fake-compiler-request-${request.attempt}`;

    request.onStreamEvent?.({ type: "response_started", responseId });
    request.onStreamEvent?.({ type: "structured_delta", delta: serialized });
    request.onStreamEvent?.({ type: "response_completed", responseId });

    const inputText = [
      request.prompt.developerPrefix,
      request.prompt.developerContext,
      request.prompt.untrustedUserContent,
    ].join("\n");
    const inputTokens = approximateTokens(inputText);
    const outputTokens = approximateTokens(serialized);

    return {
      output,
      requestId,
      responseId,
      latencyMs: 0,
      streamEventCount: 3,
      streamedCharacterCount: serialized.length,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
    };
  }
}
