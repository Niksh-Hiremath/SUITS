import { describe, expect, it } from "vitest";

import {
  advancePhase,
  allowedActionsFor,
  type HearingPhase,
} from "./workflow";

describe("hearing workflow", () => {
  it("advances through the complete legal phase order", () => {
    const expected: HearingPhase[] = [
      "briefing",
      "opening",
      "cross_examination",
      "closing",
      "deliberation",
      "debrief",
      "complete",
    ];

    const visited: HearingPhase[] = ["briefing"];
    for (const next of expected.slice(1)) {
      visited.push(advancePhase(visited.at(-1)!, next));
    }

    expect(visited).toEqual(expected);
  });

  it("rejects a model-requested phase skip", () => {
    expect(() => advancePhase("opening", "deliberation")).toThrow(
      "Illegal phase transition: opening -> deliberation",
    );
  });

  it("exposes only actions permitted in the current phase", () => {
    expect(allowedActionsFor("cross_examination")).toEqual([
      "submit_question",
      "answer_question",
      "repeat_or_clarify",
      "end_cross",
      "resume",
    ]);
    expect(allowedActionsFor("complete")).toEqual([
      "view_transcript",
      "view_debrief",
      "download_debrief",
    ]);
  });
});