import { NextRequest, NextResponse } from "next/server";

import {
  CASE_OWNER_COOKIE_MAX_AGE_SECONDS,
  CASE_OWNER_COOKIE_NAME,
  resolveCaseOwnerSession,
} from "../../../../server/case-api";

export const runtime = "nodejs";

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== request.nextUrl.origin) {
    return jsonError(403, "ORIGIN_REJECTED", "Cross-origin session requests are not allowed.");
  }

  try {
    const session = resolveCaseOwnerSession(request.cookies.get(CASE_OWNER_COOKIE_NAME)?.value);
    const response = NextResponse.json(
      { ready: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(CASE_OWNER_COOKIE_NAME, session.cookieValue, {
      httpOnly: true,
      maxAge: CASE_OWNER_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    console.error("case_session_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(503, "CASE_SESSION_UNAVAILABLE", "A secure case session could not be established.");
  }
}
