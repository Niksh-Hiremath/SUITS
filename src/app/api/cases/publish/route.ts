import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { CaseGraphV1Schema } from "@/domain/case-graph";
import {
  CASE_OWNER_COOKIE_NAME,
  ConvexCaseServiceError,
  callConvexCaseService,
  verifyCaseOwnerSession,
} from "@/server/case-api";

export const runtime = "nodejs";

const MAX_PUBLISH_BODY_BYTES = 4 * 1024 * 1024;

const PublishRequestSchema = z
  .object({
    uploadId: z.string().trim().min(3).max(128),
    caseGraph: CaseGraphV1Schema,
  })
  .strict();

const PublishResponseSchema = z
  .object({
    caseId: z.string().trim().min(1).max(128),
    version: z.number().int().positive(),
    published: z.literal(true),
    replayed: z.boolean(),
  })
  .strict();

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== request.nextUrl.origin) {
    return jsonError(403, "ORIGIN_REJECTED", "Cross-origin publication is not allowed.");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PUBLISH_BODY_BYTES) {
    return jsonError(413, "PUBLISH_BODY_TOO_LARGE", "The reviewed case exceeds the publication limit.");
  }

  const ownerSession = verifyCaseOwnerSession(request.cookies.get(CASE_OWNER_COOKIE_NAME)?.value);
  if (!ownerSession) {
    return jsonError(401, "CASE_OWNER_SESSION_REQUIRED", "Recompile the packet to restore its secure owner session.");
  }

  try {
    const parsed = PublishRequestSchema.parse(await request.json());
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
      responseSchema: PublishResponseSchema,
      timeoutMs: 120_000,
      signal: request.signal,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
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
