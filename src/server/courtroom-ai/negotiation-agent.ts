import {
  NEGOTIATION_AGENT_MODEL,
  NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
  NEGOTIATION_AGENT_STRUCTURED_OUTPUT_NAME,
  NegotiationAgentModelOutputSchema,
  type NegotiationAgentModelOutput,
} from "@/domain/courtroom-ai/call-contracts";
import {
  CourtroomModelCallCitationSetSchema,
  type CourtroomModelCallCitationSet,
  type CourtroomModelCallTrace,
} from "@/domain/courtroom-ai/model-call-trace";
import {
  NegotiationAgentRequestSchema,
  validateNegotiationAgentOutput,
  type NegotiationAgentRequest,
  type NegotiationAgentValidationReport,
  type ValidatedNegotiationDecision,
} from "@/domain/courtroom-ai/negotiation-agent";
import { sha256Utf8 } from "@/domain/case-graph";
import type { ModelMetadata } from "@/domain/trial-engine";

import {
  NEGOTIATION_AGENT_PROMPT_VERSION,
  buildNegotiationAgentPrompt,
} from "./negotiation-agent-prompt";
import type { CourtroomModelProvider } from "./provider";
import {
  StructuredCourtroomCallError,
  generateStructuredCourtroomCall,
} from "./structured-call";

export type GenerateNegotiationDecisionOptions = Readonly<{
  provider: CourtroomModelProvider;
  request: NegotiationAgentRequest;
  signal?: AbortSignal;
  clock?: () => Date;
  monotonicNow?: () => number;
}>;

export type GeneratedNegotiationDecision = Readonly<{
  output: NegotiationAgentModelOutput;
  decision: ValidatedNegotiationDecision;
  modelMetadata: ModelMetadata;
  trace: CourtroomModelCallTrace;
}>;

export type NegotiationAgentGenerationErrorCode =
  | "negotiation_decision_cancelled"
  | "negotiation_decision_provider_failed"
  | "negotiation_decision_validation_failed";

export class NegotiationAgentGenerationError extends Error {
  readonly code: NegotiationAgentGenerationErrorCode;
  readonly trace: CourtroomModelCallTrace;
  readonly validationReport: NegotiationAgentValidationReport | null;

  constructor(
    code: NegotiationAgentGenerationErrorCode,
    message: string,
    trace: CourtroomModelCallTrace,
    validationReport: NegotiationAgentValidationReport | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NegotiationAgentGenerationError";
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
  output: NegotiationAgentModelOutput,
): CourtroomModelCallCitationSet {
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(output.citations.factIds),
    evidenceIds: stableUnique(output.citations.evidenceIds),
    testimonyIds: stableUnique(output.citations.testimonyIds),
    eventIds: [],
    sourceSegmentIds: stableUnique(output.citations.sourceSegmentIds),
    priorStatementIds: [],
  });
}

function proposedCitationCount(output: NegotiationAgentModelOutput): number {
  return Object.values(output.citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function uniqueScopeCount(...identifierLists: readonly string[][]): number {
  return new Set(identifierLists.flat()).size;
}

function traceBinding(request: NegotiationAgentRequest) {
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
        view.currentExchange?.factIds ?? [],
      ),
      evidenceCount: uniqueScopeCount(
        view.counsel.evidence.map((evidence) => evidence.evidenceId),
        view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
        view.currentExchange?.evidenceIds ?? [],
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
  error: StructuredCourtroomCallError<NegotiationAgentValidationReport>,
): NegotiationAgentGenerationErrorCode {
  switch (error.category) {
    case "cancelled":
      return "negotiation_decision_cancelled";
    case "provider_failed":
      return "negotiation_decision_provider_failed";
    case "validation_failed":
      return "negotiation_decision_validation_failed";
  }
}

/** Generate one private, strictly scoped settlement recommendation with Luna. */
export async function generateNegotiationDecision(
  options: GenerateNegotiationDecisionOptions,
): Promise<GeneratedNegotiationDecision> {
  try {
    const generated = await generateStructuredCourtroomCall<
      NegotiationAgentRequest,
      typeof NegotiationAgentModelOutputSchema,
      NegotiationAgentValidationReport
    >({
      provider: options.provider,
      request: options.request,
      signal: options.signal,
      clock: options.clock,
      monotonicNow: options.monotonicNow,
      schema: NegotiationAgentModelOutputSchema,
      schemaName: NEGOTIATION_AGENT_STRUCTURED_OUTPUT_NAME,
      schemaVersion: NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
      promptVersion: NEGOTIATION_AGENT_PROMPT_VERSION,
      call: {
        callClass: "negotiation_agent",
        task: "evaluate_settlement",
      },
      model: NEGOTIATION_AGENT_MODEL,
      parseRequest: (request) => NegotiationAgentRequestSchema.parse(request),
      buildPrompt: (context) => buildNegotiationAgentPrompt(context),
      validate: validateNegotiationAgentOutput,
      traceBinding,
      acceptedCitations,
      proposedCitationCount,
      safeValidationFailureCode: "negotiation_decision_validation_failed",
    });
    const validation = validateNegotiationAgentOutput(
      options.request,
      generated.output,
    );
    if (!validation.accepted) {
      throw new Error("Accepted negotiation output failed deterministic replay");
    }
    return {
      ...generated,
      decision: validation.decision,
    };
  } catch (error) {
    if (!(error instanceof StructuredCourtroomCallError)) throw error;
    const typed =
      error as StructuredCourtroomCallError<NegotiationAgentValidationReport>;
    const code = generationErrorCode(typed);
    throw new NegotiationAgentGenerationError(
      code,
      code === "negotiation_decision_cancelled"
        ? "Negotiation decision generation was cancelled"
        : code === "negotiation_decision_provider_failed"
          ? "Negotiation decision provider failed"
          : "Negotiation decision failed deterministic validation",
      typed.trace,
      typed.validationReport,
      { cause: error },
    );
  }
}
