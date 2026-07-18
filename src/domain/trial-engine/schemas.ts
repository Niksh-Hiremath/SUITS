import { z } from "zod";
import { TrialPolicySnapshotSchema } from "../trial-policy/schema";

export const TRIAL_ACTION_SCHEMA_VERSION_V1 = "trial-action.v1" as const;
export const TRIAL_ACTION_SCHEMA_VERSION_V2 = "trial-action.v2" as const;
export const TRIAL_EVENT_SCHEMA_VERSION_V1 = "trial-event.v1" as const;
export const TRIAL_EVENT_SCHEMA_VERSION_V2 = "trial-event.v2" as const;
export const TRIAL_STATE_SCHEMA_VERSION_V1 = "trial-state.v1" as const;
export const TRIAL_STATE_SCHEMA_VERSION_V2 = "trial-state.v2" as const;

export const TRIAL_ACTION_SCHEMA_VERSION = TRIAL_ACTION_SCHEMA_VERSION_V2;
export const TRIAL_EVENT_SCHEMA_VERSION = TRIAL_EVENT_SCHEMA_VERSION_V2;
export const TRIAL_STATE_SCHEMA_VERSION = TRIAL_STATE_SCHEMA_VERSION_V2;

const IdentifierSchema = z.string().trim().min(1).max(256);
const DateTimeSchema = z.string().datetime({ offset: true });

export const TrialSideSchema = z.enum(["user", "opposing", "neutral"]);
export type TrialSide = z.infer<typeof TrialSideSchema>;

export const TrialPhaseSchema = z.enum([
  "pretrial",
  "opening",
  "case_in_chief",
  "recess",
  "pre_closing",
  "closing",
  "jury_instructions",
  "deliberation",
  "verdict",
  "debrief",
  "complete",
]);
export type TrialPhase = z.infer<typeof TrialPhaseSchema>;

export const TrialStatusSchema = z.enum([
  "pending",
  "active",
  "paused",
  "settled",
  "complete",
  "failed",
]);
export type TrialStatus = z.infer<typeof TrialStatusSchema>;

export const FactStatusSchema = z.enum([
  "hidden",
  "proposed",
  "disputed",
  "verified",
  "admitted",
  "excluded",
  "stricken",
]);
export type FactStatus = z.infer<typeof FactStatusSchema>;

export const EvidenceStatusSchema = z.enum([
  "uploaded",
  "indexed",
  "offered",
  "admitted",
  "excluded",
  "withdrawn",
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const TestimonyStatusSchema = z.enum(["active", "stricken"]);
export type TestimonyStatus = z.infer<typeof TestimonyStatusSchema>;

export const SettlementOfferStatusSchema = z.enum([
  "open",
  "countered",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
]);
export type SettlementOfferStatus = z.infer<typeof SettlementOfferStatusSchema>;

export const ActorRoleSchema = z.enum([
  "user_counsel",
  "opposing_counsel",
  "judge",
  "witness",
  "clerk",
  "jury",
  "system",
  "debrief_coach",
]);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

export const ActorRefSchema = z
  .object({
    actorId: IdentifierSchema,
    role: ActorRoleSchema,
    side: TrialSideSchema,
    witnessId: IdentifierSchema.nullable(),
  })
  .strict();
export type ActorRef = z.infer<typeof ActorRefSchema>;

export const EventSourceSchema = z.enum([
  "user",
  "ai",
  "deterministic",
  "speech",
  "system",
]);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const CitationSetSchema = z
  .object({
    factIds: z.array(IdentifierSchema),
    evidenceIds: z.array(IdentifierSchema),
    testimonyIds: z.array(IdentifierSchema),
    eventIds: z.array(IdentifierSchema),
    sourceSegmentIds: z.array(IdentifierSchema),
  })
  .strict();
export type CitationSet = z.infer<typeof CitationSetSchema>;

export const EMPTY_CITATIONS: CitationSet = Object.freeze({
  factIds: [],
  evidenceIds: [],
  testimonyIds: [],
  eventIds: [],
  sourceSegmentIds: [],
});

export const ModelMetadataSchema = z
  .object({
    model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
    requestId: IdentifierSchema.nullable(),
    promptVersion: IdentifierSchema,
    schemaVersion: IdentifierSchema,
    latencyMs: z.number().int().nonnegative().nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
    retryCount: z.number().int().nonnegative(),
    validationFailureCount: z.number().int().nonnegative(),
  })
  .strict();
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

export const FactStateEntrySchema = z
  .object({
    factId: IdentifierSchema,
    proposition: z.string().trim().min(1).max(8_000),
    status: FactStatusSchema,
    visibility: z.enum(["public", "restricted"]),
    provenanceIds: z.array(IdentifierSchema),
    sourceEventId: IdentifierSchema.nullable(),
    lastEventId: IdentifierSchema,
  })
  .strict();
export type FactStateEntry = z.infer<typeof FactStateEntrySchema>;

export const EvidenceStateEntrySchema = z
  .object({
    evidenceId: IdentifierSchema,
    name: z.string().trim().min(1).max(500),
    status: EvidenceStatusSchema,
    offeredBySide: TrialSideSchema.nullable(),
    rulingEventId: IdentifierSchema.nullable(),
    lastEventId: IdentifierSchema,
  })
  .strict();
export type EvidenceStateEntry = z.infer<typeof EvidenceStateEntrySchema>;

export const WitnessStateEntrySchema = z
  .object({
    witnessId: IdentifierSchema,
    status: z.enum(["available", "called", "sworn", "testifying", "released"]),
    calledBySide: TrialSideSchema.nullable(),
    examinationKind: z.enum(["direct", "cross", "redirect", "recross"]).nullable(),
    lastEventId: IdentifierSchema,
  })
  .strict();
export type WitnessStateEntry = z.infer<typeof WitnessStateEntrySchema>;

export const TestimonyStateEntrySchema = z
  .object({
    testimonyId: IdentifierSchema,
    turnId: IdentifierSchema,
    witnessId: IdentifierSchema,
    questionId: IdentifierSchema,
    text: z.string().trim().min(1).max(20_000),
    status: TestimonyStatusSchema,
    factIds: z.array(IdentifierSchema),
    evidenceIds: z.array(IdentifierSchema),
    sourceEventId: IdentifierSchema,
    lastEventId: IdentifierSchema,
  })
  .strict();
export type TestimonyStateEntry = z.infer<typeof TestimonyStateEntrySchema>;

export const SettlementTermsSchema = z
  .object({
    amount: z.number().nonnegative().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    nonMonetaryTerms: z.array(z.string().trim().min(1).max(1_000)),
    summary: z.string().trim().min(1).max(4_000),
  })
  .strict();
export type SettlementTerms = z.infer<typeof SettlementTermsSchema>;

export const SettlementOfferStateEntrySchema = z
  .object({
    offerId: IdentifierSchema,
    parentOfferId: IdentifierSchema.nullable(),
    proposedBySide: TrialSideSchema,
    visibleToSides: z.array(TrialSideSchema).min(1),
    terms: SettlementTermsSchema,
    status: SettlementOfferStatusSchema,
    expiresAtSequence: z.number().int().positive(),
    sourceEventId: IdentifierSchema,
    lastEventId: IdentifierSchema,
  })
  .strict();
export type SettlementOfferStateEntry = z.infer<typeof SettlementOfferStateEntrySchema>;

export const ObjectionStateEntrySchema = z
  .object({
    objectionId: IdentifierSchema,
    questionId: IdentifierSchema,
    objectorActorId: IdentifierSchema,
    ground: z.enum([
      "relevance",
      "hearsay",
      "leading",
      "speculation",
      "foundation",
      "asked_and_answered",
      "argumentative",
      "compound",
      "privilege",
    ]),
    status: z.enum(["pending", "sustained", "overruled", "withdrawn"]),
    remedy: z.enum(["none", "rephrase", "strike", "cancel_response", "resume_response"]).nullable(),
    rulingReason: z.string().trim().min(1).max(4_000).nullable(),
    sourceEventId: IdentifierSchema,
    rulingEventId: IdentifierSchema.nullable(),
  })
  .strict();
export type ObjectionStateEntry = z.infer<typeof ObjectionStateEntrySchema>;

export const PendingResponseStateEntrySchema = z
  .object({
    responseId: IdentifierSchema,
    actorId: IdentifierSchema,
    requestEventId: IdentifierSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    status: z.enum(["pending", "streaming", "cancelled", "committed"]),
    interruptId: IdentifierSchema.nullable(),
    lastEventId: IdentifierSchema,
  })
  .strict();
export type PendingResponseStateEntry = z.infer<typeof PendingResponseStateEntrySchema>;

export const InterruptionStateSchema = z
  .object({
    interruptId: IdentifierSchema,
    interruptedResponseId: IdentifierSchema,
    objectionId: IdentifierSchema.nullable(),
    status: z.enum(["active", "cancelled", "resolved", "resumed"]),
    sourceEventId: IdentifierSchema,
    lastEventId: IdentifierSchema,
  })
  .strict();
export type InterruptionState = z.infer<typeof InterruptionStateSchema>;

export const FailureStateSchema = z
  .object({
    stepId: IdentifierSchema,
    code: IdentifierSchema,
    userMessage: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
    sourceEventId: IdentifierSchema,
  })
  .strict();
export type FailureState = z.infer<typeof FailureStateSchema>;

export const TranscriptTurnSchema = z
  .object({
    turnId: IdentifierSchema,
    actor: ActorRefSchema,
    text: z.string().trim().min(1).max(20_000),
    testimonyId: IdentifierSchema.nullable(),
    citations: CitationSetSchema,
    status: z.enum(["active", "stricken"]),
    sourceEventId: IdentifierSchema,
  })
  .strict();
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

const InitialFactSchema = FactStateEntrySchema.omit({ sourceEventId: true, lastEventId: true });
const InitialEvidenceSchema = EvidenceStateEntrySchema.omit({
  offeredBySide: true,
  rulingEventId: true,
  lastEventId: true,
});

const startTrialPayloadV1Shape = {
  caseId: IdentifierSchema,
  caseVersion: z.number().int().positive(),
  caseGraphHash: IdentifierSchema,
  actors: z.array(ActorRefSchema).min(4),
  witnessIds: z.array(IdentifierSchema).min(1),
  initialFacts: z.array(InitialFactSchema),
  initialEvidence: z.array(InitialEvidenceSchema),
  userSide: z.enum(["user", "opposing"]),
};

export const StartTrialPayloadV1Schema = z
  .object(startTrialPayloadV1Shape)
  .strict();
export const StartTrialPayloadV2Schema = z
  .object({
    ...startTrialPayloadV1Shape,
    policySnapshot: TrialPolicySnapshotSchema,
  })
  .strict();
const BeginPhasePayloadSchema = z.object({ phase: TrialPhaseSchema }).strict();
const WitnessPayloadSchema = z.object({ witnessId: IdentifierSchema }).strict();
const CallWitnessPayloadSchema = z
  .object({ witnessId: IdentifierSchema, calledBySide: z.enum(["user", "opposing"]) })
  .strict();
const AskQuestionPayloadSchema = z
  .object({
    questionId: IdentifierSchema,
    witnessId: IdentifierSchema,
    examinationKind: z.enum(["direct", "cross", "redirect", "recross"]),
    text: z.string().trim().min(1).max(8_000),
    turnId: IdentifierSchema,
  })
  .strict();
const AnswerQuestionPayloadSchema = z
  .object({
    responseId: IdentifierSchema,
    questionId: IdentifierSchema,
    witnessId: IdentifierSchema,
    testimonyId: IdentifierSchema,
    turnId: IdentifierSchema,
    text: z.string().trim().min(1).max(20_000),
    factIds: z.array(IdentifierSchema),
    evidenceIds: z.array(IdentifierSchema),
  })
  .strict();
const EndExaminationPayloadSchema = z
  .object({ witnessId: IdentifierSchema, examinationKind: z.enum(["direct", "cross", "redirect", "recross"]) })
  .strict();
const ObjectPayloadSchema = z
  .object({
    objectionId: IdentifierSchema,
    questionId: IdentifierSchema,
    ground: ObjectionStateEntrySchema.shape.ground,
    interruptedResponseId: IdentifierSchema.nullable(),
  })
  .strict();
const RuleObjectionPayloadSchema = z
  .object({
    objectionId: IdentifierSchema,
    ruling: z.enum(["sustained", "overruled"]),
    remedy: ObjectionStateEntrySchema.shape.remedy,
    reason: z.string().trim().min(1).max(4_000),
  })
  .strict();
const RephrasePayloadSchema = z
  .object({ originalQuestionId: IdentifierSchema, questionId: IdentifierSchema, text: z.string().trim().min(1).max(8_000), turnId: IdentifierSchema })
  .strict();
const MoveStrikePayloadSchema = z
  .object({ motionId: IdentifierSchema, testimonyIds: z.array(IdentifierSchema).min(1), reason: z.string().trim().min(1).max(2_000) })
  .strict();
const StrikePayloadSchema = z
  .object({ motionId: IdentifierSchema, testimonyIds: z.array(IdentifierSchema).min(1), factIds: z.array(IdentifierSchema) })
  .strict();
const EvidencePayloadSchema = z.object({ evidenceId: IdentifierSchema }).strict();
const OfferEvidencePayloadSchema = z
  .object({ evidenceId: IdentifierSchema, offeredBySide: z.enum(["user", "opposing"]), foundationTestimonyIds: z.array(IdentifierSchema) })
  .strict();
const RuleEvidencePayloadSchema = z
  .object({ evidenceId: IdentifierSchema, ruling: z.enum(["admitted", "excluded"]), reason: z.string().trim().min(1).max(4_000) })
  .strict();
const FactPayloadSchema = z.object({ factId: IdentifierSchema }).strict();
const RuleAssertionPayloadSchema = z
  .object({
    factId: IdentifierSchema,
    ruling: z.enum(["admitted", "excluded"]),
    reason: z.string().trim().min(1).max(4_000),
  })
  .strict();
const ProposeAssertionPayloadSchema = z
  .object({
    factId: IdentifierSchema,
    proposition: z.string().trim().min(1).max(8_000),
    provenanceIds: z.array(IdentifierSchema).min(1),
    visibility: z.enum(["public", "restricted"]),
  })
  .strict();
const RequestResponsePayloadSchema = z
  .object({ responseId: IdentifierSchema, actorId: IdentifierSchema, purpose: IdentifierSchema })
  .strict();
const ResponsePayloadSchema = z.object({ responseId: IdentifierSchema }).strict();
const BeginInterruptionPayloadSchema = z
  .object({ interruptId: IdentifierSchema, interruptedResponseId: IdentifierSchema, objectionId: IdentifierSchema.nullable() })
  .strict();
const ResolveInterruptionPayloadSchema = z
  .object({ interruptId: IdentifierSchema, outcome: z.enum(["cancel", "resume"]) })
  .strict();
const SettlementPayloadSchema = z
  .object({ offerId: IdentifierSchema, parentOfferId: IdentifierSchema.nullable(), terms: SettlementTermsSchema, expiresAtSequence: z.number().int().positive() })
  .strict();
const OfferIdPayloadSchema = z.object({ offerId: IdentifierSchema }).strict();
const ClosingPayloadSchema = z
  .object({ side: z.enum(["user", "opposing"]), turnId: IdentifierSchema, text: z.string().trim().min(1).max(20_000), citations: CitationSetSchema })
  .strict();
const InstructionsPayloadSchema = z.object({ instructionIds: z.array(IdentifierSchema).min(1) }).strict();
const VerdictPayloadSchema = z
  .object({ verdictId: IdentifierSchema, decision: z.string().trim().min(1).max(4_000), citations: CitationSetSchema })
  .strict();
const DebriefPayloadSchema = z.object({ debriefId: IdentifierSchema }).strict();
const FailurePayloadSchema = FailureStateSchema.omit({ sourceEventId: true });
const RecoverPayloadSchema = z.object({ stepId: IdentifierSchema }).strict();
const EmptyPayloadSchema = z.object({}).strict();

export const TRIAL_ACTION_TYPES = [
  "START_TRIAL", "BEGIN_PHASE", "CALL_WITNESS", "SWEAR_WITNESS", "ASK_QUESTION",
  "ANSWER_QUESTION", "END_EXAMINATION", "RECALL_WITNESS", "RELEASE_WITNESS", "OBJECT",
  "RULE_ON_OBJECTION", "REPHRASE_QUESTION", "MOVE_TO_STRIKE", "STRIKE_TESTIMONY",
  "OFFER_EVIDENCE", "RULE_ON_EVIDENCE", "WITHDRAW_EVIDENCE", "REVEAL_HIDDEN_FACT",
  "PROPOSE_ASSERTION", "VERIFY_ASSERTION", "DISPUTE_ASSERTION", "RULE_ON_ASSERTION", "REQUEST_RESPONSE",
  "CANCEL_RESPONSE", "COMPLETE_RESPONSE", "BEGIN_INTERRUPTION", "RESOLVE_INTERRUPTION",
  "RESUME_INTERRUPTED_SPEECH", "PAUSE_TRIAL", "REQUEST_RECESS", "RESUME_TRIAL",
  "PROPOSE_SETTLEMENT", "COUNTER_SETTLEMENT", "ACCEPT_SETTLEMENT", "REJECT_SETTLEMENT",
  "WITHDRAW_SETTLEMENT", "EXPIRE_SETTLEMENT", "REST_CASE", "GIVE_CLOSING", "INSTRUCT_JURY",
  "DELIBERATE", "RENDER_VERDICT", "GENERATE_DEBRIEF", "FAIL_STEP", "RECOVER_STEP",
] as const;
export const TrialActionTypeSchema = z.enum(TRIAL_ACTION_TYPES);
export type TrialActionType = z.infer<typeof TrialActionTypeSchema>;

function actionBaseShape<Version extends string>(schemaVersion: Version) {
  return {
    schemaVersion: z.literal(schemaVersion),
    actionId: IdentifierSchema,
    trialId: IdentifierSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    actor: ActorRefSchema,
    source: EventSourceSchema,
    requestedAt: DateTimeSchema,
    causationId: IdentifierSchema.nullable(),
    correlationId: IdentifierSchema.nullable(),
    responseId: IdentifierSchema.nullable(),
    interruptId: IdentifierSchema.nullable(),
    modelMetadata: ModelMetadataSchema.nullable(),
  };
}

const action = <
  Version extends string,
  T extends TrialActionType,
  S extends z.ZodType,
>(schemaVersion: Version, type: T, payload: S) =>
  z.object({
    ...actionBaseShape(schemaVersion),
    type: z.literal(type),
    payload,
  }).strict();

function actionSchemasFor<
  Version extends string,
  StartPayload extends z.ZodType,
>(schemaVersion: Version, startPayload: StartPayload) {
  return [
    action(schemaVersion, "START_TRIAL", startPayload), action(schemaVersion, "BEGIN_PHASE", BeginPhasePayloadSchema),
    action(schemaVersion, "CALL_WITNESS", CallWitnessPayloadSchema), action(schemaVersion, "SWEAR_WITNESS", WitnessPayloadSchema),
    action(schemaVersion, "ASK_QUESTION", AskQuestionPayloadSchema), action(schemaVersion, "ANSWER_QUESTION", AnswerQuestionPayloadSchema),
    action(schemaVersion, "END_EXAMINATION", EndExaminationPayloadSchema), action(schemaVersion, "RECALL_WITNESS", CallWitnessPayloadSchema),
    action(schemaVersion, "RELEASE_WITNESS", WitnessPayloadSchema), action(schemaVersion, "OBJECT", ObjectPayloadSchema),
    action(schemaVersion, "RULE_ON_OBJECTION", RuleObjectionPayloadSchema), action(schemaVersion, "REPHRASE_QUESTION", RephrasePayloadSchema),
    action(schemaVersion, "MOVE_TO_STRIKE", MoveStrikePayloadSchema), action(schemaVersion, "STRIKE_TESTIMONY", StrikePayloadSchema),
    action(schemaVersion, "OFFER_EVIDENCE", OfferEvidencePayloadSchema), action(schemaVersion, "RULE_ON_EVIDENCE", RuleEvidencePayloadSchema),
    action(schemaVersion, "WITHDRAW_EVIDENCE", EvidencePayloadSchema), action(schemaVersion, "REVEAL_HIDDEN_FACT", FactPayloadSchema),
    action(schemaVersion, "PROPOSE_ASSERTION", ProposeAssertionPayloadSchema), action(schemaVersion, "VERIFY_ASSERTION", FactPayloadSchema),
    action(schemaVersion, "DISPUTE_ASSERTION", FactPayloadSchema), action(schemaVersion, "RULE_ON_ASSERTION", RuleAssertionPayloadSchema),
    action(schemaVersion, "REQUEST_RESPONSE", RequestResponsePayloadSchema),
    action(schemaVersion, "CANCEL_RESPONSE", ResponsePayloadSchema), action(schemaVersion, "COMPLETE_RESPONSE", ResponsePayloadSchema),
    action(schemaVersion, "BEGIN_INTERRUPTION", BeginInterruptionPayloadSchema), action(schemaVersion, "RESOLVE_INTERRUPTION", ResolveInterruptionPayloadSchema),
    action(schemaVersion, "RESUME_INTERRUPTED_SPEECH", BeginInterruptionPayloadSchema.pick({ interruptId: true, interruptedResponseId: true })),
    action(schemaVersion, "PAUSE_TRIAL", EmptyPayloadSchema), action(schemaVersion, "REQUEST_RECESS", EmptyPayloadSchema),
    action(schemaVersion, "RESUME_TRIAL", EmptyPayloadSchema), action(schemaVersion, "PROPOSE_SETTLEMENT", SettlementPayloadSchema),
    action(schemaVersion, "COUNTER_SETTLEMENT", SettlementPayloadSchema), action(schemaVersion, "ACCEPT_SETTLEMENT", OfferIdPayloadSchema),
    action(schemaVersion, "REJECT_SETTLEMENT", OfferIdPayloadSchema), action(schemaVersion, "WITHDRAW_SETTLEMENT", OfferIdPayloadSchema),
    action(schemaVersion, "EXPIRE_SETTLEMENT", OfferIdPayloadSchema), action(schemaVersion, "REST_CASE", z.object({ side: z.enum(["user", "opposing"]) }).strict()),
    action(schemaVersion, "GIVE_CLOSING", ClosingPayloadSchema), action(schemaVersion, "INSTRUCT_JURY", InstructionsPayloadSchema),
    action(schemaVersion, "DELIBERATE", EmptyPayloadSchema), action(schemaVersion, "RENDER_VERDICT", VerdictPayloadSchema),
    action(schemaVersion, "GENERATE_DEBRIEF", DebriefPayloadSchema), action(schemaVersion, "FAIL_STEP", FailurePayloadSchema),
    action(schemaVersion, "RECOVER_STEP", RecoverPayloadSchema),
  ] as const;
}

const trialActionV1Schemas = actionSchemasFor(
  TRIAL_ACTION_SCHEMA_VERSION_V1,
  StartTrialPayloadV1Schema,
);
const trialActionV2Schemas = actionSchemasFor(
  TRIAL_ACTION_SCHEMA_VERSION_V2,
  StartTrialPayloadV2Schema,
);

export const TrialActionV1Schema = z.discriminatedUnion(
  "type",
  trialActionV1Schemas,
);
export const TrialActionV2Schema = z.discriminatedUnion(
  "type",
  trialActionV2Schemas,
);
export const TrialActionSchema = TrialActionV2Schema;
export type TrialActionV1 = z.infer<typeof TrialActionV1Schema>;
export type TrialActionV2 = z.infer<typeof TrialActionV2Schema>;
export type TrialAction = TrialActionV2;
export type TrialActionByType<K extends TrialActionType> = Extract<TrialAction, { type: K }>;

export const TRIAL_EVENT_TYPES = TRIAL_ACTION_TYPES;
export const TrialEventTypeSchema = TrialActionTypeSchema;
export type TrialEventType = TrialActionType;

type TrialEventEnvelope<Version extends string> = {
  schemaVersion: Version;
  eventId: string;
  trialId: string;
  sequence: number;
  stateVersion: number;
  actionId: string;
  actor: ActorRef;
  source: EventSource;
  occurredAt: string;
  causationId: string | null;
  correlationId: string | null;
  responseId: string | null;
  interruptId: string | null;
  modelMetadata: ModelMetadata | null;
  citations: CitationSet;
};

type TrialEventForAction<
  ActionUnion extends { type: TrialActionType; payload: unknown },
  Version extends string,
> = {
  [K in TrialEventType]: TrialEventEnvelope<Version> & {
    type: K;
    payload: Extract<ActionUnion, { type: K }>["payload"];
  };
}[TrialEventType];
export type TrialEventV1 = TrialEventForAction<
  TrialActionV1,
  typeof TRIAL_EVENT_SCHEMA_VERSION_V1
>;
export type TrialEventV2 = TrialEventForAction<
  TrialActionV2,
  typeof TRIAL_EVENT_SCHEMA_VERSION_V2
>;
export type TrialEvent = TrialEventV2;
export type TrialEventByType<K extends TrialEventType> = Extract<TrialEvent, { type: K }>;

function eventBaseShape<Version extends string>(schemaVersion: Version) {
  return {
    schemaVersion: z.literal(schemaVersion),
    eventId: IdentifierSchema,
    trialId: IdentifierSchema,
    sequence: z.number().int().positive(),
    stateVersion: z.number().int().positive(),
    actionId: IdentifierSchema,
    actor: ActorRefSchema,
    source: EventSourceSchema,
    occurredAt: DateTimeSchema,
    causationId: IdentifierSchema.nullable(),
    correlationId: IdentifierSchema.nullable(),
    responseId: IdentifierSchema.nullable(),
    interruptId: IdentifierSchema.nullable(),
    modelMetadata: ModelMetadataSchema.nullable(),
    citations: CitationSetSchema,
  };
}

const event = <
  Version extends string,
  T extends TrialEventType,
  S extends z.ZodType,
>(schemaVersion: Version, type: T, payload: S) =>
  z.object({
    ...eventBaseShape(schemaVersion),
    type: z.literal(type),
    payload,
  }).strict();

type EventSchemaTuple = [
  ReturnType<typeof event>,
  ReturnType<typeof event>,
  ...ReturnType<typeof event>[],
];

function eventSchemasFor(
  schemaVersion: string,
  actionSchemas: readonly z.ZodObject<z.ZodRawShape>[],
): EventSchemaTuple {
  return actionSchemas.map((schema, index) => {
    const type = TRIAL_EVENT_TYPES[index];
    return event(
      schemaVersion,
      type,
      schema.shape.payload as unknown as z.ZodType,
    );
  }) as unknown as EventSchemaTuple;
}

const trialEventV1Schemas = eventSchemasFor(
  TRIAL_EVENT_SCHEMA_VERSION_V1,
  trialActionV1Schemas,
);
const trialEventV2Schemas = eventSchemasFor(
  TRIAL_EVENT_SCHEMA_VERSION_V2,
  trialActionV2Schemas,
);

export const TrialEventV1Schema = z.discriminatedUnion(
  "type",
  trialEventV1Schemas,
) as unknown as z.ZodType<TrialEventV1>;
export const TrialEventV2Schema = z.discriminatedUnion(
  "type",
  trialEventV2Schemas,
) as unknown as z.ZodType<TrialEventV2>;
export const TrialEventSchema = TrialEventV2Schema;

export const EVENT_TYPE_FOR_ACTION = Object.freeze(
  Object.fromEntries(TRIAL_ACTION_TYPES.map((type) => [type, type])) as Record<TrialActionType, TrialEventType>,
);

const trialStateV1Shape = {
  trialId: IdentifierSchema,
  caseId: IdentifierSchema,
  caseVersion: z.number().int().positive(),
  caseGraphHash: IdentifierSchema,
  version: z.number().int().nonnegative(),
  lastSequence: z.number().int().nonnegative(),
  phase: TrialPhaseSchema,
  phaseBeforeRecess: TrialPhaseSchema.nullable(),
  status: TrialStatusSchema,
  startedAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  userSide: z.enum(["user", "opposing"]),
  actors: z.record(z.string(), ActorRefSchema),
  facts: z.record(z.string(), FactStateEntrySchema),
  evidence: z.record(z.string(), EvidenceStateEntrySchema),
  witnesses: z.record(z.string(), WitnessStateEntrySchema),
  testimony: z.record(z.string(), TestimonyStateEntrySchema),
  settlementOffers: z.record(z.string(), SettlementOfferStateEntrySchema),
  objections: z.record(z.string(), ObjectionStateEntrySchema),
  pendingResponses: z.record(z.string(), PendingResponseStateEntrySchema),
  transcriptTurns: z.record(z.string(), TranscriptTurnSchema),
  activeWitnessId: IdentifierSchema.nullable(),
  activeQuestionId: IdentifierSchema.nullable(),
  activeInterruption: InterruptionStateSchema.nullable(),
  activeSettlementOfferId: IdentifierSchema.nullable(),
  restedSides: z.array(z.enum(["user", "opposing"])),
  eventIds: z.array(IdentifierSchema),
  committedActionIds: z.array(IdentifierSchema),
  transcriptTurnIds: z.array(IdentifierSchema),
  instructionIds: z.array(IdentifierSchema),
  verdictId: IdentifierSchema.nullable(),
  debriefId: IdentifierSchema.nullable(),
  failure: FailureStateSchema.nullable(),
};

export const TrialStateV1Schema = z
  .object({
    schemaVersion: z.literal(TRIAL_STATE_SCHEMA_VERSION_V1),
    ...trialStateV1Shape,
  })
  .strict();
export const TrialStateV2Schema = z
  .object({
    schemaVersion: z.literal(TRIAL_STATE_SCHEMA_VERSION_V2),
    ...trialStateV1Shape,
    policySnapshot: TrialPolicySnapshotSchema,
  })
  .strict();
export const TrialStateSchema = TrialStateV2Schema;
export type TrialStateV1 = z.infer<typeof TrialStateV1Schema>;
export type TrialStateV2 = z.infer<typeof TrialStateV2Schema>;
export type TrialState = TrialStateV2;

export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated value: ${JSON.stringify(value)}`);
}
