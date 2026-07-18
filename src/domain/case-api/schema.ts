import { z } from "zod";

import { CaseGraphV1Schema } from "../case-graph";

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
        uploadId: z.string().regex(/^upload:[a-f0-9]{48}$/u),
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
    caseId: z.string().trim().min(1).max(128),
    version: z.number().int().positive(),
    published: z.literal(true),
    replayed: z.boolean(),
  })
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
