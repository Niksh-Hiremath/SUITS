import { describe, expect, it } from "vitest";

import { sha256HexToBase64, storedSha256Matches } from "./storageIntegrity";

const ABC_SHA256_HEX = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const ABC_SHA256_BASE64 = "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=";

describe("Convex storage digest compatibility", () => {
  it("converts an exact SHA-256 digest to the observed storage encoding", () => {
    expect(sha256HexToBase64(ABC_SHA256_HEX)).toBe(ABC_SHA256_BASE64);
    expect(storedSha256Matches(ABC_SHA256_HEX, ABC_SHA256_HEX)).toBe(true);
    expect(storedSha256Matches(ABC_SHA256_BASE64, ABC_SHA256_HEX)).toBe(true);
    expect(storedSha256Matches("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0", ABC_SHA256_HEX)).toBe(true);
  });

  it("rejects malformed or different digests", () => {
    expect(storedSha256Matches("not-a-digest", ABC_SHA256_HEX)).toBe(false);
    expect(storedSha256Matches(ABC_SHA256_BASE64, "A".repeat(64))).toBe(false);
    expect(() => sha256HexToBase64("bad")).toThrow("STORAGE_SHA256_HEX_INVALID");
  });
});
