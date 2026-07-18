import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";

export const KNOWLEDGE_VIEW_SCHEMA_VERSION = "knowledge-view.v1" as const;
export const JURY_RECORD_SCHEMA_VERSION = "jury-record.v1" as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime({ offset: true });
const IdListSchema = z.array(CaseGraphEntityIdSchema);

export const FactLifecycleSchema = z.enum([
  "hidden",
  "proposed",
  "disputed",
  "verified",
  "admitted",
  "excluded",
  "stricken",
]);

export const EvidenceLifecycleSchema = z.enum([
  "uploaded",
  "indexed",
  "offered",
  "admitted",
  "excluded",
  "withdrawn",
]);

export const TestimonyLifecycleSchema = z.enum(["active", "stricken"]);

export const CaseIdentitySchema = z
  .object({
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    title: NonEmptyTextSchema,
  })
  .strict();

export const JuryFactSchema = z
  .object({
    factId: CaseGraphEntityIdSchema,
    proposition: NonEmptyTextSchema,
    status: z.literal("admitted"),
    sourceSegmentIds: IdListSchema,
  })
  .strict();

export const JuryEvidenceSchema = z
  .object({
    evidenceId: CaseGraphEntityIdSchema,
    name: NonEmptyTextSchema,
    description: NonEmptyTextSchema,
    status: z.literal("admitted"),
    sourceSegmentIds: IdListSchema,
  })
  .strict();

export const RecordTestimonySchema = z
  .object({
    testimonyId: CaseGraphEntityIdSchema,
    witnessId: CaseGraphEntityIdSchema,
    speakerActorId: CaseGraphEntityIdSchema,
    text: NonEmptyTextSchema,
    status: z.literal("active"),
    factIds: IdListSchema,
    evidenceIds: IdListSchema,
    transcriptEventId: CaseGraphEntityIdSchema,
  })
  .strict();

export const JuryInstructionViewSchema = z
  .object({
    instructionId: CaseGraphEntityIdSchema,
    title: NonEmptyTextSchema,
    text: NonEmptyTextSchema,
  })
  .strict();

export const JuryRecordV1Schema = z
  .object({
    schemaVersion: z.literal(JURY_RECORD_SCHEMA_VERSION),
    trialId: CaseGraphEntityIdSchema,
    stateVersion: z.number().int().nonnegative(),
    facts: z.array(JuryFactSchema),
    evidence: z.array(JuryEvidenceSchema),
    testimony: z.array(RecordTestimonySchema),
    instructions: z.array(JuryInstructionViewSchema),
  })
  .strict();

export const WitnessKnownFactSchema = z
  .object({
    factId: CaseGraphEntityIdSchema,
    proposition: NonEmptyTextSchema,
    knowledgeBasis: z.enum(["perceived", "known"]),
  })
  .strict();

export const WitnessEvidenceSchema = z
  .object({
    evidenceId: CaseGraphEntityIdSchema,
    name: NonEmptyTextSchema,
    description: NonEmptyTextSchema,
    status: z.literal("admitted"),
  })
  .strict();

export const WitnessPriorStatementSchema = z
  .object({
    priorStatementId: CaseGraphEntityIdSchema,
    madeAt: DateTimeSchema,
    kind: z.enum(["interview", "email", "deposition", "affidavit", "report", "other"]),
    text: NonEmptyTextSchema,
    relatedFactIds: IdListSchema,
    relatedEvidenceIds: IdListSchema,
  })
  .strict();

export const CurrentExchangeSchema = z
  .object({
    exchangeId: CaseGraphEntityIdSchema,
    speakerActorId: CaseGraphEntityIdSchema,
    text: NonEmptyTextSchema,
    factIds: IdListSchema,
    evidenceIds: IdListSchema,
  })
  .strict();

export const WitnessScopeSchema = z
  .object({
    witnessId: CaseGraphEntityIdSchema,
    name: NonEmptyTextSchema,
    role: NonEmptyTextSchema,
    emotionalState: z.enum(["neutral", "confident", "nervous", "defensive", "empathetic"]),
    facts: z.array(WitnessKnownFactSchema),
    admittedSeenEvidence: z.array(WitnessEvidenceSchema),
    priorStatements: z.array(WitnessPriorStatementSchema),
    allowedTopics: z.array(NonEmptyTextSchema),
    forbiddenTopics: z.array(NonEmptyTextSchema),
  })
  .strict();

export const CaseMaterialFactSchema = z
  .object({
    factId: CaseGraphEntityIdSchema,
    proposition: NonEmptyTextSchema,
    status: FactLifecycleSchema.exclude(["hidden"]),
  })
  .strict();

export const CaseMaterialEvidenceSchema = z
  .object({
    evidenceId: CaseGraphEntityIdSchema,
    name: NonEmptyTextSchema,
    description: NonEmptyTextSchema,
    status: EvidenceLifecycleSchema,
  })
  .strict();

export const SettlementOfferViewSchema = z
  .object({
    offerId: CaseGraphEntityIdSchema,
    proposerPartyId: CaseGraphEntityIdSchema,
    recipientPartyIds: IdListSchema,
    amount: z.number().nonnegative().nullable(),
    nonMonetaryTerms: z.array(NonEmptyTextSchema),
    status: z.enum(["open", "countered", "accepted", "rejected", "expired", "withdrawn"]),
  })
  .strict();

export const PrivateSettlementScopeSchema = z
  .object({
    partyId: CaseGraphEntityIdSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    authority: z
      .object({
        minimum: z.number().nonnegative(),
        maximum: z.number().nonnegative(),
        reservationValue: z.number().nonnegative(),
        targetValue: z.number().nonnegative(),
      })
      .strict(),
    confidentialPriorities: z.array(NonEmptyTextSchema),
    permittedNonMonetaryTerms: z.array(NonEmptyTextSchema),
    offers: z.array(SettlementOfferViewSchema),
  })
  .strict();

export const CounselScopeSchema = z
  .object({
    partyId: CaseGraphEntityIdSchema,
    facts: z.array(CaseMaterialFactSchema),
    evidence: z.array(CaseMaterialEvidenceSchema),
    strategyMemory: z.array(NonEmptyTextSchema),
    privateSettlement: PrivateSettlementScopeSchema.nullable(),
  })
  .strict();

export const RuleProfileViewSchema = z
  .object({
    profileId: CaseGraphEntityIdSchema,
    name: NonEmptyTextSchema,
    rulesVersion: NonEmptyTextSchema,
    governingLaw: NonEmptyTextSchema,
    burdenOfProof: z.enum(["preponderance", "clear_and_convincing", "beyond_reasonable_doubt"]),
    permittedObjectionGrounds: z.array(
      z.enum([
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
    ),
  })
  .strict();

export const ProceduralRecordSchema = z
  .object({
    excludedFactIds: IdListSchema,
    excludedEvidenceIds: IdListSchema,
    strickenTestimonyIds: IdListSchema,
  })
  .strict();

export const NonAdmittedFactSchema = z
  .object({
    factId: CaseGraphEntityIdSchema,
    proposition: NonEmptyTextSchema,
    status: z.enum(["proposed", "disputed", "verified"]),
  })
  .strict();

export const NonAdmittedEvidenceSchema = z
  .object({
    evidenceId: CaseGraphEntityIdSchema,
    name: NonEmptyTextSchema,
    status: z.enum(["uploaded", "indexed", "offered", "withdrawn"]),
  })
  .strict();

export const ExcludedFactSchema = z
  .object({
    factId: CaseGraphEntityIdSchema,
    proposition: NonEmptyTextSchema,
    status: z.enum(["excluded", "stricken"]),
  })
  .strict();

export const ExcludedEvidenceSchema = z
  .object({
    evidenceId: CaseGraphEntityIdSchema,
    name: NonEmptyTextSchema,
    status: z.literal("excluded"),
  })
  .strict();

export const StrickenTestimonySchema = z
  .object({
    testimonyId: CaseGraphEntityIdSchema,
    witnessId: CaseGraphEntityIdSchema,
    text: NonEmptyTextSchema,
    status: z.literal("stricken"),
    transcriptEventId: CaseGraphEntityIdSchema,
  })
  .strict();

export const HiddenAuthoringFactSchema = z
  .object({
    factId: CaseGraphEntityIdSchema,
    proposition: NonEmptyTextSchema,
    sourceSegmentIds: IdListSchema,
  })
  .strict();

export const CoachingInferenceSchema = z
  .object({
    inferenceId: CaseGraphEntityIdSchema,
    text: NonEmptyTextSchema,
    transcriptEventIds: IdListSchema,
    evidenceIds: IdListSchema,
  })
  .strict();

export const DebriefStrataSchema = z
  .object({
    admittedRecord: z
      .object({
        label: z.literal("admitted_record"),
        record: JuryRecordV1Schema,
      })
      .strict(),
    unadmittedRecord: z
      .object({
        label: z.literal("unadmitted_record"),
        facts: z.array(NonAdmittedFactSchema),
        evidence: z.array(NonAdmittedEvidenceSchema),
      })
      .strict(),
    excludedOrStricken: z
      .object({
        label: z.literal("excluded_or_stricken"),
        facts: z.array(ExcludedFactSchema),
        evidence: z.array(ExcludedEvidenceSchema),
        testimony: z.array(StrickenTestimonySchema),
      })
      .strict(),
    hiddenAuthoringTruth: z
      .object({
        label: z.literal("hidden_authoring_truth"),
        facts: z.array(HiddenAuthoringFactSchema),
      })
      .strict(),
    coachingInference: z
      .object({
        label: z.literal("coaching_inference"),
        items: z.array(CoachingInferenceSchema),
      })
      .strict(),
  })
  .strict();

const KnowledgeViewBaseShape = {
  schemaVersion: z.literal(KNOWLEDGE_VIEW_SCHEMA_VERSION),
  trialId: CaseGraphEntityIdSchema,
  stateVersion: z.number().int().nonnegative(),
  actorId: CaseGraphEntityIdSchema,
  case: CaseIdentitySchema,
} as const;

export const WitnessKnowledgeViewV1Schema = z
  .object({
    ...KnowledgeViewBaseShape,
    actorRole: z.literal("witness"),
    publicRecord: JuryRecordV1Schema,
    witness: WitnessScopeSchema,
    currentExchange: CurrentExchangeSchema.nullable(),
  })
  .strict();

const CounselKnowledgeViewBaseShape = {
  ...KnowledgeViewBaseShape,
  publicRecord: JuryRecordV1Schema,
  counsel: CounselScopeSchema,
  currentExchange: CurrentExchangeSchema.nullable(),
} as const;

export const UserCounselKnowledgeViewV1Schema = z
  .object({
    ...CounselKnowledgeViewBaseShape,
    actorRole: z.literal("user_counsel"),
  })
  .strict();

export const OpposingCounselKnowledgeViewV1Schema = z
  .object({
    ...CounselKnowledgeViewBaseShape,
    actorRole: z.literal("opposing_counsel"),
  })
  .strict();

export const CounselKnowledgeViewV1Schema = z.discriminatedUnion("actorRole", [
  UserCounselKnowledgeViewV1Schema,
  OpposingCounselKnowledgeViewV1Schema,
]);

export const JudgeKnowledgeViewV1Schema = z
  .object({
    ...KnowledgeViewBaseShape,
    actorRole: z.literal("judge"),
    publicRecord: JuryRecordV1Schema,
    rules: RuleProfileViewSchema,
    proceduralRecord: ProceduralRecordSchema,
    currentExchange: CurrentExchangeSchema.nullable(),
  })
  .strict();

export const JuryKnowledgeViewV1Schema = z
  .object({
    ...KnowledgeViewBaseShape,
    actorRole: z.literal("jury"),
    publicRecord: JuryRecordV1Schema,
  })
  .strict();

export const DebriefKnowledgeViewV1Schema = z
  .object({
    ...KnowledgeViewBaseShape,
    actorRole: z.literal("debrief"),
    strata: DebriefStrataSchema,
  })
  .strict();

export const KnowledgeViewV1Schema = z.discriminatedUnion("actorRole", [
  WitnessKnowledgeViewV1Schema,
  UserCounselKnowledgeViewV1Schema,
  OpposingCounselKnowledgeViewV1Schema,
  JudgeKnowledgeViewV1Schema,
  JuryKnowledgeViewV1Schema,
  DebriefKnowledgeViewV1Schema,
]);

export const KnowledgeViewSchema = KnowledgeViewV1Schema;

export type FactLifecycle = z.infer<typeof FactLifecycleSchema>;
export type EvidenceLifecycle = z.infer<typeof EvidenceLifecycleSchema>;
export type TestimonyLifecycle = z.infer<typeof TestimonyLifecycleSchema>;
export type JuryRecordV1 = z.infer<typeof JuryRecordV1Schema>;
export type JuryRecord = JuryRecordV1;
export type KnowledgeViewV1 = z.infer<typeof KnowledgeViewV1Schema>;
export type KnowledgeView = KnowledgeViewV1;

export function parseKnowledgeView(input: unknown): KnowledgeView {
  return KnowledgeViewSchema.parse(input);
}

export function parseJuryRecord(input: unknown): JuryRecord {
  return JuryRecordV1Schema.parse(input);
}
