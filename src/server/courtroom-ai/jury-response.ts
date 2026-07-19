import { sha256Utf8 } from "@/domain/case-graph";
import {
  JURY_ROLE_RESPONDER_MODEL,
  JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JURY_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  JuryRoleResponseModelOutputSchema,
  type JuryRoleResponseModelOutput,
} from "@/domain/courtroom-ai/call-contracts";
import {
  CourtroomModelCallCitationSetSchema,
  type CourtroomModelCallCitationSet,
  type CourtroomModelCallTrace,
} from "@/domain/courtroom-ai/model-call-trace";
import {
  JuryResponseRequestSchema,
  validateJuryResponseOutput,
  type JuryResponseRequest,
  type JuryResponseValidationReport,
  type ValidatedJuryResponse,
} from "@/domain/courtroom-ai/jury-response";
import type { ModelMetadata } from "@/domain/trial-engine";

import {
  JURY_RESPONSE_PROMPT_VERSION,
  buildJuryResponsePrompt,
} from "./jury-response-prompt";
import type { CourtroomModelProvider } from "./provider";
import {
  StructuredCourtroomCallError,
  generateStructuredCourtroomCall,
} from "./structured-call";

export type GenerateJuryResponseOptions = Readonly<{
  provider: CourtroomModelProvider;
  request: JuryResponseRequest;
  signal?: AbortSignal;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type GeneratedJuryResponse = Readonly<{
  output: JuryRoleResponseModelOutput;
  response: ValidatedJuryResponse;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type JuryResponseGenerationErrorCode =
  | "jury_response_cancelled"
  | "jury_response_provider_failed"
  | "jury_response_validation_failed";

export class JuryResponseGenerationError extends Error {
  readonly code: JuryResponseGenerationErrorCode;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: JuryResponseValidationReport | null;

  constructor(
    code: JuryResponseGenerationErrorCode,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: JuryResponseValidationReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JuryResponseGenerationError";
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

function allCitationSets(output: JuryRoleResponseModelOutput) {
  return [
    ...output.deliberationSegments.map(({ citations }) => citations),
    ...output.findings.map(({ citations }) => citations),
  ];
}

function acceptedCitations(
  output: JuryRoleResponseModelOutput,
): CourtroomModelCallCitationSet {
  const citations = allCitationSets(output);
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(citations.flatMap(({ factIds }) => factIds)),
    evidenceIds: stableUnique(
      citations.flatMap(({ evidenceIds }) => evidenceIds),
    ),
    testimonyIds: stableUnique(
      citations.flatMap(({ testimonyIds }) => testimonyIds),
    ),
    eventIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
  });
}

function proposedCitationCount(output: JuryRoleResponseModelOutput): number {
  return allCitationSets(output).reduce(
    (total, citations) =>
      total +
      Object.values(citations).reduce(
        (citationTotal, identifiers) =>
          citationTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function traceBinding(request: JuryResponseRequest) {
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
    actorRole: "jury" as const,
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
      currentExchangeCount: 0,
    },
  };
}

function generationErrorCode(
  error: StructuredCourtroomCallError<JuryResponseValidationReport>,
): JuryResponseGenerationErrorCode {
  switch (error.category) {
    case "cancelled":
      return "jury_response_cancelled";
    case "provider_failed":
      return "jury_response_provider_failed";
    case "validation_failed":
      return "jury_response_validation_failed";
  }
}

/** Produce one validated Luna jury response from the admitted jury record. */
export async function generateJuryResponse(
  options: GenerateJuryResponseOptions,
): Promise<GeneratedJuryResponse> {
  try {
    const generated = await generateStructuredCourtroomCall<
      JuryResponseRequest,
      typeof JuryRoleResponseModelOutputSchema,
      JuryResponseValidationReport
    >({
      provider: options.provider,
      request: options.request,
      signal: options.signal,
      clock: options.clock,
      monotonicNow: options.monotonicNow,
      schema: JuryRoleResponseModelOutputSchema,
      schemaName: JURY_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
      schemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      promptVersion: JURY_RESPONSE_PROMPT_VERSION,
      call: { callClass: "role_responder", task: "jury_deliberation" },
      model: JURY_ROLE_RESPONDER_MODEL,
      parseRequest: (request) => JuryResponseRequestSchema.parse(request),
      buildPrompt: (context) => buildJuryResponsePrompt(context),
      validate: validateJuryResponseOutput,
      traceBinding,
      acceptedCitations,
      proposedCitationCount,
      safeValidationFailureCode: "jury_response_validation_failed",
    });
    const validation = validateJuryResponseOutput(
      options.request,
      generated.output,
    );
    if (!validation.accepted) {
      throw new Error("Accepted jury output failed deterministic replay");
    }
    return {
      ...generated,
      response: validation.response,
    };
  } catch (error) {
    if (!(error instanceof StructuredCourtroomCallError)) throw error;
    const typed =
      error as StructuredCourtroomCallError<JuryResponseValidationReport>;
    const code = generationErrorCode(typed);
    throw new JuryResponseGenerationError(
      code,
      code === "jury_response_cancelled"
        ? "Jury response generation was cancelled"
        : code === "jury_response_provider_failed"
          ? "Jury response provider failed"
          : "Jury response failed deterministic validation",
      typed.trace,
      typed.validationReport,
      { cause: error },
    );
  }
}
