import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { OpponentCounselPublicKnowledgeViewSchema } from "../knowledge";
import {
  CounselRoleResponseModelOutputSchema,
  validateCounselRoleResponseSemantics,
  type CourtroomModelCitationSet,
  type CounselRoleResponseModelOutput,
} from "./call-contracts";

export const COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION =
  "role-responder.counsel.request.v1" as const;
export const COUNSEL_RESPONSE_VALIDATION_SCHEMA_VERSION =
  "role-responder.counsel.validation.v1" as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
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

export const CounselResponseDirectiveSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("question_witness"),
      witnessId: CaseGraphEntityIdSchema,
      goal: z.string().trim().min(1).max(1_000),
      presentedEvidenceIds: UniqueIdListSchema(8),
      permittedFactIds: UniqueIdListSchema(64),
      permittedEvidenceIds: UniqueIdListSchema(64),
      permittedTestimonyIds: UniqueIdListSchema(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal("end_examination"),
      disposition: z.enum(["completed", "waived"]),
    })
    .strict(),
]);

export const CounselResponseRequestSchema = z
  .object({
    schemaVersion: z.literal(COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION),
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    trialId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    appearance: z
      .object({
        appearanceId: CaseGraphEntityIdSchema,
        witnessId: CaseGraphEntityIdSchema,
        examinationKind: z.enum(["direct", "cross", "redirect", "recross"]),
        answeredQuestionCount: z.number().int().nonnegative(),
      })
      .strict(),
    planBinding: z
      .object({
        plannerCallId: CaseGraphEntityIdSchema,
        plannerOutputHash: Sha256Schema,
        strategyId: CaseGraphEntityIdSchema,
        strategyRevision: z.number().int().positive(),
      })
      .strict(),
    directive: CounselResponseDirectiveSchema,
    knowledgeView: OpponentCounselPublicKnowledgeViewSchema,
  })
  .strict();

export const CounselResponseValidationIssueCodeSchema = z.enum([
  "strict_schema_invalid",
  "semantic_contract_invalid",
  "directive_mismatch",
  "unknown_fact_citation",
  "unknown_evidence_citation",
  "unknown_testimony_citation",
  "unsupported_citation",
  "ungrounded_question",
  "question_shape_invalid",
  "response_too_large",
]);

export const CounselResponseValidationIssueSchema = z
  .object({
    code: CounselResponseValidationIssueCodeSchema,
    path: z
      .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
      .max(16),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const CounselResponseValidationReportSchema = z
  .object({
    schemaVersion: z.literal(COUNSEL_RESPONSE_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["accepted", "rejected"]),
    issues: z.array(CounselResponseValidationIssueSchema).max(200),
  })
  .strict();

export type CounselResponseRequest = z.infer<
  typeof CounselResponseRequestSchema
>;
export type CounselResponseValidationIssue = z.infer<
  typeof CounselResponseValidationIssueSchema
>;
export type CounselResponseValidationReport = z.infer<
  typeof CounselResponseValidationReportSchema
>;
export type ValidatedCounselResponse = Readonly<{
  action: CounselRoleResponseModelOutput["proposedAction"];
  text: string;
  factIds: string[];
  evidenceIds: string[];
  testimonyIds: string[];
  performance: CounselRoleResponseModelOutput["performance"];
}>;
export type CounselResponseOutputValidationResult =
  | Readonly<{
      accepted: true;
      output: CounselRoleResponseModelOutput;
      response: ValidatedCounselResponse;
      report: CounselResponseValidationReport;
    }>
  | Readonly<{
      accepted: false;
      report: CounselResponseValidationReport;
    }>;

type IssuePath = CounselResponseValidationIssue["path"];
type CitationField = keyof CourtroomModelCitationSet;

function issue(
  code: CounselResponseValidationIssue["code"],
  path: IssuePath,
  message: string,
): CounselResponseValidationIssue {
  return CounselResponseValidationIssueSchema.parse({ code, path, message });
}

function report(
  issues: CounselResponseValidationIssue[],
): CounselResponseValidationReport {
  return CounselResponseValidationReportSchema.parse({
    schemaVersion: COUNSEL_RESPONSE_VALIDATION_SCHEMA_VERSION,
    status: issues.length === 0 ? "accepted" : "rejected",
    issues,
  });
}

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function sameOrderedIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identifier, index) => identifier === right[index])
  );
}

function zodIssues(error: z.ZodError): CounselResponseValidationIssue[] {
  return error.issues.slice(0, 100).map((entry) =>
    issue(
      "strict_schema_invalid",
      entry.path.filter(
        (component): component is string | number =>
          typeof component === "string" ||
          (typeof component === "number" && component >= 0),
      ),
      "The model output did not satisfy the strict counsel-response schema",
    ),
  );
}

function citationScopeIssues(
  request: CounselResponseRequest,
  output: CounselRoleResponseModelOutput,
): CounselResponseValidationIssue[] {
  const issues: CounselResponseValidationIssue[] = [];
  const directive = request.directive;
  const allowedFacts = new Set(
    directive.kind === "question_witness" ? directive.permittedFactIds : [],
  );
  const allowedEvidence = new Set(
    directive.kind === "question_witness"
      ? directive.permittedEvidenceIds
      : [],
  );
  const allowedTestimony = new Set(
    directive.kind === "question_witness"
      ? directive.permittedTestimonyIds
      : [],
  );
  const unsupportedFields: readonly CitationField[] = [
    "transcriptTurnIds",
    "sourceSegmentIds",
    "priorStatementIds",
    "issueIds",
    "instructionIds",
    "ruleIds",
    "settlementOfferIds",
  ];

  output.speechSegments.forEach((segment, segmentIndex) => {
    for (const [field, values, allowed, code] of [
      [
        "factIds",
        segment.citations.factIds,
        allowedFacts,
        "unknown_fact_citation",
      ],
      [
        "evidenceIds",
        segment.citations.evidenceIds,
        allowedEvidence,
        "unknown_evidence_citation",
      ],
      [
        "testimonyIds",
        segment.citations.testimonyIds,
        allowedTestimony,
        "unknown_testimony_citation",
      ],
    ] as const) {
      values.forEach((identifier, identifierIndex) => {
        if (!allowed.has(identifier)) {
          issues.push(
            issue(
              code,
              [
                "speechSegments",
                segmentIndex,
                "citations",
                field,
                identifierIndex,
              ],
              "A counsel citation is outside the server-selected directive",
            ),
          );
        }
      });
    }
    unsupportedFields.forEach((field) => {
      if (segment.citations[field].length > 0) {
        issues.push(
          issue(
            "unsupported_citation",
            ["speechSegments", segmentIndex, "citations", field],
            "This citation class is unavailable in an open-court counsel response",
          ),
        );
      }
    });
    if (
      directive.kind === "question_witness" &&
      segment.citations.factIds.length === 0 &&
      segment.citations.evidenceIds.length === 0 &&
      segment.citations.testimonyIds.length === 0
    ) {
      issues.push(
        issue(
          "ungrounded_question",
          ["speechSegments", segmentIndex, "citations"],
          "Every question segment requires a fact, evidence, or testimony basis",
        ),
      );
    }
  });
  return issues;
}

function directiveIssues(
  request: CounselResponseRequest,
  output: CounselRoleResponseModelOutput,
): CounselResponseValidationIssue[] {
  const issues: CounselResponseValidationIssue[] = [];
  const directive = request.directive;
  const action = output.proposedAction;
  const text = output.speechSegments.map((segment) => segment.text).join(" ");
  if (directive.kind === "question_witness") {
    if (action.kind !== "ask_question") {
      issues.push(
        issue(
          "directive_mismatch",
          ["proposedAction", "kind"],
          "The counsel response must materialize the selected question directive",
        ),
      );
    } else if (
      !sameOrderedIds(
        action.presentedEvidenceIds,
        directive.presentedEvidenceIds,
      )
    ) {
      issues.push(
        issue(
          "directive_mismatch",
          ["proposedAction", "presentedEvidenceIds"],
          "Presented evidence must exactly match the server-selected directive",
        ),
      );
    }
    if (!text.includes("?")) {
      issues.push(
        issue(
          "question_shape_invalid",
          ["speechSegments"],
          "A witness-question directive must produce an interrogative question",
        ),
      );
    }
    if (text.length > 4_000) {
      issues.push(
        issue(
          "response_too_large",
          ["speechSegments"],
          "The joined counsel question exceeds 4000 characters",
        ),
      );
    }
  } else {
    if (
      action.kind !== "end_examination" ||
      action.disposition !== directive.disposition
    ) {
      issues.push(
        issue(
          "directive_mismatch",
          ["proposedAction"],
          "The counsel response must end the examination with the bound disposition",
        ),
      );
    }
    if (text.length > 500) {
      issues.push(
        issue(
          "response_too_large",
          ["speechSegments"],
          "An examination-ending response exceeds 500 characters",
        ),
      );
    }
  }
  return issues;
}

function materialize(
  output: CounselRoleResponseModelOutput,
): ValidatedCounselResponse {
  return {
    action: output.proposedAction,
    text: output.speechSegments.map((segment) => segment.text).join(" "),
    factIds: stableUnique(
      output.speechSegments.flatMap((segment) => segment.citations.factIds),
    ),
    evidenceIds: stableUnique(
      output.speechSegments.flatMap(
        (segment) => segment.citations.evidenceIds,
      ),
    ),
    testimonyIds: stableUnique(
      output.speechSegments.flatMap(
        (segment) => segment.citations.testimonyIds,
      ),
    ),
    performance: output.performance,
  };
}

/** Parse and validate public counsel dialogue against one persisted directive. */
export function validateCounselResponseOutput(
  requestInput: CounselResponseRequest,
  candidate: unknown,
): CounselResponseOutputValidationResult {
  const request = CounselResponseRequestSchema.parse(requestInput);
  const parsed = CounselRoleResponseModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { accepted: false, report: report(zodIssues(parsed.error)) };
  }
  const semanticIssues = validateCounselRoleResponseSemantics(parsed.data).map(
    (semanticIssue) =>
      issue(
        "semantic_contract_invalid",
        semanticIssue.path,
        "The counsel response violates its internal semantic contract",
      ),
  );
  const issues = [
    ...semanticIssues,
    ...citationScopeIssues(request, parsed.data),
    ...directiveIssues(request, parsed.data),
  ];
  if (issues.length > 0) {
    return { accepted: false, report: report(issues) };
  }
  return {
    accepted: true,
    output: parsed.data,
    response: materialize(parsed.data),
    report: report([]),
  };
}
