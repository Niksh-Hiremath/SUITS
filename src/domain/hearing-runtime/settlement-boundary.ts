import { z } from "zod";

import { sha256Utf8 } from "../case-graph/hash";
import { CaseGraphEntityIdSchema } from "../case-graph/schema";
import {
  NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
  NegotiationAgentModelOutputSchema,
} from "../courtroom-ai/call-contracts";
import {
  CourtroomModelCallCitationSetSchema,
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallCitationSet,
} from "../courtroom-ai/model-call-trace";
import { KNOWLEDGE_VIEW_SCHEMA_VERSION_V2 } from "../knowledge";
import { ModelMetadataSchema } from "../trial-engine/schemas";

export const HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION =
  "hearing-negotiation-precommit.v1" as const;
export const HEARING_NEGOTIATION_AGENT_PROMPT_VERSION =
  "negotiation-agent.prompt.v1" as const;
export const HEARING_NEGOTIATION_PROVIDER_PROTOCOL_VERSION =
  "courtroom-model-provider.v1" as const;

type CourtroomModelCallTrace = z.infer<typeof CourtroomModelCallTraceSchema>;
type CourtroomModelTokenUsage = NonNullable<
  CourtroomModelCallTrace["usage"]
>;

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

/** Runtime-neutral digest shared by the server generator and commit boundary. */
export function hashNegotiationAgentModelOutput(outputInput: unknown): string {
  const output = NegotiationAgentModelOutputSchema.parse(outputInput);
  return sha256Utf8(JSON.stringify(output));
}

/**
 * Project the model's richer citation set into the redacted trace contract.
 * The candidate hash still binds categories that the trace does not expose.
 */
export function negotiationAgentOutputCitations(
  outputInput: unknown,
): CourtroomModelCallCitationSet {
  const output = NegotiationAgentModelOutputSchema.parse(outputInput);
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(output.citations.factIds),
    evidenceIds: stableUnique(output.citations.evidenceIds),
    testimonyIds: stableUnique(output.citations.testimonyIds),
    eventIds: [],
    sourceSegmentIds: stableUnique(output.citations.sourceSegmentIds),
    priorStatementIds: [],
  });
}

export function negotiationAgentProposedCitationCount(
  outputInput: unknown,
): number {
  const output = NegotiationAgentModelOutputSchema.parse(outputInput);
  return Object.values(output.citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function sameIdentifierList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identifier, index) => identifier === right[index])
  );
}

function sameCitations(
  left: CourtroomModelCallCitationSet,
  right: CourtroomModelCallCitationSet,
): boolean {
  return (
    sameIdentifierList(left.factIds, right.factIds) &&
    sameIdentifierList(left.evidenceIds, right.evidenceIds) &&
    sameIdentifierList(left.testimonyIds, right.testimonyIds) &&
    sameIdentifierList(left.eventIds, right.eventIds) &&
    sameIdentifierList(left.sourceSegmentIds, right.sourceSegmentIds) &&
    sameIdentifierList(left.priorStatementIds, right.priorStatementIds)
  );
}

function aggregateAttemptUsage(
  attempts: CourtroomModelCallTrace["attempts"],
): CourtroomModelTokenUsage | null {
  if (attempts.some((attempt) => attempt.usage === null)) return null;
  return attempts.reduce<CourtroomModelTokenUsage>(
    (total, attempt) => {
      const usage = attempt.usage;
      if (usage === null) return total;
      return {
        inputTokens: total.inputTokens + usage.inputTokens,
        outputTokens: total.outputTokens + usage.outputTokens,
        totalTokens: total.totalTokens + usage.totalTokens,
        cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
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
  left: CourtroomModelTokenUsage,
  right: CourtroomModelTokenUsage,
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
 * Strict secret-side handoff for one accepted private NegotiationAgent result.
 * Canonical actor, party, offer, action, and event identities remain derived at
 * commit time; this envelope binds only the prepared decision and exact head.
 */
export const HearingNegotiationPrecommitSchema = z
  .object({
    schemaVersion: z.literal(HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION),
    trialId: CaseGraphEntityIdSchema,
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    output: NegotiationAgentModelOutputSchema,
    modelMetadata: ModelMetadataSchema,
    trace: CourtroomModelCallTraceSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    const { modelMetadata, output, trace } = envelope;
    const outputHash = hashNegotiationAgentModelOutput(output);
    const outputCharacterCount = JSON.stringify(output).length;
    const citations = negotiationAgentOutputCitations(output);
    const proposedCitationCount =
      negotiationAgentProposedCitationCount(output);
    const acceptedAttempt = trace.attempts.find(
      (attempt) => attempt.attempt === trace.acceptedAttempt,
    );
    const aggregateUsage = aggregateAttemptUsage(trace.attempts);

    for (const [field, envelopeValue, traceValue] of [
      ["trialId", envelope.trialId, trace.trialId],
      ["callId", envelope.callId, trace.callId],
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
          `Trace ${field} must match the negotiation precommit envelope`,
        );
      }
    }

    if (
      trace.status !== "accepted" ||
      trace.callClass !== "negotiation_agent" ||
      trace.task !== "evaluate_settlement" ||
      trace.actorRole !== "counsel" ||
      trace.actorId === null ||
      trace.responseId !== null ||
      trace.safeFailureCode !== null
    ) {
      addMismatch(
        context,
        ["trace", "task"],
        "Precommit requires an accepted private negotiation-agent counsel trace",
      );
    }
    if (
      trace.inputEventIds.length !== 1 ||
      trace.inputEventIds[0] !== envelope.expectedLastEventId
    ) {
      addMismatch(
        context,
        ["trace", "inputEventIds"],
        "Negotiation generation must bind one exact canonical event head",
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
        "Negotiation generation must audit a V2 KnowledgeView at the bound head",
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
        "Negotiation generation and its trace must use gpt-5.6-luna",
      );
    }
    if (
      output.schemaVersion !== NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION ||
      trace.outputSchemaVersion !== NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION ||
      modelMetadata.schemaVersion !== NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION
    ) {
      addMismatch(
        context,
        ["modelMetadata", "schemaVersion"],
        "Negotiation output, trace, and metadata schema versions must match",
      );
    }
    if (
      trace.promptVersion !== HEARING_NEGOTIATION_AGENT_PROMPT_VERSION ||
      modelMetadata.promptVersion !== HEARING_NEGOTIATION_AGENT_PROMPT_VERSION
    ) {
      addMismatch(
        context,
        ["modelMetadata", "promptVersion"],
        "Negotiation trace and metadata must use the exact prompt version",
      );
    }
    if (
      trace.providerProtocolVersion !==
      HEARING_NEGOTIATION_PROVIDER_PROTOCOL_VERSION
    ) {
      addMismatch(
        context,
        ["trace", "providerProtocolVersion"],
        "Negotiation trace must use the supported provider protocol",
      );
    }
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
        "Negotiation generation permits one initial attempt and one semantic repair",
      );
    }
    if (
      trace.attempts.some(
        (attempt) =>
          attempt.providerRequestId === null ||
          attempt.providerResponseId === null ||
          attempt.usage === null,
      )
    ) {
      addMismatch(
        context,
        ["trace", "attempts"],
        "Every completed negotiation attempt must retain provider IDs and usage",
      );
    }
    if (
      acceptedAttempt?.validationIssueCodes.length !== 0 ||
      acceptedAttempt?.safeErrorCode !== null
    ) {
      addMismatch(
        context,
        ["trace", "acceptedAttempt"],
        "The accepted negotiation attempt cannot retain failure diagnostics",
      );
    }
    if (
      modelMetadata.retryCount !== trace.retryCount ||
      modelMetadata.validationFailureCount !== trace.validationFailureCount
    ) {
      addMismatch(
        context,
        ["modelMetadata", "retryCount"],
        "Negotiation trace and metadata retry accounting must match",
      );
    }
    if (
      trace.latencyMs === null ||
      trace.estimatedCostUsd === null ||
      modelMetadata.latencyMs !== trace.latencyMs ||
      modelMetadata.estimatedCostUsd !== trace.estimatedCostUsd
    ) {
      addMismatch(
        context,
        ["modelMetadata", "latencyMs"],
        "Negotiation trace and metadata timing and cost must match",
      );
    }
    if (
      trace.usage === null ||
      aggregateUsage === null ||
      !sameUsage(trace.usage, aggregateUsage) ||
      modelMetadata.inputTokens !== trace.usage.inputTokens ||
      modelMetadata.outputTokens !== trace.usage.outputTokens
    ) {
      addMismatch(
        context,
        ["modelMetadata", "inputTokens"],
        "Negotiation usage must match every attempt, the trace, and metadata",
      );
    }
    if (
      acceptedAttempt === undefined ||
      acceptedAttempt.providerRequestId === null ||
      acceptedAttempt.providerResponseId === null ||
      modelMetadata.requestId !== acceptedAttempt.providerRequestId
    ) {
      addMismatch(
        context,
        ["modelMetadata", "requestId"],
        "Negotiation metadata must identify the accepted provider request and response",
      );
    }
    if (
      trace.outputHash !== outputHash ||
      acceptedAttempt?.outputHash !== outputHash ||
      trace.outputCharacterCount !== outputCharacterCount
    ) {
      addMismatch(
        context,
        ["trace", "outputHash"],
        "Negotiation trace output identity must match the validated candidate",
      );
    }
    if (
      !sameCitations(trace.acceptedCitations, citations) ||
      acceptedAttempt?.proposedCitationCount !== proposedCitationCount
    ) {
      addMismatch(
        context,
        ["trace", "acceptedCitations"],
        "Negotiation citations must exactly match the validated candidate",
      );
    }
    if (trace.committedActionId !== null || trace.committedEventId !== null) {
      addMismatch(
        context,
        ["trace", "committedActionId"],
        "A negotiation precommit trace cannot identify committed records",
      );
    }
  });

export type HearingNegotiationPrecommit = z.infer<
  typeof HearingNegotiationPrecommitSchema
>;
