import { z } from "zod";

import {
  SemanticPerformanceSchema,
  WitnessPerformanceSchema,
  type SemanticPerformance,
  type WitnessAnswerModelOutput,
} from "../courtroom-ai";
import { ActorRefSchema } from "../trial-engine";

export const HEARING_COMMITTED_PERFORMANCE_SCHEMA_VERSION =
  "hearing-committed-performance.v1" as const;

const IdentifierSchema = z.string().trim().min(1).max(256);

export const HearingPerformanceKindSchema = z.enum([
  "witness_answer",
  "counsel_response",
  "judge_response",
  "objection_ruling",
  "negotiation_decision",
  "jury_deliberation",
]);

/**
 * Renderer-owned semantic allowlist. It is deliberately narrower than a raw
 * model output and adds only the witness-specific look-away gesture.
 */
export const HearingSemanticPerformanceSchema = SemanticPerformanceSchema.extend(
  {
    gesture: z.enum([
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
    ]),
  },
).strict();

const HearingPerformanceHeadSchema = z
  .object({
    trialId: IdentifierSchema,
    stateVersion: z.number().int().positive(),
    lastEventId: IdentifierSchema,
  })
  .strict();

const HearingPerformanceSourceSchema = z
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

/**
 * Exact browser-safe projection of one accepted performance proposal. The
 * record is exposed only at the canonical head named here; raw model output,
 * rationale, prompt text, and private settlement terms are never included.
 */
export const HearingCommittedPerformanceSchema = z
  .object({
    schemaVersion: z.literal(HEARING_COMMITTED_PERFORMANCE_SCHEMA_VERSION),
    kind: HearingPerformanceKindSchema,
    context: z.enum(["courtroom", "private_settlement"]),
    head: HearingPerformanceHeadSchema,
    source: HearingPerformanceSourceSchema,
    actor: ActorRefSchema,
    evidenceIds: z.array(IdentifierSchema).max(64),
    semantic: HearingSemanticPerformanceSchema,
  })
  .strict()
  .superRefine((performance, context) => {
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
    if (
      performance.kind === "objection_ruling" &&
      performance.semantic.activity !== "ruling"
    ) {
      context.addIssue({
        code: "custom",
        path: ["semantic", "activity"],
        message: "An objection ruling must retain the validated ruling activity",
      });
    }
    if (
      performance.semantic.gesture === "gavel" &&
      (performance.actor.role !== "judge" ||
        performance.semantic.activity !== "ruling")
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
  });

export type HearingPerformanceKind = z.infer<
  typeof HearingPerformanceKindSchema
>;
export type HearingSemanticPerformance = z.infer<
  typeof HearingSemanticPerformanceSchema
>;
export type HearingCommittedPerformance = z.infer<
  typeof HearingCommittedPerformanceSchema
>;

/** Normalize the validated witness contract into the common renderer shape. */
export function normalizeWitnessSemanticPerformance(
  input: WitnessAnswerModelOutput["performance"],
): HearingSemanticPerformance {
  const witness = WitnessPerformanceSchema.parse(input);
  return HearingSemanticPerformanceSchema.parse({
    activity: "speaking",
    emotion: witness.emotion,
    intensity: witness.intensity,
    gazeTarget: witness.gazeTarget,
    gesture: witness.gesture,
    speakingStyle: witness.delivery,
  });
}

/** Retain an already validated common role performance without widening it. */
export function normalizeRoleSemanticPerformance(
  input: SemanticPerformance,
): HearingSemanticPerformance {
  return HearingSemanticPerformanceSchema.parse(input);
}
