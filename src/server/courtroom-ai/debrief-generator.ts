import { sha256Utf8 } from "@/domain/case-graph";
import {
  DEBRIEF_GENERATOR_MODEL,
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DEBRIEF_GENERATOR_STRUCTURED_OUTPUT_NAME,
  DebriefGeneratorModelOutputSchema,
  type DebriefCitationSet,
  type DebriefGeneratorModelOutput,
} from "@/domain/courtroom-ai/call-contracts";
import {
  DebriefGeneratorRequestSchema,
  debriefTranscriptEventIds,
  validateDebriefGeneratorOutput,
  type DebriefGeneratorRequest,
  type DebriefGeneratorValidationReport,
} from "@/domain/courtroom-ai/debrief-generator";
import {
  CourtroomModelCallCitationSetSchema,
  type CourtroomModelCallCitationSet,
  type CourtroomModelCallTrace,
} from "@/domain/courtroom-ai/model-call-trace";
import type { ModelMetadata } from "@/domain/trial-engine";

import {
  DEBRIEF_GENERATOR_PROMPT_VERSION,
  buildDebriefGeneratorPrompt,
} from "./debrief-generator-prompt";
import type { CourtroomModelProvider } from "./provider";
import {
  StructuredCourtroomCallError,
  generateStructuredCourtroomCall,
} from "./structured-call";

export type GenerateDebriefOptions = Readonly<{
  provider: CourtroomModelProvider;
  request: DebriefGeneratorRequest;
  signal?: AbortSignal;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type GeneratedDebrief = Readonly<{
  output: DebriefGeneratorModelOutput;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type DebriefGenerationErrorCode =
  | "debrief_generation_cancelled"
  | "debrief_generation_provider_failed"
  | "debrief_generation_validation_failed";

export class DebriefGenerationError extends Error {
  readonly code: DebriefGenerationErrorCode;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: DebriefGeneratorValidationReport | null;

  constructor(
    code: DebriefGenerationErrorCode,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: DebriefGeneratorValidationReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DebriefGenerationError";
    this.code = code;
    this.trace = trace;
    this.validationReport = validationReport;
  }
}

const TRACE_CITATION_LIMIT = 128;

function boundedStableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, TRACE_CITATION_LIMIT);
}

function allCitationSets(
  output: DebriefGeneratorModelOutput,
): DebriefCitationSet[] {
  const citations = [output.overallAssessment.citations];
  for (const field of [
    "strengths",
    "weakQuestions",
    "missedEvidence",
    "contradictions",
    "objectionAccuracy",
    "witnessStrategy",
    "settlementChoices",
    "juryMovement",
  ] as const) {
    citations.push(...output[field].map((point) => point.citations));
  }
  citations.push(
    ...output.improvedClosing.segments.map((segment) => segment.citations),
  );
  return citations;
}

function acceptedCitations(
  request: DebriefGeneratorRequest,
  output: DebriefGeneratorModelOutput,
): CourtroomModelCallCitationSet {
  const citations = allCitationSets(output);
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: boundedStableUnique(
      citations.flatMap((citation) => [
        ...citation.admittedFactIds,
        ...citation.unadmittedFactIds,
        ...citation.excludedFactIds,
        ...citation.hiddenFactIds,
      ]),
    ),
    evidenceIds: boundedStableUnique(
      citations.flatMap((citation) => [
        ...citation.admittedEvidenceIds,
        ...citation.unadmittedEvidenceIds,
        ...citation.excludedEvidenceIds,
      ]),
    ),
    testimonyIds: boundedStableUnique(
      citations.flatMap((citation) => [
        ...citation.activeTestimonyIds,
        ...citation.strickenTestimonyIds,
      ]),
    ),
    eventIds: boundedStableUnique(debriefTranscriptEventIds(request, output)),
    sourceSegmentIds: boundedStableUnique(
      citations.flatMap((citation) => citation.hiddenSourceSegmentIds),
    ),
    // Coaching inference IDs are not prior-statement IDs and must not be
    // relabeled merely to fit the generic trace shape.
    priorStatementIds: [],
  });
}

function proposedCitationCount(output: DebriefGeneratorModelOutput): number {
  return allCitationSets(output).reduce(
    (total, citations) =>
      total +
      Object.values(citations).reduce(
        (citationTotal, identifiers) => citationTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function uniqueCount(...identifierLists: readonly string[][]): number {
  return new Set(identifierLists.flat()).size;
}

function proceduralEventIds(request: DebriefGeneratorRequest): string[] {
  return [
    ...request.transcript.map((turn) => turn.sourceEventId),
    ...request.procedure.objections.flatMap((objection) => [
      objection.sourceEventId,
      ...(objection.rulingEventId === null ? [] : [objection.rulingEventId]),
    ]),
    ...request.procedure.settlementOffers.flatMap((offer) => [
      offer.sourceEventId,
      offer.lastEventId,
    ]),
    ...(request.procedure.verdict === null
      ? []
      : [request.procedure.verdict.sourceEventId]),
  ];
}

function traceBinding(request: DebriefGeneratorRequest) {
  const view = request.knowledgeView;
  const { strata } = view;
  const admitted = strata.admittedRecord.record;
  const sourceSegmentIds = [
    ...admitted.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...admitted.evidence.flatMap((evidence) => evidence.sourceSegmentIds),
    ...strata.hiddenAuthoringTruth.facts.flatMap(
      (fact) => fact.sourceSegmentIds,
    ),
  ];
  return {
    callId: request.callId,
    trialId: request.trialId,
    responseId: null,
    actorId: request.actorId,
    actorRole: "debrief" as const,
    inputEventIds: [request.expectedLastEventId],
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    knowledgeScope: {
      knowledgeSchemaVersion: view.schemaVersion,
      knowledgeViewHash: sha256Utf8(JSON.stringify(view)),
      stateVersion: view.stateVersion,
      factCount: uniqueCount(
        admitted.facts.map((fact) => fact.factId),
        strata.unadmittedRecord.facts.map((fact) => fact.factId),
        strata.excludedOrStricken.facts.map((fact) => fact.factId),
        strata.hiddenAuthoringTruth.facts.map((fact) => fact.factId),
      ),
      evidenceCount: uniqueCount(
        admitted.evidence.map((evidence) => evidence.evidenceId),
        strata.unadmittedRecord.evidence.map((evidence) => evidence.evidenceId),
        strata.excludedOrStricken.evidence.map(
          (evidence) => evidence.evidenceId,
        ),
      ),
      testimonyCount: uniqueCount(
        admitted.testimony.map((testimony) => testimony.testimonyId),
        strata.excludedOrStricken.testimony.map(
          (testimony) => testimony.testimonyId,
        ),
      ),
      priorStatementCount: 0,
      sourceSegmentCount: new Set(sourceSegmentIds).size,
      publicRecordEventCount: new Set(proceduralEventIds(request)).size,
      currentExchangeCount: 0,
    },
  };
}

function generationErrorCode(
  error: StructuredCourtroomCallError<DebriefGeneratorValidationReport>,
): DebriefGenerationErrorCode {
  switch (error.category) {
    case "cancelled":
      return "debrief_generation_cancelled";
    case "provider_failed":
      return "debrief_generation_provider_failed";
    case "validation_failed":
      return "debrief_generation_validation_failed";
  }
}

/** Generate one transcript-grounded final coaching artifact with Terra. */
export async function generateDebrief(
  options: GenerateDebriefOptions,
): Promise<GeneratedDebrief> {
  try {
    const generated = await generateStructuredCourtroomCall<
      DebriefGeneratorRequest,
      typeof DebriefGeneratorModelOutputSchema,
      DebriefGeneratorValidationReport
    >({
      provider: options.provider,
      request: options.request,
      signal: options.signal,
      clock: options.clock,
      monotonicNow: options.monotonicNow,
      schema: DebriefGeneratorModelOutputSchema,
      schemaName: DEBRIEF_GENERATOR_STRUCTURED_OUTPUT_NAME,
      schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
      promptVersion: DEBRIEF_GENERATOR_PROMPT_VERSION,
      call: { callClass: "debrief_generator", task: "generate_debrief" },
      model: DEBRIEF_GENERATOR_MODEL,
      parseRequest: (request) => DebriefGeneratorRequestSchema.parse(request),
      buildPrompt: (context) => buildDebriefGeneratorPrompt(context),
      validate: validateDebriefGeneratorOutput,
      traceBinding,
      acceptedCitations: (output) => acceptedCitations(options.request, output),
      proposedCitationCount,
      safeValidationFailureCode: "debrief_generation_validation_failed",
    });
    const validation = validateDebriefGeneratorOutput(
      options.request,
      generated.output,
    );
    if (!validation.accepted) {
      throw new Error("Accepted debrief output failed deterministic replay");
    }
    return generated;
  } catch (error) {
    if (!(error instanceof StructuredCourtroomCallError)) throw error;
    const typed =
      error as StructuredCourtroomCallError<DebriefGeneratorValidationReport>;
    const code = generationErrorCode(typed);
    throw new DebriefGenerationError(
      code,
      code === "debrief_generation_cancelled"
        ? "Debrief generation was cancelled"
        : code === "debrief_generation_provider_failed"
          ? "Debrief provider failed"
          : "Debrief failed deterministic validation",
      typed.trace,
      typed.validationReport,
      { cause: error },
    );
  }
}
