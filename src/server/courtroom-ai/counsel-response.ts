import {
  COUNSEL_ROLE_RESPONDER_MODEL,
  COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  COUNSEL_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  CounselResponseRequestSchema,
  CounselRoleResponseModelOutputSchema,
  CourtroomModelCallCitationSetSchema,
  validateCounselResponseOutput,
  type CounselResponseRequest,
  type CounselResponseValidationReport,
  type CounselRoleResponseModelOutput,
  type CourtroomModelCallCitationSet,
  type CourtroomModelCallTrace,
  type ValidatedCounselResponse,
} from "@/domain/courtroom-ai";
import { sha256Utf8 } from "@/domain/case-graph";
import type { ModelMetadata } from "@/domain/trial-engine";

import {
  COUNSEL_RESPONSE_PROMPT_VERSION,
  buildCounselResponsePrompt,
} from "./counsel-response-prompt";
import type { CourtroomModelProvider } from "./provider";
import {
  StructuredCourtroomCallError,
  generateStructuredCourtroomCall,
} from "./structured-call";

export type GenerateCounselResponseOptions = Readonly<{
  provider: CourtroomModelProvider;
  request: CounselResponseRequest;
  signal?: AbortSignal;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type GeneratedCounselResponse = Readonly<{
  output: CounselRoleResponseModelOutput;
  response: ValidatedCounselResponse;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type CounselResponseGenerationErrorCode =
  | "counsel_response_cancelled"
  | "counsel_response_provider_failed"
  | "counsel_response_validation_failed";

export class CounselResponseGenerationError extends Error {
  readonly code: CounselResponseGenerationErrorCode;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: CounselResponseValidationReport | null;

  constructor(
    code: CounselResponseGenerationErrorCode,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: CounselResponseValidationReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CounselResponseGenerationError";
    this.code = code;
    this.trace = trace;
    this.validationReport = validationReport;
  }
}

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function acceptedCitations(
  output: CounselRoleResponseModelOutput,
): CourtroomModelCallCitationSet {
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(
      output.speechSegments.flatMap((segment) => segment.citations.factIds),
    ),
    evidenceIds: stableUnique(
      output.speechSegments.flatMap(
        (segment) => segment.citations.evidenceIds,
      ),
    ),
    testimonyIds: stableUnique(
      output.speechSegments.flatMap(
        (segment) => segment.citations.testimonyIds,
      ),
    ),
    eventIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
  });
}

function proposedCitationCount(output: CounselRoleResponseModelOutput): number {
  return output.speechSegments.reduce(
    (total, segment) =>
      total +
      Object.values(segment.citations).reduce(
        (segmentTotal, identifiers) => segmentTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function uniqueScopeCount(...identifierLists: readonly string[][]): number {
  return new Set(identifierLists.flat()).size;
}

function traceBinding(request: CounselResponseRequest) {
  const view = request.knowledgeView;
  const sourceSegmentIds = [
    ...view.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...view.publicRecord.evidence.flatMap(
      (evidence) => evidence.sourceSegmentIds,
    ),
  ];
  return {
    callId: request.callId,
    trialId: request.trialId,
    responseId: null,
    actorId: request.actorId,
    actorRole: "counsel" as const,
    inputEventIds: [request.expectedLastEventId],
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    knowledgeScope: {
      knowledgeSchemaVersion: view.schemaVersion,
      knowledgeViewHash: sha256Utf8(JSON.stringify(view)),
      stateVersion: view.stateVersion,
      factCount: uniqueScopeCount(
        view.counsel.facts.map((fact) => fact.factId),
        view.publicRecord.facts.map((fact) => fact.factId),
      ),
      evidenceCount: uniqueScopeCount(
        view.counsel.evidence.map((evidence) => evidence.evidenceId),
        view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
      ),
      testimonyCount: view.publicRecord.testimony.length,
      priorStatementCount: 0,
      sourceSegmentCount: new Set(sourceSegmentIds).size,
      publicRecordEventCount: new Set(
        view.publicRecord.testimony.map(
          (testimony) => testimony.transcriptEventId,
        ),
      ).size,
      currentExchangeCount: view.currentExchange === null ? 0 : 1,
    },
  };
}

function generationErrorCode(
  error: StructuredCourtroomCallError<CounselResponseValidationReport>,
): CounselResponseGenerationErrorCode {
  switch (error.category) {
    case "cancelled":
      return "counsel_response_cancelled";
    case "provider_failed":
      return "counsel_response_provider_failed";
    case "validation_failed":
      return "counsel_response_validation_failed";
  }
}

/** Produce one validated public opposing-counsel response for a bound plan. */
export async function generateCounselResponse(
  options: GenerateCounselResponseOptions,
): Promise<GeneratedCounselResponse> {
  try {
    const generated = await generateStructuredCourtroomCall<
      CounselResponseRequest,
      typeof CounselRoleResponseModelOutputSchema,
      CounselResponseValidationReport
    >({
      provider: options.provider,
      request: options.request,
      signal: options.signal,
      clock: options.clock,
      monotonicNow: options.monotonicNow,
      schema: CounselRoleResponseModelOutputSchema,
      schemaName: COUNSEL_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
      schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      promptVersion: COUNSEL_RESPONSE_PROMPT_VERSION,
      call: { callClass: "role_responder", task: "counsel_response" },
      model: COUNSEL_ROLE_RESPONDER_MODEL,
      parseRequest: (request) => CounselResponseRequestSchema.parse(request),
      buildPrompt: (context) => buildCounselResponsePrompt(context),
      validate: validateCounselResponseOutput,
      traceBinding,
      acceptedCitations,
      proposedCitationCount,
      safeValidationFailureCode: "counsel_response_validation_failed",
    });
    const validation = validateCounselResponseOutput(
      options.request,
      generated.output,
    );
    if (!validation.accepted) {
      throw new Error("Accepted counsel output failed deterministic replay");
    }
    return {
      ...generated,
      response: validation.response,
    };
  } catch (error) {
    if (!(error instanceof StructuredCourtroomCallError)) throw error;
    const typed =
      error as StructuredCourtroomCallError<CounselResponseValidationReport>;
    const code = generationErrorCode(typed);
    throw new CounselResponseGenerationError(
      code,
      code === "counsel_response_cancelled"
        ? "Counsel response generation was cancelled"
        : code === "counsel_response_provider_failed"
          ? "Counsel response provider failed"
          : "Counsel response failed deterministic validation",
      typed.trace,
      typed.validationReport,
      { cause: error },
    );
  }
}
