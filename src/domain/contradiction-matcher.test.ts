import { describe, expect, it } from "vitest";

import { matchGoldenContradiction } from "./contradiction-matcher";

describe("golden contradiction matcher", () => {
  it.each([
    "Ms. Sen, the Gate B log records Northstar's truck at 7:31 PM, eleven minutes before the lights failed at 7:42, correct?",
    "The security log puts the generator truck at Gate B at 7.31 before the 7.42 outage, isn't that right?",
    "Gate B recorded the Northstar vehicle eleven minutes before the lighting interruption, didn't it?",
  ])("unlocks the authored admission for an accepted variant", (question) => {
    expect(matchGoldenContradiction(question).matched).toBe(true);
  });

  it.each([
    "Were they late?",
    "What does the log say?",
    "The truck arrived at six, correct?",
  ])("does not unlock for an incomplete or unsupported question", (question) => {
    expect(matchGoldenContradiction(question).matched).toBe(false);
  });
});