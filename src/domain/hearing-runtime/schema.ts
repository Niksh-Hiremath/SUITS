import { z } from "zod";

import {
  ActorRefSchema,
  CitationSetSchema,
  EvidenceStatusSchema,
  ExaminationKindSchema,
  FactStatusSchema,
  SettlementOfferStatusSchema,
  TrialPhaseSchema,
  TrialStatusSchema,
} from "../trial-engine/schemas";

export const HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1 =
  "hearing-runtime-view.v1" as const;

const IdentifierSchema = z.string().trim().min(1).max(256);
const NonEmptyTextSchema = z.string().trim().min(1);
const PlayerSideSchema = z.enum(["user", "opposing"]);
const CounselRoleSchema = z.enum(["user_counsel", "opposing_counsel"]);
const VisibleFactStatusSchema = FactStatusSchema.exclude(["hidden"]);

const JurisdictionViewSchema = z
  .object({
    profileId: IdentifierSchema,
    name: NonEmptyTextSchema,
    rulesVersion: NonEmptyTextSchema,
    governingLaw: NonEmptyTextSchema,
    burdenOfProof: z.enum([
      "preponderance",
      "clear_and_convincing",
      "beyond_reasonable_doubt",
    ]),
  })
  .strict();

const IssueViewSchema = z
  .object({
    issueId: IdentifierSchema,
    title: NonEmptyTextSchema,
    question: NonEmptyTextSchema,
    burdenPartyId: IdentifierSchema.nullable(),
    standard: NonEmptyTextSchema,
  })
  .strict();

const CaseViewSchema = z
  .object({
    caseId: IdentifierSchema,
    version: z.number().int().positive(),
    title: NonEmptyTextSchema,
    summary: NonEmptyTextSchema,
    educationalDisclaimer: NonEmptyTextSchema,
    jurisdiction: JurisdictionViewSchema,
    issues: z.array(IssueViewSchema),
  })
  .strict();

const TrialViewSchema = z
  .object({
    trialId: IdentifierSchema,
    phase: TrialPhaseSchema,
    status: TrialStatusSchema,
    version: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    lastEventId: IdentifierSchema,
    userSide: PlayerSideSchema,
  })
  .strict();

const ExaminationLegViewSchema = z
  .object({
    kind: ExaminationKindSchema,
    ownerSide: PlayerSideSchema,
    status: z.enum([
      "not_available",
      "available",
      "in_progress",
      "completed",
      "waived",
      "terminated",
    ]),
    answeredQuestionCount: z.number().int().nonnegative(),
  })
  .strict();

const ActiveAppearanceViewSchema = z
  .object({
    appearanceId: IdentifierSchema,
    witnessId: IdentifierSchema,
    ordinal: z.number().int().positive(),
    invocation: z.enum(["call", "recall"]),
    callingSide: PlayerSideSchema,
    stage: z.enum([
      "awaiting_oath",
      "direct",
      "cross",
      "redirect",
      "recross",
      "ready_for_release",
      "released",
    ]),
    examinationLeg: ExaminationLegViewSchema.nullable(),
  })
  .strict();

const ActiveQuestionViewSchema = z
  .object({
    questionId: IdentifierSchema,
    appearanceId: IdentifierSchema,
    witnessId: IdentifierSchema,
    examinationKind: ExaminationKindSchema,
    askedBy: ActorRefSchema,
    questionTurnId: IdentifierSchema,
    pendingResponseId: IdentifierSchema.nullable(),
    presentedEvidenceIds: z.array(IdentifierSchema),
    status: z.enum(["open", "answered", "sustained", "withdrawn"]),
  })
  .strict();

const WitnessRosterEntrySchema = z
  .object({
    witnessId: IdentifierSchema,
    name: NonEmptyTextSchema,
    kind: z.enum(["fact", "expert", "character"]),
    role: NonEmptyTextSchema,
    status: z.enum(["available", "called", "sworn", "testifying", "released"]),
    callCount: z.number().int().nonnegative(),
    callableByPlayer: z.boolean(),
    recallableByPlayer: z.boolean(),
    currentAppearanceId: IdentifierSchema.nullable(),
    currentExaminationLeg: ExaminationKindSchema.nullable(),
  })
  .strict();

const HearingCapabilitiesSchema = z
  .object({
    canAskQuestion: z.boolean(),
    canFinishExamination: z.boolean(),
    canFinishTrial: z.boolean(),
    canObject: z.boolean(),
    canContinueResponse: z.boolean(),
    canProposeSettlement: z.boolean(),
    counterableSettlementOfferIds: z.array(IdentifierSchema),
    acceptableSettlementOfferIds: z.array(IdentifierSchema),
    rejectableSettlementOfferIds: z.array(IdentifierSchema),
    withdrawableSettlementOfferIds: z.array(IdentifierSchema),
  })
  .strict();

const VisibleFactSchema = z
  .object({
    factId: IdentifierSchema,
    proposition: NonEmptyTextSchema,
    status: VisibleFactStatusSchema,
  })
  .strict();

const VisibleEvidenceSchema = z
  .object({
    evidenceId: IdentifierSchema,
    name: NonEmptyTextSchema,
    description: NonEmptyTextSchema,
    status: EvidenceStatusSchema,
  })
  .strict();

const VisibleSettlementOfferSchema = z
  .object({
    offerId: IdentifierSchema,
    proposerPartyId: IdentifierSchema,
    recipientPartyIds: z.array(IdentifierSchema),
    amount: z.number().nonnegative().nullable(),
    nonMonetaryTerms: z.array(NonEmptyTextSchema),
    status: SettlementOfferStatusSchema,
  })
  .strict();

const SettlementScopeViewSchema = z
  .object({
    partyId: IdentifierSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    offers: z.array(VisibleSettlementOfferSchema),
  })
  .strict();

const PlayerViewSchema = z
  .object({
    actorId: IdentifierSchema,
    actorRole: CounselRoleSchema,
    side: PlayerSideSchema,
    partyId: IdentifierSchema,
    facts: z.array(VisibleFactSchema),
    evidence: z.array(VisibleEvidenceSchema),
    settlement: SettlementScopeViewSchema.nullable(),
  })
  .strict();

const TranscriptTurnViewSchema = z
  .object({
    ordinal: z.number().int().positive(),
    turnId: IdentifierSchema,
    actor: ActorRefSchema,
    text: NonEmptyTextSchema,
    testimonyId: IdentifierSchema.nullable(),
    status: z.enum(["active", "stricken"]),
    citations: CitationSetSchema,
  })
  .strict();

export const HearingRuntimeViewV1Schema = z
  .object({
    schemaVersion: z.literal(HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1),
    case: CaseViewSchema,
    trial: TrialViewSchema,
    activeAppearance: ActiveAppearanceViewSchema.nullable(),
    activeQuestion: ActiveQuestionViewSchema.nullable(),
    capabilities: HearingCapabilitiesSchema,
    witnesses: z.array(WitnessRosterEntrySchema),
    player: PlayerViewSchema,
    transcript: z.array(TranscriptTurnViewSchema),
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

export type HearingRuntimeViewV1 = z.infer<
  typeof HearingRuntimeViewV1Schema
>;
