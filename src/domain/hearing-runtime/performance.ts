import { z } from "zod";

import {
  SemanticPerformanceSchema,
  WitnessPerformanceSchema,
  type SemanticPerformance,
  type WitnessAnswerModelOutput,
} from "../courtroom-ai";
import { ActorRefSchema } from "../trial-engine";

export const HEARING_COMMITTED_PERFORMANCE_SCHEMA_VERSION_V1 =
  "hearing-committed-performance.v1" as const;
export const HEARING_COMMITTED_PERFORMANCE_SCHEMA_VERSION =
  "hearing-committed-performance.v2" as const;

const IdentifierSchema = z.string().trim().min(1).max(256);
const OutputHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const RendererGestureSchema = z.enum([
  "none",
  "small_nod",
  "head_shake",
  "look_away",
  "open_palm",
  "lean_forward",
  "stand",
  "sit",
  "indicate_evidence",
  "gavel",
]);

export const HearingPerformanceKindSchema = z.enum([
  "witness_answer",
  "counsel_response",
  "judge_response",
  "objection_ruling",
  "negotiation_decision",
  "jury_deliberation",
]);

/** Legacy common cue retained only to validate and upgrade stored v1 rows. */
const HearingSemanticPerformanceV1Schema = SemanticPerformanceSchema.extend({
  gesture: RendererGestureSchema,
}).strict();

/** Exact witness proposal: no synthetic activity or local playback state. */
export const HearingWitnessSemanticPerformanceSchema =
  WitnessPerformanceSchema.extend({
    kind: z.literal("witness"),
  }).strict();

/** Exact common role proposal, tagged so it cannot be confused with witness data. */
export const HearingRoleSemanticPerformanceSchema =
  SemanticPerformanceSchema.extend({
    kind: z.literal("role"),
  }).strict();

export const HearingSemanticPerformanceSchema = z.discriminatedUnion("kind", [
  HearingWitnessSemanticPerformanceSchema,
  HearingRoleSemanticPerformanceSchema,
]);

const HearingPerformanceHeadSchema = z
  .object({
    trialId: IdentifierSchema,
    stateVersion: z.number().int().positive(),
    lastEventId: IdentifierSchema,
  })
  .strict();

const HearingPerformanceSourceV1Schema = z
  .object({
    callId: IdentifierSchema,
    actionId: IdentifierSchema,
    eventId: IdentifierSchema,
    turnId: IdentifierSchema.nullable(),
    responseId: IdentifierSchema.nullable(),
    interruptId: IdentifierSchema.nullable(),
    model: z.literal("gpt-5.6-luna"),
    outputSchemaVersion: IdentifierSchema,
  })
  .strict();

const HearingPerformanceSourceSchema = HearingPerformanceSourceV1Schema.extend({
  outputHash: OutputHashSchema,
}).strict();

const HearingCommittedPerformanceCommonShape = {
  kind: HearingPerformanceKindSchema,
  context: z.enum(["courtroom", "private_settlement"]),
  head: HearingPerformanceHeadSchema,
  actor: ActorRefSchema,
  evidenceIds: z.array(IdentifierSchema).max(64),
} as const;

const HearingCommittedPerformanceV1BaseSchema = z
  .object({
    ...HearingCommittedPerformanceCommonShape,
    semantic: HearingSemanticPerformanceV1Schema,
  })
  .strict();

const HearingCommittedPerformanceBaseSchema = z
  .object({
    ...HearingCommittedPerformanceCommonShape,
    semantic: HearingSemanticPerformanceSchema,
  })
  .strict();

type RefinableCommittedPerformance = Readonly<{
  kind: z.infer<typeof HearingPerformanceKindSchema>;
  context: "courtroom" | "private_settlement";
  source: z.infer<typeof HearingPerformanceSourceV1Schema>;
  actor: z.infer<typeof ActorRefSchema>;
  evidenceIds: readonly string[];
  semantic:
    | z.infer<typeof HearingSemanticPerformanceV1Schema>
    | z.infer<typeof HearingSemanticPerformanceSchema>;
}>;

function refineCommittedPerformance(
  performance: RefinableCommittedPerformance,
  context: z.RefinementCtx,
  current: boolean,
): void {
  if (performance.source.eventId !== `event:${performance.source.actionId}`) {
    context.addIssue({
      code: "custom",
      path: ["source", "eventId"],
      message: "Performance eventId must be derived from its actionId",
    });
  }
  if (new Set(performance.evidenceIds).size !== performance.evidenceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Performance evidence identifiers must be unique",
    });
  }
  const isSettlement = performance.kind === "negotiation_decision";
  if (
    (isSettlement && performance.context !== "private_settlement") ||
    (!isSettlement && performance.context !== "courtroom")
  ) {
    context.addIssue({
      code: "custom",
      path: ["context"],
      message: "Performance context must match its committed model task",
    });
  }
  if (
    isSettlement &&
    performance.actor.role !== "user_counsel" &&
    performance.actor.role !== "opposing_counsel"
  ) {
    context.addIssue({
      code: "custom",
      path: ["actor", "role"],
      message: "A private settlement performance requires a counsel actor",
    });
  }
  if (
    performance.kind === "witness_answer" &&
    performance.actor.role !== "witness"
  ) {
    context.addIssue({
      code: "custom",
      path: ["actor", "role"],
      message: "A witness performance requires a witness actor",
    });
  }
  if (
    performance.kind === "counsel_response" &&
    performance.actor.role !== "opposing_counsel"
  ) {
    context.addIssue({
      code: "custom",
      path: ["actor", "role"],
      message: "A counsel response performance requires opposing counsel",
    });
  }
  if (
    performance.kind === "jury_deliberation" &&
    performance.actor.role !== "jury"
  ) {
    context.addIssue({
      code: "custom",
      path: ["actor", "role"],
      message: "A deliberation performance requires a jury actor",
    });
  }
  if (
    (performance.kind === "judge_response" ||
      performance.kind === "objection_ruling") &&
    performance.actor.role !== "judge"
  ) {
    context.addIssue({
      code: "custom",
      path: ["actor", "role"],
      message: "A ruling performance requires a judge actor",
    });
  }
  if (current) {
    const semanticKind =
      "kind" in performance.semantic ? performance.semantic.kind : null;
    if (
      semanticKind === null ||
      (semanticKind === "witness") !==
        (performance.kind === "witness_answer")
    ) {
      context.addIssue({
        code: "custom",
        path: ["semantic", "kind"],
        message: "Semantic cue shape must match the committed role kind",
      });
    }
  }

  const requiresPublicTurn =
    performance.kind === "witness_answer" ||
    performance.kind === "counsel_response" ||
    performance.kind === "judge_response";
  if (requiresPublicTurn !== (performance.source.turnId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["source", "turnId"],
      message: requiresPublicTurn
        ? "Public spoken performance requires an exact transcript turn"
        : "Non-transcript performance must not name a transcript turn",
    });
  }
  if (
    performance.kind === "witness_answer" &&
    performance.source.responseId === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["source", "responseId"],
      message: "A witness answer performance requires a response binding",
    });
  }
  if (
    performance.kind === "objection_ruling" &&
    (performance.source.responseId === null ||
      performance.source.interruptId === null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["source", "interruptId"],
      message: "An objection ruling requires response and interrupt bindings",
    });
  }

  const activity =
    "activity" in performance.semantic
      ? performance.semantic.activity
      : null;
  if (performance.kind === "objection_ruling" && activity !== "ruling") {
    context.addIssue({
      code: "custom",
      path: ["semantic", "activity"],
      message: "An objection ruling must retain the validated ruling activity",
    });
  }
  if (
    performance.semantic.gesture === "gavel" &&
    (performance.actor.role !== "judge" || activity !== "ruling")
  ) {
    context.addIssue({
      code: "custom",
      path: ["semantic", "gesture"],
      message: "The gavel gesture is restricted to a judge ruling",
    });
  }
  if (
    (performance.semantic.gesture === "indicate_evidence" ||
      performance.semantic.gazeTarget === "evidence_display") &&
    performance.evidenceIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Evidence-directed performance requires a cited exhibit",
    });
  }
}

/**
 * Legacy sidecar contract retained so existing rows can be validated and
 * upgraded from their accepted model-call trace without a destructive deploy.
 */
export const HearingCommittedPerformanceV1Schema =
  HearingCommittedPerformanceV1BaseSchema.extend({
    schemaVersion: z.literal(
      HEARING_COMMITTED_PERFORMANCE_SCHEMA_VERSION_V1,
    ),
    source: HearingPerformanceSourceV1Schema,
  })
    .strict()
    .superRefine((performance, context) =>
      refineCommittedPerformance(performance, context, false),
    );

/**
 * Exact browser-safe projection of one accepted performance proposal. The
 * record retains the canonical head at which it was committed; raw model
 * output, rationale, prompt text, and private settlement terms are never
 * included.
 */
export const HearingCommittedPerformanceSchema =
  HearingCommittedPerformanceBaseSchema.extend({
    schemaVersion: z.literal(HEARING_COMMITTED_PERFORMANCE_SCHEMA_VERSION),
    source: HearingPerformanceSourceSchema,
  })
    .strict()
    .superRefine((performance, context) =>
      refineCommittedPerformance(performance, context, true),
    );

export type HearingPerformanceKind = z.infer<
  typeof HearingPerformanceKindSchema
>;
export type HearingSemanticPerformance = z.infer<
  typeof HearingSemanticPerformanceSchema
>;
export type HearingCommittedPerformance = z.infer<
  typeof HearingCommittedPerformanceSchema
>;
export type HearingCommittedPerformanceV1 = z.infer<
  typeof HearingCommittedPerformanceV1Schema
>;

/** Preserve the validated witness proposal without inventing playback state. */
export function normalizeWitnessSemanticPerformance(
  input: WitnessAnswerModelOutput["performance"],
): HearingSemanticPerformance {
  const witness = WitnessPerformanceSchema.parse(input);
  return HearingWitnessSemanticPerformanceSchema.parse({
    kind: "witness",
    ...witness,
  });
}

/** Retain an already validated common role performance without widening it. */
export function normalizeRoleSemanticPerformance(
  input: SemanticPerformance,
): HearingSemanticPerformance {
  return HearingRoleSemanticPerformanceSchema.parse({
    kind: "role",
    ...input,
  });
}
