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
  caseCompileRateLimiter,
  callConvexCaseService,
  deriveCaseCompilationIds,
  isTrustedRequestOrigin,
  parseCaseCompileRequestId,
  readBoundedRequestBody,
  resolveCaseUploadMimeType,
  validateConvexStorageUploadUrl,
  verifyCaseOwnerSession,
} from "@/server/case-api";
import {
  DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS,
  MAX_CASE_UPLOAD_SIZE_BYTES,
  ingestCaseUpload,
  sha256Hex,
} from "@/server/case-ingestion";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const UploadUrlResponseSchema = z
  .object({ uploadUrl: z.string().url() })
  .strict();

const StorageUploadResponseSchema = z
  .object({ storageId: z.string().trim().min(1).max(240) })
  .strict();

const DraftRegistrationResponseSchema = z
  .object({
    uploadId: z.string().regex(/^upload:[a-f0-9]{48}$/u),
    caseId: z.string().regex(/^case:[a-f0-9]{48}$/u),
    version: z.literal(2),
    status: z.literal("indexed"),
  })
  .strict();

const CaseUploadCleanupResponseSchema = z.object({ deleted: z.boolean() }).strict();

const CaseCompilePermitResponseSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(0).max(600),
  })
  .strict();

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
    return jsonError(415, error.message, "Use a valid PDF, DOCX, TXT, Markdown, or JSON case packet.");
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
    return jsonError(
      401,
      "CASE_OWNER_SESSION_REQUIRED",
      "Establish a secure case session before compiling a packet.",
    );
  }
  const clientKeyHash = caseCompilationClientKey(request.headers);
  const rateLimit = caseCompileRateLimiter.check(clientKeyHash);
  if (!rateLimit.allowed) {
    return jsonError(
      429,
      "CASE_COMPILATION_RATE_LIMITED",
      "Too many case compilation attempts. Wait a few minutes and try again.",
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  try {
    const permit = await callConvexCaseService({
      path: "/service/case-compile-permit",
      body: { clientKeyHash },
      responseSchema: CaseCompilePermitResponseSchema,
      signal: request.signal,
    });
    if (!permit.allowed) {
      return jsonError(
        429,
        "CASE_COMPILATION_RATE_LIMITED",
        "Too many case compilation attempts. Wait a few minutes and try again.",
        { "Retry-After": String(permit.retryAfterSeconds) },
      );
    }
    const multipartBody = await readBoundedRequestBody(
      request,
      MAX_CASE_UPLOAD_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES,
    );
    let form: FormData;
    try {
      form = await new Response(multipartBody, {
        headers: { "Content-Type": contentType },
      }).formData();
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
    const { uploadId, caseId } = deriveCaseCompilationIds(
      ownerSession.ownerId,
      requestId,
      contentDigest,
    );
    const replay = await callConvexCaseService({
      path: "/service/case-draft/lookup",
      body: { ownerId: ownerSession.ownerId, uploadId },
      responseSchema: CaseCompileReplayResponseSchema,
      signal: request.signal,
    });
    if (replay.found) {
      return NextResponse.json(
        buildCaseCompileReplayResponse(replay, { uploadId, caseId }),
        { headers: { "Cache-Control": "no-store", "X-SUITS-Replayed": "true" } },
      );
    }
    const ingestion = await ingestCaseUpload(
      {
        uploadId,
        caseId,
        originalName: packet.name,
        mimeType,
        bytes,
        expectedContentDigest: contentDigest,
        signal: request.signal,
      },
      DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS,
    );
    const compilerInput = CaseCompilerInputSchema.safeParse({
      caseId,
      sourceSegments: ingestion.segments,
    });
    if (!compilerInput.success) {
      return jsonError(
        422,
        "CASE_PACKET_COMPILER_LIMIT_EXCEEDED",
        "The extracted packet is too large for one grounded compilation. Split it into a smaller packet and retry.",
      );
    }
    const { uploadUrl } = await callConvexCaseService({
      path: "/service/case-upload-url",
      body: {},
      responseSchema: UploadUrlResponseSchema,
      signal: request.signal,
    });

    const environment = readServerEnv();
    const provider = new OpenAICaseCompilerProvider(new OpenAI({ apiKey: environment.OPENAI_API_KEY }));
    const compilation = await compileCasePacket({
      provider,
      input: compilerInput.data,
      signal: request.signal,
    });
    const storageId = await storePacket(uploadUrl, bytes, mimeType, request.signal);
    let registration: z.infer<typeof DraftRegistrationResponseSchema>;
    try {
      registration = await callConvexCaseService({
        path: "/service/case-draft/register",
        body: {
          ownerId: ownerSession.ownerId,
          uploadId,
          caseId,
          storageId,
          originalName: ingestion.upload.originalName,
          mimeType: ingestion.upload.mimeType,
          sizeBytes: ingestion.upload.sizeBytes,
          contentDigest: ingestion.upload.contentDigest,
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
        signal: request.signal,
      });
    } catch (registrationError) {
      try {
        const cleanup = await callConvexCaseService({
          path: "/service/case-upload/cleanup",
          body: { ownerId: ownerSession.ownerId, uploadId, storageId },
          responseSchema: CaseUploadCleanupResponseSchema,
        });
        console.info("case_storage_cleanup", { deleted: cleanup.deleted });
      } catch (cleanupError) {
        console.error("case_storage_cleanup_failed", {
          name: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
        });
      }
      throw registrationError;
    }
    if (registration.uploadId !== uploadId || registration.caseId !== caseId) {
      throw new ConvexCaseServiceError("CASE_DRAFT_RESPONSE_MISMATCH", 502);
    }

    return NextResponse.json(
      {
        caseGraph: compilation.caseGraph,
        report: buildCaseCompilationReviewReport(compilation, ingestion.injectionFlags),
        upload: {
          uploadId: registration.uploadId,
          fileName: ingestion.upload.originalName,
          mimeType: ingestion.upload.mimeType,
          sizeBytes: ingestion.upload.sizeBytes,
          sourceSegmentCount: ingestion.segments.length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      return error.code === "REQUEST_BODY_TOO_LARGE"
        ? jsonError(413, "UPLOAD_SIZE_EXCEEDED", "The case packet exceeds the 20 MB upload limit.")
        : jsonError(400, "UPLOAD_CONTENT_EMPTY", "The case packet request is empty.");
    }
    if (error instanceof CaseCompilationError) {
      const providerFailed = error.attempts.length > 0 &&
        error.attempts.every((attempt) => attempt.outcome === "provider_failed");
      console.error("case_compile_rejected", {
        attemptCount: error.attempts.length,
        providerFailed,
        validationStatus: error.validationReport?.status ?? null,
      });
      if (providerFailed) {
        return jsonError(
          502,
          "CASE_COMPILER_PROVIDER_FAILED",
          "The case compiler is temporarily unavailable. The packet was not saved; please retry.",
        );
      }
      return jsonError(
        422,
        "CASE_COMPILATION_REJECTED",
        "The packet did not compile into a valid evidence-grounded case. Review the source and try again.",
      );
    }
    if (error instanceof ConvexCaseServiceError) {
      console.error("case_persistence_failed", { code: error.code, status: error.status });
      return jsonError(
        error.status >= 400 && error.status < 500 ? error.status : 503,
        error.code,
        "The compiled case could not be saved. Please retry without closing this page.",
      );
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
      if (error.message.includes("OPENAI_API_KEY")) {
        return jsonError(503, "OPENAI_NOT_CONFIGURED", "The case compiler is not configured on this server.");
      }
      console.error("case_compile_unexpected", { name: error.name });
    }
    return jsonError(500, "CASE_COMPILE_FAILED", "The case could not be compiled.");
  }
}
