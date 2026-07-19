import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { JudgeKnowledgeViewV2Schema } from "../knowledge";
import {
  JudgeRoleResponseModelOutputSchema,
  validateJudgeRoleResponseSemantics,
  type CourtroomModelCitationSet,
  type JudgeRoleResponseModelOutput,
} from "./call-contracts";

export const JUDGE_RESPONSE_REQUEST_SCHEMA_VERSION =
  "role-responder.judge.request.v1" as const;
export const JUDGE_RESPONSE_VALIDATION_SCHEMA_VERSION =
  "role-responder.judge.validation.v1" as const;

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

const EvidenceRulingDirectiveSchema = z
  .object({
    kind: z.literal("rule_on_evidence"),
    triggerEventId: CaseGraphEntityIdSchema,
    evidenceId: CaseGraphEntityIdSchema,
    permittedRulings: z
      .array(z.enum(["admitted", "excluded"]))
      .min(1)
      .max(2),
  })
  .strict();

const AssertionRulingDirectiveSchema = z
  .object({
    kind: z.literal("rule_on_assertion"),
    triggerEventId: CaseGraphEntityIdSchema,
    factId: CaseGraphEntityIdSchema,
    permittedRulings: z
      .array(z.enum(["admitted", "excluded"]))
      .min(1)
      .max(2),
  })
  .strict();

const StrikeRulingDirectiveSchema = z
  .object({
    kind: z.literal("rule_on_strike_motion"),
    triggerEventId: CaseGraphEntityIdSchema,
    motionId: CaseGraphEntityIdSchema,
    testimonyIds: UniqueIdListSchema(32, 1),
    permittedRulings: z.array(z.enum(["granted", "denied"])).min(1).max(2),
  })
  .strict();

const RecessRulingDirectiveSchema = z
  .object({
    kind: z.literal("recess_request"),
    triggerEventId: CaseGraphEntityIdSchema,
    requestId: CaseGraphEntityIdSchema,
    permittedRulings: z.array(z.enum(["granted", "denied"])).min(1).max(2),
  })
  .strict();

export const JudgeResponseDirectiveSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("speak_only"),
      triggerEventId: CaseGraphEntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("maintain_order"),
      triggerEventId: CaseGraphEntityIdSchema,
    })
    .strict(),
  EvidenceRulingDirectiveSchema,
  AssertionRulingDirectiveSchema,
  StrikeRulingDirectiveSchema,
  RecessRulingDirectiveSchema,
  z
    .object({
      kind: z.literal("instruct_jury"),
      triggerEventId: CaseGraphEntityIdSchema,
      permittedInstructionIds: UniqueIdListSchema(32, 1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("render_verdict"),
      triggerEventId: CaseGraphEntityIdSchema,
    })
    .strict(),
]);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

const JudgeResponseRequestObjectSchema = z
  .object({
    schemaVersion: z.literal(JUDGE_RESPONSE_REQUEST_SCHEMA_VERSION),
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    trialId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    directive: JudgeResponseDirectiveSchema,
    knowledgeView: JudgeKnowledgeViewV2Schema,
  })
  .strict();

/** Immutable role request pinned to one judge view and canonical event head. */
export const JudgeResponseRequestSchema =
  JudgeResponseRequestObjectSchema.superRefine((request, context) => {
    const view = request.knowledgeView;
    if (
      request.trialId !== view.trialId ||
      request.trialId !== view.publicRecord.trialId
    ) {
      context.addIssue({
        code: "custom",
        path: ["trialId"],
        message: "The judge request must match the KnowledgeView trial",
      });
    }
    if (
      request.expectedStateVersion !== view.stateVersion ||
      request.expectedStateVersion !== view.publicRecord.stateVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedStateVersion"],
        message: "The judge request must match the KnowledgeView state",
      });
    }
    if (request.actorId !== view.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "The judge request must match the KnowledgeView actor",
      });
    }
    if (request.expectedLastEventId !== request.directive.triggerEventId) {
      context.addIssue({
        code: "custom",
        path: ["expectedLastEventId"],
        message: "The judge request must match the directive trigger head",
      });
    }
    if (
      "permittedRulings" in request.directive &&
      hasDuplicates(request.directive.permittedRulings)
    ) {
      context.addIssue({
        code: "custom",
        path: ["directive", "permittedRulings"],
        message: "Permitted rulings must be unique",
      });
    }
    if (request.directive.kind === "instruct_jury") {
      const visibleInstructions = new Set(
        view.publicRecord.instructions.map(
          (instruction) => instruction.instructionId,
        ),
      );
      request.directive.permittedInstructionIds.forEach(
        (instructionId, index) => {
          if (!visibleInstructions.has(instructionId)) {
            context.addIssue({
              code: "custom",
              path: ["directive", "permittedInstructionIds", index],
              message: "A permitted instruction is absent from the judge view",
            });
          }
        },
      );
    }
  });

export const JudgeResponseValidationIssueCodeSchema = z.enum([
  "strict_schema_invalid",
  "semantic_contract_invalid",
  "directive_mismatch",
  "ruling_not_permitted",
  "unknown_fact_citation",
  "unknown_evidence_citation",
  "unknown_testimony_citation",
  "unknown_source_segment_citation",
  "unknown_instruction_citation",
  "unsupported_citation",
  "target_not_cited",
  "response_too_large",
]);

export const JudgeResponseValidationIssueSchema = z
  .object({
    code: JudgeResponseValidationIssueCodeSchema,
    path: z
      .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
      .max(16),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const JudgeResponseValidationReportSchema = z
  .object({
    schemaVersion: z.literal(JUDGE_RESPONSE_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["accepted", "rejected"]),
    issues: z.array(JudgeResponseValidationIssueSchema).max(200),
  })
  .strict();

export type JudgeResponseRequest = z.infer<typeof JudgeResponseRequestSchema>;
export type JudgeResponseValidationIssue = z.infer<
  typeof JudgeResponseValidationIssueSchema
>;
export type JudgeResponseValidationReport = z.infer<
  typeof JudgeResponseValidationReportSchema
>;
export type ValidatedJudgeResponse = Readonly<{
  action: JudgeRoleResponseModelOutput["proposedAction"];
  text: string;
  factIds: string[];
  evidenceIds: string[];
  testimonyIds: string[];
  sourceSegmentIds: string[];
  instructionIds: string[];
  performance: JudgeRoleResponseModelOutput["performance"];
}>;
export type JudgeResponseOutputValidationResult =
  | Readonly<{
      accepted: true;
      output: JudgeRoleResponseModelOutput;
      response: ValidatedJudgeResponse;
      report: JudgeResponseValidationReport;
    }>
  | Readonly<{
      accepted: false;
      report: JudgeResponseValidationReport;
    }>;

type IssuePath = JudgeResponseValidationIssue["path"];
type CitationField = keyof CourtroomModelCitationSet;

function issue(
  code: JudgeResponseValidationIssue["code"],
  path: IssuePath,
  message: string,
): JudgeResponseValidationIssue {
  return JudgeResponseValidationIssueSchema.parse({ code, path, message });
}

function report(
  issues: JudgeResponseValidationIssue[],
): JudgeResponseValidationReport {
  return JudgeResponseValidationReportSchema.parse({
    schemaVersion: JUDGE_RESPONSE_VALIDATION_SCHEMA_VERSION,
    status: issues.length === 0 ? "accepted" : "rejected",
    issues,
  });
}

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function zodIssues(error: z.ZodError): JudgeResponseValidationIssue[] {
  return error.issues.slice(0, 100).map((entry) =>
    issue(
      "strict_schema_invalid",
      entry.path.filter(
        (component): component is string | number =>
          typeof component === "string" ||
          (typeof component === "number" && component >= 0),
      ),
      "The model output did not satisfy the strict judge-response schema",
    ),
  );
}

function citedIds(
  output: JudgeRoleResponseModelOutput,
  field: CitationField,
): Set<string> {
  return new Set(
    output.speechSegments.flatMap((segment) => segment.citations[field]),
  );
}

function citationScope(
  request: JudgeResponseRequest,
): Readonly<Record<CitationField, ReadonlySet<string>>> {
  const view = request.knowledgeView;
  const directive = request.directive;
  return {
    factIds: new Set([
      ...view.publicRecord.facts.map((fact) => fact.factId),
      ...(directive.kind === "rule_on_assertion" ? [directive.factId] : []),
      ...(view.currentExchange?.factIds ?? []),
    ]),
    evidenceIds: new Set([
      ...view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
      ...(directive.kind === "rule_on_evidence"
        ? [directive.evidenceId]
        : []),
      ...(view.currentExchange?.evidenceIds ?? []),
    ]),
    testimonyIds: new Set([
      ...view.publicRecord.testimony.map(
        (testimony) => testimony.testimonyId,
      ),
      ...(directive.kind === "rule_on_strike_motion"
        ? directive.testimonyIds
        : []),
    ]),
    transcriptTurnIds: new Set(),
    sourceSegmentIds: new Set([
      ...view.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
      ...view.publicRecord.evidence.flatMap(
        (evidence) => evidence.sourceSegmentIds,
      ),
    ]),
    priorStatementIds: new Set(),
    issueIds: new Set(),
    instructionIds: new Set([
      ...view.publicRecord.instructions.map(
        (instruction) => instruction.instructionId,
      ),
      ...(directive.kind === "instruct_jury"
        ? directive.permittedInstructionIds
        : []),
    ]),
    ruleIds: new Set(),
    settlementOfferIds: new Set(),
  };
}

const CITATION_ISSUE_CODE: Readonly<
  Partial<Record<CitationField, JudgeResponseValidationIssue["code"]>>
> = {
  factIds: "unknown_fact_citation",
  evidenceIds: "unknown_evidence_citation",
  testimonyIds: "unknown_testimony_citation",
  sourceSegmentIds: "unknown_source_segment_citation",
  instructionIds: "unknown_instruction_citation",
};

function citationIssues(
  request: JudgeResponseRequest,
  output: JudgeRoleResponseModelOutput,
): JudgeResponseValidationIssue[] {
  const issues: JudgeResponseValidationIssue[] = [];
  const scope = citationScope(request);
  output.speechSegments.forEach((segment, segmentIndex) => {
    (Object.keys(segment.citations) as CitationField[]).forEach((field) => {
      const code = CITATION_ISSUE_CODE[field];
      segment.citations[field].forEach((identifier, identifierIndex) => {
        if (scope[field].has(identifier)) return;
        issues.push(
          issue(
            code ?? "unsupported_citation",
            [
              "speechSegments",
              segmentIndex,
              "citations",
              field,
              identifierIndex,
            ],
            code === undefined
              ? "This citation class is unavailable to the judge responder"
              : "A citation is outside the judge KnowledgeView and directive",
          ),
        );
      });
    });
  });
  return issues;
}

function targetIssues(
  request: JudgeResponseRequest,
  output: JudgeRoleResponseModelOutput,
): JudgeResponseValidationIssue[] {
  const directive = request.directive;
  const action = output.proposedAction;
  if (action.kind !== directive.kind) {
    return [
      issue(
        "directive_mismatch",
        ["proposedAction", "kind"],
        "The judge response must materialize the exact bound directive",
      ),
    ];
  }
  const issues: JudgeResponseValidationIssue[] = [];
  if (
    directive.kind === "rule_on_evidence" &&
    action.kind === "rule_on_evidence"
  ) {
    if (!directive.permittedRulings.includes(action.ruling)) {
      issues.push(
        issue(
          "ruling_not_permitted",
          ["proposedAction", "ruling"],
          "The evidence ruling is outside the server-selected options",
        ),
      );
    }
    if (!citedIds(output, "evidenceIds").has(directive.evidenceId)) {
      issues.push(
        issue(
          "target_not_cited",
          ["speechSegments"],
          "The exact pending exhibit must be cited",
        ),
      );
    }
  }
  if (
    directive.kind === "rule_on_assertion" &&
    action.kind === "rule_on_assertion"
  ) {
    if (!directive.permittedRulings.includes(action.ruling)) {
      issues.push(
        issue(
          "ruling_not_permitted",
          ["proposedAction", "ruling"],
          "The assertion ruling is outside the server-selected options",
        ),
      );
    }
    if (!citedIds(output, "factIds").has(directive.factId)) {
      issues.push(
        issue(
          "target_not_cited",
          ["speechSegments"],
          "The exact pending assertion must be cited",
        ),
      );
    }
  }
  if (
    directive.kind === "rule_on_strike_motion" &&
    action.kind === "rule_on_strike_motion"
  ) {
    if (!directive.permittedRulings.includes(action.ruling)) {
      issues.push(
        issue(
          "ruling_not_permitted",
          ["proposedAction", "ruling"],
          "The strike ruling is outside the server-selected options",
        ),
      );
    }
    const citations = citedIds(output, "testimonyIds");
    directive.testimonyIds.forEach((testimonyId) => {
      if (!citations.has(testimonyId)) {
        issues.push(
          issue(
            "target_not_cited",
            ["speechSegments"],
            "Every testimony target in the pending strike motion must be cited",
          ),
        );
      }
    });
  }
  if (
    directive.kind === "recess_request" &&
    action.kind === "recess_request" &&
    !directive.permittedRulings.includes(action.ruling)
  ) {
    issues.push(
      issue(
        "ruling_not_permitted",
        ["proposedAction", "ruling"],
        "The recess ruling is outside the server-selected options",
      ),
    );
  }
  if (directive.kind === "instruct_jury" && action.kind === "instruct_jury") {
    action.instructionIds.forEach((instructionId, index) => {
      if (!directive.permittedInstructionIds.includes(instructionId)) {
        issues.push(
          issue(
            "directive_mismatch",
            ["proposedAction", "instructionIds", index],
            "The instruction is outside the server-selected options",
          ),
        );
      }
    });
  }
  const text = output.speechSegments.map((segment) => segment.text).join(" ");
  if (text.length > 4_000) {
    issues.push(
      issue(
        "response_too_large",
        ["speechSegments"],
        "The joined judge response exceeds 4000 characters",
      ),
    );
  }
  return issues;
}

function materialize(
  output: JudgeRoleResponseModelOutput,
): ValidatedJudgeResponse {
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
    sourceSegmentIds: stableUnique(
      output.speechSegments.flatMap(
        (segment) => segment.citations.sourceSegmentIds,
      ),
    ),
    instructionIds: stableUnique(
      output.speechSegments.flatMap(
        (segment) => segment.citations.instructionIds,
      ),
    ),
    performance: output.performance,
  };
}

/** Strict, request-aware validation for one immutable judge role response. */
export function validateJudgeResponseOutput(
  requestInput: JudgeResponseRequest,
  candidate: unknown,
): JudgeResponseOutputValidationResult {
  const request = JudgeResponseRequestSchema.parse(requestInput);
  const parsed = JudgeRoleResponseModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { accepted: false, report: report(zodIssues(parsed.error)) };
  }
  const semanticIssues = validateJudgeRoleResponseSemantics(parsed.data).map(
    (semanticIssue) =>
      issue(
        "semantic_contract_invalid",
        semanticIssue.path,
        "The judge response violates its internal semantic contract",
      ),
  );
  const issues = [
    ...semanticIssues,
    ...citationIssues(request, parsed.data),
    ...targetIssues(request, parsed.data),
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
