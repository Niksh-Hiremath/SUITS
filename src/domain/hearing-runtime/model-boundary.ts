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
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  CounselRoleResponseModelOutputSchema,
  DebriefGeneratorModelOutputSchema,
  JuryRoleResponseModelOutputSchema,
  OpponentPlannerModelOutputSchema,
  type CounselRoleResponseModelOutput,
  type DebriefCitationSet,
  type DebriefGeneratorModelOutput,
  type JuryRoleResponseModelOutput,
  type OpponentPlannerModelOutput,
} from "../courtroom-ai/call-contracts";
import {
  COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION,
  CounselResponseRequestSchema,
  type CounselResponseRequest,
} from "../courtroom-ai/counsel-response";
import {
  DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION,
  DebriefGeneratorRequestSchema,
  type DebriefGeneratorRequest,
} from "../courtroom-ai/debrief-generator";
import {
  JURY_RESPONSE_REQUEST_SCHEMA_VERSION,
  JuryResponseRequestSchema,
  type JuryResponseRequest,
} from "../courtroom-ai/jury-response";
import {
  NEGOTIATION_AGENT_REQUEST_SCHEMA_VERSION,
  NegotiationAgentRequestSchema,
  type NegotiationAgentRequest,
} from "../courtroom-ai/negotiation-agent";
import {
  OBJECTION_RULING_REQUEST_SCHEMA_VERSION,
  ObjectionRulingRequestSchema,
  type ObjectionRulingRequest,
} from "../courtroom-ai/objection-ruling";
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
import {
  KNOWLEDGE_VIEW_SCHEMA_VERSION_V2,
  OPPONENT_COUNSEL_PUBLIC_KNOWLEDGE_VIEW_SCHEMA_VERSION,
} from "../knowledge";
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
export const HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION =
  "hearing-jury-response-precommit.v1" as const;
export const HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION =
  "hearing-debrief-generator-precommit.v1" as const;
const HEARING_OPPONENT_PLANNER_PROMPT_VERSION =
  "opponent-planner.prompt.v2" as const;
const HEARING_COUNSEL_RESPONSE_PROMPT_VERSION =
  "role-responder.counsel.prompt.v2" as const;
const HEARING_JURY_RESPONSE_PROMPT_VERSION =
  "role-responder.jury.prompt.v1" as const;
const HEARING_DEBRIEF_GENERATOR_PROMPT_VERSION =
  "debrief-generator.prompt.v1" as const;

/** Every server-prepared model request that may cross the secret boundary. */
export const HearingModelRequestSchema = z.union([
  WitnessAnswerRequestSchema,
  OpponentPlannerRequestSchema,
  CounselResponseRequestSchema,
  ObjectionRulingRequestSchema,
  NegotiationAgentRequestSchema,
  JuryResponseRequestSchema,
  DebriefGeneratorRequestSchema,
]);

export type HearingModelRequest = z.infer<typeof HearingModelRequestSchema>;

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
    request: HearingModelRequestSchema,
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

export type HearingCounselResponseModelRequiredPreparation = Omit<
  HearingModelRequiredPreparation,
  "request"
> &
  Readonly<{ request: CounselResponseRequest }>;

export type HearingObjectionRulingModelRequiredPreparation = Omit<
  HearingModelRequiredPreparation,
  "request"
> &
  Readonly<{ request: ObjectionRulingRequest }>;

export type HearingNegotiationModelRequiredPreparation = Omit<
  HearingModelRequiredPreparation,
  "request"
> &
  Readonly<{ request: NegotiationAgentRequest }>;

export type HearingJuryResponseModelRequiredPreparation = Omit<
  HearingModelRequiredPreparation,
  "request"
> &
  Readonly<{ request: JuryResponseRequest }>;

export type HearingDebriefGeneratorModelRequiredPreparation = Omit<
  HearingModelRequiredPreparation,
  "request"
> &
  Readonly<{ request: DebriefGeneratorRequest }>;

/** Narrow a model-required preparation before entering witness-only code. */
export function isHearingWitnessModelRequiredPreparation(
  preparation: HearingCommandPreparation,
): preparation is HearingWitnessModelRequiredPreparation {
  return (
    preparation.status === "model_required" &&
    preparation.request.schemaVersion === WITNESS_ANSWER_REQUEST_SCHEMA_VERSION
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

/** Narrow a model-required preparation before entering counsel-only code. */
export function isHearingCounselResponseModelRequiredPreparation(
  preparation: HearingCommandPreparation,
): preparation is HearingCounselResponseModelRequiredPreparation {
  return (
    preparation.status === "model_required" &&
    preparation.request.schemaVersion ===
      COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION
  );
}

/** Narrow a model-required preparation before entering objection-only code. */
export function isHearingObjectionRulingModelRequiredPreparation(
  preparation: HearingCommandPreparation,
): preparation is HearingObjectionRulingModelRequiredPreparation {
  return (
    preparation.status === "model_required" &&
    preparation.request.schemaVersion ===
      OBJECTION_RULING_REQUEST_SCHEMA_VERSION
  );
}

/** Narrow a model-required preparation before entering negotiation-only code. */
export function isHearingNegotiationModelRequiredPreparation(
  preparation: HearingCommandPreparation,
): preparation is HearingNegotiationModelRequiredPreparation {
  return (
    preparation.status === "model_required" &&
    preparation.request.schemaVersion ===
      NEGOTIATION_AGENT_REQUEST_SCHEMA_VERSION
  );
}

/** Narrow a model-required preparation before entering jury-only code. */
export function isHearingJuryResponseModelRequiredPreparation(
  preparation: HearingCommandPreparation,
): preparation is HearingJuryResponseModelRequiredPreparation {
  return (
    preparation.status === "model_required" &&
    preparation.request.schemaVersion === JURY_RESPONSE_REQUEST_SCHEMA_VERSION
  );
}

/** Narrow a model-required preparation before entering debrief-only code. */
export function isHearingDebriefGeneratorModelRequiredPreparation(
  preparation: HearingCommandPreparation,
): preparation is HearingDebriefGeneratorModelRequiredPreparation {
  return (
    preparation.status === "model_required" &&
    preparation.request.schemaVersion ===
      DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION
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
      output.proposedMoves.flatMap((move) => move.citations.sourceSegmentIds),
    ),
    priorStatementIds: stableUnique(
      output.proposedMoves.flatMap((move) => move.citations.priorStatementIds),
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
      output.speechSegments.flatMap((segment) => segment.citations.factIds),
    ),
    evidenceIds: stableUnique(
      output.speechSegments.flatMap((segment) => segment.citations.evidenceIds),
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

function juryResponseCitationSets(output: JuryRoleResponseModelOutput) {
  return [
    ...output.deliberationSegments.map(({ citations }) => citations),
    ...output.findings.map(({ citations }) => citations),
  ];
}

/** Canonical jury-considerable citations retained by the generic call audit. */
export function juryResponseOutputCitations(
  outputInput: unknown,
): CourtroomModelCallCitationSet {
  const output = JuryRoleResponseModelOutputSchema.parse(outputInput);
  const citations = juryResponseCitationSets(output);
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

/** Runtime-neutral jury digest shared by the server and Convex boundary. */
export function hashJuryResponseModelOutput(outputInput: unknown): string {
  const output = JuryRoleResponseModelOutputSchema.parse(outputInput);
  return sha256Utf8(JSON.stringify(output));
}

export const HearingDebriefTranscriptEventBindingSchema = z
  .object({
    turnId: CaseGraphEntityIdSchema,
    sourceEventId: CaseGraphEntityIdSchema,
  })
  .strict();

const HearingDebriefTranscriptEventBindingsSchema = z
  .array(HearingDebriefTranscriptEventBindingSchema)
  .max(2_000)
  .superRefine((bindings, context) => {
    bindings.forEach((binding, index) => {
      if (
        index > 0 &&
        bindings[index - 1].turnId.localeCompare(binding.turnId) >= 0
      ) {
        context.addIssue({
          code: "custom",
          path: [index, "turnId"],
          message:
            "Transcript event bindings must be unique and sorted by turn ID",
        });
      }
    });
  });

export type HearingDebriefTranscriptEventBinding = z.infer<
  typeof HearingDebriefTranscriptEventBindingSchema
>;

function debriefGeneratorCitationSets(
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

const GENERIC_TRACE_CITATION_LIMIT = 128;

function boundedStableUnique(identifiers: readonly string[]): string[] {
  return stableUnique(identifiers).slice(0, GENERIC_TRACE_CITATION_LIMIT);
}

function debriefCitedTranscriptTurnIds(
  output: DebriefGeneratorModelOutput,
): string[] {
  return stableUnique(
    debriefGeneratorCitationSets(output).flatMap(
      ({ transcriptTurnIds }) => transcriptTurnIds,
    ),
  );
}

/**
 * Canonical debrief citations represented by the generic durable call audit.
 * The caller supplies only the cited turn-to-event bindings; the strict list
 * must cover every cited turn exactly once and cannot include uncited turns.
 */
export function debriefGeneratorOutputCitations(
  outputInput: unknown,
  transcriptEventBindingsInput: readonly HearingDebriefTranscriptEventBinding[],
): CourtroomModelCallCitationSet {
  const output = DebriefGeneratorModelOutputSchema.parse(outputInput);
  const transcriptEventBindings =
    HearingDebriefTranscriptEventBindingsSchema.parse(
      transcriptEventBindingsInput,
    );
  const citedTranscriptTurnIds = debriefCitedTranscriptTurnIds(output);
  const boundTranscriptTurnIds = transcriptEventBindings.map(
    ({ turnId }) => turnId,
  );
  if (!sameIdentifierSet(citedTranscriptTurnIds, boundTranscriptTurnIds)) {
    throw new Error(
      "Transcript event bindings must exactly cover cited debrief turns",
    );
  }
  const sourceEventIdByTurnId = new Map(
    transcriptEventBindings.map(({ turnId, sourceEventId }) => [
      turnId,
      sourceEventId,
    ]),
  );
  const citations = debriefGeneratorCitationSets(output);
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
    eventIds: boundedStableUnique(
      citedTranscriptTurnIds.map((turnId) => {
        const sourceEventId = sourceEventIdByTurnId.get(turnId);
        if (sourceEventId === undefined) {
          throw new Error("A cited debrief turn is missing its event binding");
        }
        return sourceEventId;
      }),
    ),
    sourceSegmentIds: boundedStableUnique(
      citations.flatMap((citation) => citation.hiddenSourceSegmentIds),
    ),
    priorStatementIds: [],
  });
}

/** Runtime-neutral debrief digest shared by the server and Convex boundary. */
export function hashDebriefGeneratorModelOutput(outputInput: unknown): string {
  const output = DebriefGeneratorModelOutputSchema.parse(outputInput);
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
        (segmentTotal, identifiers) => segmentTotal + identifiers.length,
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

function juryResponseProposedCitationCount(
  output: JuryRoleResponseModelOutput,
): number {
  return juryResponseCitationSets(output).reduce(
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

function juryResponseUnsupportedCitationCount(
  output: JuryRoleResponseModelOutput,
): number {
  return juryResponseCitationSets(output).reduce(
    (total, citations) =>
      total +
      citations.transcriptTurnIds.length +
      citations.sourceSegmentIds.length +
      citations.priorStatementIds.length +
      citations.issueIds.length +
      citations.ruleIds.length +
      citations.settlementOfferIds.length,
    0,
  );
}

function debriefGeneratorProposedCitationCount(
  output: DebriefGeneratorModelOutput,
): number {
  return debriefGeneratorCitationSets(output).reduce(
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

type CourtroomModelCallTrace = z.infer<typeof CourtroomModelCallTraceSchema>;
type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

type FinalTrialTraceExpectation = Readonly<{
  callClass: CourtroomModelCallTrace["callClass"];
  task: CourtroomModelCallTrace["task"];
  actorRole: NonNullable<CourtroomModelCallTrace["actorRole"]>;
  model: CourtroomModelCallTrace["model"];
  promptVersion: string;
  outputSchemaVersion: string;
  outputHash: string;
  outputCharacterCount: number;
  citations: CourtroomModelCallCitationSet;
  proposedCitationCount: number;
}>;

function validateFinalTrialPrecommitTrace(
  envelope: Readonly<{
    trialId: string;
    callId: string;
    expectedStateVersion: number;
    expectedLastEventId: string;
    modelMetadata: ModelMetadata;
    trace: CourtroomModelCallTrace;
  }>,
  expected: FinalTrialTraceExpectation,
  context: z.RefinementCtx,
): void {
  const { modelMetadata, trace } = envelope;
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
        `Trace ${field} must match the final-trial pre-commit envelope`,
      );
    }
  }

  if (
    trace.status !== "accepted" ||
    trace.callClass !== expected.callClass ||
    trace.task !== expected.task ||
    trace.actorRole !== expected.actorRole ||
    trace.actorId === null ||
    trace.responseId !== null
  ) {
    addMismatch(
      context,
      ["trace", "task"],
      "Final-trial pre-commit requires the exact accepted call class, task, and actor role",
    );
  }
  if (
    trace.inputEventIds.length !== 1 ||
    trace.inputEventIds[0] !== envelope.expectedLastEventId
  ) {
    addMismatch(
      context,
      ["trace", "inputEventIds"],
      "Final-trial generation must retain one exact canonical event-head binding",
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
      "Final-trial generation must audit a V2 KnowledgeView at the bound head",
    );
  }
  if (
    trace.model !== expected.model ||
    modelMetadata.model !== expected.model ||
    modelMetadata.model !== trace.model
  ) {
    addMismatch(
      context,
      ["modelMetadata", "model"],
      `Final-trial generation and its trace must use ${expected.model}`,
    );
  }
  if (
    trace.outputSchemaVersion !== expected.outputSchemaVersion ||
    modelMetadata.schemaVersion !== expected.outputSchemaVersion
  ) {
    addMismatch(
      context,
      ["modelMetadata", "schemaVersion"],
      "Final-trial output, trace, and metadata schema versions must match",
    );
  }
  if (
    trace.promptVersion !== expected.promptVersion ||
    modelMetadata.promptVersion !== expected.promptVersion ||
    modelMetadata.promptVersion !== trace.promptVersion
  ) {
    addMismatch(
      context,
      ["modelMetadata", "promptVersion"],
      "Final-trial trace and metadata must use the exact prompt version",
    );
  }
  if (
    modelMetadata.retryCount !== trace.retryCount ||
    modelMetadata.validationFailureCount !== trace.validationFailureCount
  ) {
    addMismatch(
      context,
      ["modelMetadata", "retryCount"],
      "Final-trial trace and metadata retry accounting must match",
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
      "Final-trial trace and metadata timing and cost must match",
    );
  }
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
      "Accepted final-trial usage must match its attempts and metadata",
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
      "Final-trial metadata must identify the accepted provider request",
    );
  }
  if (acceptedAttempt?.providerResponseId === null) {
    addMismatch(
      context,
      ["trace", "attempts"],
      "The accepted final-trial attempt must retain its provider response ID",
    );
  }
  if (
    trace.outputHash !== expected.outputHash ||
    acceptedAttempt?.outputHash !== expected.outputHash ||
    trace.outputCharacterCount !== expected.outputCharacterCount
  ) {
    addMismatch(
      context,
      ["trace", "outputHash"],
      "Final-trial trace output identity must match the validated candidate",
    );
  }
  if (
    !sameCitations(trace.acceptedCitations, expected.citations) ||
    acceptedAttempt?.proposedCitationCount !==
      expected.proposedCitationCount
  ) {
    addMismatch(
      context,
      ["trace", "acceptedCitations"],
      "Final-trial citations must exactly match the validated candidate",
    );
  }
  if (trace.committedActionId !== null || trace.committedEventId !== null) {
    addMismatch(
      context,
      ["trace", "committedActionId"],
      "A final-trial pre-commit trace cannot identify committed records",
    );
  }
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
      acceptedAttempt?.proposedCitationCount !== candidateProposedCitationCount
    ) {
      addMismatch(
        context,
        ["trace", "acceptedCitations"],
        "Accepted trace citations must match the validated witness candidate",
      );
    }
    if (trace.committedActionId !== null || trace.committedEventId !== null) {
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
    schemaVersion: z.literal(HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION),
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
      acceptedAttempt?.proposedCitationCount !== candidateProposedCitationCount
    ) {
      addMismatch(
        context,
        ["trace", "acceptedCitations"],
        "Opponent-plan citations must exactly match durable audit fields",
      );
    }
    if (trace.committedActionId !== null || trace.committedEventId !== null) {
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
    schemaVersion: z.literal(HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION),
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
      output.schemaVersion !== COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION ||
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
      modelMetadata.promptVersion !== HEARING_COUNSEL_RESPONSE_PROMPT_VERSION ||
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
      acceptedAttempt?.proposedCitationCount !== candidateProposedCitationCount
    ) {
      addMismatch(
        context,
        ["trace", "acceptedCitations"],
        "Counsel citations must exactly match supported public audit fields",
      );
    }
    if (trace.committedActionId !== null || trace.committedEventId !== null) {
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

/**
 * Strict server-to-Convex handoff for one accepted jury deliberation. The
 * deterministic commit reconstructs the jury request and derives any verdict
 * action; the model cannot supply a canonical action or event identity.
 */
export const HearingJuryResponsePrecommitSchema = z
  .object({
    schemaVersion: z.literal(HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION),
    trialId: CaseGraphEntityIdSchema,
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    output: JuryRoleResponseModelOutputSchema,
    modelMetadata: ModelMetadataSchema,
    trace: CourtroomModelCallTraceSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    const outputHash = hashJuryResponseModelOutput(envelope.output);
    const citations = juryResponseOutputCitations(envelope.output);
    validateFinalTrialPrecommitTrace(
      envelope,
      {
        callClass: "role_responder",
        task: "jury_deliberation",
        actorRole: "jury",
        model: "gpt-5.6-luna",
        promptVersion: HEARING_JURY_RESPONSE_PROMPT_VERSION,
        outputSchemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
        outputHash,
        outputCharacterCount: JSON.stringify(envelope.output).length,
        citations,
        proposedCitationCount: juryResponseProposedCitationCount(
          envelope.output,
        ),
      },
      context,
    );
    if (juryResponseUnsupportedCitationCount(envelope.output) !== 0) {
      addMismatch(
        context,
        ["output", "deliberationSegments"],
        "Jury output cannot contain citation classes outside the jury-considerable record",
      );
    }
  });

export type HearingJuryResponsePrecommit = z.infer<
  typeof HearingJuryResponsePrecommitSchema
>;

/**
 * Strict server-to-Convex handoff for one accepted Terra coaching artifact.
 * Only cited transcript turn-to-event bindings cross back to Convex; hidden
 * debrief knowledge and the full request remain outside this envelope.
 */
export const HearingDebriefGeneratorPrecommitSchema = z
  .object({
    schemaVersion: z.literal(
      HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
    ),
    trialId: CaseGraphEntityIdSchema,
    callId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    transcriptEventBindings: HearingDebriefTranscriptEventBindingsSchema,
    output: DebriefGeneratorModelOutputSchema,
    modelMetadata: ModelMetadataSchema,
    trace: CourtroomModelCallTraceSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    let citations: CourtroomModelCallCitationSet;
    try {
      citations = debriefGeneratorOutputCitations(
        envelope.output,
        envelope.transcriptEventBindings,
      );
    } catch {
      addMismatch(
        context,
        ["transcriptEventBindings"],
        "Debrief transcript bindings must exactly cover every cited turn",
      );
      return;
    }
    validateFinalTrialPrecommitTrace(
      envelope,
      {
        callClass: "debrief_generator",
        task: "generate_debrief",
        actorRole: "debrief",
        model: "gpt-5.6-terra",
        promptVersion: HEARING_DEBRIEF_GENERATOR_PROMPT_VERSION,
        outputSchemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
        outputHash: hashDebriefGeneratorModelOutput(envelope.output),
        outputCharacterCount: JSON.stringify(envelope.output).length,
        citations,
        proposedCitationCount: debriefGeneratorProposedCitationCount(
          envelope.output,
        ),
      },
      context,
    );
  });

export type HearingDebriefGeneratorPrecommit = z.infer<
  typeof HearingDebriefGeneratorPrecommitSchema
>;
