import { createHash } from "node:crypto";

import type { z } from "zod";

import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  CourtroomModelTokenUsageSchema,
  type CourtroomModel,
  type CourtroomModelCallAttemptTrace,
  type CourtroomModelCallCitationSet,
  type CourtroomModelCallTrace,
  type CourtroomModelTokenUsage,
} from "@/domain/courtroom-ai";
import {
  ModelMetadataSchema,
  type ModelMetadata,
} from "@/domain/trial-engine";

import {
  COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  type CourtroomRuntimeCall,
} from "./constants";
import {
  CourtroomModelProviderError,
  type CourtroomModelPrompt,
  type CourtroomModelProvider,
  type CourtroomModelProviderRequest,
  type CourtroomModelProviderResponse,
  type CourtroomModelStreamEvent,
} from "./provider";
import { estimateCourtroomModelCostUsd } from "./pricing";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

type ValidationIssueLike = Readonly<{ code: string }>;
type ValidationReportLike = Readonly<{
  status: "accepted" | "rejected";
  issues: readonly ValidationIssueLike[];
}>;

export type StructuredCallValidationResult<
  TOutput,
  TReport extends ValidationReportLike,
> =
  | Readonly<{ accepted: true; output: TOutput; report: TReport }>
  | Readonly<{ accepted: false; report: TReport }>;

export type StructuredCallTraceBinding = Readonly<{
  callId: string;
  trialId: string;
  responseId: string | null;
  actorId: string;
  actorRole: CourtroomModelCallTrace["actorRole"];
  inputEventIds: readonly string[];
  expectedStateVersion: number | null;
  expectedLastEventId: string | null;
  knowledgeScope: CourtroomModelCallTrace["knowledgeScope"];
}>;

export type StructuredCallPromptContext<
  TRequest,
  TOutput,
  TReport extends ValidationReportLike,
> =
  | Readonly<{ mode: "initial"; request: TRequest }>
  | Readonly<{
      mode: "repair";
      request: TRequest;
      rejectedCandidate: TOutput;
      validationIssues: TReport["issues"];
    }>;

export type GenerateStructuredCourtroomCallOptions<
  TRequest,
  TSchema extends z.ZodObject,
  TReport extends ValidationReportLike,
> = Readonly<{
  provider: CourtroomModelProvider;
  request: TRequest;
  signal?: AbortSignal;
  clock?: () => Date;
  monotonicNow?: () => number;
  schema: TSchema;
  schemaName: string;
  schemaVersion: string;
  promptVersion: string;
  call: CourtroomRuntimeCall;
  model: CourtroomModel;
  parseRequest: (input: TRequest) => TRequest;
  buildPrompt: (
    context: StructuredCallPromptContext<
      TRequest,
      z.output<TSchema>,
      TReport
    >,
  ) => CourtroomModelPrompt;
  validate: (
    request: TRequest,
    candidate: unknown,
  ) => StructuredCallValidationResult<z.output<TSchema>, TReport>;
  traceBinding: (request: TRequest) => StructuredCallTraceBinding;
  acceptedCitations: (
    output: z.output<TSchema>,
  ) => CourtroomModelCallCitationSet;
  proposedCitationCount: (output: z.output<TSchema>) => number;
  safeValidationFailureCode: string;
}>;

export type GeneratedStructuredCourtroomCall<TOutput> = Readonly<{
  output: TOutput;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type StructuredCourtroomCallFailureCategory =
  | "cancelled"
  | "provider_failed"
  | "validation_failed";

export class StructuredCourtroomCallError<
  TReport extends ValidationReportLike,
> extends Error {
  readonly category: StructuredCourtroomCallFailureCategory;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: TReport | null;

  constructor(
    category: StructuredCourtroomCallFailureCategory,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: TReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StructuredCourtroomCallError";
    this.category = category;
    this.trace = trace;
    this.validationReport = validationReport;
  }
}

type AttemptStreamAudit = {
  responseId: string | null;
  streamEventCount: number;
  structuredDeltaCount: number;
  streamedCharacterCount: number;
  firstStructuredDeltaMs: number | null;
};

function serialize(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeIdentifier(value: unknown, fallback: string): string {
  if (
    typeof value === "string" &&
    value.length <= 240 &&
    SAFE_IDENTIFIER.test(value)
  ) {
    return value;
  }
  const digest = sha256(typeof value === "string" ? value : serialize(value));
  return `${fallback}:${digest.slice(0, 24)}`;
}

function optionalSafeIdentifier(
  value: unknown,
  fallback: string,
): string | null {
  return value === null || value === undefined
    ? null
    : safeIdentifier(value, fallback);
}

function durationMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

function timeAtOffset(startedAt: string, offsetMs: number): string {
  return new Date(Date.parse(startedAt) + durationMs(offsetMs)).toISOString();
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function addUsage(
  attempts: readonly CourtroomModelCallAttemptTrace[],
): CourtroomModelTokenUsage | null {
  if (attempts.length === 0 || attempts.some((attempt) => attempt.usage === null)) {
    return null;
  }
  return CourtroomModelTokenUsageSchema.parse(
    attempts.reduce(
      (usage, attempt) => {
        const current = attempt.usage;
        if (current === null) return usage;
        return {
          inputTokens: usage.inputTokens + current.inputTokens,
          outputTokens: usage.outputTokens + current.outputTokens,
          totalTokens: usage.totalTokens + current.totalTokens,
          cachedInputTokens:
            usage.cachedInputTokens + current.cachedInputTokens,
          cacheWriteTokens: usage.cacheWriteTokens + current.cacheWriteTokens,
          reasoningTokens: usage.reasoningTokens + current.reasoningTokens,
        };
      },
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
    ),
  );
}

function citationCount(citations: CourtroomModelCallCitationSet): number {
  return Object.values(citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function promptInputCharacterCount(prompt: CourtroomModelPrompt): number {
  return [
    prompt.developerPrefix,
    prompt.developerContext,
    prompt.untrustedUserContent,
  ].join("\n").length;
}

function createStreamAudit(): AttemptStreamAudit {
  return {
    responseId: null,
    streamEventCount: 0,
    structuredDeltaCount: 0,
    streamedCharacterCount: 0,
    firstStructuredDeltaMs: null,
  };
}

function recordStreamEvent(
  audit: AttemptStreamAudit,
  event: CourtroomModelStreamEvent,
): void {
  audit.streamEventCount += 1;
  if (event.responseId !== null) {
    audit.responseId = optionalSafeIdentifier(
      event.responseId,
      "provider-response",
    );
  }
  if (event.type === "structured_delta") {
    audit.structuredDeltaCount += 1;
    audit.streamedCharacterCount += event.delta.length;
    audit.firstStructuredDeltaMs ??= durationMs(event.elapsedMs);
  }
}

function successfulAttemptTrace<TOutput>(
  input: Readonly<{
    attempt: number;
    mode: "initial" | "repair";
    startedAt: string;
    response: CourtroomModelProviderResponse<TOutput>;
    output: TOutput;
    status: "accepted" | "validation_failed";
    validationIssueCodes: readonly string[];
    proposedCitationCount: number;
  }>,
): CourtroomModelCallAttemptTrace {
  const serializedOutput = serialize(input.output);
  return {
    schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
    attempt: input.attempt,
    mode: input.mode,
    status: input.status,
    providerRequestId: optionalSafeIdentifier(
      input.response.requestId,
      "provider-request",
    ),
    providerResponseId: optionalSafeIdentifier(
      input.response.responseId,
      "provider-response",
    ),
    startedAt: input.startedAt,
    completedAt: timeAtOffset(input.startedAt, input.response.latencyMs),
    latencyMs: durationMs(input.response.latencyMs),
    firstStructuredDeltaMs:
      input.response.firstStructuredDeltaMs === null
        ? null
        : durationMs(input.response.firstStructuredDeltaMs),
    streamEventCount: input.response.streamEventCount,
    structuredDeltaCount: input.response.structuredDeltaCount,
    streamedCharacterCount: input.response.streamedCharacterCount,
    outputHash: sha256(serializedOutput),
    proposedCitationCount: input.proposedCitationCount,
    usage: input.response.usage,
    validationIssueCodes: stableUnique(input.validationIssueCodes),
    safeErrorCode: null,
  };
}

function failedAttemptTrace<TOutput>(
  input: Readonly<{
    attempt: number;
    mode: "initial" | "repair";
    startedAt: string;
    latencyMs: number;
    stream: AttemptStreamAudit;
    status: "provider_failed" | "cancelled";
    safeErrorCode: string;
    response?: CourtroomModelProviderResponse<TOutput>;
  }>,
): CourtroomModelCallAttemptTrace {
  return {
    schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
    attempt: input.attempt,
    mode: input.mode,
    status: input.status,
    providerRequestId:
      input.response === undefined
        ? null
        : optionalSafeIdentifier(input.response.requestId, "provider-request"),
    providerResponseId:
      input.response === undefined
        ? input.stream.responseId
        : optionalSafeIdentifier(
            input.response.responseId,
            "provider-response",
          ),
    startedAt: input.startedAt,
    completedAt: timeAtOffset(input.startedAt, input.latencyMs),
    latencyMs: durationMs(input.latencyMs),
    firstStructuredDeltaMs:
      input.response?.firstStructuredDeltaMs === undefined
        ? input.stream.firstStructuredDeltaMs
        : input.response.firstStructuredDeltaMs === null
          ? null
          : durationMs(input.response.firstStructuredDeltaMs),
    streamEventCount:
      input.response?.streamEventCount ?? input.stream.streamEventCount,
    structuredDeltaCount:
      input.response?.structuredDeltaCount ?? input.stream.structuredDeltaCount,
    streamedCharacterCount:
      input.response?.streamedCharacterCount ??
      input.stream.streamedCharacterCount,
    outputHash: null,
    proposedCitationCount: 0,
    usage: input.response?.usage ?? null,
    validationIssueCodes: [],
    safeErrorCode: input.safeErrorCode,
  };
}

function isCancelled(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof CourtroomModelProviderError &&
      error.code === "request_aborted") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function safeProviderFailureCode(error: unknown): string {
  return error instanceof CourtroomModelProviderError
    ? safeIdentifier(error.code, "provider-error")
    : "unexpected_provider_failure";
}

function makeModelMetadata<TOutput>(
  trace: CourtroomModelCallTrace,
  response: CourtroomModelProviderResponse<TOutput>,
): ModelMetadata {
  return ModelMetadataSchema.parse({
    model: trace.model,
    requestId: optionalSafeIdentifier(response.requestId, "provider-request"),
    promptVersion: trace.promptVersion,
    schemaVersion: trace.outputSchemaVersion,
    latencyMs: trace.latencyMs,
    inputTokens: trace.usage?.inputTokens ?? null,
    outputTokens: trace.usage?.outputTokens ?? null,
    estimatedCostUsd: trace.estimatedCostUsd,
    retryCount: trace.retryCount,
    validationFailureCount: trace.validationFailureCount,
  });
}

/**
 * Shared strict structured-call loop. It never exposes raw JSON deltas and it
 * performs no provider retry: only one deterministic semantic repair may
 * follow a schema-shaped but rejected initial candidate.
 */
export async function generateStructuredCourtroomCall<
  TRequest,
  TSchema extends z.ZodObject,
  TReport extends ValidationReportLike,
>(
  options: GenerateStructuredCourtroomCallOptions<TRequest, TSchema, TReport>,
): Promise<GeneratedStructuredCourtroomCall<z.output<TSchema>>> {
  const request = options.parseRequest(options.request);
  const initialPrompt = options.buildPrompt({ mode: "initial", request });
  const started = (options.clock ?? (() => new Date()))();
  if (!Number.isFinite(started.getTime())) {
    throw new Error("Structured courtroom responder clock returned an invalid date");
  }
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const startedAt = started.toISOString();
  const callStartedMonotonic = monotonicNow();
  const elapsedMs = () => durationMs(monotonicNow() - callStartedMonotonic);
  const binding = options.traceBinding(request);
  const attempts: CourtroomModelCallAttemptTrace[] = [];
  let timelineFloorMs = 0;
  let lastValidationReport: TReport | null = null;
  let rejectedCandidate: z.output<TSchema> | null = null;
  let repairIssues: TReport["issues"] = [];

  const makeTrace = (
    status: "accepted" | "failed" | "cancelled",
    safeFailureCode: string | null,
    acceptedAttempt: number | null = null,
    acceptedOutput: z.output<TSchema> | null = null,
  ): CourtroomModelCallTrace => {
    const completedLatencyMs = Math.max(timelineFloorMs, elapsedMs());
    const usage = addUsage(attempts);
    const citations: CourtroomModelCallCitationSet =
      status === "accepted" && acceptedOutput !== null
        ? options.acceptedCitations(acceptedOutput)
        : {
            factIds: [],
            evidenceIds: [],
            testimonyIds: [],
            eventIds: [],
            sourceSegmentIds: [],
            priorStatementIds: [],
          };
    const firstStructuredDeltaMs = attempts.reduce<number | null>(
      (first, attempt) => {
        if (attempt.firstStructuredDeltaMs === null) return first;
        const attemptOffset = Math.max(
          0,
          Date.parse(attempt.startedAt) - Date.parse(startedAt),
        );
        const candidate = attemptOffset + attempt.firstStructuredDeltaMs;
        return first === null ? candidate : Math.min(first, candidate);
      },
      null,
    );
    const serializedOutput =
      acceptedOutput === null ? null : serialize(acceptedOutput);
    return CourtroomModelCallTraceSchema.parse({
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      ...binding,
      inputEventIds: stableUnique(binding.inputEventIds),
      provider: safeIdentifier(options.provider.providerName, "provider"),
      model: options.model,
      providerProtocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
      promptVersion: options.promptVersion,
      outputSchemaVersion: options.schemaVersion,
      promptAudit: {
        stablePrefixHash: sha256(initialPrompt.developerPrefix),
        trustedContextHash: sha256(initialPrompt.developerContext),
        untrustedInputHash: sha256(initialPrompt.untrustedUserContent),
        inputCharacterCount: promptInputCharacterCount(initialPrompt),
      },
      status,
      startedAt,
      completedAt: timeAtOffset(startedAt, completedLatencyMs),
      latencyMs: completedLatencyMs,
      firstStructuredDeltaMs,
      firstAcceptedSegmentMs: null,
      retryCount: Math.max(0, attempts.length - 1),
      validationFailureCount: attempts.filter(
        (attempt) => attempt.status === "validation_failed",
      ).length,
      estimatedCostUsd:
        usage === null
          ? null
          : estimateCourtroomModelCostUsd(options.model, usage),
      usage,
      acceptedAttempt: status === "accepted" ? acceptedAttempt : null,
      acceptedCitations: citations,
      acceptedCitationCount: citationCount(citations),
      outputHash:
        serializedOutput === null ? null : sha256(serializedOutput),
      outputCharacterCount: serializedOutput?.length ?? 0,
      committedActionId: null,
      committedEventId: null,
      safeFailureCode,
      attempts,
      callClass: options.call.callClass,
      task: options.call.task,
    });
  };

  const throwCancelled = (): never => {
    throw new StructuredCourtroomCallError(
      "cancelled",
      "Courtroom model generation was cancelled",
      makeTrace("cancelled", "request_aborted"),
      lastValidationReport,
      options.signal?.reason === undefined
        ? undefined
        : { cause: options.signal.reason },
    );
  };

  if (options.signal?.aborted) return throwCancelled();

  for (const attempt of [1, 2] as const) {
    const mode = attempt === 1 ? "initial" : "repair";
    if (mode === "repair" && rejectedCandidate === null) break;
    if (options.signal?.aborted) return throwCancelled();

    const prompt =
      mode === "initial"
        ? initialPrompt
        : options.buildPrompt({
            mode,
            request,
            rejectedCandidate: rejectedCandidate as z.output<TSchema>,
            validationIssues: repairIssues,
          });
    const attemptStartOffset = Math.max(timelineFloorMs, elapsedMs());
    const attemptStartedAt = timeAtOffset(startedAt, attemptStartOffset);
    const stream = createStreamAudit();
    const providerRequest: CourtroomModelProviderRequest<TSchema> = {
      protocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
      ...options.call,
      mode,
      attempt,
      prompt,
      schema: options.schema,
      schemaName: options.schemaName,
      schemaVersion: options.schemaVersion,
      signal: options.signal,
      onStreamEvent: (event) => recordStreamEvent(stream, event),
    };

    let response: CourtroomModelProviderResponse<z.output<TSchema>>;
    try {
      response = await options.provider.generate(providerRequest);
    } catch (error) {
      const attemptLatencyMs = Math.max(
        elapsedMs() - attemptStartOffset,
        stream.firstStructuredDeltaMs ?? 0,
      );
      timelineFloorMs = attemptStartOffset + durationMs(attemptLatencyMs);
      const cancelled = isCancelled(error, options.signal);
      const safeErrorCode = cancelled
        ? "request_aborted"
        : safeProviderFailureCode(error);
      attempts.push(
        failedAttemptTrace({
          attempt,
          mode,
          startedAt: attemptStartedAt,
          latencyMs: attemptLatencyMs,
          stream,
          status: cancelled ? "cancelled" : "provider_failed",
          safeErrorCode,
        }),
      );
      throw new StructuredCourtroomCallError(
        cancelled ? "cancelled" : "provider_failed",
        cancelled
          ? "Courtroom model generation was cancelled"
          : "Courtroom model provider failed",
        makeTrace(cancelled ? "cancelled" : "failed", safeErrorCode),
        lastValidationReport,
        { cause: error },
      );
    }

    timelineFloorMs = Math.max(
      timelineFloorMs,
      attemptStartOffset + durationMs(response.latencyMs),
    );
    if (options.signal?.aborted) {
      attempts.push(
        failedAttemptTrace({
          attempt,
          mode,
          startedAt: attemptStartedAt,
          latencyMs: response.latencyMs,
          stream,
          status: "cancelled",
          safeErrorCode: "request_aborted",
          response,
        }),
      );
      return throwCancelled();
    }
    if (response.model !== options.model) {
      attempts.push(
        failedAttemptTrace({
          attempt,
          mode,
          startedAt: attemptStartedAt,
          latencyMs: response.latencyMs,
          stream,
          status: "provider_failed",
          safeErrorCode: "provider_contract_mismatch",
          response,
        }),
      );
      throw new StructuredCourtroomCallError(
        "provider_failed",
        "Courtroom model provider contract mismatch",
        makeTrace("failed", "provider_contract_mismatch"),
        lastValidationReport,
      );
    }

    const validation = options.validate(request, response.output);
    lastValidationReport = validation.report;
    if (!validation.accepted) {
      attempts.push(
        successfulAttemptTrace({
          attempt,
          mode,
          startedAt: attemptStartedAt,
          response,
          output: response.output,
          status: "validation_failed",
          validationIssueCodes: validation.report.issues.map(
            (validationIssue) => validationIssue.code,
          ),
          proposedCitationCount: options.proposedCitationCount(
            response.output,
          ),
        }),
      );
      rejectedCandidate = response.output;
      repairIssues = validation.report.issues;
      if (attempt === 1) continue;
      throw new StructuredCourtroomCallError(
        "validation_failed",
        "Courtroom model output failed deterministic validation",
        makeTrace("failed", options.safeValidationFailureCode),
        validation.report,
      );
    }

    attempts.push(
      successfulAttemptTrace({
        attempt,
        mode,
        startedAt: attemptStartedAt,
        response,
        output: validation.output,
        status: "accepted",
        validationIssueCodes: [],
        proposedCitationCount: options.proposedCitationCount(
          validation.output,
        ),
      }),
    );
    if (options.signal?.aborted) return throwCancelled();
    timelineFloorMs = Math.max(timelineFloorMs, elapsedMs());
    const trace = makeTrace(
      "accepted",
      null,
      attempt,
      validation.output,
    );
    return {
      output: validation.output,
      modelMetadata: makeModelMetadata(trace, response),
      trace,
    };
  }

  throw new StructuredCourtroomCallError(
    "validation_failed",
    "Courtroom model output failed deterministic validation",
    makeTrace("failed", options.safeValidationFailureCode),
    lastValidationReport,
  );
}
