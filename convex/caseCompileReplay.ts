import { v } from "convex/values";
import { z } from "zod";

import { CaseGraphV1Schema } from "../src/domain/case-graph";
import {
  MAX_CASE_COMPILER_SOURCE_SEGMENTS,
} from "../src/server/case-compiler/constants";
import {
  CaseCompilationResultSchema,
  CaseCompilerObservabilitySchema,
  CaseCompilerValidationReportSchema,
} from "../src/server/case-compiler/schemas";
import {
  CaseIngestionEntityIdSchema,
  CaseUploadMimeTypeSchema,
  CaseUploadVersionMetadataSchema,
  MAX_CASE_UPLOAD_SIZE_BYTES,
  MAX_PROMPT_INJECTION_FLAGS,
  OriginalFileNameSchema,
  PromptInjectionFlagSchema,
} from "../src/server/case-ingestion/schema";
import { internalQuery } from "./_generated/server";
import {
  CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
  CaseServiceOwnerIdSchema,
} from "./caseServiceBoundary";

const CaseCompilationAuditSchema = z
  .object({
    schemaVersion: z.literal(CASE_COMPILATION_AUDIT_SCHEMA_VERSION),
    validationReport: CaseCompilerValidationReportSchema,
    observability: CaseCompilerObservabilitySchema,
  })
  .strict();

export const CaseCompileReplayRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
  })
  .strict();

const CaseCompileReplayUploadSchema = z
  .object({
    uploadId: CaseIngestionEntityIdSchema,
    fileName: OriginalFileNameSchema,
    mimeType: CaseUploadMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_CASE_UPLOAD_SIZE_BYTES),
    sourceSegmentCount: z.number().int().positive().max(MAX_CASE_COMPILER_SOURCE_SEGMENTS),
  })
  .strict();

export const CaseCompileReplayResponseSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false) }).strict(),
  z
    .object({
      found: z.literal(true),
      caseGraph: CaseGraphV1Schema,
      validationReport: CaseCompilerValidationReportSchema,
      injectionFlags: z.array(PromptInjectionFlagSchema).max(MAX_PROMPT_INJECTION_FLAGS),
      upload: CaseCompileReplayUploadSchema,
    })
    .strict(),
]);

export type CaseCompileReplayResponse = z.infer<typeof CaseCompileReplayResponseSchema>;

export type CaseCompileReplayUploadRecord = Readonly<{
  uploadId: string;
  version: number;
  caseId: string;
  caseVersion?: number;
  ownerId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  metadataJson: string;
}>;

export type CaseCompileReplayGraphRecord = Readonly<{
  caseId: string;
  version: number;
  lifecycle: string;
  visibility: string;
  ownerId?: string;
  title: string;
  graphJson: string;
  graphSchemaVersion: string;
  compilerMetadataJson?: string;
  sourceDigest?: string;
  createdBy: string;
}>;

function replayMiss(): CaseCompileReplayResponse {
  return { found: false };
}

function replayConflict(): never {
  throw new Error("CASE_COMPILE_REPLAY_CONFLICT");
}

function parsePersistedJson<T>(schema: z.ZodType<T>, value: string | undefined): T {
  if (value === undefined) return replayConflict();
  try {
    return schema.parse(JSON.parse(value) as unknown);
  } catch {
    return replayConflict();
  }
}

/**
 * Reconstructs only the data that the compile route originally returned. An
 * owner mismatch is deliberately indistinguishable from a missing upload and
 * is resolved before any private draft payload is parsed.
 */
export function reconstructCaseCompileReplay(
  requestValue: unknown,
  upload: CaseCompileReplayUploadRecord | null,
  draftRecords: readonly CaseCompileReplayGraphRecord[],
): CaseCompileReplayResponse {
  const request = CaseCompileReplayRequestSchema.parse(requestValue);
  if (!upload || upload.ownerId !== request.ownerId) return replayMiss();
  if (
    upload.uploadId !== request.uploadId ||
    upload.version !== 2 ||
    upload.caseVersion !== 1 ||
    upload.status !== "indexed"
  ) {
    return replayConflict();
  }

  const draft = draftRecords[0];
  if (draftRecords.length !== 1 || !draft) return replayConflict();
  if (
    draft.ownerId !== request.ownerId ||
    draft.caseId !== upload.caseId ||
    draft.version !== 1 ||
    draft.lifecycle !== "draft" ||
    draft.visibility !== "private" ||
    draft.createdBy !== "user"
  ) {
    return replayConflict();
  }

  const caseGraph = parsePersistedJson(CaseGraphV1Schema, draft.graphJson);
  const audit = parsePersistedJson(CaseCompilationAuditSchema, draft.compilerMetadataJson);
  const uploadMetadata = parsePersistedJson(
    CaseUploadVersionMetadataSchema,
    upload.metadataJson,
  );
  const compilation = CaseCompilationResultSchema.parse({
    caseGraph,
    validationReport: audit.validationReport,
    observability: audit.observability,
  });

  if (
    compilation.caseGraph.caseId !== upload.caseId ||
    compilation.caseGraph.status !== "draft" ||
    compilation.caseGraph.title !== draft.title ||
    compilation.caseGraph.schemaVersion !== draft.graphSchemaVersion ||
    compilation.caseGraph.compilerMetadata.sourceContentHash !== draft.sourceDigest ||
    compilation.caseGraph.compilerMetadata.sourceContentHash !== audit.observability.sourceContentHash ||
    compilation.caseGraph.sourceSegments.length !== uploadMetadata.sourceSegmentCount ||
    compilation.caseGraph.sourceSegments.length !== audit.observability.sourceSegmentCount ||
    uploadMetadata.digestVerified !== true ||
    uploadMetadata.extractionAdapterId === null ||
    uploadMetadata.rejectionCode !== null ||
    audit.validationReport.status === "rejected" ||
    audit.validationReport.issues.length > 0
  ) {
    return replayConflict();
  }

  return CaseCompileReplayResponseSchema.parse({
    found: true,
    caseGraph: compilation.caseGraph,
    validationReport: compilation.validationReport,
    injectionFlags: uploadMetadata.injectionFlags,
    upload: {
      uploadId: upload.uploadId,
      fileName: upload.originalName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      sourceSegmentCount: uploadMetadata.sourceSegmentCount,
    },
  });
}

export const lookupCompiledDraft = internalQuery({
  args: {
    ownerId: v.string(),
    uploadId: v.string(),
  },
  handler: async (ctx, args) => {
    const request = CaseCompileReplayRequestSchema.parse(args);
    const upload = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", request.uploadId))
      .order("desc")
      .first();

    // Do not query or parse a private graph until ownership is established.
    if (!upload || upload.ownerId !== request.ownerId) return replayMiss();
    const draftRecords = await ctx.db
      .query("caseGraphs")
      .withIndex("by_case_version", (index) =>
        index.eq("caseId", upload.caseId).eq("version", 1),
      )
      .take(2);
    return reconstructCaseCompileReplay(request, upload, draftRecords);
  },
});
