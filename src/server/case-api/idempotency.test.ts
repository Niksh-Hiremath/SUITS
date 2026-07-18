import { describe, expect, it } from "vitest";

import {
  deriveCaseCompilationIds,
  parseCaseCompileRequestId,
} from "./idempotency";

const SECRET = "test-only-session-secret-that-is-long-enough";
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNER_ID = "owner:0a4661ed-21c4-4609-8d1a-ea70be86af58";

describe("case compile idempotency", () => {
  it("derives stable opaque owner, upload, and case IDs", () => {
    const first = deriveCaseCompilationIds(OWNER_ID, REQUEST_ID, "a".repeat(64), SECRET);
    const replay = deriveCaseCompilationIds(OWNER_ID, REQUEST_ID, "a".repeat(64), SECRET);
    expect(replay).toEqual(first);
    expect(first.uploadId).toMatch(/^upload:[a-f0-9]{48}$/u);
    expect(first.caseId).toMatch(/^case:[a-f0-9]{48}$/u);
  });

  it("separates files and owners while rejecting attacker-shaped request IDs", () => {
    const baseline = deriveCaseCompilationIds(OWNER_ID, REQUEST_ID, "a".repeat(64), SECRET);
    expect(deriveCaseCompilationIds(OWNER_ID, REQUEST_ID, "b".repeat(64), SECRET)).not.toEqual(baseline);
    expect(
      deriveCaseCompilationIds(
        "owner:00000000-0000-4000-8000-000000000000",
        REQUEST_ID,
        "a".repeat(64),
        SECRET,
      ),
    ).not.toEqual(baseline);
    expect(parseCaseCompileRequestId(REQUEST_ID)).toBe(REQUEST_ID);
    expect(parseCaseCompileRequestId(null)).toBeNull();
    expect(() => parseCaseCompileRequestId("../../owner")).toThrow("CASE_COMPILE_REQUEST_ID_INVALID");
  });
});
