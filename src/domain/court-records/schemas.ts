import { z } from "zod";

import {
  DebriefGeneratorModelOutputSchema,
  CourtroomModelCallClassSchema,
  CourtroomModelCallStatusSchema,
  CourtroomModelCallTaskSchema,
  CourtroomModelSchema,
  CourtroomModelTokenUsageSchema,
} from "../courtroom-ai";
import {
  ActorRefSchema,
  CitationSetSchema,
  EvidenceStatusSchema,
  FactStatusSchema,
  ObjectionStateEntrySchema,
  TrialEventSchema,
  TrialEventTypeSchema,
  TrialPhaseSchema,
  TrialStateV3Schema,
  TrialStatusSchema,
} from "../trial-engine";
import { CaseGraphV1Schema } from "../case-graph";
import { CourtroomModelCallTraceSchema } from "../courtroom-ai/model-call-trace";
import { HearingAudioAuditRecordSchema } from "../../lib/speech/hearing-audio-audit";

export const COURT_RECORDS_INPUT_SCHEMA_VERSION =
  "court-records-projector-input.v1" as const;
export const COURT_RECORDS_VIEW_SCHEMA_VERSION =
  "court-records-view.v2" as const;
export const COURT_RECORDS_SUMMARY_SCHEMA_VERSION =
  "court-records-summary.v1" as const;
export const COURT_RECORDS_MAX_LIFECYCLE_TRANSITIONS = 20_000;
export const COURT_RECORDS_MAX_MODEL_CALL_ATTEMPTS = 4;

export const CourtRecordsIdentifierSchema = z.string().trim().min(1).max(256);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const DateTimeSchema = z.string().datetime({ offset: true });
const CountSchema = z.number().int().nonnegative();

export const CourtRecordsCitationKindSchema = z.enum([
  "admitted_fact",
  "unadmitted_fact",
  "excluded_fact",
  "hidden_fact",
  "admitted_evidence",
  "unadmitted_evidence",
  "excluded_evidence",
  "active_testimony",
  "stricken_testimony",
  "transcript_turn",
  "event",
  "source_segment",
  "prior_statement",
  "coaching_inference",
]);

export const CourtRecordsCitationResourceInputSchema = z
  .object({
    ownerId: CourtRecordsIdentifierSchema,
    trialId: CourtRecordsIdentifierSchema,
    resourceId: CourtRecordsIdentifierSchema,
    kind: CourtRecordsCitationKindSchema,
    scope: z.enum(["owner_record", "debrief_only"]),
  })
  .strict();

export const CourtRecordsCitationResourceSchema =
  CourtRecordsCitationResourceInputSchema.omit({
    ownerId: true,
    trialId: true,
  })
    .extend({
      title: z.string().trim().min(1).max(8_000),
      stratum: z.enum([
        "admitted_record",
        "unadmitted_record",
        "excluded_or_stricken",
        "hidden_authoring_truth",
        "procedural_record",
        "coaching_inference",
      ]),
      stratumLabel: z.string().trim().min(1).max(100),
    })
    .strict();

export const CourtRecordsModelCallRowInputSchema = z
  .object({
    ownerId: CourtRecordsIdentifierSchema,
    trace: CourtroomModelCallTraceSchema,
  })
  .strict();

export const CourtRecordsFinalDebriefArtifactInputSchema = z
  .object({
    artifactId: CourtRecordsIdentifierSchema,
    artifactKind: z.literal("final_debrief"),
    ownerId: CourtRecordsIdentifierSchema,
    trialId: CourtRecordsIdentifierSchema,
    callId: CourtRecordsIdentifierSchema,
    decisionId: z.null(),
    actionId: CourtRecordsIdentifierSchema,
    eventId: CourtRecordsIdentifierSchema,
    sourceStateVersion: z.number().int().positive(),
    sourceLastEventId: CourtRecordsIdentifierSchema,
    committedStateVersion: z.number().int().positive(),
    artifactJson: z.string().min(1).max(1_000_000),
    artifactHash: HashSchema,
    artifactSchemaVersion: CourtRecordsIdentifierSchema,
    promptVersion: CourtRecordsIdentifierSchema,
    model: z.literal("gpt-5.6-terra"),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const CourtRecordsAudioAuditInputSchema = z
  .object({
    ownerId: CourtRecordsIdentifierSchema,
    trialId: CourtRecordsIdentifierSchema,
    record: HearingAudioAuditRecordSchema,
  })
  .strict();

export const CourtRecordsProjectorInputSchema = z
  .object({
    schemaVersion: z.literal(COURT_RECORDS_INPUT_SCHEMA_VERSION),
    ownerId: CourtRecordsIdentifierSchema,
    caseGraph: CaseGraphV1Schema,
    trialState: TrialStateV3Schema,
    events: z.array(TrialEventSchema).min(1).max(20_000),
    modelCalls: z.array(CourtRecordsModelCallRowInputSchema).max(5_000),
    citationResources: z
      .array(CourtRecordsCitationResourceInputSchema)
      .max(10_000),
    finalDebriefArtifact: CourtRecordsFinalDebriefArtifactInputSchema.nullable(),
    audioAudits: z.array(CourtRecordsAudioAuditInputSchema).max(20_000),
  })
  .strict();

export const CourtRecordsTrialSummaryRowInputSchema = z
  .object({
    ownerId: CourtRecordsIdentifierSchema,
    trialId: CourtRecordsIdentifierSchema,
    caseId: CourtRecordsIdentifierSchema,
    caseTitle: z.string().trim().min(1).max(500),
    phase: TrialPhaseSchema,
    status: TrialStatusSchema,
    stateVersion: CountSchema,
    lastSequence: CountSchema,
    lastEventId: CourtRecordsIdentifierSchema,
    startedAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    transcriptTurnCount: CountSchema,
    modelCallCount: CountSchema,
    hasFinalDebrief: z.boolean(),
  })
  .strict();

export const CourtRecordsTrialSummarySchema =
  CourtRecordsTrialSummaryRowInputSchema.omit({ ownerId: true })
    .extend({ schemaVersion: z.literal(COURT_RECORDS_SUMMARY_SCHEMA_VERSION) })
    .strict();

export const CourtRecordsListResponseSchema = z
  .array(CourtRecordsTrialSummarySchema)
  .max(64);

export const CourtRecordsEventNodeSchema = z
  .object({
    eventId: CourtRecordsIdentifierSchema,
    sequence: z.number().int().positive(),
    stateVersion: z.number().int().positive(),
    type: TrialEventTypeSchema,
    actor: ActorRefSchema,
    source: z.enum(["user", "ai", "deterministic", "speech", "system"]),
    occurredAt: DateTimeSchema,
    parentEventId: CourtRecordsIdentifierSchema.nullable(),
    childEventIds: z.array(CourtRecordsIdentifierSchema),
    responseId: CourtRecordsIdentifierSchema.nullable(),
    interruptId: CourtRecordsIdentifierSchema.nullable(),
    citations: CitationSetSchema,
  })
  .strict();

export const CourtRecordsTranscriptTurnSchema = z
  .object({
    ordinal: z.number().int().positive(),
    turnId: CourtRecordsIdentifierSchema,
    actor: ActorRefSchema,
    text: z.string().trim().min(1).max(20_000),
    testimonyId: CourtRecordsIdentifierSchema.nullable(),
    status: z.enum(["active", "stricken"]),
    sourceEventId: CourtRecordsIdentifierSchema,
    citations: CitationSetSchema,
  })
  .strict();

const LifecycleTransitionSchema = z
  .object({
    eventId: CourtRecordsIdentifierSchema,
    sequence: z.number().int().positive(),
    status: z.string().trim().min(1).max(50),
  })
  .strict();

export const CourtRecordsFactLifecycleSchema = z
  .object({
    factId: CourtRecordsIdentifierSchema,
    title: z.string().trim().min(1).max(8_000),
    status: FactStatusSchema,
    visibility: z.enum(["public", "restricted"]),
    transitions: z
      .array(LifecycleTransitionSchema)
      .max(COURT_RECORDS_MAX_LIFECYCLE_TRANSITIONS),
  })
  .strict();

export const CourtRecordsEvidenceLifecycleSchema = z
  .object({
    evidenceId: CourtRecordsIdentifierSchema,
    title: z.string().trim().min(1).max(500),
    status: EvidenceStatusSchema,
    transitions: z
      .array(LifecycleTransitionSchema)
      .max(COURT_RECORDS_MAX_LIFECYCLE_TRANSITIONS),
  })
  .strict();

const CourtRecordsRulingReferenceShape = {
  rulingSequence: z.number().int().positive(),
  sourceEventId: CourtRecordsIdentifierSchema,
  rulingEventId: CourtRecordsIdentifierSchema,
} as const;

export const CourtRecordsRulingSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...CourtRecordsRulingReferenceShape,
        kind: z.literal("objection"),
        objectionId: CourtRecordsIdentifierSchema,
        questionId: CourtRecordsIdentifierSchema,
        interruptedResponseId: CourtRecordsIdentifierSchema.nullable(),
        disposition: z.enum(["sustained", "overruled"]),
        remedy: z.enum([
          "none",
          "rephrase",
          "cancel_response",
          "resume_response",
        ]),
        reason: z.string().trim().min(1).max(4_000),
      })
      .strict(),
    z
      .object({
        ...CourtRecordsRulingReferenceShape,
        kind: z.literal("evidence"),
        evidenceId: CourtRecordsIdentifierSchema,
        disposition: z.enum(["admitted", "excluded"]),
        reason: z.string().trim().min(1).max(4_000),
      })
      .strict(),
    z
      .object({
        ...CourtRecordsRulingReferenceShape,
        kind: z.literal("assertion"),
        factId: CourtRecordsIdentifierSchema,
        disposition: z.enum(["admitted", "excluded"]),
        reason: z.string().trim().min(1).max(4_000),
      })
      .strict(),
    z
      .object({
        ...CourtRecordsRulingReferenceShape,
        kind: z.literal("strike"),
        motionId: CourtRecordsIdentifierSchema,
        testimonyIds: z.array(CourtRecordsIdentifierSchema).min(1),
        disposition: z.enum(["granted", "denied"]),
        motionReason: z.string().trim().min(1).max(2_000),
        reason: z.string().trim().min(1).max(4_000).nullable(),
      })
      .strict(),
  ])
  .superRefine((ruling, context) => {
    if (ruling.sourceEventId === ruling.rulingEventId) {
      context.addIssue({
        code: "custom",
        path: ["rulingEventId"],
        message: "A ruling event must follow a distinct source event",
      });
    }
    if (ruling.kind === "objection") {
      const expectedOverruledRemedy =
        ruling.interruptedResponseId === null ? "none" : "resume_response";
      const sustainedRemedies =
        ruling.interruptedResponseId === null
          ? new Set(["rephrase"])
          : new Set(["rephrase", "cancel_response"]);
      if (
        (ruling.disposition === "overruled" &&
          ruling.remedy !== expectedOverruledRemedy) ||
        (ruling.disposition === "sustained" &&
          !sustainedRemedies.has(ruling.remedy))
      ) {
        context.addIssue({
          code: "custom",
          path: ["remedy"],
          message: "Objection remedy does not match its canonical disposition",
        });
      }
    }
    if (ruling.kind === "strike") {
      const seen = new Set<string>();
      ruling.testimonyIds.forEach((testimonyId, index) => {
        if (seen.has(testimonyId)) {
          context.addIssue({
            code: "custom",
            path: ["testimonyIds", index],
            message: "Strike ruling testimony IDs must be unique",
          });
        }
        seen.add(testimonyId);
      });
      if (ruling.disposition === "denied" && ruling.reason === null) {
        context.addIssue({
          code: "custom",
          path: ["reason"],
          message: "A denied strike ruling requires its judicial reason",
        });
      }
    }
  });

export const CourtRecordsRecoverySchema = z
  .object({
    failureEventId: CourtRecordsIdentifierSchema,
    failureSequence: z.number().int().positive(),
    failedAt: DateTimeSchema,
    status: z.enum(["awaiting_recovery", "recovered"]),
    retryable: z.boolean(),
    safeFailureCode: z.null(),
    failureCodeRedacted: z.literal(true),
    recoveryEventId: CourtRecordsIdentifierSchema.nullable(),
    recoverySequence: z.number().int().positive().nullable(),
    recoveredAt: DateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((recovery, context) => {
    const hasRecovery = recovery.recoveryEventId !== null;
    if (
      hasRecovery !== (recovery.recoverySequence !== null) ||
      hasRecovery !== (recovery.recoveredAt !== null) ||
      hasRecovery !== (recovery.status === "recovered")
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Recovery status and event metadata must be present together",
      });
    }
    if (
      recovery.recoverySequence !== null &&
      recovery.recoverySequence <= recovery.failureSequence
    ) {
      context.addIssue({
        code: "custom",
        path: ["recoverySequence"],
        message: "Recovery must occur after its failure",
      });
    }
  });

const ModelCallAttemptSchema = z
  .object({
    attempt: z.number().int().positive(),
    mode: z.enum(["initial", "repair"]),
    status: z.enum([
      "accepted",
      "validation_failed",
      "provider_failed",
      "cancelled",
      "stale",
    ]),
    latencyMs: z.number().nonnegative(),
    firstStructuredDeltaMs: z.number().nonnegative().nullable(),
    usage: CourtroomModelTokenUsageSchema.nullable(),
    validationIssueCodes: z.array(CourtRecordsIdentifierSchema),
    safeErrorCode: CourtRecordsIdentifierSchema.nullable(),
  })
  .strict();

export const CourtRecordsModelCallSchema = z
  .object({
    callId: CourtRecordsIdentifierSchema,
    actorId: CourtRecordsIdentifierSchema.nullable(),
    actorRole: z
      .enum(["witness", "counsel", "judge", "jury", "debrief", "system"])
      .nullable(),
    callClass: CourtroomModelCallClassSchema,
    task: CourtroomModelCallTaskSchema,
    status: CourtroomModelCallStatusSchema,
    fallback: z
      .object({
        policy: z.literal("validated_model_or_fail"),
        availability: z.literal("not_available"),
        used: z.literal(false),
        repairAttemptsAreFallbacks: z.literal(false),
      })
      .strict(),
    provider: CourtRecordsIdentifierSchema,
    providerProtocolVersion: CourtRecordsIdentifierSchema,
    model: CourtroomModelSchema,
    promptVersion: CourtRecordsIdentifierSchema,
    outputSchemaVersion: CourtRecordsIdentifierSchema,
    expectedStateVersion: CountSchema.nullable(),
    expectedLastEventId: CourtRecordsIdentifierSchema.nullable(),
    knowledgeScope: z
      .object({
        integrity: z.literal("verified"),
        schemaVersion: CourtRecordsIdentifierSchema.nullable(),
        stateVersion: CountSchema.nullable(),
        factCount: CountSchema,
        evidenceCount: CountSchema,
        testimonyCount: CountSchema,
        priorStatementCount: CountSchema,
        sourceSegmentCount: CountSchema,
        publicRecordEventCount: CountSchema,
        currentExchangeCount: CountSchema,
      })
      .strict(),
    startedAt: DateTimeSchema,
    completedAt: DateTimeSchema.nullable(),
    latencyMs: z.number().nonnegative().nullable(),
    retryCount: CountSchema,
    validationFailureCount: CountSchema,
    estimatedCostUsd: z.number().nonnegative().nullable(),
    usage: CourtroomModelTokenUsageSchema.nullable(),
    acceptedCitationCount: CountSchema,
    visibleCitationCount: CountSchema,
    restrictedCitationCount: CountSchema,
    acceptedCitations: CitationSetSchema.extend({
      priorStatementIds: z.array(CourtRecordsIdentifierSchema),
    }).strict(),
    safeFailureCode: CourtRecordsIdentifierSchema.nullable(),
    attempts: z
      .array(ModelCallAttemptSchema)
      .max(COURT_RECORDS_MAX_MODEL_CALL_ATTEMPTS),
  })
  .strict()
  .superRefine((call, context) => {
    const visibleCitationCount = Object.values(call.acceptedCitations).reduce(
      (total, identifiers) => total + identifiers.length,
      0,
    );
    if (call.visibleCitationCount !== visibleCitationCount) {
      context.addIssue({
        code: "custom",
        path: ["visibleCitationCount"],
        message: "Visible citation count must match accepted citation IDs",
      });
    }
    if (
      call.acceptedCitationCount !==
      call.visibleCitationCount + call.restrictedCitationCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCitationCount"],
        message: "Accepted citation count must equal visible plus restricted",
      });
    }
  });

export const CourtRecordsAudioAuditSchema = z
  .object({
    record: HearingAudioAuditRecordSchema,
    canonicalBinding: z
      .object({
        status: z.enum([
          "local_observation",
          "transcript_turn_verified",
          "interruption_verified",
        ]),
        turnId: CourtRecordsIdentifierSchema.nullable(),
        interruptId: z.string().trim().min(1).max(292).nullable(),
      })
      .strict(),
    rawAudioRetained: z.literal(false),
  })
  .strict();

export const CourtRecordsViewSchema = z
  .object({
    schemaVersion: z.literal(COURT_RECORDS_VIEW_SCHEMA_VERSION),
    summary: CourtRecordsTrialSummarySchema,
    eventTree: z
      .object({
        rootEventIds: z.array(CourtRecordsIdentifierSchema),
        nodes: z.array(CourtRecordsEventNodeSchema),
      })
      .strict(),
    transcript: z.array(CourtRecordsTranscriptTurnSchema),
    procedure: z
      .object({
        objections: z.array(ObjectionStateEntrySchema),
        rulings: z.array(CourtRecordsRulingSchema),
        recoveries: z.array(CourtRecordsRecoverySchema),
        interruptions: z.array(
          z
            .object({
              interruptId: CourtRecordsIdentifierSchema,
              interruptedResponseId: CourtRecordsIdentifierSchema,
              objectionId: CourtRecordsIdentifierSchema.nullable(),
              status: z.enum(["active", "cancelled", "resolved", "resumed"]),
              sourceEventId: CourtRecordsIdentifierSchema,
              lastEventId: CourtRecordsIdentifierSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    lifecycles: z
      .object({
        facts: z.array(CourtRecordsFactLifecycleSchema),
        evidence: z.array(CourtRecordsEvidenceLifecycleSchema),
      })
      .strict(),
    modelCalls: z.array(CourtRecordsModelCallSchema),
    finalDebrief: z
      .object({
        artifactId: CourtRecordsIdentifierSchema,
        eventId: CourtRecordsIdentifierSchema,
        createdAt: z.number().int().nonnegative(),
        model: z.literal("gpt-5.6-terra"),
        artifact: DebriefGeneratorModelOutputSchema,
        citationResources: z.array(CourtRecordsCitationResourceSchema),
      })
      .strict()
      .nullable(),
    citationResources: z.array(CourtRecordsCitationResourceSchema),
    audio: z
      .object({
        availability: z.enum(["metadata_available", "not_recorded"]),
        retentionPolicy: z.literal("metadata_only_raw_audio_not_stored"),
        entries: z.array(CourtRecordsAudioAuditSchema),
      })
      .strict(),
    replayIntegrity: z
      .object({
        status: z.literal("verified"),
        eventCount: z.number().int().positive(),
        firstSequence: z.literal(1),
        lastSequence: z.number().int().positive(),
        stateVersion: z.number().int().positive(),
        lastEventId: CourtRecordsIdentifierSchema,
        privacySafeProjectionHash: HashSchema,
      })
      .strict(),
  })
  .strict();

export type CourtRecordsProjectorInput = z.infer<
  typeof CourtRecordsProjectorInputSchema
>;
export type CourtRecordsTrialSummaryRowInput = z.infer<
  typeof CourtRecordsTrialSummaryRowInputSchema
>;
export type CourtRecordsRuling = z.infer<typeof CourtRecordsRulingSchema>;
export type CourtRecordsRecovery = z.infer<typeof CourtRecordsRecoverySchema>;

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type CourtRecordsView = DeepReadonly<
  z.infer<typeof CourtRecordsViewSchema>
>;
export type CourtRecordsTrialSummary = DeepReadonly<
  z.infer<typeof CourtRecordsTrialSummarySchema>
>;
export type CourtRecordsListResponse = DeepReadonly<
  z.infer<typeof CourtRecordsListResponseSchema>
>;
