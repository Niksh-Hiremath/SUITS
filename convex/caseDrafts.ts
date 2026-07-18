import { v } from "convex/values";
import { z } from "zod";

import {
  CaseGraphEntityIdSchema,
  CaseGraphV1Schema,
  SourceSegmentSchema,
  type CaseGraphV1,
  type SourceSegment,
} from "../src/domain/case-graph";
import {
  CASE_UPLOAD_SCHEMA_VERSION,
  CaseUploadVersionMetadataSchema,
  normalizeCaseUploadMimeType,
  type CaseUploadVersionMetadata,
} from "../src/server/case-ingestion/schema";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
  CaseServiceOwnerIdSchema,
  PublishCaseDraftRequestSchema,
  RegisterCaseDraftRequestSchema,
  annotateHumanReview,
  serializePublishedCompilerMetadata,
  type RegisterCaseDraftRequest,
} from "./caseServiceBoundary";

const CASE_SOURCE_SCHEMA_VERSION = "case-source.v1";
const MAX_CASE_GRAPH_RECORD_BYTES = 900_000;

const CaseCompilationAuditSchema = z
  .object({
    schemaVersion: z.literal(CASE_COMPILATION_AUDIT_SCHEMA_VERSION),
    validationReport: RegisterCaseDraftRequestSchema.shape.validationReport,
    observability: RegisterCaseDraftRequestSchema.shape.observability,
  })
  .strict();

const promptInjectionFlag = v.object({
  patternId: v.union(
    v.literal("instruction_override"),
    v.literal("role_impersonation"),
    v.literal("tool_invocation"),
    v.literal("secret_exfiltration"),
    v.literal("safety_bypass"),
  ),
  severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  startOffset: v.number(),
  endOffset: v.number(),
  fingerprint: v.string(),
});

function parseJson<T>(schema: z.ZodType<T>, value: string, code: string): T {
  try {
    return schema.parse(JSON.parse(value) as unknown);
  } catch {
    throw new Error(code);
  }
}

function serializeUploadMetadata(metadata: CaseUploadVersionMetadata): string {
  return JSON.stringify(CaseUploadVersionMetadataSchema.parse(metadata));
}

function uploadMetadata(request: RegisterCaseDraftRequest, indexed: boolean): string {
  return serializeUploadMetadata({
    schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
    digestVerified: true,
    extractionAdapterId: indexed ? request.extractionAdapterId : null,
    extractionCharacterCount: indexed ? request.extractionCharacterCount : 0,
    sourceSegmentCount: indexed ? request.sourceSegments.length : 0,
    injectionFlags: indexed ? request.injectionFlags : [],
    rejectionCode: null,
  });
}

function sourceProvenance(uploadId: string, segment: SourceSegment): string {
  return JSON.stringify({
    sourceId: segment.sourceId,
    uploadId,
    uploadVersion: 1,
    mimeType: segment.mimeType,
    locator: segment.locator,
  });
}

function sourceRecordMatches(
  record: Doc<"caseSources">,
  request: RegisterCaseDraftRequest,
  segment: SourceSegment,
  segmentIndex: number,
): boolean {
  return record.sourceSegmentId === segment.sourceSegmentId &&
    record.caseId === request.caseId &&
    record.caseVersion === 1 &&
    record.uploadId === request.uploadId &&
    record.sourceType === "extracted" &&
    record.label === segment.documentName &&
    record.pageNumber === (segment.locator.kind === "page" ? segment.locator.page : undefined) &&
    record.segmentIndex === segmentIndex &&
    record.content === segment.excerpt &&
    record.contentDigest === segment.sha256 &&
    record.provenanceJson === sourceProvenance(request.uploadId, segment) &&
    record.schemaVersion === CASE_SOURCE_SCHEMA_VERSION;
}

function uploadRecordMatches(
  record: Doc<"caseUploads">,
  request: RegisterCaseDraftRequest,
  uploadRecordId: string,
  version: 1 | 2,
  metadataJson: string,
): boolean {
  return record.uploadRecordId === uploadRecordId &&
    record.uploadId === request.uploadId &&
    record.version === version &&
    record.caseId === request.caseId &&
    record.caseVersion === (version === 2 ? 1 : undefined) &&
    record.ownerId === request.ownerId &&
    record.storageId === request.storageId &&
    record.originalName === request.originalName &&
    record.mimeType === request.mimeType &&
    record.sizeBytes === request.sizeBytes &&
    record.contentDigest === request.contentDigest &&
    record.status === (version === 1 ? "uploaded" : "indexed") &&
    record.metadataJson === metadataJson &&
    record.schemaVersion === CASE_UPLOAD_SCHEMA_VERSION;
}

function assertGraphRecordSize(graphJson: string, compilerMetadataJson: string): void {
  const bytes = new TextEncoder().encode(graphJson).byteLength +
    new TextEncoder().encode(compilerMetadataJson).byteLength;
  if (bytes > MAX_CASE_GRAPH_RECORD_BYTES) throw new Error("CASE_DRAFT_TOO_LARGE");
}

function recordIds(draftGraphId: string): { uploadV1: string; uploadV2: string } {
  const match = /^graph:draft:([a-f0-9]{64})$/u.exec(draftGraphId);
  if (!match?.[1]) throw new Error("CASE_DRAFT_CONFLICT");
  return {
    uploadV1: `upload-record:${match[1]}:v1`,
    uploadV2: `upload-record:${match[1]}:v2`,
  };
}

async function assertStoredUpload(
  ctx: MutationCtx,
  request: RegisterCaseDraftRequest,
  storageId: Id<"_storage">,
): Promise<void> {
  const storedFile = await ctx.db.system.get("_storage", storageId);
  if (!storedFile) throw new Error("CASE_UPLOAD_STORAGE_OBJECT_NOT_FOUND");
  if (storedFile.size !== request.sizeBytes) throw new Error("CASE_UPLOAD_SIZE_MISMATCH");
  if (storedFile.sha256 !== request.contentDigest) throw new Error("CASE_UPLOAD_DIGEST_MISMATCH");
  if (!storedFile.contentType) throw new Error("CASE_UPLOAD_MIME_TYPE_MISMATCH");
  let storedMimeType: string;
  try {
    storedMimeType = normalizeCaseUploadMimeType(storedFile.contentType);
  } catch {
    throw new Error("CASE_UPLOAD_MIME_TYPE_MISMATCH");
  }
  if (storedMimeType !== request.mimeType) throw new Error("CASE_UPLOAD_MIME_TYPE_MISMATCH");
}

async function assertExactRegistrationReplay(
  ctx: MutationCtx,
  request: RegisterCaseDraftRequest,
  draftGraphId: string,
  graphJson: string,
  compilerMetadataJson: string,
): Promise<boolean> {
  const graphRecords = await ctx.db
    .query("caseGraphs")
    .withIndex("by_graph_id", (index) => index.eq("graphId", draftGraphId))
    .take(2);
  const uploadRecords = await ctx.db
    .query("caseUploads")
    .withIndex("by_upload_version", (index) => index.eq("uploadId", request.uploadId))
    .collect();
  if (graphRecords.length === 0 && uploadRecords.length === 0) return false;
  if (graphRecords.length !== 1 || uploadRecords.length !== 2) throw new Error("CASE_DRAFT_CONFLICT");

  const graph = graphRecords[0];
  if (
    !graph ||
    graph.caseId !== request.caseId ||
    graph.version !== 1 ||
    graph.lifecycle !== "draft" ||
    graph.visibility !== "private" ||
    graph.ownerId !== request.ownerId ||
    graph.title !== request.caseGraph.title ||
    graph.graphJson !== graphJson ||
    graph.graphSchemaVersion !== request.caseGraph.schemaVersion ||
    graph.compilerMetadataJson !== compilerMetadataJson ||
    graph.sourceDigest !== request.caseGraph.compilerMetadata.sourceContentHash
  ) {
    throw new Error("CASE_DRAFT_CONFLICT");
  }

  const ids = recordIds(draftGraphId);
  const orderedUploads = [...uploadRecords].sort((left, right) => left.version - right.version);
  if (
    !orderedUploads[0] ||
    !orderedUploads[1] ||
    !uploadRecordMatches(orderedUploads[0], request, ids.uploadV1, 1, uploadMetadata(request, false)) ||
    !uploadRecordMatches(orderedUploads[1], request, ids.uploadV2, 2, uploadMetadata(request, true))
  ) {
    throw new Error("CASE_UPLOAD_CONFLICT");
  }

  const sources = await ctx.db
    .query("caseSources")
    .withIndex("by_upload", (index) => index.eq("uploadId", request.uploadId))
    .collect();
  const orderedSources = [...sources].sort((left, right) => left.segmentIndex - right.segmentIndex);
  if (
    orderedSources.length !== request.sourceSegments.length ||
    orderedSources.some((record, index) => {
      const segment = request.sourceSegments[index];
      return !segment || !sourceRecordMatches(record, request, segment, index);
    })
  ) {
    throw new Error("CASE_DRAFT_CONFLICT");
  }
  return true;
}

export const registerCompiledDraft = internalMutation({
  args: {
    ownerId: v.string(),
    uploadId: v.string(),
    caseId: v.string(),
    draftGraphId: v.string(),
    storageId: v.id("_storage"),
    originalName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    contentDigest: v.string(),
    extractionAdapterId: v.string(),
    extractionCharacterCount: v.number(),
    injectionFlags: v.array(promptInjectionFlag),
    sourceSegmentsJson: v.string(),
    caseGraphJson: v.string(),
    validationReportJson: v.string(),
    observabilityJson: v.string(),
  },
  handler: async (ctx, args) => {
    const request = RegisterCaseDraftRequestSchema.parse({
      ownerId: args.ownerId,
      uploadId: args.uploadId,
      caseId: args.caseId,
      storageId: args.storageId,
      originalName: args.originalName,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      contentDigest: args.contentDigest,
      extractionAdapterId: args.extractionAdapterId,
      extractionCharacterCount: args.extractionCharacterCount,
      injectionFlags: args.injectionFlags,
      sourceSegments: parseJson(z.array(SourceSegmentSchema), args.sourceSegmentsJson, "CASE_DRAFT_CONFLICT"),
      caseGraph: parseJson(CaseGraphV1Schema, args.caseGraphJson, "CASE_DRAFT_CONFLICT"),
      validationReport: parseJson(
        RegisterCaseDraftRequestSchema.shape.validationReport,
        args.validationReportJson,
        "CASE_DRAFT_CONFLICT",
      ),
      observability: parseJson(
        RegisterCaseDraftRequestSchema.shape.observability,
        args.observabilityJson,
        "CASE_DRAFT_CONFLICT",
      ),
    });
    CaseGraphEntityIdSchema.parse(args.draftGraphId);
    await assertStoredUpload(ctx, request, args.storageId);

    const graphJson = JSON.stringify(request.caseGraph);
    const compilerMetadataJson = JSON.stringify({
      schemaVersion: CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
      validationReport: request.validationReport,
      observability: request.observability,
    });
    assertGraphRecordSize(graphJson, compilerMetadataJson);

    if (await assertExactRegistrationReplay(
      ctx,
      request,
      args.draftGraphId,
      graphJson,
      compilerMetadataJson,
    )) {
      return {
        uploadId: request.uploadId,
        caseId: request.caseId,
        version: 2,
        status: "indexed" as const,
        replayed: true,
      };
    }

    const versionCollision = await ctx.db
      .query("caseGraphs")
      .withIndex("by_case_version", (index) => index.eq("caseId", request.caseId).eq("version", 1))
      .first();
    if (versionCollision) throw new Error("CASE_DRAFT_ALREADY_EXISTS");
    for (const segment of request.sourceSegments) {
      const collision = await ctx.db
        .query("caseSources")
        .withIndex("by_source_segment_id", (index) => index.eq("sourceSegmentId", segment.sourceSegmentId))
        .first();
      if (collision) throw new Error("CASE_DRAFT_SOURCE_COLLISION");
    }

    const createdAt = Date.now();
    const ids = recordIds(args.draftGraphId);
    await ctx.db.insert("caseUploads", {
      uploadRecordId: ids.uploadV1,
      uploadId: request.uploadId,
      version: 1,
      caseId: request.caseId,
      ownerId: request.ownerId,
      storageId: args.storageId,
      originalName: request.originalName,
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
      contentDigest: request.contentDigest,
      status: "uploaded",
      metadataJson: uploadMetadata(request, false),
      schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
      createdAt,
    });

    for (let segmentIndex = 0; segmentIndex < request.sourceSegments.length; segmentIndex += 1) {
      const segment = request.sourceSegments[segmentIndex];
      if (!segment) throw new Error("CASE_DRAFT_CONFLICT");
      await ctx.db.insert("caseSources", {
        sourceSegmentId: segment.sourceSegmentId,
        caseId: request.caseId,
        caseVersion: 1,
        uploadId: request.uploadId,
        sourceType: "extracted",
        label: segment.documentName,
        pageNumber: segment.locator.kind === "page" ? segment.locator.page : undefined,
        segmentIndex,
        content: segment.excerpt,
        contentDigest: segment.sha256,
        provenanceJson: sourceProvenance(request.uploadId, segment),
        schemaVersion: CASE_SOURCE_SCHEMA_VERSION,
        createdAt,
      });
    }

    await ctx.db.insert("caseUploads", {
      uploadRecordId: ids.uploadV2,
      uploadId: request.uploadId,
      version: 2,
      caseId: request.caseId,
      caseVersion: 1,
      ownerId: request.ownerId,
      storageId: args.storageId,
      originalName: request.originalName,
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
      contentDigest: request.contentDigest,
      status: "indexed",
      metadataJson: uploadMetadata(request, true),
      schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
      createdAt,
    });
    await ctx.db.insert("caseGraphs", {
      graphId: args.draftGraphId,
      caseId: request.caseId,
      version: 1,
      lifecycle: "draft",
      visibility: "private",
      ownerId: request.ownerId,
      title: request.caseGraph.title,
      graphJson,
      graphSchemaVersion: request.caseGraph.schemaVersion,
      compilerMetadataJson,
      sourceDigest: request.caseGraph.compilerMetadata.sourceContentHash,
      createdBy: "user",
      createdAt,
    });
    return {
      uploadId: request.uploadId,
      caseId: request.caseId,
      version: 2,
      status: "indexed" as const,
      replayed: false,
    };
  },
});

function publicationMatches(
  record: Doc<"caseGraphs">,
  ownerId: string,
  graph: CaseGraphV1,
  graphJson: string,
): boolean {
  return record.caseId === graph.caseId &&
    record.version === 2 &&
    record.lifecycle === "published" &&
    record.visibility === "private" &&
    record.ownerId === ownerId &&
    record.title === graph.title &&
    record.graphJson === graphJson &&
    record.graphSchemaVersion === graph.schemaVersion &&
    record.sourceDigest === graph.compilerMetadata.sourceContentHash;
}

export const publishCompiledDraft = internalMutation({
  args: {
    ownerId: v.string(),
    uploadId: v.string(),
    draftGraphId: v.string(),
    publishedGraphId: v.string(),
    caseGraphJson: v.string(),
  },
  handler: async (ctx, args) => {
    const request = PublishCaseDraftRequestSchema.parse({
      ownerId: args.ownerId,
      uploadId: args.uploadId,
      caseGraph: parseJson(CaseGraphV1Schema, args.caseGraphJson, "CASE_PUBLISH_CONFLICT"),
    });
    CaseServiceOwnerIdSchema.parse(request.ownerId);
    CaseGraphEntityIdSchema.parse(args.draftGraphId);
    CaseGraphEntityIdSchema.parse(args.publishedGraphId);
    const existingPublications = await ctx.db
      .query("caseGraphs")
      .withIndex("by_graph_id", (index) => index.eq("graphId", args.publishedGraphId))
      .take(2);
    const draftRecords = await ctx.db
      .query("caseGraphs")
      .withIndex("by_graph_id", (index) => index.eq("graphId", args.draftGraphId))
      .take(2);
    const draft = draftRecords[0];
    if (draftRecords.length !== 1 || !draft) throw new Error("CASE_DRAFT_NOT_FOUND");
    if (draft.ownerId !== request.ownerId) throw new Error("CASE_DRAFT_NOT_FOUND");
    if (draft.lifecycle !== "draft" || draft.version !== 1 || draft.caseId !== request.caseGraph.caseId) {
      throw new Error("CASE_PUBLISH_CONFLICT");
    }

    const draftGraph = parseJson(CaseGraphV1Schema, draft.graphJson, "CASE_PUBLISH_CONFLICT");
    if (!draft.compilerMetadataJson) throw new Error("CASE_PUBLISH_CONFLICT");
    const publication = annotateHumanReview(
      draftGraph,
      request.caseGraph,
      args.publishedGraphId,
    );
    const graphJson = JSON.stringify(publication.caseGraph);
    const compilationAudit = parseJson(
      CaseCompilationAuditSchema,
      draft.compilerMetadataJson,
      "CASE_PUBLISH_CONFLICT",
    );
    const publishedCompilerMetadataJson = serializePublishedCompilerMetadata(
      compilationAudit,
      publication.audit,
    );
    assertGraphRecordSize(graphJson, publishedCompilerMetadataJson);

    const upload = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", request.uploadId))
      .order("desc")
      .first();
    if (
      !upload ||
      upload.ownerId !== request.ownerId ||
      upload.caseId !== request.caseGraph.caseId ||
      upload.caseVersion !== 1 ||
      upload.version !== 2 ||
      upload.status !== "indexed"
    ) {
      throw new Error("CASE_PUBLISH_CONFLICT");
    }

    if (existingPublications.length > 0) {
      const existing = existingPublications[0];
      if (
        existingPublications.length !== 1 ||
        !existing ||
        !publicationMatches(existing, request.ownerId, publication.caseGraph, graphJson) ||
        existing.compilerMetadataJson !== publishedCompilerMetadataJson
      ) {
        throw new Error("CASE_PUBLISH_CONFLICT");
      }
      return { caseId: request.caseGraph.caseId, version: 2, published: true, replayed: true };
    }

    const latest = await ctx.db
      .query("caseGraphs")
      .withIndex("by_case_version", (index) => index.eq("caseId", request.caseGraph.caseId))
      .order("desc")
      .first();
    if (!latest || latest.graphId !== draft.graphId || latest.version !== 1) {
      throw new Error("CASE_PUBLISH_CONFLICT");
    }

    await ctx.db.insert("caseGraphs", {
      graphId: args.publishedGraphId,
      caseId: publication.caseGraph.caseId,
      version: 2,
      lifecycle: "published",
      visibility: "private",
      ownerId: request.ownerId,
      title: publication.caseGraph.title,
      graphJson,
      graphSchemaVersion: publication.caseGraph.schemaVersion,
      compilerMetadataJson: publishedCompilerMetadataJson,
      sourceDigest: draft.sourceDigest,
      createdBy: "user",
      createdAt: Date.now(),
    });
    return { caseId: request.caseGraph.caseId, version: 2, published: true, replayed: false };
  },
});
