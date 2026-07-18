import { NextResponse } from "next/server";
import { z } from "zod";

import { HearingTrialIdSchema } from "../../domain/hearing-runtime";
import {
  ConvexCaseServiceError,
  RequestBodyLimitError,
  readBoundedRequestBody,
} from "../case-api";

const MAX_HEARING_REQUEST_BYTES = 32 * 1024;

export { HearingTrialIdSchema };

export class HearingHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "HearingHttpError";
    this.status = status;
    this.code = code;
  }
}

export function hearingJsonError(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function parseHearingJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HearingHttpError(415, "HEARING_JSON_REQUIRED");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new HearingHttpError(415, "HEARING_CONTENT_ENCODING_REJECTED");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_HEARING_REQUEST_BYTES
  ) {
    throw new HearingHttpError(413, "HEARING_REQUEST_TOO_LARGE");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedRequestBody(request, MAX_HEARING_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      throw new HearingHttpError(
        error.code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400,
        error.code === "REQUEST_BODY_TOO_LARGE"
          ? "HEARING_REQUEST_TOO_LARGE"
          : "HEARING_REQUEST_INVALID",
      );
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new HearingHttpError(400, "HEARING_REQUEST_INVALID");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HearingHttpError(400, "HEARING_REQUEST_INVALID");
  }
  return parsed.data;
}

export function hearingRouteError(
  error: unknown,
  fallbackMessage: string,
): NextResponse {
  if (error instanceof HearingHttpError) {
    const message =
      error.status === 413
        ? "The hearing request is too large."
        : error.status === 415
          ? "Send an uncompressed JSON hearing request."
          : "The hearing request is invalid.";
    return hearingJsonError(error.status, error.code, message);
  }
  if (error instanceof ConvexCaseServiceError) {
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 503;
    return hearingJsonError(status, error.code, fallbackMessage);
  }
  return hearingJsonError(500, "HEARING_REQUEST_FAILED", fallbackMessage);
}
