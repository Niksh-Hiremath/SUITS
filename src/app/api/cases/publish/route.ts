import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { CasePublishResponseSchema } from "@/domain/case-api";
import { CaseGraphV1Schema } from "@/domain/case-graph";
import {
  CASE_OWNER_COOKIE_NAME,
  ConvexCaseServiceError,
  RequestBodyLimitError,
  callConvexCaseService,
  isTrustedRequestOrigin,
  readBoundedRequestBody,
  verifyCaseOwnerSession,
} from "@/server/case-api";

export const runtime = "nodejs";

const MAX_PUBLISH_BODY_BYTES = 4 * 1024 * 1024;
const COMPILED_CASE_ID_PATTERN = /^case:[a-f0-9]{48}$/u;

const PublishRequestSchema = z
  .object({
    uploadId: z.string().regex(/^upload:[a-f0-9]{48}$/u),
    caseGraph: CaseGraphV1Schema,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (!COMPILED_CASE_ID_PATTERN.test(request.caseGraph.caseId)) {
      ctx.addIssue({
        code: "custom",
        path: ["caseGraph", "caseId"],
        message: "Published uploads require a server-derived case ID",
      });
    }
  });

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isTrustedRequestOrigin(request)) {
    return jsonError(403, "ORIGIN_REJECTED", "Cross-origin publication is not allowed.");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") {
    return jsonError(415, "PUBLISH_CONTENT_ENCODING_REJECTED", "Compressed request bodies are not accepted.");
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonError(415, "PUBLISH_JSON_REQUIRED", "Send the reviewed case as application/json.");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PUBLISH_BODY_BYTES) {
    return jsonError(413, "PUBLISH_BODY_TOO_LARGE", "The reviewed case exceeds the publication limit.");
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
    return jsonError(401, "CASE_OWNER_SESSION_REQUIRED", "Recompile the packet to restore its secure owner session.");
  }

  try {
    const body = await readBoundedRequestBody(request, MAX_PUBLISH_BODY_BYTES);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
    } catch {
      return jsonError(400, "PUBLISH_REQUEST_INVALID", "The reviewed case payload is invalid.");
    }
    const parsed = PublishRequestSchema.parse(payload);
    if (parsed.caseGraph.status !== "published") {
      return jsonError(422, "CASE_STATUS_INVALID", "A reviewed case must be marked published.");
    }
    const result = await callConvexCaseService({
      path: "/service/case-draft/publish",
      body: {
        ownerId: ownerSession.ownerId,
        uploadId: parsed.uploadId,
        caseGraph: parsed.caseGraph,
      },
      responseSchema: CasePublishResponseSchema,
      timeoutMs: 120_000,
      signal: request.signal,
    });
    if (result.caseId !== parsed.caseGraph.caseId || result.caseGraph.caseId !== parsed.caseGraph.caseId) {
      throw new ConvexCaseServiceError("CASE_PUBLISH_RESPONSE_MISMATCH", 502);
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      return error.code === "REQUEST_BODY_TOO_LARGE"
        ? jsonError(413, "PUBLISH_BODY_TOO_LARGE", "The reviewed case exceeds the publication limit.")
        : jsonError(400, "PUBLISH_REQUEST_INVALID", "The reviewed case payload is empty.");
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return jsonError(400, "PUBLISH_REQUEST_INVALID", "The reviewed case payload is invalid.");
    }
    if (error instanceof ConvexCaseServiceError) {
      console.error("case_publish_persistence_failed", { code: error.code, status: error.status });
      const status = error.status === 403 || error.status === 404 || error.status === 409
        ? error.status
        : 503;
      return jsonError(status, error.code, "The reviewed case could not be published.");
    }
    console.error("case_publish_unexpected", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(500, "CASE_PUBLISH_FAILED", "The reviewed case could not be published.");
  }
}
