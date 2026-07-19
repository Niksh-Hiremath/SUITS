import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ObjectionRulingValidationIssueSchema } from "@/domain/courtroom-ai/objection-ruling";

import {
  JUDICIAL_INJECTION_CANARY,
  createObjectionRulingRequestFixture,
} from "./judicial-response.test-fixtures";
import {
  OBJECTION_RULING_PROMPT_CACHE_KEY,
  OBJECTION_RULING_PROMPT_VERSION,
  buildObjectionRulingPrompt,
  getObjectionRulingStableDeveloperPrefix,
} from "./objection-ruling-prompt";

function manifest(prompt: ReturnType<typeof buildObjectionRulingPrompt>) {
  return JSON.parse(prompt.developerContext.split("\n")[1]) as Record<
    string,
    unknown
  >;
}

describe("objection ruling prompt", () => {
  it("keeps transcript injection text inside the untrusted boundary only", () => {
    const request = createObjectionRulingRequestFixture(
      JUDICIAL_INJECTION_CANARY,
    );
    const prompt = buildObjectionRulingPrompt({ mode: "initial", request });
    expect(prompt.promptVersion).toBe(OBJECTION_RULING_PROMPT_VERSION);
    expect(prompt.cacheKey).toBe(OBJECTION_RULING_PROMPT_CACHE_KEY);
    expect(prompt.developerPrefix).toBe(
      getObjectionRulingStableDeveloperPrefix(),
    );
    expect(prompt.developerPrefix).not.toContain(JUDICIAL_INJECTION_CANARY);
    expect(prompt.developerContext).not.toContain(JUDICIAL_INJECTION_CANARY);
    expect(prompt.untrustedUserContent).toContain(JUDICIAL_INJECTION_CANARY);
    expect(prompt.untrustedUserContent).not.toContain("privateSettlement");
    expect(prompt.untrustedUserContent).not.toContain("strategyMemory");
  });

  it("hash-binds the exact question, objection, interruption, and outcomes", () => {
    const request = createObjectionRulingRequestFixture();
    const prompt = buildObjectionRulingPrompt({ mode: "initial", request });
    expect(manifest(prompt)).toMatchObject({
      mode: "initial",
      attempt: 1,
      callBinding: {
        callId: request.callId,
        decisionId: request.decisionId,
        expectedLastEventId: request.expectedLastEventId,
      },
      objectionBinding: request.objection,
      interruptionBinding: request.interruption,
      permittedOutcomes: request.permittedOutcomes,
      questionBinding: {
        questionId: request.question.questionId,
        turnId: request.question.turnId,
        eventId: request.question.eventId,
      },
    });
    expect(manifest(prompt).immutableRequestSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(request), "utf8")
        .digest("hex"),
    );
    expect(prompt.developerContext).not.toContain(request.question.text);
  });

  it("projects only ruling output fields and safe issue codes for repair", () => {
    const validationIssue = ObjectionRulingValidationIssueSchema.parse({
      code: "unknown_transcript_turn_citation",
      path: ["citations", "transcriptTurnIds", 0],
      message: "Sensitive validator detail omitted.",
    });
    const prompt = buildObjectionRulingPrompt({
      mode: "repair",
      request: createObjectionRulingRequestFixture(),
      rejectedCandidate: {
        schemaVersion: "objection-resolver.ruling.output.v1",
        ruling: "sustained",
        remedy: "cancel_response",
        reason: "Rejected reason.",
        citations: { transcriptTurnIds: ["turn_foreign"] },
        rawReasoning: "secret scratchpad",
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
            code: "unknown_transcript_turn_citation",
            path: ["citations", "transcriptTurnIds", 0],
          },
        ],
      },
    });
    expect(prompt.developerContext).not.toContain(validationIssue.message);
    expect(prompt.untrustedUserContent).not.toContain("rawReasoning");
    expect(prompt.untrustedUserContent).not.toContain("secret scratchpad");
    expect(prompt.untrustedUserContent).not.toContain("owner_leak");
    expect(prompt.untrustedUserContent).toContain("turn_foreign");
  });

  it("requires at least one safe issue for repair", () => {
    expect(() =>
      buildObjectionRulingPrompt({
        mode: "repair",
        request: createObjectionRulingRequestFixture(),
        rejectedCandidate: {} as never,
        validationIssues: [],
      }),
    ).toThrow("Objection-ruling repair requires a validation issue");
  });
});
