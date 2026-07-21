import { randomBytes } from "node:crypto";

import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readServerEnv } from "@/lib/env";
import {
  CaseCompilationError,
  CaseCompilerInputSchema,
  OpenAICaseCompilerProvider,
  compileCasePacket,
} from "@/server/case-compiler";
import {
  CASE_OWNER_COOKIE_NAME,
  CaseCompileReplayResponseSchema,
  ConvexCaseServiceError,
  RequestBodyLimitError,
  buildCaseCompilationReviewReport,
  buildCaseCompileReplayResponse,
  caseCompilationClientKey,
  callConvexCaseService,
  deriveCaseCompilationIds,
  isTrustedRequestOrigin,
  parseCaseCompileRequestId,
  readBoundedRequestBody,
  resolveCaseUploadMimeType,
  runCaseCompileWorkflow,
  validateConvexStorageUploadUrl,
  verifyCaseOwnerSession,
  type CaseCompileWorkflowFailureClassification,
  type CaseCompileWorkflowFailureContext,
  type CaseCompileWorkflowFailureResult,
} from "@/server/case-api";
import {
  DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS,
  MAX_CASE_UPLOAD_SIZE_BYTES,
  ingestCaseUpload,
  sha256Hex,
  type SupportedCaseUploadMimeType,
} from "@/server/case-ingestion";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const CLAIM_COORDINATION_TIMEOUT_MS = 10_000;
const CLAIM_ID_PATTERN = /^claim:[a-f0-9]{64}$/u;
const LEASE_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;
const CASE_ID_PATTERN = /^case:[a-f0-9]{48}$/u;
const UPLOAD_ID_PATTERN = /^upload:[a-f0-9]{48}$/u;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/u;

const UploadUrlResponseSchema = z.object({ uploadUrl: z.string().url() }).strict();
const StorageUploadResponseSchema = z.object({ storageId: z.string().trim().min(1).max(240) }).strict();
const DraftRegistrationResponseSchema = z
  .object({
    uploadId: z.string().regex(UPLOAD_ID_PATTERN),
    caseId: z.string().regex(CASE_ID_PATTERN),
    version: z.literal(2),
    status: z.literal("indexed"),
  })
  .strict();
const CaseUploadCleanupResponseSchema = z.object({ deleted: z.boolean() }).strict();

const CaseCompileClaimAcquireResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("acquired"),
      acquisition: z.enum(["new", "idempotent", "takeover", "retry"]),
      claimId: z.string().regex(CLAIM_ID_PATTERN),
      generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      leaseToken: z.string().regex(LEASE_TOKEN_PATTERN),
      leaseExpiresAt: z.number().int().nonnegative(),
      heartbeatIntervalMs: z.literal(15_000),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("busy"),
      claimId: z.string().regex(CLAIM_ID_PATTERN),
      retryAfterSeconds: z.number().int().min(1).max(60),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("completed"),
      claimId: z.string().regex(CLAIM_ID_PATTERN),
      uploadId: z.string().regex(UPLOAD_ID_PATTERN),
      caseId: z.string().regex(CASE_ID_PATTERN),
      generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("terminal_failed"),
      claimId: z.string().regex(CLAIM_ID_PATTERN),
      generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("quota_exceeded"),
      retryAfterSeconds: z.number().int().min(1).max(600),
    })
    .strict(),
]);

const CaseCompileClaimHeartbeatResponseSchema = z
  .object({
    claimId: z.string().regex(CLAIM_ID_PATTERN),
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    leaseExpiresAt: z.number().int().nonnegative(),
    heartbeatIntervalMs: z.literal(15_000),
  })
  .strict();

const CaseCompileClaimReleaseResponseSchema = z
  .object({
    claimId: z.string().regex(CLAIM_ID_PATTERN),
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.enum(["retryable_failed", "terminal_failed"]),
    replayed: z.boolean(),
  })
  .strict();

type PreparedPacket = Readonly<{
  uploadId: string;
  caseId: string;
  originalName: string;
  mimeType: SupportedCaseUploadMimeType;
  bytes: Uint8Array;
  contentDigest: string;
}>;

type CaseCompileClaimAcquireRequest = Readonly<{
  ownerId: string;
  uploadId: string;
  caseId: string;
  contentDigest: string;
  clientKeyHash: string;
  leaseToken: string;
}>;

function jsonError(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function ingestionErrorResponse(error: Error): NextResponse | null {
  if (!error.message.startsWith("UPLOAD_")) return null;
  if (error.message === "UPLOAD_SIZE_EXCEEDED") {
    return jsonError(413, error.message, "The case packet exceeds the 20 MB upload limit.");
  }
  if (
    error.message.includes("MIME") ||
    error.message.includes("EXTENSION") ||
    error.message.includes("SIGNATURE") ||
    error.message.includes("ADAPTER_UNAVAILABLE")
  ) {
    return jsonError(415, error.message, "Use a valid PDF, TXT, Markdown, or JSON case packet.");
  }
  return jsonError(422, error.message, "The case packet could not be safely extracted.");
}

async function storePacket(
  uploadUrl: string,
  bytes: Uint8Array,
  mimeType: string,
  signal: AbortSignal,
): Promise<string> {
  let trustedUploadUrl: string;
  try {
    trustedUploadUrl = validateConvexStorageUploadUrl(uploadUrl);
  } catch (error) {
    throw new ConvexCaseServiceError("CASE_STORAGE_URL_INVALID", 502, { cause: error });
  }
  const response = await fetch(trustedUploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: new Blob([Uint8Array.from(bytes)], { type: mimeType }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) throw new ConvexCaseServiceError("CASE_STORAGE_UPLOAD_FAILED", 503);
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new ConvexCaseServiceError("CASE_STORAGE_RESPONSE_INVALID", 502, { cause: error });
  }
  const parsed = StorageUploadResponseSchema.safeParse(body);
  if (!parsed.success) throw new ConvexCaseServiceError("CASE_STORAGE_RESPONSE_INVALID", 502);
  return parsed.data.storageId;
}

function safeFailureCode(code: string, fallback: string): string {
  return FAILURE_CODE_PATTERN.test(code) ? code : fallback;
}

function classifyWorkflowFailure(
  error: unknown,
  context: CaseCompileWorkflowFailureContext,
): CaseCompileWorkflowFailureClassification {
  if (error instanceof CaseCompilationError) {
    const providerFailed = error.attempts.length > 0 &&
      error.attempts.every((attempt) => attempt.outcome === "provider_failed");
    return providerFailed
      ? {
          code: "CASE_COMPILER_PROVIDER_FAILED",
          category: "unavailable",
          disposition: "retryable_failed",
        }
      : {
          code: "CASE_COMPILATION_REJECTED",
          category: "invalid_input",
          disposition: "terminal_failed",
        };
  }
  if (error instanceof ConvexCaseServiceError) {
    if (error.code === "CASE_COMPILE_CLAIM_REJECTED") {
      return {
        code: error.code,
        category: context.stage === "claim_acquire" ? "invalid_input" : "lease_lost",
        disposition: "retryable_failed",
        registrationOutcome: context.stage === "registration" ? "definite_not_committed" : undefined,
      };
    }
    const deterministicRegistrationRejection =
      context.stage === "registration" &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 401 &&
      error.status !== 403;
    return {
      code: safeFailureCode(error.code, "CASE_SERVICE_UNAVAILABLE"),
      category: deterministicRegistrationRejection ? "invalid_input" : "unavailable",
      disposition: deterministicRegistrationRejection ? "terminal_failed" : "retryable_failed",
      registrationOutcome: context.stage === "registration" && error.status < 500
        ? "definite_not_committed"
        : context.stage === "registration"
          ? "unknown"
          : undefined,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "CASE_BOUNDARY_VALIDATION_FAILED",
      category: "invalid_input",
      disposition: "terminal_failed",
      registrationOutcome: context.stage === "registration" ? "definite_not_committed" : undefined,
    };
  }
  if (error instanceof Error) {
    if (error.message === "CASE_PACKET_COMPILER_LIMIT_EXCEEDED") {
      return {
        code: error.message,
        category: "invalid_input",
        disposition: "terminal_failed",
      };
    }
    if (error.message.startsWith("UPLOAD_")) {
      const unavailable = error.message.includes("ADAPTER_UNAVAILABLE");
      return {
        code: safeFailureCode(error.message, "CASE_INGESTION_FAILED"),
        category: unavailable ? "unavailable" : "invalid_input",
        disposition: unavailable ? "retryable_failed" : "terminal_failed",
      };
    }
    if (error.message.includes("OPENAI_API_KEY")) {
      return {
        code: "OPENAI_NOT_CONFIGURED",
        category: "unavailable",
        disposition: "retryable_failed",
      };
    }
  }
  return {
    code: context.stage === "registration" ? "CASE_REGISTRATION_FAILED" : "CASE_COMPILE_FAILED",
    category: "internal",
    disposition: "retryable_failed",
    registrationOutcome: context.stage === "registration" ? "unknown" : undefined,
  };
}

async function acquireClaimWithRetry(
  body: CaseCompileClaimAcquireRequest,
  signal: AbortSignal,
): Promise<z.infer<typeof CaseCompileClaimAcquireResponseSchema>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callConvexCaseService({
        path: "/service/case-compile-claim/acquire",
        body,
        responseSchema: CaseCompileClaimAcquireResponseSchema,
        timeoutMs: CLAIM_COORDINATION_TIMEOUT_MS,
        signal,
      });
    } catch (error) {
      lastError = error;
      if (
        signal.aborted ||
        !(error instanceof ConvexCaseServiceError) ||
        error.code !== "CASE_SERVICE_UNAVAILABLE" ||
        attempt === 1
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

function workflowFailureResponse(
  failure: CaseCompileWorkflowFailureResult,
): NextResponse {
  const { error } = failure;
  if (error.code.startsWith("UPLOAD_") && error.category === "invalid_input") {
    return ingestionErrorResponse(new Error(error.code)) ??
      jsonError(422, error.code, "The case packet could not be safely extracted.");
  }
  if (error.code === "CASE_PACKET_COMPILER_LIMIT_EXCEEDED") {
    return jsonError(
      422,
      error.code,
      "The extracted packet is too large for one grounded compilation. Split it into a smaller packet and retry.",
    );
  }
  if (error.code === "CASE_COMPILATION_REJECTED") {
    return jsonError(
      422,
      error.code,
      "The packet did not compile into a valid evidence-grounded case. Review the source and try again.",
    );
  }
  if (error.category === "lease_lost") {
    return jsonError(
      409,
      error.code,
      "This compilation lease changed while work was running. Wait a moment and retry.",
      { "Retry-After": "60" },
    );
  }
  if (error.category === "cancelled") {
    return jsonError(408, error.code, "The case compilation request was cancelled.");
  }
  if (error.category === "invalid_input") {
    return jsonError(422, error.code, "The case packet failed strict validation.");
  }
  if (error.category === "unavailable") {
    return jsonError(503, error.code, "The case compiler is temporarily unavailable. Please retry.");
  }
  return jsonError(500, error.code, "The case could not be compiled.");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isTrustedRequestOrigin(request)) {
    return jsonError(403, "ORIGIN_REJECTED", "Cross-origin case uploads are not allowed.");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") {
    return jsonError(415, "UPLOAD_CONTENT_ENCODING_REJECTED", "Compressed request bodies are not accepted.");
  }
  const contentType = request.headers.get("content-type");
  if (contentType === null || !/^multipart\/form-data\s*;/iu.test(contentType)) {
    return jsonError(415, "UPLOAD_MULTIPART_REQUIRED", "Send the case packet as multipart form data.");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_CASE_UPLOAD_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    return jsonError(413, "UPLOAD_SIZE_EXCEEDED", "The case packet exceeds the 20 MB upload limit.");
  }

  let ownerSession;
  try {
    ownerSession = verifyCaseOwnerSession(request.cookies.get(CASE_OWNER_COOKIE_NAME)?.value);
  } catch (error) {
    console.error("case_session_configuration_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(503, "CASE_SESSION_UNAVAILABLE", "A secure case session could not be verified.");
  }
  if (!ownerSession) {
    return jsonError(401, "CASE_OWNER_SESSION_REQUIRED", "Establish a secure case session before compiling a packet.");
  }

  try {
    const multipartBody = await readBoundedRequestBody(
      request,
      MAX_CASE_UPLOAD_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES,
    );
    let form: FormData;
    try {
      form = await new Response(multipartBody, { headers: { "Content-Type": contentType } }).formData();
    } catch {
      return jsonError(400, "UPLOAD_MULTIPART_INVALID", "The multipart case packet request is invalid.");
    }
    const requestId = parseCaseCompileRequestId(form.get("requestId"));
    if (requestId === null) {
      return jsonError(400, "CASE_COMPILE_REQUEST_ID_REQUIRED", "A retry-safe compilation request ID is required.");
    }
    const packet = form.get("packet");
    if (!(packet instanceof File)) {
      return jsonError(400, "UPLOAD_FILE_REQUIRED", "Attach one fictional case packet in the packet field.");
    }
    if (packet.size === 0) return jsonError(400, "UPLOAD_CONTENT_EMPTY", "The case packet is empty.");
    if (packet.size > MAX_CASE_UPLOAD_SIZE_BYTES) {
      return jsonError(413, "UPLOAD_SIZE_EXCEEDED", "The case packet exceeds the 20 MB upload limit.");
    }

    const bytes = new Uint8Array(await packet.arrayBuffer());
    const mimeType = resolveCaseUploadMimeType(packet.name, packet.type, bytes);
    const contentDigest = sha256Hex(bytes);
    const { uploadId, caseId } = deriveCaseCompilationIds(ownerSession.ownerId, requestId, contentDigest);
    const source: PreparedPacket = {
      uploadId,
      caseId,
      originalName: packet.name,
      mimeType,
      bytes,
      contentDigest,
    };
    const leaseToken = randomBytes(32).toString("hex");

    const result = await runCaseCompileWorkflow({
      claimRequest: {
        ownerId: ownerSession.ownerId,
        uploadId,
        caseId,
        contentDigest,
        clientKeyHash: caseCompilationClientKey(request.headers),
        leaseToken,
      },
      source,
      signal: request.signal,
      dependencies: {
        coordinator: {
          lookupCompleted: async (identity, signal) => {
            const replay = await callConvexCaseService({
              path: "/service/case-draft/lookup",
              body: { ownerId: identity.ownerId, uploadId: identity.uploadId },
              responseSchema: CaseCompileReplayResponseSchema,
              signal,
            });
            return replay.found ? replay : null;
          },
          acquire: acquireClaimWithRetry,
          heartbeat: async (fence, signal) => callConvexCaseService({
            path: "/service/case-compile-claim/heartbeat",
            body: fence,
            responseSchema: CaseCompileClaimHeartbeatResponseSchema,
            timeoutMs: CLAIM_COORDINATION_TIMEOUT_MS,
            signal,
          }),
          release: async (release) => {
            const receipt = await callConvexCaseService({
              path: "/service/case-compile-claim/release",
              body: release,
              responseSchema: CaseCompileClaimReleaseResponseSchema,
              timeoutMs: CLAIM_COORDINATION_TIMEOUT_MS,
            });
            if (
              receipt.claimId !== release.claimId ||
              receipt.generation !== release.generation ||
              receipt.status !== release.disposition
            ) {
              throw new ConvexCaseServiceError("CASE_COMPILE_RELEASE_MISMATCH", 502);
            }
            return receipt;
          },
        },
        ingest: async (prepared, signal) => ingestCaseUpload(
          {
            uploadId: prepared.uploadId,
            caseId: prepared.caseId,
            originalName: prepared.originalName,
            mimeType: prepared.mimeType,
            bytes: prepared.bytes,
            expectedContentDigest: prepared.contentDigest,
            signal,
          },
          DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS,
        ),
        compile: async ({ ingestion }, signal) => {
          const compilerInput = CaseCompilerInputSchema.safeParse({
            caseId,
            sourceSegments: ingestion.segments,
          });
          if (!compilerInput.success) throw new Error("CASE_PACKET_COMPILER_LIMIT_EXCEEDED");
          const environment = readServerEnv();
          return compileCasePacket({
            provider: new OpenAICaseCompilerProvider(new OpenAI({ apiKey: environment.OPENAI_API_KEY })),
            input: compilerInput.data,
            signal,
          });
        },
        upload: async ({ source: prepared }, signal) => {
          const { uploadUrl } = await callConvexCaseService({
            path: "/service/case-upload-url",
            body: {},
            responseSchema: UploadUrlResponseSchema,
            signal,
          });
          return storePacket(uploadUrl, prepared.bytes, prepared.mimeType, signal);
        },
        register: async ({ fence, ingestion, compilation, storage }, signal) => {
          const registration = await callConvexCaseService({
            path: "/service/case-draft/register",
            body: {
              ownerId: ownerSession.ownerId,
              uploadId,
              caseId,
              storageId: storage,
              originalName: ingestion.upload.originalName,
              mimeType: ingestion.upload.mimeType,
              sizeBytes: ingestion.upload.sizeBytes,
              contentDigest: ingestion.upload.contentDigest,
              claimId: fence.claimId,
              generation: fence.generation,
              leaseToken: fence.leaseToken,
              extractionAdapterId: ingestion.extractionAdapterId,
              extractionCharacterCount: ingestion.extractionCharacterCount,
              injectionFlags: ingestion.injectionFlags,
              sourceSegments: ingestion.segments,
              caseGraph: compilation.caseGraph,
              validationReport: compilation.validationReport,
              observability: compilation.observability,
            },
            responseSchema: DraftRegistrationResponseSchema,
            timeoutMs: 120_000,
            signal,
          });
          if (registration.uploadId !== uploadId || registration.caseId !== caseId) {
            throw new ConvexCaseServiceError("CASE_DRAFT_RESPONSE_MISMATCH", 502);
          }
          return registration;
        },
        cleanup: async ({ identity, storage }) => {
          const cleanup = await callConvexCaseService({
            path: "/service/case-upload/cleanup",
            body: { ownerId: identity.ownerId, uploadId: identity.uploadId, storageId: storage },
            responseSchema: CaseUploadCleanupResponseSchema,
          });
          console.info("case_storage_cleanup", { deleted: cleanup.deleted });
        },
        classifyFailure: classifyWorkflowFailure,
      },
    });

    switch (result.outcome) {
      case "replayed":
        return NextResponse.json(
          buildCaseCompileReplayResponse(result.replay, { uploadId, caseId }),
          { headers: { "Cache-Control": "no-store", "X-SUITS-Replayed": "true" } },
        );
      case "compiled":
        return NextResponse.json(
          {
            caseGraph: result.compilation.caseGraph,
            report: buildCaseCompilationReviewReport(
              result.compilation,
              result.ingestion.injectionFlags,
            ),
            upload: {
              uploadId: result.registration.uploadId,
              fileName: result.ingestion.upload.originalName,
              mimeType: result.ingestion.upload.mimeType,
              sizeBytes: result.ingestion.upload.sizeBytes,
              sourceSegmentCount: result.ingestion.segments.length,
            },
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      case "busy":
        return jsonError(
          409,
          "CASE_COMPILATION_IN_PROGRESS",
          "This packet is already being compiled. Wait a moment and retry.",
          { "Retry-After": String(result.retryAfterSeconds) },
        );
      case "quota_exceeded":
        return jsonError(
          429,
          "CASE_COMPILATION_RATE_LIMITED",
          "Too many new case compilation attempts. Wait a few minutes and try again.",
          { "Retry-After": String(result.retryAfterSeconds) },
        );
      case "terminal_failed":
        return jsonError(
          422,
          "CASE_COMPILATION_TERMINAL",
          "This retry-safe compilation was rejected. Start a new upload review after correcting the packet.",
        );
      case "failed":
        console.error("case_compile_workflow_failed", {
          code: result.error.code,
          category: result.error.category,
          stage: result.error.stage,
          recovery: result.recovery,
        });
        return workflowFailureResponse(result);
    }
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      return error.code === "REQUEST_BODY_TOO_LARGE"
        ? jsonError(413, "UPLOAD_SIZE_EXCEEDED", "The case packet exceeds the 20 MB upload limit.")
        : jsonError(400, "UPLOAD_CONTENT_EMPTY", "The case packet request is empty.");
    }
    if (error instanceof z.ZodError) {
      return jsonError(422, "CASE_BOUNDARY_VALIDATION_FAILED", "The case packet failed strict validation.");
    }
    if (error instanceof Error) {
      if (error.message === "CASE_COMPILE_REQUEST_ID_INVALID") {
        return jsonError(400, error.message, "The compilation request ID must be a UUIDv4 value.");
      }
      const ingestionResponse = ingestionErrorResponse(error);
      if (ingestionResponse) return ingestionResponse;
      console.error("case_compile_unexpected", { name: error.name });
    }
    return jsonError(500, "CASE_COMPILE_FAILED", "The case could not be compiled.");
  }
}
