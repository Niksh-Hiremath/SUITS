import { z } from "zod";

import { CaseGraphV1Schema } from "../case-graph";

const CompiledCaseIdSchema = z.string().regex(/^case:[a-f0-9]{48}$/u);
const CompiledUploadIdSchema = z.string().regex(/^upload:[a-f0-9]{48}$/u);

export const CaseReviewIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(240),
    message: z.string().trim().min(1).max(2_000),
    sourceSegmentIds: z.array(z.string().trim().min(1).max(240)).max(200),
  })
  .strict();

export const CaseCompilationReviewReportSchema = z
  .object({
    schemaVersion: z.string().trim().min(1).max(120),
    warnings: z.array(CaseReviewIssueSchema).max(200),
    uncertainties: z.array(CaseReviewIssueSchema).max(500),
    provenance: z
      .object({
        factualFields: z.number().int().nonnegative(),
        sourceLinked: z.number().int().nonnegative(),
        explicitlyInferred: z.number().int().nonnegative(),
      })
      .strict(),
    injectionSignals: z.array(z.string().trim().min(1).max(120)).max(20),
  })
  .strict();

export const CaseCompileResponseSchema = z
  .object({
    caseGraph: CaseGraphV1Schema,
    report: CaseCompilationReviewReportSchema,
    upload: z
      .object({
        uploadId: CompiledUploadIdSchema,
        fileName: z.string().trim().min(1).max(300),
        mimeType: z.string().trim().min(1).max(160),
        sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
        sourceSegmentCount: z.number().int().positive().max(2_000),
      })
      .strict(),
  })
  .strict();

export const CasePublishResponseSchema = z
  .object({
    caseId: CompiledCaseIdSchema,
    version: z.literal(2),
    published: z.literal(true),
    replayed: z.boolean(),
    caseGraph: CaseGraphV1Schema,
  })
  .strict()
  .superRefine((response, ctx) => {
    if (response.caseGraph.caseId !== response.caseId) {
      ctx.addIssue({ code: "custom", path: ["caseGraph", "caseId"], message: "Published case ID mismatch" });
    }
    if (response.caseGraph.status !== "published") {
      ctx.addIssue({ code: "custom", path: ["caseGraph", "status"], message: "Expected a published CaseGraph" });
    }
  });

export const OwnedCaseSummarySchema = z
  .object({
    uploadId: CompiledUploadIdSchema,
    caseId: CompiledCaseIdSchema,
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(5_000),
    witnessCount: z.number().int().positive().max(500),
    evidenceCount: z.number().int().positive().max(2_000),
    status: z.enum(["draft", "published"]),
    recordVersion: z.union([z.literal(1), z.literal(2)]),
    updatedAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (
      (record.status === "draft" && record.recordVersion !== 1) ||
      (record.status === "published" && record.recordVersion !== 2)
    ) {
      ctx.addIssue({ code: "custom", path: ["recordVersion"], message: "Case status/version mismatch" });
    }
  });

export const OwnedCaseListResponseSchema = z
  .object({ cases: z.array(OwnedCaseSummarySchema).max(100) })
  .strict();

export const CaseSessionResponseSchema = z.object({ ready: z.literal(true) }).strict();

export const CaseApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().trim().min(1).max(160),
        message: z.string().trim().min(1).max(2_000),
      })
      .strict(),
  })
  .strict();

export type CaseCompileResponse = z.infer<typeof CaseCompileResponseSchema>;
export type CasePublishResponse = z.infer<typeof CasePublishResponseSchema>;
export type OwnedCaseListResponse = z.infer<typeof OwnedCaseListResponseSchema>;
export type OwnedCaseSummary = z.infer<typeof OwnedCaseSummarySchema>;
