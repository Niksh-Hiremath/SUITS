import { describe, expect, it } from "vitest";

import {
  CaseUploadCleanupRequestSchema,
  CaseUploadCleanupResponseSchema,
  decideCaseUploadCleanup,
} from "./caseUploadCleanup";

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";
const UPLOAD_ID = `upload:${"a".repeat(48)}`;
const STORAGE_ID = "kg2abc123storageobject";
const REQUEST = { ownerId: OWNER_ID, uploadId: UPLOAD_ID, storageId: STORAGE_ID };

describe("case upload cleanup boundary", () => {
  it("strictly accepts only the owner, upload, and storage identifiers", () => {
    expect(CaseUploadCleanupRequestSchema.parse(REQUEST)).toEqual(REQUEST);
    expect(() =>
      CaseUploadCleanupRequestSchema.parse({ ...REQUEST, contentDigest: "a".repeat(64) }),
    ).toThrow();
    expect(() => CaseUploadCleanupRequestSchema.parse({ ...REQUEST, storageId: "" })).toThrow();
  });

  it("returns only whether an orphan was deleted", () => {
    expect(CaseUploadCleanupResponseSchema.parse({ deleted: true })).toEqual({ deleted: true });
    expect(() =>
      CaseUploadCleanupResponseSchema.parse({ deleted: false, reason: "conflict" }),
    ).toThrow();
  });
});

describe("case upload cleanup policy", () => {
  it("deletes only when neither the storage object nor upload is referenced", () => {
    expect(decideCaseUploadCleanup(REQUEST, null, null)).toEqual({
      deleteStorage: true,
      reason: "unreferenced",
    });
  });

  it("retains a storage object referenced by the matching registration", () => {
    expect(
      decideCaseUploadCleanup(
        REQUEST,
        { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
        { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      ),
    ).toEqual({ deleteStorage: false, reason: "matching_registration" });
  });

  it("fails closed for a foreign storage reference without exposing it in the response", () => {
    const decision = decideCaseUploadCleanup(
      REQUEST,
      { ownerId: OTHER_OWNER_ID, uploadId: `upload:${"b".repeat(48)}` },
      null,
    );

    expect(decision).toEqual({ deleteStorage: false, reason: "conflict" });
    expect(CaseUploadCleanupResponseSchema.parse({ deleted: decision.deleteStorage })).toEqual({
      deleted: false,
    });
  });

  it("fails closed when the requested upload is already registered to any storage object", () => {
    expect(
      decideCaseUploadCleanup(
        REQUEST,
        null,
        { ownerId: OWNER_ID, uploadId: UPLOAD_ID },
      ),
    ).toEqual({ deleteStorage: false, reason: "matching_registration" });
    expect(
      decideCaseUploadCleanup(
        REQUEST,
        null,
        { ownerId: OTHER_OWNER_ID, uploadId: UPLOAD_ID },
      ),
    ).toEqual({ deleteStorage: false, reason: "conflict" });
  });
});
