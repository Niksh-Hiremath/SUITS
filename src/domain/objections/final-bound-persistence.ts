import { z } from "zod";

import { CaseGraphEntityIdSchema, sha256Utf8 } from "../case-graph";
import {
  OBJECTION_RULING_REQUEST_SCHEMA_VERSION,
  ObjectionRulingRequestSchema,
  WitnessAnswerRequestSchema,
} from "../courtroom-ai";
import {
  HearingCommandPreparationSchema,
  HearingRuntimeViewV1Schema,
  type HearingCommandPreparation,
} from "../hearing-runtime";
import { TrialPolicyObjectionGroundSchema } from "../trial-policy";
import {
  FinalBoundInterruptionRequestSchema,
  FinalBoundInterruptionRemedySchema,
  FinalBoundInterruptionRulingSchema,
  FinalBoundInterruptionTrialHeadSchema,
  type FinalBoundInterruptionRequest,
} from "./final-bound-contracts";
import {
  PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION,
  PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION,
} from "./partial-detector";

export const HEARING_FINAL_BOUND_INTERRUPTION_PREPARATION_SCHEMA_VERSION =
  "hearing-final-bound-interruption-preparation.v1" as const;
export const HEARING_FINAL_BOUND_INTERRUPTION_RECOVERY_SCHEMA_VERSION =
  "hearing-final-bound-interruption-recovery.v1" as const;
export const HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION =
  "hearing-final-bound-interruption-claim.v1" as const;

export type FinalBoundInterruptionPersistenceIds = Readonly<{
  questionActionId: string;
  requestResponseActionId: string;
  objectionActionId: string;
  beginInterruptionActionId: string;
  questionId: string;
  responseId: string;
  objectionId: string;
  interruptId: string;
  questionTurnId: string;
  withdrawalId: string;
}>;

/**
 * Content-addressed durable identities for one exact final-bound request. The
 * browser supplies none of these IDs, and changes to either transcript or its
 * revision produce a different identity. Detector contract versions are part
 * of the material so a future detector cannot replay an older legal trigger.
 */
export function deriveFinalBoundInterruptionPersistenceIds(
  requestInput: FinalBoundInterruptionRequest,
): FinalBoundInterruptionPersistenceIds {
  const request = FinalBoundInterruptionRequestSchema.parse(requestInput);
  const digest = sha256Utf8(
    JSON.stringify({
      request,
      detectorSchemaVersion: PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION,
      candidateSchemaVersion: PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION,
    }),
  );
  return Object.freeze({
    questionActionId: `action:final-bound-question:${digest}`,
    requestResponseActionId: `action:final-bound-response:${digest}`,
    objectionActionId: `action:final-bound-objection:${digest}`,
    beginInterruptionActionId: `action:final-bound-interruption:${digest}`,
    questionId: `question:final-bound:${digest}`,
    responseId: `response:final-bound:${digest}`,
    objectionId: `objection:final-bound:${digest}`,
    interruptId: `interrupt:final-bound:${digest}`,
    questionTurnId: `turn:final-bound-question:${digest}`,
    withdrawalId: `withdrawal:final-bound:${digest}`,
  });
}

const PositiveSafeIntegerSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);

export const HearingFinalBoundInterruptionMetadataSchema = z
  .strictObject({
    interruptId: CaseGraphEntityIdSchema,
    objectionId: CaseGraphEntityIdSchema,
    questionId: CaseGraphEntityIdSchema,
    responseId: CaseGraphEntityIdSchema,
    questionEventId: CaseGraphEntityIdSchema,
    objectionEventId: CaseGraphEntityIdSchema,
    interruptionEventId: CaseGraphEntityIdSchema,
    ground: TrialPolicyObjectionGroundSchema,
    triggerRevision: PositiveSafeIntegerSchema,
    finalRevision: PositiveSafeIntegerSchema,
    sourceHead: FinalBoundInterruptionTrialHeadSchema,
    committedHead: FinalBoundInterruptionTrialHeadSchema,
    prefixReplayed: z.boolean(),
  })
  .superRefine((metadata, context) => {
    if (
      metadata.sourceHead.trialId !== metadata.committedHead.trialId ||
      metadata.committedHead.stateVersion !==
        metadata.sourceHead.stateVersion + 4 ||
      metadata.committedHead.lastEventId !== metadata.interruptionEventId
    ) {
      context.addIssue({
        code: "custom",
        path: ["committedHead"],
        message:
          "Committed interruption metadata must identify the exact four-event successor head",
      });
    }
    if (metadata.finalRevision < metadata.triggerRevision) {
      context.addIssue({
        code: "custom",
        path: ["finalRevision"],
        message: "The final revision cannot precede the trigger revision",
      });
    }
  });

export const HearingFinalBoundInterruptionRecoveryMetadataSchema = z
  .strictObject({
    interruptId: CaseGraphEntityIdSchema,
    objectionId: CaseGraphEntityIdSchema,
    questionId: CaseGraphEntityIdSchema,
    responseId: CaseGraphEntityIdSchema,
    questionEventId: CaseGraphEntityIdSchema,
    objectionEventId: CaseGraphEntityIdSchema,
    interruptionEventId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    ground: TrialPolicyObjectionGroundSchema,
    sourceHead: FinalBoundInterruptionTrialHeadSchema,
    committedHead: FinalBoundInterruptionTrialHeadSchema,
    answerTurnId: CaseGraphEntityIdSchema.nullable(),
    targetCompletionHead: FinalBoundInterruptionTrialHeadSchema,
  })
  .superRefine((metadata, context) => {
    if (
      metadata.sourceHead.trialId !== metadata.committedHead.trialId ||
      metadata.committedHead.stateVersion !==
        metadata.sourceHead.stateVersion + 4 ||
      metadata.committedHead.lastEventId !== metadata.interruptionEventId ||
      metadata.targetCompletionHead.trialId !== metadata.sourceHead.trialId ||
      metadata.targetCompletionHead.stateVersion <
        metadata.committedHead.stateVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["committedHead"],
        message:
          "Recovered interruption metadata must identify the exact four-event successor head",
      });
    }
  });

const HearingFinalBoundInterruptionScopeMetadataSchema = z.object({
  interruptId: CaseGraphEntityIdSchema,
  objectionId: CaseGraphEntityIdSchema,
  questionId: CaseGraphEntityIdSchema,
  responseId: CaseGraphEntityIdSchema,
  questionEventId: CaseGraphEntityIdSchema,
  objectionEventId: CaseGraphEntityIdSchema,
  interruptionEventId: CaseGraphEntityIdSchema,
  sourceHead: FinalBoundInterruptionTrialHeadSchema,
  committedHead: FinalBoundInterruptionTrialHeadSchema,
});

export const HearingFinalBoundInterruptionOutcomeSchema = z
  .strictObject({
    ruling: FinalBoundInterruptionRulingSchema,
    remedy: FinalBoundInterruptionRemedySchema,
  })
  .superRefine((outcome, context) => {
    const executable =
      outcome.ruling === "overruled"
        ? outcome.remedy === "resume_response"
        : outcome.remedy === "rephrase" ||
          outcome.remedy === "cancel_response";
    if (!executable) {
      context.addIssue({
        code: "custom",
        path: ["remedy"],
        message: "The ruling and remedy must form an executable pair",
      });
    }
  });

const preparationBase = {
  schemaVersion: z.literal(
    HEARING_FINAL_BOUND_INTERRUPTION_PREPARATION_SCHEMA_VERSION,
  ),
  interrupt: HearingFinalBoundInterruptionMetadataSchema,
  preparation: HearingCommandPreparationSchema,
};

const RulingRequiredPreparationSchema = z
  .strictObject({
    ...preparationBase,
    phase: z.literal("ruling_required"),
    outcome: z.null(),
    outcomeReplayed: z.literal(false),
  })
  .superRefine((result, context) => {
    if (result.preparation.status !== "model_required") {
      context.addIssue({
        code: "custom",
        path: ["preparation", "status"],
        message: "A pending interruption must require the Luna ruling model",
      });
      return;
    }
    const parsed = ObjectionRulingRequestSchema.safeParse(
      result.preparation.request,
    );
    if (
      !parsed.success ||
      parsed.data.schemaVersion !== OBJECTION_RULING_REQUEST_SCHEMA_VERSION
    ) {
      context.addIssue({
        code: "custom",
        path: ["preparation", "request"],
        message: "A pending interruption must carry an objection ruling request",
      });
      return;
    }
    const request = parsed.data;
    const metadata = result.interrupt;
    if (
      request.trialId !== metadata.sourceHead.trialId ||
      request.expectedStateVersion !== metadata.committedHead.stateVersion ||
      request.expectedLastEventId !== metadata.committedHead.lastEventId ||
      request.objection.objectionId !== metadata.objectionId ||
      request.objection.sourceEventId !== metadata.objectionEventId ||
      request.objection.questionId !== metadata.questionId ||
      request.objection.ground !== metadata.ground ||
      request.objection.interruptedResponseId !== metadata.responseId ||
      request.question.questionId !== metadata.questionId ||
      request.question.eventId !== metadata.questionEventId ||
      request.interruption?.interruptId !== metadata.interruptId ||
      request.interruption?.interruptedResponseId !== metadata.responseId ||
      request.interruption?.sourceEventId !== metadata.interruptionEventId
    ) {
      context.addIssue({
        code: "custom",
        path: ["preparation", "request"],
        message:
          "The ruling request must bind the exact canonical interruption metadata",
      });
    }
  });

const RulingCommittedPreparationSchema = z.strictObject({
  ...preparationBase,
  phase: z.literal("ruling_committed"),
  outcome: HearingFinalBoundInterruptionOutcomeSchema,
  outcomeReplayed: z.literal(true),
});

const CandidateWithdrawnPreparationSchema = z
  .strictObject({
    schemaVersion: z.literal(
      HEARING_FINAL_BOUND_INTERRUPTION_PREPARATION_SCHEMA_VERSION,
    ),
    phase: z.literal("candidate_withdrawn"),
    reason: z.literal("final_transcript_withdrew_candidate"),
    withdrawalId: CaseGraphEntityIdSchema,
    sourceHead: FinalBoundInterruptionTrialHeadSchema,
    triggerRevision: PositiveSafeIntegerSchema,
    finalRevision: PositiveSafeIntegerSchema,
    interrupt: z.null(),
    preparation: HearingCommandPreparationSchema,
    outcome: z.null(),
    outcomeReplayed: z.literal(false),
  })
  .superRefine((result, context) => {
    if (
      result.preparation.status !== "completed" ||
      result.preparation.view.trial.trialId !== result.sourceHead.trialId ||
      result.preparation.view.trial.version !== result.sourceHead.stateVersion ||
      result.preparation.view.trial.lastEventId !== result.sourceHead.lastEventId
    ) {
      context.addIssue({
        code: "custom",
        path: ["preparation"],
        message:
          "A withdrawn candidate must prove the unchanged canonical source head",
      });
    }
    if (result.finalRevision < result.triggerRevision) {
      context.addIssue({
        code: "custom",
        path: ["finalRevision"],
        message: "The final revision cannot precede the trigger revision",
      });
    }
  });

/**
 * Strict server-only result for the protected preparation endpoint. The first
 * branch enters the existing Luna ruling loop. An exact retry after a ruling
 * carries the durable outcome plus whatever canonical continuation is now
 * required (which may itself be another model request).
 */
export const HearingFinalBoundInterruptionPreparationSchema =
  z.discriminatedUnion("phase", [
    CandidateWithdrawnPreparationSchema,
    RulingRequiredPreparationSchema,
    RulingCommittedPreparationSchema,
  ]);

const recoveryBase = {
  schemaVersion: z.literal(
    HEARING_FINAL_BOUND_INTERRUPTION_RECOVERY_SCHEMA_VERSION,
  ),
  interrupt: HearingFinalBoundInterruptionRecoveryMetadataSchema,
  preparation: HearingCommandPreparationSchema,
  view: HearingRuntimeViewV1Schema,
  continuation: z.enum(["pending", "complete"]),
};

export const HearingFinalBoundInterruptionRecoveryPreparationSchema =
  z.discriminatedUnion("phase", [
    z.strictObject({
      ...recoveryBase,
      phase: z.literal("ruling_required"),
      outcome: z.null(),
    }),
    z.strictObject({
      ...recoveryBase,
      phase: z.literal("ruling_committed"),
      outcome: HearingFinalBoundInterruptionOutcomeSchema,
    }),
  ]).superRefine((result, context) => {
    const headMatches =
      result.preparation.status === "completed"
        ? result.preparation.view.trial.trialId === result.view.trial.trialId &&
          result.preparation.view.trial.version === result.view.trial.version &&
          result.preparation.view.trial.lastEventId ===
            result.view.trial.lastEventId
        : result.preparation.request.trialId === result.view.trial.trialId &&
          result.preparation.request.expectedStateVersion ===
            result.view.trial.version &&
          result.preparation.request.expectedLastEventId ===
            result.view.trial.lastEventId;
    if (!headMatches) {
      context.addIssue({
        code: "custom",
        path: ["view"],
        message:
          "Recovery preparation and redacted view must bind one canonical head",
      });
    }
    if (
      (result.preparation.status === "completed") !==
      (result.continuation === "complete")
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation"],
        message: "Recovery continuation must match the scoped preparation",
      });
    }
    if (
      result.outcome?.ruling === "sustained" &&
      result.continuation !== "complete"
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation"],
        message: "A sustained interruption cannot leave speech pending",
      });
    }
  });

const LeaseGenerationSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
const LeaseTimestampSchema = z.number().int().nonnegative();
const LeaseTokenSchema = z
  .string()
  .regex(/^lease_[0-9a-f]{64}_[0-9a-f-]{36}$/u);

export const HearingFinalBoundInterruptionLeaseCredentialSchema =
  z.strictObject({
    decisionId: CaseGraphEntityIdSchema,
    interruptId: CaseGraphEntityIdSchema,
    leaseGeneration: LeaseGenerationSchema,
    leaseToken: LeaseTokenSchema,
  });

export const HearingFinalBoundInterruptionClaimResultSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      schemaVersion: z.literal(
        HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
      ),
      status: z.literal("claimed"),
      decisionId: CaseGraphEntityIdSchema,
      interruptId: CaseGraphEntityIdSchema,
      leaseGeneration: LeaseGenerationSchema,
      leaseToken: LeaseTokenSchema,
      leaseExpiresAt: LeaseTimestampSchema,
      recovery: HearingFinalBoundInterruptionRecoveryPreparationSchema,
    }),
    z.strictObject({
      schemaVersion: z.literal(
        HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
      ),
      status: z.literal("wait"),
      decisionId: CaseGraphEntityIdSchema,
      interruptId: CaseGraphEntityIdSchema,
      leaseGeneration: LeaseGenerationSchema,
      retryAfterMs: z.number().int().min(100).max(5_000),
    }),
    z.strictObject({
      schemaVersion: z.literal(
        HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
      ),
      status: z.literal("outcome"),
      interruptId: CaseGraphEntityIdSchema,
      recovery: HearingFinalBoundInterruptionRecoveryPreparationSchema,
    }),
  ]);

export const HearingFinalBoundInterruptionLeaseUpdateResultSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("renewed"),
      leaseExpiresAt: LeaseTimestampSchema,
    }),
    z.strictObject({ status: z.literal("released") }),
    z.strictObject({
      status: z.literal("outcome"),
      recovery: HearingFinalBoundInterruptionRecoveryPreparationSchema,
    }),
  ]);

/**
 * Constrain every model-loop step to this interruption. A generic canonical
 * continuation may point at a newer objection, negotiation, or actor decision;
 * none of those may be executed while servicing an exact retry of an older
 * final-bound request.
 */
export function assertFinalBoundInterruptionScopedPreparation(
  preparationInput: unknown,
  metadataInput: HearingFinalBoundInterruptionScopeMetadata,
  outcomeInput: HearingFinalBoundInterruptionOutcome | null,
): HearingCommandPreparation {
  const preparation = HearingCommandPreparationSchema.parse(preparationInput);
  const metadata = HearingFinalBoundInterruptionScopeMetadataSchema.parse(
    metadataInput,
  );
  const outcome =
    outcomeInput === null
      ? null
      : HearingFinalBoundInterruptionOutcomeSchema.parse(outcomeInput);

  if (preparation.status === "completed") {
    if (outcome === null) {
      throw new Error("FINAL_BOUND_INTERRUPTION_PREPARATION_MISMATCH");
    }
    return preparation;
  }

  if (outcome === null) {
    const parsed = ObjectionRulingRequestSchema.safeParse(preparation.request);
    if (
      !parsed.success ||
      parsed.data.objection.objectionId !== metadata.objectionId ||
      parsed.data.objection.sourceEventId !== metadata.objectionEventId ||
      parsed.data.objection.questionId !== metadata.questionId ||
      parsed.data.objection.interruptedResponseId !== metadata.responseId ||
      parsed.data.question.questionId !== metadata.questionId ||
      parsed.data.question.eventId !== metadata.questionEventId ||
      parsed.data.interruption?.interruptId !== metadata.interruptId ||
      parsed.data.interruption?.interruptedResponseId !== metadata.responseId ||
      parsed.data.interruption?.sourceEventId !==
        metadata.interruptionEventId ||
      parsed.data.expectedStateVersion !== metadata.committedHead.stateVersion ||
      parsed.data.expectedLastEventId !== metadata.committedHead.lastEventId
    ) {
      throw new Error("FINAL_BOUND_INTERRUPTION_PREPARATION_MISMATCH");
    }
    return preparation;
  }

  if (outcome.ruling !== "overruled") {
    throw new Error("FINAL_BOUND_INTERRUPTION_PREPARATION_MISMATCH");
  }
  const parsed = WitnessAnswerRequestSchema.safeParse(preparation.request);
  if (
    !parsed.success ||
    parsed.data.responseId !== metadata.responseId ||
    parsed.data.question.questionId !== metadata.questionId ||
    parsed.data.question.eventId !== metadata.questionEventId
  ) {
    throw new Error("FINAL_BOUND_INTERRUPTION_PREPARATION_MISMATCH");
  }
  return preparation;
}

export function assertFinalBoundInterruptionRecoveryPreparation(
  preparationInput: unknown,
): HearingFinalBoundInterruptionRecoveryPreparation {
  const preparation =
    HearingFinalBoundInterruptionRecoveryPreparationSchema.parse(
      preparationInput,
    );
  assertFinalBoundInterruptionScopedPreparation(
    preparation.preparation,
    preparation.interrupt,
    preparation.outcome,
  );
  return preparation;
}

/**
 * Rebind a Convex preparation to the exact browser request before any model
 * call. This closes the confused-deputy case where two individually valid
 * requests share a trial head but carry different transcript revisions/text.
 */
export function assertFinalBoundInterruptionPreparationMatchesRequest(
  preparationInput: unknown,
  requestInput: FinalBoundInterruptionRequest,
): HearingFinalBoundInterruptionPreparation {
  const preparation = HearingFinalBoundInterruptionPreparationSchema.parse(
    preparationInput,
  );
  const request = FinalBoundInterruptionRequestSchema.parse(requestInput);
  if (preparation.phase === "candidate_withdrawn") {
    const ids = deriveFinalBoundInterruptionPersistenceIds(request);
    if (
      preparation.sourceHead.trialId !== request.head.trialId ||
      preparation.sourceHead.stateVersion !== request.head.stateVersion ||
      preparation.sourceHead.lastEventId !== request.head.lastEventId ||
      preparation.triggerRevision !== request.trigger.revision ||
      preparation.finalRevision !== request.final.revision ||
      preparation.withdrawalId !== ids.withdrawalId
    ) {
      throw new Error("FINAL_BOUND_INTERRUPTION_PREPARATION_MISMATCH");
    }
    return preparation;
  }
  const ids = deriveFinalBoundInterruptionPersistenceIds(request);
  const expectedQuestionEventId = `event:${ids.questionActionId}`;
  const expectedObjectionEventId = `event:${ids.objectionActionId}`;
  const expectedInterruptionEventId = `event:${ids.beginInterruptionActionId}`;
  const metadata = preparation.interrupt;
  if (
    metadata.sourceHead.trialId !== request.head.trialId ||
    metadata.sourceHead.stateVersion !== request.head.stateVersion ||
    metadata.sourceHead.lastEventId !== request.head.lastEventId ||
    metadata.triggerRevision !== request.trigger.revision ||
    metadata.finalRevision !== request.final.revision ||
    metadata.questionId !== ids.questionId ||
    metadata.responseId !== ids.responseId ||
    metadata.objectionId !== ids.objectionId ||
    metadata.interruptId !== ids.interruptId ||
    metadata.questionEventId !== expectedQuestionEventId ||
    metadata.objectionEventId !== expectedObjectionEventId ||
    metadata.interruptionEventId !== expectedInterruptionEventId ||
    metadata.committedHead.trialId !== request.head.trialId ||
    metadata.committedHead.stateVersion !== request.head.stateVersion + 4 ||
    metadata.committedHead.lastEventId !== expectedInterruptionEventId
  ) {
    throw new Error("FINAL_BOUND_INTERRUPTION_PREPARATION_MISMATCH");
  }
  assertFinalBoundInterruptionScopedPreparation(
    preparation.preparation,
    metadata,
    preparation.outcome,
  );
  return preparation;
}

export type HearingFinalBoundInterruptionMetadata = z.infer<
  typeof HearingFinalBoundInterruptionMetadataSchema
>;
export type HearingFinalBoundInterruptionRecoveryMetadata = z.infer<
  typeof HearingFinalBoundInterruptionRecoveryMetadataSchema
>;
export type HearingFinalBoundInterruptionScopeMetadata = z.infer<
  typeof HearingFinalBoundInterruptionScopeMetadataSchema
>;
export type HearingFinalBoundInterruptionOutcome = z.infer<
  typeof HearingFinalBoundInterruptionOutcomeSchema
>;
export type HearingFinalBoundInterruptionPreparation = z.infer<
  typeof HearingFinalBoundInterruptionPreparationSchema
>;
export type HearingFinalBoundInterruptionRecoveryPreparation = z.infer<
  typeof HearingFinalBoundInterruptionRecoveryPreparationSchema
>;
export type HearingFinalBoundInterruptionLeaseCredential = z.infer<
  typeof HearingFinalBoundInterruptionLeaseCredentialSchema
>;
export type HearingFinalBoundInterruptionClaimResult = z.infer<
  typeof HearingFinalBoundInterruptionClaimResultSchema
>;
export type HearingFinalBoundInterruptionLeaseUpdateResult = z.infer<
  typeof HearingFinalBoundInterruptionLeaseUpdateResultSchema
>;
