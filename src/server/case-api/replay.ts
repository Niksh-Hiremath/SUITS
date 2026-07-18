import { z } from "zod";

import { CaseCompileResponseSchema, type CaseCompileResponse } from "../../domain/case-api";
import { CaseGraphV1Schema } from "../../domain/case-graph";
import {
  CaseCompilerValidationReportSchema,
  MAX_CASE_COMPILER_SOURCE_SEGMENTS,
} from "../case-compiler";
import {
  MAX_CASE_UPLOAD_SIZE_BYTES,
  MAX_PROMPT_INJECTION_FLAGS,
  PromptInjectionFlagSchema,
} from "../case-ingestion";
import { ConvexCaseServiceError } from "./convex-service";
import { buildCaseCompilationReviewReport } from "./report";

export const CaseCompileReplayResponseSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false) }).strict(),
  z
    .object({
      found: z.literal(true),
      caseGraph: CaseGraphV1Schema,
      validationReport: CaseCompilerValidationReportSchema,
      injectionFlags: z.array(PromptInjectionFlagSchema).max(MAX_PROMPT_INJECTION_FLAGS),
      upload: z
        .object({
          uploadId: z.string().regex(/^upload:[a-f0-9]{48}$/u),
          fileName: z.string().trim().min(1).max(300),
          mimeType: z.string().trim().min(1).max(160),
          sizeBytes: z.number().int().positive().max(MAX_CASE_UPLOAD_SIZE_BYTES),
          sourceSegmentCount: z.number().int().positive().max(MAX_CASE_COMPILER_SOURCE_SEGMENTS),
        })
        .strict(),
    })
    .strict(),
]);

export type CaseCompileReplayResponse = z.infer<typeof CaseCompileReplayResponseSchema>;
export type CaseCompileReplayHit = Extract<CaseCompileReplayResponse, { found: true }>;

export function buildCaseCompileReplayResponse(
  replay: CaseCompileReplayHit,
  expected: Readonly<{ uploadId: string; caseId?: string }>,
): CaseCompileResponse {
  if (
    replay.upload.uploadId !== expected.uploadId ||
    (expected.caseId !== undefined && replay.caseGraph.caseId !== expected.caseId) ||
    !/^case:[a-f0-9]{48}$/u.test(replay.caseGraph.caseId) ||
    replay.caseGraph.status !== "draft" ||
    replay.caseGraph.sourceSegments.length !== replay.upload.sourceSegmentCount ||
    replay.validationReport.status === "rejected"
  ) {
    throw new ConvexCaseServiceError("CASE_COMPILE_REPLAY_MISMATCH", 502);
  }
  return CaseCompileResponseSchema.parse({
    caseGraph: replay.caseGraph,
    report: buildCaseCompilationReviewReport(replay, replay.injectionFlags),
    upload: replay.upload,
  });
}
