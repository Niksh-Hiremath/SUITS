import { describe, expect, it } from "vitest";

import { buildCaseCompileClaimCompletionRequest } from "./caseDrafts";

const FENCE = {
  ownerId: "owner:123e4567-e89b-42d3-a456-426614174000",
  uploadId: "upload:123e4567-e89b-42d3-a456-426614174001",
  caseId: "case:123e4567-e89b-42d3-a456-426614174002",
  contentDigest: "a".repeat(64),
  claimId: `claim:${"b".repeat(64)}`,
  generation: 3,
  leaseToken: "c".repeat(64),
};

describe("compiled draft claim completion", () => {
  it("builds the exact identity and lease fence committed with draft writes", () => {
    const registrationCarrier = {
      ...FENCE,
      storageId: "must-not-cross-the-claim-boundary",
    };
    expect(buildCaseCompileClaimCompletionRequest(registrationCarrier)).toEqual(FENCE);
  });

  it("rejects malformed registration fences before claim completion", () => {
    expect(() => buildCaseCompileClaimCompletionRequest({
      ...FENCE,
      generation: -1,
    })).toThrow();
    expect(() => buildCaseCompileClaimCompletionRequest({
      ...FENCE,
      leaseToken: "short",
    })).toThrow();
  });
});
