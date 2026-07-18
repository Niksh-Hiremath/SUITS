import { v } from "convex/values";

import { SourceSegmentSchema } from "../src/domain/case-graph";
import {
  CASE_UPLOAD_SCHEMA_VERSION,
  CaseUploadRegistrationSchema,
  CaseUploadVersionMetadataSchema,
  PromptInjectionFlagSchema,
  normalizeCaseUploadMimeType,
  nextUploadVersion,
  type CaseUploadVersionMetadata,
} from "../src/server/case-ingestion";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

const MAX_UPLOADS_PER_OWNER_QUERY = 500;
const MAX_SOURCE_SEGMENTS_PER_UPLOAD = 1_000;

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

const sourceLocator = v.union(
  v.object({
    kind: v.literal("page"),
    page: v.number(),
    label: v.union(v.string(), v.null()),
  }),
  v.object({
    kind: v.literal("text"),
    startOffset: v.number(),
    endOffset: v.number(),
  }),
);

const sourceSegment = v.object({
  sourceSegmentId: v.string(),
  sourceId: v.string(),
  documentName: v.string(),
  mimeType: v.string(),
  locator: sourceLocator,
  excerpt: v.string(),
  sha256: v.string(),
});

const rejectionCode = v.union(
  v.literal("digest_mismatch"),
  v.literal("extraction_failed"),
  v.literal("unsupported_content"),
  v.literal("unsafe_content"),
);

function parseMetadata(metadataJson: string): CaseUploadVersionMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson) as unknown;
  } catch {
    throw new Error("UPLOAD_METADATA_INVALID");
  }
  return CaseUploadVersionMetadataSchema.parse(parsed);
}

function serializeMetadata(metadata: CaseUploadVersionMetadata): string {
  return JSON.stringify(CaseUploadVersionMetadataSchema.parse(metadata));
}

function publicUpload(record: Doc<"caseUploads">) {
  const metadata = parseMetadata(record.metadataJson);
  return {
    uploadId: record.uploadId,
    version: record.version,
    caseId: record.caseId,
    caseVersion: record.caseVersion,
    originalName: record.originalName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    contentDigest: record.contentDigest,
    status: record.status,
    injectionFlags: metadata.injectionFlags,
    digestVerified: metadata.digestVerified,
    extractionAdapterId: metadata.extractionAdapterId,
    sourceSegmentCount: metadata.sourceSegmentCount,
    rejectionCode: metadata.rejectionCode,
    createdAt: record.createdAt,
  };
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("AUTHENTICATION_REQUIRED");
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerStoredUpload = mutation({
  args: {
    caseId: v.string(),
    storageId: v.id("_storage"),
    originalName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    contentDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("AUTHENTICATION_REQUIRED");

    const storedFile = await ctx.db.system.get("_storage", args.storageId);
    if (!storedFile) throw new Error("UPLOAD_STORAGE_OBJECT_NOT_FOUND");
    if (storedFile.size !== args.sizeBytes) throw new Error("UPLOAD_SIZE_MISMATCH");

    const mimeType = normalizeCaseUploadMimeType(args.mimeType);
    if (storedFile.contentType) {
      const storedMimeType = normalizeCaseUploadMimeType(storedFile.contentType);
      if (storedMimeType !== mimeType) throw new Error("UPLOAD_MIME_TYPE_MISMATCH");
    }

    const uploadId = `upload:${crypto.randomUUID()}`;
    const registration = CaseUploadRegistrationSchema.parse({
      uploadId,
      caseId: args.caseId,
      originalName: args.originalName,
      mimeType,
      sizeBytes: args.sizeBytes,
      contentDigest: args.contentDigest,
    });
    if (storedFile.sha256 !== registration.contentDigest) {
      throw new Error("UPLOAD_DIGEST_MISMATCH");
    }
    const initial = nextUploadVersion(undefined, "uploaded");
    const createdAt = Date.now();
    await ctx.db.insert("caseUploads", {
      uploadRecordId: `upload-record:${crypto.randomUUID()}`,
      uploadId: registration.uploadId,
      version: initial.version,
      caseId: registration.caseId,
      ownerId: identity.tokenIdentifier,
      storageId: args.storageId,
      originalName: registration.originalName,
      mimeType: registration.mimeType,
      sizeBytes: registration.sizeBytes,
      contentDigest: registration.contentDigest,
      status: initial.status,
      metadataJson: serializeMetadata({
        schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
        digestVerified: true,
        extractionAdapterId: null,
        extractionCharacterCount: 0,
        sourceSegmentCount: 0,
        injectionFlags: [],
        rejectionCode: null,
      }),
      schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
      createdAt,
    });
    return { uploadId, version: initial.version, status: initial.status, createdAt };
  },
});

export const getLatest = query({
  args: { uploadId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("AUTHENTICATION_REQUIRED");
    const record = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", args.uploadId))
      .order("desc")
      .first();
    if (!record || record.ownerId !== identity.tokenIdentifier) return null;
    return publicUpload(record);
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("AUTHENTICATION_REQUIRED");
    const records = await ctx.db
      .query("caseUploads")
      .withIndex("by_owner", (index) => index.eq("ownerId", identity.tokenIdentifier))
      .order("desc")
      .take(MAX_UPLOADS_PER_OWNER_QUERY);
    const latestByUpload = new Map<string, Doc<"caseUploads">>();
    for (const record of records) {
      const current = latestByUpload.get(record.uploadId);
      if (!current || current.version < record.version) latestByUpload.set(record.uploadId, record);
    }
    return [...latestByUpload.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(publicUpload);
  },
});

export const getDownloadUrl = query({
  args: { uploadId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("AUTHENTICATION_REQUIRED");
    const record = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", args.uploadId))
      .order("desc")
      .first();
    if (!record || record.ownerId !== identity.tokenIdentifier || !record.storageId) return null;
    return await ctx.storage.getUrl(record.storageId);
  },
});

export const listSourceSegments = query({
  args: { uploadId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("AUTHENTICATION_REQUIRED");
    const upload = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", args.uploadId))
      .order("desc")
      .first();
    if (!upload || upload.ownerId !== identity.tokenIdentifier || upload.status !== "indexed") {
      return [];
    }
    return await ctx.db
      .query("caseSources")
      .withIndex("by_upload", (index) => index.eq("uploadId", args.uploadId))
      .collect();
  },
});

export const getForProcessing = internalQuery({
  args: { uploadId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", args.uploadId))
      .order("desc")
      .first();
    if (!record || record.status !== "uploaded" || !record.storageId) return null;
    return record;
  },
});

export const completeIndexing = internalMutation({
  args: {
    uploadId: v.string(),
    expectedVersion: v.number(),
    caseVersion: v.number(),
    verifiedContentDigest: v.string(),
    extractionAdapterId: v.string(),
    extractionCharacterCount: v.number(),
    injectionFlags: v.array(promptInjectionFlag),
    segments: v.array(sourceSegment),
  },
  handler: async (ctx, args) => {
    const current = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", args.uploadId))
      .order("desc")
      .first();
    if (!current) throw new Error("UPLOAD_NOT_FOUND");
    if (current.version !== args.expectedVersion) throw new Error("UPLOAD_VERSION_STALE");
    if (current.status !== "uploaded") throw new Error("UPLOAD_STATUS_TRANSITION_INVALID");
    if (!Number.isSafeInteger(args.caseVersion) || args.caseVersion < 1) {
      throw new Error("CASE_VERSION_INVALID");
    }
    if (current.contentDigest !== args.verifiedContentDigest) throw new Error("UPLOAD_DIGEST_MISMATCH");
    if (args.segments.length === 0 || args.segments.length > MAX_SOURCE_SEGMENTS_PER_UPLOAD) {
      throw new Error("UPLOAD_SOURCE_SEGMENT_COUNT_INVALID");
    }
    if (!Number.isSafeInteger(args.extractionCharacterCount) || args.extractionCharacterCount < 1) {
      throw new Error("UPLOAD_EXTRACTION_SIZE_INVALID");
    }

    const flags = args.injectionFlags.map((flag) => PromptInjectionFlagSchema.parse(flag));
    const segments = args.segments.map((segment) => SourceSegmentSchema.parse(segment));
    const segmentIds = new Set<string>();
    for (const segment of segments) {
      if (segmentIds.has(segment.sourceSegmentId)) throw new Error("UPLOAD_SOURCE_SEGMENT_DUPLICATE");
      if (segment.mimeType !== current.mimeType) throw new Error("UPLOAD_SOURCE_MIME_TYPE_MISMATCH");
      segmentIds.add(segment.sourceSegmentId);
    }

    const createdAt = Date.now();
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      if (!segment) throw new Error("UPLOAD_SOURCE_SEGMENT_MISSING");
      await ctx.db.insert("caseSources", {
        sourceSegmentId: segment.sourceSegmentId,
        caseId: current.caseId,
        caseVersion: args.caseVersion,
        uploadId: current.uploadId,
        sourceType: "extracted",
        label: segment.documentName,
        pageNumber: segment.locator.kind === "page" ? segment.locator.page : undefined,
        segmentIndex,
        content: segment.excerpt,
        contentDigest: segment.sha256,
        provenanceJson: JSON.stringify({
          sourceId: segment.sourceId,
          uploadId: current.uploadId,
          uploadVersion: current.version,
          mimeType: segment.mimeType,
          locator: segment.locator,
        }),
        schemaVersion: "case-source.v1",
        createdAt,
      });
    }

    const next = nextUploadVersion(
      { version: current.version, status: current.status },
      "indexed",
    );
    await ctx.db.insert("caseUploads", {
      uploadRecordId: `upload-record:${crypto.randomUUID()}`,
      uploadId: current.uploadId,
      version: next.version,
      caseId: current.caseId,
      caseVersion: args.caseVersion,
      ownerId: current.ownerId,
      storageId: current.storageId,
      originalName: current.originalName,
      mimeType: current.mimeType,
      sizeBytes: current.sizeBytes,
      contentDigest: current.contentDigest,
      status: next.status,
      metadataJson: serializeMetadata({
        schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
        digestVerified: true,
        extractionAdapterId: args.extractionAdapterId,
        extractionCharacterCount: args.extractionCharacterCount,
        sourceSegmentCount: segments.length,
        injectionFlags: flags,
        rejectionCode: null,
      }),
      schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
      createdAt,
    });
    return { uploadId: current.uploadId, version: next.version, status: next.status };
  },
});

export const rejectUpload = internalMutation({
  args: {
    uploadId: v.string(),
    expectedVersion: v.number(),
    code: rejectionCode,
  },
  handler: async (ctx, args) => {
    const current = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", args.uploadId))
      .order("desc")
      .first();
    if (!current) throw new Error("UPLOAD_NOT_FOUND");
    if (current.version !== args.expectedVersion) throw new Error("UPLOAD_VERSION_STALE");
    const next = nextUploadVersion(
      { version: current.version, status: current.status },
      "rejected",
    );
    const priorMetadata = parseMetadata(current.metadataJson);
    const createdAt = Date.now();
    await ctx.db.insert("caseUploads", {
      uploadRecordId: `upload-record:${crypto.randomUUID()}`,
      uploadId: current.uploadId,
      version: next.version,
      caseId: current.caseId,
      caseVersion: current.caseVersion,
      ownerId: current.ownerId,
      storageId: current.storageId,
      originalName: current.originalName,
      mimeType: current.mimeType,
      sizeBytes: current.sizeBytes,
      contentDigest: current.contentDigest,
      status: next.status,
      metadataJson: serializeMetadata({
        ...priorMetadata,
        rejectionCode: args.code,
      }),
      schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
      createdAt,
    });
    return { uploadId: current.uploadId, version: next.version, status: next.status };
  },
});
