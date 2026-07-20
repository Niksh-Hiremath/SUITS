import { NextRequest } from "next/server";

import { CourtRecordsListResponseSchema } from "@/domain/court-records";
import {
  callConvexCaseService,
  isTrustedRequestOrigin,
} from "@/server/case-api";
import {
  courtRecordsError,
  courtRecordsJson,
  courtRecordsServiceError,
  resolveCourtRecordsOwner,
} from "@/server/court-records/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isTrustedRequestOrigin(request)) {
    return courtRecordsError(
      403,
      "ORIGIN_REJECTED",
      "Cross-origin Court Records requests are not allowed.",
    );
  }
  const owner = resolveCourtRecordsOwner(request);
  if (!owner.ok) return owner.response;

  try {
    const summaries = await callConvexCaseService({
      path: "/service/court-records/list",
      body: { ownerId: owner.ownerId },
      responseSchema: CourtRecordsListResponseSchema,
      signal: request.signal,
    });
    return courtRecordsJson(summaries);
  } catch (error) {
    return courtRecordsServiceError(error, {
      operation: "list",
      allowNotFound: false,
    });
  }
}
