import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { OpponentPlannerKnowledgeViewSchema } from "../knowledge";
import { TrialPhaseSchema } from "../trial-engine";
import {
  ObjectionGroundSchema,
  OpponentPlannerModelOutputSchema,
  validateOpponentPlannerSemantics,
  type CourtroomModelCitationSet,
  type OpponentPlannerModelOutput,
} from "./call-contracts";

export const OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION =
  "opponent-planner.request.v1" as const;
export const OPPONENT_PLANNER_VALIDATION_SCHEMA_VERSION =
  "opponent-planner.validation.v1" as const;

const UniqueIdListSchema = (maximum: number) =>
  z
    .array(CaseGraphEntityIdSchema)
    .max(maximum)
    .superRefine((identifiers, context) => {
      const seen = new Set<string>();
      identifiers.forEach((identifier, index) => {
        if (seen.has(identifier)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: "Identifiers must be unique",
          });
        }
        seen.add(identifier);
      });
    });

export const OpponentPlannerProcedureSchema = z
  .object({
    phase: TrialPhaseSchema,
    trigger: z.enum([
      "player_examination_completed",
      "opponent_turn_continues",
      "case_in_chief_idle",
      "pre_closing",
    ]),
    activeAppearanceId: CaseGraphEntityIdSchema.nullable(),
    activeWitnessId: CaseGraphEntityIdSchema.nullable(),
    activeExaminationKind: z
      .enum(["direct", "cross", "redirect", "recross"])
      .nullable(),
    answeredQuestionCount: z.number().int().nonnegative(),
  })
  .strict();

export const OpponentPlannerOpportunitiesSchema = z
  .object({
    callableWitnessIds: UniqueIdListSchema(64),
    questionableWitnessIds: UniqueIdListSchema(4),
    presentableEvidenceIds: UniqueIdListSchema(64),
    offerableEvidenceIds: UniqueIdListSchema(64),
    foundationTestimonyIds: UniqueIdListSchema(128),
    strikeableTestimonyIds: UniqueIdListSchema(128),
    permittedObjectionGrounds: z.array(ObjectionGroundSchema).max(16),
    canObject: z.boolean(),
    canRequestNegotiation: z.boolean(),
    canRest: z.boolean(),
    canClose: z.boolean(),
  })
  .strict();

export const OpponentPlannerRequestSchema = z
  .object({
    schemaVersion: z.literal(OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION),
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    trialId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    procedure: OpponentPlannerProcedureSchema,
    opportunities: OpponentPlannerOpportunitiesSchema,
    knowledgeView: OpponentPlannerKnowledgeViewSchema,
  })
  .strict();

export const OpponentPlannerValidationIssueCodeSchema = z.enum([
  "strict_schema_invalid",
  "semantic_contract_invalid",
  "unknown_witness_reference",
  "unknown_evidence_reference",
  "unknown_testimony_reference",
  "unknown_fact_citation",
  "unknown_evidence_citation",
  "unknown_testimony_citation",
  "unknown_transcript_turn_citation",
  "unknown_source_segment_citation",
  "unknown_prior_statement_citation",
  "unknown_issue_citation",
  "unknown_instruction_citation",
  "unknown_rule_citation",
  "unknown_settlement_offer_citation",
  "move_not_available",
  "objection_ground_not_permitted",
]);

export const OpponentPlannerValidationIssueSchema = z
  .object({
    code: OpponentPlannerValidationIssueCodeSchema,
    path: z
      .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
      .max(16),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const OpponentPlannerValidationReportSchema = z
  .object({
    schemaVersion: z.literal(OPPONENT_PLANNER_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["accepted", "rejected"]),
    issues: z.array(OpponentPlannerValidationIssueSchema).max(200),
  })
  .strict();

export type OpponentPlannerRequest = z.infer<
  typeof OpponentPlannerRequestSchema
>;
export type OpponentPlannerValidationIssue = z.infer<
  typeof OpponentPlannerValidationIssueSchema
>;
export type OpponentPlannerValidationReport = z.infer<
  typeof OpponentPlannerValidationReportSchema
>;
export type OpponentPlannerOutputValidationResult =
  | Readonly<{
      accepted: true;
      output: OpponentPlannerModelOutput;
      report: OpponentPlannerValidationReport;
    }>
  | Readonly<{
      accepted: false;
      report: OpponentPlannerValidationReport;
    }>;

type IssuePath = OpponentPlannerValidationIssue["path"];

function issue(
  code: OpponentPlannerValidationIssue["code"],
  path: IssuePath,
  message: string,
): OpponentPlannerValidationIssue {
  return OpponentPlannerValidationIssueSchema.parse({ code, path, message });
}

function report(
  issues: OpponentPlannerValidationIssue[],
): OpponentPlannerValidationReport {
  return OpponentPlannerValidationReportSchema.parse({
    schemaVersion: OPPONENT_PLANNER_VALIDATION_SCHEMA_VERSION,
    status: issues.length === 0 ? "accepted" : "rejected",
    issues,
  });
}

type CitationField = keyof CourtroomModelCitationSet;

const CITATION_ISSUE_CODE: Readonly<
  Record<
    CitationField,
    Extract<
      OpponentPlannerValidationIssue["code"],
      | "unknown_fact_citation"
      | "unknown_evidence_citation"
      | "unknown_testimony_citation"
      | "unknown_transcript_turn_citation"
      | "unknown_source_segment_citation"
      | "unknown_prior_statement_citation"
      | "unknown_issue_citation"
      | "unknown_instruction_citation"
      | "unknown_rule_citation"
      | "unknown_settlement_offer_citation"
    >
  >
> = {
  factIds: "unknown_fact_citation",
  evidenceIds: "unknown_evidence_citation",
  testimonyIds: "unknown_testimony_citation",
  transcriptTurnIds: "unknown_transcript_turn_citation",
  sourceSegmentIds: "unknown_source_segment_citation",
  priorStatementIds: "unknown_prior_statement_citation",
  issueIds: "unknown_issue_citation",
  instructionIds: "unknown_instruction_citation",
  ruleIds: "unknown_rule_citation",
  settlementOfferIds: "unknown_settlement_offer_citation",
};

function citationScope(
  request: OpponentPlannerRequest,
): Readonly<Record<CitationField, ReadonlySet<string>>> {
  const { counsel, publicRecord } = request.knowledgeView;
  return {
    factIds: new Set([
      ...counsel.facts.map((fact) => fact.factId),
      ...publicRecord.facts.map((fact) => fact.factId),
    ]),
    evidenceIds: new Set([
      ...counsel.evidence.map((evidence) => evidence.evidenceId),
      ...publicRecord.evidence.map((evidence) => evidence.evidenceId),
    ]),
    testimonyIds: new Set(
      publicRecord.testimony.map((testimony) => testimony.testimonyId),
    ),
    transcriptTurnIds: new Set(),
    sourceSegmentIds: new Set([
      ...publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
      ...publicRecord.evidence.flatMap(
        (evidence) => evidence.sourceSegmentIds,
      ),
    ]),
    priorStatementIds: new Set(),
    issueIds: new Set(),
    instructionIds: new Set(
      publicRecord.instructions.map((instruction) => instruction.instructionId),
    ),
    ruleIds: new Set(),
    settlementOfferIds: new Set(
      counsel.privateSettlement?.offers.map((offer) => offer.offerId) ?? [],
    ),
  };
}

function citationScopeIssues(
  request: OpponentPlannerRequest,
  output: OpponentPlannerModelOutput,
): OpponentPlannerValidationIssue[] {
  const allowed = citationScope(request);
  return output.proposedMoves.flatMap((move, moveIndex) =>
    (Object.keys(move.citations) as CitationField[]).flatMap((field) =>
      move.citations[field].flatMap((identifier, citationIndex) =>
        allowed[field].has(identifier)
          ? []
          : [
              issue(
                CITATION_ISSUE_CODE[field],
                ["proposedMoves", moveIndex, "citations", field, citationIndex],
                "A citation is outside the opposing counsel KnowledgeView",
              ),
            ],
      ),
    ),
  );
}

function opportunityIssues(
  request: OpponentPlannerRequest,
  output: OpponentPlannerModelOutput,
): OpponentPlannerValidationIssue[] {
  const issues: OpponentPlannerValidationIssue[] = [];
  const knownWitnessIds = new Set(
    request.knowledgeView.planning.witnesses.map((witness) => witness.witnessId),
  );
  const allowedEvidenceIds = citationScope(request).evidenceIds;
  const opportunities = request.opportunities;
  const callable = new Set(opportunities.callableWitnessIds);
  const questionable = new Set(opportunities.questionableWitnessIds);
  const presentable = new Set(opportunities.presentableEvidenceIds);
  const offerable = new Set(opportunities.offerableEvidenceIds);
  const foundation = new Set(opportunities.foundationTestimonyIds);
  const strikeable = new Set(opportunities.strikeableTestimonyIds);
  const objectionGrounds = new Set(opportunities.permittedObjectionGrounds);

  output.witnessPriorityIds.forEach((witnessId, index) => {
    if (!knownWitnessIds.has(witnessId)) {
      issues.push(
        issue(
          "unknown_witness_reference",
          ["witnessPriorityIds", index],
          "A witness priority is outside the planning roster",
        ),
      );
    }
  });
  output.evidencePriorityIds.forEach((evidenceId, index) => {
    if (!allowedEvidenceIds.has(evidenceId)) {
      issues.push(
        issue(
          "unknown_evidence_reference",
          ["evidencePriorityIds", index],
          "An evidence priority is outside the opposing counsel KnowledgeView",
        ),
      );
    }
  });

  output.proposedMoves.forEach((move, index) => {
    const movePath = ["proposedMoves", index] as IssuePath;
    if (move.kind === "call_witness" && !callable.has(move.witnessId)) {
      issues.push(
        issue(
          "move_not_available",
          [...movePath, "witnessId"],
          "The witness is not callable in this canonical state",
        ),
      );
    }
    if (move.kind === "question_witness") {
      if (!questionable.has(move.witnessId)) {
        issues.push(
          issue(
            "move_not_available",
            [...movePath, "witnessId"],
            "The witness is not currently question-able by opposing counsel",
          ),
        );
      }
      move.presentedEvidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (!presentable.has(evidenceId)) {
          issues.push(
            issue(
              "move_not_available",
              [...movePath, "presentedEvidenceIds", evidenceIndex],
              "The exhibit cannot be presented in the active examination",
            ),
          );
        }
      });
    }
    if (move.kind === "offer_evidence") {
      if (!offerable.has(move.evidenceId)) {
        issues.push(
          issue(
            "move_not_available",
            [...movePath, "evidenceId"],
            "The exhibit cannot be offered in the canonical state",
          ),
        );
      }
      move.foundationTestimonyIds.forEach((testimonyId, testimonyIndex) => {
        if (!foundation.has(testimonyId)) {
          issues.push(
            issue(
              "unknown_testimony_reference",
              [...movePath, "foundationTestimonyIds", testimonyIndex],
              "The testimony is unavailable as an evidence foundation",
            ),
          );
        }
      });
    }
    if (move.kind === "object") {
      if (!opportunities.canObject) {
        issues.push(
          issue(
            "move_not_available",
            [...movePath, "kind"],
            "No objection opportunity is active",
          ),
        );
      }
      if (!objectionGrounds.has(move.ground)) {
        issues.push(
          issue(
            "objection_ground_not_permitted",
            [...movePath, "ground"],
            "The objection ground is not permitted by the pinned rules",
          ),
        );
      }
    }
    if (move.kind === "move_to_strike") {
      move.testimonyIds.forEach((testimonyId, testimonyIndex) => {
        if (!strikeable.has(testimonyId)) {
          issues.push(
            issue(
              "move_not_available",
              [...movePath, "testimonyIds", testimonyIndex],
              "The testimony is not available for a strike motion",
            ),
          );
        }
      });
    }
    if (
      move.kind === "request_negotiation" &&
      !opportunities.canRequestNegotiation
    ) {
      issues.push(
        issue(
          "move_not_available",
          [...movePath, "kind"],
          "Negotiation is not available in the canonical state",
        ),
      );
    }
    if (move.kind === "rest_case" && !opportunities.canRest) {
      issues.push(
        issue(
          "move_not_available",
          [...movePath, "kind"],
          "Opposing counsel cannot rest in the canonical state",
        ),
      );
    }
    if (move.kind === "give_closing" && !opportunities.canClose) {
      issues.push(
        issue(
          "move_not_available",
          [...movePath, "kind"],
          "Opposing counsel cannot close in the canonical state",
        ),
      );
    }
  });

  if (
    request.knowledgeView.counsel.privateSettlement === null &&
    output.settlementPosture !== "avoid"
  ) {
    issues.push(
      issue(
        "move_not_available",
        ["settlementPosture"],
        "Settlement planning requires a private settlement scope",
      ),
    );
  }
  return issues;
}

function zodIssues(error: z.ZodError): OpponentPlannerValidationIssue[] {
  return error.issues.slice(0, 100).map((entry) =>
    issue(
      "strict_schema_invalid",
      entry.path.filter(
        (component): component is string | number =>
          typeof component === "string" ||
          (typeof component === "number" && component >= 0),
      ),
      "The model output did not satisfy the strict opponent-plan schema",
    ),
  );
}

/** Strict and request-aware validation for one immutable planning call. */
export function validateOpponentPlannerOutput(
  requestInput: OpponentPlannerRequest,
  candidate: unknown,
): OpponentPlannerOutputValidationResult {
  const request = OpponentPlannerRequestSchema.parse(requestInput);
  const parsed = OpponentPlannerModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { accepted: false, report: report(zodIssues(parsed.error)) };
  }

  const semanticIssues = validateOpponentPlannerSemantics(parsed.data).map(
    (semanticIssue) =>
      issue(
        "semantic_contract_invalid",
        semanticIssue.path,
        "The opponent plan violates its internal semantic contract",
      ),
  );
  const issues = [
    ...semanticIssues,
    ...citationScopeIssues(request, parsed.data),
    ...opportunityIssues(request, parsed.data),
  ];
  if (issues.length > 0) {
    return { accepted: false, report: report(issues) };
  }
  return { accepted: true, output: parsed.data, report: report([]) };
}
