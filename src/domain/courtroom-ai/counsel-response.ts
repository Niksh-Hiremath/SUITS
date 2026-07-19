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
  "role-responder.counsel.request.v2" as const;
export const COUNSEL_RESPONSE_VALIDATION_SCHEMA_VERSION =
  "role-responder.counsel.validation.v1" as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const UniqueIdListSchema = (maximum: number, minimum = 0) =>
  z
    .array(CaseGraphEntityIdSchema)
    .min(minimum)
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

export const CounselResponseDirectiveSchema = z
  .discriminatedUnion("kind", [
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
        kind: z.literal("move_to_strike"),
        testimonyIds: UniqueIdListSchema(16, 1),
        basis: z.string().trim().min(1).max(1_000),
        permittedFactIds: UniqueIdListSchema(0),
        permittedEvidenceIds: UniqueIdListSchema(0),
        permittedTestimonyIds: UniqueIdListSchema(16, 1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("end_examination"),
        disposition: z.enum(["completed", "waived"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("give_closing"),
        permittedFactIds: UniqueIdListSchema(64),
        permittedEvidenceIds: UniqueIdListSchema(64),
        permittedTestimonyIds: UniqueIdListSchema(128),
      })
      .strict(),
  ])
  .superRefine((directive, context) => {
    if (
      directive.kind === "move_to_strike" &&
      !sameOrderedIds(directive.testimonyIds, directive.permittedTestimonyIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["permittedTestimonyIds"],
        message:
          "Strike testimony permissions must exactly match the bound targets",
      });
    }
  });

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
      .strict()
      .nullable(),
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
  .strict()
  .superRefine((request, context) => {
    const view = request.knowledgeView;
    if (
      request.trialId !== view.trialId ||
      request.trialId !== view.publicRecord.trialId ||
      request.expectedStateVersion !== view.stateVersion ||
      request.expectedStateVersion !== view.publicRecord.stateVersion ||
      request.actorId !== view.actorId
    ) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeView"],
        message: "The counsel request must bind one exact public trial head",
      });
    }

    const directive = request.directive;
    if (directive.kind === "give_closing") {
      if (request.appearance !== null) {
        context.addIssue({
          code: "custom",
          path: ["appearance"],
          message: "A closing response cannot bind a witness appearance",
        });
      }
    } else if (request.appearance === null) {
      context.addIssue({
        code: "custom",
        path: ["appearance"],
        message: "An examination response requires its canonical appearance",
      });
    } else if (
      directive.kind === "question_witness" &&
      directive.witnessId !== request.appearance.witnessId
    ) {
      context.addIssue({
        code: "custom",
        path: ["directive", "witnessId"],
        message: "The question directive must target the bound appearance",
      });
    }

    if (directive.kind === "end_examination") return;
    const publicOnly =
      directive.kind === "give_closing" || directive.kind === "move_to_strike";
    const publicRecord = view.publicRecord;
    const allowedFacts = new Set([
      ...publicRecord.facts.map(({ factId }) => factId),
      ...(publicOnly ? [] : view.counsel.facts.map(({ factId }) => factId)),
    ]);
    const allowedEvidence = new Set([
      ...publicRecord.evidence.map(({ evidenceId }) => evidenceId),
      ...(publicOnly
        ? []
        : view.counsel.evidence.map(({ evidenceId }) => evidenceId)),
    ]);
    const allowedTestimony = new Set(
      publicRecord.testimony.map(({ testimonyId }) => testimonyId),
    );
    for (const [field, identifiers, allowed] of [
      ["permittedFactIds", directive.permittedFactIds, allowedFacts],
      ["permittedEvidenceIds", directive.permittedEvidenceIds, allowedEvidence],
      [
        "permittedTestimonyIds",
        directive.permittedTestimonyIds,
        allowedTestimony,
      ],
    ] as const) {
      identifiers.forEach((identifier, index) => {
        if (!allowed.has(identifier)) {
          context.addIssue({
            code: "custom",
            path: ["directive", field, index],
            message: "A directive citation is outside its role-scoped record",
          });
        }
      });
    }
    if (
      directive.kind === "give_closing" &&
      directive.permittedFactIds.length +
        directive.permittedEvidenceIds.length +
        directive.permittedTestimonyIds.length ===
        0
    ) {
      context.addIssue({
        code: "custom",
        path: ["directive"],
        message: "A closing directive requires jury-considerable support",
      });
    }
  });

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
    directive.kind === "end_examination" ? [] : directive.permittedFactIds,
  );
  const allowedEvidence = new Set(
    directive.kind === "end_examination" ? [] : directive.permittedEvidenceIds,
  );
  const allowedTestimony = new Set(
    directive.kind === "end_examination" ? [] : directive.permittedTestimonyIds,
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
      directive.kind !== "end_examination" &&
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
  } else if (directive.kind === "move_to_strike") {
    if (
      action.kind !== "move_to_strike" ||
      !sameOrderedIds(action.testimonyIds, directive.testimonyIds)
    ) {
      issues.push(
        issue(
          "directive_mismatch",
          ["proposedAction"],
          "The counsel response must move to strike the exact bound testimony targets",
        ),
      );
    }
    if (text.length > 4_000) {
      issues.push(
        issue(
          "response_too_large",
          ["speechSegments"],
          "The joined strike motion exceeds 4000 characters",
        ),
      );
    }
  } else if (directive.kind === "end_examination") {
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
  } else {
    if (action.kind !== "give_closing") {
      issues.push(
        issue(
          "directive_mismatch",
          ["proposedAction", "kind"],
          "The counsel response must materialize the selected closing directive",
        ),
      );
    }
    if (text.length > 20_000) {
      issues.push(
        issue(
          "response_too_large",
          ["speechSegments"],
          "The joined opposing closing exceeds 20000 characters",
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
      output.speechSegments.flatMap((segment) => segment.citations.evidenceIds),
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
