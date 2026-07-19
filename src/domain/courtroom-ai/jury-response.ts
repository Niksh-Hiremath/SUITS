import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { JuryKnowledgeViewV2Schema } from "../knowledge/schema";
import {
  JuryRoleResponseModelOutputSchema,
  validateJuryRoleResponseSemantics,
  type CourtroomModelCitationSet,
  type JuryRoleResponseModelOutput,
} from "./call-contracts";

export const JURY_RESPONSE_REQUEST_SCHEMA_VERSION =
  "role-responder.jury.request.v1" as const;
export const JURY_DECISION_MANIFEST_SCHEMA_VERSION =
  "role-responder.jury.decision-manifest.v1" as const;
export const JURY_RESPONSE_VALIDATION_SCHEMA_VERSION =
  "role-responder.jury.validation.v1" as const;

const UniqueIdListSchema = (maximum: number) =>
  z
    .array(CaseGraphEntityIdSchema)
    .min(1)
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

export const JuryIssueManifestItemSchema = z
  .object({
    issueId: CaseGraphEntityIdSchema,
    title: z.string().trim().min(1).max(240),
    question: z.string().trim().min(1).max(2_000),
    burdenSide: z.enum(["user", "opposing", "none"]),
    standard: z.string().trim().min(1).max(1_000),
  })
  .strict();

const JuryInstructionDecisionManifestSchema = z
  .object({
    schemaVersion: z.literal(JURY_DECISION_MANIFEST_SCHEMA_VERSION),
    kind: z.literal("instructions"),
    instructionIds: UniqueIdListSchema(32),
  })
  .strict();

const JuryIssueDecisionManifestSchema = z
  .object({
    schemaVersion: z.literal(JURY_DECISION_MANIFEST_SCHEMA_VERSION),
    kind: z.literal("issues"),
    issues: z
      .array(JuryIssueManifestItemSchema)
      .min(1)
      .max(24)
      .superRefine((issues, context) => {
        const seen = new Set<string>();
        issues.forEach(({ issueId }, index) => {
          if (seen.has(issueId)) {
            context.addIssue({
              code: "custom",
              path: [index, "issueId"],
              message: "Issue identifiers must be unique",
            });
          }
          seen.add(issueId);
        });
      }),
  })
  .strict();

export const JuryDecisionManifestSchema = z.discriminatedUnion("kind", [
  JuryInstructionDecisionManifestSchema,
  JuryIssueDecisionManifestSchema,
]);

function sameOrderedIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identifier, index) => identifier === right[index])
  );
}

/**
 * A jury request is a server-prepared snapshot, never a browser-authored role
 * prompt. The refinements bind the only admitted-record view to the exact
 * canonical trial version represented by that view.
 */
export const JuryResponseRequestSchema = z
  .object({
    schemaVersion: z.literal(JURY_RESPONSE_REQUEST_SCHEMA_VERSION),
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    trialId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    decisionManifest: JuryDecisionManifestSchema,
    knowledgeView: JuryKnowledgeViewV2Schema,
  })
  .strict()
  .superRefine((request, context) => {
    const view = request.knowledgeView;
    if (
      request.trialId !== view.trialId ||
      request.trialId !== view.publicRecord.trialId
    ) {
      context.addIssue({
        code: "custom",
        path: ["trialId"],
        message: "The request and jury record must bind the same trial",
      });
    }
    if (
      request.expectedStateVersion !== view.stateVersion ||
      request.expectedStateVersion !== view.publicRecord.stateVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedStateVersion"],
        message: "The request and jury record must bind the same state version",
      });
    }
    if (request.actorId !== view.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "The request actor must match the jury KnowledgeView actor",
      });
    }
    if (view.publicRecord.instructions.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeView", "publicRecord", "instructions"],
        message: "Jury reasoning requires at least one canonical instruction",
      });
    }
    if (request.decisionManifest.kind === "instructions") {
      const canonicalInstructionIds = view.publicRecord.instructions.map(
        (instruction) => instruction.instructionId,
      );
      if (
        !sameOrderedIds(
          request.decisionManifest.instructionIds,
          canonicalInstructionIds,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["decisionManifest", "instructionIds"],
          message:
            "The instruction manifest must exactly match the canonical jury record",
        });
      }
    }
  });

export const JuryResponseValidationIssueCodeSchema = z.enum([
  "strict_schema_invalid",
  "semantic_contract_invalid",
  "unknown_fact_citation",
  "unknown_evidence_citation",
  "unknown_testimony_citation",
  "unknown_instruction_citation",
  "unsupported_citation",
  "instruction_citation_required",
  "manifest_instruction_not_applied",
  "issue_finding_count_mismatch",
]);

export const JuryResponseValidationIssueSchema = z
  .object({
    code: JuryResponseValidationIssueCodeSchema,
    path: z
      .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
      .max(16),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const JuryResponseValidationReportSchema = z
  .object({
    schemaVersion: z.literal(JURY_RESPONSE_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["accepted", "rejected"]),
    issues: z.array(JuryResponseValidationIssueSchema).max(200),
  })
  .strict();

export type JuryDecisionManifest = z.infer<
  typeof JuryDecisionManifestSchema
>;
export type JuryResponseRequest = z.infer<typeof JuryResponseRequestSchema>;
export type JuryResponseValidationIssue = z.infer<
  typeof JuryResponseValidationIssueSchema
>;
export type JuryResponseValidationReport = z.infer<
  typeof JuryResponseValidationReportSchema
>;

export type JuryConsiderableCitationSet = Readonly<{
  factIds: string[];
  evidenceIds: string[];
  testimonyIds: string[];
  instructionIds: string[];
}>;

export type ValidatedJuryFinding = Readonly<{
  issueId: string | null;
  conclusion: string;
  weight: JuryRoleResponseModelOutput["findings"][number]["weight"];
  citations: JuryConsiderableCitationSet;
}>;

export type ValidatedJuryResponse = Readonly<{
  deliberationText: string;
  findings: ValidatedJuryFinding[];
  recommendation: JuryRoleResponseModelOutput["recommendation"] &
    Readonly<{ citations: JuryConsiderableCitationSet }>;
  performance: JuryRoleResponseModelOutput["performance"];
}>;

export type JuryResponseOutputValidationResult =
  | Readonly<{
      accepted: true;
      output: JuryRoleResponseModelOutput;
      response: ValidatedJuryResponse;
      report: JuryResponseValidationReport;
    }>
  | Readonly<{
      accepted: false;
      report: JuryResponseValidationReport;
    }>;

type IssuePath = JuryResponseValidationIssue["path"];
type CitationField = keyof CourtroomModelCitationSet;
type CitedJuryItem = Readonly<{
  path: readonly ["deliberationSegments" | "findings", number, "citations"];
  citations: CourtroomModelCitationSet;
}>;

function issue(
  code: JuryResponseValidationIssue["code"],
  path: IssuePath,
  message: string,
): JuryResponseValidationIssue {
  return JuryResponseValidationIssueSchema.parse({ code, path, message });
}

function report(
  issues: JuryResponseValidationIssue[],
): JuryResponseValidationReport {
  return JuryResponseValidationReportSchema.parse({
    schemaVersion: JURY_RESPONSE_VALIDATION_SCHEMA_VERSION,
    status: issues.length === 0 ? "accepted" : "rejected",
    issues,
  });
}

function zodIssues(error: z.ZodError): JuryResponseValidationIssue[] {
  return error.issues.slice(0, 100).map((entry) =>
    issue(
      "strict_schema_invalid",
      entry.path.filter(
        (component): component is string | number =>
          typeof component === "string" ||
          (typeof component === "number" && component >= 0),
      ),
      "The model output did not satisfy the strict jury-response schema",
    ),
  );
}

function citedItems(output: JuryRoleResponseModelOutput): CitedJuryItem[] {
  return [
    ...output.deliberationSegments.map((segment, index) => ({
      path: ["deliberationSegments", index, "citations"] as const,
      citations: segment.citations,
    })),
    ...output.findings.map((finding, index) => ({
      path: ["findings", index, "citations"] as const,
      citations: finding.citations,
    })),
  ];
}

function citationScopeIssues(
  request: JuryResponseRequest,
  output: JuryRoleResponseModelOutput,
): JuryResponseValidationIssue[] {
  const issues: JuryResponseValidationIssue[] = [];
  const record = request.knowledgeView.publicRecord;
  const allowedFacts = new Set(record.facts.map((fact) => fact.factId));
  const allowedEvidence = new Set(
    record.evidence.map((evidence) => evidence.evidenceId),
  );
  const allowedTestimony = new Set(
    record.testimony.map((testimony) => testimony.testimonyId),
  );
  const allowedInstructions = new Set(
    record.instructions.map((instruction) => instruction.instructionId),
  );
  const unsupportedFields: readonly CitationField[] = [
    "transcriptTurnIds",
    "sourceSegmentIds",
    "priorStatementIds",
    "issueIds",
    "ruleIds",
    "settlementOfferIds",
  ];

  citedItems(output).forEach(({ path, citations }) => {
    for (const [field, identifiers, allowed, code] of [
      ["factIds", citations.factIds, allowedFacts, "unknown_fact_citation"],
      [
        "evidenceIds",
        citations.evidenceIds,
        allowedEvidence,
        "unknown_evidence_citation",
      ],
      [
        "testimonyIds",
        citations.testimonyIds,
        allowedTestimony,
        "unknown_testimony_citation",
      ],
      [
        "instructionIds",
        citations.instructionIds,
        allowedInstructions,
        "unknown_instruction_citation",
      ],
    ] as const) {
      identifiers.forEach((identifier, index) => {
        if (!allowed.has(identifier)) {
          issues.push(
            issue(
              code,
              [...path, field, index],
              "A jury citation is outside the jury-considerable record",
            ),
          );
        }
      });
    }
    unsupportedFields.forEach((field) => {
      if (citations[field].length > 0) {
        issues.push(
          issue(
            "unsupported_citation",
            [...path, field],
            "This citation class is not jury-considerable support",
          ),
        );
      }
    });
  });
  return issues;
}

function manifestIssues(
  request: JuryResponseRequest,
  output: JuryRoleResponseModelOutput,
): JuryResponseValidationIssue[] {
  const issues: JuryResponseValidationIssue[] = [];
  output.findings.forEach((finding, index) => {
    if (finding.citations.instructionIds.length === 0) {
      issues.push(
        issue(
          "instruction_citation_required",
          ["findings", index, "citations", "instructionIds"],
          "Each finding must apply at least one canonical jury instruction",
        ),
      );
    }
  });

  if (request.decisionManifest.kind === "instructions") {
    const citedInstructionIds = new Set(
      citedItems(output).flatMap(({ citations }) => citations.instructionIds),
    );
    request.decisionManifest.instructionIds.forEach(
      (instructionId, index) => {
        if (!citedInstructionIds.has(instructionId)) {
          issues.push(
            issue(
              "manifest_instruction_not_applied",
              ["decisionManifest", "instructionIds", index],
              "Every instruction in the exact manifest must be applied",
            ),
          );
        }
      },
    );
  } else if (
    output.findings.length !== request.decisionManifest.issues.length
  ) {
    issues.push(
      issue(
        "issue_finding_count_mismatch",
        ["findings"],
        "Issue-mode findings must map one-to-one in manifest order",
      ),
    );
  }
  return issues;
}

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function juryCitations(
  citations: readonly CourtroomModelCitationSet[],
): JuryConsiderableCitationSet {
  return {
    factIds: stableUnique(citations.flatMap((item) => item.factIds)),
    evidenceIds: stableUnique(citations.flatMap((item) => item.evidenceIds)),
    testimonyIds: stableUnique(
      citations.flatMap((item) => item.testimonyIds),
    ),
    instructionIds: stableUnique(
      citations.flatMap((item) => item.instructionIds),
    ),
  };
}

function materialize(
  request: JuryResponseRequest,
  output: JuryRoleResponseModelOutput,
): ValidatedJuryResponse {
  const issueIds =
    request.decisionManifest.kind === "issues"
      ? request.decisionManifest.issues.map(({ issueId }) => issueId)
      : [];
  const allCitations = citedItems(output).map(({ citations }) => citations);
  return {
    deliberationText: output.deliberationSegments
      .map((segment) => segment.text)
      .join(" "),
    findings: output.findings.map((finding, index) => ({
      issueId: issueIds[index] ?? null,
      conclusion: finding.conclusion,
      weight: finding.weight,
      citations: juryCitations([finding.citations]),
    })),
    recommendation: {
      ...output.recommendation,
      citations: juryCitations(allCitations),
    },
    performance: output.performance,
  };
}

/** Parse and validate one jury proposal against its exact admitted record. */
export function validateJuryResponseOutput(
  requestInput: JuryResponseRequest,
  candidate: unknown,
): JuryResponseOutputValidationResult {
  const request = JuryResponseRequestSchema.parse(requestInput);
  const parsed = JuryRoleResponseModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { accepted: false, report: report(zodIssues(parsed.error)) };
  }
  const semanticIssues = validateJuryRoleResponseSemantics(parsed.data).map(
    (semanticIssue) =>
      issue(
        "semantic_contract_invalid",
        semanticIssue.path,
        "The jury response violates its internal semantic contract",
      ),
  );
  const issues = [
    ...semanticIssues,
    ...citationScopeIssues(request, parsed.data),
    ...manifestIssues(request, parsed.data),
  ];
  if (issues.length > 0) {
    return { accepted: false, report: report(issues) };
  }
  return {
    accepted: true,
    output: parsed.data,
    response: materialize(request, parsed.data),
    report: report([]),
  };
}
