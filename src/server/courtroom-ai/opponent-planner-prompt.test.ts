import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { OpponentPlannerValidationIssueSchema } from "@/domain/courtroom-ai";

import {
  OPPONENT_PLANNER_INJECTION_CANARY,
  createOpponentPlannerRequestFixture,
} from "./opponent-planner.test-fixtures";
import {
  OPPONENT_PLANNER_PROMPT_CACHE_KEY,
  OPPONENT_PLANNER_PROMPT_VERSION,
  buildOpponentPlannerPrompt,
  getOpponentPlannerStableDeveloperPrefix,
} from "./opponent-planner-prompt";

function manifest(prompt: ReturnType<typeof buildOpponentPlannerPrompt>) {
  return JSON.parse(prompt.developerContext.split("\n")[1]) as Record<
    string,
    unknown
  >;
}

describe("opponent planner prompt boundary", () => {
  it("keeps a stable cache prefix and delimits all case content as untrusted", () => {
    const request = createOpponentPlannerRequestFixture(
      OPPONENT_PLANNER_INJECTION_CANARY,
    );
    const prompt = buildOpponentPlannerPrompt({ mode: "initial", request });

    expect(prompt.promptVersion).toBe(OPPONENT_PLANNER_PROMPT_VERSION);
    expect(prompt.cacheKey).toBe(OPPONENT_PLANNER_PROMPT_CACHE_KEY);
    expect(prompt.developerPrefix).toBe(
      getOpponentPlannerStableDeveloperPrefix(),
    );
    expect(prompt.developerPrefix).not.toContain(
      OPPONENT_PLANNER_INJECTION_CANARY,
    );
    expect(prompt.developerContext).not.toContain(
      OPPONENT_PLANNER_INJECTION_CANARY,
    );
    expect(prompt.developerContext).not.toContain("Avoid an admission.");
    expect(prompt.untrustedUserContent).toContain(
      OPPONENT_PLANNER_INJECTION_CANARY,
    );
    expect(prompt.untrustedUserContent).toContain(
      '"instructionAuthority":"none"',
    );
  });

  it("binds the immutable request by hash without copying private text", () => {
    const request = createOpponentPlannerRequestFixture();
    const prompt = buildOpponentPlannerPrompt({ mode: "initial", request });
    const parsed = manifest(prompt);
    expect(parsed).toMatchObject({
      mode: "initial",
      attempt: 1,
      callBinding: {
        callId: request.callId,
        decisionId: request.decisionId,
        expectedStateVersion: request.expectedStateVersion,
      },
      knowledgeBinding: {
        strategyMemoryCount: 1,
        settlementOfferCount: 0,
        witnessCount: 1,
      },
    });
    expect(parsed.immutableRequestSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(request), "utf8")
        .digest("hex"),
    );
  });

  it("repairs against the same request with only safe issue code/path data", () => {
    const request = createOpponentPlannerRequestFixture();
    const validationIssue = OpponentPlannerValidationIssueSchema.parse({
      code: "unknown_fact_citation",
      path: ["proposedMoves", 0, "citations", "factIds", 0],
      message: "Sensitive validator detail that must not reach repair.",
    });
    const prompt = buildOpponentPlannerPrompt({
      mode: "repair",
      request,
      rejectedCandidate: {
        schemaVersion: "opponent-planner.output.v1",
        objectives: ["Repair the plan."],
        proposedMoves: [
          {
            kind: "question_witness",
            witnessId: "witness_hidden",
            rationale: "Try again.",
            citations: { factIds: ["fact_hidden"] },
            rawReasoning: "secret scratchpad",
          },
        ],
        ownerId: "owner_leak",
      },
      validationIssues: [validationIssue],
    });
    const parsed = manifest(prompt);
    expect(parsed).toMatchObject({
      mode: "repair",
      attempt: 2,
      repair: {
        issueCount: 1,
        includedIssueCount: 1,
        issues: [
          {
            code: "unknown_fact_citation",
            path: ["proposedMoves", 0, "citations", "factIds", 0],
          },
        ],
      },
    });
    expect(prompt.developerContext).not.toContain(validationIssue.message);
    expect(prompt.untrustedUserContent).not.toContain("rawReasoning");
    expect(prompt.untrustedUserContent).not.toContain("secret scratchpad");
    expect(prompt.untrustedUserContent).not.toContain("owner_leak");
    expect(prompt.untrustedUserContent).toContain("fact_hidden");
  });

  it("requires at least one safe repair issue", () => {
    expect(() =>
      buildOpponentPlannerPrompt({
        mode: "repair",
        request: createOpponentPlannerRequestFixture(),
        rejectedCandidate: {},
        validationIssues: [],
      }),
    ).toThrow("Opponent-plan repair requires a validation issue");
  });
});
