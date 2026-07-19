import { NextRequest, NextResponse } from "next/server";

import {
  CASE_OWNER_COOKIE_NAME,
  isTrustedRequestOrigin,
  verifyCaseOwnerSession,
} from "@/server/case-api";
import { EnvironmentCourtroomModelProvider } from "@/server/courtroom-ai";
import {
  CourtroomCommandOrchestrationError,
  orchestratePreparedCourtroomCommand,
} from "@/server/hearing-api/courtroom-command";
import {
  createCourtroomCommandDurableService,
  prepareCourtroomContinuationForOwner,
} from "@/server/hearing-api/durable-service";
import {
  HearingTrialIdSchema,
  hearingJsonError,
  hearingRouteError,
} from "@/server/hearing-api/http";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ trialId: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  if (!isTrustedRequestOrigin(request)) {
    return hearingJsonError(
      403,
      "ORIGIN_REJECTED",
      "Cross-origin hearing continuation recovery is not allowed.",
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
    console.error("hearing_continuation_recovery_session_failed", {
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
    const ownerId = ownerSession.ownerId;
    const trialId = parsedTrialId.data;
    const preparation = await prepareCourtroomContinuationForOwner({
      ownerId,
      trialId,
      signal: request.signal,
    });
    const durableService = createCourtroomCommandDurableService({
      ownerId,
      trialId,
    });
    const view = await orchestratePreparedCourtroomCommand({
      preparation,
      provider: new EnvironmentCourtroomModelProvider(),
      durableService,
      signal: request.signal,
    });
    return NextResponse.json(view, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("hearing_continuation_recovery_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      ...(error instanceof CourtroomCommandOrchestrationError
        ? {
            code: error.code,
            category: error.category,
            task: error.task,
            terminalTracePersistence: error.terminalTracePersistence,
          }
        : {}),
    });
    return hearingRouteError(
      error,
      "The pending courtroom response could not be recovered.",
    );
  }
}
