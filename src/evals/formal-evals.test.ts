import { describe, expect, it } from "vitest";

import { evaluateGoldenRun, summarizePromptVersions } from "./formal-evals";

const validRun = {
  trial: { phase: "complete", phaseSequence: 6 },
  turns: [
    { turnId: "t1", phase: "briefing", factIds: ["f1"], evidenceIds: [] },
    { turnId: "t2", phase: "opening", factIds: [], evidenceIds: ["e1"] },
    { turnId: "t3", phase: "cross_examination", factIds: ["f2"], evidenceIds: ["e2"] },
    { turnId: "t4", phase: "closing", factIds: [], evidenceIds: [] },
  ],
  traces: [
    { traceId: "root", status: "succeeded", parentId: undefined, endedAt: 2, latencyMs: 1 },
    { traceId: "child", status: "succeeded", parentId: "root", endedAt: 2, latencyMs: 1 },
  ],
  votes: [{ turnCitations: ["t3"], evidenceIds: ["e2"] }],
  debrief: {
    status: "valid",
    strengths: [{ finding: "Focused cross", turnCitations: ["t3"] }],
    missedOpportunities: [{ finding: "Could sequence better", turnCitations: ["t3"], recommendedQuestion: "What happened next?" }],
    contradictions: [{ turnCitations: ["t3"], evidenceIds: ["e2"] }],
    evidenceUsed: [{ evidenceId: "e2", turnCitations: ["t3"] }],
    jurorMovement: [{ turnCitations: ["t3"] }],
    revisedClosing: { text: "The record establishes the timeline.", basedOnTurnIds: ["t3"] },
  },
  allowedFactIds: ["f1", "f2"],
  allowedEvidenceIds: ["e1", "e2"],
};

describe("formal golden-run evaluation", () => {
  it("returns persisted-ready named evidence for every reliability check", () => {
    const result = evaluateGoldenRun(validRun);
    expect(result.status).toBe("passed");
    expect(result.assertions.map((item) => item.name)).toEqual([
      "valid_phase_order",
      "schema_valid_output",
      "citations_resolve",
      "no_new_facts",
      "useful_debrief",
      "complete_trace",
    ]);
    expect(result.assertions.every((item) => item.passed && item.evidenceJson.length > 2)).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails citations and grounding for invented references", () => {
    const result = evaluateGoldenRun({
      ...validRun,
      votes: [{ turnCitations: ["invented"], evidenceIds: ["invented-evidence"] }],
      debrief: { ...validRun.debrief, revisedClosing: { text: "New", basedOnTurnIds: ["invented"] } },
    });
    expect(result.status).toBe("failed");
    expect(result.assertions.find((item) => item.name === "citations_resolve")?.passed).toBe(false);
    expect(result.assertions.find((item) => item.name === "no_new_facts")?.passed).toBe(false);
  });

  it("compares prompt versions from persisted run results", () => {
    expect(summarizePromptVersions([
      { promptVersion: "jury.v1", status: "passed" },
      { promptVersion: "jury.v1", status: "failed" },
      { promptVersion: "jury.v2", status: "passed" },
    ])).toEqual([
      { promptVersion: "jury.v1", passed: 1, total: 2, passRate: 0.5 },
      { promptVersion: "jury.v2", passed: 1, total: 1, passRate: 1 },
    ]);
  });
});
