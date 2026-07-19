import {
  JUDGE_ROLE_RESPONDER_MODEL,
  JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JUDGE_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  JudgeRoleResponseModelOutputSchema,
  type JudgeRoleResponseModelOutput,
} from "@/domain/courtroom-ai/call-contracts";
import {
  CourtroomModelCallCitationSetSchema,
  type CourtroomModelCallCitationSet,
  type CourtroomModelCallTrace,
} from "@/domain/courtroom-ai/model-call-trace";
import {
  JudgeResponseRequestSchema,
  validateJudgeResponseOutput,
  type JudgeResponseRequest,
  type JudgeResponseValidationReport,
  type ValidatedJudgeResponse,
} from "@/domain/courtroom-ai/judge-response";
import { sha256Utf8 } from "@/domain/case-graph";
import type { ModelMetadata } from "@/domain/trial-engine";

import {
  JUDGE_RESPONSE_PROMPT_VERSION,
  buildJudgeResponsePrompt,
} from "./judge-response-prompt";
import type { CourtroomModelProvider } from "./provider";
import {
  StructuredCourtroomCallError,
  generateStructuredCourtroomCall,
} from "./structured-call";

export type GenerateJudgeResponseOptions = Readonly<{
  provider: CourtroomModelProvider;
  request: JudgeResponseRequest;
  signal?: AbortSignal;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type GeneratedJudgeResponse = Readonly<{
  output: JudgeRoleResponseModelOutput;
  response: ValidatedJudgeResponse;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type JudgeResponseGenerationErrorCode =
  | "judge_response_cancelled"
  | "judge_response_provider_failed"
  | "judge_response_validation_failed";

export class JudgeResponseGenerationError extends Error {
  readonly code: JudgeResponseGenerationErrorCode;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: JudgeResponseValidationReport | null;

  constructor(
    code: JudgeResponseGenerationErrorCode,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: JudgeResponseValidationReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JudgeResponseGenerationError";
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
  output: JudgeRoleResponseModelOutput,
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
    sourceSegmentIds: stableUnique(
      output.speechSegments.flatMap(
        (segment) => segment.citations.sourceSegmentIds,
      ),
    ),
    priorStatementIds: [],
  });
}

function proposedCitationCount(output: JudgeRoleResponseModelOutput): number {
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

function traceBinding(request: JudgeResponseRequest) {
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
    actorRole: "judge" as const,
    inputEventIds: [request.expectedLastEventId],
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    knowledgeScope: {
      knowledgeSchemaVersion: view.schemaVersion,
      knowledgeViewHash: sha256Utf8(JSON.stringify(view)),
      stateVersion: view.stateVersion,
      factCount: view.publicRecord.facts.length,
      evidenceCount: view.publicRecord.evidence.length,
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
  error: StructuredCourtroomCallError<JudgeResponseValidationReport>,
): JudgeResponseGenerationErrorCode {
  switch (error.category) {
    case "cancelled":
      return "judge_response_cancelled";
    case "provider_failed":
      return "judge_response_provider_failed";
    case "validation_failed":
      return "judge_response_validation_failed";
  }
}

/** Produce one validated, role-isolated Luna judge response. */
export async function generateJudgeResponse(
  options: GenerateJudgeResponseOptions,
): Promise<GeneratedJudgeResponse> {
  const request = JudgeResponseRequestSchema.parse(options.request);
  try {
    const generated = await generateStructuredCourtroomCall<
      JudgeResponseRequest,
      typeof JudgeRoleResponseModelOutputSchema,
      JudgeResponseValidationReport
    >({
      provider: options.provider,
      request,
      signal: options.signal,
      clock: options.clock,
      monotonicNow: options.monotonicNow,
      schema: JudgeRoleResponseModelOutputSchema,
      schemaName: JUDGE_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
      schemaVersion: JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      promptVersion: JUDGE_RESPONSE_PROMPT_VERSION,
      call: { callClass: "role_responder", task: "judge_response" },
      model: JUDGE_ROLE_RESPONDER_MODEL,
      parseRequest: (request) => JudgeResponseRequestSchema.parse(request),
      buildPrompt: (context) => buildJudgeResponsePrompt(context),
      validate: validateJudgeResponseOutput,
      traceBinding,
      acceptedCitations,
      proposedCitationCount,
      safeValidationFailureCode: "judge_response_validation_failed",
    });
    const validation = validateJudgeResponseOutput(
      request,
      generated.output,
    );
    if (!validation.accepted) {
      throw new Error("Accepted judge output failed deterministic replay");
    }
    return { ...generated, response: validation.response };
  } catch (error) {
    if (!(error instanceof StructuredCourtroomCallError)) throw error;
    const typed =
      error as StructuredCourtroomCallError<JudgeResponseValidationReport>;
    const code = generationErrorCode(typed);
    throw new JudgeResponseGenerationError(
      code,
      code === "judge_response_cancelled"
        ? "Judge response generation was cancelled"
        : code === "judge_response_provider_failed"
          ? "Judge response provider failed"
          : "Judge response failed deterministic validation",
      typed.trace,
      typed.validationReport,
      { cause: error },
    );
  }
}
