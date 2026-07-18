import { z } from "zod";

import {
  CaseGraphEntityIdSchema,
  CaseGraphV1Schema,
  SourceSegmentSchema,
  type CaseGraphV1,
  type SourceSegment,
} from "../src/domain/case-graph";
import {
  CaseCompilerObservabilitySchema,
  CaseCompilerValidationReportSchema,
} from "../src/server/case-compiler/schemas";
import {
  CaseIngestionEntityIdSchema,
  CaseUploadMimeTypeSchema,
  MAX_EXTRACTED_CHARACTERS,
  MAX_PROMPT_INJECTION_FLAGS,
  OriginalFileNameSchema,
  PromptInjectionFlagSchema,
  Sha256DigestSchema,
} from "../src/server/case-ingestion/schema";
import {
  MAX_CASE_COMPILER_SOURCE_CHARACTERS,
  MAX_CASE_COMPILER_SOURCE_SEGMENTS,
} from "../src/server/case-compiler/constants";

const MAX_SERVICE_SECRET_CHARACTERS = 512;
const MAX_SERVICE_REQUEST_BYTES = 8 * 1024 * 1024;
const OWNER_ID_PATTERN = /^owner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const CaseServiceOwnerIdSchema = z
  .string()
  .regex(OWNER_ID_PATTERN, "Expected a server-verified owner session ID");

export const CaseServiceUploadUrlRequestSchema = z.object({}).strict();

export const RegisterCaseDraftRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    caseId: CaseGraphEntityIdSchema,
    storageId: z.string().trim().min(1).max(256),
    originalName: OriginalFileNameSchema,
    mimeType: CaseUploadMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
    contentDigest: Sha256DigestSchema,
    extractionAdapterId: CaseIngestionEntityIdSchema,
    extractionCharacterCount: z.number().int().positive().max(MAX_EXTRACTED_CHARACTERS),
    injectionFlags: z.array(PromptInjectionFlagSchema).max(MAX_PROMPT_INJECTION_FLAGS),
    sourceSegments: z.array(SourceSegmentSchema).min(1).max(MAX_CASE_COMPILER_SOURCE_SEGMENTS),
    caseGraph: CaseGraphV1Schema,
    validationReport: CaseCompilerValidationReportSchema,
    observability: CaseCompilerObservabilitySchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    const addIssue = (path: Array<string | number>, message: string) => {
      ctx.addIssue({ code: "custom", path, message });
    };

    if (request.caseGraph.caseId !== request.caseId) {
      addIssue(["caseGraph", "caseId"], "The CaseGraph case ID must match the trusted request case ID");
    }
    if (request.caseGraph.status !== "draft") {
      addIssue(["caseGraph", "status"], "Only a draft CaseGraph may be registered");
    }
    if (JSON.stringify(request.caseGraph.sourceSegments) !== JSON.stringify(request.sourceSegments)) {
      addIssue(["caseGraph", "sourceSegments"], "The CaseGraph must preserve source segments exactly and in order");
    }

    let sourceCharacters = 0;
    request.sourceSegments.forEach((segment, index) => {
      sourceCharacters += segment.excerpt.length;
      if (segment.documentName !== request.originalName) {
        addIssue(["sourceSegments", index, "documentName"], "Source document name does not match the stored upload");
      }
      if (segment.mimeType !== request.mimeType) {
        addIssue(["sourceSegments", index, "mimeType"], "Source MIME type does not match the stored upload");
      }
    });
    if (sourceCharacters > MAX_CASE_COMPILER_SOURCE_CHARACTERS) {
      addIssue(["sourceSegments"], `Source packet exceeds ${MAX_CASE_COMPILER_SOURCE_CHARACTERS} characters`);
    }
    request.injectionFlags.forEach((flag, index) => {
      if (flag.endOffset > request.extractionCharacterCount) {
        addIssue(
          ["injectionFlags", index, "endOffset"],
          "Prompt-injection flag extends beyond the extracted document",
        );
      }
    });

    const metadata = request.caseGraph.compilerMetadata;
    if (metadata.method !== "gpt" || metadata.model !== "gpt-5.6-terra") {
      addIssue(["caseGraph", "compilerMetadata", "model"], "Uploaded cases must be compiled by gpt-5.6-terra");
    }
    if (metadata.sourceContentHash !== request.observability.sourceContentHash) {
      addIssue(["observability", "sourceContentHash"], "Compiler observability source hash does not match the CaseGraph");
    }
    if (metadata.sourceSegmentCount !== request.observability.sourceSegmentCount) {
      addIssue(["observability", "sourceSegmentCount"], "Compiler observability source count does not match the CaseGraph");
    }
    if (metadata.promptVersion !== request.observability.promptVersion) {
      addIssue(["observability", "promptVersion"], "Compiler observability prompt version does not match the CaseGraph");
    }
    if (request.validationReport.status === "rejected" || request.validationReport.issues.length > 0) {
      addIssue(["validationReport", "status"], "A rejected or invalid compiler result cannot be registered");
    }
    if (request.validationReport.checks.some((check) => check.status === "fail")) {
      addIssue(["validationReport", "checks"], "A failing deterministic compiler check cannot be registered");
    }

    const attempts = request.observability.attempts;
    const acceptedAttempts = attempts.filter((attempt) => attempt.outcome === "accepted");
    const acceptedAttempt = acceptedAttempts[0];
    if (acceptedAttempts.length !== 1 || attempts.at(-1)?.outcome !== "accepted") {
      addIssue(["observability", "attempts"], "Compiler observability must end with exactly one accepted attempt");
    }
    if (request.observability.retryCount !== attempts.length - 1) {
      addIssue(["observability", "retryCount"], "Compiler retry count does not match the attempt trace");
    }
    if (acceptedAttempt && metadata.requestId !== acceptedAttempt.requestId) {
      addIssue(["caseGraph", "compilerMetadata", "requestId"], "CaseGraph request ID does not match the accepted compiler attempt");
    }
  });

export const PublishCaseDraftRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    caseGraph: CaseGraphV1Schema,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.caseGraph.status !== "published") {
      ctx.addIssue({
        code: "custom",
        path: ["caseGraph", "status"],
        message: "Only a reviewed, published CaseGraph may be published",
      });
    }
  });

export type RegisterCaseDraftRequest = z.infer<typeof RegisterCaseDraftRequestSchema>;
export type PublishCaseDraftRequest = z.infer<typeof PublishCaseDraftRequestSchema>;

export class CaseServiceBoundaryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "CaseServiceBoundaryError";
    this.code = code;
    this.status = status;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function canonicalizeSourceSegments(sourceSegments: readonly SourceSegment[]): string {
  return JSON.stringify(
    sourceSegments.map((segment) => ({
      sourceSegmentId: segment.sourceSegmentId,
      sourceId: segment.sourceId,
      documentName: segment.documentName,
      mimeType: segment.mimeType,
      locator: segment.locator,
      excerpt: segment.excerpt,
      sha256: segment.sha256,
    })),
  );
}

export async function verifyRegisterCaseDraftIntegrity(
  input: RegisterCaseDraftRequest,
): Promise<RegisterCaseDraftRequest> {
  const request = RegisterCaseDraftRequestSchema.parse(input);
  const sourceFingerprint = await sha256Hex(`${request.uploadId}:${request.contentDigest}`);
  const expectedSourceId = `source:${sourceFingerprint.slice(0, 32)}`;

  for (let index = 0; index < request.sourceSegments.length; index += 1) {
    const segment = request.sourceSegments[index];
    if (!segment) throw new CaseServiceBoundaryError("CASE_DRAFT_SOURCE_INVALID", 422);
    const excerptDigest = await sha256Hex(segment.excerpt);
    const expectedSegmentId = `segment:${sourceFingerprint.slice(0, 20)}:${String(index + 1).padStart(4, "0")}:${excerptDigest.slice(0, 12)}`;
    if (
      segment.sha256 !== excerptDigest ||
      segment.sourceId !== expectedSourceId ||
      segment.sourceSegmentId !== expectedSegmentId
    ) {
      throw new CaseServiceBoundaryError("CASE_DRAFT_SOURCE_INVALID", 422);
    }
  }

  const sourceContentHash = await sha256Hex(canonicalizeSourceSegments(request.sourceSegments));
  if (
    request.caseGraph.compilerMetadata.sourceContentHash !== sourceContentHash ||
    request.observability.sourceContentHash !== sourceContentHash
  ) {
    throw new CaseServiceBoundaryError("CASE_DRAFT_SOURCE_HASH_MISMATCH", 422);
  }
  return request;
}

export async function deriveDraftGraphId(uploadId: string): Promise<string> {
  const uploadHash = await sha256Hex(`suits-draft:${uploadId}`);
  return CaseGraphEntityIdSchema.parse(`graph:draft:${uploadHash}`);
}

export async function derivePublishedGraphId(ownerId: string, uploadId: string): Promise<string> {
  const publicationHash = await sha256Hex(`suits-published:${ownerId}:${uploadId}`);
  return CaseGraphEntityIdSchema.parse(`graph:published:${publicationHash}`);
}

/**
 * Human review may correct the compiled entity content, but it must not rewrite
 * the model's source/authoring/inference grounding. IDs are retained in this
 * snapshot so reordering or moving provenance between entities is also caught.
 */
export function caseGraphProvenanceSnapshot(graph: CaseGraphV1): string {
  return JSON.stringify({
    jurisdictionProfile: {
      profileId: graph.jurisdictionProfile.profileId,
      provenance: graph.jurisdictionProfile.provenance,
    },
    parties: graph.parties.map((item) => ({ id: item.partyId, provenance: item.provenance })),
    issues: graph.issues.map((item) => ({ id: item.issueId, provenance: item.provenance })),
    timeline: graph.timeline.map((item) => ({ id: item.timelineEventId, provenance: item.provenance })),
    facts: graph.facts.map((item) => ({ id: item.factId, provenance: item.provenance })),
    evidence: graph.evidence.map((item) => ({ id: item.evidenceId, provenance: item.provenance })),
    witnesses: graph.witnesses.map((item) => ({
      id: item.witnessId,
      provenance: item.provenance,
      priorStatements: item.priorStatements.map((statement) => ({
        id: statement.priorStatementId,
        provenance: statement.provenance,
      })),
    })),
    contradictions: graph.contradictions.map((item) => ({
      id: item.contradictionId,
      provenance: item.provenance,
    })),
    settlement: graph.settlement.provenance,
    juryInstructions: graph.juryInstructions.map((item) => ({
      id: item.instructionId,
      provenance: item.provenance,
    })),
  });
}

async function secretsMatch(received: string, expected: string): Promise<boolean> {
  const [receivedHash, expectedHash] = await Promise.all([
    sha256Hex(`suits-service-secret:${received}`),
    sha256Hex(`suits-service-secret:${expected}`),
  ]);
  let difference = receivedHash.length ^ expectedHash.length;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash.charCodeAt(index) ^ (receivedHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function authorizeCaseServiceRequest(
  request: Request,
  configuredSecret: string | undefined,
): Promise<void> {
  const expected = configuredSecret?.trim() ?? "";
  if (expected.length < 32 || expected.length > MAX_SERVICE_SECRET_CHARACTERS) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_UNAVAILABLE", 503);
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_UNAUTHORIZED", 401);
  }
  const received = authorization.slice("Bearer ".length);
  if (
    received.length < 32 ||
    received.length > MAX_SERVICE_SECRET_CHARACTERS ||
    !(await secretsMatch(received, expected))
  ) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_UNAUTHORIZED", 401);
  }
}

export async function parseCaseServiceJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new CaseServiceBoundaryError("CASE_SERVICE_CONTENT_TYPE_INVALID", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SERVICE_REQUEST_BYTES) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_TOO_LARGE", 413);
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_SERVICE_REQUEST_BYTES) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_TOO_LARGE", 413);
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  return parsed.data;
}

export function caseServiceJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const INTERNAL_ERROR_STATUS = new Map<string, number>([
  ["CASE_DRAFT_ALREADY_EXISTS", 409],
  ["CASE_DRAFT_CONFLICT", 409],
  ["CASE_DRAFT_NOT_FOUND", 404],
  ["CASE_DRAFT_SOURCE_COLLISION", 409],
  ["CASE_DRAFT_TOO_LARGE", 413],
  ["CASE_PUBLISH_CONFLICT", 409],
  ["CASE_UPLOAD_CONFLICT", 409],
  ["CASE_UPLOAD_DIGEST_MISMATCH", 422],
  ["CASE_UPLOAD_MIME_TYPE_MISMATCH", 422],
  ["CASE_UPLOAD_SIZE_MISMATCH", 422],
  ["CASE_UPLOAD_STORAGE_OBJECT_NOT_FOUND", 404],
]);

export function caseServiceErrorResponse(error: unknown): Response {
  if (error instanceof CaseServiceBoundaryError) {
    return caseServiceJson({ error: error.code }, error.status);
  }
  const message = error instanceof Error ? error.message : "";
  for (const [code, status] of INTERNAL_ERROR_STATUS) {
    if (message.includes(code)) return caseServiceJson({ error: code }, status);
  }
  return caseServiceJson({ error: "CASE_SERVICE_INTERNAL_ERROR" }, 500);
}
