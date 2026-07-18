import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CASE_OWNER_COOKIE_NAME,
  CaseCompileReplayResponseSchema,
  ConvexCaseServiceError,
  buildCaseCompileReplayResponse,
  callConvexCaseService,
  isTrustedRequestOrigin,
  verifyCaseOwnerSession,
} from "@/server/case-api";

export const runtime = "nodejs";

const DraftQuerySchema = z
  .object({ uploadId: z.string().regex(/^upload:[a-f0-9]{48}$/u) })
  .strict();

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isTrustedRequestOrigin(request)) {
    return jsonError(403, "ORIGIN_REJECTED", "Cross-origin case reads are not allowed.");
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
    return jsonError(401, "CASE_OWNER_SESSION_REQUIRED", "This draft belongs to another secure session.");
  }

  const query = DraftQuerySchema.safeParse({ uploadId: request.nextUrl.searchParams.get("uploadId") });
  if (!query.success) return jsonError(400, "CASE_DRAFT_QUERY_INVALID", "A valid draft upload ID is required.");

  try {
    const replay = await callConvexCaseService({
      path: "/service/case-draft/lookup",
      body: { ownerId: ownerSession.ownerId, uploadId: query.data.uploadId },
      responseSchema: CaseCompileReplayResponseSchema,
      signal: request.signal,
    });
    if (!replay.found) {
      return jsonError(404, "CASE_DRAFT_NOT_FOUND", "The draft was not found for this secure session.");
    }
    return NextResponse.json(
      buildCaseCompileReplayResponse(replay, { uploadId: query.data.uploadId }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ConvexCaseServiceError) {
      console.error("case_draft_read_failed", { code: error.code, status: error.status });
      return jsonError(
        error.status >= 400 && error.status < 500 ? error.status : 503,
        error.code,
        "The draft could not be restored.",
      );
    }
    console.error("case_draft_read_unexpected", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(500, "CASE_DRAFT_READ_FAILED", "The draft could not be restored.");
  }
}
