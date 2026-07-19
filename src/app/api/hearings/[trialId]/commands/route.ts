import { NextRequest, NextResponse } from "next/server";

import { HearingPlayerCommandSchema } from "@/domain/hearing-runtime";
import {
  CASE_OWNER_COOKIE_NAME,
  isTrustedRequestOrigin,
  verifyCaseOwnerSession,
} from "@/server/case-api";
import { EnvironmentCourtroomModelProvider } from "@/server/courtroom-ai";
import {
  HearingTrialIdSchema,
  hearingJsonError,
  hearingRouteError,
  parseHearingJson,
} from "@/server/hearing-api/http";
import {
  CourtroomCommandOrchestrationError,
  orchestrateCourtroomCommand,
} from "@/server/hearing-api/courtroom-command";
import { createCourtroomCommandDurableService } from "@/server/hearing-api/durable-service";

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
      "Cross-origin hearing commands are not allowed.",
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

  let body;
  try {
    body = await parseHearingJson(request, HearingPlayerCommandSchema);
  } catch (error) {
    return hearingRouteError(error, "The courtroom action could not be committed.");
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
    const ownerId = ownerSession.ownerId;
    const trialId = parsedTrialId.data;
    const durableService = createCourtroomCommandDurableService({
      ownerId,
      trialId,
    });
    const view = await orchestrateCourtroomCommand({
      command: body,
      provider: new EnvironmentCourtroomModelProvider(),
      durableService,
      signal: request.signal,
    });
    return NextResponse.json(view, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("hearing_command_failed", {
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
    return hearingRouteError(error, "The courtroom action could not be committed.");
  }
}
