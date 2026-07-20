import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";

/**
 * Product-owned model routing. The contracts remain provider-neutral Zod
 * values; orchestration is responsible for enforcing these exact model roles.
 */
export const COURTROOM_INTERACTIVE_MODEL = "gpt-5.6-luna" as const;
export const COURTROOM_FINAL_DEBRIEF_MODEL = "gpt-5.6-terra" as const;

export const OPPONENT_PLANNER_MODEL = COURTROOM_INTERACTIVE_MODEL;
export const COUNSEL_ROLE_RESPONDER_MODEL = COURTROOM_INTERACTIVE_MODEL;
export const JUDGE_ROLE_RESPONDER_MODEL = COURTROOM_INTERACTIVE_MODEL;
export const JURY_ROLE_RESPONDER_MODEL = COURTROOM_INTERACTIVE_MODEL;
export const OBJECTION_RESOLVER_MODEL = COURTROOM_INTERACTIVE_MODEL;
export const NEGOTIATION_AGENT_MODEL = COURTROOM_INTERACTIVE_MODEL;
export const DEBRIEF_GENERATOR_MODEL = COURTROOM_FINAL_DEBRIEF_MODEL;

export const OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION =
  "opponent-planner.output.v1" as const;
export const COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION =
  "role-responder.counsel.output.v1" as const;
export const JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION =
  "role-responder.judge.output.v1" as const;
export const JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION =
  "role-responder.jury.output.v1" as const;
export const OBJECTION_CANDIDATE_OUTPUT_SCHEMA_VERSION =
  "objection-resolver.candidate.output.v1" as const;
export const OBJECTION_RULING_OUTPUT_SCHEMA_VERSION =
  "objection-resolver.ruling.output.v1" as const;
export const NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION =
  "negotiation-agent.output.v1" as const;
export const DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION =
  "debrief-generator.output.v1" as const;

export const OPPONENT_PLANNER_STRUCTURED_OUTPUT_NAME =
  "suits_opponent_plan_v1" as const;
export const COUNSEL_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME =
  "suits_counsel_response_v1" as const;
export const JUDGE_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME =
  "suits_judge_response_v1" as const;
export const JURY_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME =
  "suits_jury_response_v1" as const;
export const OBJECTION_CANDIDATE_STRUCTURED_OUTPUT_NAME =
  "suits_objection_candidate_v1" as const;
export const OBJECTION_RULING_STRUCTURED_OUTPUT_NAME =
  "suits_objection_ruling_v1" as const;
export const NEGOTIATION_AGENT_STRUCTURED_OUTPUT_NAME =
  "suits_negotiation_decision_v1" as const;
export const DEBRIEF_GENERATOR_STRUCTURED_OUTPUT_NAME =
  "suits_final_debrief_v1" as const;

export const CALL_CONTRACT_SEMANTIC_ISSUE_SCHEMA_VERSION =
  "courtroom-call-contract.semantic-issue.v1" as const;

const shortText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const idList = (maximum: number) =>
  z.array(CaseGraphEntityIdSchema).max(maximum);

export const ObjectionGroundSchema = z.enum([
  "relevance",
  "hearsay",
  "leading",
  "speculation",
  "foundation",
  "asked_and_answered",
  "argumentative",
  "compound",
  "privilege",
]);

/**
 * Model citations are references to existing canonical records only. They do
 * not carry excerpts, factual summaries, or identities for new actions/events.
 */
export const CourtroomModelCitationSetSchema = z
  .object({
    factIds: idList(64),
    evidenceIds: idList(64),
    testimonyIds: idList(64),
    transcriptTurnIds: idList(64),
    sourceSegmentIds: idList(64),
    priorStatementIds: idList(32),
    issueIds: idList(32),
    instructionIds: idList(32),
    ruleIds: idList(16),
    settlementOfferIds: idList(32),
  })
  .strict();

export type CourtroomModelCitationSet = z.infer<
  typeof CourtroomModelCitationSetSchema
>;

/** Renderer-owned semantic allowlist. No arbitrary animation or scene fields. */
export const SemanticPerformanceSchema = z
  .object({
    activity: z.enum([
      "idle",
      "listening",
      "thinking",
      "speaking",
      "objecting",
      "standing",
      "sitting",
      "presenting",
      "reacting",
      "ruling",
    ]),
    emotion: z.enum([
      "neutral",
      "confident",
      "nervous",
      "angry",
      "confused",
      "defensive",
      "empathetic",
    ]),
    intensity: z.number().min(0).max(1),
    gazeTarget: z.enum([
      "none",
      "judge",
      "jury",
      "witness",
      "user_counsel",
      "opposing_counsel",
      "questioning_counsel",
      "evidence_display",
    ]),
    gesture: z.enum([
      "none",
      "small_nod",
      "head_shake",
      "open_palm",
      "lean_forward",
      "stand",
      "sit",
      "indicate_evidence",
      "gavel",
    ]),
    speakingStyle: z.enum([
      "measured",
      "hesitant",
      "firm",
      "soft",
      "distressed",
      "formal",
      "deliberative",
    ]),
  })
  .strict();

export type SemanticPerformance = z.infer<typeof SemanticPerformanceSchema>;

export const CitedSpeechSegmentSchema = z
  .object({
    text: shortText(800),
    citations: CourtroomModelCitationSetSchema,
  })
  .strict();

const PlannerMoveBaseShape = {
  rationale: shortText(1_000),
  citations: CourtroomModelCitationSetSchema,
} as const;

export const OpponentPlannerMoveSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("call_witness"),
      witnessId: CaseGraphEntityIdSchema,
    })
    .strict(),
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("question_witness"),
      witnessId: CaseGraphEntityIdSchema,
      goal: shortText(1_000),
      presentedEvidenceIds: idList(8),
    })
    .strict(),
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("offer_evidence"),
      evidenceId: CaseGraphEntityIdSchema,
      foundationTestimonyIds: idList(16),
    })
    .strict(),
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("object"),
      ground: ObjectionGroundSchema,
    })
    .strict(),
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("move_to_strike"),
      testimonyIds: idList(16),
    })
    .strict(),
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("request_negotiation"),
    })
    .strict(),
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("rest_case"),
    })
    .strict(),
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("give_closing"),
    })
    .strict(),
  z
    .object({
      ...PlannerMoveBaseShape,
      kind: z.literal("no_action"),
    })
    .strict(),
]);

/**
 * Luna proposes priorities and moves. The server supplies strategy identity,
 * revision, owner, action IDs, actors, timestamps, and final authorization.
 */
export const OpponentPlannerModelOutputSchema = z
  .object({
    schemaVersion: z.literal(OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION),
    objectives: z.array(shortText(1_000)).min(1).max(8),
    witnessPriorityIds: idList(16),
    evidencePriorityIds: idList(24),
    settlementPosture: z.enum([
      "avoid",
      "explore",
      "counter",
      "recommend_acceptance",
    ]),
    privateNotes: z.array(shortText(1_000)).max(8),
    proposedMoves: z.array(OpponentPlannerMoveSchema).min(1).max(6),
  })
  .strict();

export type OpponentPlannerModelOutput = z.infer<
  typeof OpponentPlannerModelOutputSchema
>;

export const CounselProposedActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("speak_only") }).strict(),
  z
    .object({
      kind: z.literal("call_witness"),
      witnessId: CaseGraphEntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("recall_witness"),
      witnessId: CaseGraphEntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ask_question"),
      presentedEvidenceIds: idList(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("end_examination"),
      disposition: z.enum(["completed", "waived"]),
    })
    .strict(),
  z.object({ kind: z.literal("release_witness") }).strict(),
  z
    .object({
      kind: z.literal("offer_evidence"),
      evidenceId: CaseGraphEntityIdSchema,
      foundationTestimonyIds: idList(16),
    })
    .strict(),
  z
    .object({
      kind: z.literal("object"),
      ground: ObjectionGroundSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("move_to_strike"),
      testimonyIds: idList(16),
      reason: shortText(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("propose_assertion"),
      proposition: shortText(2_000),
      provenanceIds: idList(24),
      visibility: z.enum(["public", "restricted"]),
    })
    .strict(),
  z.object({ kind: z.literal("request_negotiation") }).strict(),
  z.object({ kind: z.literal("request_recess") }).strict(),
  z.object({ kind: z.literal("rest_case") }).strict(),
  z.object({ kind: z.literal("give_closing") }).strict(),
]);

/** Luna counsel speech plus an action proposal; the engine materializes it. */
export const CounselRoleResponseModelOutputSchema = z
  .object({
    schemaVersion: z.literal(COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION),
    speechSegments: z.array(CitedSpeechSegmentSchema).min(1).max(16),
    proposedAction: CounselProposedActionSchema,
    performance: SemanticPerformanceSchema,
  })
  .strict();

export type CounselRoleResponseModelOutput = z.infer<
  typeof CounselRoleResponseModelOutputSchema
>;

export const JudgeProposedActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("speak_only") }).strict(),
  z.object({ kind: z.literal("maintain_order") }).strict(),
  z
    .object({
      kind: z.literal("rule_on_evidence"),
      ruling: z.enum(["admitted", "excluded"]),
      reason: shortText(2_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rule_on_assertion"),
      ruling: z.enum(["admitted", "excluded"]),
      reason: shortText(2_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rule_on_strike_motion"),
      ruling: z.enum(["granted", "denied"]),
      reason: shortText(2_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("recess_request"),
      ruling: z.enum(["granted", "denied"]),
      reason: shortText(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("instruct_jury"),
      instructionIds: idList(32),
    })
    .strict(),
  z
    .object({
      kind: z.literal("render_verdict"),
      decision: shortText(4_000),
    })
    .strict(),
]);

/** Luna judge proposal. Objection rulings use the dedicated resolver below. */
export const JudgeRoleResponseModelOutputSchema = z
  .object({
    schemaVersion: z.literal(JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION),
    speechSegments: z.array(CitedSpeechSegmentSchema).min(1).max(16),
    proposedAction: JudgeProposedActionSchema,
    performance: SemanticPerformanceSchema,
  })
  .strict();

export type JudgeRoleResponseModelOutput = z.infer<
  typeof JudgeRoleResponseModelOutputSchema
>;

export const JuryFindingSchema = z
  .object({
    conclusion: shortText(2_000),
    weight: z.enum(["weak", "moderate", "strong"]),
    citations: CourtroomModelCitationSetSchema,
  })
  .strict();

/**
 * Luna deliberates from the jury-safe KnowledgeView. The recommendation is not
 * a verdict event; the deterministic engine decides whether/how to commit it.
 */
export const JuryRoleResponseModelOutputSchema = z
  .object({
    schemaVersion: z.literal(JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION),
    deliberationSegments: z.array(CitedSpeechSegmentSchema).min(1).max(16),
    findings: z.array(JuryFindingSchema).min(1).max(24),
    recommendation: z
      .object({
        outcome: z.enum([
          "user_prevails",
          "opposing_prevails",
          "mixed",
          "unable_to_reach",
        ]),
        decision: shortText(4_000),
        confidence: z.number().min(0).max(1),
      })
      .strict(),
    performance: SemanticPerformanceSchema,
  })
  .strict();

export type JuryRoleResponseModelOutput = z.infer<
  typeof JuryRoleResponseModelOutputSchema
>;

/** Luna candidate mode never selects an objector or target question/response. */
export const ObjectionCandidateModelOutputSchema = z
  .object({
    schemaVersion: z.literal(OBJECTION_CANDIDATE_OUTPUT_SCHEMA_VERSION),
    decision: z.enum(["object", "do_not_object"]),
    ground: ObjectionGroundSchema.nullable(),
    confidence: z.number().min(0).max(1),
    materiality: z.enum(["low", "medium", "high"]),
    explanation: shortText(600),
    citations: CourtroomModelCitationSetSchema,
  })
  .strict();

export type ObjectionCandidateModelOutput = z.infer<
  typeof ObjectionCandidateModelOutputSchema
>;

/**
 * Luna ruling mode proposes only ruling/remedy/reason. The server derives the
 * pending objection and judge identities before engine validation.
 */
export const ObjectionRulingModelOutputSchema = z
  .object({
    schemaVersion: z.literal(OBJECTION_RULING_OUTPUT_SCHEMA_VERSION),
    ruling: z.enum(["sustained", "overruled"]),
    remedy: z.enum([
      "none",
      "rephrase",
      "cancel_response",
      "resume_response",
    ]),
    reason: shortText(2_000),
    citations: CourtroomModelCitationSetSchema,
    performance: SemanticPerformanceSchema,
  })
  .strict();

export type ObjectionRulingModelOutput = z.infer<
  typeof ObjectionRulingModelOutputSchema
>;

export const NegotiationTermsProposalSchema = z
  .object({
    amount: z.number().nonnegative().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    nonMonetaryTerms: z.array(shortText(500)).max(12),
    summary: shortText(2_000),
  })
  .strict();

/**
 * Luna makes a private recommendation. Offer/parent/party IDs, expiry, and the
 * final settlement action are server-derived and policy-checked.
 */
export const NegotiationAgentModelOutputSchema = z
  .object({
    schemaVersion: z.literal(NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION),
    recommendation: z.enum([
      "propose",
      "counter",
      "accept",
      "reject",
      "withdraw",
      "hold",
    ]),
    utilityBand: z.enum([
      "below_reservation",
      "within_authority",
      "at_or_above_target",
      "non_monetary_tradeoff",
    ]),
    terms: NegotiationTermsProposalSchema.nullable(),
    decisionSummary: shortText(1_500),
    citations: CourtroomModelCitationSetSchema,
    performance: SemanticPerformanceSchema,
  })
  .strict();

export type NegotiationAgentModelOutput = z.infer<
  typeof NegotiationAgentModelOutputSchema
>;

/** Debrief citations preserve which audit-record stratum supports each claim. */
export const DebriefCitationSetSchema = z
  .object({
    admittedFactIds: idList(128),
    admittedEvidenceIds: idList(128),
    activeTestimonyIds: idList(128),
    transcriptTurnIds: idList(128),
    unadmittedFactIds: idList(128),
    unadmittedEvidenceIds: idList(128),
    excludedFactIds: idList(128),
    excludedEvidenceIds: idList(128),
    strickenTestimonyIds: idList(128),
    hiddenFactIds: idList(128),
    hiddenSourceSegmentIds: idList(128),
    coachingInferenceIds: idList(128),
  })
  .strict();

export type DebriefCitationSet = z.infer<typeof DebriefCitationSetSchema>;

export const DebriefCoachingPointSchema = z
  .object({
    title: shortText(200),
    assessment: shortText(2_000),
    recommendation: shortText(2_000),
    basis: z.enum([
      "admitted_record",
      "unadmitted_record",
      "excluded_or_stricken",
      "hidden_authoring_truth",
      "coaching_inference",
      "mixed",
    ]),
    citations: DebriefCitationSetSchema,
  })
  .strict();

export const DebriefOverallAssessmentSchema = z
  .object({
    text: shortText(4_000),
    basis: z.enum([
      "admitted_record",
      "unadmitted_record",
      "excluded_or_stricken",
      "hidden_authoring_truth",
      "coaching_inference",
      "mixed",
    ]),
    citations: DebriefCitationSetSchema,
  })
  .strict();

export const ImprovedClosingSegmentSchema = z
  .object({
    text: shortText(1_000),
    citations: DebriefCitationSetSchema,
  })
  .strict();

/** Terra final coaching artifact. No debrief/event identity is model-owned. */
export const DebriefGeneratorModelOutputSchema = z
  .object({
    schemaVersion: z.literal(DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION),
    overallAssessment: DebriefOverallAssessmentSchema,
    strengths: z.array(DebriefCoachingPointSchema).min(1).max(12),
    weakQuestions: z.array(DebriefCoachingPointSchema).max(12),
    missedEvidence: z.array(DebriefCoachingPointSchema).max(12),
    contradictions: z.array(DebriefCoachingPointSchema).max(12),
    objectionAccuracy: z.array(DebriefCoachingPointSchema).max(12),
    witnessStrategy: z.array(DebriefCoachingPointSchema).max(12),
    settlementChoices: z.array(DebriefCoachingPointSchema).max(12),
    juryMovement: z.array(DebriefCoachingPointSchema).max(12),
    improvedClosing: z
      .object({
        // A trial settled before any admissible proof exists has no honest
        // record-grounded closing to improve. Request-aware validation still
        // requires at least one segment whenever admitted proof is present.
        segments: z.array(ImprovedClosingSegmentSchema).max(16),
      })
      .strict(),
    limitations: z.array(shortText(1_000)).min(1).max(12),
  })
  .strict();

export type DebriefGeneratorModelOutput = z.infer<
  typeof DebriefGeneratorModelOutputSchema
>;

export const CallContractSemanticIssueCodeSchema = z.enum([
  "duplicate_reference",
  "citation_required",
  "target_not_cited",
  "proposal_conflict",
  "performance_mismatch",
  "decision_shape_mismatch",
  "remedy_mismatch",
  "terms_mismatch",
  "citation_stratum_mismatch",
]);

export const CallContractSemanticIssueSchema = z
  .object({
    schemaVersion: z.literal(CALL_CONTRACT_SEMANTIC_ISSUE_SCHEMA_VERSION),
    code: CallContractSemanticIssueCodeSchema,
    path: z
      .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
      .max(16),
    message: shortText(500),
  })
  .strict();

export type CallContractSemanticIssue = z.infer<
  typeof CallContractSemanticIssueSchema
>;

type IssuePath = CallContractSemanticIssue["path"];
type CitationField = keyof CourtroomModelCitationSet;

function issue(
  code: CallContractSemanticIssue["code"],
  path: IssuePath,
  message: string,
): CallContractSemanticIssue {
  return CallContractSemanticIssueSchema.parse({
    schemaVersion: CALL_CONTRACT_SEMANTIC_ISSUE_SCHEMA_VERSION,
    code,
    path,
    message,
  });
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function duplicateListIssues(
  values: readonly string[],
  path: IssuePath,
): CallContractSemanticIssue[] {
  return hasDuplicates(values)
    ? [
        issue(
          "duplicate_reference",
          path,
          "Referenced IDs must be unique within each list",
        ),
      ]
    : [];
}

function citationIssues(
  citations: CourtroomModelCitationSet,
  path: IssuePath,
): CallContractSemanticIssue[] {
  return (Object.keys(citations) as CitationField[]).flatMap((field) =>
    duplicateListIssues(citations[field], [...path, field]),
  );
}

function hasAnyCitation(citations: CourtroomModelCitationSet): boolean {
  return (Object.values(citations) as string[][]).some(
    (identifiers) => identifiers.length > 0,
  );
}

function segmentCitationIssues(
  segments: readonly z.infer<typeof CitedSpeechSegmentSchema>[],
  path: string,
): CallContractSemanticIssue[] {
  return segments.flatMap((segment, index) =>
    citationIssues(segment.citations, [path, index, "citations"]),
  );
}

function citedIds(
  segments: readonly z.infer<typeof CitedSpeechSegmentSchema>[],
  field: CitationField,
): Set<string> {
  return new Set(segments.flatMap((segment) => segment.citations[field]));
}

function targetCitedIssue(
  targetId: string,
  citations: ReadonlySet<string>,
  path: IssuePath,
  description: string,
): CallContractSemanticIssue[] {
  return citations.has(targetId)
    ? []
    : [issue("target_not_cited", path, `${description} must be cited by ID`)];
}

function targetsCitedIssues(
  targetIds: readonly string[],
  citations: ReadonlySet<string>,
  path: IssuePath,
  description: string,
): CallContractSemanticIssue[] {
  return targetIds.flatMap((targetId, index) =>
    targetCitedIssue(targetId, citations, [...path, index], description),
  );
}

function performanceIssues(
  performance: SemanticPerformance,
  options: Readonly<{
    allowedActivities: readonly SemanticPerformance["activity"][];
    allowGavel: boolean;
    hasEvidenceCitation: boolean;
    path: string;
  }>,
): CallContractSemanticIssue[] {
  const issues: CallContractSemanticIssue[] = [];
  if (!options.allowedActivities.includes(performance.activity)) {
    issues.push(
      issue(
        "performance_mismatch",
        [options.path, "activity"],
        "The requested activity is not valid for this role response",
      ),
    );
  }
  if (performance.gesture === "gavel" && !options.allowGavel) {
    issues.push(
      issue(
        "performance_mismatch",
        [options.path, "gesture"],
        "Only a judge ruling may request the gavel gesture",
      ),
    );
  }
  if (
    (performance.activity === "presenting" ||
      performance.gesture === "indicate_evidence" ||
      performance.gazeTarget === "evidence_display") &&
    !options.hasEvidenceCitation
  ) {
    issues.push(
      issue(
        "performance_mismatch",
        [options.path],
        "Evidence-directed performance requires an evidence citation",
      ),
    );
  }
  return issues;
}

/** Validate planner relationships after strict parsing and before engine use. */
export function validateOpponentPlannerSemantics(
  output: OpponentPlannerModelOutput,
): CallContractSemanticIssue[] {
  const issues = [
    ...duplicateListIssues(output.witnessPriorityIds, ["witnessPriorityIds"]),
    ...duplicateListIssues(output.evidencePriorityIds, ["evidencePriorityIds"]),
  ];
  const noActionIndex = output.proposedMoves.findIndex(
    (move) => move.kind === "no_action",
  );
  if (noActionIndex >= 0 && output.proposedMoves.length !== 1) {
    issues.push(
      issue(
        "proposal_conflict",
        ["proposedMoves", noActionIndex],
        "A no-action proposal cannot be combined with other moves",
      ),
    );
  }
  output.proposedMoves.forEach((move, index) => {
    issues.push(
      ...citationIssues(move.citations, ["proposedMoves", index, "citations"]),
    );
    if (move.kind === "question_witness") {
      issues.push(
        ...duplicateListIssues(move.presentedEvidenceIds, [
          "proposedMoves",
          index,
          "presentedEvidenceIds",
        ]),
        ...targetsCitedIssues(
          move.presentedEvidenceIds,
          new Set(move.citations.evidenceIds),
          ["proposedMoves", index, "presentedEvidenceIds"],
          "Presented evidence",
        ),
      );
    }
    if (move.kind === "offer_evidence") {
      issues.push(
        ...targetCitedIssue(
          move.evidenceId,
          new Set(move.citations.evidenceIds),
          ["proposedMoves", index, "evidenceId"],
          "Offered evidence",
        ),
        ...duplicateListIssues(move.foundationTestimonyIds, [
          "proposedMoves",
          index,
          "foundationTestimonyIds",
        ]),
        ...targetsCitedIssues(
          move.foundationTestimonyIds,
          new Set(move.citations.testimonyIds),
          ["proposedMoves", index, "foundationTestimonyIds"],
          "Foundation testimony",
        ),
      );
    }
    if (move.kind === "move_to_strike") {
      issues.push(
        ...duplicateListIssues(move.testimonyIds, [
          "proposedMoves",
          index,
          "testimonyIds",
        ]),
        ...targetsCitedIssues(
          move.testimonyIds,
          new Set(move.citations.testimonyIds),
          ["proposedMoves", index, "testimonyIds"],
          "Target testimony",
        ),
      );
    }
    if (
      move.kind === "request_negotiation" &&
      output.settlementPosture === "avoid"
    ) {
      issues.push(
        issue(
          "proposal_conflict",
          ["proposedMoves", index, "kind"],
          "A negotiation move conflicts with an avoid-settlement posture",
        ),
      );
    }
  });
  return issues;
}

/** Validate counsel proposal/citation/performance relationships after parsing. */
export function validateCounselRoleResponseSemantics(
  output: CounselRoleResponseModelOutput,
): CallContractSemanticIssue[] {
  const issues = segmentCitationIssues(output.speechSegments, "speechSegments");
  const evidenceCitations = citedIds(output.speechSegments, "evidenceIds");
  const testimonyCitations = citedIds(output.speechSegments, "testimonyIds");
  const allCitationIds = new Set(
    output.speechSegments.flatMap((segment) =>
      Object.values(segment.citations).flat(),
    ),
  );
  const action = output.proposedAction;

  if (action.kind === "ask_question") {
    issues.push(
      ...duplicateListIssues(action.presentedEvidenceIds, [
        "proposedAction",
        "presentedEvidenceIds",
      ]),
      ...targetsCitedIssues(
        action.presentedEvidenceIds,
        evidenceCitations,
        ["proposedAction", "presentedEvidenceIds"],
        "Presented evidence",
      ),
    );
  }
  if (action.kind === "offer_evidence") {
    issues.push(
      ...targetCitedIssue(
        action.evidenceId,
        evidenceCitations,
        ["proposedAction", "evidenceId"],
        "Offered evidence",
      ),
      ...duplicateListIssues(action.foundationTestimonyIds, [
        "proposedAction",
        "foundationTestimonyIds",
      ]),
      ...targetsCitedIssues(
        action.foundationTestimonyIds,
        testimonyCitations,
        ["proposedAction", "foundationTestimonyIds"],
        "Foundation testimony",
      ),
    );
  }
  if (action.kind === "move_to_strike") {
    issues.push(
      ...duplicateListIssues(action.testimonyIds, [
        "proposedAction",
        "testimonyIds",
      ]),
      ...targetsCitedIssues(
        action.testimonyIds,
        testimonyCitations,
        ["proposedAction", "testimonyIds"],
        "Target testimony",
      ),
    );
  }
  if (action.kind === "propose_assertion") {
    issues.push(
      ...duplicateListIssues(action.provenanceIds, [
        "proposedAction",
        "provenanceIds",
      ]),
      ...targetsCitedIssues(
        action.provenanceIds,
        allCitationIds,
        ["proposedAction", "provenanceIds"],
        "Assertion provenance",
      ),
    );
  }
  if (
    action.kind === "give_closing" &&
    !output.speechSegments.some((segment) => hasAnyCitation(segment.citations))
  ) {
    issues.push(
      issue(
        "citation_required",
        ["speechSegments"],
        "A proposed closing requires record citations",
      ),
    );
  }
  if (
    action.kind === "object" &&
    output.performance.activity !== "objecting"
  ) {
    issues.push(
      issue(
        "performance_mismatch",
        ["performance", "activity"],
        "An objection proposal must request the objecting activity",
      ),
    );
  }
  if (
    action.kind !== "object" &&
    output.performance.activity === "objecting"
  ) {
    issues.push(
      issue(
        "performance_mismatch",
        ["performance", "activity"],
        "Objecting performance requires an objection proposal",
      ),
    );
  }
  issues.push(
    ...performanceIssues(output.performance, {
      allowedActivities: [
        "thinking",
        "speaking",
        "objecting",
        "standing",
        "sitting",
        "presenting",
        "reacting",
      ],
      allowGavel: false,
      hasEvidenceCitation: evidenceCitations.size > 0,
      path: "performance",
    }),
  );
  return issues;
}

/** Validate judge proposal/citation/performance relationships after parsing. */
export function validateJudgeRoleResponseSemantics(
  output: JudgeRoleResponseModelOutput,
): CallContractSemanticIssue[] {
  const issues = segmentCitationIssues(output.speechSegments, "speechSegments");
  const evidenceCitations = citedIds(output.speechSegments, "evidenceIds");
  const testimonyCitations = citedIds(output.speechSegments, "testimonyIds");
  const instructionCitations = citedIds(output.speechSegments, "instructionIds");
  const action = output.proposedAction;
  const isRuling = [
    "rule_on_evidence",
    "rule_on_assertion",
    "rule_on_strike_motion",
    "recess_request",
    "render_verdict",
  ].includes(action.kind);

  if (action.kind === "rule_on_evidence") {
    if (evidenceCitations.size === 0) {
      issues.push(
        issue(
          "citation_required",
          ["speechSegments"],
          "An evidence ruling must cite the server-selected pending exhibit",
        ),
      );
    }
  }
  if (action.kind === "rule_on_assertion") {
    if (citedIds(output.speechSegments, "factIds").size === 0) {
      issues.push(
        issue(
          "citation_required",
          ["speechSegments"],
          "An assertion ruling must cite the server-selected pending fact",
        ),
      );
    }
  }
  if (action.kind === "rule_on_strike_motion") {
    if (testimonyCitations.size === 0) {
      issues.push(
        issue(
          "citation_required",
          ["speechSegments"],
          "A strike ruling must cite the server-selected pending testimony",
        ),
      );
    }
  }
  if (action.kind === "instruct_jury") {
    issues.push(
      ...duplicateListIssues(action.instructionIds, [
        "proposedAction",
        "instructionIds",
      ]),
      ...targetsCitedIssues(
        action.instructionIds,
        instructionCitations,
        ["proposedAction", "instructionIds"],
        "Jury instruction",
      ),
    );
  }
  if (
    action.kind === "render_verdict" &&
    !output.speechSegments.some((segment) => hasAnyCitation(segment.citations))
  ) {
    issues.push(
      issue(
        "citation_required",
        ["speechSegments"],
        "A verdict recommendation requires jury-considerable citations",
      ),
    );
  }
  if (isRuling && output.performance.activity !== "ruling") {
    issues.push(
      issue(
        "performance_mismatch",
        ["performance", "activity"],
        "A judge ruling proposal must request the ruling activity",
      ),
    );
  }
  issues.push(
    ...performanceIssues(output.performance, {
      allowedActivities: [
        "listening",
        "thinking",
        "speaking",
        "standing",
        "sitting",
        "reacting",
        "ruling",
      ],
      allowGavel: isRuling || action.kind === "maintain_order",
      hasEvidenceCitation: evidenceCitations.size > 0,
      path: "performance",
    }),
  );
  return issues;
}

/** Validate jury grounding and renderer-safe performance after strict parsing. */
export function validateJuryRoleResponseSemantics(
  output: JuryRoleResponseModelOutput,
): CallContractSemanticIssue[] {
  const issues = segmentCitationIssues(
    output.deliberationSegments,
    "deliberationSegments",
  );
  output.deliberationSegments.forEach((segment, index) => {
    if (!hasAnyCitation(segment.citations)) {
      issues.push(
        issue(
          "citation_required",
          ["deliberationSegments", index, "citations"],
          "Each deliberation segment requires jury-record citations",
        ),
      );
    }
  });
  output.findings.forEach((finding, index) => {
    issues.push(
      ...citationIssues(finding.citations, ["findings", index, "citations"]),
    );
    if (!hasAnyCitation(finding.citations)) {
      issues.push(
        issue(
          "citation_required",
          ["findings", index, "citations"],
          "Each jury finding requires jury-record citations",
        ),
      );
    }
  });
  const evidenceCited = [
    ...output.deliberationSegments,
    ...output.findings,
  ].some((item) => item.citations.evidenceIds.length > 0);
  issues.push(
    ...performanceIssues(output.performance, {
      allowedActivities: ["listening", "thinking", "speaking", "reacting"],
      allowGavel: false,
      hasEvidenceCitation: evidenceCited,
      path: "performance",
    }),
  );
  return issues;
}

export function validateObjectionCandidateSemantics(
  output: ObjectionCandidateModelOutput,
): CallContractSemanticIssue[] {
  const issues = citationIssues(output.citations, ["citations"]);
  if (
    (output.decision === "object" && output.ground === null) ||
    (output.decision === "do_not_object" && output.ground !== null)
  ) {
    issues.push(
      issue(
        "decision_shape_mismatch",
        ["ground"],
        "Object requires a ground; do-not-object must not propose one",
      ),
    );
  }
  return issues;
}

export type ObjectionRulingSemanticContext = Readonly<{
  interruptedResponse: boolean;
}>;

export function validateObjectionRulingSemantics(
  output: ObjectionRulingModelOutput,
  context: ObjectionRulingSemanticContext,
): CallContractSemanticIssue[] {
  const issues = citationIssues(output.citations, ["citations"]);
  const permittedRemedies =
    output.ruling === "overruled"
      ? [context.interruptedResponse ? "resume_response" : "none"]
      : context.interruptedResponse
        ? ["cancel_response", "rephrase"]
        : ["rephrase"];
  if (!permittedRemedies.includes(output.remedy)) {
    issues.push(
      issue(
        "remedy_mismatch",
        ["remedy"],
        `The proposed remedy is invalid for this ${output.ruling} ruling context`,
      ),
    );
  }
  issues.push(
    ...performanceIssues(output.performance, {
      allowedActivities: ["speaking", "standing", "ruling"],
      allowGavel: true,
      hasEvidenceCitation: output.citations.evidenceIds.length > 0,
      path: "performance",
    }),
  );
  if (output.performance.activity !== "ruling") {
    issues.push(
      issue(
        "performance_mismatch",
        ["performance", "activity"],
        "An objection ruling must request the ruling activity",
      ),
    );
  }
  return issues;
}

export function validateNegotiationAgentSemantics(
  output: NegotiationAgentModelOutput,
): CallContractSemanticIssue[] {
  const issues = citationIssues(output.citations, ["citations"]);
  const requiresTerms =
    output.recommendation === "propose" || output.recommendation === "counter";
  if (requiresTerms !== (output.terms !== null)) {
    issues.push(
      issue(
        "terms_mismatch",
        ["terms"],
        "Only propose/counter recommendations carry new settlement terms",
      ),
    );
  }
  if (
    output.terms !== null &&
    (output.terms.amount === null) !== (output.terms.currency === null)
  ) {
    issues.push(
      issue(
        "terms_mismatch",
        ["terms", "currency"],
        "Monetary amount and currency must either both be present or both be null",
      ),
    );
  }
  if (
    ["counter", "accept", "reject", "withdraw"].includes(
      output.recommendation,
    ) &&
    output.citations.settlementOfferIds.length === 0
  ) {
    issues.push(
      issue(
        "citation_required",
        ["citations", "settlementOfferIds"],
        "This recommendation must cite the existing settlement offer by ID",
      ),
    );
  }
  issues.push(
    ...performanceIssues(output.performance, {
      allowedActivities: ["thinking", "speaking", "reacting"],
      allowGavel: false,
      hasEvidenceCitation: output.citations.evidenceIds.length > 0,
      path: "performance",
    }),
  );
  return issues;
}

type DebriefBasis = z.infer<typeof DebriefCoachingPointSchema>["basis"];

function debriefCitationIssues(
  citations: DebriefCitationSet,
  path: IssuePath,
): CallContractSemanticIssue[] {
  return (Object.keys(citations) as (keyof DebriefCitationSet)[]).flatMap(
    (field) => duplicateListIssues(citations[field], [...path, field]),
  );
}

function debriefCitationCount(citations: DebriefCitationSet): number {
  return (Object.values(citations) as string[][]).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function hasAdmittedProofCitation(citations: DebriefCitationSet): boolean {
  return (
    citations.admittedFactIds.length > 0 ||
    citations.admittedEvidenceIds.length > 0 ||
    citations.activeTestimonyIds.length > 0
  );
}

function debriefStrata(citations: DebriefCitationSet): ReadonlySet<DebriefBasis> {
  const strata = new Set<DebriefBasis>();
  if (
    citations.admittedFactIds.length > 0 ||
    citations.admittedEvidenceIds.length > 0 ||
    citations.activeTestimonyIds.length > 0 ||
    citations.transcriptTurnIds.length > 0
  ) {
    strata.add("admitted_record");
  }
  if (
    citations.excludedFactIds.length > 0 ||
    citations.excludedEvidenceIds.length > 0 ||
    citations.strickenTestimonyIds.length > 0
  ) {
    strata.add("excluded_or_stricken");
  }
  if (
    citations.unadmittedFactIds.length > 0 ||
    citations.unadmittedEvidenceIds.length > 0
  ) {
    strata.add("unadmitted_record");
  }
  if (
    citations.hiddenFactIds.length > 0 ||
    citations.hiddenSourceSegmentIds.length > 0
  ) {
    strata.add("hidden_authoring_truth");
  }
  if (citations.coachingInferenceIds.length > 0) {
    strata.add("coaching_inference");
  }
  return strata;
}

function debriefGroundingIssues(
  basis: DebriefBasis,
  citations: DebriefCitationSet,
  path: IssuePath,
): CallContractSemanticIssue[] {
  const issues = debriefCitationIssues(citations, [...path, "citations"]);
  if (debriefCitationCount(citations) === 0) {
    issues.push(
      issue(
        "citation_required",
        [...path, "citations"],
        "Every coaching claim requires audit-record citations",
      ),
    );
    return issues;
  }
  const strata = debriefStrata(citations);
  const basisMatches =
    basis === "mixed"
      ? strata.size >= 2
      : strata.size === 1 && strata.has(basis);
  if (!basisMatches) {
    issues.push(
      issue(
        "citation_stratum_mismatch",
        [...path, "basis"],
        "The declared coaching basis must match its citation strata",
      ),
    );
  }
  return issues;
}

function debriefPointIssues(
  point: z.infer<typeof DebriefCoachingPointSchema>,
  path: IssuePath,
): CallContractSemanticIssue[] {
  return debriefGroundingIssues(point.basis, point.citations, path);
}

export function validateDebriefGeneratorSemantics(
  output: DebriefGeneratorModelOutput,
): CallContractSemanticIssue[] {
  const issues: CallContractSemanticIssue[] = [
    ...debriefGroundingIssues(
      output.overallAssessment.basis,
      output.overallAssessment.citations,
      ["overallAssessment"],
    ),
  ];
  const pointGroups = [
    ["strengths", output.strengths],
    ["weakQuestions", output.weakQuestions],
    ["missedEvidence", output.missedEvidence],
    ["contradictions", output.contradictions],
    ["objectionAccuracy", output.objectionAccuracy],
    ["witnessStrategy", output.witnessStrategy],
    ["settlementChoices", output.settlementChoices],
    ["juryMovement", output.juryMovement],
  ] as const;
  pointGroups.forEach(([field, points]) => {
    points.forEach((point, index) => {
      issues.push(...debriefPointIssues(point, [field, index]));
    });
  });

  output.improvedClosing.segments.forEach((segment, index) => {
    const path: IssuePath = ["improvedClosing", "segments", index, "citations"];
    issues.push(...debriefCitationIssues(segment.citations, path));
    const strata = debriefStrata(segment.citations);
    if (
      debriefCitationCount(segment.citations) === 0 ||
      strata.size !== 1 ||
      !strata.has("admitted_record")
    ) {
      issues.push(
        issue(
          "citation_stratum_mismatch",
          path,
          "Improved closing segments may rely only on admitted-record citations",
        ),
      );
    }
    if (!hasAdmittedProofCitation(segment.citations)) {
      issues.push(
        issue(
          "citation_required",
          path,
          "Improved closing segments require admitted fact, evidence, or active-testimony support",
        ),
      );
    }
    if (segment.citations.transcriptTurnIds.length > 0) {
      issues.push(
        issue(
          "citation_stratum_mismatch",
          [...path, "transcriptTurnIds"],
          "Improved closing segments must cite admitted proof directly, not transcript advocacy",
        ),
      );
    }
  });
  return issues;
}
