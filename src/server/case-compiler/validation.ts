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
  CaseCompilerGroundingGroupSchema,
  CaseCompilerGroundingRecordSchema,
  CaseCompilerPersistedValidationReportSchema,
  CaseCompilerValidationIssueSchema,
  CaseCompilerValidationReportSchema,
  type CaseCompilerGroundingRecord,
  type CaseCompilerGroundingGroup,
  type CaseCompilerPersistedValidationReport,
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

type GroundableField = Readonly<{
  entityId: string | null;
  ownerPath: string;
  path: string;
  value: string;
  provenanceScope: "direct" | "record";
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

function canonicalFieldValue(value: string | number | boolean | null): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function addScalarFields(
  fields: GroundableField[],
  value: unknown,
  path: string,
  owner: Omit<GroundableField, "path" | "value">,
): void {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    fields.push({
      ...owner,
      path,
      value: canonicalFieldValue(value),
    });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      fields.push({ ...owner, path, value: "[]" });
      return;
    }
    value.forEach((item, index) => addScalarFields(fields, item, `${path}.${index}`, owner));
    return;
  }

  if (typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      addScalarFields(fields, nestedValue, `${path}.${key}`, owner);
    }
  }
}

/**
 * CaseGraph provenance is intentionally record-scoped. A record's provenance
 * therefore covers every scalar value recursively contained by that record,
 * except child records with their own provenance (currently priorStatements).
 * It never flows between sibling records or up to root title/summary fields.
 */
function addRecordFields(
  fields: GroundableField[],
  record: object,
  path: string,
  entityId: string,
  provenance: readonly Provenance[],
  uncertaintyKind: GroundableField["uncertaintyKind"],
  excludedKeys: ReadonlySet<string>,
): void {
  const owner = {
    entityId,
    ownerPath: path,
    provenanceScope: "record" as const,
    provenance,
    uncertaintyKind,
  };
  for (const [key, value] of Object.entries(record)) {
    if (excludedKeys.has(key)) continue;
    addScalarFields(fields, value, `${path}.${key}`, owner);
  }
}

function collectGroundableFields(graph: CaseGraphV1): GroundableField[] {
  const fields: GroundableField[] = [];
  const addDirectField = (value: string, path: string) => addScalarFields(fields, value, path, {
    entityId: null,
    ownerPath: path,
    provenanceScope: "direct" as const,
    provenance: [] as const,
    uncertaintyKind: null,
  });
  addDirectField(graph.title, "caseGraph.title");
  addDirectField(graph.summary, "caseGraph.summary");

  addRecordFields(
    fields,
    graph.jurisdictionProfile,
    "caseGraph.jurisdictionProfile",
    graph.jurisdictionProfile.profileId,
    graph.jurisdictionProfile.provenance,
    null,
    new Set(["profileId", "provenance"]),
  );

  graph.parties.forEach((entity, index) => {
    addRecordFields(
      fields,
      entity,
      `caseGraph.parties.${index}`,
      entity.partyId,
      entity.provenance,
      null,
      new Set(["partyId", "provenance"]),
    );
  });
  graph.issues.forEach((entity, index) => {
    addRecordFields(
      fields,
      entity,
      `caseGraph.issues.${index}`,
      entity.issueId,
      entity.provenance,
      null,
      new Set(["issueId", "provenance"]),
    );
  });
  graph.timeline.forEach((entity, index) => {
    addRecordFields(
      fields,
      entity,
      `caseGraph.timeline.${index}`,
      entity.timelineEventId,
      entity.provenance,
      null,
      new Set(["timelineEventId", "provenance"]),
    );
  });
  graph.facts.forEach((entity, index) => {
    addRecordFields(
      fields,
      entity,
      `caseGraph.facts.${index}`,
      entity.factId,
      entity.provenance,
      "fact",
      new Set(["factId", "provenance"]),
    );
  });
  graph.evidence.forEach((entity, index) => {
    addRecordFields(
      fields,
      entity,
      `caseGraph.evidence.${index}`,
      entity.evidenceId,
      entity.provenance,
      "evidence",
      new Set(["evidenceId", "provenance"]),
    );
  });
  graph.witnesses.forEach((witness, witnessIndex) => {
    addRecordFields(
      fields,
      witness,
      `caseGraph.witnesses.${witnessIndex}`,
      witness.witnessId,
      witness.provenance,
      "witness",
      new Set(["witnessId", "priorStatements", "provenance"]),
    );
    witness.priorStatements.forEach((statement, statementIndex) => {
      addRecordFields(
        fields,
        statement,
        `caseGraph.witnesses.${witnessIndex}.priorStatements.${statementIndex}`,
        statement.priorStatementId,
        statement.provenance,
        null,
        new Set(["priorStatementId", "provenance"]),
      );
    });
  });
  graph.contradictions.forEach((entity, index) => {
    addRecordFields(
      fields,
      entity,
      `caseGraph.contradictions.${index}`,
      entity.contradictionId,
      entity.provenance,
      null,
      new Set(["contradictionId", "provenance"]),
    );
  });
  addRecordFields(
    fields,
    graph.settlement,
    "caseGraph.settlement",
    `settlement:${graph.caseId}`,
    graph.settlement.provenance,
    null,
    new Set(["provenance"]),
  );
  graph.juryInstructions.forEach((entity, index) => {
    addRecordFields(
      fields,
      entity,
      `caseGraph.juryInstructions.${index}`,
      entity.instructionId,
      entity.provenance,
      null,
      new Set(["instructionId", "provenance"]),
    );
  });
  return fields;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Builds a deterministic audit draft for mock providers and fixtures. Runtime
 * validation never calls this helper: GPT must return its own owner-bound audit.
 */
export function buildCaseCompilerFieldGroundingDraft(
  graph: CaseGraphV1,
): CaseCompilerGroundingGroup[] {
  const allSourceIds = graph.sourceSegments.map((segment) => segment.sourceSegmentId);
  const owners = new Map<string, GroundableField>();
  for (const field of collectGroundableFields(graph)) {
    if (!owners.has(field.ownerPath)) owners.set(field.ownerPath, field);
  }
  return [...owners.values()].map((field) => {
    const sourceEntries = field.provenance.filter((entry) => entry.kind === "source");
    const inferredEntries = field.provenance.filter((entry) => entry.kind === "inferred");
    if (sourceEntries.length > 0) {
      return CaseCompilerGroundingGroupSchema.parse({
        ownerPath: field.ownerPath,
        entityId: field.entityId,
        provenanceScope: field.provenanceScope,
        provenanceIds: sourceEntries.map((entry) => entry.provenanceId),
        grounding: "source",
        sourceSegmentIds: unique(sourceEntries.flatMap((entry) => entry.sourceSegmentIds)),
        confidence: Math.max(...sourceEntries.map((entry) => entry.confidence)),
      });
    }
    if (inferredEntries.length > 0) {
      return CaseCompilerGroundingGroupSchema.parse({
        ownerPath: field.ownerPath,
        entityId: field.entityId,
        provenanceScope: field.provenanceScope,
        provenanceIds: inferredEntries.map((entry) => entry.provenanceId),
        grounding: "inferred",
        sourceSegmentIds: unique(inferredEntries.flatMap((entry) => entry.sourceSegmentIds)),
        confidence: Math.max(...inferredEntries.map((entry) => entry.confidence)),
      });
    }
    const authoringEntries = field.provenance.filter((entry) => entry.kind === "authoring");
    if (authoringEntries.length > 0) {
      return CaseCompilerGroundingGroupSchema.parse({
        ownerPath: field.ownerPath,
        entityId: field.entityId,
        provenanceScope: field.provenanceScope,
        provenanceIds: authoringEntries.map((entry) => entry.provenanceId),
        grounding: "authoring",
        sourceSegmentIds: [],
        confidence: Math.max(...authoringEntries.map((entry) => entry.confidence)),
      });
    }
    return CaseCompilerGroundingGroupSchema.parse({
      ownerPath: field.ownerPath,
      entityId: field.entityId,
      provenanceScope: field.provenanceScope,
      provenanceIds: [],
      grounding: "inferred",
      sourceSegmentIds: field.provenanceScope === "direct" ? allSourceIds : [],
      confidence: 0.75,
    });
  });
}

function hasLinkedUncertainty(graph: CaseGraphV1, field: GroundableField): boolean {
  if (field.uncertaintyKind === null || field.entityId === null) return true;
  const entityId = field.entityId;
  return graph.compilerMetadata.uncertainties.some((uncertainty) => {
    switch (field.uncertaintyKind) {
      case "fact":
        return uncertainty.relatedFactIds.includes(entityId);
      case "evidence":
        return uncertainty.relatedEvidenceIds.includes(entityId);
      case "witness":
        return uncertainty.relatedWitnessIds.includes(entityId);
    }
  });
}

function isAuthoringFieldPath(path: string): boolean {
  return path.startsWith("caseGraph.jurisdictionProfile.") ||
    path.startsWith("caseGraph.settlement.") ||
    path.startsWith("caseGraph.juryInstructions.");
}

export function expandCaseCompilerFieldGrounding(
  graph: CaseGraphV1,
  groups: readonly CaseCompilerGroundingGroup[],
): CaseCompilerGroundingRecord[] {
  const fieldsByOwner = new Map<string, GroundableField[]>();
  for (const field of collectGroundableFields(graph)) {
    const fields = fieldsByOwner.get(field.ownerPath) ?? [];
    fields.push(field);
    fieldsByOwner.set(field.ownerPath, fields);
  }
  return groups.flatMap((group) =>
    (fieldsByOwner.get(group.ownerPath) ?? []).map((field) => CaseCompilerGroundingRecordSchema.parse({
      entityId: group.entityId,
      path: field.path,
      value: field.value,
      provenanceScope: group.provenanceScope,
      provenanceIds: group.provenanceIds,
      grounding: group.grounding,
      sourceSegmentIds: group.sourceSegmentIds,
      confidence: group.confidence,
    })),
  );
}

/**
 * Upgrades an accepted persisted v2 report for read/replay only. Because v2
 * stored entity-level provenance rather than field claims, the normalized
 * report is conservatively marked `needs_review` and identifies the audit as
 * a deterministic compatibility backfill. It is never presented as fresh v3
 * model verification.
 */
export function normalizePersistedCaseCompilerValidationReport(
  report: CaseCompilerPersistedValidationReport,
  graph: CaseGraphV1,
): CaseCompilerValidationReport {
  const parsed = CaseCompilerPersistedValidationReportSchema.parse(report);
  if (parsed.schemaVersion === CASE_COMPILER_VALIDATION_SCHEMA_VERSION) return parsed;

  const fieldGrounding = buildCaseCompilerFieldGroundingDraft(graph);
  const retainedChecks = parsed.checks
    .filter((check) => check.code !== "factual_grounding")
    .slice(0, 48);
  return CaseCompilerValidationReportSchema.parse({
    schemaVersion: CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
    status: parsed.status === "rejected" ? "rejected" : "needs_review",
    checks: [
      ...retainedChecks,
      {
        code: "factual_grounding",
        status: "warning",
        message: "Field paths were reconstructed from canonical v2 record provenance and require human review.",
      },
      {
        code: "legacy_field_grounding_backfill",
        status: "warning",
        message: "This resumable case predates the v3 path-bound compiler audit; no new model verification is claimed.",
      },
    ],
    issues: parsed.issues,
    grounding: expandCaseCompilerFieldGrounding(graph, fieldGrounding),
    uncertainties: parsed.uncertainties,
    modelReview: parsed.modelReview === null
      ? null
      : { ...parsed.modelReview, fieldGrounding },
  });
}

function issuePath(path: string): Array<string | number> {
  return path.split(".").map((segment) => /^\d+$/u.test(segment) ? Number(segment) : segment);
}

function validateGrounding(
  graph: CaseGraphV1,
  issues: CaseCompilerValidationIssue[],
  candidateGroups: readonly CaseCompilerGroundingGroup[],
): CaseCompilerGroundingRecord[] {
  const allowedSourceIds = new Set(graph.sourceSegments.map((segment) => segment.sourceSegmentId));
  const records: CaseCompilerGroundingRecord[] = [];
  const fields = collectGroundableFields(graph);
  const candidateRecords = expandCaseCompilerFieldGrounding(graph, candidateGroups);

  if (fields.length > 2_000) {
    addIssue(
      issues,
      makeIssue(
        "grounding_record_limit",
        [],
        "The compiled graph contains too many factual fields for deterministic grounding review",
      ),
    );
  }

  const expectedOwnerPaths = new Set(fields.map((field) => field.ownerPath));
  for (const group of candidateGroups) {
    if (!expectedOwnerPaths.has(group.ownerPath)) {
      addIssue(
        issues,
        makeIssue(
          "unexpected_grounding_owner",
          issuePath(group.ownerPath),
          "The grounding audit names a provenance owner that is not part of the auditable CaseGraph",
          group.entityId,
          [...group.sourceSegmentIds],
        ),
      );
    }
  }

  const recordsByPath = new Map<string, CaseCompilerGroundingRecord>();
  for (const record of candidateRecords) {
    if (recordsByPath.has(record.path)) {
      addIssue(
        issues,
        makeIssue(
          "duplicate_field_grounding",
          issuePath(record.path),
          "Every factual field must have exactly one grounding record",
          record.entityId,
          [...record.sourceSegmentIds],
        ),
      );
    }
    recordsByPath.set(record.path, record);
  }

  const expectedPaths = new Set(fields.map((field) => field.path));
  for (const record of candidateRecords) {
    if (!expectedPaths.has(record.path)) {
      addIssue(
        issues,
        makeIssue(
          "unexpected_field_grounding",
          issuePath(record.path),
          "The grounding audit contains a path that is not an auditable CaseGraph field",
          record.entityId,
          [...record.sourceSegmentIds],
        ),
      );
    }
  }

  const validatedOwnerPaths = new Set<string>();
  for (const field of fields.slice(0, 2_000)) {
    const record = recordsByPath.get(field.path);
    if (!record) {
      addIssue(
        issues,
        makeIssue(
          "missing_field_grounding",
          issuePath(field.path),
          "Every factual CaseGraph field requires an explicit path-bound grounding record",
          field.entityId,
        ),
      );
      continue;
    }
    records.push(record);
    if (validatedOwnerPaths.has(field.ownerPath)) continue;
    validatedOwnerPaths.add(field.ownerPath);

    if (record.entityId !== field.entityId || record.provenanceScope !== field.provenanceScope) {
      addIssue(
        issues,
        makeIssue(
          "field_grounding_owner_mismatch",
          issuePath(field.path),
          "The grounding record is not bound to the field's provenance owner",
          field.entityId,
          [...record.sourceSegmentIds],
        ),
      );
    }
    if (record.sourceSegmentIds.length !== new Set(record.sourceSegmentIds).size) {
      addIssue(
        issues,
        makeIssue(
          "duplicate_field_source",
          issuePath(field.path),
          "A field grounding record cannot repeat source segment IDs",
          field.entityId,
          [...record.sourceSegmentIds],
        ),
      );
    }
    const unknownSourceIds = record.sourceSegmentIds.filter((sourceId) => !allowedSourceIds.has(sourceId));
    if (unknownSourceIds.length > 0) {
      addIssue(
        issues,
        makeIssue(
          "field_source_unknown",
          issuePath(field.path),
          "The field grounding record cites a source segment outside the trusted packet",
          field.entityId,
          unknownSourceIds,
        ),
      );
    }

    const allowedProvenance = new Map(
      field.provenance.map((entry) => [entry.provenanceId, entry] as const),
    );
    const selectedProvenance = record.provenanceIds
      .map((provenanceId) => allowedProvenance.get(provenanceId))
      .filter((entry): entry is Provenance => entry !== undefined);
    if (
      record.provenanceIds.length !== new Set(record.provenanceIds).size ||
      selectedProvenance.length !== record.provenanceIds.length
    ) {
      addIssue(
        issues,
        makeIssue(
          "field_provenance_mismatch",
          issuePath(field.path),
          "A field may cite only provenance owned by its schema record",
          field.entityId,
          [...record.sourceSegmentIds],
        ),
      );
    }

    if (field.provenanceScope === "direct") {
      if (record.provenanceIds.length > 0) {
        addIssue(
          issues,
          makeIssue(
            "direct_field_provenance_forbidden",
            issuePath(field.path),
            "Root title and summary fields do not inherit entity provenance",
            null,
            [...record.sourceSegmentIds],
          ),
        );
      }
    } else if (record.provenanceIds.length === 0) {
      addIssue(
        issues,
        makeIssue(
          "field_provenance_required",
          issuePath(field.path),
          "A record-scoped field must identify its owning provenance record",
          field.entityId,
          [...record.sourceSegmentIds],
        ),
      );
    }

    if (record.grounding === "source") {
      const sourceProvenance = selectedProvenance.filter((entry) => entry.kind === "source");
      if (
        record.sourceSegmentIds.length === 0 ||
        (field.provenanceScope === "record" && sourceProvenance.length !== selectedProvenance.length)
      ) {
        addIssue(
          issues,
          makeIssue(
            "ungrounded_factual_field",
            issuePath(field.path),
            "Source-grounded fields require direct trusted sources or source provenance owned by the record",
            field.entityId,
            [...record.sourceSegmentIds],
          ),
        );
        continue;
      }
      if (field.provenanceScope === "record") {
        const inheritedSourceIds = new Set(
          sourceProvenance.flatMap((entry) => entry.sourceSegmentIds),
        );
        if (record.sourceSegmentIds.some((sourceId) => !inheritedSourceIds.has(sourceId))) {
          addIssue(
            issues,
            makeIssue(
              "field_source_not_in_provenance",
              issuePath(field.path),
              "A record-scoped field may cite only sources named by its selected provenance",
              field.entityId,
              [...record.sourceSegmentIds],
            ),
          );
        }
      }
      const maximumConfidence = field.provenanceScope === "direct"
        ? 1
        : Math.max(...sourceProvenance.map((entry) => entry.confidence));
      if (record.confidence > maximumConfidence) {
        addIssue(
          issues,
          makeIssue(
            "field_confidence_exceeds_provenance",
            issuePath(field.path),
            "Field confidence cannot exceed its selected provenance confidence",
            field.entityId,
            [...record.sourceSegmentIds],
          ),
        );
      }
      continue;
    }

    if (record.grounding === "authoring") {
      const authoringProvenance = selectedProvenance.filter((entry) => entry.kind === "authoring");
      if (
        field.provenanceScope !== "record" ||
        !isAuthoringFieldPath(field.path) ||
        authoringProvenance.length === 0 ||
        authoringProvenance.length !== selectedProvenance.length ||
        record.sourceSegmentIds.length > 0
      ) {
        addIssue(
          issues,
          makeIssue(
            "invalid_authoring_field",
            issuePath(field.path),
            "Authoring fields require authoring provenance owned by the record and cannot claim packet sources",
            field.entityId,
            [...record.sourceSegmentIds],
          ),
        );
        continue;
      }
      const maximumConfidence = Math.max(...authoringProvenance.map((entry) => entry.confidence));
      if (record.confidence > maximumConfidence) {
        addIssue(
          issues,
          makeIssue(
            "field_confidence_exceeds_provenance",
            issuePath(field.path),
            "Field confidence cannot exceed its selected provenance confidence",
            field.entityId,
          ),
        );
      }
      continue;
    }

    const inferredProvenance = selectedProvenance.filter((entry) => entry.kind === "inferred");
    if (
      record.confidence >= 1 ||
      (field.provenanceScope === "record" && inferredProvenance.length !== selectedProvenance.length)
    ) {
      addIssue(
        issues,
        makeIssue(
          "invalid_inferred_field",
          issuePath(field.path),
          "Inferred fields require inferred owning provenance and confidence below one",
          field.entityId,
          [...record.sourceSegmentIds],
        ),
      );
    }

    if (!hasLinkedUncertainty(graph, field)) {
      addIssue(
        issues,
        makeIssue(
          "inference_missing_uncertainty",
          issuePath(field.path),
          "An inferred fact, evidence item, or witness field requires a linked compiler uncertainty",
          field.entityId,
          [...record.sourceSegmentIds],
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
  const hasGroundingIssue = issues.some((issue) =>
    issue.code.includes("ground") ||
    issue.code.startsWith("field_") ||
    issue.code.startsWith("duplicate_field_") ||
    issue.code.startsWith("direct_field_") ||
    issue.code.startsWith("invalid_") && issue.code.endsWith("_field"),
  );
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
        status: rejected && hasGroundingIssue
          ? "fail"
          : inferredCount > 0
            ? "warning"
            : "pass",
        message: rejected && hasGroundingIssue
          ? "At least one factual field lacks acceptable path-bound grounding."
          : inferredCount > 0
            ? `${inferredCount} factual fields are explicitly inferred and require human review.`
            : "Every factual field is linked to supplied source segments.",
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

  const grounding = validateGrounding(graph, issues, output.review.fieldGrounding);
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
