import { describe, expect, it } from "vitest";

import { JuryRoleResponseModelOutputSchema } from "./call-contracts";
import {
  JURY_DECISION_MANIFEST_SCHEMA_VERSION,
  JuryResponseRequestSchema,
  validateJuryResponseOutput,
  type JuryResponseValidationIssue,
} from "./jury-response";
import {
  createJuryResponseOutputFixture,
  createJuryResponseRequestFixture,
} from "./jury-response.test-fixtures";

function issueCodes(
  result: ReturnType<typeof validateJuryResponseOutput>,
): JuryResponseValidationIssue["code"][] {
  return result.report.issues.map(({ code }) => code);
}

describe("JuryResponseRequestSchema", () => {
  it("accepts only a V2 jury view bound to the request and public-record head", () => {
    const request = createJuryResponseRequestFixture();
    expect(JuryResponseRequestSchema.parse(request)).toEqual(request);

    for (const invalid of [
      {
        ...request,
        trialId: "trial_other",
      },
      {
        ...request,
        expectedStateVersion: request.expectedStateVersion + 1,
      },
      {
        ...request,
        actorId: "actor_other_jury",
      },
      {
        ...request,
        knowledgeView: {
          ...request.knowledgeView,
          schemaVersion: "knowledge-view.v1",
        },
      },
      {
        ...request,
        knowledgeView: {
          ...request.knowledgeView,
          actorRole: "judge",
        },
      },
    ]) {
      expect(JuryResponseRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("requires an instruction manifest to exactly match canonical record order", () => {
    const exact = createJuryResponseRequestFixture(undefined, {
      schemaVersion: JURY_DECISION_MANIFEST_SCHEMA_VERSION,
      kind: "instructions",
      instructionIds: ["instruction_burden", "instruction_record_only"],
    });
    expect(JuryResponseRequestSchema.parse(exact)).toEqual(exact);

    expect(
      JuryResponseRequestSchema.safeParse({
        ...exact,
        decisionManifest: {
          ...exact.decisionManifest,
          instructionIds: ["instruction_record_only", "instruction_burden"],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate issue identities and unknown request fields", () => {
    const request = createJuryResponseRequestFixture();
    expect(request.decisionManifest.kind).toBe("issues");
    if (request.decisionManifest.kind !== "issues") return;
    const repeatedIssue = request.decisionManifest.issues[0];
    expect(
      JuryResponseRequestSchema.safeParse({
        ...request,
        decisionManifest: {
          ...request.decisionManifest,
          issues: [repeatedIssue, repeatedIssue],
        },
      }).success,
    ).toBe(false);
    expect(
      JuryResponseRequestSchema.safeParse({
        ...request,
        ownerId: "owner_must_not_cross_boundary",
      }).success,
    ).toBe(false);
  });
});

describe("validateJuryResponseOutput", () => {
  it("accepts only jury-considerable support and derives cited verdict support", () => {
    const request = createJuryResponseRequestFixture();
    const output = createJuryResponseOutputFixture();
    const result = validateJuryResponseOutput(request, output);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.response).toEqual({
      deliberationText:
        "The admitted delivery record and testimony support the timing.",
      findings: [
        {
          issueId: "issue_causation",
          conclusion: "The user carried the burden on causation.",
          weight: "strong",
          citations: {
            factIds: ["fact_admitted"],
            evidenceIds: ["evidence_admitted"],
            testimonyIds: ["testimony_active"],
            instructionIds: ["instruction_burden"],
          },
        },
      ],
      recommendation: {
        outcome: "user_prevails",
        decision:
          "The admitted record more likely than not supports the claim.",
        confidence: 0.78,
        citations: {
          factIds: ["fact_admitted"],
          evidenceIds: ["evidence_admitted"],
          testimonyIds: ["testimony_active"],
          instructionIds: ["instruction_burden"],
        },
      },
      performance: output.performance,
    });
    expect(result.report).toEqual({
      schemaVersion: "role-responder.jury.validation.v1",
      status: "accepted",
      issues: [],
    });
  });

  it.each([
    ["factIds", "fact_hidden", "unknown_fact_citation"],
    ["evidenceIds", "evidence_excluded", "unknown_evidence_citation"],
    ["testimonyIds", "testimony_stricken", "unknown_testimony_citation"],
    [
      "instructionIds",
      "instruction_unissued",
      "unknown_instruction_citation",
    ],
  ] as const)(
    "rejects an out-of-scope %s citation",
    (field, identifier, expectedCode) => {
      const output = createJuryResponseOutputFixture();
      const invalid = JuryRoleResponseModelOutputSchema.parse({
        ...output,
        deliberationSegments: [
          {
            ...output.deliberationSegments[0],
            citations: {
              ...output.deliberationSegments[0]?.citations,
              [field]: [identifier],
            },
          },
        ],
      });
      const result = validateJuryResponseOutput(
        createJuryResponseRequestFixture(),
        invalid,
      );
      expect(result.accepted).toBe(false);
      expect(issueCodes(result)).toContain(expectedCode);
    },
  );

  it.each([
    "transcriptTurnIds",
    "sourceSegmentIds",
    "priorStatementIds",
    "issueIds",
    "ruleIds",
    "settlementOfferIds",
  ] as const)("rejects unsupported %s citations", (field) => {
    const output = createJuryResponseOutputFixture();
    const invalid = JuryRoleResponseModelOutputSchema.parse({
      ...output,
      findings: [
        {
          ...output.findings[0],
          citations: {
            ...output.findings[0]?.citations,
            [field]: ["unsupported_reference"],
          },
        },
      ],
    });
    const result = validateJuryResponseOutput(
      createJuryResponseRequestFixture(),
      invalid,
    );
    expect(result.accepted).toBe(false);
    expect(issueCodes(result)).toContain("unsupported_citation");
  });

  it("requires every finding to apply an instruction", () => {
    const output = createJuryResponseOutputFixture();
    const invalid = JuryRoleResponseModelOutputSchema.parse({
      ...output,
      findings: output.findings.map((finding) => ({
        ...finding,
        citations: { ...finding.citations, instructionIds: [] },
      })),
    });
    const result = validateJuryResponseOutput(
      createJuryResponseRequestFixture(),
      invalid,
    );
    expect(result.accepted).toBe(false);
    expect(issueCodes(result)).toContain("instruction_citation_required");
  });

  it("applies every exact instruction and binds findings to ordered issues", () => {
    const instructionRequest = createJuryResponseRequestFixture(undefined, {
      schemaVersion: JURY_DECISION_MANIFEST_SCHEMA_VERSION,
      kind: "instructions",
      instructionIds: ["instruction_burden", "instruction_record_only"],
    });
    const output = createJuryResponseOutputFixture();
    const missingInstruction = validateJuryResponseOutput(
      instructionRequest,
      output,
    );
    expect(issueCodes(missingInstruction)).toContain(
      "manifest_instruction_not_applied",
    );

    const applied = JuryRoleResponseModelOutputSchema.parse({
      ...output,
      findings: output.findings.map((finding) => ({
        ...finding,
        citations: {
          ...finding.citations,
          instructionIds: [
            "instruction_burden",
            "instruction_record_only",
          ],
        },
      })),
    });
    expect(validateJuryResponseOutput(instructionRequest, applied).accepted).toBe(
      true,
    );

    const issueRequest = createJuryResponseRequestFixture(undefined, {
      schemaVersion: JURY_DECISION_MANIFEST_SCHEMA_VERSION,
      kind: "issues",
      issues: [
        {
          issueId: "issue_causation",
          title: "Causation",
          question: "Was causation proven?",
          burdenSide: "user",
          standard: "Preponderance",
        },
        {
          issueId: "issue_damages",
          title: "Damages",
          question: "Were damages proven?",
          burdenSide: "user",
          standard: "Preponderance",
        },
      ],
    });
    const wrongCount = validateJuryResponseOutput(issueRequest, output);
    expect(issueCodes(wrongCount)).toContain("issue_finding_count_mismatch");
  });

  it("returns safe strict-schema issues for a malformed model candidate", () => {
    const result = validateJuryResponseOutput(
      createJuryResponseRequestFixture(),
      {
        ...createJuryResponseOutputFixture(),
        hiddenReasoning: "must never be accepted",
      },
    );
    expect(result.accepted).toBe(false);
    expect(issueCodes(result)).toContain("strict_schema_invalid");
    expect(JSON.stringify(result.report)).not.toContain("hiddenReasoning");
  });
});
