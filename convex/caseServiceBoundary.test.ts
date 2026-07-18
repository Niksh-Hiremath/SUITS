import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture, type CaseGraphV1 } from "../src/domain/case-graph";
import {
  CASE_COMPILER_MODEL,
  CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
  CASE_COMPILER_PROMPT_VERSION,
  CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
  CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
} from "../src/server/case-compiler/constants";
import {
  CaseServiceBoundaryError,
  RegisterCaseDraftRequestSchema,
  authorizeCaseServiceRequest,
  caseGraphProvenanceSnapshot,
  caseServiceErrorResponse,
  caseServiceJson,
  deriveDraftGraphId,
  derivePublishedGraphId,
  sha256Hex,
  verifyRegisterCaseDraftIntegrity,
  type RegisterCaseDraftRequest,
} from "./caseServiceBoundary";

const SERVICE_SECRET = "suits-test-service-secret-with-more-than-thirty-two-characters";
const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const UPLOAD_ID = "upload:123e4567-e89b-42d3-a456-426614174001";
const CASE_ID = "case:123e4567-e89b-42d3-a456-426614174002";
const CONTENT_DIGEST = "a".repeat(64);
const COMPILED_AT = "2026-07-18T12:00:00.000Z";
const REQUEST_ID = "fake-compiler-request-1";

function replaceSourceReferences(graph: CaseGraphV1, replacements: ReadonlyMap<string, string>): CaseGraphV1 {
  let serialized = JSON.stringify(graph);
  for (const [prior, next] of replacements) {
    serialized = serialized.replaceAll(JSON.stringify(prior), JSON.stringify(next));
  }
  return JSON.parse(serialized) as CaseGraphV1;
}

async function validRegistration(): Promise<RegisterCaseDraftRequest> {
  const sourceFingerprint = await sha256Hex(`${UPLOAD_ID}:${CONTENT_DIGEST}`);
  const sourceId = `source:${sourceFingerprint.slice(0, 32)}`;
  const fixture = createThreeWitnessCaseGraphV1Fixture();
  const replacements = new Map<string, string>();
  const sourceSegments = await Promise.all(
    fixture.sourceSegments.map(async (segment, index) => {
      const digest = await sha256Hex(segment.excerpt);
      const sourceSegmentId = `segment:${sourceFingerprint.slice(0, 20)}:${String(index + 1).padStart(4, "0")}:${digest.slice(0, 12)}`;
      replacements.set(segment.sourceSegmentId, sourceSegmentId);
      return {
        ...segment,
        sourceSegmentId,
        sourceId,
        documentName: "packet.txt",
        mimeType: "text/plain" as const,
        sha256: digest,
      };
    }),
  );
  const replaced = replaceSourceReferences(fixture, replacements);
  const sourceContentHash = await sha256Hex(JSON.stringify(sourceSegments));
  const caseGraph = {
    ...replaced,
    caseId: CASE_ID,
    status: "draft" as const,
    sourceSegments,
    compilerMetadata: {
      ...replaced.compilerMetadata,
      method: "gpt" as const,
      model: CASE_COMPILER_MODEL,
      requestId: REQUEST_ID,
      promptVersion: CASE_COMPILER_PROMPT_VERSION,
      compiledAt: COMPILED_AT,
      sourceContentHash,
      sourceSegmentCount: sourceSegments.length,
    },
  };

  return RegisterCaseDraftRequestSchema.parse({
    ownerId: OWNER_ID,
    uploadId: UPLOAD_ID,
    caseId: CASE_ID,
    storageId: "kg2teststorageidentifier",
    originalName: "packet.txt",
    mimeType: "text/plain",
    sizeBytes: 512,
    contentDigest: CONTENT_DIGEST,
    extractionAdapterId: "plain-text.v1",
    extractionCharacterCount: sourceSegments.reduce((total, segment) => total + segment.excerpt.length, 0),
    injectionFlags: [],
    sourceSegments,
    caseGraph,
    validationReport: {
      schemaVersion: CASE_COMPILER_VALIDATION_SCHEMA_VERSION,
      status: "ready_for_review",
      checks: [{ code: "strict_schema", status: "pass", message: "Strict schema accepted." }],
      issues: [],
      grounding: [],
      uncertainties: caseGraph.compilerMetadata.uncertainties,
      modelReview: null,
    },
    observability: {
      protocolVersion: CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
      model: CASE_COMPILER_MODEL,
      provider: "deterministic-case-compiler",
      promptVersion: CASE_COMPILER_PROMPT_VERSION,
      outputSchemaVersion: CASE_COMPILER_OUTPUT_SCHEMA_VERSION,
      sourceContentHash,
      sourceSegmentCount: sourceSegments.length,
      startedAt: COMPILED_AT,
      completedAt: "2026-07-18T12:00:01.000Z",
      latencyMs: 1_000,
      retryCount: 0,
      acceptedSourceCitationCount: sourceSegments.length,
      estimatedCostUsd: null,
      attempts: [{
        attempt: 1,
        mode: "compile",
        outcome: "accepted",
        requestId: REQUEST_ID,
        responseId: "fake-compiler-response-1",
        latencyMs: 900,
        streamEventCount: 3,
        streamedCharacterCount: 10_000,
        usage: null,
        validationIssueCodes: [],
      }],
    },
  });
}

describe("Convex case service boundary", () => {
  it("accepts only the configured bearer secret without putting it in request data", async () => {
    const accepted = new Request("https://example.test/service/case-upload-url", {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_SECRET}`, "Content-Type": "application/json" },
      body: "{}",
    });
    await expect(authorizeCaseServiceRequest(accepted, SERVICE_SECRET)).resolves.toBeUndefined();

    const rejected = new Request("https://example.test/service/case-upload-url", {
      method: "POST",
      headers: { Authorization: `Bearer ${"x".repeat(48)}` },
    });
    await expect(authorizeCaseServiceRequest(rejected, SERVICE_SECRET)).rejects.toMatchObject({
      code: "CASE_SERVICE_UNAUTHORIZED",
      status: 401,
    });
    await expect(authorizeCaseServiceRequest(rejected, "short")).rejects.toMatchObject({
      code: "CASE_SERVICE_UNAVAILABLE",
      status: 503,
    });
  });

  it("strictly validates the server-derived owner and excludes credentials from draft bodies", async () => {
    const registration = await validRegistration();
    expect(RegisterCaseDraftRequestSchema.parse(registration).ownerId).toBe(OWNER_ID);
    expect(RegisterCaseDraftRequestSchema.safeParse({ ...registration, serviceSecret: SERVICE_SECRET }).success).toBe(false);
    expect(RegisterCaseDraftRequestSchema.safeParse({ ...registration, ownerId: "owner:browser-choice" }).success).toBe(false);
  });

  it("recomputes source IDs, excerpt hashes, and the compiler source hash", async () => {
    const registration = await validRegistration();
    await expect(verifyRegisterCaseDraftIntegrity(registration)).resolves.toEqual(registration);

    const changedSegments = registration.sourceSegments.map((segment, index) =>
      index === 0 ? { ...segment, excerpt: `${segment.excerpt} changed` } : segment,
    );
    await expect(
      verifyRegisterCaseDraftIntegrity({
        ...registration,
        sourceSegments: changedSegments,
        caseGraph: { ...registration.caseGraph, sourceSegments: changedSegments },
      }),
    ).rejects.toMatchObject({ code: "CASE_DRAFT_SOURCE_INVALID", status: 422 });
  });

  it("derives stable owner-bound append-only graph IDs", async () => {
    await expect(deriveDraftGraphId(UPLOAD_ID)).resolves.toBe(await deriveDraftGraphId(UPLOAD_ID));
    const publication = await derivePublishedGraphId(OWNER_ID, UPLOAD_ID);
    expect(publication).not.toBe(
      await derivePublishedGraphId("owner:123e4567-e89b-42d3-a456-426614174099", UPLOAD_ID),
    );
    expect(publication).toMatch(/^graph:published:[a-f0-9]{64}$/u);
  });

  it("separates reviewable content from immutable grounding provenance", () => {
    const draft = createThreeWitnessCaseGraphV1Fixture();
    const editedContent = structuredClone(draft);
    editedContent.facts[0].proposition = "A reviewer corrected the wording without changing its source grounding.";
    expect(caseGraphProvenanceSnapshot(editedContent)).toBe(caseGraphProvenanceSnapshot(draft));

    const tamperedGrounding = structuredClone(draft);
    tamperedGrounding.facts[0].provenance[0].note = "Client-authored replacement provenance.";
    expect(caseGraphProvenanceSnapshot(tamperedGrounding)).not.toBe(caseGraphProvenanceSnapshot(draft));
  });

  it("returns compact no-store JSON and never reflects an unexpected internal error", async () => {
    const response = caseServiceJson({ uploadUrl: "https://example.test/upload" });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe('{"uploadUrl":"https://example.test/upload"}');

    const error = caseServiceErrorResponse(new Error("database details: owner:secret"));
    expect(error.status).toBe(500);
    expect(await error.json()).toEqual({ error: "CASE_SERVICE_INTERNAL_ERROR" });
    expect(caseServiceErrorResponse(new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400)).status).toBe(400);
  });
});
