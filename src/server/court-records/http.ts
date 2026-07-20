import { NextRequest, NextResponse } from "next/server";

import type { CourtRecordsView } from "@/domain/court-records";
import {
  CASE_OWNER_COOKIE_NAME,
  ConvexCaseServiceError,
  verifyCaseOwnerSession,
} from "@/server/case-api";

export const COURT_RECORDS_PRIVATE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
});

type OwnerResolution =
  | Readonly<{ ok: true; ownerId: string }>
  | Readonly<{ ok: false; response: NextResponse }>;

export function courtRecordsJson(
  value: unknown,
  status = 200,
): NextResponse {
  return NextResponse.json(value, {
    status,
    headers: COURT_RECORDS_PRIVATE_HEADERS,
  });
}

export function courtRecordsError(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return courtRecordsJson({ error: { code, message } }, status);
}

export function resolveCourtRecordsOwner(
  request: NextRequest,
): OwnerResolution {
  let session;
  try {
    session = verifyCaseOwnerSession(
      request.cookies.get(CASE_OWNER_COOKIE_NAME)?.value,
    );
  } catch (error) {
    console.error("court_records_session_verification_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      ok: false,
      response: courtRecordsError(
        503,
        "COURT_RECORD_SESSION_UNAVAILABLE",
        "The secure Court Records session could not be verified.",
      ),
    };
  }
  if (session === null) {
    return {
      ok: false,
      response: courtRecordsError(
        401,
        "COURT_RECORD_SESSION_REQUIRED",
        "These Court Records belong to a different or expired session.",
      ),
    };
  }
  return { ok: true, ownerId: session.ownerId };
}

export function bindCourtRecordsViewToTrial(
  view: CourtRecordsView,
  trialId: string,
): CourtRecordsView {
  if (view.summary.trialId !== trialId) {
    throw new ConvexCaseServiceError("CASE_SERVICE_RESPONSE_INVALID", 502);
  }
  return view;
}

export function courtRecordsServiceError(
  error: unknown,
  options: Readonly<{
    operation: "list" | "read" | "download";
    allowNotFound: boolean;
  }>,
): NextResponse {
  console.error("court_records_service_failed", {
    operation: options.operation,
    name: error instanceof Error ? error.name : "UnknownError",
    ...(error instanceof ConvexCaseServiceError
      ? { code: error.code, status: error.status }
      : {}),
  });
  if (error instanceof ConvexCaseServiceError) {
    if (options.allowNotFound && error.code === "TRIAL_NOT_FOUND") {
      return courtRecordsError(
        404,
        "COURT_RECORD_NOT_FOUND",
        "The requested Court Record could not be found.",
      );
    }
    if (error.code === "TRIAL_MIGRATION_REQUIRED") {
      return courtRecordsError(
        409,
        "COURT_RECORD_MIGRATION_REQUIRED",
        "These Court Records must be migrated before they can be opened.",
      );
    }
  }
  return courtRecordsError(
    503,
    "COURT_RECORD_UNAVAILABLE",
    "Court Records are temporarily unavailable.",
  );
}

export function courtRecordsDownload(
  view: CourtRecordsView,
  trialId: string,
): NextResponse {
  return new NextResponse(JSON.stringify(view), {
    status: 200,
    headers: {
      ...COURT_RECORDS_PRIVATE_HEADERS,
      "Content-Disposition":
        `attachment; filename="suits-court-record-${trialId}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
