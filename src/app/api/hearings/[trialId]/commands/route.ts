import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  HearingCommandPreparationSchema,
  HearingPlayerCommandSchema,
} from "@/domain/hearing-runtime";
import {
  CASE_OWNER_COOKIE_NAME,
  callConvexCaseService,
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
  type CourtroomCommandDurableService,
} from "@/server/hearing-api/courtroom-command";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ trialId: string }> };

const TerminalModelCallResponseSchema = z
  .object({
    callId: z.string().trim().min(1).max(240),
    attemptCount: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();

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
    const durableService: CourtroomCommandDurableService = {
      prepare: async (command, signal) =>
        await callConvexCaseService({
          path: "/service/hearings/command/prepare",
          body: { ownerId, trialId, command },
          responseSchema: HearingCommandPreparationSchema,
          signal,
        }),
      commitWitness: async (generation, signal) =>
        await callConvexCaseService({
          path: "/service/hearings/command/commit",
          body: { ownerId, trialId, generation },
          responseSchema: HearingCommandPreparationSchema,
          signal,
        }),
      commitOpponentPlan: async (generation, signal) =>
        await callConvexCaseService({
          path: "/service/hearings/opponent-plan/commit",
          body: { ownerId, trialId, generation },
          responseSchema: HearingCommandPreparationSchema,
          signal,
        }),
      commitCounselResponse: async (generation, signal) =>
        await callConvexCaseService({
          path: "/service/hearings/counsel-response/commit",
          body: { ownerId, trialId, generation },
          responseSchema: HearingCommandPreparationSchema,
          signal,
        }),
      commitJuryResponse: async (generation, signal) =>
        await callConvexCaseService({
          path: "/service/hearings/jury-response/commit",
          body: { ownerId, trialId, generation },
          responseSchema: HearingCommandPreparationSchema,
          signal,
        }),
      commitDebrief: async (generation, signal) =>
        await callConvexCaseService({
          path: "/service/hearings/debrief/commit",
          body: { ownerId, trialId, generation },
          responseSchema: HearingCommandPreparationSchema,
          signal,
        }),
      recordTerminalTrace: async (trace, signal) => {
        await callConvexCaseService({
          path: "/service/hearings/model-call/terminal",
          body: { ownerId, trialId, trace },
          responseSchema: TerminalModelCallResponseSchema,
          signal,
        });
      },
    };
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
