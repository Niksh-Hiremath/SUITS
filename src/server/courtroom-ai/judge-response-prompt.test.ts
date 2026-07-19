import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { JudgeResponseValidationIssueSchema } from "@/domain/courtroom-ai/judge-response";

import {
  JUDICIAL_INJECTION_CANARY,
  createJudgeResponseRequestFixture,
} from "./judicial-response.test-fixtures";
import {
  JUDGE_RESPONSE_PROMPT_CACHE_KEY,
  JUDGE_RESPONSE_PROMPT_VERSION,
  buildJudgeResponsePrompt,
  getJudgeResponseStableDeveloperPrefix,
} from "./judge-response-prompt";

function manifest(prompt: ReturnType<typeof buildJudgeResponsePrompt>) {
  return JSON.parse(prompt.developerContext.split("\n")[1]) as Record<
    string,
    unknown
  >;
}

describe("judge response prompt", () => {
  it("keeps record injection text inside the untrusted boundary only", () => {
    const request = createJudgeResponseRequestFixture(
      JUDICIAL_INJECTION_CANARY,
    );
    const prompt = buildJudgeResponsePrompt({ mode: "initial", request });
    expect(prompt.promptVersion).toBe(JUDGE_RESPONSE_PROMPT_VERSION);
    expect(prompt.cacheKey).toBe(JUDGE_RESPONSE_PROMPT_CACHE_KEY);
    expect(prompt.developerPrefix).toBe(
      getJudgeResponseStableDeveloperPrefix(),
    );
    expect(prompt.developerPrefix).not.toContain(JUDICIAL_INJECTION_CANARY);
    expect(prompt.developerContext).not.toContain(JUDICIAL_INJECTION_CANARY);
    expect(prompt.untrustedUserContent).toContain(JUDICIAL_INJECTION_CANARY);
    expect(prompt.untrustedUserContent).not.toContain("privateSettlement");
    expect(prompt.untrustedUserContent).not.toContain("strategyMemory");
  });

  it("hash-binds the immutable request, directive, actor, and head", () => {
    const request = createJudgeResponseRequestFixture();
    const prompt = buildJudgeResponsePrompt({ mode: "initial", request });
    expect(manifest(prompt)).toMatchObject({
      mode: "initial",
      attempt: 1,
      callBinding: {
        callId: request.callId,
        decisionId: request.decisionId,
        expectedLastEventId: request.expectedLastEventId,
        actorId: request.actorId,
      },
      directiveBinding: request.directive,
      knowledgeBinding: {
        schemaVersion: "knowledge-view.v2",
        stateVersion: 20,
      },
    });
    expect(manifest(prompt).immutableRequestSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(request), "utf8")
        .digest("hex"),
    );
  });

  it("projects only output fields and safe issue codes into repair", () => {
    const request = createJudgeResponseRequestFixture();
    const validationIssue = JudgeResponseValidationIssueSchema.parse({
      code: "unknown_evidence_citation",
      path: ["speechSegments", 0, "citations", "evidenceIds", 0],
      message: "Sensitive validator detail omitted.",
    });
    const prompt = buildJudgeResponsePrompt({
      mode: "repair",
      request,
      rejectedCandidate: {
        schemaVersion: "role-responder.judge.output.v1",
        speechSegments: [
          {
            text: "A rejected ruling.",
            citations: { evidenceIds: ["evidence_hidden"] },
            rawReasoning: "secret scratchpad",
          },
        ],
        proposedAction: { kind: "rule_on_evidence", ruling: "admitted" },
        ownerId: "owner_leak",
      } as never,
      validationIssues: [validationIssue],
    });
    expect(manifest(prompt)).toMatchObject({
      mode: "repair",
      attempt: 2,
      repair: {
        issueCount: 1,
        issues: [
          {
            code: "unknown_evidence_citation",
            path: ["speechSegments", 0, "citations", "evidenceIds", 0],
          },
        ],
      },
    });
    expect(prompt.developerContext).not.toContain(validationIssue.message);
    expect(prompt.untrustedUserContent).not.toContain("rawReasoning");
    expect(prompt.untrustedUserContent).not.toContain("secret scratchpad");
    expect(prompt.untrustedUserContent).not.toContain("owner_leak");
    expect(prompt.untrustedUserContent).toContain("evidence_hidden");
  });

  it("requires at least one safe issue for repair", () => {
    expect(() =>
      buildJudgeResponsePrompt({
        mode: "repair",
        request: createJudgeResponseRequestFixture(),
        rejectedCandidate: {} as never,
        validationIssues: [],
      }),
    ).toThrow("Judge-response repair requires a validation issue");
  });
});
