import { describe, expect, it } from "vitest";

import {
  PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION,
  PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION,
  PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE,
  detectPartialObjectionCandidate,
  type PartialObjectionDetectorInput,
} from "./partial-detector";

const allGrounds = [
  "relevance",
  "hearsay",
  "leading",
  "speculation",
  "foundation",
  "asked_and_answered",
  "argumentative",
  "compound",
  "privilege",
] as const;

function input(
  overrides: Partial<PartialObjectionDetectorInput> = {},
): PartialObjectionDetectorInput {
  return {
    schemaVersion: PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION,
    partialText: "Did you review the report and did you sign the report?",
    sttConfidence: 0.98,
    speechKind: "question",
    examinationLeg: "direct",
    permittedGrounds: allGrounds,
    recentQuestionTexts: [],
    evidenceFoundationMissing: false,
    topicRelation: "unknown",
    privilegeContext: "unknown",
    thirdPartyStatementPurpose: "unknown",
    thirdPartyStatementException: "unknown",
    argumentativeContext: "unknown",
    personalKnowledgeContext: "unknown",
    ...overrides,
  };
}

describe("detectPartialObjectionCandidate", () => {
  it("emits a versioned candidate without deciding an objection or ruling", () => {
    const candidate = detectPartialObjectionCandidate(input());

    expect(candidate).toMatchObject({
      schemaVersion: PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION,
      ground: "compound",
      signal: "repeated_auxiliary_question",
      sttConfidence: 0.98,
    });
    expect(candidate).not.toHaveProperty("ruling");
    expect(candidate).not.toHaveProperty("remedy");
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it("requires a finite high-confidence STT score", () => {
    for (const confidence of [
      null,
      0,
      PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE - 0.001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.01,
    ]) {
      expect(
        detectPartialObjectionCandidate(input({ sttConfidence: confidence })),
      ).toBeNull();
    }
    expect(
      detectPartialObjectionCandidate(
        input({ sttConfidence: PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE }),
      )?.ground,
    ).toBe("compound");
  });

  it("rejects testimony, argument, fragments, blank text, and oversized text", () => {
    expect(
      detectPartialObjectionCandidate(input({ speechKind: "testimony" })),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(input({ speechKind: "argument" })),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(input({ partialText: "And did you?" })),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(input({ partialText: "   " })),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(
        input({ partialText: `${"word ".repeat(500)}?` }),
      ),
    ).toBeNull();
  });

  it("never emits a detected ground that the pinned rules do not permit", () => {
    expect(
      detectPartialObjectionCandidate(input({ permittedGrounds: ["hearsay"] })),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(input({ permittedGrounds: ["compound"] }))
        ?.ground,
    ).toBe("compound");
  });

  it("detects leading tags only on direct or redirect", () => {
    const partialText = "You agree that the email arrived on Tuesday, correct?";
    expect(
      detectPartialObjectionCandidate(
        input({ partialText, examinationLeg: "direct" }),
      )?.ground,
    ).toBe("leading");
    expect(
      detectPartialObjectionCandidate(
        input({ partialText, examinationLeg: "redirect" }),
      )?.ground,
    ).toBe("leading");
    expect(
      detectPartialObjectionCandidate(
        input({ partialText, examinationLeg: "cross" }),
      ),
    ).toBeNull();
  });

  it("uses exact normalized recent-question equality for asked-and-answered", () => {
    const partialText = "When did you first receive the signed report?";
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText,
          recentQuestionTexts: [
            "  WHEN did you first receive the signed report!  ",
          ],
        }),
      )?.ground,
    ).toBe("asked_and_answered");
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText,
          recentQuestionTexts: ["When did you receive a different report?"],
        }),
      ),
    ).toBeNull();
  });

  it.each([
    [
      "privilege",
      "What did your attorney tell you about the settlement meeting?",
      { privilegeContext: "confidential_legal_communication" },
    ],
    [
      "argumentative",
      "You fabricated the entire timeline for this hearing, didn't you?",
      { argumentativeContext: "badgering" },
    ],
    [
      "speculation",
      "Could you guess what she intended when she sent that message?",
      {},
    ],
    [
      "hearsay",
      "What did Maya Rao tell you about the missing report?",
      {
        thirdPartyStatementPurpose: "truth_of_assertion",
        thirdPartyStatementException: "none_identified",
      },
    ],
    [
      "relevance",
      "Where did you spend your unrelated holiday last summer?",
      { topicRelation: "outside_scope" },
    ],
  ] as const)(
    "detects the conservative %s signal",
    (ground, partialText, overrides) => {
      expect(
        detectPartialObjectionCandidate(input({ partialText, ...overrides }))
          ?.ground,
      ).toBe(ground);
    },
  );

  it("does not interrupt ambiguous privilege, hearsay, or impeachment questions", () => {
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText:
            "What did your attorney tell you during the public press conference?",
          privilegeContext: "public_or_waived",
        }),
      ),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText: "What did Maya Rao tell you before you left the office?",
          thirdPartyStatementPurpose: "non_truth",
        }),
      ),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText: "What did Maya Rao tell you about the missing report?",
          thirdPartyStatementPurpose: "truth_of_assertion",
          thirdPartyStatementException: "opposing_party_admission",
        }),
      ),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText:
            "You fabricated the timeline in your signed statement, didn't you?",
          examinationLeg: "cross",
          argumentativeContext: "ordinary_impeachment",
        }),
      ),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText:
            "Why do you think she appeared frightened when you saw her?",
          personalKnowledgeContext: "perception_grounded",
        }),
      ),
    ).toBeNull();
  });

  it("fails closed for malformed collection inputs", () => {
    expect(
      detectPartialObjectionCandidate(
        input({ recentQuestionTexts: undefined as never }),
      ),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(
        input({ permittedGrounds: undefined as never }),
      ),
    ).toBeNull();
  });

  it("requires an explicit missing-foundation context and does not flag foundation questions", () => {
    const contentsQuestion =
      "According to this report, what amount was actually approved?";
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText: contentsQuestion,
          evidenceFoundationMissing: true,
        }),
      )?.ground,
    ).toBe("foundation");
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText: contentsQuestion,
          evidenceFoundationMissing: false,
        }),
      ),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(
        input({
          partialText:
            "Do you recognize this report that you prepared yesterday?",
          evidenceFoundationMissing: true,
        }),
      ),
    ).toBeNull();
  });

  it("does not infer relevance without an explicit outside-scope context", () => {
    const partialText =
      "Where did you spend your unrelated holiday last summer?";
    expect(
      detectPartialObjectionCandidate(
        input({ partialText, topicRelation: "unknown" }),
      ),
    ).toBeNull();
    expect(
      detectPartialObjectionCandidate(
        input({ partialText, topicRelation: "within_scope" }),
      ),
    ).toBeNull();
  });
});
