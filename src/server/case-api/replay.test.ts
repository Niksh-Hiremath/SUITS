import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../../domain/case-graph";
import {
  CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
  normalizePersistedCaseCompilerValidationReport,
} from "../case-compiler";

import {
  CaseCompileReplayResponseSchema,
  buildCaseCompileReplayResponse,
} from "./replay";

describe("case compiler replay compatibility", () => {
  it("resumes a persisted v2 publication through an explicit review-only v3 normalization", () => {
    const caseGraph = createThreeWitnessCaseGraphV1Fixture();
    caseGraph.caseId = `case:${"a".repeat(48)}`;
    const sourceProvenance = caseGraph.parties[0].provenance[0];
    const replay = CaseCompileReplayResponseSchema.parse({
      found: true,
      caseGraph,
      validationReport: {
        schemaVersion: "case-compiler.validation.v2",
        status: "ready_for_review",
        checks: [
          {
            code: "factual_grounding",
            status: "pass",
            message: "Every factual entity is linked to supplied source segments.",
          },
        ],
        issues: [],
        grounding: [
          {
            entityId: caseGraph.parties[0].partyId,
            path: "parties.0",
            grounding: "source",
            sourceSegmentIds: sourceProvenance.sourceSegmentIds,
            confidence: sourceProvenance.confidence,
          },
        ],
        uncertainties: caseGraph.compilerMetadata.uncertainties,
        modelReview: {
          overallStatus: "ready_for_review",
          summary: "Persisted compiler v2 review.",
          checks: [
            {
              code: "source_review",
              status: "pass",
              summary: "Entity provenance reviewed.",
              entityIds: [caseGraph.parties[0].partyId],
              sourceSegmentIds: sourceProvenance.sourceSegmentIds,
            },
          ],
          uncertaintyIds: caseGraph.compilerMetadata.uncertainties.map(
            (uncertainty) => uncertainty.uncertaintyId,
          ),
        },
      },
      injectionFlags: [],
      upload: {
        uploadId: `upload:${"b".repeat(48)}`,
        fileName: "persisted-v2.md",
        mimeType: "text/markdown",
        sizeBytes: 512,
        sourceSegmentCount: caseGraph.sourceSegments.length,
      },
    });
    if (!replay.found) throw new Error("Expected a replay hit");

    const normalized = normalizePersistedCaseCompilerValidationReport(
      replay.validationReport,
      replay.caseGraph,
    );
    const response = buildCaseCompileReplayResponse(replay, {
      uploadId: replay.upload.uploadId,
      caseId: replay.caseGraph.caseId,
    });

    expect(normalized.schemaVersion).toBe(CASE_COMPILER_VALIDATION_SCHEMA_VERSION);
    expect(normalized.status).toBe("needs_review");
    expect(normalized.grounding).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "caseGraph.title", provenanceScope: "direct" }),
      expect.objectContaining({
        path: "caseGraph.witnesses.0.knowledgeBoundary.allowedTopics.0",
        provenanceScope: "record",
      }),
      expect.objectContaining({
        path: "caseGraph.settlement.participants.0.confidentialPriorities.0",
        grounding: "authoring",
      }),
    ]));
    expect(normalized.checks).toContainEqual(expect.objectContaining({
      code: "legacy_field_grounding_backfill",
      status: "warning",
    }));
    expect(response.caseGraph.caseId).toBe(caseGraph.caseId);
    expect(response.report.schemaVersion).toBe(CASE_COMPILER_VALIDATION_SCHEMA_VERSION);
    expect(response.report.warnings.map((warning) => warning.code)).toContain(
      "legacy_field_grounding_backfill",
    );
  });
});
