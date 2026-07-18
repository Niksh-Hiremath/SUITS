import { z } from "zod";

import { sha256Utf8 } from "../case-graph/hash";
import { CaseGraphEntityIdSchema } from "../case-graph/schema";
import {
  CourtroomModelCallCitationSetSchema,
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallCitationSet,
} from "../courtroom-ai/model-call-trace";
import {
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WitnessAnswerModelOutputSchema,
  WitnessAnswerRequestSchema,
  type WitnessAnswerModelOutput,
} from "../courtroom-ai/witness-answer";
import { ModelMetadataSchema } from "../trial-engine/schemas";
import { HearingRuntimeViewV1Schema } from "./schema";

export const HEARING_COMMAND_PREPARATION_SCHEMA_VERSION =
  "hearing-command-preparation.v1" as const;
export const HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION =
  "hearing-witness-generation-precommit.v1" as const;

const CompletedHearingCommandPreparationSchema = z
  .object({
    schemaVersion: z.literal(HEARING_COMMAND_PREPARATION_SCHEMA_VERSION),
    status: z.literal("completed"),
    view: HearingRuntimeViewV1Schema,
  })
  .strict();

const ModelRequiredHearingCommandPreparationSchema = z
  .object({
    schemaVersion: z.literal(HEARING_COMMAND_PREPARATION_SCHEMA_VERSION),
    status: z.literal("model_required"),
    request: WitnessAnswerRequestSchema,
  })
  .strict();

/**
 * Secret-only result of preparing one owner-bound hearing command. It exposes
 * either the already-durable redacted view or the exact role-scoped request
 * required by the server model orchestrator. Canonical owner, graph, policy,
 * and raw-state fields are intentionally absent.
 */
export const HearingCommandPreparationSchema = z.discriminatedUnion("status", [
  CompletedHearingCommandPreparationSchema,
  ModelRequiredHearingCommandPreparationSchema,
]);

export type HearingCommandPreparation = z.infer<
  typeof HearingCommandPreparationSchema
>;

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

/** Canonical redacted citations represented directly by a witness candidate. */
export function witnessAnswerOutputCitations(
  outputInput: unknown,
): CourtroomModelCallCitationSet {
  const output = WitnessAnswerModelOutputSchema.parse(outputInput);
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(
      output.segments.flatMap((segment) => segment.factIds),
    ),
    evidenceIds: stableUnique(
      output.segments.flatMap((segment) => segment.evidenceIds),
    ),
    testimonyIds: [],
    eventIds: [],
    sourceSegmentIds: [],
    priorStatementIds: stableUnique(
      output.segments.flatMap((segment) => segment.priorStatementIds),
    ),
  });
}

/** Runtime-neutral digest used by both Next.js and Convex boundary checks. */
export function hashWitnessAnswerModelOutput(outputInput: unknown): string {
  const output = WitnessAnswerModelOutputSchema.parse(outputInput);
  return sha256Utf8(JSON.stringify(output));
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

function aggregateAttemptUsage(
  attempts: z.infer<typeof CourtroomModelCallTraceSchema>["attempts"],
): z.infer<typeof CourtroomModelCallTraceSchema>["usage"] {
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
  left: NonNullable<z.infer<typeof CourtroomModelCallTraceSchema>["usage"]>,
  right: NonNullable<z.infer<typeof CourtroomModelCallTraceSchema>["usage"]>,
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
 * Strict server-to-Convex handoff for a validated witness generation. IDs used
 * to construct the eventual actor, action, testimony, and transcript turn are
 * deliberately derived from canonical state at commit time rather than being
 * accepted as top-level input here.
 */
export const HearingWitnessGenerationPrecommitSchema = z
  .object({
    schemaVersion: z.literal(
      HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
    ),
    trialId: CaseGraphEntityIdSchema,
    callId: CaseGraphEntityIdSchema,
    responseId: CaseGraphEntityIdSchema,
    output: WitnessAnswerModelOutputSchema,
    modelMetadata: ModelMetadataSchema,
    trace: CourtroomModelCallTraceSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    const { modelMetadata, output, trace } = envelope;
    const candidateHash = hashWitnessAnswerModelOutput(output);
    const candidateCitations = witnessAnswerOutputCitations(output);
    const candidateProposedCitationCount = proposedCitationCount(output);
    const acceptedAttempt = trace.attempts.find(
      (attempt) => attempt.attempt === trace.acceptedAttempt,
    );
    const aggregateUsage = aggregateAttemptUsage(trace.attempts);

    for (const [field, envelopeValue, traceValue] of [
      ["trialId", envelope.trialId, trace.trialId],
      ["callId", envelope.callId, trace.callId],
      ["responseId", envelope.responseId, trace.responseId],
    ] as const) {
      if (envelopeValue !== traceValue) {
        addMismatch(
          context,
          ["trace", field],
          `Trace ${field} must match the pre-commit envelope`,
        );
      }
    }

    if (
      trace.status !== "accepted" ||
      trace.callClass !== "role_responder" ||
      trace.task !== "witness_answer" ||
      trace.actorRole !== "witness"
    ) {
      addMismatch(
        context,
        ["trace", "task"],
        "Pre-commit requires an accepted witness role-responder trace",
      );
    }
    if (
      trace.model !== "gpt-5.6-luna" ||
      modelMetadata.model !== "gpt-5.6-luna" ||
      modelMetadata.model !== trace.model
    ) {
      addMismatch(
        context,
        ["modelMetadata", "model"],
        "Witness generation and its trace must use gpt-5.6-luna",
      );
    }
    if (
      output.schemaVersion !== WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION ||
      trace.outputSchemaVersion !== output.schemaVersion ||
      modelMetadata.schemaVersion !== output.schemaVersion
    ) {
      addMismatch(
        context,
        ["modelMetadata", "schemaVersion"],
        "Output, trace, and model metadata schema versions must match",
      );
    }
    if (modelMetadata.promptVersion !== trace.promptVersion) {
      addMismatch(
        context,
        ["modelMetadata", "promptVersion"],
        "Trace and model metadata prompt versions must match",
      );
    }
    if (
      modelMetadata.retryCount !== trace.retryCount ||
      modelMetadata.validationFailureCount !== trace.validationFailureCount
    ) {
      addMismatch(
        context,
        ["modelMetadata", "retryCount"],
        "Trace and model metadata retry accounting must match",
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
        "Trace and model metadata timing and cost must match",
      );
    }
    const usageMatches =
      trace.usage === null
        ? modelMetadata.inputTokens === null &&
          modelMetadata.outputTokens === null
        : aggregateUsage !== null &&
          sameUsage(trace.usage, aggregateUsage) &&
          modelMetadata.inputTokens === trace.usage.inputTokens &&
          modelMetadata.outputTokens === trace.usage.outputTokens;
    if (!usageMatches) {
      addMismatch(
        context,
        ["modelMetadata", "inputTokens"],
        "Accepted usage must be present and match model metadata",
      );
    }
    if (
      acceptedAttempt === undefined ||
      acceptedAttempt.status !== "accepted" ||
      acceptedAttempt.providerRequestId === null ||
      modelMetadata.requestId !== acceptedAttempt.providerRequestId
    ) {
      addMismatch(
        context,
        ["modelMetadata", "requestId"],
        "Model metadata must identify the accepted provider request",
      );
    }
    if (acceptedAttempt?.providerResponseId === null) {
      addMismatch(
        context,
        ["trace", "attempts"],
        "The accepted Responses API attempt must retain its response ID",
      );
    }
    if (
      trace.outputHash !== candidateHash ||
      acceptedAttempt?.outputHash !== candidateHash
    ) {
      addMismatch(
        context,
        ["trace", "outputHash"],
        "Trace output hashes must match the validated witness candidate",
      );
    }
    if (
      !sameCitations(trace.acceptedCitations, candidateCitations) ||
      acceptedAttempt?.proposedCitationCount !==
        candidateProposedCitationCount
    ) {
      addMismatch(
        context,
        ["trace", "acceptedCitations"],
        "Accepted trace citations must match the validated witness candidate",
      );
    }
    if (
      trace.committedActionId !== null ||
      trace.committedEventId !== null
    ) {
      addMismatch(
        context,
        ["trace", "committedActionId"],
        "A pre-commit trace cannot already identify committed records",
      );
    }
  });

export type HearingWitnessGenerationPrecommit = z.infer<
  typeof HearingWitnessGenerationPrecommitSchema
>;
