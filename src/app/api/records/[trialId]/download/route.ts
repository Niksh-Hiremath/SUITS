import { NextRequest } from "next/server";

import { CourtRecordsViewSchema } from "@/domain/court-records";
import { HearingTrialIdSchema } from "@/domain/hearing-runtime";
import {
  callConvexCaseService,
  isTrustedRequestOrigin,
} from "@/server/case-api";
import {
  bindCourtRecordsViewToTrial,
  courtRecordsDownload,
  courtRecordsError,
  courtRecordsServiceError,
  resolveCourtRecordsOwner,
} from "@/server/court-records/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ trialId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isTrustedRequestOrigin(request)) {
    return courtRecordsError(
      403,
      "ORIGIN_REJECTED",
      "Cross-origin Court Records requests are not allowed.",
    );
  }
  const parsedTrialId = HearingTrialIdSchema.safeParse(
    (await context.params).trialId,
  );
  if (!parsedTrialId.success) {
    return courtRecordsError(
      400,
      "COURT_RECORD_TRIAL_ID_INVALID",
      "The Court Record link is invalid.",
    );
  }
  const owner = resolveCourtRecordsOwner(request);
  if (!owner.ok) return owner.response;

  try {
    const view = await callConvexCaseService({
      path: "/service/court-records/read",
      body: { ownerId: owner.ownerId, trialId: parsedTrialId.data },
      responseSchema: CourtRecordsViewSchema,
      signal: request.signal,
    });
    return courtRecordsDownload(
      bindCourtRecordsViewToTrial(view, parsedTrialId.data),
      parsedTrialId.data,
    );
  } catch (error) {
    return courtRecordsServiceError(error, {
      operation: "download",
      allowNotFound: true,
    });
  }
}
