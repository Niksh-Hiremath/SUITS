import {
  CaseGraphV1Schema,
  parseCaseGraphV1,
  type CaseGraphV1,
  type Provenance,
} from "../../domain/case-graph";

import {
  CASE_COMPILER_EDUCATIONAL_DISCLAIMER,
  CASE_COMPILER_MODEL,
  CASE_COMPILER_PENDING_REQUEST_ID,
  CASE_COMPILER_PROMPT_VERSION,
  CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
  MAX_CASE_COMPILER_VALIDATION_ISSUES,
} from "./constants";
import {
  CaseCompilerModelOutputSchema,
  CaseCompilerValidationIssueSchema,
  CaseCompilerValidationReportSchema,
  type CaseCompilerGroundingRecord,
  type CaseCompilerInput,
  type CaseCompilerModelOutput,
  type CaseCompilerValidationIssue,
  type CaseCompilerValidationReport,
} from "./schemas";

export type CaseCompilerCandidateValidationContext = Readonly<{
  input: CaseCompilerInput;
  compiledAt: string;
  sourceContentHash: string;
  providerRequestId: string;
}>;

export type CaseCompilerCandidateValidation =
  | Readonly<{
      ok: true;
      output: CaseCompilerModelOutput;
      caseGraph: CaseGraphV1;
      validationReport: CaseCompilerValidationReport;
      acceptedSourceCitationCount: number;
    }>
  | Readonly<{
      ok: false;
      issues: readonly CaseCompilerValidationIssue[];
      validationReport: CaseCompilerValidationReport;
    }>;

type GroundableEntity = Readonly<{
  entityId: string;
  path: string;
  provenance: readonly Provenance[];
  uncertaintyKind: "fact" | "evidence" | "witness" | null;
}>;

function boundedMessage(message: string): string {
  const normalized = message.trim() || "Validation failed";
  return normalized.slice(0, 1_000);
}

function makeIssue(
  code: string,
  path: Array<string | number>,
  message: string,
  entityId: string | null = null,
  sourceSegmentIds: string[] = [],
): CaseCompilerValidationIssue {
  return CaseCompilerValidationIssueSchema.parse({
    code,
    path,
    message: boundedMessage(message),
    entityId,
    sourceSegmentIds,
  });
}

function addIssue(
  issues: CaseCompilerValidationIssue[],
  issue: CaseCompilerValidationIssue,
): void {
  if (issues.length < MAX_CASE_COMPILER_VALIDATION_ISSUES) issues.push(issue);
}

function collectGroundableEntities(graph: CaseGraphV1): GroundableEntity[] {
  return [
    ...graph.parties.map((entity, index) => ({
      entityId: entity.partyId,
      path: `parties.${index}`,
      provenance: entity.provenance,
      uncertaintyKind: null,
    }) satisfies GroundableEntity),
    ...graph.issues.map((entity, index) => ({
      entityId: entity.issueId,
      path: `issues.${index}`,
      provenance: entity.provenance,
      uncertaintyKind: null,
    }) satisfies GroundableEntity),
    ...graph.timeline.map((entity, index) => ({
      entityId: entity.timelineEventId,
      path: `timeline.${index}`,
      provenance: entity.provenance,
      uncertaintyKind: null,
    }) satisfies GroundableEntity),
    ...graph.facts.map((entity, index) => ({
      entityId: entity.factId,
      path: `facts.${index}`,
      provenance: entity.provenance,
      uncertaintyKind: "fact",
    }) satisfies GroundableEntity),
    ...graph.evidence.map((entity, index) => ({
      entityId: entity.evidenceId,
      path: `evidence.${index}`,
      provenance: entity.provenance,
      uncertaintyKind: "evidence",
    }) satisfies GroundableEntity),
    ...graph.witnesses.flatMap((witness, witnessIndex) => [
      {
        entityId: witness.witnessId,
        path: `witnesses.${witnessIndex}`,
        provenance: witness.provenance,
        uncertaintyKind: "witness",
      } satisfies GroundableEntity,
      ...witness.priorStatements.map((statement, statementIndex) => ({
        entityId: statement.priorStatementId,
        path: `witnesses.${witnessIndex}.priorStatements.${statementIndex}`,
        provenance: statement.provenance,
        uncertaintyKind: null,
      }) satisfies GroundableEntity),
    ]),
    ...graph.contradictions.map((entity, index) => ({
      entityId: entity.contradictionId,
      path: `contradictions.${index}`,
      provenance: entity.provenance,
      uncertaintyKind: null,
    }) satisfies GroundableEntity),
  ];
}

function hasLinkedUncertainty(graph: CaseGraphV1, entity: GroundableEntity): boolean {
  if (entity.uncertaintyKind === null) return true;
  return graph.compilerMetadata.uncertainties.some((uncertainty) => {
    switch (entity.uncertaintyKind) {
      case "fact":
        return uncertainty.relatedFactIds.includes(entity.entityId);
      case "evidence":
        return uncertainty.relatedEvidenceIds.includes(entity.entityId);
      case "witness":
        return uncertainty.relatedWitnessIds.includes(entity.entityId);
    }
  });
}

function validateGrounding(
  graph: CaseGraphV1,
  issues: CaseCompilerValidationIssue[],
): CaseCompilerGroundingRecord[] {
  const allowedSourceIds = new Set(graph.sourceSegments.map((segment) => segment.sourceSegmentId));
  const records: CaseCompilerGroundingRecord[] = [];
  const entities = collectGroundableEntities(graph);

  if (entities.length > 2_000) {
    addIssue(
      issues,
      makeIssue(
        "grounding_record_limit",
        [],
        "The compiled graph contains too many factual entities for deterministic grounding review",
      ),
    );
  }

  for (const entity of entities.slice(0, 2_000)) {
    const sourceEntries = entity.provenance.filter((entry) => entry.kind === "source");
    const sourceSegmentIds = [
      ...new Set(sourceEntries.flatMap((entry) => entry.sourceSegmentIds)),
    ].filter((sourceId) => allowedSourceIds.has(sourceId));

    if (sourceSegmentIds.length > 0) {
      records.push({
        entityId: entity.entityId,
        path: entity.path,
        grounding: "source",
        sourceSegmentIds,
        confidence: Math.max(...sourceEntries.map((entry) => entry.confidence)),
      });
      continue;
    }

    const inferredEntries = entity.provenance.filter((entry) => entry.kind === "inferred");
    if (inferredEntries.length === 0) {
      addIssue(
        issues,
        makeIssue(
          "ungrounded_factual_entity",
          entity.path.split("."),
          "Factual packet-derived entities require source provenance or explicit inferred provenance",
          entity.entityId,
        ),
      );
      continue;
    }

    const inferredSourceIds = [
      ...new Set(inferredEntries.flatMap((entry) => entry.sourceSegmentIds)),
    ].filter((sourceId) => allowedSourceIds.has(sourceId));
    records.push({
      entityId: entity.entityId,
      path: entity.path,
      grounding: "inferred",
      sourceSegmentIds: inferredSourceIds,
      confidence: Math.max(...inferredEntries.map((entry) => entry.confidence)),
    });

    if (!hasLinkedUncertainty(graph, entity)) {
      addIssue(
        issues,
        makeIssue(
          "inference_missing_uncertainty",
          entity.path.split("."),
          "An inferred fact, evidence item, or witness requires a linked compiler uncertainty",
          entity.entityId,
          inferredSourceIds,
        ),
      );
    }
  }

  return records;
}

function equalStringSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function buildReport(
  issues: CaseCompilerValidationIssue[],
  grounding: CaseCompilerGroundingRecord[],
  output: CaseCompilerModelOutput | null,
): CaseCompilerValidationReport {
  const inferredCount = grounding.filter((record) => record.grounding === "inferred").length;
  const uncertaintyCount = output?.caseGraph.compilerMetadata.uncertainties.length ?? 0;
  const rejected = issues.length > 0;
  const needsReview = !rejected &&
    (inferredCount > 0 || uncertaintyCount > 0 || output?.review.overallStatus === "needs_review");

  return CaseCompilerValidationReportSchema.parse({
    schemaVersion: CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
    status: rejected ? "rejected" : needsReview ? "needs_review" : "ready_for_review",
    checks: [
      {
        code: "strict_schema",
        status: rejected && issues.some((issue) => issue.code === "strict_schema_invalid") ? "fail" : "pass",
        message: rejected && issues.some((issue) => issue.code === "strict_schema_invalid")
          ? "The candidate failed the strict compiler output schema."
          : "The candidate satisfies the strict compiler output schema.",
      },
      {
        code: "trusted_metadata",
        status: rejected && issues.some((issue) => issue.code.startsWith("trusted_")) ? "fail" : "pass",
        message: rejected && issues.some((issue) => issue.code.startsWith("trusted_"))
          ? "One or more trusted server metadata fields were altered."
          : "Trusted server metadata is unchanged.",
      },
      {
        code: "source_integrity",
        status: "pass",
        message: "Trusted source segments were attached server-side and validated with the canonical graph.",
      },
      {
        code: "factual_grounding",
        status: rejected && issues.some((issue) => issue.code.includes("ground"))
          ? "fail"
          : inferredCount > 0
            ? "warning"
            : "pass",
        message: rejected && issues.some((issue) => issue.code.includes("ground"))
          ? "At least one factual entity lacks acceptable grounding."
          : inferredCount > 0
            ? `${inferredCount} factual entities are explicitly inferred and require human review.`
            : "Every factual entity is linked to supplied source segments.",
      },
      {
        code: "uncertainty_review",
        status: uncertaintyCount > 0 ? "warning" : "pass",
        message: uncertaintyCount > 0
          ? `${uncertaintyCount} compiler uncertainties require human review.`
          : "No compiler uncertainties were reported.",
      },
    ],
    issues,
    grounding,
    uncertainties: (output?.caseGraph.compilerMetadata.uncertainties ?? []).slice(0, 500),
    modelReview: output?.review ?? null,
  });
}

export function validateCaseCompilerCandidate(
  candidate: unknown,
  context: CaseCompilerCandidateValidationContext,
): CaseCompilerCandidateValidation {
  const parsed = CaseCompilerModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, MAX_CASE_COMPILER_VALIDATION_ISSUES).map((issue) =>
      makeIssue(
        "strict_schema_invalid",
        issue.path.map((segment) =>
          typeof segment === "symbol" ? segment.description ?? "symbol" : segment,
        ),
        issue.message,
      ),
    );
    return {
      ok: false,
      issues,
      validationReport: buildReport(issues, [], null),
    };
  }

  const output = parsed.data;
  const modelGraph = output.caseGraph;
  const issues: CaseCompilerValidationIssue[] = [];

  const trustedChecks: Array<Readonly<{
    matches: boolean;
    code: string;
    path: Array<string | number>;
    message: string;
  }>> = [
    {
      matches: modelGraph.caseId === context.input.caseId,
      code: "trusted_case_id_changed",
      path: ["caseGraph", "caseId"],
      message: "The candidate changed the trusted case ID",
    },
    {
      matches: modelGraph.status === "draft",
      code: "trusted_status_changed",
      path: ["caseGraph", "status"],
      message: "A compiler candidate must remain a draft for human review",
    },
    {
      matches: modelGraph.educationalDisclaimer === CASE_COMPILER_EDUCATIONAL_DISCLAIMER,
      code: "trusted_disclaimer_changed",
      path: ["caseGraph", "educationalDisclaimer"],
      message: "The candidate changed the required educational disclaimer",
    },
    {
      matches: modelGraph.compilerMetadata.method === "gpt",
      code: "trusted_compiler_method_changed",
      path: ["caseGraph", "compilerMetadata", "method"],
      message: "The compiler method must be recorded as GPT",
    },
    {
      matches: modelGraph.compilerMetadata.model === CASE_COMPILER_MODEL,
      code: "trusted_model_changed",
      path: ["caseGraph", "compilerMetadata", "model"],
      message: "The candidate changed the server-selected compiler model",
    },
    {
      matches: modelGraph.compilerMetadata.requestId === CASE_COMPILER_PENDING_REQUEST_ID,
      code: "trusted_request_id_changed",
      path: ["caseGraph", "compilerMetadata", "requestId"],
      message: "The model must leave the provider request ID placeholder unchanged",
    },
    {
      matches: modelGraph.compilerMetadata.promptVersion === CASE_COMPILER_PROMPT_VERSION,
      code: "trusted_prompt_version_changed",
      path: ["caseGraph", "compilerMetadata", "promptVersion"],
      message: "The candidate changed the compiler prompt version",
    },
    {
      matches: modelGraph.compilerMetadata.compiledAt === context.compiledAt,
      code: "trusted_compiled_at_changed",
      path: ["caseGraph", "compilerMetadata", "compiledAt"],
      message: "The candidate changed the server compilation timestamp",
    },
    {
      matches: modelGraph.compilerMetadata.sourceContentHash === context.sourceContentHash,
      code: "trusted_source_hash_changed",
      path: ["caseGraph", "compilerMetadata", "sourceContentHash"],
      message: "The candidate changed the trusted source content hash",
    },
    {
      matches: modelGraph.compilerMetadata.sourceSegmentCount === context.input.sourceSegments.length,
      code: "trusted_source_count_changed",
      path: ["caseGraph", "compilerMetadata", "sourceSegmentCount"],
      message: "The candidate changed the trusted source segment count",
    },
  ];

  for (const check of trustedChecks) {
    if (!check.matches) addIssue(issues, makeIssue(check.code, check.path, check.message));
  }

  const expectedUncertaintyIds = modelGraph.compilerMetadata.uncertainties.map((item) => item.uncertaintyId);
  if (!equalStringSets(expectedUncertaintyIds, output.review.uncertaintyIds)) {
    addIssue(
      issues,
      makeIssue(
        "uncertainty_report_mismatch",
        ["review", "uncertaintyIds"],
        "The model review must enumerate every compiler uncertainty exactly once",
      ),
    );
  }

  const canonical = CaseGraphV1Schema.safeParse({
    ...modelGraph,
    sourceSegments: context.input.sourceSegments,
  });
  if (!canonical.success) {
    for (const issue of canonical.error.issues.slice(0, MAX_CASE_COMPILER_VALIDATION_ISSUES - issues.length)) {
      addIssue(
        issues,
        makeIssue(
          "strict_schema_invalid",
          [
            "caseGraph",
            ...issue.path.map((segment) =>
              typeof segment === "symbol" ? segment.description ?? "symbol" : segment,
            ),
          ],
          issue.message,
        ),
      );
    }
    return {
      ok: false,
      issues,
      validationReport: buildReport(issues, [], output),
    };
  }

  const graph = canonical.data;

  const grounding = validateGrounding(graph, issues);
  const validationReport = buildReport(issues, grounding, output);
  if (issues.length > 0) {
    return { ok: false, issues, validationReport };
  }

  const normalizedGraph = parseCaseGraphV1({
    ...graph,
    compilerMetadata: {
      ...graph.compilerMetadata,
      requestId: context.providerRequestId,
    },
  });
  const acceptedSourceCitationCount = new Set(
    grounding.flatMap((record) => record.sourceSegmentIds),
  ).size;

  return {
    ok: true,
    output,
    caseGraph: normalizedGraph,
    validationReport,
    acceptedSourceCitationCount,
  };
}
