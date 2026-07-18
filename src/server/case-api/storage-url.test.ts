import { describe, expect, it } from "vitest";

import { validateConvexStorageUploadUrl } from "./storage-url";

const ENVIRONMENT = { NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud" };

describe("Convex storage upload URL boundary", () => {
  it("accepts only HTTPS storage paths on the configured deployment origin", () => {
    expect(
      validateConvexStorageUploadUrl(
        "https://example.convex.cloud/api/storage/upload?token=opaque",
        ENVIRONMENT,
      ),
    ).toBe("https://example.convex.cloud/api/storage/upload?token=opaque");
    for (const url of [
      "https://attacker.test/api/storage/upload",
      "http://example.convex.cloud/api/storage/upload",
      "https://example.convex.cloud/not-storage/upload",
      "https://user:pass@example.convex.cloud/api/storage/upload",
      "not-a-url",
    ]) {
      expect(() => validateConvexStorageUploadUrl(url, ENVIRONMENT)).toThrow(
        "CASE_STORAGE_URL_INVALID",
      );
    }
  });
});
