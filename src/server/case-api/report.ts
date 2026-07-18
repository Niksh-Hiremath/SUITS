import type { CaseCompilationResult } from "../case-compiler";
import type { PromptInjectionFlag } from "../case-ingestion";

export type CaseReviewIssue = Readonly<{
  code: string;
  message: string;
  sourceSegmentIds: string[];
}>;

export type CaseCompilationReviewReport = Readonly<{
  schemaVersion: string;
  warnings: CaseReviewIssue[];
  uncertainties: CaseReviewIssue[];
  provenance: {
    factualFields: number;
    sourceLinked: number;
    explicitlyInferred: number;
  };
  injectionSignals: string[];
}>;

export function buildCaseCompilationReviewReport(
  compilation: CaseCompilationResult,
  injectionFlags: readonly PromptInjectionFlag[],
): CaseCompilationReviewReport {
  const grounding = compilation.validationReport.grounding;
  return {
    schemaVersion: compilation.validationReport.schemaVersion,
    warnings: [
      ...compilation.caseGraph.compilerMetadata.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        sourceSegmentIds: [...warning.sourceSegmentIds],
      })),
      ...compilation.validationReport.checks
        .filter((check) => check.status === "warning")
        .map((check) => ({
          code: check.code,
          message: check.message,
          sourceSegmentIds: [],
        })),
    ],
    uncertainties: compilation.caseGraph.compilerMetadata.uncertainties.map((uncertainty) => ({
      code: uncertainty.uncertaintyId,
      message: uncertainty.description,
      sourceSegmentIds: [...uncertainty.sourceSegmentIds],
    })),
    provenance: {
      factualFields: grounding.length,
      sourceLinked: grounding.filter((record) => record.grounding === "source").length,
      explicitlyInferred: grounding.filter((record) => record.grounding === "inferred").length,
    },
    injectionSignals: [...new Set(injectionFlags.map((flag) => flag.patternId))].sort(),
  };
}
