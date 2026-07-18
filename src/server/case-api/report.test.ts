import { describe, expect, it } from "vitest";

import {
  CASE_COMPILER_EDUCATIONAL_DISCLAIMER,
  CASE_COMPILER_MODEL,
  CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
  CASE_COMPILER_PENDING_REQUEST_ID,
  CASE_COMPILER_PROMPT_VERSION,
  CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
  CaseCompilerModelOutputSchema,
  DeterministicCaseCompilerProvider,
  compileCasePacket,
  computeSourceContentHash,
} from "../case-compiler";
import { createThreeWitnessCaseGraphV1Fixture } from "../../domain/case-graph";
import { buildCaseCompilationReviewReport } from "./report";

describe("case compilation review report", () => {
  it("summarizes source, inference, uncertainty, warning, and injection metadata", async () => {
    const fixture = createThreeWitnessCaseGraphV1Fixture();
    const compiledAt = "2026-07-18T13:00:00.000Z";
    fixture.status = "draft";
    fixture.educationalDisclaimer = CASE_COMPILER_EDUCATIONAL_DISCLAIMER;
    fixture.compilerMetadata = {
      ...fixture.compilerMetadata,
      method: "gpt",
      model: CASE_COMPILER_MODEL,
      requestId: CASE_COMPILER_PENDING_REQUEST_ID,
      promptVersion: CASE_COMPILER_PROMPT_VERSION,
      compiledAt,
      sourceContentHash: computeSourceContentHash(fixture.sourceSegments),
      sourceSegmentCount: fixture.sourceSegments.length,
    };
    const { sourceSegments, ...modelGraph } = fixture;
    const modelOutput = CaseCompilerModelOutputSchema.parse({
      schemaVersion: CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
      caseGraph: modelGraph,
      review: {
        overallStatus: fixture.compilerMetadata.uncertainties.length > 0
          ? "needs_review"
          : "ready_for_review",
        summary: "Fixture review complete.",
        checks: [
          {
            code: "fixture_check",
            status: "pass",
            summary: "Grounded.",
            entityIds: [],
            sourceSegmentIds: sourceSegments.map((segment) => segment.sourceSegmentId),
          },
        ],
        uncertaintyIds: fixture.compilerMetadata.uncertainties.map((item) => item.uncertaintyId),
      },
    });
    const compilation = await compileCasePacket({
      provider: new DeterministicCaseCompilerProvider([{ type: "output", output: modelOutput }]),
      input: { caseId: fixture.caseId, sourceSegments },
      maxAttempts: 1,
      clock: () => new Date(compiledAt),
    });
    const report = buildCaseCompilationReviewReport(compilation, [
      {
        patternId: "instruction_override",
        severity: "high",
        startOffset: 0,
        endOffset: 20,
        fingerprint: "a".repeat(64),
      },
      {
        patternId: "instruction_override",
        severity: "high",
        startOffset: 25,
        endOffset: 45,
        fingerprint: "b".repeat(64),
      },
    ]);

    expect(report.schemaVersion).toBe(CASE_COMPILER_VALIDATION_SCHEMA_VERSION);
    expect(report.provenance.factualFields).toBeGreaterThan(0);
    expect(report.provenance.sourceLinked + report.provenance.explicitlyInferred).toBe(
      report.provenance.factualFields,
    );
    expect(report.injectionSignals).toEqual(["instruction_override"]);
    expect(report.warnings.map((warning) => warning.code)).toContain("uncertainty_review");
  });
});
