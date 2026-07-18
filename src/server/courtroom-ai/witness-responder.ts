import { createHash } from "node:crypto";

import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  CourtroomModelTokenUsageSchema,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
  WitnessAnswerModelOutputSchema,
  WitnessAnswerRequestSchema,
  validateWitnessAnswerOutput,
  type CourtroomModelCallAttemptTrace,
  type CourtroomModelCallCitationSet,
  type CourtroomModelCallTrace,
  type CourtroomModelTokenUsage,
  type ValidatedWitnessAnswer,
  type WitnessAnswerModelOutput,
  type WitnessAnswerRequest,
  type WitnessAnswerValidationReport,
} from "@/domain/courtroom-ai";
import {
  ModelMetadataSchema,
  type ModelMetadata,
} from "@/domain/trial-engine";

import {
  COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  COURTROOM_RUNTIME_MODEL,
} from "./constants";
import {
  CourtroomModelProviderError,
  type CourtroomModelProvider,
  type CourtroomModelProviderRequest,
  type CourtroomModelProviderResponse,
  type CourtroomModelStreamEvent,
} from "./provider";
import { estimateCourtroomModelCostUsd } from "./pricing";
import {
  WITNESS_ANSWER_PROMPT_VERSION,
  buildWitnessAnswerPrompt,
} from "./witness-prompt";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type AcceptedWitnessAnswerSegment = Readonly<{
  responseId: string;
  actorId: string;
  witnessId: string;
  disposition: WitnessAnswerModelOutput["disposition"];
  index: number;
  total: number;
  text: string;
  factIds: readonly string[];
  evidenceIds: readonly string[];
  priorStatementIds: readonly string[];
  performance: WitnessAnswerModelOutput["performance"];
}>;

export type GenerateWitnessAnswerOptions = Readonly<{
  provider: CourtroomModelProvider;
  request: WitnessAnswerRequest;
  signal?: AbortSignal;
  onAcceptedSegment?: (
    segment: AcceptedWitnessAnswerSegment,
  ) => void | Promise<void>;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type GeneratedWitnessAnswer = Readonly<{
  output: WitnessAnswerModelOutput;
  answer: ValidatedWitnessAnswer;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type WitnessAnswerGenerationErrorCode =
  | "witness_answer_cancelled"
  | "witness_answer_provider_failed"
  | "witness_answer_validation_failed"
  | "witness_answer_segment_delivery_failed";

export class WitnessAnswerGenerationError extends Error {
  readonly code: WitnessAnswerGenerationErrorCode;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: WitnessAnswerValidationReport | null;

  constructor(
    code: WitnessAnswerGenerationErrorCode,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: WitnessAnswerValidationReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WitnessAnswerGenerationError";
    this.code = code;
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

type TraceContext = Readonly<{
  request: WitnessAnswerRequest;
  providerName: string;
  startedAt: string;
  callStartedMonotonic: number;
  monotonicNow: () => number;
  initialPrompt: ReturnType<typeof buildWitnessAnswerPrompt>;
}>;

type TerminalTraceOptions = Readonly<{
  context: TraceContext;
  attempts: readonly CourtroomModelCallAttemptTrace[];
  status: "accepted" | "failed" | "cancelled";
  timelineFloorMs: number;
  firstAcceptedSegmentMs?: number | null;
  acceptedAttempt?: number | null;
  acceptedOutput?: WitnessAnswerModelOutput | null;
  acceptedAnswer?: ValidatedWitnessAnswer | null;
  committedActionId?: string | null;
  committedEventId?: string | null;
  safeFailureCode?: string | null;
}>;

function serialize(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashValue(value: unknown): string {
  return sha256(serialize(value));
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

function elapsedMs(context: TraceContext): number {
  return durationMs(
    context.monotonicNow() - context.callStartedMonotonic,
  );
}

function timeAtOffset(startedAt: string, offsetMs: number): string {
  return new Date(Date.parse(startedAt) + durationMs(offsetMs)).toISOString();
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function emptyCitations(): CourtroomModelCallCitationSet {
  return {
    factIds: [],
    evidenceIds: [],
    testimonyIds: [],
    eventIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
  };
}

function acceptedCitations(
  answer: ValidatedWitnessAnswer,
): CourtroomModelCallCitationSet {
  return {
    factIds: stableUnique(answer.factIds),
    evidenceIds: stableUnique(answer.evidenceIds),
    testimonyIds: [],
    eventIds: [],
    sourceSegmentIds: [],
    priorStatementIds: stableUnique(answer.priorStatementIds),
  };
}

function citationCount(citations: CourtroomModelCallCitationSet): number {
  return Object.values(citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function proposedCitationCount(output: WitnessAnswerModelOutput): number {
  return output.segments.reduce(
    (total, segment) =>
      total +
      segment.factIds.length +
      segment.evidenceIds.length +
      segment.priorStatementIds.length,
    0,
  );
}

function addUsage(
  attempts: readonly CourtroomModelCallAttemptTrace[],
): CourtroomModelTokenUsage | null {
  if (attempts.length === 0 || attempts.some((attempt) => attempt.usage === null)) {
    return null;
  }
  const totals = attempts.reduce(
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
  );
  return CourtroomModelTokenUsageSchema.parse(totals);
}

function sourceSegmentCount(request: WitnessAnswerRequest): number {
  return new Set([
    ...request.knowledgeView.publicRecord.facts.flatMap(
      (fact) => fact.sourceSegmentIds,
    ),
    ...request.knowledgeView.publicRecord.evidence.flatMap(
      (evidence) => evidence.sourceSegmentIds,
    ),
  ]).size;
}

function evidenceCount(request: WitnessAnswerRequest): number {
  return new Set([
    ...request.knowledgeView.witness.admittedSeenEvidence.map(
      (evidence) => evidence.evidenceId,
    ),
    ...request.knowledgeView.presentedEvidence.map(
      (evidence) => evidence.evidenceId,
    ),
  ]).size;
}

function promptInputCharacterCount(
  prompt: ReturnType<typeof buildWitnessAnswerPrompt>,
): number {
  return [
    prompt.developerPrefix,
    prompt.developerContext,
    prompt.untrustedUserContent,
  ].join("\n").length;
}

function makeTrace(
  options: TerminalTraceOptions,
): CourtroomModelCallTrace {
  const { context, attempts } = options;
  const completedLatencyMs = Math.max(
    durationMs(options.timelineFloorMs),
    elapsedMs(context),
  );
  const usage = addUsage(attempts);
  const output = options.acceptedOutput ?? null;
  const answer = options.acceptedAnswer ?? null;
  const citations =
    options.status === "accepted" && answer !== null
      ? acceptedCitations(answer)
      : emptyCitations();
  const firstStructuredDeltaMs = attempts.reduce<number | null>(
    (first, attempt) => {
      if (attempt.firstStructuredDeltaMs === null) return first;
      const attemptOffset = Math.max(
        0,
        Date.parse(attempt.startedAt) - Date.parse(context.startedAt),
      );
      const candidate = attemptOffset + attempt.firstStructuredDeltaMs;
      return first === null ? candidate : Math.min(first, candidate);
    },
    null,
  );
  const serializedOutput = output === null ? null : serialize(output);
  const inputEventIds = stableUnique([
    context.request.question.eventId,
    context.request.expectedLastEventId,
  ]);

  return CourtroomModelCallTraceSchema.parse({
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: context.request.callId,
    trialId: context.request.trialId,
    responseId: context.request.responseId,
    actorId: context.request.actorId,
    actorRole: "witness",
    callClass: "role_responder",
    task: "witness_answer",
    inputEventIds,
    expectedStateVersion: context.request.expectedStateVersion,
    expectedLastEventId: context.request.expectedLastEventId,
    provider: context.providerName,
    model: COURTROOM_RUNTIME_MODEL,
    providerProtocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
    promptVersion: WITNESS_ANSWER_PROMPT_VERSION,
    outputSchemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    knowledgeScope: {
      knowledgeSchemaVersion: context.request.knowledgeView.schemaVersion,
      knowledgeViewHash: hashValue(context.request.knowledgeView),
      stateVersion: context.request.knowledgeView.stateVersion,
      factCount: context.request.knowledgeView.witness.facts.length,
      evidenceCount: evidenceCount(context.request),
      testimonyCount:
        context.request.knowledgeView.publicRecord.testimony.length,
      priorStatementCount:
        context.request.knowledgeView.witness.priorStatements.length,
      sourceSegmentCount: sourceSegmentCount(context.request),
      publicRecordEventCount: new Set(
        context.request.knowledgeView.publicRecord.testimony.map(
          (testimony) => testimony.transcriptEventId,
        ),
      ).size,
      currentExchangeCount:
        context.request.knowledgeView.currentExchange === null ? 0 : 1,
    },
    promptAudit: {
      stablePrefixHash: sha256(context.initialPrompt.developerPrefix),
      trustedContextHash: sha256(context.initialPrompt.developerContext),
      untrustedInputHash: sha256(context.initialPrompt.untrustedUserContent),
      inputCharacterCount: promptInputCharacterCount(context.initialPrompt),
    },
    status: options.status,
    startedAt: context.startedAt,
    completedAt: timeAtOffset(context.startedAt, completedLatencyMs),
    latencyMs: completedLatencyMs,
    firstStructuredDeltaMs,
    firstAcceptedSegmentMs: options.firstAcceptedSegmentMs ?? null,
    retryCount: Math.max(0, attempts.length - 1),
    validationFailureCount: attempts.filter(
      (attempt) => attempt.status === "validation_failed",
    ).length,
    estimatedCostUsd:
      usage === null
        ? null
        : estimateCourtroomModelCostUsd(COURTROOM_RUNTIME_MODEL, usage),
    usage,
    acceptedAttempt:
      options.status === "accepted" ? (options.acceptedAttempt ?? null) : null,
    acceptedCitations: citations,
    acceptedCitationCount: citationCount(citations),
    outputHash: serializedOutput === null ? null : sha256(serializedOutput),
    outputCharacterCount: serializedOutput?.length ?? 0,
    committedActionId: options.committedActionId ?? null,
    committedEventId: options.committedEventId ?? null,
    safeFailureCode: options.safeFailureCode ?? null,
    attempts,
  });
}

function makeModelMetadata(
  trace: CourtroomModelCallTrace,
  acceptedResponse: CourtroomModelProviderResponse<WitnessAnswerModelOutput>,
): ModelMetadata {
  return ModelMetadataSchema.parse({
    model: trace.model,
    requestId: optionalSafeIdentifier(
      acceptedResponse.requestId,
      "provider-request",
    ),
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

function successfulAttemptTrace(
  attempt: number,
  mode: "initial" | "repair",
  startedAt: string,
  response: CourtroomModelProviderResponse<WitnessAnswerModelOutput>,
  output: WitnessAnswerModelOutput,
  status: "accepted" | "validation_failed",
  validationIssueCodes: readonly string[],
): CourtroomModelCallAttemptTrace {
  const serializedOutput = serialize(output);
  return {
    schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
    attempt,
    mode,
    status,
    providerRequestId: optionalSafeIdentifier(
      response.requestId,
      "provider-request",
    ),
    providerResponseId: optionalSafeIdentifier(
      response.responseId,
      "provider-response",
    ),
    startedAt,
    completedAt: timeAtOffset(startedAt, response.latencyMs),
    latencyMs: durationMs(response.latencyMs),
    firstStructuredDeltaMs:
      response.firstStructuredDeltaMs === null
        ? null
        : durationMs(response.firstStructuredDeltaMs),
    streamEventCount: response.streamEventCount,
    structuredDeltaCount: response.structuredDeltaCount,
    streamedCharacterCount: response.streamedCharacterCount,
    outputHash: sha256(serializedOutput),
    proposedCitationCount: proposedCitationCount(output),
    usage: response.usage,
    validationIssueCodes: stableUnique(validationIssueCodes),
    safeErrorCode: null,
  };
}

function failedAttemptTrace(
  attempt: number,
  mode: "initial" | "repair",
  startedAt: string,
  latencyMs: number,
  stream: AttemptStreamAudit,
  status: "provider_failed" | "cancelled",
  safeErrorCode: string,
  response?: CourtroomModelProviderResponse<WitnessAnswerModelOutput>,
): CourtroomModelCallAttemptTrace {
  return {
    schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
    attempt,
    mode,
    status,
    providerRequestId:
      response === undefined
        ? null
        : optionalSafeIdentifier(response.requestId, "provider-request"),
    providerResponseId:
      response === undefined
        ? stream.responseId
        : optionalSafeIdentifier(response.responseId, "provider-response"),
    startedAt,
    completedAt: timeAtOffset(startedAt, latencyMs),
    latencyMs: durationMs(latencyMs),
    firstStructuredDeltaMs:
      response?.firstStructuredDeltaMs === undefined
        ? stream.firstStructuredDeltaMs
        : response.firstStructuredDeltaMs === null
          ? null
          : durationMs(response.firstStructuredDeltaMs),
    streamEventCount: response?.streamEventCount ?? stream.streamEventCount,
    structuredDeltaCount:
      response?.structuredDeltaCount ?? stream.structuredDeltaCount,
    streamedCharacterCount:
      response?.streamedCharacterCount ?? stream.streamedCharacterCount,
    outputHash: null,
    proposedCitationCount: 0,
    usage: response?.usage ?? null,
    validationIssueCodes: [],
    safeErrorCode,
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

function throwIfAborted(
  signal: AbortSignal | undefined,
  trace: () => CourtroomModelCallTrace,
  validationReport: WitnessAnswerValidationReport | null,
): void {
  if (!signal?.aborted) return;
  throw new WitnessAnswerGenerationError(
    "witness_answer_cancelled",
    "Witness answer generation was cancelled",
    trace(),
    validationReport,
    signal.reason === undefined ? undefined : { cause: signal.reason },
  );
}

function acceptedSegments(
  request: WitnessAnswerRequest,
  output: WitnessAnswerModelOutput,
  answer: ValidatedWitnessAnswer,
): AcceptedWitnessAnswerSegment[] {
  const segments =
    output.disposition === "substantive"
      ? output.segments
      : [
          {
            text: answer.text,
            factIds: [],
            evidenceIds: [],
            priorStatementIds: [],
          },
        ];
  return segments.map((segment, index) => ({
    responseId: request.responseId,
    actorId: request.actorId,
    witnessId: request.witnessId,
    disposition: output.disposition,
    index,
    total: segments.length,
    text: segment.text,
    factIds: segment.factIds,
    evidenceIds: segment.evidenceIds,
    priorStatementIds: segment.priorStatementIds,
    performance: output.performance,
  }));
}

/**
 * Produce one validated witness answer. Provider failures are terminal; the
 * only second call is a single targeted repair after deterministic semantic
 * validation rejects the initial candidate.
 */
export async function generateWitnessAnswer(
  options: GenerateWitnessAnswerOptions,
): Promise<GeneratedWitnessAnswer> {
  const request = WitnessAnswerRequestSchema.parse(options.request);
  const initialPrompt = buildWitnessAnswerPrompt({ mode: "initial", request });
  const started = (options.clock ?? (() => new Date()))();
  if (!Number.isFinite(started.getTime())) {
    throw new Error("Witness responder clock returned an invalid date");
  }
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const context: TraceContext = {
    request,
    providerName: safeIdentifier(options.provider.providerName, "provider"),
    startedAt: started.toISOString(),
    callStartedMonotonic: monotonicNow(),
    monotonicNow,
    initialPrompt,
  };
  const attempts: CourtroomModelCallAttemptTrace[] = [];
  let timelineFloorMs = 0;
  let lastValidationReport: WitnessAnswerValidationReport | null = null;
  let rejectedCandidate: WitnessAnswerModelOutput | null = null;
  let repairIssues: WitnessAnswerValidationReport["issues"] = [];

  const terminalTrace = (
    status: "failed" | "cancelled",
    safeFailureCode: string,
  ) =>
    makeTrace({
      context,
      attempts,
      status,
      timelineFloorMs,
      safeFailureCode,
    });

  throwIfAborted(
    options.signal,
    () => terminalTrace("cancelled", "request_aborted"),
    null,
  );

  for (const attempt of [1, 2] as const) {
    const mode = attempt === 1 ? "initial" : "repair";
    if (mode === "repair" && rejectedCandidate === null) break;

    throwIfAborted(
      options.signal,
      () => terminalTrace("cancelled", "request_aborted"),
      lastValidationReport,
    );

    const prompt =
      mode === "initial"
        ? initialPrompt
        : buildWitnessAnswerPrompt({
            mode,
            request,
            rejectedCandidate,
            validationIssues: repairIssues,
          });
    const attemptStartOffset = Math.max(timelineFloorMs, elapsedMs(context));
    const attemptStartedAt = timeAtOffset(
      context.startedAt,
      attemptStartOffset,
    );
    const stream = createStreamAudit();
    const providerRequest: CourtroomModelProviderRequest<
      typeof WitnessAnswerModelOutputSchema
    > = {
      protocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
      callClass: "role_responder",
      task: "witness_answer",
      mode,
      attempt,
      prompt,
      schema: WitnessAnswerModelOutputSchema,
      schemaName: WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      signal: options.signal,
      onStreamEvent: (event) => recordStreamEvent(stream, event),
    };

    let response: CourtroomModelProviderResponse<WitnessAnswerModelOutput>;
    try {
      response = await options.provider.generate(providerRequest);
    } catch (error) {
      const attemptLatencyMs = Math.max(
        elapsedMs(context) - attemptStartOffset,
        stream.firstStructuredDeltaMs ?? 0,
      );
      timelineFloorMs = attemptStartOffset + durationMs(attemptLatencyMs);
      const cancelled = isCancelled(error, options.signal);
      const safeErrorCode = cancelled
        ? "request_aborted"
        : safeProviderFailureCode(error);
      attempts.push(
        failedAttemptTrace(
          attempt,
          mode,
          attemptStartedAt,
          attemptLatencyMs,
          stream,
          cancelled ? "cancelled" : "provider_failed",
          safeErrorCode,
        ),
      );
      const trace = terminalTrace(
        cancelled ? "cancelled" : "failed",
        safeErrorCode,
      );
      throw new WitnessAnswerGenerationError(
        cancelled
          ? "witness_answer_cancelled"
          : "witness_answer_provider_failed",
        cancelled
          ? "Witness answer generation was cancelled"
          : "Witness answer provider failed",
        trace,
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
        failedAttemptTrace(
          attempt,
          mode,
          attemptStartedAt,
          response.latencyMs,
          stream,
          "cancelled",
          "request_aborted",
          response,
        ),
      );
      const trace = terminalTrace("cancelled", "request_aborted");
      throw new WitnessAnswerGenerationError(
        "witness_answer_cancelled",
        "Witness answer generation was cancelled",
        trace,
        lastValidationReport,
        options.signal.reason === undefined
          ? undefined
          : { cause: options.signal.reason },
      );
    }

    if (response.model !== COURTROOM_RUNTIME_MODEL) {
      attempts.push(
        failedAttemptTrace(
          attempt,
          mode,
          attemptStartedAt,
          response.latencyMs,
          stream,
          "provider_failed",
          "provider_contract_mismatch",
          response,
        ),
      );
      const trace = terminalTrace("failed", "provider_contract_mismatch");
      throw new WitnessAnswerGenerationError(
        "witness_answer_provider_failed",
        "Witness answer provider contract mismatch",
        trace,
        lastValidationReport,
      );
    }

    const validation = validateWitnessAnswerOutput(request, response.output);
    lastValidationReport = validation.report;
    if (!validation.accepted) {
      attempts.push(
        successfulAttemptTrace(
          attempt,
          mode,
          attemptStartedAt,
          response,
          response.output,
          "validation_failed",
          validation.report.issues.map((issue) => issue.code),
        ),
      );
      rejectedCandidate = response.output;
      repairIssues = validation.report.issues;
      if (attempt === 1) continue;

      const trace = terminalTrace(
        "failed",
        "witness_answer_validation_failed",
      );
      throw new WitnessAnswerGenerationError(
        "witness_answer_validation_failed",
        "Witness answer failed deterministic validation",
        trace,
        validation.report,
      );
    }

    attempts.push(
      successfulAttemptTrace(
        attempt,
        mode,
        attemptStartedAt,
        response,
        validation.output,
        "accepted",
        [],
      ),
    );

    throwIfAborted(
      options.signal,
      () => terminalTrace("cancelled", "request_aborted"),
      validation.report,
    );

    let firstAcceptedSegmentMs: number | null = null;
    if (options.onAcceptedSegment !== undefined) {
      try {
        for (const segment of acceptedSegments(
          request,
          validation.output,
          validation.answer,
        )) {
          throwIfAborted(
            options.signal,
            () => terminalTrace("cancelled", "request_aborted"),
            validation.report,
          );
          const emittedAt = Math.max(timelineFloorMs, elapsedMs(context));
          firstAcceptedSegmentMs ??= emittedAt;
          await options.onAcceptedSegment(segment);
        }
      } catch (error) {
        if (error instanceof WitnessAnswerGenerationError) throw error;
        timelineFloorMs = Math.max(timelineFloorMs, elapsedMs(context));
        const trace = terminalTrace(
          options.signal?.aborted ? "cancelled" : "failed",
          options.signal?.aborted
            ? "request_aborted"
            : "accepted_segment_sink_failed",
        );
        throw new WitnessAnswerGenerationError(
          options.signal?.aborted
            ? "witness_answer_cancelled"
            : "witness_answer_segment_delivery_failed",
          options.signal?.aborted
            ? "Witness answer generation was cancelled"
            : "Accepted witness segment delivery failed",
          trace,
          validation.report,
          { cause: error },
        );
      }
    }

    throwIfAborted(
      options.signal,
      () => terminalTrace("cancelled", "request_aborted"),
      validation.report,
    );
    timelineFloorMs = Math.max(timelineFloorMs, elapsedMs(context));
    const trace = makeTrace({
      context,
      attempts,
      status: "accepted",
      timelineFloorMs,
      firstAcceptedSegmentMs,
      acceptedAttempt: attempt,
      acceptedOutput: validation.output,
      acceptedAnswer: validation.answer,
      safeFailureCode: null,
    });
    return {
      output: validation.output,
      answer: validation.answer,
      modelMetadata: makeModelMetadata(trace, response),
      trace,
    };
  }

  const trace = terminalTrace("failed", "witness_answer_validation_failed");
  throw new WitnessAnswerGenerationError(
    "witness_answer_validation_failed",
    "Witness answer failed deterministic validation",
    trace,
    lastValidationReport,
  );
}
