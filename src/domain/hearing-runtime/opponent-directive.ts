import { z } from "zod";

import { sha256Utf8 } from "../case-graph/hash";
import { CaseGraphEntityIdSchema } from "../case-graph/schema";
import type { OpponentPlannerModelOutput } from "../courtroom-ai/call-contracts";
import { CounselResponseDirectiveSchema } from "../courtroom-ai/counsel-response";
import {
  OpponentPlannerRequestSchema,
  validateOpponentPlannerOutput,
  type OpponentPlannerRequest,
} from "../courtroom-ai/opponent-planner";

export const PERSISTED_OPPONENT_DIRECTIVE_SCHEMA_VERSION =
  "hearing-opponent-directive.v1" as const;
export const PERSISTED_OPPONENT_DIRECTIVE_PREFIX =
  "SUITS_OPPONENT_DIRECTIVE_V1:" as const;
/** Bound for the private durable pendingDirectiveJson strategy field. */
export const PERSISTED_OPPONENT_DIRECTIVE_MAX_CHARACTERS = 32_000 as const;
/** Hard per-leg bound that keeps the private planner/responder loop finite. */
export const MAX_OPPONENT_QUESTIONS_PER_LEG = 3 as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const OpponentDirectiveAppearanceBindingSchema = z
  .object({
    appearanceId: CaseGraphEntityIdSchema,
    witnessId: CaseGraphEntityIdSchema,
    examinationKind: z.enum(["direct", "cross", "redirect", "recross"]),
    answeredQuestionCount: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Canonical state supplied independently of the model request. Duplicating
 * these values is intentional: selection must fail if a stale or foreign
 * planner request is paired with the current durable state.
 */
export const OpponentDirectiveCanonicalBindingSchema = z
  .object({
    trialId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    strategyId: CaseGraphEntityIdSchema,
    strategyRevision: z.number().int().positive(),
    strategyEventId: CaseGraphEntityIdSchema,
    appearance: OpponentDirectiveAppearanceBindingSchema.nullable(),
  })
  .strict();

export const OpponentDirectiveCommittedBindingSchema = z
  .object({
    trialId: CaseGraphEntityIdSchema,
    stateVersion: z.number().int().positive(),
    lastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    strategyId: CaseGraphEntityIdSchema,
    strategyRevision: z.number().int().positive(),
    appearance: OpponentDirectiveAppearanceBindingSchema.nullable(),
  })
  .strict();

const PersistedOpponentDirectivePayloadSchema = z
  .object({
    schemaVersion: z.literal(PERSISTED_OPPONENT_DIRECTIVE_SCHEMA_VERSION),
    decisionId: CaseGraphEntityIdSchema,
    plannerCallId: CaseGraphEntityIdSchema,
    plannerOutputHash: Sha256Schema,
    selectedMoveIndex: z.number().int().min(0).max(5).nullable(),
    strategyId: CaseGraphEntityIdSchema,
    strategyRevision: z.number().int().positive(),
    strategyEventId: CaseGraphEntityIdSchema,
    trialHead: z
      .object({
        trialId: CaseGraphEntityIdSchema,
        stateVersion: z.number().int().nonnegative(),
        lastEventId: CaseGraphEntityIdSchema,
      })
      .strict(),
    actorId: CaseGraphEntityIdSchema,
    appearance: OpponentDirectiveAppearanceBindingSchema.nullable(),
    directive: CounselResponseDirectiveSchema,
  })
  .strict();

function directivePayloadHash(input: unknown): string {
  const payload = PersistedOpponentDirectivePayloadSchema.parse(input);
  return sha256Utf8(JSON.stringify(payload));
}

export const PersistedOpponentDirectiveSchema =
  PersistedOpponentDirectivePayloadSchema.extend({
    integrityHash: Sha256Schema,
  })
    .strict()
    .superRefine((record, context) => {
      const { integrityHash, ...payload } = record;
      if (integrityHash !== directivePayloadHash(payload)) {
        context.addIssue({
          code: "custom",
          path: ["integrityHash"],
          message:
            "Opponent directive integrity hash does not match its payload",
        });
      }
    });

export type OpponentDirectiveAppearanceBinding = z.infer<
  typeof OpponentDirectiveAppearanceBindingSchema
>;
export type OpponentDirectiveCanonicalBinding = z.infer<
  typeof OpponentDirectiveCanonicalBindingSchema
>;
export type OpponentDirectiveCommittedBinding = z.infer<
  typeof OpponentDirectiveCommittedBindingSchema
>;
export type PersistedOpponentDirective = z.infer<
  typeof PersistedOpponentDirectiveSchema
>;

function mismatch(field: string): never {
  throw new Error(`OPPONENT_DIRECTIVE_BINDING_MISMATCH:${field}`);
}

function assertPlannerRequestBinding(
  request: OpponentPlannerRequest,
  binding: OpponentDirectiveCanonicalBinding,
): void {
  const requestAppearance = request.procedure;
  const comparisons: ReadonlyArray<
    readonly [string, string | number | null, string | number | null]
  > = [
    ["trialId", request.trialId, binding.trialId],
    [
      "expectedStateVersion",
      request.expectedStateVersion,
      binding.expectedStateVersion,
    ],
    [
      "expectedLastEventId",
      request.expectedLastEventId,
      binding.expectedLastEventId,
    ],
    ["actorId", request.actorId, binding.actorId],
    ["knowledgeView.trialId", request.knowledgeView.trialId, binding.trialId],
    [
      "knowledgeView.stateVersion",
      request.knowledgeView.stateVersion,
      binding.expectedStateVersion,
    ],
    ["knowledgeView.actorId", request.knowledgeView.actorId, binding.actorId],
  ];
  for (const [field, actual, expected] of comparisons) {
    if (actual !== expected) mismatch(field);
  }

  if (binding.appearance === null) {
    if (
      request.procedure.phase !== "closing" ||
      request.procedure.trigger !== "pre_closing" ||
      request.procedure.activeAppearanceId !== null ||
      request.procedure.activeWitnessId !== null ||
      request.procedure.activeExaminationKind !== null ||
      request.procedure.answeredQuestionCount !== 0 ||
      request.opportunities.questionableWitnessIds.length !== 0 ||
      !request.opportunities.canClose
    ) {
      mismatch("closingProcedure");
    }
    return;
  }

  for (const [field, actual, expected] of [
    [
      "activeAppearanceId",
      requestAppearance.activeAppearanceId,
      binding.appearance.appearanceId,
    ],
    [
      "activeWitnessId",
      requestAppearance.activeWitnessId,
      binding.appearance.witnessId,
    ],
    [
      "activeExaminationKind",
      requestAppearance.activeExaminationKind,
      binding.appearance.examinationKind,
    ],
    [
      "answeredQuestionCount",
      requestAppearance.answeredQuestionCount,
      binding.appearance.answeredQuestionCount,
    ],
  ] as const) {
    if (actual !== expected) mismatch(field);
  }

  const questionableWitnessIds = request.opportunities.questionableWitnessIds;
  const questionLimitReached =
    binding.appearance.answeredQuestionCount >= MAX_OPPONENT_QUESTIONS_PER_LEG;
  const opportunitiesMatch = questionLimitReached
    ? questionableWitnessIds.length === 0
    : questionableWitnessIds.length === 1 &&
      questionableWitnessIds[0] === binding.appearance.witnessId;
  if (!opportunitiesMatch) {
    mismatch("opportunities.questionableWitnessIds");
  }
}

function plannerOutputHash(output: OpponentPlannerModelOutput): string {
  return sha256Utf8(JSON.stringify(output));
}

/**
 * Select the first validated open-court counsel move in model priority order.
 * Other legal move kinds cannot drive this responder and deterministically
 * fall back to ending the examination.
 */
export function createPersistedOpponentDirective(
  input: Readonly<{
    request: OpponentPlannerRequest;
    output: OpponentPlannerModelOutput;
    canonicalBinding: OpponentDirectiveCanonicalBinding;
  }>,
): PersistedOpponentDirective {
  const request = OpponentPlannerRequestSchema.parse(input.request);
  const binding = OpponentDirectiveCanonicalBindingSchema.parse(
    input.canonicalBinding,
  );
  assertPlannerRequestBinding(request, binding);

  const validation = validateOpponentPlannerOutput(request, input.output);
  if (!validation.accepted) {
    const codes = [...new Set(validation.report.issues.map(({ code }) => code))]
      .sort((left, right) => left.localeCompare(right))
      .join(",");
    throw new Error(`OPPONENT_DIRECTIVE_PLAN_REJECTED:${codes}`);
  }

  const selectedMoveIndex = validation.output.proposedMoves.findIndex((move) =>
    binding.appearance === null
      ? move.kind === "give_closing"
      : (move.kind === "question_witness" &&
          move.witnessId === binding.appearance.witnessId) ||
        (move.kind === "move_to_strike" && move.testimonyIds.length > 0),
  );
  const selectedMove =
    selectedMoveIndex < 0
      ? null
      : validation.output.proposedMoves[selectedMoveIndex];
  let directive: PersistedOpponentDirective["directive"];
  if (selectedMove?.kind === "give_closing") {
    directive = CounselResponseDirectiveSchema.parse({
      kind: "give_closing",
      permittedFactIds: [...selectedMove.citations.factIds],
      permittedEvidenceIds: [...selectedMove.citations.evidenceIds],
      permittedTestimonyIds: [...selectedMove.citations.testimonyIds],
    });
  } else if (
    selectedMove?.kind === "move_to_strike" &&
    binding.appearance !== null
  ) {
    directive = CounselResponseDirectiveSchema.parse({
      kind: "move_to_strike",
      testimonyIds: [...selectedMove.testimonyIds],
      basis: selectedMove.rationale,
      permittedFactIds: [],
      permittedEvidenceIds: [],
      permittedTestimonyIds: [...selectedMove.testimonyIds],
    });
  } else if (
    selectedMove?.kind === "question_witness" &&
    binding.appearance !== null
  ) {
    directive = CounselResponseDirectiveSchema.parse({
      kind: "question_witness",
      witnessId: selectedMove.witnessId,
      goal: selectedMove.goal,
      presentedEvidenceIds: [...selectedMove.presentedEvidenceIds],
      permittedFactIds: [...selectedMove.citations.factIds],
      permittedEvidenceIds: [...selectedMove.citations.evidenceIds],
      permittedTestimonyIds: [...selectedMove.citations.testimonyIds],
    });
  } else if (binding.appearance !== null) {
    directive = CounselResponseDirectiveSchema.parse({
      kind: "end_examination",
      disposition:
        binding.appearance.answeredQuestionCount === 0 ? "waived" : "completed",
    });
  } else {
    directive = mismatch("closingMove");
  }

  const payload = PersistedOpponentDirectivePayloadSchema.parse({
    schemaVersion: PERSISTED_OPPONENT_DIRECTIVE_SCHEMA_VERSION,
    decisionId: request.decisionId,
    plannerCallId: request.callId,
    plannerOutputHash: plannerOutputHash(validation.output),
    selectedMoveIndex: selectedMoveIndex < 0 ? null : selectedMoveIndex,
    strategyId: binding.strategyId,
    strategyRevision: binding.strategyRevision,
    strategyEventId: binding.strategyEventId,
    trialHead: {
      trialId: binding.trialId,
      stateVersion: binding.expectedStateVersion,
      lastEventId: binding.expectedLastEventId,
    },
    actorId: binding.actorId,
    appearance: binding.appearance,
    directive,
  });
  return PersistedOpponentDirectiveSchema.parse({
    ...payload,
    integrityHash: directivePayloadHash(payload),
  });
}

/** Revalidate a loaded directive against the canonical state that will use it. */
export function assertPersistedOpponentDirectiveBinding(
  recordInput: unknown,
  bindingInput: OpponentDirectiveCommittedBinding,
): PersistedOpponentDirective {
  const record = PersistedOpponentDirectiveSchema.parse(recordInput);
  const binding = OpponentDirectiveCommittedBindingSchema.parse(bindingInput);
  const comparisons: ReadonlyArray<
    readonly [string, string | number, string | number]
  > = [
    ["trialId", record.trialHead.trialId, binding.trialId],
    [
      "committedStateVersion",
      record.trialHead.stateVersion + 1,
      binding.stateVersion,
    ],
    ["strategyEventId", record.strategyEventId, binding.lastEventId],
    ["actorId", record.actorId, binding.actorId],
    ["strategyId", record.strategyId, binding.strategyId],
    ["strategyRevision", record.strategyRevision, binding.strategyRevision],
  ];
  for (const [field, actual, expected] of comparisons) {
    if (actual !== expected) mismatch(field);
  }
  if ((record.appearance === null) !== (binding.appearance === null)) {
    mismatch("appearanceMode");
  }
  if (record.appearance !== null && binding.appearance !== null) {
    for (const [field, actual, expected] of [
      [
        "appearanceId",
        record.appearance.appearanceId,
        binding.appearance.appearanceId,
      ],
      ["witnessId", record.appearance.witnessId, binding.appearance.witnessId],
      [
        "examinationKind",
        record.appearance.examinationKind,
        binding.appearance.examinationKind,
      ],
      [
        "answeredQuestionCount",
        record.appearance.answeredQuestionCount,
        binding.appearance.answeredQuestionCount,
      ],
    ] as const) {
      if (actual !== expected) mismatch(field);
    }
  }
  return record;
}

/** Canonical bounded encoding for private durable strategy storage. */
export function serializePersistedOpponentDirective(
  recordInput: unknown,
): string {
  const record = PersistedOpponentDirectiveSchema.parse(recordInput);
  const serialized = `${PERSISTED_OPPONENT_DIRECTIVE_PREFIX}${JSON.stringify(record)}`;
  if (serialized.length > PERSISTED_OPPONENT_DIRECTIVE_MAX_CHARACTERS) {
    throw new Error("OPPONENT_DIRECTIVE_SERIALIZED_SIZE_EXCEEDED");
  }
  return serialized;
}

/** Parse only the exact canonical encoding; whitespace and duplicate wrappers fail. */
export function parsePersistedOpponentDirective(
  serialized: string,
): PersistedOpponentDirective {
  if (
    typeof serialized !== "string" ||
    serialized.length > PERSISTED_OPPONENT_DIRECTIVE_MAX_CHARACTERS
  ) {
    throw new Error("OPPONENT_DIRECTIVE_SERIALIZED_SIZE_EXCEEDED");
  }
  if (!serialized.startsWith(PERSISTED_OPPONENT_DIRECTIVE_PREFIX)) {
    throw new Error("OPPONENT_DIRECTIVE_PREFIX_INVALID");
  }

  const json = serialized.slice(PERSISTED_OPPONENT_DIRECTIVE_PREFIX.length);
  let candidate: unknown;
  try {
    candidate = JSON.parse(json) as unknown;
  } catch {
    throw new Error("OPPONENT_DIRECTIVE_JSON_INVALID");
  }
  const record = PersistedOpponentDirectiveSchema.parse(candidate);
  if (serializePersistedOpponentDirective(record) !== serialized) {
    throw new Error("OPPONENT_DIRECTIVE_ENCODING_NONCANONICAL");
  }
  return record;
}
