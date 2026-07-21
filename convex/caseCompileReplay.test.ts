import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
} from "../src/domain/case-graph";
import {
  CASE_COMPILER_EDUCATIONAL_DISCLAIMER,
  CASE_COMPILER_MODEL,
  CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
  CASE_COMPILER_PENDING_REQUEST_ID,
  CASE_COMPILER_PROMPT_VERSION,
  CaseCompilerModelOutputSchema,
  CaseCompilerObservabilitySchema,
  DeterministicCaseCompilerProvider,
  buildCaseCompilerFieldGroundingDraft,
  compileCasePacket,
  computeSourceContentHash,
} from "../src/server/case-compiler";
import { CASE_UPLOAD_SCHEMA_VERSION } from "../src/server/case-ingestion/schema";
import {
  CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
  annotateHumanReview,
  deriveDraftGraphId,
  derivePublishedGraphId,
  serializePublishedCompilerMetadata,
} from "./caseServiceBoundary";
import {
  CaseCompileReplayRequestSchema,
  CaseCompileReplayResponseSchema,
  reconstructCaseCompileReplay,
  type CaseCompileReplayGraphRecord,
  type CaseCompileReplayUploadRecord,
} from "./caseCompileReplay";

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";
const UPLOAD_ID = `upload:${"a".repeat(48)}`;
const COMPILED_AT = "2026-07-18T13:00:00.000Z";

async function replayRecords(): Promise<{
  upload: CaseCompileReplayUploadRecord;
  draft: CaseCompileReplayGraphRecord;
}> {
  const fixture = createThreeWitnessCaseGraphV1Fixture();
  fixture.status = "draft";
  fixture.educationalDisclaimer = CASE_COMPILER_EDUCATIONAL_DISCLAIMER;
  fixture.compilerMetadata = {
    ...fixture.compilerMetadata,
    method: "gpt",
    model: CASE_COMPILER_MODEL,
    requestId: CASE_COMPILER_PENDING_REQUEST_ID,
    promptVersion: CASE_COMPILER_PROMPT_VERSION,
    compiledAt: COMPILED_AT,
    sourceContentHash: computeSourceContentHash(fixture.sourceSegments),
    sourceSegmentCount: fixture.sourceSegments.length,
  };
  const { sourceSegments, ...modelGraph } = fixture;
  const modelOutput = CaseCompilerModelOutputSchema.parse({
    schemaVersion: CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
    caseGraph: modelGraph,
    review: {
      overallStatus: fixture.compilerMetadata.uncertainties.length > 0
        ? "needs_review"
        : "ready_for_review",
      summary: "Fixture replay review complete.",
      checks: [
        {
          code: "fixture_check",
          status: "pass",
          summary: "Grounded.",
          entityIds: [],
          sourceSegmentIds: sourceSegments.map((segment) => segment.sourceSegmentId),
        },
      ],
      uncertaintyIds: fixture.compilerMetadata.uncertainties.map((item) => item.uncertaintyId),
      fieldGrounding: buildCaseCompilerFieldGroundingDraft(fixture),
    },
  });
  const compilation = await compileCasePacket({
    provider: new DeterministicCaseCompilerProvider([{ type: "output", output: modelOutput }]),
    input: { caseId: fixture.caseId, sourceSegments },
    maxAttempts: 1,
    clock: () => new Date(COMPILED_AT),
  });
  const extractionCharacterCount = sourceSegments.reduce(
    (total, segment) => total + segment.excerpt.length,
    0,
  );
  return {
    upload: {
      uploadId: UPLOAD_ID,
      version: 2,
      caseId: compilation.caseGraph.caseId,
      caseVersion: 1,
      ownerId: OWNER_ID,
      originalName: "packet.txt",
      mimeType: "text/plain",
      sizeBytes: extractionCharacterCount,
      status: "indexed",
      metadataJson: JSON.stringify({
        schemaVersion: CASE_UPLOAD_SCHEMA_VERSION,
        digestVerified: true,
        extractionAdapterId: "extractor:text",
        extractionCharacterCount,
        sourceSegmentCount: sourceSegments.length,
        injectionFlags: [],
        rejectionCode: null,
      }),
    },
    draft: {
      graphId: await deriveDraftGraphId(UPLOAD_ID),
      caseId: compilation.caseGraph.caseId,
      version: 1,
      lifecycle: "draft",
      visibility: "private",
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
      title: compilation.caseGraph.title,
      graphJson: JSON.stringify(compilation.caseGraph),
      graphSchemaVersion: compilation.caseGraph.schemaVersion,
      compilerMetadataJson: JSON.stringify({
        schemaVersion: CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
        validationReport: compilation.validationReport,
        observability: compilation.observability,
      }),
      sourceDigest: compilation.caseGraph.compilerMetadata.sourceContentHash,
      createdBy: "user",
    },
  };
}

async function publicationRecord(
  records: Awaited<ReturnType<typeof replayRecords>>,
): Promise<CaseCompileReplayGraphRecord> {
  const draftGraph = CaseGraphV1Schema.parse(JSON.parse(records.draft.graphJson) as unknown);
  const reviewedGraph = {
    ...draftGraph,
    status: "published" as const,
    title: "Reviewed fixture publication",
    parties: draftGraph.parties.map((party, index) => index === 0
      ? { ...party, description: `${party.description} Reviewed for publication.` }
      : party),
  };
  const graphId = await derivePublishedGraphId(OWNER_ID, UPLOAD_ID);
  const publication = annotateHumanReview(draftGraph, reviewedGraph, graphId);
  return {
    ...records.draft,
    graphId,
    uploadId: UPLOAD_ID,
    version: 2,
    lifecycle: "published",
    title: publication.caseGraph.title,
    graphJson: JSON.stringify(publication.caseGraph),
    compilerMetadataJson: serializePublishedCompilerMetadata(
      JSON.parse(records.draft.compilerMetadataJson ?? "null") as unknown,
      publication.audit,
    ),
  };
}

describe("case compile replay boundary", () => {
  it("strictly validates the owner-scoped lookup request and response", () => {
    expect(CaseCompileReplayRequestSchema.parse({ ownerId: OWNER_ID, uploadId: UPLOAD_ID })).toEqual({
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
    });
    expect(() =>
      CaseCompileReplayRequestSchema.parse({
        ownerId: OWNER_ID,
        uploadId: UPLOAD_ID,
        contentDigest: "a".repeat(64),
      }),
    ).toThrow();
    expect(CaseCompileReplayResponseSchema.parse({ found: false })).toEqual({ found: false });
    expect(() => CaseCompileReplayResponseSchema.parse({ found: false, ownerId: OWNER_ID })).toThrow();
  });

  it("reconstructs only the compile response data persisted for the owner", async () => {
    const records = await replayRecords();
    const replay = await reconstructCaseCompileReplay(
      { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [records.draft],
    );

    expect(replay.found).toBe(true);
    if (!replay.found) throw new Error("Expected a replay hit");
    expect(replay.caseGraph).toEqual(JSON.parse(records.draft.graphJson));
    expect(replay.upload).toEqual({
      uploadId: UPLOAD_ID,
      fileName: "packet.txt",
      mimeType: "text/plain",
      sizeBytes: records.upload.sizeBytes,
      sourceSegmentCount: replay.caseGraph.sourceSegments.length,
    });
    expect(replay).not.toHaveProperty("ownerId");
    expect(replay).not.toHaveProperty("observability");
    expect(replay.upload).not.toHaveProperty("storageId");
    expect(replay.upload).not.toHaveProperty("contentDigest");
  });

  it("keeps a previously compiled DOCX draft replayable after active extraction is retired", async () => {
    const records = await replayRecords();
    const legacyUpload: CaseCompileReplayUploadRecord = {
      ...records.upload,
      originalName: "legacy-packet.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };

    const replay = await reconstructCaseCompileReplay(
      { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      legacyUpload,
      [records.draft],
    );

    expect(replay.found).toBe(true);
    if (!replay.found) throw new Error("Expected a legacy DOCX replay hit");
    expect(replay.upload.fileName).toBe("legacy-packet.docx");
    expect(replay.upload.mimeType).toContain("wordprocessingml");
  });

  it("keeps a persisted compiler v2 draft resumable at the Convex boundary", async () => {
    const records = await replayRecords();
    const sourceDigest = records.draft.sourceDigest;
    if (!sourceDigest) throw new Error("Expected persisted source digest");
    const graph = createThreeWitnessCaseGraphV1Fixture();
    graph.status = "draft";
    graph.compilerMetadata = {
      ...graph.compilerMetadata,
      method: "gpt",
      model: CASE_COMPILER_MODEL,
      requestId: "persisted-v2-request",
      promptVersion: "case-compiler.prompt.v2",
      compiledAt: COMPILED_AT,
      sourceContentHash: sourceDigest,
      sourceSegmentCount: graph.sourceSegments.length,
    };
    const firstParty = graph.parties[0];
    if (!firstParty) throw new Error("Expected fixture party");
    const sourceProvenance = firstParty.provenance[0];
    if (!sourceProvenance) throw new Error("Expected fixture party provenance");
    const persistedAudit = JSON.parse(records.draft.compilerMetadataJson ?? "null") as {
      observability: unknown;
    };
    const observability = CaseCompilerObservabilitySchema.parse(persistedAudit.observability);
    const v2Draft: CaseCompileReplayGraphRecord = {
      ...records.draft,
      title: graph.title,
      graphJson: JSON.stringify(graph),
      compilerMetadataJson: JSON.stringify({
        schemaVersion: CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
        validationReport: {
          schemaVersion: "case-compiler.validation.v2",
          status: "ready_for_review",
          checks: [{
            code: "factual_grounding",
            status: "pass",
            message: "Every factual entity is linked to supplied source segments.",
          }],
          issues: [],
          grounding: [{
            entityId: firstParty.partyId,
            path: "parties.0",
            grounding: "source",
            sourceSegmentIds: sourceProvenance.sourceSegmentIds,
            confidence: sourceProvenance.confidence,
          }],
          uncertainties: graph.compilerMetadata.uncertainties,
          modelReview: null,
        },
        observability: {
          ...observability,
          promptVersion: "case-compiler.prompt.v2",
          outputSchemaVersion: "case-compiler.output.v2",
        },
      }),
    };

    const replay = await reconstructCaseCompileReplay(
      { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [v2Draft],
    );

    expect(replay.found).toBe(true);
    if (!replay.found) throw new Error("Expected a replay hit");
    expect(replay.validationReport.schemaVersion).toBe("case-compiler.validation.v2");
    expect(replay.caseGraph.compilerMetadata.promptVersion).toBe("case-compiler.prompt.v2");
  });

  it("returns the reviewed publication instead of reopening a stale draft", async () => {
    const records = await replayRecords();
    const publication = await publicationRecord(records);

    const replay = await reconstructCaseCompileReplay(
      { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [records.draft, publication],
    );

    expect(replay.found).toBe(true);
    if (!replay.found) throw new Error("Expected a replay hit");
    expect(replay.caseGraph.status).toBe("published");
    expect(replay.caseGraph.title).toBe("Reviewed fixture publication");
  });

  it("makes another owner's existing upload indistinguishable from a miss", async () => {
    const records = await replayRecords();
    const replay = await reconstructCaseCompileReplay(
      { ownerId: OTHER_OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [records.draft],
    );

    expect(replay).toEqual({ found: false });
  });

  it("fails closed when the owned persisted draft does not match its upload", async () => {
    const records = await replayRecords();
    await expect(
      reconstructCaseCompileReplay(
        { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
        records.upload,
        [{ ...records.draft, caseId: "case:conflict" }],
      ),
    ).rejects.toThrow("CASE_COMPILE_REPLAY_CONFLICT");
  });

  it("rejects malformed or detached publication audit metadata", async () => {
    const records = await replayRecords();
    const publication = await publicationRecord(records);
    const audit = JSON.parse(publication.compilerMetadataJson ?? "null") as Record<string, unknown>;

    await expect(reconstructCaseCompileReplay(
      { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [records.draft, { ...publication, compilerMetadataJson: records.draft.compilerMetadataJson }],
    )).rejects.toThrow("CASE_COMPILE_REPLAY_CONFLICT");

    const humanReview = audit.humanReview as Record<string, unknown>;
    await expect(reconstructCaseCompileReplay(
      { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [records.draft, {
        ...publication,
        compilerMetadataJson: JSON.stringify({
          ...audit,
          humanReview: { ...humanReview, publicationGraphId: `graph:published:${"f".repeat(64)}` },
        }),
      }],
    )).rejects.toThrow("CASE_COMPILE_REPLAY_CONFLICT");
  });

  it("rejects forged or missing server review provenance", async () => {
    const records = await replayRecords();
    const publication = await publicationRecord(records);
    const graph = CaseGraphV1Schema.parse(JSON.parse(publication.graphJson) as unknown);
    const reviewIndex = graph.parties[0]?.provenance.findIndex((item) => item.kind === "authoring") ?? -1;
    if (reviewIndex < 0 || !graph.parties[0]) throw new Error("Expected review provenance");

    const forged = structuredClone(graph);
    const forgedProvenance = forged.parties[0]?.provenance[reviewIndex];
    if (!forgedProvenance) throw new Error("Expected forged provenance target");
    forgedProvenance.note = "Forged server review marker.";
    await expect(reconstructCaseCompileReplay(
      { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [records.draft, { ...publication, graphJson: JSON.stringify(forged) }],
    )).rejects.toThrow("CASE_COMPILE_REPLAY_CONFLICT");

    const missing = structuredClone(graph);
    missing.parties[0]?.provenance.splice(reviewIndex, 1);
    await expect(reconstructCaseCompileReplay(
      { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [records.draft, { ...publication, graphJson: JSON.stringify(missing) }],
    )).rejects.toThrow("CASE_COMPILE_REPLAY_CONFLICT");
  });
});
