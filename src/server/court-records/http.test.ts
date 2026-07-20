import { afterEach, describe, expect, it, vi } from "vitest";

import { ConvexCaseServiceError } from "@/server/case-api";

import { courtRecordsServiceError } from "./http";

describe("Court Records service error mapping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a bounded cancellation response without logging a service failure", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = courtRecordsServiceError(
      new ConvexCaseServiceError("CASE_SERVICE_CALLER_ABORTED", 499, {
        cause: new Error("private cancellation detail"),
      }),
      { operation: "list", allowNotFound: false },
    );

    expect(response.status).toBe(499);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "COURT_RECORD_REQUEST_CANCELLED",
        message: "The Court Records request was cancelled.",
      },
    });
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("keeps timeouts distinct while transport failures remain unavailable", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const timeoutResponse = courtRecordsServiceError(
      new ConvexCaseServiceError("CASE_SERVICE_TIMEOUT", 504),
      { operation: "read", allowNotFound: true },
    );
    const transportResponse = courtRecordsServiceError(
      new ConvexCaseServiceError("CASE_SERVICE_UNAVAILABLE", 503),
      { operation: "download", allowNotFound: true },
    );

    expect(timeoutResponse.status).toBe(504);
    await expect(timeoutResponse.json()).resolves.toEqual({
      error: {
        code: "COURT_RECORD_TIMEOUT",
        message: "The Court Records request timed out.",
      },
    });
    expect(transportResponse.status).toBe(503);
    await expect(transportResponse.json()).resolves.toEqual({
      error: {
        code: "COURT_RECORD_UNAVAILABLE",
        message: "Court Records are temporarily unavailable.",
      },
    });
    expect(errorLog).toHaveBeenCalledTimes(2);
  });
});
