import { z } from "zod";

import { CaseGraphEntityIdSchema, sha256Utf8 } from "../case-graph";
import {
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  ObjectionRulingModelOutputSchema,
  validateObjectionRulingSemantics,
  type ObjectionRulingModelOutput,
} from "../courtroom-ai/call-contracts";
import {
  CourtroomModelCallCitationSetSchema,
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallCitationSet,
} from "../courtroom-ai/model-call-trace";
import { KNOWLEDGE_VIEW_SCHEMA_VERSION_V2 } from "../knowledge";
import { ModelMetadataSchema } from "../trial-engine/schemas";

export const HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION =
  "hearing-objection-ruling-precommit.v1" as const;
export const HEARING_OBJECTION_RULING_PROMPT_VERSION =
  "objection-resolver.ruling.prompt.v1" as const;
export const HEARING_OBJECTION_RULING_PROVIDER_PROTOCOL_VERSION =
  "courtroom-model-provider.v1" as const;

export const HearingObjectionQuestionEventBindingSchema = z
  .object({
    turnId: CaseGraphEntityIdSchema,
    sourceEventId: CaseGraphEntityIdSchema,
  })
  .strict();

export type HearingObjectionQuestionEventBinding = z.infer<
  typeof HearingObjectionQuestionEventBindingSchema
>;

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function sameOrderedIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identifier, index) => identifier === right[index])
  );
}

function sameIdentifierSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identifier) => right.includes(identifier))
  );
}

function sameCitations(
  left: CourtroomModelCallCitationSet,
  right: CourtroomModelCallCitationSet,
): boolean {
  return (
    sameIdentifierSet(left.factIds, right.factIds) &&
    sameIdentifierSet(left.evidenceIds, right.evidenceIds) &&
    sameIdentifierSet(left.testimonyIds, right.testimonyIds) &&
    sameIdentifierSet(left.eventIds, right.eventIds) &&
    sameIdentifierSet(left.sourceSegmentIds, right.sourceSegmentIds) &&
    sameIdentifierSet(left.priorStatementIds, right.priorStatementIds)
  );
}

function hasOnlyBoundQuestionTurn(
  output: ObjectionRulingModelOutput,
  binding: HearingObjectionQuestionEventBinding,
): boolean {
  return (
    output.citations.transcriptTurnIds.length === 1 &&
    output.citations.transcriptTurnIds[0] === binding.turnId
  );
}

function hasUnsupportedCitations(output: ObjectionRulingModelOutput): boolean {
  return (
    output.citations.priorStatementIds.length > 0 ||
    output.citations.issueIds.length > 0 ||
    output.citations.instructionIds.length > 0 ||
    output.citations.ruleIds.length > 0 ||
    output.citations.settlementOfferIds.length > 0
  );
}

/** Canonical generic-trace citations for one exact objection question. */
export function objectionRulingOutputCitations(
  outputInput: unknown,
  bindingInput: HearingObjectionQuestionEventBinding,
): CourtroomModelCallCitationSet {
  const output = ObjectionRulingModelOutputSchema.parse(outputInput);
  const binding = HearingObjectionQuestionEventBindingSchema.parse(bindingInput);
  if (!hasOnlyBoundQuestionTurn(output, binding)) {
    throw new Error("The ruling must cite its exact bound question turn once");
  }
  if (hasUnsupportedCitations(output)) {
    throw new Error("The ruling contains a citation class unavailable to the resolver");
  }
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(output.citations.factIds),
    evidenceIds: stableUnique(output.citations.evidenceIds),
    testimonyIds: stableUnique(output.citations.testimonyIds),
    eventIds: [binding.sourceEventId],
    sourceSegmentIds: stableUnique(output.citations.sourceSegmentIds),
    priorStatementIds: [],
  });
}

/** Runtime-neutral ruling digest shared by the server and durable boundary. */
export function hashObjectionRulingModelOutput(outputInput: unknown): string {
  const output = ObjectionRulingModelOutputSchema.parse(outputInput);
  return sha256Utf8(JSON.stringify(output));
}

function proposedCitationCount(output: ObjectionRulingModelOutput): number {
  return Object.values(output.citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

type CourtroomModelCallTrace = z.infer<typeof CourtroomModelCallTraceSchema>;

function aggregateAttemptUsage(
  attempts: CourtroomModelCallTrace["attempts"],
): CourtroomModelCallTrace["usage"] {
  if (attempts.some((attempt) => attempt.usage === null)) return null;
  return attempts.reduce(
    (total, attempt) => {
      const usage = attempt.usage;
      if (usage === null) return total;
      return {
        inputTokens: total.inputTokens + usage.inputTokens,
        outputTokens: total.outputTokens + usage.outputTokens,
        totalTokens: total.totalTokens + usage.totalTokens,
        cachedInputTokens:
          total.cachedInputTokens + usage.cachedInputTokens,
        cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
        reasoningTokens: total.reasoningTokens + usage.reasoningTokens,
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
}

function sameUsage(
  left: NonNullable<CourtroomModelCallTrace["usage"]>,
  right: NonNullable<CourtroomModelCallTrace["usage"]>,
): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.totalTokens === right.totalTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens &&
    left.reasoningTokens === right.reasoningTokens
  );
}

function addMismatch(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

/**
 * Secret-only handoff for one validated ruling on an interrupted response.
 * Canonical actors, objection state, interruption state, actions, and newly
 * committed event IDs are reconstructed and revalidated at commit time.
 */
export const HearingObjectionRulingPrecommitSchema = z
  .object({
    schemaVersion: z.literal(
      HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
    ),
    trialId: CaseGraphEntityIdSchema,
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    objectionEventId: CaseGraphEntityIdSchema,
    responseId: CaseGraphEntityIdSchema,
    questionEventBinding: HearingObjectionQuestionEventBindingSchema,
    output: ObjectionRulingModelOutputSchema,
    modelMetadata: ModelMetadataSchema,
    trace: CourtroomModelCallTraceSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    const { modelMetadata, output, trace } = envelope;
    const canonicalInputEventIds = stableUnique([
      envelope.questionEventBinding.sourceEventId,
      envelope.objectionEventId,
      envelope.expectedLastEventId,
    ]);
    if (canonicalInputEventIds.length !== 3) {
      addMismatch(
        context,
        ["expectedLastEventId"],
        "Question, objection, and interruption-head events must be distinct",
      );
    }

    for (const [field, envelopeValue, traceValue] of [
      ["trialId", envelope.trialId, trace.trialId],
      ["callId", envelope.callId, trace.callId],
      ["responseId", envelope.responseId, trace.responseId],
      [
        "expectedStateVersion",
        envelope.expectedStateVersion,
        trace.expectedStateVersion,
      ],
      [
        "expectedLastEventId",
        envelope.expectedLastEventId,
        trace.expectedLastEventId,
      ],
    ] as const) {
      if (envelopeValue !== traceValue) {
        addMismatch(
          context,
          ["trace", field],
          `Trace ${field} must match the objection pre-commit envelope`,
        );
      }
    }

    if (!sameOrderedIds(trace.inputEventIds, canonicalInputEventIds)) {
      addMismatch(
        context,
        ["trace", "inputEventIds"],
        "The resolver trace must bind exactly the question, objection, and interruption-head events",
      );
    }
    if (
      trace.status !== "accepted" ||
      trace.callClass !== "objection_resolver" ||
      trace.task !== "resolve_objection" ||
      trace.actorRole !== "judge" ||
      trace.actorId === null ||
      trace.safeFailureCode !== null
    ) {
      addMismatch(
        context,
        ["trace", "task"],
        "Pre-commit requires one accepted judge objection-resolver trace",
      );
    }
    if (
      trace.knowledgeScope.knowledgeSchemaVersion !==
        KNOWLEDGE_VIEW_SCHEMA_VERSION_V2 ||
      trace.knowledgeScope.stateVersion !== envelope.expectedStateVersion
    ) {
      addMismatch(
        context,
        ["trace", "knowledgeScope"],
        "The resolver must audit a V2 judge KnowledgeView at the exact trial head",
      );
    }
    if (
      trace.model !== "gpt-5.6-luna" ||
      modelMetadata.model !== "gpt-5.6-luna"
    ) {
      addMismatch(
        context,
        ["modelMetadata", "model"],
        "Objection rulings must use gpt-5.6-luna",
      );
    }
    if (
      trace.promptVersion !== HEARING_OBJECTION_RULING_PROMPT_VERSION ||
      modelMetadata.promptVersion !== HEARING_OBJECTION_RULING_PROMPT_VERSION
    ) {
      addMismatch(
        context,
        ["modelMetadata", "promptVersion"],
        "The ruling trace and metadata must use the exact resolver prompt version",
      );
    }
    if (
      trace.outputSchemaVersion !== OBJECTION_RULING_OUTPUT_SCHEMA_VERSION ||
      modelMetadata.schemaVersion !== OBJECTION_RULING_OUTPUT_SCHEMA_VERSION
    ) {
      addMismatch(
        context,
        ["modelMetadata", "schemaVersion"],
        "The ruling output, trace, and metadata schema versions must match",
      );
    }
    if (
      trace.providerProtocolVersion !==
      HEARING_OBJECTION_RULING_PROVIDER_PROTOCOL_VERSION
    ) {
      addMismatch(
        context,
        ["trace", "providerProtocolVersion"],
        "Objection ruling trace must use the supported provider protocol",
      );
    }
    if (
      modelMetadata.retryCount !== trace.retryCount ||
      modelMetadata.validationFailureCount !== trace.validationFailureCount
    ) {
      addMismatch(
        context,
        ["modelMetadata", "retryCount"],
        "The ruling trace and metadata retry accounting must match",
      );
    }
    if (
      trace.latencyMs === null ||
      modelMetadata.latencyMs !== trace.latencyMs ||
      modelMetadata.estimatedCostUsd !== trace.estimatedCostUsd
    ) {
      addMismatch(
        context,
        ["modelMetadata", "latencyMs"],
        "The ruling trace and metadata timing and cost must match",
      );
    }

    const aggregateUsage = aggregateAttemptUsage(trace.attempts);
    const usageMatches =
      trace.usage === null
        ? aggregateUsage === null &&
          modelMetadata.inputTokens === null &&
          modelMetadata.outputTokens === null
        : aggregateUsage !== null &&
          sameUsage(trace.usage, aggregateUsage) &&
          modelMetadata.inputTokens === trace.usage.inputTokens &&
          modelMetadata.outputTokens === trace.usage.outputTokens;
    if (!usageMatches) {
      addMismatch(
        context,
        ["modelMetadata", "inputTokens"],
        "Accepted resolver usage must match all attempts and model metadata",
      );
    }

    const acceptedAttempt = trace.attempts.find(
      (attempt) => attempt.attempt === trace.acceptedAttempt,
    );
    if (
      trace.attempts.length < 1 ||
      trace.attempts.length > 2 ||
      trace.acceptedAttempt !== trace.attempts.length ||
      acceptedAttempt?.status !== "accepted" ||
      trace.attempts
        .slice(0, -1)
        .some((attempt) => attempt.status !== "validation_failed")
    ) {
      addMismatch(
        context,
        ["trace", "attempts"],
        "Objection ruling generation permits one initial attempt and one validation repair",
      );
    }
    if (
      acceptedAttempt === undefined ||
      acceptedAttempt.status !== "accepted" ||
      acceptedAttempt.providerRequestId === null ||
      acceptedAttempt.providerResponseId === null ||
      acceptedAttempt.safeErrorCode !== null ||
      acceptedAttempt.validationIssueCodes.length !== 0 ||
      modelMetadata.requestId !== acceptedAttempt.providerRequestId
    ) {
      addMismatch(
        context,
        ["modelMetadata", "requestId"],
        "The ruling metadata must retain both accepted provider identities",
      );
    }

    const outputHash = hashObjectionRulingModelOutput(output);
    if (
      trace.outputHash !== outputHash ||
      acceptedAttempt?.outputHash !== outputHash ||
      trace.outputCharacterCount !== JSON.stringify(output).length
    ) {
      addMismatch(
        context,
        ["trace", "outputHash"],
        "The resolver trace output identity must match the validated ruling",
      );
    }

    let citations: CourtroomModelCallCitationSet | null = null;
    try {
      citations = objectionRulingOutputCitations(
        output,
        envelope.questionEventBinding,
      );
    } catch {
      addMismatch(
        context,
        ["questionEventBinding"],
        "The ruling must cite only its exact bound question turn",
      );
    }
    if (
      citations === null ||
      !sameCitations(trace.acceptedCitations, citations) ||
      acceptedAttempt?.proposedCitationCount !== proposedCitationCount(output)
    ) {
      addMismatch(
        context,
        ["trace", "acceptedCitations"],
        "The resolver trace citations must match the validated ruling and question event binding",
      );
    }

    for (const issue of validateObjectionRulingSemantics(output, {
      interruptedResponse: true,
    })) {
      addMismatch(
        context,
        ["output", ...issue.path],
        "The ruling violates the interrupted-response semantic contract",
      );
    }
    if (trace.committedActionId !== null || trace.committedEventId !== null) {
      addMismatch(
        context,
        ["trace", "committedActionId"],
        "An objection pre-commit trace cannot identify newly committed records",
      );
    }
  });

export type HearingObjectionRulingPrecommit = z.infer<
  typeof HearingObjectionRulingPrecommitSchema
>;
