import { describe, expect, it } from "vitest";

import {
  deriveCaseCompilationIds,
  deriveCaseOwnerSessionId,
  parseCaseCompileRequestId,
} from "./idempotency";

const SECRET = "test-only-session-secret-that-is-long-enough";
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNER_ID = `owner:${deriveCaseOwnerSessionId(REQUEST_ID, SECRET)}`;

describe("case compile idempotency", () => {
  it("derives stable opaque owner, upload, and case IDs", () => {
    expect(deriveCaseOwnerSessionId(REQUEST_ID, SECRET)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
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
        `owner:${deriveCaseOwnerSessionId("00000000-0000-4000-8000-000000000000", SECRET)}`,
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
