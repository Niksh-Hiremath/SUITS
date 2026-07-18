import { NextRequest, NextResponse } from "next/server";

import { OwnedCaseListResponseSchema } from "@/domain/case-api";
import {
  CASE_OWNER_COOKIE_NAME,
  ConvexCaseServiceError,
  callConvexCaseService,
  isTrustedRequestOrigin,
  verifyCaseOwnerSession,
} from "@/server/case-api";

export const runtime = "nodejs";

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
    return jsonError(401, "CASE_OWNER_SESSION_REQUIRED", "No private case workspace exists for this session.");
  }

  try {
    const result = await callConvexCaseService({
      path: "/service/cases/owned/list",
      body: { ownerId: ownerSession.ownerId },
      responseSchema: OwnedCaseListResponseSchema,
      signal: request.signal,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConvexCaseServiceError) {
      console.error("owned_case_list_failed", { code: error.code, status: error.status });
      return jsonError(
        error.status >= 400 && error.status < 500 ? error.status : 503,
        error.code,
        "The private case workspace could not be loaded.",
      );
    }
    console.error("owned_case_list_unexpected", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(500, "OWNED_CASE_LIST_FAILED", "The private case workspace could not be loaded.");
  }
}
