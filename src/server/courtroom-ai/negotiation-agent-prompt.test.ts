import { describe, expect, it } from "vitest";

import {
  NegotiationAgentValidationIssueSchema,
  type NegotiationAgentValidationIssue,
} from "@/domain/courtroom-ai/negotiation-agent";

import {
  NEGOTIATION_AGENT_INJECTION_CANARY,
  createNegotiationAgentOutputFixture,
  createNegotiationAgentRequestFixture,
} from "./negotiation-agent.test-fixtures";
import {
  NEGOTIATION_AGENT_PROMPT_CACHE_KEY,
  NEGOTIATION_AGENT_PROMPT_VERSION,
  buildNegotiationAgentPrompt,
} from "./negotiation-agent-prompt";

function repairIssue(
  overrides: Partial<NegotiationAgentValidationIssue> = {},
): NegotiationAgentValidationIssue {
  return NegotiationAgentValidationIssueSchema.parse({
    code: "terms_outside_authority",
    path: ["terms", "amount"],
    message: "The candidate exceeded private authority.",
    ...overrides,
  });
}

describe("buildNegotiationAgentPrompt", () => {
  it("keeps case strings and private priorities inside the untrusted envelope", () => {
    const request = createNegotiationAgentRequestFixture(
      NEGOTIATION_AGENT_INJECTION_CANARY,
    );
    const settlement = request.knowledgeView.counsel.privateSettlement;
    if (settlement === null) throw new Error("Fixture requires settlement scope");
    settlement.confidentialPriorities = [NEGOTIATION_AGENT_INJECTION_CANARY];
    const prompt = buildNegotiationAgentPrompt({ mode: "initial", request });

    expect(prompt).toMatchObject({
      promptVersion: NEGOTIATION_AGENT_PROMPT_VERSION,
      cacheKey: NEGOTIATION_AGENT_PROMPT_CACHE_KEY,
    });
    expect(prompt.untrustedUserContent).toContain(
      NEGOTIATION_AGENT_INJECTION_CANARY,
    );
    expect(prompt.developerPrefix).not.toContain(
      NEGOTIATION_AGENT_INJECTION_CANARY,
    );
    expect(prompt.developerContext).not.toContain(
      NEGOTIATION_AGENT_INJECTION_CANARY,
    );
    expect(prompt.developerContext).toContain(
      '"expectedLastEventId":"event_negotiation_prompt_head"',
    );
    expect(prompt.developerContext).toContain(
      '"exactTargetOfferId":"offer_incoming"',
    );
    expect(prompt.developerContext).toContain('"valueDirection":"minimize_amount"');
    expect(prompt.developerContext).toMatch(
      /"immutableRequestSha256":"[a-f0-9]{64}"/,
    );
  });

  it("keeps rejected text and issue messages untrusted while exposing safe repair codes", () => {
    const request = createNegotiationAgentRequestFixture();
    const rejected = {
      ...createNegotiationAgentOutputFixture(),
      decisionSummary: NEGOTIATION_AGENT_INJECTION_CANARY,
    };
    const issue = repairIssue({
      message: NEGOTIATION_AGENT_INJECTION_CANARY,
    });
    const prompt = buildNegotiationAgentPrompt({
      mode: "repair",
      request,
      rejectedCandidate: rejected,
      validationIssues: [issue],
    });

    expect(prompt.untrustedUserContent).toContain(
      NEGOTIATION_AGENT_INJECTION_CANARY,
    );
    expect(prompt.developerContext).not.toContain(
      NEGOTIATION_AGENT_INJECTION_CANARY,
    );
    expect(prompt.developerContext).toContain(
      '"code":"terms_outside_authority"',
    );
    expect(prompt.developerContext).toContain('"path":["terms","amount"]');
    expect(prompt.developerContext).toContain('"attempt":2');
  });

  it("uses one stable cache prefix across initial and repair prompts", () => {
    const request = createNegotiationAgentRequestFixture();
    const initial = buildNegotiationAgentPrompt({ mode: "initial", request });
    const repair = buildNegotiationAgentPrompt({
      mode: "repair",
      request,
      rejectedCandidate: createNegotiationAgentOutputFixture(),
      validationIssues: [repairIssue()],
    });

    expect(repair.developerPrefix).toBe(initial.developerPrefix);
    expect(repair.cacheKey).toBe(initial.cacheKey);
    const hash = initial.developerContext.match(
      /"immutableRequestSha256":"([a-f0-9]{64})"/,
    )?.[1];
    expect(hash).toBeTruthy();
    expect(repair.developerContext).toContain(
      `"immutableRequestSha256":"${hash}"`,
    );
  });

  it("refuses a repair prompt without a deterministic validation issue", () => {
    expect(() =>
      buildNegotiationAgentPrompt({
        mode: "repair",
        request: createNegotiationAgentRequestFixture(),
        rejectedCandidate: createNegotiationAgentOutputFixture(),
        validationIssues: [],
      }),
    ).toThrow("Negotiation repair requires a validation issue");
  });
});
