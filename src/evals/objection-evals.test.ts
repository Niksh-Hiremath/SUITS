import { describe, expect, it } from "vitest";

import {
  createMilestone6ObjectionEvalFixture,
  evaluateMilestone6ObjectionFixture,
} from "./objection-evals";

describe("Milestone 6 deterministic objection evaluation", () => {
  it("passes every named interruption and strike invariant with symbolic evidence", async () => {
    const fixture = await createMilestone6ObjectionEvalFixture();
    const result = evaluateMilestone6ObjectionFixture(fixture);

    expect(result.status).toBe("passed");
    expect(result.assertions.map((item) => item.name)).toEqual([
      "candidate_withdrawal_no_write",
      "cached_reaction_precedes_final_and_model",
      "sustained_cancels_and_rephrases",
      "overruled_resumes_exact_response",
      "stale_model_and_late_audio_suppressed",
      "strike_grant_marks_target_stricken",
      "strike_denial_preserves_testimony",
    ]);
    expect(result.assertions.every((item) => item.passed)).toBe(true);
    expect(result.assertions.every((item) => item.evidenceJson.length > 2)).toBe(true);
    expect(result.score).toBe(1);
    expect(JSON.stringify(fixture)).not.toContain("fixture-question");
    expect(JSON.stringify(fixture)).not.toContain("fixture-answer");
  });

  it("fails no-write, cancellation, resume, and stale-delivery regressions", async () => {
    const fixture = await createMilestone6ObjectionEvalFixture();
    const result = evaluateMilestone6ObjectionFixture({
      ...fixture,
      candidateWithdrawal: {
        ...fixture.candidateWithdrawal,
        durableEventTypes: ["RULE_ON_OBJECTION"],
      },
      sustained: { ...fixture.sustained, responseStatus: "streaming" },
      overruled: { ...fixture.overruled, responseStatus: "cancelled" },
      staleSuppression: {
        ...fixture.staleSuppression,
        lateAudio: { ...fixture.staleSuppression.lateAudio, played: true },
      },
    });

    expect(result.status).toBe("failed");
    expect(
      result.assertions
        .filter((item) => !item.passed)
        .map((item) => item.name),
    ).toEqual([
      "candidate_withdrawal_no_write",
      "sustained_cancels_and_rephrases",
      "overruled_resumes_exact_response",
      "stale_model_and_late_audio_suppressed",
    ]);
  });

  it("fails grant and denial fixtures that lose their historical record semantics", async () => {
    const fixture = await createMilestone6ObjectionEvalFixture();
    const result = evaluateMilestone6ObjectionFixture({
      ...fixture,
      strikeGranted: {
        ...fixture.strikeGranted,
        targetTestimonyStatus: "active",
      },
      strikeDenied: {
        ...fixture.strikeDenied,
        targetRetainedInHistory: false,
      },
    });

    expect(result.status).toBe("failed");
    expect(
      result.assertions
        .filter((item) => !item.passed)
        .map((item) => item.name),
    ).toEqual([
      "strike_grant_marks_target_stricken",
      "strike_denial_preserves_testimony",
    ]);
  });
});
