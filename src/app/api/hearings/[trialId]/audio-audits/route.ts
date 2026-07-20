import { NextRequest, NextResponse } from "next/server";

import { HearingTrialIdSchema } from "@/domain/hearing-runtime";
import {
  HearingAudioAuditIngestRequestSchema,
  HearingAudioAuditPersistResultSchema,
} from "@/lib/speech/hearing-audio-audit";
import {
  CASE_OWNER_COOKIE_NAME,
  ConvexCaseServiceError,
  callConvexCaseService,
  isTrustedRequestOrigin,
  verifyCaseOwnerSession,
} from "@/server/case-api";
import {
  HearingHttpError,
  parseHearingJson,
} from "@/server/hearing-api/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ trialId: string }> };

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

function json(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: PRIVATE_HEADERS });
}

function jsonError(status: number, code: string, message: string): NextResponse {
  return json({ error: { code, message } }, status);
}

function requestError(error: HearingHttpError): NextResponse {
  return jsonError(
    error.status,
    error.code,
    error.status === 413
      ? "The audio audit record is too large."
      : error.status === 415
        ? "Send an uncompressed JSON audio audit record."
        : "The audio audit record is invalid.",
  );
}

function serviceError(error: unknown): NextResponse {
  console.error("hearing_audio_audit_ingest_failed", {
    name: error instanceof Error ? error.name : "UnknownError",
    ...(error instanceof ConvexCaseServiceError
      ? { code: error.code, status: error.status }
      : {}),
  });
  if (error instanceof ConvexCaseServiceError) {
    if (error.code === "TRIAL_NOT_FOUND") {
      return jsonError(
        404,
        "HEARING_AUDIO_AUDIT_TRIAL_NOT_FOUND",
        "The hearing could not be found.",
      );
    }
    if (error.code === "TRIAL_MIGRATION_REQUIRED") {
      return jsonError(
        409,
        "HEARING_AUDIO_AUDIT_MIGRATION_REQUIRED",
        "The hearing must be migrated before audio timing can be recorded.",
      );
    }
    if (
      error.code === "HEARING_AUDIO_AUDIT_CONFLICT" ||
      error.code === "HEARING_AUDIO_AUDIT_LIMIT_EXCEEDED"
    ) {
      return jsonError(
        409,
        "HEARING_AUDIO_AUDIT_REJECTED",
        "The audio timing record could not be appended.",
      );
    }
    if (
      error.code === "HEARING_AUDIO_AUDIT_RECORD_INVALID" ||
      error.code === "HEARING_AUDIO_AUDIT_SEMANTICS_INVALID"
    ) {
      return jsonError(
        422,
        "HEARING_AUDIO_AUDIT_REJECTED",
        "The audio timing record could not be validated.",
      );
    }
  }
  return jsonError(
    503,
    "HEARING_AUDIO_AUDIT_UNAVAILABLE",
    "Audio timing could not be recorded right now.",
  );
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  if (!isTrustedRequestOrigin(request)) {
    return jsonError(
      403,
      "ORIGIN_REJECTED",
      "Cross-origin audio audit requests are not allowed.",
    );
  }
  const trialId = HearingTrialIdSchema.safeParse((await context.params).trialId);
  if (!trialId.success) {
    return jsonError(
      400,
      "HEARING_AUDIO_AUDIT_TRIAL_ID_INVALID",
      "The hearing link is invalid.",
    );
  }

  let ownerSession;
  try {
    ownerSession = verifyCaseOwnerSession(
      request.cookies.get(CASE_OWNER_COOKIE_NAME)?.value,
    );
  } catch (error) {
    console.error("hearing_audio_audit_session_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(
      503,
      "HEARING_AUDIO_AUDIT_SESSION_UNAVAILABLE",
      "The secure hearing session could not be verified.",
    );
  }
  if (ownerSession === null) {
    return jsonError(
      401,
      "HEARING_AUDIO_AUDIT_SESSION_REQUIRED",
      "This hearing belongs to a different or expired session.",
    );
  }

  let body;
  try {
    body = await parseHearingJson(
      request,
      HearingAudioAuditIngestRequestSchema,
    );
  } catch (error) {
    if (error instanceof HearingHttpError) return requestError(error);
    return serviceError(error);
  }

  try {
    const result = await callConvexCaseService({
      path: "/service/hearings/audio-audit/record",
      body: {
        ownerId: ownerSession.ownerId,
        trialId: trialId.data,
        record: body.record,
      },
      responseSchema: HearingAudioAuditPersistResultSchema,
      signal: request.signal,
    });
    if (result.recordId !== body.record.recordId) {
      throw new ConvexCaseServiceError("CASE_SERVICE_RESPONSE_INVALID", 502);
    }
    return json(result);
  } catch (error) {
    return serviceError(error);
  }
}
