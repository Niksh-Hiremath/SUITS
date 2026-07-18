import { z } from "zod";

import {
  CaseGraphEntityIdSchema,
  JurisdictionProfileSchema,
  SettlementConfigurationSchema,
} from "../case-graph/schema";

export const TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION =
  "trial-policy-snapshot.v1" as const;
export const JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION =
  "judge-trial-policy-view.v1" as const;
export const JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION =
  "jury-trial-policy-view.v1" as const;

const IdentifierSchema = z.string().trim().min(1).max(256);

function uniqueListSchema<T extends z.ZodType>(itemSchema: T) {
  return z
  .array(itemSchema)
  .superRefine((ids, context) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      const stringId = String(id);
      if (seen.has(stringId)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate ID: ${stringId}`,
        });
      }
      seen.add(stringId);
    });
  });
}

const UniqueEntityIdListSchema = uniqueListSchema(CaseGraphEntityIdSchema);
const UniqueActorIdListSchema = uniqueListSchema(IdentifierSchema);

export const TrialPolicySideSchema = z.enum(["user", "opposing", "neutral"]);
export const TrialPolicyActorRoleSchema = z.enum([
  "user_counsel",
  "opposing_counsel",
  "judge",
  "witness",
  "clerk",
  "jury",
  "system",
  "debrief_coach",
]);

const TrialPolicyActorRefSchema = z
  .object({
    actorId: IdentifierSchema,
    role: TrialPolicyActorRoleSchema,
    side: TrialPolicySideSchema,
    witnessId: IdentifierSchema.nullable(),
  })
  .strict();

export const TrialPolicyObjectionGroundSchema =
  JurisdictionProfileSchema.shape.permittedObjectionGrounds.element;
export type TrialPolicyObjectionGround = z.infer<
  typeof TrialPolicyObjectionGroundSchema
>;

export const SettlementOpenPhaseSchema =
  SettlementConfigurationSchema.shape.opensAtPhase;
export type SettlementOpenPhase = z.infer<typeof SettlementOpenPhaseSchema>;

export const TrialPolicyActorBindingInputSchema = z
  .object({
    actor: TrialPolicyActorRefSchema,
    representedPartyIds: UniqueEntityIdListSchema,
  })
  .strict();
export type TrialPolicyActorBindingInput = z.infer<
  typeof TrialPolicyActorBindingInputSchema
>;

export const TrialPolicyActorBindingSchema = z
  .object({
    actorId: IdentifierSchema,
    role: TrialPolicyActorRoleSchema,
    side: TrialPolicySideSchema,
    witnessId: CaseGraphEntityIdSchema.nullable(),
    representedPartyIds: UniqueEntityIdListSchema,
  })
  .strict();
export type TrialPolicyActorBinding = z.infer<
  typeof TrialPolicyActorBindingSchema
>;

export const TrialPolicyPartyBindingSchema = z
  .object({
    partyId: CaseGraphEntityIdSchema,
    side: TrialPolicySideSchema,
    representativeActorIds: UniqueActorIdListSchema,
  })
  .strict();
export type TrialPolicyPartyBinding = z.infer<
  typeof TrialPolicyPartyBindingSchema
>;

export const TrialPolicySideBindingSchema = z
  .object({
    side: TrialPolicySideSchema,
    partyIds: UniqueEntityIdListSchema,
    actorIds: UniqueActorIdListSchema,
    counselActorIds: UniqueActorIdListSchema,
  })
  .strict();
export type TrialPolicySideBinding = z.infer<
  typeof TrialPolicySideBindingSchema
>;

export const TrialPolicyMappingsSchema = z
  .object({
    actors: z.array(TrialPolicyActorBindingSchema),
    parties: z.array(TrialPolicyPartyBindingSchema),
    sides: z.array(TrialPolicySideBindingSchema).length(3),
  })
  .strict();
export type TrialPolicyMappings = z.infer<typeof TrialPolicyMappingsSchema>;

export const WitnessCallabilityRuleSchema = z
  .object({
    witnessId: CaseGraphEntityIdSchema,
    alignedPartyId: CaseGraphEntityIdSchema.nullable(),
    callableByPartyIds: UniqueEntityIdListSchema,
    callableBySides: z.array(TrialPolicySideSchema),
    callableByActorIds: UniqueActorIdListSchema,
    recallPermitted: z.boolean(),
  })
  .strict();
export type WitnessCallabilityRule = z.infer<
  typeof WitnessCallabilityRuleSchema
>;

export const EvidencePermissionRuleSchema = z
  .object({
    evidenceId: CaseGraphEntityIdSchema,
    offerableByPartyIds: UniqueEntityIdListSchema,
    offerableBySides: z.array(TrialPolicySideSchema),
    offerableByActorIds: UniqueActorIdListSchema,
    custodianWitnessIds: UniqueEntityIdListSchema,
    authenticatingWitnessIds: UniqueEntityIdListSchema,
    authenticatingActorIds: UniqueActorIdListSchema,
  })
  .strict();
export type EvidencePermissionRule = z.infer<
  typeof EvidencePermissionRuleSchema
>;

/**
 * Private authoring controls. These values may be returned only to counsel
 * representing the matching party; judge and jury views deliberately omit them.
 */
export const SettlementPartyAuthorityRuleSchema = z
  .object({
    partyId: CaseGraphEntityIdSchema,
    minimumAuthority: z.number().nonnegative(),
    maximumAuthority: z.number().nonnegative(),
    reservationValue: z.number().nonnegative(),
    targetValue: z.number().nonnegative(),
    confidentialPriorities: z.array(z.string().trim().min(1)),
    permittedNonMonetaryTerms: z.array(z.string().trim().min(1)),
  })
  .strict();
export type SettlementPartyAuthorityRule = z.infer<
  typeof SettlementPartyAuthorityRuleSchema
>;

export const ProceduralSettlementPolicySchema = z
  .object({
    enabled: z.boolean(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    opensAtPhase: SettlementOpenPhaseSchema,
    openPhases: z.array(SettlementOpenPhaseSchema),
    allowCounteroffers: z.boolean(),
    expiresAfterEventCount: z.number().int().positive(),
    participantPartyIds: UniqueEntityIdListSchema,
  })
  .strict();
export type ProceduralSettlementPolicy = z.infer<
  typeof ProceduralSettlementPolicySchema
>;

export const PrivateSettlementPolicySchema = ProceduralSettlementPolicySchema
  .extend({
    partyAuthorities: z.array(SettlementPartyAuthorityRuleSchema),
  })
  .strict();
export type PrivateSettlementPolicy = z.infer<
  typeof PrivateSettlementPolicySchema
>;

export const TrialPolicySnapshotSchema = z
  .object({
    schemaVersion: z.literal(TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    mappings: TrialPolicyMappingsSchema,
    witnessCallability: z.array(WitnessCallabilityRuleSchema),
    evidencePermissions: z.array(EvidencePermissionRuleSchema),
    permittedObjectionGrounds: z.array(TrialPolicyObjectionGroundSchema).min(1),
    settlement: PrivateSettlementPolicySchema,
  })
  .strict();
export type TrialPolicySnapshot = z.infer<typeof TrialPolicySnapshotSchema>;

export const JudgeTrialPolicyViewSchema = z
  .object({
    schemaVersion: z.literal(JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION),
    sourcePolicySchemaVersion: z.literal(
      TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION,
    ),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    mappings: TrialPolicyMappingsSchema,
    witnessCallability: z.array(WitnessCallabilityRuleSchema),
    evidencePermissions: z.array(EvidencePermissionRuleSchema),
    permittedObjectionGrounds: z.array(TrialPolicyObjectionGroundSchema).min(1),
    settlement: ProceduralSettlementPolicySchema,
  })
  .strict();
export type JudgeTrialPolicyView = z.infer<
  typeof JudgeTrialPolicyViewSchema
>;

export const JuryTrialPolicyViewSchema = z
  .object({
    schemaVersion: z.literal(JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION),
    sourcePolicySchemaVersion: z.literal(
      TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION,
    ),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    permittedObjectionGrounds: z.array(TrialPolicyObjectionGroundSchema).min(1),
  })
  .strict();
export type JuryTrialPolicyView = z.infer<typeof JuryTrialPolicyViewSchema>;

export const SettlementAuthorityRequestSchema = z
  .object({
    partyId: CaseGraphEntityIdSchema,
    amount: z.number().finite().nonnegative(),
    nonMonetaryTerms: z.array(z.string().trim().min(1)),
  })
  .strict();
export type SettlementAuthorityRequest = z.infer<
  typeof SettlementAuthorityRequestSchema
>;
