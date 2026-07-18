import { z } from "zod";

export const TRIAL_ACTION_SCHEMA_VERSION = "trial-action.v1" as const;
export const TRIAL_EVENT_SCHEMA_VERSION = "trial-event.v1" as const;
export const TRIAL_STATE_SCHEMA_VERSION = "trial-state.v1" as const;

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

const StartTrialPayloadSchema = z
  .object({
    caseId: IdentifierSchema,
    caseVersion: z.number().int().positive(),
    caseGraphHash: IdentifierSchema,
    actors: z.array(ActorRefSchema).min(4),
    witnessIds: z.array(IdentifierSchema).min(1),
    initialFacts: z.array(InitialFactSchema),
    initialEvidence: z.array(InitialEvidenceSchema),
    userSide: z.enum(["user", "opposing"]),
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

const actionBaseShape = {
  schemaVersion: z.literal(TRIAL_ACTION_SCHEMA_VERSION),
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

const action = <T extends TrialActionType, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ ...actionBaseShape, type: z.literal(type), payload }).strict();

const actionSchemas = [
  action("START_TRIAL", StartTrialPayloadSchema), action("BEGIN_PHASE", BeginPhasePayloadSchema),
  action("CALL_WITNESS", CallWitnessPayloadSchema), action("SWEAR_WITNESS", WitnessPayloadSchema),
  action("ASK_QUESTION", AskQuestionPayloadSchema), action("ANSWER_QUESTION", AnswerQuestionPayloadSchema),
  action("END_EXAMINATION", EndExaminationPayloadSchema), action("RECALL_WITNESS", CallWitnessPayloadSchema),
  action("RELEASE_WITNESS", WitnessPayloadSchema), action("OBJECT", ObjectPayloadSchema),
  action("RULE_ON_OBJECTION", RuleObjectionPayloadSchema), action("REPHRASE_QUESTION", RephrasePayloadSchema),
  action("MOVE_TO_STRIKE", MoveStrikePayloadSchema), action("STRIKE_TESTIMONY", StrikePayloadSchema),
  action("OFFER_EVIDENCE", OfferEvidencePayloadSchema), action("RULE_ON_EVIDENCE", RuleEvidencePayloadSchema),
  action("WITHDRAW_EVIDENCE", EvidencePayloadSchema), action("REVEAL_HIDDEN_FACT", FactPayloadSchema),
  action("PROPOSE_ASSERTION", ProposeAssertionPayloadSchema), action("VERIFY_ASSERTION", FactPayloadSchema),
  action("DISPUTE_ASSERTION", FactPayloadSchema), action("RULE_ON_ASSERTION", RuleAssertionPayloadSchema),
  action("REQUEST_RESPONSE", RequestResponsePayloadSchema),
  action("CANCEL_RESPONSE", ResponsePayloadSchema), action("COMPLETE_RESPONSE", ResponsePayloadSchema),
  action("BEGIN_INTERRUPTION", BeginInterruptionPayloadSchema), action("RESOLVE_INTERRUPTION", ResolveInterruptionPayloadSchema),
  action("RESUME_INTERRUPTED_SPEECH", BeginInterruptionPayloadSchema.pick({ interruptId: true, interruptedResponseId: true })),
  action("PAUSE_TRIAL", EmptyPayloadSchema), action("REQUEST_RECESS", EmptyPayloadSchema),
  action("RESUME_TRIAL", EmptyPayloadSchema), action("PROPOSE_SETTLEMENT", SettlementPayloadSchema),
  action("COUNTER_SETTLEMENT", SettlementPayloadSchema), action("ACCEPT_SETTLEMENT", OfferIdPayloadSchema),
  action("REJECT_SETTLEMENT", OfferIdPayloadSchema), action("WITHDRAW_SETTLEMENT", OfferIdPayloadSchema),
  action("EXPIRE_SETTLEMENT", OfferIdPayloadSchema), action("REST_CASE", z.object({ side: z.enum(["user", "opposing"]) }).strict()),
  action("GIVE_CLOSING", ClosingPayloadSchema), action("INSTRUCT_JURY", InstructionsPayloadSchema),
  action("DELIBERATE", EmptyPayloadSchema), action("RENDER_VERDICT", VerdictPayloadSchema),
  action("GENERATE_DEBRIEF", DebriefPayloadSchema), action("FAIL_STEP", FailurePayloadSchema),
  action("RECOVER_STEP", RecoverPayloadSchema),
] as const;

export const TrialActionSchema = z.discriminatedUnion("type", actionSchemas);
export type TrialAction = z.infer<typeof TrialActionSchema>;
export type TrialActionByType<K extends TrialActionType> = Extract<TrialAction, { type: K }>;

export const TRIAL_EVENT_TYPES = TRIAL_ACTION_TYPES;
export const TrialEventTypeSchema = TrialActionTypeSchema;
export type TrialEventType = TrialActionType;

type TrialEventEnvelope = {
  schemaVersion: typeof TRIAL_EVENT_SCHEMA_VERSION;
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

export type TrialEvent = {
  [K in TrialEventType]: TrialEventEnvelope & {
    type: K;
    payload: TrialActionByType<K>["payload"];
  };
}[TrialEventType];
export type TrialEventByType<K extends TrialEventType> = Extract<TrialEvent, { type: K }>;

const eventBaseShape = {
  schemaVersion: z.literal(TRIAL_EVENT_SCHEMA_VERSION),
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
const event = <T extends TrialEventType, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ ...eventBaseShape, type: z.literal(type), payload }).strict();

const eventSchemas = actionSchemas.map((schema, index) => {
  const type = TRIAL_EVENT_TYPES[index];
  return event(type, schema.shape.payload);
}) as unknown as [
  ReturnType<typeof event>,
  ReturnType<typeof event>,
  ...ReturnType<typeof event>[],
];

export const TrialEventSchema = z.discriminatedUnion("type", eventSchemas) as unknown as z.ZodType<TrialEvent>;

export const EVENT_TYPE_FOR_ACTION = Object.freeze(
  Object.fromEntries(TRIAL_ACTION_TYPES.map((type) => [type, type])) as Record<TrialActionType, TrialEventType>,
);

export const TrialStateSchema = z
  .object({
    schemaVersion: z.literal(TRIAL_STATE_SCHEMA_VERSION),
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
  })
  .strict();
export type TrialState = z.infer<typeof TrialStateSchema>;

export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated value: ${JSON.stringify(value)}`);
}
