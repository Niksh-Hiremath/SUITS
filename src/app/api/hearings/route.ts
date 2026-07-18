import { NextRequest, NextResponse } from "next/server";

import {
  HearingRuntimeViewV1Schema,
  StartHearingRequestSchema,
} from "@/domain/hearing-runtime";
import {
  CASE_OWNER_COOKIE_MAX_AGE_SECONDS,
  CASE_OWNER_COOKIE_NAME,
  callConvexCaseService,
  isTrustedRequestOrigin,
  resolveCaseOwnerSession,
} from "@/server/case-api";
import {
  hearingJsonError,
  hearingRouteError,
  parseHearingJson,
} from "@/server/hearing-api/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isTrustedRequestOrigin(request)) {
    return hearingJsonError(
      403,
      "ORIGIN_REJECTED",
      "Cross-origin hearing requests are not allowed.",
    );
  }

  let body;
  try {
    body = await parseHearingJson(request, StartHearingRequestSchema);
  } catch (error) {
    return hearingRouteError(error, "The hearing could not be started.");
  }

  let ownerSession;
  try {
    ownerSession = resolveCaseOwnerSession(
      request.cookies.get(CASE_OWNER_COOKIE_NAME)?.value,
    );
  } catch (error) {
    console.error("hearing_session_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return hearingJsonError(
      503,
      "HEARING_SESSION_UNAVAILABLE",
      "A secure hearing session could not be established.",
    );
  }

  try {
    const view = await callConvexCaseService({
      path: "/service/hearings/start",
      body: { ownerId: ownerSession.ownerId, request: body },
      responseSchema: HearingRuntimeViewV1Schema,
      signal: request.signal,
    });
    const response = NextResponse.json(view, {
      headers: { "Cache-Control": "no-store" },
    });
    response.cookies.set(CASE_OWNER_COOKIE_NAME, ownerSession.cookieValue, {
      httpOnly: true,
      maxAge: CASE_OWNER_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    console.error("hearing_start_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return hearingRouteError(error, "The hearing could not be started.");
  }
}
