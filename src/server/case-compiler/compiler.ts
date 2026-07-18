import {
  CASE_COMPILER_MODEL,
  CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
  CASE_COMPILER_PROMPT_VERSION,
  CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
  DEFAULT_CASE_COMPILER_ATTEMPTS,
  MAX_CASE_COMPILER_ATTEMPTS,
} from "./constants";
import { buildCaseCompilerPrompt, computeSourceContentHash, type CaseCompilerPromptContext } from "./prompt";
import {
  CaseCompilerProviderError,
  type CaseCompilerProvider,
  type CaseCompilerProviderRequest,
  type CaseCompilerProviderResponse,
  type CaseCompilerStreamEvent,
} from "./provider";
import {
  CaseCompilationResultSchema,
  CaseCompilerInputSchema,
  CaseCompilerObservabilitySchema,
  type CaseCompilationResult,
  type CaseCompilerAttemptTrace,
  type CaseCompilerInput,
  type CaseCompilerValidationIssue,
  type CaseCompilerValidationReport,
} from "./schemas";
import { validateCaseCompilerCandidate } from "./validation";

export type CompileCasePacketOptions = Readonly<{
  provider: CaseCompilerProvider;
  input: unknown;
  maxAttempts?: number;
  signal?: AbortSignal;
  onStreamEvent?: (event: CaseCompilerStreamEvent) => void;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type RepairCaseCompilationOptions = Readonly<{
  provider: CaseCompilerProvider;
  context: CaseCompilerPromptContext;
  signal?: AbortSignal;
  onStreamEvent?: (event: CaseCompilerStreamEvent) => void;
}>;

export class CaseCompilationError extends Error {
  readonly validationReport: CaseCompilerValidationReport | null;
  readonly attempts: readonly CaseCompilerAttemptTrace[];

  constructor(
    message: string,
    validationReport: CaseCompilerValidationReport | null,
    attempts: readonly CaseCompilerAttemptTrace[],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CaseCompilationError";
    this.validationReport = validationReport;
    this.attempts = attempts;
  }
}

function assertProviderContract(provider: CaseCompilerProvider): void {
  if (
    provider.protocolVersion !== CASE_COMPILER_PROVIDER_PROTOCOL_VERSION ||
    provider.model !== CASE_COMPILER_MODEL
  ) {
    throw new CaseCompilationError("Case compiler provider contract mismatch", null, []);
  }
}

function parseMaxAttempts(value: number | undefined): number {
  const attempts = value ?? DEFAULT_CASE_COMPILER_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_CASE_COMPILER_ATTEMPTS) {
    throw new CaseCompilationError(
      `maxAttempts must be an integer between 1 and ${MAX_CASE_COMPILER_ATTEMPTS}`,
      null,
      [],
    );
  }
  return attempts;
}

function providerFailureIssue(code: string): CaseCompilerValidationIssue {
  return {
    code: "provider_request_failed",
    path: [],
    message: `Provider request failed with code ${code.slice(0, 120)}`,
    entityId: null,
    sourceSegmentIds: [],
  };
}

function makeProviderRequest(
  provider: CaseCompilerProvider,
  context: CaseCompilerPromptContext,
  signal: AbortSignal | undefined,
  onStreamEvent: ((event: CaseCompilerStreamEvent) => void) | undefined,
): CaseCompilerProviderRequest {
  return {
    protocolVersion: CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
    model: CASE_COMPILER_MODEL,
    mode: context.mode,
    attempt: context.attempt,
    prompt: buildCaseCompilerPrompt(context),
    signal,
    onStreamEvent,
  };
}

async function requestInitialCaseCompilation(
  provider: CaseCompilerProvider,
  context: CaseCompilerPromptContext,
  signal: AbortSignal | undefined,
  onStreamEvent: ((event: CaseCompilerStreamEvent) => void) | undefined,
): Promise<CaseCompilerProviderResponse> {
  return provider.generate(makeProviderRequest(provider, context, signal, onStreamEvent));
}

/** Request one targeted model repair after deterministic validation rejects a candidate. */
export async function repairCaseCompilation(
  options: RepairCaseCompilationOptions,
): Promise<CaseCompilerProviderResponse> {
  assertProviderContract(options.provider);
  if (options.context.mode !== "repair" || (options.context.validationIssues?.length ?? 0) === 0) {
    throw new CaseCompilationError(
      "A repair request requires deterministic validation issues",
      null,
      [],
    );
  }
  return options.provider.generate(
    makeProviderRequest(
      options.provider,
      options.context,
      options.signal,
      options.onStreamEvent,
    ),
  );
}

function acceptedTrace(
  attempt: number,
  mode: "compile" | "repair",
  response: CaseCompilerProviderResponse,
  validationIssueCodes: string[],
  outcome: CaseCompilerAttemptTrace["outcome"],
): CaseCompilerAttemptTrace {
  return {
    attempt,
    mode,
    outcome,
    requestId: response.requestId,
    responseId: response.responseId,
    latencyMs: response.latencyMs,
    streamEventCount: response.streamEventCount,
    streamedCharacterCount: response.streamedCharacterCount,
    usage: response.usage,
    validationIssueCodes,
  };
}

export async function compileCasePacket(options: CompileCasePacketOptions): Promise<CaseCompilationResult> {
  assertProviderContract(options.provider);
  const input: CaseCompilerInput = CaseCompilerInputSchema.parse(options.input);
  const maxAttempts = parseMaxAttempts(options.maxAttempts);
  const clock = options.clock ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const startedMonotonic = monotonicNow();
  const startedAt = clock().toISOString();
  const compiledAt = startedAt;
  const sourceContentHash = computeSourceContentHash(input.sourceSegments);
  const attempts: CaseCompilerAttemptTrace[] = [];
  let rejectedOutput: unknown;
  let validationIssues: readonly CaseCompilerValidationIssue[] = [];
  let lastValidationReport: CaseCompilerValidationReport | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new CaseCompilationError("Case compilation was cancelled", lastValidationReport, attempts);
    }

    const mode = attempt === 1 ? "compile" : "repair";
    const context: CaseCompilerPromptContext = {
      mode,
      attempt,
      caseId: input.caseId,
      compiledAt,
      sourceContentHash,
      sourceSegments: input.sourceSegments,
      rejectedOutput,
      validationIssues,
    };

    let response: CaseCompilerProviderResponse;
    const providerStarted = monotonicNow();
    try {
      response = mode === "compile"
        ? await requestInitialCaseCompilation(
            options.provider,
            context,
            options.signal,
            options.onStreamEvent,
          )
        : await repairCaseCompilation({
            provider: options.provider,
            context,
            signal: options.signal,
            onStreamEvent: options.onStreamEvent,
          });
    } catch (error) {
      const providerError = error instanceof CaseCompilerProviderError ? error : null;
      const code = providerError?.code ?? "unexpected_provider_failure";
      attempts.push({
        attempt,
        mode,
        outcome: "provider_failed",
        requestId: null,
        responseId: null,
        latencyMs: Math.max(0, monotonicNow() - providerStarted),
        streamEventCount: 0,
        streamedCharacterCount: 0,
        usage: null,
        validationIssueCodes: ["provider_request_failed"],
      });
      validationIssues = [providerFailureIssue(code)];
      rejectedOutput = undefined;

      if (!providerError?.retryable || attempt === maxAttempts) {
        throw new CaseCompilationError(
          "Case compilation failed before a valid structured output was produced",
          lastValidationReport,
          attempts,
          { cause: error },
        );
      }
      continue;
    }

    const validation = validateCaseCompilerCandidate(response.output, {
      input,
      compiledAt,
      sourceContentHash,
      providerRequestId: response.requestId,
    });
    lastValidationReport = validation.validationReport;

    if (!validation.ok) {
      validationIssues = validation.issues;
      rejectedOutput = response.output;
      attempts.push(
        acceptedTrace(
          attempt,
          mode,
          response,
          validation.issues.map((issue) => issue.code),
          "validation_failed",
        ),
      );
      if (attempt === maxAttempts) break;
      continue;
    }

    attempts.push(acceptedTrace(attempt, mode, response, [], "accepted"));
    const completedAt = clock().toISOString();
    const observability = CaseCompilerObservabilitySchema.parse({
      protocolVersion: CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
      model: CASE_COMPILER_MODEL,
      provider: options.provider.providerName,
      promptVersion: CASE_COMPILER_PROMPT_VERSION,
      outputSchemaVersion: CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
      sourceContentHash,
      sourceSegmentCount: input.sourceSegments.length,
      startedAt,
      completedAt,
      latencyMs: Math.max(0, monotonicNow() - startedMonotonic),
      retryCount: attempts.length - 1,
      acceptedSourceCitationCount: validation.acceptedSourceCitationCount,
      estimatedCostUsd: null,
      attempts,
    });

    return CaseCompilationResultSchema.parse({
      caseGraph: validation.caseGraph,
      validationReport: validation.validationReport,
      observability,
    });
  }

  throw new CaseCompilationError(
    "Case compilation exhausted its bounded repair attempts",
    lastValidationReport,
    attempts,
  );
}
