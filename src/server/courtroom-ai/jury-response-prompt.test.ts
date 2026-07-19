import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  JURY_DECISION_MANIFEST_SCHEMA_VERSION,
  JuryResponseValidationIssueSchema,
} from "@/domain/courtroom-ai/jury-response";
import {
  JURY_RESPONSE_INJECTION_CANARY,
  createJuryResponseRequestFixture,
} from "@/domain/courtroom-ai/jury-response.test-fixtures";

import {
  JURY_RESPONSE_PROMPT_CACHE_KEY,
  JURY_RESPONSE_PROMPT_VERSION,
  buildJuryResponsePrompt,
  getJuryResponseStableDeveloperPrefix,
} from "./jury-response-prompt";

function manifest(prompt: ReturnType<typeof buildJuryResponsePrompt>) {
  return JSON.parse(prompt.developerContext.split("\n")[1]) as Record<
    string,
    unknown
  >;
}

describe("jury response prompt", () => {
  it("keeps record and issue injection text in the untrusted boundary only", () => {
    const request = createJuryResponseRequestFixture(
      JURY_RESPONSE_INJECTION_CANARY,
      {
        schemaVersion: JURY_DECISION_MANIFEST_SCHEMA_VERSION,
        kind: "issues",
        issues: [
          {
            issueId: "issue_injection",
            title: "Injected issue",
            question: JURY_RESPONSE_INJECTION_CANARY,
            burdenSide: "user",
            standard: "Preponderance",
          },
        ],
      },
    );
    const prompt = buildJuryResponsePrompt({ mode: "initial", request });
    expect(prompt.promptVersion).toBe(JURY_RESPONSE_PROMPT_VERSION);
    expect(prompt.cacheKey).toBe(JURY_RESPONSE_PROMPT_CACHE_KEY);
    expect(prompt.developerPrefix).toBe(
      getJuryResponseStableDeveloperPrefix(),
    );
    expect(prompt.developerPrefix).not.toContain(
      JURY_RESPONSE_INJECTION_CANARY,
    );
    expect(prompt.developerContext).not.toContain(
      JURY_RESPONSE_INJECTION_CANARY,
    );
    expect(prompt.untrustedUserContent).toContain(
      JURY_RESPONSE_INJECTION_CANARY,
    );
    expect(prompt.untrustedUserContent).toContain(
      '"actorRole":"jury"',
    );
  });

  it("hash-binds the immutable head, jury view, and ordered decision manifest", () => {
    const request = createJuryResponseRequestFixture();
    const prompt = buildJuryResponsePrompt({ mode: "initial", request });
    expect(manifest(prompt)).toMatchObject({
      mode: "initial",
      attempt: 1,
      callBinding: {
        callId: request.callId,
        decisionId: request.decisionId,
        trialId: request.trialId,
        expectedStateVersion: request.expectedStateVersion,
        expectedLastEventId: request.expectedLastEventId,
        actorId: request.actorId,
      },
      decisionBinding: {
        kind: "issues",
        issueIds: ["issue_causation"],
        issueCount: 1,
      },
      knowledgeBinding: {
        schemaVersion: "knowledge-view.v2",
        stateVersion: 42,
        publicFactCount: 1,
        publicEvidenceCount: 1,
        publicTestimonyCount: 1,
        instructionIds: [
          "instruction_burden",
          "instruction_record_only",
        ],
      },
    });
    expect(manifest(prompt).immutableRequestSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(request), "utf8")
        .digest("hex"),
    );
    expect(prompt.developerContext).not.toContain(
      request.decisionManifest.kind === "issues"
        ? request.decisionManifest.issues[0]?.question ?? "missing"
        : "missing",
    );
  });

  it("projects only strict jury fields and safe issue codes for repair", () => {
    const request = createJuryResponseRequestFixture();
    const validationIssue = JuryResponseValidationIssueSchema.parse({
      code: "unknown_fact_citation",
      path: ["findings", 0, "citations", "factIds", 0],
      message: "Sensitive validator detail must be omitted.",
    });
    const prompt = buildJuryResponsePrompt({
      mode: "repair",
      request,
      rejectedCandidate: {
        schemaVersion: "role-responder.jury.output.v1",
        deliberationSegments: [
          {
            text: "A public explanation.",
            citations: { factIds: ["fact_hidden"] },
            hiddenScratchpad: "secret chain of thought",
          },
        ],
        findings: [
          {
            conclusion: "An unsupported finding.",
            weight: "strong",
            citations: { factIds: ["fact_hidden"] },
          },
        ],
        ownerId: "owner_leak",
      },
      validationIssues: [validationIssue],
    });
    expect(manifest(prompt)).toMatchObject({
      mode: "repair",
      attempt: 2,
      repair: {
        issueCount: 1,
        issues: [
          {
            code: "unknown_fact_citation",
            path: ["findings", 0, "citations", "factIds", 0],
          },
        ],
      },
    });
    expect(prompt.developerContext).not.toContain(validationIssue.message);
    expect(prompt.untrustedUserContent).not.toContain("hiddenScratchpad");
    expect(prompt.untrustedUserContent).not.toContain("secret chain of thought");
    expect(prompt.untrustedUserContent).not.toContain("owner_leak");
    expect(prompt.untrustedUserContent).toContain("fact_hidden");
  });

  it("requires at least one safe issue for repair", () => {
    expect(() =>
      buildJuryResponsePrompt({
        mode: "repair",
        request: createJuryResponseRequestFixture(),
        rejectedCandidate: {},
        validationIssues: [],
      }),
    ).toThrow("Jury-response repair requires a validation issue");
  });
});
