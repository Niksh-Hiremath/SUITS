import { z } from "zod";

import {
  CaseGraphEntityIdSchema,
  JurisdictionProfileSchema,
  SettlementConfigurationSchema,
} from "../case-graph/schema";

export const TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V1 =
  "trial-policy-snapshot.v1" as const;
export const TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V2 =
  "trial-policy-snapshot.v2" as const;
export const TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION =
  TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V2;

export const JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V1 =
  "judge-trial-policy-view.v1" as const;
export const JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2 =
  "judge-trial-policy-view.v2" as const;
export const JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION =
  JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2;

export const JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V1 =
  "jury-trial-policy-view.v1" as const;
export const JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2 =
  "jury-trial-policy-view.v2" as const;
export const JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION =
  JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2;

const IdentifierSchema = z.string().trim().min(1).max(256);

function uniqueListSchema<T extends z.ZodType>(itemSchema: T) {
  return z.array(itemSchema).superRefine((ids, context) => {
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

function uniqueRuleListSchema<
  T extends z.ZodType<Record<K, string>>,
  K extends string,
>(itemSchema: T, key: K, label: string) {
  return z.array(itemSchema).superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const id = item[key];
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: [index, key],
          message: `Duplicate ${label}: ${id}`,
        });
      }
      seen.add(id);
    });
  });
}

const UniqueEntityIdListSchema = uniqueListSchema(CaseGraphEntityIdSchema);
const UniqueActorIdListSchema = uniqueListSchema(IdentifierSchema);
const UniqueStringListSchema = uniqueListSchema(z.string().trim().min(1));

export const TrialPolicySideSchema = z.enum(["user", "opposing", "neutral"]);
export type TrialPolicySide = z.infer<typeof TrialPolicySideSchema>;
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
export type TrialPolicyActorRole = z.infer<
  typeof TrialPolicyActorRoleSchema
>;

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

/** Exact evidence rule persisted by trial-policy-snapshot.v1. */
export const EvidencePermissionRuleV1Schema = z
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
export type EvidencePermissionRuleV1 = z.infer<
  typeof EvidencePermissionRuleV1Schema
>;

/**
 * Full v2 evidence rule. relatedFactIds is private authoring truth and is
 * deliberately removed from judge and jury views.
 */
export const EvidencePermissionRuleV2Schema = EvidencePermissionRuleV1Schema
  .extend({
    relatedFactIds: UniqueEntityIdListSchema,
  })
  .strict();
export type EvidencePermissionRuleV2 = z.infer<
  typeof EvidencePermissionRuleV2Schema
>;
export const EvidencePermissionRuleSchema = EvidencePermissionRuleV2Schema;
export type EvidencePermissionRule = EvidencePermissionRuleV2;

/**
 * Private witness-specific knowledge limits copied from the pinned CaseGraph.
 * These rules authorize testimony and evidence references; they must never be
 * included in judge or jury policy views.
 */
export const WitnessKnowledgeRuleSchema = z
  .object({
    witnessId: CaseGraphEntityIdSchema,
    knownFactIds: UniqueEntityIdListSchema,
    perceivedFactIds: UniqueEntityIdListSchema,
    seenEvidenceIds: UniqueEntityIdListSchema,
  })
  .strict()
  .superRefine((rule, context) => {
    const knownFactIds = new Set(rule.knownFactIds);
    rule.perceivedFactIds.forEach((factId, index) => {
      if (!knownFactIds.has(factId)) {
        context.addIssue({
          code: "custom",
          path: ["perceivedFactIds", index],
          message: `A perceived fact must also be known: ${factId}`,
        });
      }
    });
  });
export type WitnessKnowledgeRule = z.infer<
  typeof WitnessKnowledgeRuleSchema
>;

/** Exact authority rule persisted by trial-policy-snapshot.v1. */
export const SettlementPartyAuthorityRuleV1Schema = z
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
export type SettlementPartyAuthorityRuleV1 = z.infer<
  typeof SettlementPartyAuthorityRuleV1Schema
>;

export const SettlementPartyAuthorityRuleV2Schema = z
  .object({
    partyId: CaseGraphEntityIdSchema,
    minimumAuthority: z.number().nonnegative(),
    maximumAuthority: z.number().nonnegative(),
    reservationValue: z.number().nonnegative(),
    targetValue: z.number().nonnegative(),
    confidentialPriorities: UniqueStringListSchema,
    permittedNonMonetaryTerms: UniqueStringListSchema,
  })
  .strict()
  .superRefine((authority, context) => {
    if (authority.maximumAuthority < authority.minimumAuthority) {
      context.addIssue({
        code: "custom",
        path: ["maximumAuthority"],
        message: "maximumAuthority must be at least minimumAuthority",
      });
    }
    if (
      authority.reservationValue < authority.minimumAuthority ||
      authority.reservationValue > authority.maximumAuthority
    ) {
      context.addIssue({
        code: "custom",
        path: ["reservationValue"],
        message: "reservationValue must fall within the authority range",
      });
    }
    if (
      authority.targetValue < authority.minimumAuthority ||
      authority.targetValue > authority.maximumAuthority
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetValue"],
        message: "targetValue must fall within the authority range",
      });
    }
  });
export type SettlementPartyAuthorityRuleV2 = z.infer<
  typeof SettlementPartyAuthorityRuleV2Schema
>;
export const SettlementPartyAuthorityRuleSchema =
  SettlementPartyAuthorityRuleV2Schema;
export type SettlementPartyAuthorityRule = SettlementPartyAuthorityRuleV2;

/** Exact procedural settlement shape persisted by policy/view v1. */
export const ProceduralSettlementPolicyV1Schema = z
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
export type ProceduralSettlementPolicyV1 = z.infer<
  typeof ProceduralSettlementPolicyV1Schema
>;

const SETTLEMENT_PHASE_SEQUENCE = [
  "pretrial",
  "opening",
  "case_in_chief",
  "recess",
  "pre_closing",
] as const satisfies readonly SettlementOpenPhase[];

export const ProceduralSettlementPolicyV2Schema = z
  .object({
    enabled: z.boolean(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    opensAtPhase: SettlementOpenPhaseSchema,
    openPhases: uniqueListSchema(SettlementOpenPhaseSchema),
    allowCounteroffers: z.boolean(),
    expiresAfterEventCount: z.number().int().positive(),
    participantPartyIds: UniqueEntityIdListSchema.min(2),
  })
  .strict()
  .superRefine((policy, context) => {
    const opensAtIndex = SETTLEMENT_PHASE_SEQUENCE.indexOf(policy.opensAtPhase);
    const expectedOpenPhases = policy.enabled
      ? SETTLEMENT_PHASE_SEQUENCE.slice(opensAtIndex)
      : [];
    if (
      policy.openPhases.length !== expectedOpenPhases.length ||
      policy.openPhases.some(
        (phase, index) => phase !== expectedOpenPhases[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["openPhases"],
        message:
          "openPhases must be the exact enabled phase suffix beginning at opensAtPhase",
      });
    }
  });
export type ProceduralSettlementPolicyV2 = z.infer<
  typeof ProceduralSettlementPolicyV2Schema
>;
export const ProceduralSettlementPolicySchema =
  ProceduralSettlementPolicyV2Schema;
export type ProceduralSettlementPolicy = ProceduralSettlementPolicyV2;

/** Exact private settlement shape persisted by policy v1. */
export const PrivateSettlementPolicyV1Schema =
  ProceduralSettlementPolicyV1Schema.extend({
    partyAuthorities: z.array(SettlementPartyAuthorityRuleV1Schema),
  }).strict();
export type PrivateSettlementPolicyV1 = z.infer<
  typeof PrivateSettlementPolicyV1Schema
>;

export const PrivateSettlementPolicyV2Schema = z
  .object({
    enabled: z.boolean(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    opensAtPhase: SettlementOpenPhaseSchema,
    openPhases: uniqueListSchema(SettlementOpenPhaseSchema),
    allowCounteroffers: z.boolean(),
    expiresAfterEventCount: z.number().int().positive(),
    participantPartyIds: UniqueEntityIdListSchema.min(2),
    partyAuthorities: uniqueRuleListSchema(
      SettlementPartyAuthorityRuleV2Schema,
      "partyId",
      "settlement authority party",
    ),
  })
  .strict()
  .superRefine((policy, context) => {
    const procedural = ProceduralSettlementPolicyV2Schema.safeParse({
      enabled: policy.enabled,
      currency: policy.currency,
      opensAtPhase: policy.opensAtPhase,
      openPhases: policy.openPhases,
      allowCounteroffers: policy.allowCounteroffers,
      expiresAfterEventCount: policy.expiresAfterEventCount,
      participantPartyIds: policy.participantPartyIds,
    });
    if (!procedural.success) {
      procedural.error.issues.forEach((issue) => {
        context.addIssue({ ...issue, path: issue.path });
      });
    }

    const participantPartyIds = new Set(policy.participantPartyIds);
    const authorityPartyIds = new Set(
      policy.partyAuthorities.map((authority) => authority.partyId),
    );
    policy.participantPartyIds.forEach((partyId, index) => {
      if (!authorityPartyIds.has(partyId)) {
        context.addIssue({
          code: "custom",
          path: ["participantPartyIds", index],
          message: `Settlement participant has no authority rule: ${partyId}`,
        });
      }
    });
    policy.partyAuthorities.forEach((authority, index) => {
      if (!participantPartyIds.has(authority.partyId)) {
        context.addIssue({
          code: "custom",
          path: ["partyAuthorities", index, "partyId"],
          message: `Authority party is not a settlement participant: ${authority.partyId}`,
        });
      }
    });
  });
export type PrivateSettlementPolicyV2 = z.infer<
  typeof PrivateSettlementPolicyV2Schema
>;
export const PrivateSettlementPolicySchema = PrivateSettlementPolicyV2Schema;
export type PrivateSettlementPolicy = PrivateSettlementPolicyV2;

/** Exact policy contract committed at b0fb9d3. */
export const TrialPolicySnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V1),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    mappings: TrialPolicyMappingsSchema,
    witnessCallability: z.array(WitnessCallabilityRuleSchema),
    evidencePermissions: z.array(EvidencePermissionRuleV1Schema),
    permittedObjectionGrounds: z.array(TrialPolicyObjectionGroundSchema).min(1),
    settlement: PrivateSettlementPolicyV1Schema,
  })
  .strict();
export type TrialPolicySnapshotV1 = z.infer<
  typeof TrialPolicySnapshotV1Schema
>;

const WitnessCallabilityRulesV2Schema = uniqueRuleListSchema(
  WitnessCallabilityRuleSchema,
  "witnessId",
  "witness callability rule",
);
const WitnessKnowledgeRulesV2Schema = uniqueRuleListSchema(
  WitnessKnowledgeRuleSchema,
  "witnessId",
  "witness knowledge rule",
);
const EvidencePermissionRulesV2Schema = uniqueRuleListSchema(
  EvidencePermissionRuleV2Schema,
  "evidenceId",
  "evidence permission rule",
);

export const TrialPolicySnapshotV2Schema = z
  .object({
    schemaVersion: z.literal(TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V2),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    mappings: TrialPolicyMappingsSchema,
    witnessCallability: WitnessCallabilityRulesV2Schema,
    witnessKnowledge: WitnessKnowledgeRulesV2Schema,
    evidencePermissions: EvidencePermissionRulesV2Schema,
    permittedObjectionGrounds: uniqueListSchema(
      TrialPolicyObjectionGroundSchema,
    ).min(1),
    settlement: PrivateSettlementPolicyV2Schema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const callableWitnessIds = new Set(
      snapshot.witnessCallability.map((rule) => rule.witnessId),
    );
    const knowledgeWitnessIds = new Set(
      snapshot.witnessKnowledge.map((rule) => rule.witnessId),
    );
    snapshot.witnessCallability.forEach((rule, index) => {
      if (!knowledgeWitnessIds.has(rule.witnessId)) {
        context.addIssue({
          code: "custom",
          path: ["witnessCallability", index, "witnessId"],
          message: `Callable witness has no knowledge rule: ${rule.witnessId}`,
        });
      }
    });
    snapshot.witnessKnowledge.forEach((rule, index) => {
      if (!callableWitnessIds.has(rule.witnessId)) {
        context.addIssue({
          code: "custom",
          path: ["witnessKnowledge", index, "witnessId"],
          message: `Knowledge rule has no callable witness: ${rule.witnessId}`,
        });
      }
    });

    const mappedPartyIds = new Set(
      snapshot.mappings.parties.map((party) => party.partyId),
    );
    snapshot.settlement.participantPartyIds.forEach((partyId, index) => {
      if (!mappedPartyIds.has(partyId)) {
        context.addIssue({
          code: "custom",
          path: ["settlement", "participantPartyIds", index],
          message: `Settlement participant is not a mapped party: ${partyId}`,
        });
      }
    });
  });
export type TrialPolicySnapshotV2 = z.infer<
  typeof TrialPolicySnapshotV2Schema
>;
export const TrialPolicySnapshotSchema = TrialPolicySnapshotV2Schema;
export type TrialPolicySnapshot = TrialPolicySnapshotV2;

/** Exact judge view contract committed at b0fb9d3. */
export const JudgeTrialPolicyViewV1Schema = z
  .object({
    schemaVersion: z.literal(JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V1),
    sourcePolicySchemaVersion: z.literal(
      TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V1,
    ),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    mappings: TrialPolicyMappingsSchema,
    witnessCallability: z.array(WitnessCallabilityRuleSchema),
    evidencePermissions: z.array(EvidencePermissionRuleV1Schema),
    permittedObjectionGrounds: z.array(TrialPolicyObjectionGroundSchema).min(1),
    settlement: ProceduralSettlementPolicyV1Schema,
  })
  .strict();
export type JudgeTrialPolicyViewV1 = z.infer<
  typeof JudgeTrialPolicyViewV1Schema
>;

/** Explicit public evidence rule for judge policy v2. */
export const JudgeEvidencePermissionRuleV2Schema = z
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
export type JudgeEvidencePermissionRuleV2 = z.infer<
  typeof JudgeEvidencePermissionRuleV2Schema
>;

export const JudgeTrialPolicyViewV2Schema = z
  .object({
    schemaVersion: z.literal(JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2),
    sourcePolicySchemaVersion: z.literal(
      TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V2,
    ),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    mappings: TrialPolicyMappingsSchema,
    witnessCallability: WitnessCallabilityRulesV2Schema,
    evidencePermissions: uniqueRuleListSchema(
      JudgeEvidencePermissionRuleV2Schema,
      "evidenceId",
      "judge evidence permission rule",
    ),
    permittedObjectionGrounds: uniqueListSchema(
      TrialPolicyObjectionGroundSchema,
    ).min(1),
    settlement: ProceduralSettlementPolicyV2Schema,
  })
  .strict();
export type JudgeTrialPolicyViewV2 = z.infer<
  typeof JudgeTrialPolicyViewV2Schema
>;
export const JudgeTrialPolicyViewSchema = JudgeTrialPolicyViewV2Schema;
export type JudgeTrialPolicyView = JudgeTrialPolicyViewV2;

/** Exact jury view contract committed at b0fb9d3. */
export const JuryTrialPolicyViewV1Schema = z
  .object({
    schemaVersion: z.literal(JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V1),
    sourcePolicySchemaVersion: z.literal(
      TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V1,
    ),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    permittedObjectionGrounds: z.array(TrialPolicyObjectionGroundSchema).min(1),
  })
  .strict();
export type JuryTrialPolicyViewV1 = z.infer<
  typeof JuryTrialPolicyViewV1Schema
>;

export const JuryTrialPolicyViewV2Schema = z
  .object({
    schemaVersion: z.literal(JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION_V2),
    sourcePolicySchemaVersion: z.literal(
      TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION_V2,
    ),
    caseId: CaseGraphEntityIdSchema,
    caseVersion: z.number().int().positive(),
    jurisdictionProfileId: CaseGraphEntityIdSchema,
    jurisdictionRulesVersion: z.string().trim().min(1),
    permittedObjectionGrounds: uniqueListSchema(
      TrialPolicyObjectionGroundSchema,
    ).min(1),
  })
  .strict();
export type JuryTrialPolicyViewV2 = z.infer<
  typeof JuryTrialPolicyViewV2Schema
>;
export const JuryTrialPolicyViewSchema = JuryTrialPolicyViewV2Schema;
export type JuryTrialPolicyView = JuryTrialPolicyViewV2;

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
