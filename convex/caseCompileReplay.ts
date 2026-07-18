import { v } from "convex/values";
import { z } from "zod";

import {
  CaseGraphV1Schema,
  type CaseGraphV1,
  type Provenance,
} from "../src/domain/case-graph";
import {
  MAX_CASE_COMPILER_SOURCE_SEGMENTS,
} from "../src/server/case-compiler/constants";
import {
  CaseCompilerPersistedObservabilitySchema,
  CaseCompilerPersistedValidationReportSchema,
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
  CaseCompilationAuditSchema,
  CasePublicationAuditSchema,
  CaseServiceOwnerIdSchema,
  annotateHumanReview,
  deriveDraftGraphId,
  derivePublishedGraphId,
} from "./caseServiceBoundary";

const PersistedCaseCompilationResultSchema = z
  .object({
    caseGraph: CaseGraphV1Schema,
    validationReport: CaseCompilerPersistedValidationReportSchema,
    observability: CaseCompilerPersistedObservabilitySchema,
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
      validationReport: CaseCompilerPersistedValidationReportSchema,
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
  graphId: string;
  caseId: string;
  version: number;
  lifecycle: string;
  visibility: string;
  ownerId?: string;
  uploadId?: string;
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

function provenanceCollections(graph: CaseGraphV1): Provenance[][] {
  return [
    graph.jurisdictionProfile.provenance,
    ...graph.parties.map((item) => item.provenance),
    ...graph.issues.map((item) => item.provenance),
    ...graph.timeline.map((item) => item.provenance),
    ...graph.facts.map((item) => item.provenance),
    ...graph.evidence.map((item) => item.provenance),
    ...graph.witnesses.flatMap((item) => [
      item.provenance,
      ...item.priorStatements.map((statement) => statement.provenance),
    ]),
    ...graph.contradictions.map((item) => item.provenance),
    graph.settlement.provenance,
    ...graph.juryInstructions.map((item) => item.provenance),
  ];
}

function stripServerReviewProvenance(
  draft: CaseGraphV1,
  published: CaseGraphV1,
  publicationGraphId: string,
): CaseGraphV1 {
  const publicationToken = /^graph:published:([a-f0-9]{64})$/u.exec(publicationGraphId)?.[1];
  if (!publicationToken) return replayConflict();
  const reviewIdPattern = new RegExp(
    `^prov:review:${publicationToken.slice(0, 16)}:[0-9]{4}$`,
    "u",
  );
  const draftProvenanceIds = new Set(
    provenanceCollections(draft).flat().map((item) => item.provenanceId),
  );
  const reviewed = structuredClone(published);
  for (const collection of provenanceCollections(reviewed)) {
    const retained = collection.filter((item) =>
      draftProvenanceIds.has(item.provenanceId) || !reviewIdPattern.test(item.provenanceId),
    );
    collection.splice(0, collection.length, ...retained);
  }
  return CaseGraphV1Schema.parse(reviewed);
}

/**
 * Reconstructs the latest owner-visible CaseGraph while retaining the original
 * compilation report. An owner mismatch is deliberately indistinguishable from
 * a missing upload and is resolved before any private graph payload is parsed.
 */
export async function reconstructCaseCompileReplay(
  requestValue: unknown,
  upload: CaseCompileReplayUploadRecord | null,
  graphRecords: readonly CaseCompileReplayGraphRecord[],
): Promise<CaseCompileReplayResponse> {
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

  const drafts = graphRecords.filter((record) => record.version === 1);
  const publications = graphRecords.filter((record) => record.version === 2);
  const draft = drafts[0];
  const publication = publications[0];
  if (
    drafts.length !== 1 ||
    !draft ||
    publications.length > 1 ||
    graphRecords.length !== drafts.length + publications.length
  ) {
    return replayConflict();
  }
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
  const expectedDraftGraphId = await deriveDraftGraphId(request.uploadId);
  if (
    draft.graphId !== expectedDraftGraphId ||
    (draft.uploadId !== undefined && draft.uploadId !== request.uploadId)
  ) {
    return replayConflict();
  }

  const draftGraph = parsePersistedJson(CaseGraphV1Schema, draft.graphJson);
  const audit = parsePersistedJson(CaseCompilationAuditSchema, draft.compilerMetadataJson);
  const uploadMetadata = parsePersistedJson(
    CaseUploadVersionMetadataSchema,
    upload.metadataJson,
  );
  const compilation = PersistedCaseCompilationResultSchema.parse({
    caseGraph: draftGraph,
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

  let visibleGraph = compilation.caseGraph;
  if (publication) {
    const expectedPublishedGraphId = await derivePublishedGraphId(request.ownerId, request.uploadId);
    if (
      publication.graphId !== expectedPublishedGraphId ||
      publication.ownerId !== request.ownerId ||
      publication.caseId !== upload.caseId ||
      publication.version !== 2 ||
      publication.lifecycle !== "published" ||
      publication.visibility !== "private" ||
      publication.createdBy !== "user" ||
      (publication.uploadId !== undefined && publication.uploadId !== request.uploadId)
    ) {
      return replayConflict();
    }
    const publishedGraph = parsePersistedJson(CaseGraphV1Schema, publication.graphJson);
    const publicationAudit = parsePersistedJson(
      CasePublicationAuditSchema,
      publication.compilerMetadataJson,
    );
    if (
      publishedGraph.caseId !== compilation.caseGraph.caseId ||
      publishedGraph.status !== "published" ||
      publishedGraph.title !== publication.title ||
      publishedGraph.schemaVersion !== publication.graphSchemaVersion ||
      publishedGraph.version !== compilation.caseGraph.version ||
      publishedGraph.educationalDisclaimer !== compilation.caseGraph.educationalDisclaimer ||
      JSON.stringify(publishedGraph.sourceSegments) !== JSON.stringify(compilation.caseGraph.sourceSegments) ||
      JSON.stringify(publishedGraph.compilerMetadata) !== JSON.stringify(compilation.caseGraph.compilerMetadata) ||
      publication.sourceDigest !== draft.sourceDigest ||
      publicationAudit.humanReview.publicationGraphId !== publication.graphId ||
      JSON.stringify(publicationAudit.compilation) !== JSON.stringify(audit)
    ) {
      return replayConflict();
    }
    let rebuiltPublication;
    try {
      rebuiltPublication = annotateHumanReview(
        compilation.caseGraph,
        stripServerReviewProvenance(compilation.caseGraph, publishedGraph, publication.graphId),
        publication.graphId,
      );
    } catch {
      return replayConflict();
    }
    if (
      JSON.stringify(rebuiltPublication.caseGraph) !== publication.graphJson ||
      JSON.stringify(rebuiltPublication.audit) !== JSON.stringify(publicationAudit.humanReview)
    ) {
      return replayConflict();
    }
    visibleGraph = publishedGraph;
  }

  return CaseCompileReplayResponseSchema.parse({
    found: true,
    caseGraph: visibleGraph,
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
    const graphRecords = await ctx.db
      .query("caseGraphs")
      .withIndex("by_case_version", (index) => index.eq("caseId", upload.caseId))
      .take(3);
    return reconstructCaseCompileReplay(request, upload, graphRecords);
  },
});
