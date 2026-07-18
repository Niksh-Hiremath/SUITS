import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
  type CaseGraphV1,
} from "../src/domain/case-graph";
import {
  CASE_COMPILER_MODEL,
  CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
  CASE_COMPILER_PROMPT_VERSION,
  CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
  CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
} from "../src/server/case-compiler/constants";
import { CASE_UPLOAD_SCHEMA_VERSION } from "../src/server/case-ingestion/schema";
import type { Id } from "./_generated/dataModel";
import {
  CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
  CaseCompilationAuditSchema,
  CasePublicationAuditSchema,
  deriveDraftGraphId,
  derivePublishedGraphId,
} from "./caseServiceBoundary";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./caseCompileReplay.ts": () => import("./caseCompileReplay"),
  "./caseDrafts.ts": () => import("./caseDrafts"),
  "./publishedCases.ts": () => import("./publishedCases"),
};

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";
const UPLOAD_ID = `upload:${"a".repeat(48)}`;
const CASE_ID = `case:${"b".repeat(48)}`;
const CONTENT_DIGEST = "c".repeat(64);
const COMPILED_AT = "2026-07-18T12:00:00.000Z";
const REQUEST_ID = "test-case-publication-request";

type TestBackend = TestConvex<typeof schema>;

type PublishArgs = Readonly<{
  ownerId: string;
  uploadId: string;
  draftGraphId: string;
  publishedGraphId: string;
  caseGraphJson: string;
}>;

type PublishResult = Readonly<{
  caseId: string;
  version: number;
  published: boolean;
  replayed: boolean;
  caseGraph: CaseGraphV1;
}>;

type ReplayResult = Readonly<{
  found: boolean;
  caseGraph?: CaseGraphV1;
  validationReport?: unknown;
  injectionFlags?: unknown[];
  upload?: Readonly<{ uploadId: string }>;
}>;

type OwnedCaseList = Readonly<{
  cases: Array<Readonly<{
    uploadId: string;
    caseId: string;
    title: string;
    summary: string;
    witnessCount: number;
    evidenceCount: number;
    status: "draft" | "published";
    recordVersion: 1 | 2;
    updatedAt: number;
  }>>;
}>;

const publishReference = makeFunctionReference<"mutation", PublishArgs, PublishResult>(
  "caseDrafts:publishCompiledDraft",
);
const replayReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; uploadId: string }>,
  ReplayResult
>("caseCompileReplay:lookupCompiledDraft");
const listReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string }>,
  OwnedCaseList
>("publishedCases:listOwnedCases");

function createDraftGraph(): CaseGraphV1 {
  const graph = createThreeWitnessCaseGraphV1Fixture();
  graph.caseId = CASE_ID;
  graph.status = "draft";
  graph.compilerMetadata = {
    ...graph.compilerMetadata,
    method: "gpt",
    model: CASE_COMPILER_MODEL,
    requestId: REQUEST_ID,
    promptVersion: CASE_COMPILER_PROMPT_VERSION,
    compiledAt: COMPILED_AT,
  };
  return graph;
}

function compilationAudit(graph: CaseGraphV1) {
  return CaseCompilationAuditSchema.parse({
    schemaVersion: CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
    validationReport: {
      schemaVersion: CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
      status: "ready_for_review",
      checks: [{
        code: "strict_schema",
        status: "pass",
        message: "The test draft satisfies the compiler schema.",
      }],
      issues: [],
      grounding: [],
      uncertainties: graph.compilerMetadata.uncertainties,
      modelReview: null,
    },
    observability: {
      protocolVersion: CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
      model: CASE_COMPILER_MODEL,
      provider: "deterministic-test",
      promptVersion: CASE_COMPILER_PROMPT_VERSION,
      outputSchemaVersion: CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
      sourceContentHash: graph.compilerMetadata.sourceContentHash,
      sourceSegmentCount: graph.sourceSegments.length,
      startedAt: COMPILED_AT,
      completedAt: COMPILED_AT,
      latencyMs: 0,
      retryCount: 0,
      acceptedSourceCitationCount: graph.sourceSegments.length,
      estimatedCostUsd: 0,
      attempts: [{
        attempt: 1,
        mode: "compile",
        outcome: "accepted",
        requestId: REQUEST_ID,
        responseId: "test-case-publication-response",
        latencyMs: 0,
        streamEventCount: 3,
        streamedCharacterCount: 1,
        usage: null,
        validationIssueCodes: [],
      }],
    },
  });
}

async function insertOwnerDraft(backend: TestBackend): Promise<Readonly<{
  draft: CaseGraphV1;
  draftGraphId: string;
  publishedGraphId: string;
  storageId: Id<"_storage">;
}>> {
  const draft = createDraftGraph();
  const [draftGraphId, publishedGraphId] = await Promise.all([
    deriveDraftGraphId(UPLOAD_ID),
    derivePublishedGraphId(OWNER_ID, UPLOAD_ID),
  ]);
  const packet = "Fictional owner-bound publication integration packet.";
  const uploadMetadata = JSON.stringify({
    schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
    digestVerified: true,
    extractionAdapterId: "builtin-text-v1",
    extractionCharacterCount: packet.length,
    sourceSegmentCount: draft.sourceSegments.length,
    injectionFlags: [],
    rejectionCode: null,
  });
  const audit = compilationAudit(draft);
  const createdAt = Date.UTC(2026, 6, 18, 12, 0, 0);

  const storageId = await backend.run(async (ctx) => {
    const stored = await ctx.storage.store(new Blob([packet], { type: "text/plain" }));
    await ctx.db.insert("caseUploads", {
      uploadRecordId: "upload-record:publication-test:v1",
      uploadId: UPLOAD_ID,
      version: 1,
      caseId: CASE_ID,
      ownerId: OWNER_ID,
      storageId: stored,
      originalName: "publication-test.txt",
      mimeType: "text/plain",
      sizeBytes: packet.length,
      contentDigest: CONTENT_DIGEST,
      status: "uploaded",
      metadataJson: JSON.stringify({
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
    await ctx.db.insert("caseUploads", {
      uploadRecordId: "upload-record:publication-test:v2",
      uploadId: UPLOAD_ID,
      version: 2,
      caseId: CASE_ID,
      caseVersion: 1,
      ownerId: OWNER_ID,
      storageId: stored,
      originalName: "publication-test.txt",
      mimeType: "text/plain",
      sizeBytes: packet.length,
      contentDigest: CONTENT_DIGEST,
      status: "indexed",
      metadataJson: uploadMetadata,
      schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
      createdAt,
    });
    await ctx.db.insert("caseGraphs", {
      graphId: draftGraphId,
      caseId: CASE_ID,
      version: 1,
      lifecycle: "draft",
      visibility: "private",
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
      title: draft.title,
      graphJson: JSON.stringify(draft),
      graphSchemaVersion: draft.schemaVersion,
      compilerMetadataJson: JSON.stringify(audit),
      sourceDigest: draft.compilerMetadata.sourceContentHash,
      createdBy: "user",
      createdAt,
    });
    return stored;
  });

  return { draft, draftGraphId, publishedGraphId, storageId };
}

describe("owner-bound case publication persistence", () => {
  it("publishes reviewed edits, reopens the durable result, and isolates it from other owners", async () => {
    const backend = convexTest({ schema, modules });
    const fixture = await insertOwnerDraft(backend);

    const draftReplay = await backend.query(replayReference, {
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
    });
    expect(draftReplay).toMatchObject({
      found: true,
      caseGraph: { caseId: CASE_ID, status: "draft" },
      upload: { uploadId: UPLOAD_ID },
    });
    expect(await backend.query(listReference, { ownerId: OWNER_ID })).toMatchObject({
      cases: [{ caseId: CASE_ID, uploadId: UPLOAD_ID, status: "draft", recordVersion: 1 }],
    });

    await expect(backend.mutation(publishReference, {
      ownerId: OTHER_OWNER_ID,
      uploadId: UPLOAD_ID,
      draftGraphId: fixture.draftGraphId,
      publishedGraphId: await derivePublishedGraphId(OTHER_OWNER_ID, UPLOAD_ID),
      caseGraphJson: JSON.stringify({ ...fixture.draft, status: "published" }),
    })).rejects.toThrow("CASE_DRAFT_NOT_FOUND");
    expect(await backend.query(replayReference, {
      ownerId: OTHER_OWNER_ID,
      uploadId: UPLOAD_ID,
    })).toEqual({ found: false });
    expect(await backend.query(listReference, { ownerId: OTHER_OWNER_ID })).toEqual({ cases: [] });

    const reviewed = structuredClone(fixture.draft);
    reviewed.status = "published";
    reviewed.title = "Rina Shah v. Redwood Signal Systems — reviewed";
    reviewed.summary = `${reviewed.summary} The reviewer clarified the educational framing.`;
    reviewed.facts[0].proposition = "Rina sent the safety complaint at 10:14 AM on March 10, as shown by the packet email.";
    reviewed.witnesses[0].summary = "Rina may testify about the complaint and communications she personally observed.";

    const publication = await backend.mutation(publishReference, {
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
      draftGraphId: fixture.draftGraphId,
      publishedGraphId: fixture.publishedGraphId,
      caseGraphJson: JSON.stringify(reviewed),
    });
    expect(publication).toMatchObject({
      caseId: CASE_ID,
      version: 2,
      published: true,
      replayed: false,
      caseGraph: {
        title: reviewed.title,
        summary: reviewed.summary,
        status: "published",
      },
    });
    expect(publication.caseGraph.facts[0].proposition).toBe(reviewed.facts[0].proposition);
    expect(publication.caseGraph.facts[0].provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "authoring", sourceSegmentIds: [] }),
    ]));

    const persisted = await backend.run(async (ctx) => {
      const records = await ctx.db
        .query("caseGraphs")
        .withIndex("by_case_version", (index) => index.eq("caseId", CASE_ID))
        .collect();
      const draft = records.find((record) => record.version === 1);
      const published = records.find((record) => record.version === 2);
      if (!draft || !published?.compilerMetadataJson) {
        throw new Error("TEST_PUBLICATION_RECORD_MISSING");
      }
      return {
        recordCount: records.length,
        draftGraph: JSON.parse(draft.graphJson) as unknown,
        publishedGraph: JSON.parse(published.graphJson) as unknown,
        publicationAudit: CasePublicationAuditSchema.parse(
          JSON.parse(published.compilerMetadataJson) as unknown,
        ),
      };
    });
    expect(persisted.recordCount).toBe(2);
    expect(persisted.draftGraph).toMatchObject({ title: fixture.draft.title, status: "draft" });
    const persistedPublication = CaseGraphV1Schema.parse(persisted.publishedGraph);
    expect(persistedPublication).toMatchObject({
      title: reviewed.title,
      status: "published",
    });
    expect(persistedPublication.facts[0].proposition).toBe(reviewed.facts[0].proposition);
    expect(persisted.publicationAudit.humanReview.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "case", changedFields: ["title", "summary"] }),
      expect.objectContaining({ path: `facts.${reviewed.facts[0].factId}` }),
      expect.objectContaining({ path: `witnesses.${reviewed.witnesses[0].witnessId}` }),
    ]));

    const reopened = await backend.query(replayReference, {
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
    });
    expect(reopened).toMatchObject({
      found: true,
      caseGraph: {
        caseId: CASE_ID,
        title: reviewed.title,
        summary: reviewed.summary,
        status: "published",
      },
      upload: { uploadId: UPLOAD_ID },
    });
    expect(reopened.caseGraph?.facts[0].proposition).toBe(reviewed.facts[0].proposition);
    expect(await backend.query(listReference, { ownerId: OWNER_ID })).toMatchObject({
      cases: [{
        caseId: CASE_ID,
        uploadId: UPLOAD_ID,
        title: reviewed.title,
        summary: reviewed.summary,
        status: "published",
        recordVersion: 2,
      }],
    });
    expect(await backend.query(replayReference, {
      ownerId: OTHER_OWNER_ID,
      uploadId: UPLOAD_ID,
    })).toEqual({ found: false });
    expect(await backend.query(listReference, { ownerId: OTHER_OWNER_ID })).toEqual({ cases: [] });
  });
});
