import {
  CourtroomModelCallCitationSetSchema,
  OPPONENT_PLANNER_MODEL,
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  OPPONENT_PLANNER_STRUCTURED_OUTPUT_NAME,
  OpponentPlannerModelOutputSchema,
  OpponentPlannerRequestSchema,
  validateOpponentPlannerOutput,
  type CourtroomModelCallCitationSet,
  type OpponentPlannerModelOutput,
  type OpponentPlannerRequest,
  type OpponentPlannerValidationReport,
} from "@/domain/courtroom-ai";
import { sha256Utf8 } from "@/domain/case-graph";
import type { ModelMetadata } from "@/domain/trial-engine";

import {
  OPPONENT_PLANNER_PROMPT_VERSION,
  buildOpponentPlannerPrompt,
} from "./opponent-planner-prompt";
import type { CourtroomModelProvider } from "./provider";
import {
  StructuredCourtroomCallError,
  generateStructuredCourtroomCall,
} from "./structured-call";
import type { CourtroomModelCallTrace } from "@/domain/courtroom-ai";

export type GenerateOpponentPlanOptions = Readonly<{
  provider: CourtroomModelProvider;
  request: OpponentPlannerRequest;
  signal?: AbortSignal;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type GeneratedOpponentPlan = Readonly<{
  output: OpponentPlannerModelOutput;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type OpponentPlannerGenerationErrorCode =
  | "opponent_plan_cancelled"
  | "opponent_plan_provider_failed"
  | "opponent_plan_validation_failed";

export class OpponentPlannerGenerationError extends Error {
  readonly code: OpponentPlannerGenerationErrorCode;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: OpponentPlannerValidationReport | null;

  constructor(
    code: OpponentPlannerGenerationErrorCode,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: OpponentPlannerValidationReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OpponentPlannerGenerationError";
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
  output: OpponentPlannerModelOutput,
): CourtroomModelCallCitationSet {
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(
      output.proposedMoves.flatMap((move) => move.citations.factIds),
    ),
    evidenceIds: stableUnique(
      output.proposedMoves.flatMap((move) => move.citations.evidenceIds),
    ),
    testimonyIds: stableUnique(
      output.proposedMoves.flatMap((move) => move.citations.testimonyIds),
    ),
    eventIds: [],
    sourceSegmentIds: stableUnique(
      output.proposedMoves.flatMap(
        (move) => move.citations.sourceSegmentIds,
      ),
    ),
    priorStatementIds: stableUnique(
      output.proposedMoves.flatMap(
        (move) => move.citations.priorStatementIds,
      ),
    ),
  });
}

function proposedCitationCount(output: OpponentPlannerModelOutput): number {
  return output.proposedMoves.reduce(
    (total, move) =>
      total +
      Object.values(move.citations).reduce(
        (moveTotal, identifiers) => moveTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function uniqueScopeCount(...identifierLists: readonly string[][]): number {
  return new Set(identifierLists.flat()).size;
}

function traceBinding(request: OpponentPlannerRequest) {
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

function plannerErrorCode(
  error: StructuredCourtroomCallError<OpponentPlannerValidationReport>,
): OpponentPlannerGenerationErrorCode {
  switch (error.category) {
    case "cancelled":
      return "opponent_plan_cancelled";
    case "provider_failed":
      return "opponent_plan_provider_failed";
    case "validation_failed":
      return "opponent_plan_validation_failed";
  }
}

/** Generate one private, strictly scoped opposing-counsel strategy proposal. */
export async function generateOpponentPlan(
  options: GenerateOpponentPlanOptions,
): Promise<GeneratedOpponentPlan> {
  try {
    return await generateStructuredCourtroomCall<
      OpponentPlannerRequest,
      typeof OpponentPlannerModelOutputSchema,
      OpponentPlannerValidationReport
    >({
      provider: options.provider,
      request: options.request,
      signal: options.signal,
      clock: options.clock,
      monotonicNow: options.monotonicNow,
      schema: OpponentPlannerModelOutputSchema,
      schemaName: OPPONENT_PLANNER_STRUCTURED_OUTPUT_NAME,
      schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
      promptVersion: OPPONENT_PLANNER_PROMPT_VERSION,
      call: { callClass: "opponent_planner", task: "plan_opponent" },
      model: OPPONENT_PLANNER_MODEL,
      parseRequest: (request) => OpponentPlannerRequestSchema.parse(request),
      buildPrompt: (context) => buildOpponentPlannerPrompt(context),
      validate: validateOpponentPlannerOutput,
      traceBinding,
      acceptedCitations,
      proposedCitationCount,
      safeValidationFailureCode: "opponent_plan_validation_failed",
    });
  } catch (error) {
    if (
      !(error instanceof StructuredCourtroomCallError) ||
      !(
        error.validationReport === null ||
        typeof error.validationReport === "object"
      )
    ) {
      throw error;
    }
    const typed = error as StructuredCourtroomCallError<OpponentPlannerValidationReport>;
    const code = plannerErrorCode(typed);
    throw new OpponentPlannerGenerationError(
      code,
      code === "opponent_plan_cancelled"
        ? "Opponent planning was cancelled"
        : code === "opponent_plan_provider_failed"
          ? "Opponent planning provider failed"
          : "Opponent plan failed deterministic validation",
      typed.trace,
      typed.validationReport,
      { cause: error },
    );
  }
}
