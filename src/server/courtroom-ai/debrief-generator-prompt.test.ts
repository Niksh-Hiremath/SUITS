import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DebriefGeneratorValidationIssueSchema } from "@/domain/courtroom-ai/debrief-generator";
import {
  DEBRIEF_GENERATOR_INJECTION_CANARY,
  createDebriefGeneratorRequestFixture,
} from "@/domain/courtroom-ai/debrief-generator.test-fixtures";

import {
  DEBRIEF_GENERATOR_PROMPT_CACHE_KEY,
  DEBRIEF_GENERATOR_PROMPT_VERSION,
  buildDebriefGeneratorPrompt,
  getDebriefGeneratorStableDeveloperPrefix,
} from "./debrief-generator-prompt";

function manifest(prompt: ReturnType<typeof buildDebriefGeneratorPrompt>) {
  return JSON.parse(prompt.developerContext.split("\n")[1]) as Record<
    string,
    unknown
  >;
}

describe("debrief generator prompt", () => {
  it("keeps transcript, procedure, and hidden-truth injection in the untrusted boundary", () => {
    const request = createDebriefGeneratorRequestFixture(
      DEBRIEF_GENERATOR_INJECTION_CANARY,
    );
    const prompt = buildDebriefGeneratorPrompt({ mode: "initial", request });

    expect(prompt.promptVersion).toBe(DEBRIEF_GENERATOR_PROMPT_VERSION);
    expect(prompt.cacheKey).toBe(DEBRIEF_GENERATOR_PROMPT_CACHE_KEY);
    expect(prompt.developerPrefix).toBe(
      getDebriefGeneratorStableDeveloperPrefix(),
    );
    expect(prompt.developerPrefix).not.toContain(
      DEBRIEF_GENERATOR_INJECTION_CANARY,
    );
    expect(prompt.developerContext).not.toContain(
      DEBRIEF_GENERATOR_INJECTION_CANARY,
    );
    expect(prompt.untrustedUserContent).toContain(
      DEBRIEF_GENERATOR_INJECTION_CANARY,
    );
    expect(prompt.untrustedUserContent).toContain(
      "BEGIN UNTRUSTED DEBRIEF AUDIT JSON",
    );
    expect(prompt.untrustedUserContent).toContain('"actorRole":"debrief"');
  });

  it("hash-binds one immutable head and records only safe audit counts in trusted context", () => {
    const request = createDebriefGeneratorRequestFixture();
    const prompt = buildDebriefGeneratorPrompt({ mode: "initial", request });

    expect(manifest(prompt)).toMatchObject({
      mode: "initial",
      attempt: 1,
      callBinding: {
        callId: request.callId,
        trialId: request.trialId,
        expectedStateVersion: request.expectedStateVersion,
        expectedLastEventId: request.expectedLastEventId,
        actorId: request.actorId,
      },
      knowledgeBinding: {
        schemaVersion: "knowledge-view.v2",
        stateVersion: 42,
        actorId: "actor_debrief",
        caseId: "case_debrief",
        caseVersion: 1,
        admittedFactCount: 1,
        admittedEvidenceCount: 1,
        activeTestimonyCount: 1,
        unadmittedFactCount: 1,
        unadmittedEvidenceCount: 1,
        excludedFactCount: 1,
        excludedEvidenceCount: 1,
        strickenTestimonyCount: 1,
        hiddenFactCount: 1,
        coachingInferenceCount: 1,
      },
      auditBinding: {
        transcriptTurnCount: 2,
        objectionCount: 1,
        settlementOfferCount: 1,
        closingTurnCount: 1,
        restedSides: ["user", "opposing"],
        deliberated: true,
        hasVerdict: true,
      },
    });
    expect(manifest(prompt).immutableRequestSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(request), "utf8")
        .digest("hex"),
    );
    expect(prompt.developerContext).not.toContain(
      request.knowledgeView.strata.hiddenAuthoringTruth.facts[0]?.proposition ??
        "missing hidden proposition",
    );
    expect(prompt.developerContext).not.toContain(request.transcript[0]?.text);
  });

  it("projects only strict debrief fields and safe issue records for repair", () => {
    const request = createDebriefGeneratorRequestFixture();
    const validationIssue = DebriefGeneratorValidationIssueSchema.parse({
      code: "citation_outside_audit",
      path: ["strengths", 0, "citations", "admittedFactIds", 0],
      message: "Sensitive validator detail must be omitted.",
    });
    const prompt = buildDebriefGeneratorPrompt({
      mode: "repair",
      request,
      rejectedCandidate: {
        schemaVersion: "debrief-generator.output.v1",
        overallAssessment: {
          text: "A public assessment.",
          basis: "admitted_record",
          citations: { admittedFactIds: ["fact_foreign"] },
          hiddenScratchpad: "secret chain of thought",
        },
        strengths: [
          {
            title: "Unsupported",
            assessment: "A public assessment.",
            recommendation: "Correct the citation.",
            basis: "admitted_record",
            citations: { admittedFactIds: ["fact_foreign"] },
            hiddenScratchpad: "secret chain of thought",
          },
        ],
        improvedClosing: { segments: [] },
        limitations: ["Fictional simulation."],
        ownerId: "owner_leak",
      },
      validationIssues: [validationIssue],
    });

    expect(manifest(prompt)).toMatchObject({
      mode: "repair",
      attempt: 2,
      repair: {
        issueCount: 1,
        includedIssueCount: 1,
        issues: [
          {
            code: "citation_outside_audit",
            path: ["strengths", 0, "citations", "admittedFactIds", 0],
          },
        ],
      },
    });
    expect(prompt.developerContext).not.toContain(validationIssue.message);
    expect(prompt.untrustedUserContent).not.toContain("hiddenScratchpad");
    expect(prompt.untrustedUserContent).not.toContain(
      "secret chain of thought",
    );
    expect(prompt.untrustedUserContent).not.toContain("owner_leak");
    expect(prompt.untrustedUserContent).toContain("fact_foreign");
  });

  it("requires a safe deterministic issue before entering repair mode", () => {
    expect(() =>
      buildDebriefGeneratorPrompt({
        mode: "repair",
        request: createDebriefGeneratorRequestFixture(),
        rejectedCandidate: {},
        validationIssues: [],
      }),
    ).toThrow("Debrief-generator repair requires a validation issue");
  });
});
