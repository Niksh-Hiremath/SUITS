import { z } from "zod";

import { sha256Utf8 } from "../case-graph/hash";
import { CaseGraphEntityIdSchema } from "../case-graph/schema";
import {
  CourtroomModelCallCitationSetSchema,
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallCitationSet,
} from "../courtroom-ai/model-call-trace";
import {
  COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  CounselRoleResponseModelOutputSchema,
  OpponentPlannerModelOutputSchema,
  type CounselRoleResponseModelOutput,
  type OpponentPlannerModelOutput,
} from "../courtroom-ai/call-contracts";
import { CounselResponseRequestSchema } from "../courtroom-ai/counsel-response";
import {
  OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION,
  OpponentPlannerRequestSchema,
  type OpponentPlannerRequest,
} from "../courtroom-ai/opponent-planner";
import {
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WitnessAnswerModelOutputSchema,
  WitnessAnswerRequestSchema,
  type WitnessAnswerRequest,
  type WitnessAnswerModelOutput,
} from "../courtroom-ai/witness-answer";
import { OPPONENT_COUNSEL_PUBLIC_KNOWLEDGE_VIEW_SCHEMA_VERSION } from "../knowledge";
import { ModelMetadataSchema } from "../trial-engine/schemas";
import { HearingRuntimeViewV1Schema } from "./schema";

export const HEARING_COMMAND_PREPARATION_SCHEMA_VERSION =
  "hearing-command-preparation.v1" as const;
export const HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION =
  "hearing-witness-generation-precommit.v1" as const;
export const HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION =
  "hearing-opponent-plan-precommit.v1" as const;
export const HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION =
  "hearing-counsel-response-precommit.v1" as const;
const HEARING_OPPONENT_PLANNER_PROMPT_VERSION =
  "opponent-planner.prompt.v1" as const;
const HEARING_COUNSEL_RESPONSE_PROMPT_VERSION =
  "role-responder.counsel.prompt.v1" as const;

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
    request: z.union([
      WitnessAnswerRequestSchema,
      OpponentPlannerRequestSchema,
    ]),
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

type HearingModelRequiredPreparation = Extract<
  HearingCommandPreparation,
  { status: "model_required" }
>;

export type HearingWitnessModelRequiredPreparation = Omit<
  HearingModelRequiredPreparation,
  "request"
> &
  Readonly<{ request: WitnessAnswerRequest }>;

export type HearingOpponentPlanModelRequiredPreparation = Omit<
  HearingModelRequiredPreparation,
  "request"
> &
  Readonly<{ request: OpponentPlannerRequest }>;

/** Narrow a model-required preparation before entering witness-only code. */
export function isHearingWitnessModelRequiredPreparation(
  preparation: HearingCommandPreparation,
): preparation is HearingWitnessModelRequiredPreparation {
  return (
    preparation.status === "model_required" &&
    preparation.request.schemaVersion ===
      WITNESS_ANSWER_REQUEST_SCHEMA_VERSION
  );
}

/** Narrow a model-required preparation before entering planner-only code. */
export function isHearingOpponentPlanModelRequiredPreparation(
  preparation: HearingCommandPreparation,
): preparation is HearingOpponentPlanModelRequiredPreparation {
  return (
    preparation.status === "model_required" &&
    preparation.request.schemaVersion ===
      OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION
  );
}

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

/** Canonical durable-audit citations represented by an opponent plan. */
export function opponentPlannerOutputCitations(
  outputInput: unknown,
): CourtroomModelCallCitationSet {
  const output = OpponentPlannerModelOutputSchema.parse(outputInput);
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

/** Runtime-neutral planner digest shared by Next.js and Convex checks. */
export function hashOpponentPlannerModelOutput(outputInput: unknown): string {
  const output = OpponentPlannerModelOutputSchema.parse(outputInput);
  return sha256Utf8(JSON.stringify(output));
}

/** Canonical public-record citations represented by a counsel response. */
export function counselResponseOutputCitations(
  outputInput: unknown,
): CourtroomModelCallCitationSet {
  const output = CounselRoleResponseModelOutputSchema.parse(outputInput);
  return CourtroomModelCallCitationSetSchema.parse({
    factIds: stableUnique(
      output.speechSegments.flatMap(
        (segment) => segment.citations.factIds,
      ),
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

/** Runtime-neutral counsel-response digest shared by server and Convex. */
export function hashCounselResponseModelOutput(outputInput: unknown): string {
  const output = CounselRoleResponseModelOutputSchema.parse(outputInput);
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

function opponentPlannerProposedCitationCount(
  output: OpponentPlannerModelOutput,
): number {
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

function opponentPlannerUnauditableCitationCount(
  output: OpponentPlannerModelOutput,
): number {
  return output.proposedMoves.reduce(
    (total, move) =>
      total +
      move.citations.transcriptTurnIds.length +
      move.citations.issueIds.length +
      move.citations.instructionIds.length +
      move.citations.ruleIds.length +
      move.citations.settlementOfferIds.length,
    0,
  );
}

function counselResponseProposedCitationCount(
  output: CounselRoleResponseModelOutput,
): number {
  return output.speechSegments.reduce(
    (total, segment) =>
      total +
      Object.values(segment.citations).reduce(
        (segmentTotal, identifiers) =>
          segmentTotal + identifiers.length,
        0,
      ),
    0,
  );
}

function counselResponseUnsupportedCitationCount(
  output: CounselRoleResponseModelOutput,
): number {
  return output.speechSegments.reduce(
    (total, segment) =>
      total +
      segment.citations.transcriptTurnIds.length +
      segment.citations.sourceSegmentIds.length +
      segment.citations.priorStatementIds.length +
      segment.citations.issueIds.length +
      segment.citations.instructionIds.length +
      segment.citations.ruleIds.length +
      segment.citations.settlementOfferIds.length,
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

/**
 * Strict server-to-Convex handoff for one accepted private opponent plan. The
 * decision identity is checked against canonical preparation state by the
 * commit action; actor, strategy, action, and event identities remain
 * server-derived and cannot be supplied through this envelope.
 */
export const HearingOpponentPlanPrecommitSchema = z
  .object({
    schemaVersion: z.literal(
      HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
    ),
    trialId: CaseGraphEntityIdSchema,
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    output: OpponentPlannerModelOutputSchema,
    modelMetadata: ModelMetadataSchema,
    trace: CourtroomModelCallTraceSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    const { modelMetadata, output, trace } = envelope;
    const candidateHash = hashOpponentPlannerModelOutput(output);
    const candidateCitations = opponentPlannerOutputCitations(output);
    const candidateProposedCitationCount =
      opponentPlannerProposedCitationCount(output);
    const acceptedAttempt = trace.attempts.find(
      (attempt) => attempt.attempt === trace.acceptedAttempt,
    );
    const aggregateUsage = aggregateAttemptUsage(trace.attempts);

    for (const [field, envelopeValue, traceValue] of [
      ["trialId", envelope.trialId, trace.trialId],
      ["callId", envelope.callId, trace.callId],
    ] as const) {
      if (envelopeValue !== traceValue) {
        addMismatch(
          context,
          ["trace", field],
          `Trace ${field} must match the opponent-plan pre-commit envelope`,
        );
      }
    }

    if (
      trace.status !== "accepted" ||
      trace.callClass !== "opponent_planner" ||
      trace.task !== "plan_opponent" ||
      trace.actorRole !== "counsel" ||
      trace.actorId === null ||
      trace.responseId !== null
    ) {
      addMismatch(
        context,
        ["trace", "task"],
        "Pre-commit requires an accepted private opponent-planner counsel trace",
      );
    }
    if (
      trace.expectedStateVersion === null ||
      trace.expectedLastEventId === null ||
      trace.inputEventIds.length !== 1 ||
      trace.inputEventIds[0] !== trace.expectedLastEventId
    ) {
      addMismatch(
        context,
        ["trace", "expectedLastEventId"],
        "Opponent planning must retain one exact canonical event-head binding",
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
        "Opponent planning and its trace must use gpt-5.6-luna",
      );
    }
    if (
      output.schemaVersion !== OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION ||
      trace.outputSchemaVersion !== output.schemaVersion ||
      modelMetadata.schemaVersion !== output.schemaVersion
    ) {
      addMismatch(
        context,
        ["modelMetadata", "schemaVersion"],
        "Opponent-plan output, trace, and metadata schema versions must match",
      );
    }
    if (
      trace.promptVersion !== HEARING_OPPONENT_PLANNER_PROMPT_VERSION ||
      modelMetadata.promptVersion !== HEARING_OPPONENT_PLANNER_PROMPT_VERSION ||
      modelMetadata.promptVersion !== trace.promptVersion
    ) {
      addMismatch(
        context,
        ["modelMetadata", "promptVersion"],
        "Opponent-plan trace and metadata must use the exact planner prompt version",
      );
    }
    if (
      modelMetadata.retryCount !== trace.retryCount ||
      modelMetadata.validationFailureCount !== trace.validationFailureCount
    ) {
      addMismatch(
        context,
        ["modelMetadata", "retryCount"],
        "Opponent-plan trace and metadata retry accounting must match",
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
        "Opponent-plan trace and metadata timing and cost must match",
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
        "Accepted opponent-plan usage must match its attempts and metadata",
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
        "Opponent-plan metadata must identify the accepted provider request",
      );
    }
    if (acceptedAttempt?.providerResponseId === null) {
      addMismatch(
        context,
        ["trace", "attempts"],
        "The accepted opponent-plan attempt must retain its response ID",
      );
    }
    if (
      trace.outputHash !== candidateHash ||
      acceptedAttempt?.outputHash !== candidateHash
    ) {
      addMismatch(
        context,
        ["trace", "outputHash"],
        "Opponent-plan trace hashes must match the validated candidate",
      );
    }
    if (
      opponentPlannerUnauditableCitationCount(output) !== 0 ||
      !sameCitations(trace.acceptedCitations, candidateCitations) ||
      acceptedAttempt?.proposedCitationCount !==
        candidateProposedCitationCount
    ) {
      addMismatch(
        context,
        ["trace", "acceptedCitations"],
        "Opponent-plan citations must exactly match durable audit fields",
      );
    }
    if (
      trace.committedActionId !== null ||
      trace.committedEventId !== null
    ) {
      addMismatch(
        context,
        ["trace", "committedActionId"],
        "An opponent-plan pre-commit trace cannot identify committed records",
      );
    }
  });

export type HearingOpponentPlanPrecommit = z.infer<
  typeof HearingOpponentPlanPrecommitSchema
>;

/**
 * Strict server-to-Convex handoff for one accepted open-court counsel
 * response. The canonical commit revalidates the decision, private planner
 * binding, actor, and event head; no action or event identity is caller-owned.
 */
export const HearingCounselResponsePrecommitSchema = z
  .object({
    schemaVersion: z.literal(
      HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    ),
    trialId: CaseGraphEntityIdSchema,
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    planBinding: CounselResponseRequestSchema.shape.planBinding,
    output: CounselRoleResponseModelOutputSchema,
    modelMetadata: ModelMetadataSchema,
    trace: CourtroomModelCallTraceSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    const { modelMetadata, output, trace } = envelope;
    const candidateHash = hashCounselResponseModelOutput(output);
    const candidateCitations = counselResponseOutputCitations(output);
    const candidateProposedCitationCount =
      counselResponseProposedCitationCount(output);
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
          `Trace ${field} must match the counsel-response pre-commit envelope`,
        );
      }
    }

    if (
      trace.status !== "accepted" ||
      trace.callClass !== "role_responder" ||
      trace.task !== "counsel_response" ||
      trace.actorRole !== "counsel" ||
      trace.actorId === null ||
      trace.responseId !== null
    ) {
      addMismatch(
        context,
        ["trace", "task"],
        "Pre-commit requires an accepted open-court counsel role-responder trace",
      );
    }
    if (
      trace.inputEventIds.length !== 1 ||
      trace.inputEventIds[0] !== envelope.expectedLastEventId
    ) {
      addMismatch(
        context,
        ["trace", "inputEventIds"],
        "Counsel response must retain one exact canonical event-head binding",
      );
    }
    if (envelope.planBinding.plannerCallId === envelope.callId) {
      addMismatch(
        context,
        ["planBinding", "plannerCallId"],
        "Counsel response and private planner calls require distinct identities",
      );
    }
    if (
      trace.knowledgeScope.knowledgeSchemaVersion !==
        OPPONENT_COUNSEL_PUBLIC_KNOWLEDGE_VIEW_SCHEMA_VERSION ||
      trace.knowledgeScope.stateVersion !== envelope.expectedStateVersion
    ) {
      addMismatch(
        context,
        ["trace", "knowledgeScope"],
        "Counsel response must audit the public counsel view at the bound head",
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
        "Counsel response and its trace must use gpt-5.6-luna",
      );
    }
    if (
      output.schemaVersion !==
        COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION ||
      trace.outputSchemaVersion !== output.schemaVersion ||
      modelMetadata.schemaVersion !== output.schemaVersion
    ) {
      addMismatch(
        context,
        ["modelMetadata", "schemaVersion"],
        "Counsel output, trace, and metadata schema versions must match",
      );
    }
    if (
      trace.promptVersion !== HEARING_COUNSEL_RESPONSE_PROMPT_VERSION ||
      modelMetadata.promptVersion !==
        HEARING_COUNSEL_RESPONSE_PROMPT_VERSION ||
      modelMetadata.promptVersion !== trace.promptVersion
    ) {
      addMismatch(
        context,
        ["modelMetadata", "promptVersion"],
        "Counsel trace and metadata must use the exact counsel prompt version",
      );
    }
    if (
      modelMetadata.retryCount !== trace.retryCount ||
      modelMetadata.validationFailureCount !== trace.validationFailureCount
    ) {
      addMismatch(
        context,
        ["modelMetadata", "retryCount"],
        "Counsel trace and metadata retry accounting must match",
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
        "Counsel trace and metadata timing and cost must match",
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
        "Accepted counsel usage must match its attempts and metadata",
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
        "Counsel metadata must identify the accepted provider request",
      );
    }
    if (acceptedAttempt?.providerResponseId === null) {
      addMismatch(
        context,
        ["trace", "attempts"],
        "The accepted counsel attempt must retain its provider response ID",
      );
    }
    if (
      trace.outputHash !== candidateHash ||
      acceptedAttempt?.outputHash !== candidateHash
    ) {
      addMismatch(
        context,
        ["trace", "outputHash"],
        "Counsel trace hashes must match the validated candidate",
      );
    }
    if (
      counselResponseUnsupportedCitationCount(output) !== 0 ||
      !sameCitations(trace.acceptedCitations, candidateCitations) ||
      acceptedAttempt?.proposedCitationCount !==
        candidateProposedCitationCount
    ) {
      addMismatch(
        context,
        ["trace", "acceptedCitations"],
        "Counsel citations must exactly match supported public audit fields",
      );
    }
    if (
      trace.committedActionId !== null ||
      trace.committedEventId !== null
    ) {
      addMismatch(
        context,
        ["trace", "committedActionId"],
        "A counsel pre-commit trace cannot identify committed records",
      );
    }
  });

export type HearingCounselResponsePrecommit = z.infer<
  typeof HearingCounselResponsePrecommitSchema
>;
