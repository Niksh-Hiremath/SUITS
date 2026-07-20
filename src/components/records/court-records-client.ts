import {
  CourtRecordsListResponseSchema,
  CourtRecordsViewSchema,
  type CourtRecordsListResponse,
  type CourtRecordsView,
} from "../../domain/court-records";
import { HearingTrialIdSchema } from "../../domain/hearing-runtime";

export const COURT_RECORDS_CLIENT_ERROR_DETAILS = Object.freeze({
  COURT_RECORD_SESSION_REQUIRED: Object.freeze({
    status: 401,
    message: "These Court Records belong to a different or expired session.",
  }),
  COURT_RECORD_NOT_FOUND: Object.freeze({
    status: 404,
    message: "The requested Court Record could not be found.",
  }),
  COURT_RECORD_MIGRATION_REQUIRED: Object.freeze({
    status: 409,
    message: "These Court Records must be migrated before they can be opened.",
  }),
  COURT_RECORD_UNAVAILABLE: Object.freeze({
    status: 503,
    message: "Court Records are temporarily unavailable.",
  }),
});

export type CourtRecordsClientErrorCode =
  keyof typeof COURT_RECORDS_CLIENT_ERROR_DETAILS;

export class CourtRecordsClientError extends Error {
  readonly code: CourtRecordsClientErrorCode;
  readonly status: number;

  constructor(code: CourtRecordsClientErrorCode) {
    const details = COURT_RECORDS_CLIENT_ERROR_DETAILS[code];
    super(details.message);
    this.name = "CourtRecordsClientError";
    this.code = code;
    this.status = details.status;
  }
}

export type CourtRecordsClientRequestOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type CourtRecordDownload = Readonly<{
  fileName: string;
  json: string;
  view: CourtRecordsView;
}>;

export function isCourtRecordsRequestAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function errorCodeForStatus(status: number): CourtRecordsClientErrorCode {
  switch (status) {
    case 401:
      return "COURT_RECORD_SESSION_REQUIRED";
    case 404:
      return "COURT_RECORD_NOT_FOUND";
    case 409:
      return "COURT_RECORD_MIGRATION_REQUIRED";
    default:
      return "COURT_RECORD_UNAVAILABLE";
  }
}

async function request(
  path: string,
  options: CourtRecordsClientRequestOptions,
): Promise<Response> {
  const response = await globalThis.fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
  });
  if (!response.ok) {
    throw new CourtRecordsClientError(errorCodeForStatus(response.status));
  }
  return response;
}

async function requestJson(
  path: string,
  options: CourtRecordsClientRequestOptions,
): Promise<unknown> {
  return (await request(path, options)).json() as Promise<unknown>;
}

function parseTrialId(trialId: string): string {
  const parsed = HearingTrialIdSchema.safeParse(trialId);
  if (!parsed.success) {
    throw new CourtRecordsClientError("COURT_RECORD_UNAVAILABLE");
  }
  return parsed.data;
}

function parseBoundView(payload: unknown, trialId: string): CourtRecordsView {
  const parsed = CourtRecordsViewSchema.safeParse(payload);
  if (!parsed.success || parsed.data.summary.trialId !== trialId) {
    throw new CourtRecordsClientError("COURT_RECORD_UNAVAILABLE");
  }
  return parsed.data;
}

function normalizeFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): never {
  if (error instanceof CourtRecordsClientError) throw error;
  if (signal?.aborted || isCourtRecordsRequestAbort(error)) throw error;
  throw new CourtRecordsClientError("COURT_RECORD_UNAVAILABLE");
}

export async function listCourtRecords(
  options: CourtRecordsClientRequestOptions = {},
): Promise<CourtRecordsListResponse> {
  try {
    const payload = await requestJson("/api/records", options);
    const parsed = CourtRecordsListResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new CourtRecordsClientError("COURT_RECORD_UNAVAILABLE");
    }
    return parsed.data;
  } catch (error) {
    return normalizeFailure(error, options.signal);
  }
}

export async function readCourtRecord(
  trialId: string,
  options: CourtRecordsClientRequestOptions = {},
): Promise<CourtRecordsView> {
  try {
    const parsedTrialId = parseTrialId(trialId);
    const payload = await requestJson(
      `/api/records/${encodeURIComponent(parsedTrialId)}`,
      options,
    );
    return parseBoundView(payload, parsedTrialId);
  } catch (error) {
    return normalizeFailure(error, options.signal);
  }
}

export async function downloadCourtRecord(
  trialId: string,
  options: CourtRecordsClientRequestOptions = {},
): Promise<CourtRecordDownload> {
  try {
    const parsedTrialId = parseTrialId(trialId);
    const response = await request(
      `/api/records/${encodeURIComponent(parsedTrialId)}/download`,
      options,
    );
    const json = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(json) as unknown;
    } catch {
      throw new CourtRecordsClientError("COURT_RECORD_UNAVAILABLE");
    }
    return Object.freeze({
      fileName: `suits-court-record-${parsedTrialId}.json`,
      json,
      view: parseBoundView(payload, parsedTrialId),
    });
  } catch (error) {
    return normalizeFailure(error, options.signal);
  }
}
