import { describe, expect, it } from "vitest";

import { outcomeLabel } from "./student-debrief";

describe("student debrief outcome", () => {
  it("explains a respondent verdict as a win for the represented side", () => {
    expect(outcomeLabel("respondent")).toEqual({ verdict: "Northstar wins", explanation: "Why you won" });
  });

  it("explains any other verdict as a loss or insufficient result", () => {
    expect(outcomeLabel("claimant")).toEqual({ verdict: "Harbor Lantern wins", explanation: "Why you lost" });
    expect(outcomeLabel("insufficient_record")).toEqual({ verdict: "Insufficient record", explanation: "Why the jury could not rule for you" });
  });
});