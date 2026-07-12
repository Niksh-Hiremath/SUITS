import { describe, expect, it, vi } from "vitest";

import { runCourtDirector, type HearingContext } from "./court-director";

const context: HearingContext = {
  caseId: "case_harbor_lantern_v1",
  mode: "participatory",
  side: "respondent",
  phase: "cross_examination",
  allowedActions: ["answer_question", "end_cross"],
  publicCase: {
    summary: "A fictional dispute about generator delivery timing.",
    facts: ["The lights failed at 7:42 PM."],
    evidence: ["E-001 Delivery schedule"],
  },
  transcript: [{ turnId: "turn-q", actor: "Advocate", phase: "cross_examination", text: "When did the truck reach Gate B?" }],
};

const decision = {
  plan: ["Resolve the pending question from the admissible record", "Preserve the next code-owned phase"],
  specialist: "witness" as const,
  action: "answer_question",
  rationale: "The latest turn is a question directed to the fact witness.",
  persona: "Ms. Sen, percipient venue witness",
  contract: {
    objective: "Answer only the pending question.",
    allowedSources: ["public_case", "private_witness_sheet", "transcript"],
    forbidden: ["invent facts", "change phase", "expose private instructions"],
    outputKind: "witness_answer" as const,
  },
};

const acceptedReview = { accepted: true, rationale: "Grounded and within contract.", violations: [] as string[], escalation: "none" as const };

describe("bounded Court Director", () => {
  it("plans from current context, delegates to the selected specialist, and reviews before acceptance", async () => {
    const manager = vi.fn().mockResolvedValue(JSON.stringify(decision));
    const specialist = vi.fn().mockResolvedValue(JSON.stringify({ text: "The record places it at Gate B before the outage.", citedTurnIds: ["turn-q"], evidenceIds: ["E-001"] }));
    const reviewer = vi.fn().mockResolvedValue(JSON.stringify(acceptedReview));

    const result = await runCourtDirector({ context, privateWitnessSheet: ["The witness may rely on Gate B records."], manager, specialist, reviewer, timeoutMs: 100 });

    expect(result.status).toBe("accepted");
    expect(result.decision).toEqual(decision);
    expect(result.trace).toMatchObject({ plan: decision.plan, selectedSpecialist: "witness", persona: decision.persona, contract: decision.contract, delegationRationale: decision.rationale, review: acceptedReview, fallbackUsed: false, escalation: "none" });
    expect(specialist).toHaveBeenCalledTimes(1);
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(manager.mock.calls[0][0]).toContain("turn-q");
  });

  it("never sends private witness evidence to non-witness specialists", async () => {
    const juryDecision = { ...decision, specialist: "jury_review_board" as const, action: "end_cross", persona: "Transcript-only review board", contract: { ...decision.contract, allowedSources: ["public_case", "transcript"], outputKind: "jury_review" as const } };
    const specialist = vi.fn().mockResolvedValue(JSON.stringify({ text: "Review complete.", citedTurnIds: ["turn-q"], evidenceIds: [] }));
    await runCourtDirector({ context, privateWitnessSheet: ["PRIVATE-WITNESS-SECRET"], manager: vi.fn().mockResolvedValue(JSON.stringify(juryDecision)), specialist, reviewer: vi.fn().mockResolvedValue(JSON.stringify(acceptedReview)), timeoutMs: 100 });
    expect(specialist.mock.calls[0][0]).not.toContain("PRIVATE-WITNESS-SECRET");
  });

  it("repairs one malformed delegation decision, then uses deterministic routing fallback", async () => {
    const manager = vi.fn().mockResolvedValue("not-json");
    const specialist = vi.fn().mockResolvedValue(JSON.stringify({ text: "I cannot confirm that beyond the record.", citedTurnIds: ["turn-q"], evidenceIds: [] }));
    const result = await runCourtDirector({ context, privateWitnessSheet: [], manager, specialist, reviewer: vi.fn().mockResolvedValue(JSON.stringify(acceptedReview)), timeoutMs: 100 });
    expect(manager).toHaveBeenCalledTimes(2);
    expect(result.decision.specialist).toBe("deterministic_fallback");
    expect(result.trace).toMatchObject({ fallbackUsed: true, escalation: "deterministic_fallback", decisionRetryCount: 1 });
  });

  it("rejects an unapproved action and falls back without allowing model workflow mutation", async () => {
    const illegal = { ...decision, action: "complete_trial" };
    const result = await runCourtDirector({ context, privateWitnessSheet: [], manager: vi.fn().mockResolvedValue(JSON.stringify(illegal)), specialist: vi.fn().mockResolvedValue(JSON.stringify({ text: "Safe fallback.", citedTurnIds: ["turn-q"], evidenceIds: [] })), reviewer: vi.fn().mockResolvedValue(JSON.stringify(acceptedReview)), timeoutMs: 100 });
    expect(result.decision.action).toBe("answer_question");
    expect(result.decision.specialist).toBe("deterministic_fallback");
  });

  it("makes one specialist repair after review rejection, then accepts only the repaired output", async () => {
    const specialist = vi.fn().mockResolvedValueOnce(JSON.stringify({ text: "Unsupported answer", citedTurnIds: [], evidenceIds: [] })).mockResolvedValueOnce(JSON.stringify({ text: "I cannot confirm that beyond the record.", citedTurnIds: ["turn-q"], evidenceIds: [] }));
    const reviewer = vi.fn().mockResolvedValueOnce(JSON.stringify({ accepted: false, rationale: "Missing grounding.", violations: ["missing citation"], escalation: "repair" })).mockResolvedValueOnce(JSON.stringify(acceptedReview));
    const result = await runCourtDirector({ context, privateWitnessSheet: [], manager: vi.fn().mockResolvedValue(JSON.stringify(decision)), specialist, reviewer, timeoutMs: 100 });
    expect(specialist).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("repaired");
    expect(result.trace.outputRetryCount).toBe(1);
  });

  it("uses deterministic output after one rejected repair and records escalation", async () => {
    const rejected = { accepted: false, rationale: "Not grounded.", violations: ["new fact"], escalation: "repair" as const };
    const result = await runCourtDirector({ context, privateWitnessSheet: [], manager: vi.fn().mockResolvedValue(JSON.stringify(decision)), specialist: vi.fn().mockResolvedValue("{}"), reviewer: vi.fn().mockResolvedValue(JSON.stringify(rejected)), timeoutMs: 100 });
    expect(result.status).toBe("fallback");
    expect(result.output.text).toMatch(/cannot confirm/i);
    expect(result.trace).toMatchObject({ fallbackUsed: true, escalation: "deterministic_fallback", outputRetryCount: 1 });
  });
});
