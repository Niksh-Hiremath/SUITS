import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { HearingTrialIdSchema } from "../hearing-runtime/contracts";
import { HearingRuntimeViewV1Schema } from "../hearing-runtime/schema";
import { PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE } from "./partial-detector";

export const FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION =
  "final-bound-interruption.request.v1" as const;
export const FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION =
  "final-bound-interruption.response.v1" as const;

export const FINAL_BOUND_INTERRUPTION_TRIGGER_TEXT_MAX_CHARACTERS =
  2_000 as const;
export const FINAL_BOUND_INTERRUPTION_FINAL_TEXT_MAX_CHARACTERS =
  8_000 as const;

const PositiveSafeIntegerSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
const NonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const SpeechIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u);

function normalizedTranscriptText(maximumCharacters: number) {
  return z
    .string()
    .max(maximumCharacters)
    .transform((text) =>
      text.normalize("NFKC").replace(/\p{White_Space}+/gu, " ").trim(),
    )
    .pipe(
      z
        .string()
        .min(1)
        .max(maximumCharacters)
        .refine(
          (text) => /[^\p{White_Space}\p{C}]/u.test(text),
          "Transcript text must contain visible content",
        )
        .refine(
          (text) => !/\p{C}/u.test(text),
          "Transcript text cannot contain control or format characters",
        ),
    );
}

/**
 * Browser-observed canonical head. Parsing freezes this object so later local
 * state changes cannot silently rewrite the authority snapshot attached to an
 * already-sealed utterance.
 */
export const FinalBoundInterruptionTrialHeadSchema = z
  .strictObject({
    trialId: HearingTrialIdSchema,
    stateVersion: NonNegativeSafeIntegerSchema,
    lastEventId: CaseGraphEntityIdSchema,
  })
  .readonly();

const FinalBoundInterruptionUtteranceSchema = z.strictObject({
  generation: PositiveSafeIntegerSchema,
  utteranceId: SpeechIdentifierSchema,
});

const FinalBoundInterruptionTriggerSchema = z.strictObject({
  revision: PositiveSafeIntegerSchema,
  text: normalizedTranscriptText(
    FINAL_BOUND_INTERRUPTION_TRIGGER_TEXT_MAX_CHARACTERS,
  ),
  confidence: z
    .number()
    .min(PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE)
    .max(1),
});

const FinalBoundInterruptionFinalSchema = z.strictObject({
  revision: PositiveSafeIntegerSchema,
  text: normalizedTranscriptText(
    FINAL_BOUND_INTERRUPTION_FINAL_TEXT_MAX_CHARACTERS,
  ),
});

/**
 * Actorless browser-to-server request for one final-bound partial interrupt.
 * The protected server derives ownership, actors, detector context, accepted
 * ground, action IDs, and all model metadata from this exact owner-bound head.
 */
export const FinalBoundInterruptionRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(
      FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
    ),
    head: FinalBoundInterruptionTrialHeadSchema,
    utterance: FinalBoundInterruptionUtteranceSchema,
    trigger: FinalBoundInterruptionTriggerSchema,
    final: FinalBoundInterruptionFinalSchema,
  })
  .superRefine((request, context) => {
    if (request.final.revision < request.trigger.revision) {
      context.addIssue({
        code: "custom",
        path: ["final", "revision"],
        message:
          "The final transcript revision cannot precede its partial trigger",
      });
    }
  });

export const FinalBoundInterruptionRulingSchema = z.enum([
  "sustained",
  "overruled",
]);

export const FinalBoundInterruptionRemedySchema = z.enum([
  "rephrase",
  "cancel_response",
  "resume_response",
]);

export const FinalBoundInterruptionContinuationSchema = z.enum([
  "complete",
  "pending",
]);

export const FinalBoundInterruptionPerformanceSchema = z.strictObject({
  disposition: z.enum(["current", "historical"]),
  answerTurnId: CaseGraphEntityIdSchema.nullable(),
});

/**
 * Protected result after the durable objection/ruling transaction completes.
 * `replayed` identifies an exact idempotent retry; it never asks the browser to
 * invent a new request identity or to infer whether a write committed.
 */
export const FinalBoundInterruptionResponseSchema = z
  .strictObject({
    schemaVersion: z.literal(
      FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
    ),
    disposition: z.literal("ruling_committed"),
    interruptId: CaseGraphEntityIdSchema,
    ruling: FinalBoundInterruptionRulingSchema,
    remedy: FinalBoundInterruptionRemedySchema,
    replayed: z.boolean(),
    targetCompletionHead: FinalBoundInterruptionTrialHeadSchema,
    continuation: FinalBoundInterruptionContinuationSchema,
    performance: FinalBoundInterruptionPerformanceSchema,
    view: HearingRuntimeViewV1Schema,
  })
  .superRefine((response, context) => {
    const validPair =
      response.ruling === "overruled"
        ? response.remedy === "resume_response"
        : response.remedy === "rephrase" ||
          response.remedy === "cancel_response";
    if (!validPair) {
      context.addIssue({
        code: "custom",
        path: ["remedy"],
        message:
          "The remedy must be executable for the committed interruption ruling",
      });
    }

    const viewHead = response.view.trial;
    const targetHead = response.targetCompletionHead;
    if (viewHead.trialId !== targetHead.trialId) {
      context.addIssue({
        code: "custom",
        path: ["view", "trial", "trialId"],
        message:
          "The canonical view and target completion head must identify the same trial",
      });
    }

    const viewIsExactTarget =
      viewHead.version === targetHead.stateVersion &&
      viewHead.lastEventId === targetHead.lastEventId;
    const viewIsLaterThanTarget =
      viewHead.version > targetHead.stateVersion;
    if (!viewIsExactTarget && !viewIsLaterThanTarget) {
      context.addIssue({
        code: "custom",
        path: ["view", "trial"],
        message:
          "The canonical view must be at or after the exact target completion head",
      });
    }
    if (
      response.performance.disposition === "current" &&
      !viewIsExactTarget
    ) {
      context.addIssue({
        code: "custom",
        path: ["performance", "disposition"],
        message:
          "Current performance is allowed only at the exact target completion head",
      });
    }
    if (
      response.performance.disposition === "historical" &&
      !viewIsLaterThanTarget
    ) {
      context.addIssue({
        code: "custom",
        path: ["performance", "disposition"],
        message:
          "Historical performance requires a canonical view later than the target completion head",
      });
    }

    if (response.ruling === "sustained") {
      if (response.continuation !== "complete") {
        context.addIssue({
          code: "custom",
          path: ["continuation"],
          message: "A sustained interruption cannot leave a response pending",
        });
      }
      if (response.performance.answerTurnId !== null) {
        context.addIssue({
          code: "custom",
          path: ["performance", "answerTurnId"],
          message: "A sustained interruption cannot expose answer audio",
        });
      }
      return;
    }

    if (response.continuation === "pending") {
      if (response.performance.disposition !== "current") {
        context.addIssue({
          code: "custom",
          path: ["performance", "disposition"],
          message: "A pending resumed response must be current",
        });
      }
      if (response.performance.answerTurnId !== null) {
        context.addIssue({
          code: "custom",
          path: ["performance", "answerTurnId"],
          message: "A pending resumed response cannot expose answer audio",
        });
      }
      return;
    }

    if (response.performance.disposition === "historical") {
      if (response.performance.answerTurnId !== null) {
        context.addIssue({
          code: "custom",
          path: ["performance", "answerTurnId"],
          message: "Historical completion cannot replay answer audio",
        });
      }
      return;
    }

    const answerTurnId = response.performance.answerTurnId;
    const matchingAnswerTurns = response.view.transcript.filter(
      (turn) => turn.turnId === answerTurnId,
    );
    const exactAnswerTurn = matchingAnswerTurns[0];
    if (
      answerTurnId === null ||
      matchingAnswerTurns.length !== 1 ||
      response.view.transcript.at(-1)?.turnId !== answerTurnId ||
      exactAnswerTurn?.actor.role !== "witness" ||
      exactAnswerTurn?.status !== "active" ||
      exactAnswerTurn?.testimonyId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["performance", "answerTurnId"],
        message:
          "A current completed response must identify its exact final answer turn",
      });
    }
  });

export const FinalBoundInterruptionCandidateWithdrawnSchema = z.strictObject({
  schemaVersion: z.literal(FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION),
  disposition: z.literal("candidate_withdrawn"),
  withdrawalId: CaseGraphEntityIdSchema,
  head: FinalBoundInterruptionTrialHeadSchema,
});

export const FinalBoundInterruptionResolutionSchema = z.discriminatedUnion(
  "disposition",
  [
    FinalBoundInterruptionResponseSchema,
    FinalBoundInterruptionCandidateWithdrawnSchema,
  ],
);

export type FinalBoundInterruptionTrialHead = z.infer<
  typeof FinalBoundInterruptionTrialHeadSchema
>;
export type FinalBoundInterruptionRequest = z.infer<
  typeof FinalBoundInterruptionRequestSchema
>;
export type FinalBoundInterruptionRuling = z.infer<
  typeof FinalBoundInterruptionRulingSchema
>;
export type FinalBoundInterruptionRemedy = z.infer<
  typeof FinalBoundInterruptionRemedySchema
>;
export type FinalBoundInterruptionContinuation = z.infer<
  typeof FinalBoundInterruptionContinuationSchema
>;
export type FinalBoundInterruptionPerformance = z.infer<
  typeof FinalBoundInterruptionPerformanceSchema
>;
export type FinalBoundInterruptionResponse = z.infer<
  typeof FinalBoundInterruptionResponseSchema
>;
export type FinalBoundInterruptionCandidateWithdrawn = z.infer<
  typeof FinalBoundInterruptionCandidateWithdrawnSchema
>;
export type FinalBoundInterruptionResolution = z.infer<
  typeof FinalBoundInterruptionResolutionSchema
>;
