import {
  OBJECTION_RESOLVER_MODEL,
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  OBJECTION_RULING_STRUCTURED_OUTPUT_NAME,
  ObjectionRulingModelOutputSchema,
  type ObjectionRulingModelOutput,
} from "@/domain/courtroom-ai/call-contracts";
import {
  CourtroomModelCallCitationSetSchema,
  type CourtroomModelCallCitationSet,
  type CourtroomModelCallTrace,
} from "@/domain/courtroom-ai/model-call-trace";
import {
  ObjectionRulingRequestSchema,
  validateObjectionRulingOutput,
  type ObjectionRulingRequest,
  type ObjectionRulingValidationReport,
  type ValidatedObjectionRuling,
} from "@/domain/courtroom-ai/objection-ruling";
import { sha256Utf8 } from "@/domain/case-graph";
import type { ModelMetadata } from "@/domain/trial-engine";

import {
  OBJECTION_RULING_PROMPT_VERSION,
  buildObjectionRulingPrompt,
} from "./objection-ruling-prompt";
import type { CourtroomModelProvider } from "./provider";
import {
  StructuredCourtroomCallError,
  generateStructuredCourtroomCall,
} from "./structured-call";

export type GenerateObjectionRulingOptions = Readonly<{
  provider: CourtroomModelProvider;
  request: ObjectionRulingRequest;
  signal?: AbortSignal;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type GeneratedObjectionRuling = Readonly<{
  output: ObjectionRulingModelOutput;
  ruling: ValidatedObjectionRuling;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type ObjectionRulingGenerationErrorCode =
  | "objection_ruling_cancelled"
  | "objection_ruling_provider_failed"
  | "objection_ruling_validation_failed";

export class ObjectionRulingGenerationError extends Error {
  readonly code: ObjectionRulingGenerationErrorCode;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: ObjectionRulingValidationReport | null;

  constructor(
    code: ObjectionRulingGenerationErrorCode,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: ObjectionRulingValidationReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ObjectionRulingGenerationError";
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
  request: ObjectionRulingRequest,
  output: ObjectionRulingModelOutput,
): CourtroomModelCallCitationSet {
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(output.citations.factIds),
    evidenceIds: stableUnique(output.citations.evidenceIds),
    testimonyIds: stableUnique(output.citations.testimonyIds),
    eventIds: output.citations.transcriptTurnIds.includes(
      request.question.turnId,
    )
      ? [request.question.eventId]
      : [],
    sourceSegmentIds: stableUnique(output.citations.sourceSegmentIds),
    priorStatementIds: [],
  });
}

function proposedCitationCount(output: ObjectionRulingModelOutput): number {
  return Object.values(output.citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function traceBinding(request: ObjectionRulingRequest) {
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
    responseId: request.interruption?.interruptedResponseId ?? null,
    actorId: request.actorId,
    actorRole: "judge" as const,
    inputEventIds: stableUnique([
      request.expectedLastEventId,
      request.objection.sourceEventId,
      request.question.eventId,
      ...(request.interruption === null
        ? []
        : [request.interruption.sourceEventId]),
    ]),
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
  error: StructuredCourtroomCallError<ObjectionRulingValidationReport>,
): ObjectionRulingGenerationErrorCode {
  switch (error.category) {
    case "cancelled":
      return "objection_ruling_cancelled";
    case "provider_failed":
      return "objection_ruling_provider_failed";
    case "validation_failed":
      return "objection_ruling_validation_failed";
  }
}

/** Produce one validated Luna objection ruling for an exact pending objection. */
export async function generateObjectionRuling(
  options: GenerateObjectionRulingOptions,
): Promise<GeneratedObjectionRuling> {
  const request = ObjectionRulingRequestSchema.parse(options.request);
  try {
    const generated = await generateStructuredCourtroomCall<
      ObjectionRulingRequest,
      typeof ObjectionRulingModelOutputSchema,
      ObjectionRulingValidationReport
    >({
      provider: options.provider,
      request,
      signal: options.signal,
      clock: options.clock,
      monotonicNow: options.monotonicNow,
      schema: ObjectionRulingModelOutputSchema,
      schemaName: OBJECTION_RULING_STRUCTURED_OUTPUT_NAME,
      schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
      promptVersion: OBJECTION_RULING_PROMPT_VERSION,
      call: { callClass: "objection_resolver", task: "resolve_objection" },
      model: OBJECTION_RESOLVER_MODEL,
      parseRequest: (request) => ObjectionRulingRequestSchema.parse(request),
      buildPrompt: (context) => buildObjectionRulingPrompt(context),
      validate: validateObjectionRulingOutput,
      traceBinding,
      acceptedCitations: (output) => acceptedCitations(request, output),
      proposedCitationCount,
      safeValidationFailureCode: "objection_ruling_validation_failed",
    });
    const validation = validateObjectionRulingOutput(
      request,
      generated.output,
    );
    if (!validation.accepted) {
      throw new Error("Accepted objection ruling failed deterministic replay");
    }
    return { ...generated, ruling: validation.ruling };
  } catch (error) {
    if (!(error instanceof StructuredCourtroomCallError)) throw error;
    const typed =
      error as StructuredCourtroomCallError<ObjectionRulingValidationReport>;
    const code = generationErrorCode(typed);
    throw new ObjectionRulingGenerationError(
      code,
      code === "objection_ruling_cancelled"
        ? "Objection ruling generation was cancelled"
        : code === "objection_ruling_provider_failed"
          ? "Objection ruling provider failed"
          : "Objection ruling failed deterministic validation",
      typed.trace,
      typed.validationReport,
      { cause: error },
    );
  }
}
