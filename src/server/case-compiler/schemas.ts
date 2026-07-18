import { z } from "zod";

import {
  CaseGraphEntityIdSchema,
  CaseGraphV1Schema,
  CaseGraphV1WithoutSourceSegmentsSchema,
  CompilerUncertaintySchema,
  SourceSegmentSchema,
} from "../../domain/case-graph";

import {
  CASE_COMPILER_MODEL,
  CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
  CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
  CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
  MAX_CASE_COMPILER_SOURCE_CHARACTERS,
  MAX_CASE_COMPILER_SOURCE_SEGMENTS,
  MAX_CASE_COMPILER_VALIDATION_ISSUES,
} from "./constants";

const DateTimeSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");

export const CaseCompilerInputSchema = z
  .object({
    caseId: CaseGraphEntityIdSchema,
    sourceSegments: z.array(SourceSegmentSchema).min(1).max(MAX_CASE_COMPILER_SOURCE_SEGMENTS),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    let characters = 0;

    input.sourceSegments.forEach((segment, index) => {
      characters += segment.excerpt.length;
      if (seen.has(segment.sourceSegmentId)) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceSegments", index, "sourceSegmentId"],
          message: `Duplicate source segment ID: ${segment.sourceSegmentId}`,
        });
      }
      seen.add(segment.sourceSegmentId);
    });

    if (characters > MAX_CASE_COMPILER_SOURCE_CHARACTERS) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceSegments"],
        message: `Source packet exceeds ${MAX_CASE_COMPILER_SOURCE_CHARACTERS} characters`,
      });
    }
  });

export const CaseCompilerModelCheckSchema = z
  .object({
    code: CaseGraphEntityIdSchema,
    status: z.enum(["pass", "warning"]),
    summary: z.string().trim().min(1).max(1_000),
    entityIds: z.array(CaseGraphEntityIdSchema).max(100),
    sourceSegmentIds: z.array(CaseGraphEntityIdSchema).max(MAX_CASE_COMPILER_SOURCE_SEGMENTS),
  })
  .strict();

export const CaseCompilerModelReviewSchema = z
  .object({
    overallStatus: z.enum(["ready_for_review", "needs_review"]),
    summary: z.string().trim().min(1).max(2_000),
    checks: z.array(CaseCompilerModelCheckSchema).min(1).max(50),
    uncertaintyIds: z.array(CaseGraphEntityIdSchema).max(100),
  })
  .strict();

/**
 * The model-facing Structured Output contract deliberately excludes trusted
 * source payloads. The server attaches the exact input source segments before
 * validating the result with the canonical CaseGraphV1Schema.
 */
export const CaseCompilerModelOutputSchema = z
  .object({
    schemaVersion: z.literal(CASE_COMPILER_OUTPUT_SCHEMA_VERSION),
    caseGraph: CaseGraphV1WithoutSourceSegmentsSchema,
    review: CaseCompilerModelReviewSchema,
  })
  .strict();

export const CaseCompilerValidationIssueSchema = z
  .object({
    code: CaseGraphEntityIdSchema,
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).max(32),
    message: z.string().trim().min(1).max(1_000),
    entityId: CaseGraphEntityIdSchema.nullable(),
    sourceSegmentIds: z.array(CaseGraphEntityIdSchema).max(MAX_CASE_COMPILER_SOURCE_SEGMENTS),
  })
  .strict();

export const CaseCompilerGroundingRecordSchema = z
  .object({
    entityId: CaseGraphEntityIdSchema,
    path: z.string().trim().min(1).max(500),
    grounding: z.enum(["source", "inferred"]),
    sourceSegmentIds: z.array(CaseGraphEntityIdSchema).max(MAX_CASE_COMPILER_SOURCE_SEGMENTS),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const CaseCompilerDeterministicCheckSchema = z
  .object({
    code: CaseGraphEntityIdSchema,
    status: z.enum(["pass", "warning", "fail"]),
    message: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const CaseCompilerValidationReportSchema = z
  .object({
    schemaVersion: z.literal(CASE_COMPILER_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["ready_for_review", "needs_review", "rejected"]),
    checks: z.array(CaseCompilerDeterministicCheckSchema).min(1).max(50),
    issues: z.array(CaseCompilerValidationIssueSchema).max(MAX_CASE_COMPILER_VALIDATION_ISSUES),
    grounding: z.array(CaseCompilerGroundingRecordSchema).max(2_000),
    uncertainties: z.array(CompilerUncertaintySchema).max(500),
    modelReview: CaseCompilerModelReviewSchema.nullable(),
  })
  .strict();

export const CaseCompilerTokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
  })
  .strict();

export const CaseCompilerAttemptTraceSchema = z
  .object({
    attempt: z.number().int().positive(),
    mode: z.enum(["compile", "repair"]),
    outcome: z.enum(["accepted", "validation_failed", "provider_failed"]),
    requestId: z.string().trim().min(1).max(240).nullable(),
    responseId: z.string().trim().min(1).max(240).nullable(),
    latencyMs: z.number().nonnegative(),
    streamEventCount: z.number().int().nonnegative(),
    streamedCharacterCount: z.number().int().nonnegative(),
    usage: CaseCompilerTokenUsageSchema.nullable(),
    validationIssueCodes: z.array(CaseGraphEntityIdSchema).max(MAX_CASE_COMPILER_VALIDATION_ISSUES),
  })
  .strict();

export const CaseCompilerObservabilitySchema = z
  .object({
    protocolVersion: z.literal(CASE_COMPILER_PROVIDER_PROTOCOL_VERSION),
    model: z.literal(CASE_COMPILER_MODEL),
    provider: z.string().trim().min(1).max(120),
    promptVersion: z.string().trim().min(1).max(120),
    outputSchemaVersion: z.literal(CASE_COMPILER_OUTPUT_SCHEMA_VERSION),
    sourceContentHash: Sha256Schema,
    sourceSegmentCount: z.number().int().positive(),
    startedAt: DateTimeSchema,
    completedAt: DateTimeSchema,
    latencyMs: z.number().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    acceptedSourceCitationCount: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
    attempts: z.array(CaseCompilerAttemptTraceSchema).min(1),
  })
  .strict();

export const CaseCompilationResultSchema = z
  .object({
    caseGraph: CaseGraphV1Schema,
    validationReport: CaseCompilerValidationReportSchema,
    observability: CaseCompilerObservabilitySchema,
  })
  .strict();

export type CaseCompilerInput = z.infer<typeof CaseCompilerInputSchema>;
export type CaseCompilerModelOutput = z.infer<typeof CaseCompilerModelOutputSchema>;
export type CaseCompilerModelReview = z.infer<typeof CaseCompilerModelReviewSchema>;
export type CaseCompilerValidationIssue = z.infer<typeof CaseCompilerValidationIssueSchema>;
export type CaseCompilerGroundingRecord = z.infer<typeof CaseCompilerGroundingRecordSchema>;
export type CaseCompilerValidationReport = z.infer<typeof CaseCompilerValidationReportSchema>;
export type CaseCompilerTokenUsage = z.infer<typeof CaseCompilerTokenUsageSchema>;
export type CaseCompilerAttemptTrace = z.infer<typeof CaseCompilerAttemptTraceSchema>;
export type CaseCompilerObservability = z.infer<typeof CaseCompilerObservabilitySchema>;
export type CaseCompilationResult = z.infer<typeof CaseCompilationResultSchema>;
