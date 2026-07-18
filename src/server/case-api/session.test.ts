import { describe, expect, it } from "vitest";

import {
  readCaseServiceSecret,
  resolveCaseOwnerSession,
} from "./session";

const SECRET = "test-only-service-secret-that-is-long-enough";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("signed anonymous case ownership", () => {
  it("creates and verifies a stable owner session", () => {
    const first = resolveCaseOwnerSession(undefined, {
      secret: SECRET,
      createSessionId: () => SESSION_ID,
    });
    const second = resolveCaseOwnerSession(first.cookieValue, {
      secret: SECRET,
      createSessionId: () => "00000000-0000-4000-8000-000000000000",
    });

    expect(first).toMatchObject({ ownerId: `owner:${SESSION_ID}`, isNew: true });
    expect(second).toMatchObject({ ownerId: `owner:${SESSION_ID}`, isNew: false });
    expect(second.cookieValue).toBe(first.cookieValue);
  });

  it("replaces tampered, malformed, or incorrectly signed cookies", () => {
    const valid = resolveCaseOwnerSession(undefined, {
      secret: SECRET,
      createSessionId: () => SESSION_ID,
    });
    const replacementId = "00000000-0000-4000-8000-000000000000";

    for (const cookie of [
      `${valid.cookieValue}x`,
      valid.cookieValue.replace(SESSION_ID, replacementId),
      "v1.not-a-uuid.invalid",
      "v2.123e4567-e89b-42d3-a456-426614174000.invalid",
    ]) {
      expect(
        resolveCaseOwnerSession(cookie, {
          secret: SECRET,
          createSessionId: () => replacementId,
        }),
      ).toMatchObject({ ownerId: `owner:${replacementId}`, isNew: true });
    }
  });

  it("fails closed when the shared service secret is absent or weak", () => {
    expect(() => readCaseServiceSecret({})).toThrow("SUITS_CONVEX_SERVICE_SECRET");
    expect(() => readCaseServiceSecret({ SUITS_CONVEX_SERVICE_SECRET: "too-short" })).toThrow(
      "SUITS_CONVEX_SERVICE_SECRET",
    );
  });
});

