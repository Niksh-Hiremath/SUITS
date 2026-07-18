import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../src/domain/case-graph";
import {
  CASE_COMPILER_EDUCATIONAL_DISCLAIMER,
  CASE_COMPILER_MODEL,
  CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
  CASE_COMPILER_PENDING_REQUEST_ID,
  CASE_COMPILER_PROMPT_VERSION,
  CaseCompilerModelOutputSchema,
  DeterministicCaseCompilerProvider,
  compileCasePacket,
  computeSourceContentHash,
} from "../src/server/case-compiler";
import { CASE_UPLOAD_SCHEMA_VERSION } from "../src/server/case-ingestion/schema";
import {
  CASE_COMPILATION_AUDIT_SCHEMA_VERSION,
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
      caseId: compilation.caseGraph.caseId,
      version: 1,
      lifecycle: "draft",
      visibility: "private",
      ownerId: OWNER_ID,
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
    const replay = reconstructCaseCompileReplay(
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

  it("makes another owner's existing upload indistinguishable from a miss", async () => {
    const records = await replayRecords();
    const replay = reconstructCaseCompileReplay(
      { ownerId: OTHER_OWNER_ID, uploadId: UPLOAD_ID },
      records.upload,
      [records.draft],
    );

    expect(replay).toEqual({ found: false });
  });

  it("fails closed when the owned persisted draft does not match its upload", async () => {
    const records = await replayRecords();
    expect(() =>
      reconstructCaseCompileReplay(
        { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
        records.upload,
        [{ ...records.draft, caseId: "case:conflict" }],
      ),
    ).toThrow("CASE_COMPILE_REPLAY_CONFLICT");
  });
});
