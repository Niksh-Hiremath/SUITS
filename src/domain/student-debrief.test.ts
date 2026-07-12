import { describe, expect, it } from "vitest";

import { outcomeLabel } from "./student-debrief";

describe("student debrief outcome", () => {
  it("explains a claimant verdict as a win for Asha", () => {
    expect(outcomeLabel("claimant")).toEqual({ verdict: "Asha Mehta wins", explanation: "Why you won" });
  });

  it("explains any other verdict as a loss or insufficient result", () => {
    expect(outcomeLabel("respondent")).toEqual({ verdict: "Vertex Logistics wins", explanation: "Why you lost" });
    expect(outcomeLabel("insufficient_record")).toEqual({ verdict: "Insufficient record", explanation: "Why the jury could not rule for you" });
  });
});