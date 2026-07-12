import { describe, expect, it, vi } from "vitest";

import { deterministicReview, runReview, validateReview } from "./review";

const turns = [
  { turnId: "turn-q", actor: "Advocate", phase: "cross_examination", text: "The log says 7:31, correct?" },
  { turnId: "turn-a", actor: "Witness", phase: "cross_examination", text: "Yes, before 7:42." },
  { turnId: "turn-c", actor: "Advocate", phase: "closing", text: "The truck arrived before the outage." },
];

const valid = {
  verdict: "respondent" as const,
  confidence: 0.8,
  jurorParts: [1, 2, 3].map((n) => ({ juror: `Juror ${n}`, persona: "careful", text: "The record supports Northstar.", turnCitations: ["turn-a"] })),
  overallAssessment: "The advocate separated delay from causation.",
  strength: { finding: "Used the timing admission.", turnCitations: ["turn-a"] },
  missedOpportunity: { finding: "Could authenticate the log.", turnCitations: ["turn-q"], recommendedQuestion: "Who created the Gate B log?" },
  revisedClosing: { text: "The admitted timing defeats causation.", basedOnTurnIds: ["turn-a", "turn-c"] },
};

describe("review validation", () => {
  it("rejects structurally malformed output", () => {
    expect(() => validateReview({ ...valid, jurorParts: [] }, new Set(turns.map((t) => t.turnId)))).toThrow(/structured review/i);
  });

  it("rejects empty and unknown transcript citations", () => {
    expect(() => validateReview({ ...valid, strength: { finding: "claim", turnCitations: [] } }, new Set(turns.map((t) => t.turnId)))).toThrow(/citation/i);
    expect(() => validateReview({ ...valid, strength: { finding: "claim", turnCitations: ["invented"] } }, new Set(turns.map((t) => t.turnId)))).toThrow(/citation/i);
  });
});

describe("bounded model execution", () => {
  it("makes exactly one repair attempt after invalid output", async () => {
    const call = vi.fn().mockResolvedValueOnce("not json").mockResolvedValueOnce(JSON.stringify(valid));
    const result = await runReview({ turns, call, timeoutMs: 100 });
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("repaired");
    expect(result.retryCount).toBe(1);
  });

  it("uses deterministic fallback after the repair is invalid", async () => {
    const call = vi.fn().mockResolvedValue("{}");
    const result = await runReview({ turns, call, timeoutMs: 100 });
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("fallback");
    expect(result.retryCount).toBe(1);
    expect(result.review).toEqual(deterministicReview(turns));
    expect(result.errorCode).toBe("INVALID_MODEL_OUTPUT");
  });

  it("times out each attempt and then falls back deterministically", async () => {
    vi.useFakeTimers();
    const call = vi.fn(() => new Promise<string>(() => undefined));
    const pending = runReview({ turns, call, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(101);
    const result = await pending;
    vi.useRealTimers();
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("fallback");
    expect(result.errorCode).toBe("MODEL_TIMEOUT");
  });
});
