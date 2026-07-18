import { NextRequest, NextResponse } from "next/server";

import { HearingRuntimeViewV1Schema } from "@/domain/hearing-runtime";
import {
  CASE_OWNER_COOKIE_NAME,
  callConvexCaseService,
  isTrustedRequestOrigin,
  verifyCaseOwnerSession,
} from "@/server/case-api";
import {
  HearingTrialIdSchema,
  hearingJsonError,
  hearingRouteError,
} from "@/server/hearing-api/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ trialId: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  if (!isTrustedRequestOrigin(request)) {
    return hearingJsonError(
      403,
      "ORIGIN_REJECTED",
      "Cross-origin hearing reads are not allowed.",
    );
  }
  const parsedTrialId = HearingTrialIdSchema.safeParse(
    (await context.params).trialId,
  );
  if (!parsedTrialId.success) {
    return hearingJsonError(
      400,
      "HEARING_TRIAL_ID_INVALID",
      "The hearing link is invalid.",
    );
  }

  let ownerSession;
  try {
    ownerSession = verifyCaseOwnerSession(
      request.cookies.get(CASE_OWNER_COOKIE_NAME)?.value,
    );
  } catch (error) {
    console.error("hearing_session_verification_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return hearingJsonError(
      503,
      "HEARING_SESSION_UNAVAILABLE",
      "The secure hearing session could not be verified.",
    );
  }
  if (!ownerSession) {
    return hearingJsonError(
      401,
      "HEARING_SESSION_REQUIRED",
      "This hearing belongs to a different or expired session.",
    );
  }

  try {
    const view = await callConvexCaseService({
      path: "/service/hearings/read",
      body: { ownerId: ownerSession.ownerId, trialId: parsedTrialId.data },
      responseSchema: HearingRuntimeViewV1Schema,
      signal: request.signal,
    });
    return NextResponse.json(view, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("hearing_read_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return hearingRouteError(error, "The hearing could not be reopened.");
  }
}
