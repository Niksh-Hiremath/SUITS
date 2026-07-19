import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CounselResponseRequestSchema,
  CounselResponseValidationIssueSchema,
} from "@/domain/courtroom-ai";

import {
  COUNSEL_RESPONSE_INJECTION_CANARY,
  createCounselResponseRequestFixture,
} from "./counsel-response.test-fixtures";
import {
  COUNSEL_RESPONSE_PROMPT_CACHE_KEY,
  COUNSEL_RESPONSE_PROMPT_VERSION,
  buildCounselResponsePrompt,
  getCounselResponseStableDeveloperPrefix,
} from "./counsel-response-prompt";

function manifest(prompt: ReturnType<typeof buildCounselResponsePrompt>) {
  return JSON.parse(prompt.developerContext.split("\n")[1]) as Record<
    string,
    unknown
  >;
}

describe("public counsel response prompt", () => {
  it("keeps injection text in the untrusted boundary only", () => {
    const request = createCounselResponseRequestFixture(
      COUNSEL_RESPONSE_INJECTION_CANARY,
    );
    const prompt = buildCounselResponsePrompt({ mode: "initial", request });
    expect(prompt.promptVersion).toBe(COUNSEL_RESPONSE_PROMPT_VERSION);
    expect(prompt.cacheKey).toBe(COUNSEL_RESPONSE_PROMPT_CACHE_KEY);
    expect(prompt.developerPrefix).toBe(
      getCounselResponseStableDeveloperPrefix(),
    );
    expect(prompt.developerPrefix).not.toContain(
      COUNSEL_RESPONSE_INJECTION_CANARY,
    );
    expect(prompt.developerContext).not.toContain(
      COUNSEL_RESPONSE_INJECTION_CANARY,
    );
    expect(prompt.untrustedUserContent).toContain(
      COUNSEL_RESPONSE_INJECTION_CANARY,
    );
    expect(prompt.untrustedUserContent).not.toContain("reservationValue");
    expect(prompt.untrustedUserContent).toContain('"strategyMemory":[]');
    expect(prompt.untrustedUserContent).toContain('"privateSettlement":null');
  });

  it("hash-binds the request, plan, appearance, and directive without goal text", () => {
    const request = createCounselResponseRequestFixture();
    const prompt = buildCounselResponsePrompt({ mode: "initial", request });
    const parsed = manifest(prompt);
    expect(parsed).toMatchObject({
      mode: "initial",
      attempt: 1,
      callBinding: {
        callId: request.callId,
        decisionId: request.decisionId,
      },
      planBinding: request.planBinding,
      appearanceBinding: request.appearance,
      knowledgeBinding: {
        strategyMemoryCount: 0,
        privateSettlementPresent: false,
      },
    });
    expect(parsed.immutableRequestSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(request), "utf8")
        .digest("hex"),
    );
    expect(request.directive.kind).toBe("question_witness");
    if (request.directive.kind === "question_witness") {
      expect(prompt.developerContext).not.toContain(request.directive.goal);
    }
  });

  it("projects only strict output fields and safe issue codes for repair", () => {
    const request = createCounselResponseRequestFixture();
    const validationIssue = CounselResponseValidationIssueSchema.parse({
      code: "unknown_fact_citation",
      path: ["speechSegments", 0, "citations", "factIds", 0],
      message: "Sensitive detail omitted from repair.",
    });
    const prompt = buildCounselResponsePrompt({
      mode: "repair",
      request,
      rejectedCandidate: {
        schemaVersion: "role-responder.counsel.output.v1",
        speechSegments: [
          {
            text: "A proposed question?",
            citations: { factIds: ["fact_hidden"] },
            rawReasoning: "secret scratchpad",
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
            path: ["speechSegments", 0, "citations", "factIds", 0],
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

  it("binds an admitted-record closing without a witness appearance", () => {
    const base = createCounselResponseRequestFixture();
    const request = CounselResponseRequestSchema.parse({
      ...base,
      appearance: null,
      directive: {
        kind: "give_closing",
        permittedFactIds: [],
        permittedEvidenceIds: [],
        permittedTestimonyIds: ["testimony_foundation"],
      },
    });
    const prompt = buildCounselResponsePrompt({ mode: "initial", request });

    expect(manifest(prompt)).toMatchObject({
      appearanceBinding: null,
      directiveBinding: {
        kind: "give_closing",
        permittedFactCount: 0,
        permittedEvidenceCount: 0,
        permittedTestimonyCount: 1,
      },
    });
    expect(prompt.untrustedUserContent).toContain('"kind":"give_closing"');
    expect(prompt.developerPrefix).toContain("admitted public record");
  });

  it("hash-binds an untrusted strike basis without promoting its text", () => {
    const base = createCounselResponseRequestFixture();
    const basis = `${COUNSEL_RESPONSE_INJECTION_CANARY} The answer lacks foundation.`;
    const request = CounselResponseRequestSchema.parse({
      ...base,
      directive: {
        kind: "move_to_strike",
        testimonyIds: ["testimony_foundation"],
        basis,
        permittedFactIds: [],
        permittedEvidenceIds: [],
        permittedTestimonyIds: ["testimony_foundation"],
      },
    });
    const prompt = buildCounselResponsePrompt({ mode: "initial", request });

    expect(manifest(prompt)).toMatchObject({
      directiveBinding: {
        kind: "move_to_strike",
        testimonyTargetCount: 1,
        basisHash: createHash("sha256")
          .update(JSON.stringify(basis), "utf8")
          .digest("hex"),
        permittedFactCount: 0,
        permittedEvidenceCount: 0,
        permittedTestimonyCount: 1,
      },
    });
    expect(prompt.developerContext).not.toContain(basis);
    expect(prompt.untrustedUserContent).toContain(basis);
    expect(prompt.developerPrefix).toContain("exact testimonyIds");
  });

  it("requires a safe issue for repair", () => {
    expect(() =>
      buildCounselResponsePrompt({
        mode: "repair",
        request: createCounselResponseRequestFixture(),
        rejectedCandidate: {},
        validationIssues: [],
      }),
    ).toThrow("Counsel-response repair requires a validation issue");
  });
});
