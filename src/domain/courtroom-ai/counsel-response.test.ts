import { describe, expect, it } from "vitest";

import {
  COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION,
  CounselResponseRequestSchema,
  validateCounselResponseOutput,
  type CounselResponseRequest,
} from "./counsel-response";
import {
  COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  CounselRoleResponseModelOutputSchema,
  type CourtroomModelCitationSet,
} from "./call-contracts";

function citations(
  overrides: Partial<CourtroomModelCitationSet> = {},
): CourtroomModelCitationSet {
  return {
    factIds: [],
    evidenceIds: [],
    testimonyIds: [],
    transcriptTurnIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
    issueIds: [],
    instructionIds: [],
    ruleIds: [],
    settlementOfferIds: [],
    ...overrides,
  };
}

function request(
  directive: CounselResponseRequest["directive"] = {
    kind: "question_witness",
    witnessId: "witness_rina",
    goal: "Confirm the first draft's timing.",
    presentedEvidenceIds: ["evidence_draft"],
    permittedFactIds: ["fact_draft"],
    permittedEvidenceIds: ["evidence_draft"],
    permittedTestimonyIds: ["testimony_foundation"],
  },
): CounselResponseRequest {
  return CounselResponseRequestSchema.parse({
    schemaVersion: COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION,
    callId: "call:trial_counsel:decision_question:00000000-0000-4000-8000-000000000001",
    decisionId: "decision:counsel:question",
    trialId: "trial_counsel",
    expectedStateVersion: 14,
    expectedLastEventId: "event_strategy",
    actorId: "actor_opposing_counsel",
    appearance: {
      appearanceId: "appearance_rina",
      witnessId: "witness_rina",
      examinationKind: "cross",
      answeredQuestionCount: 0,
    },
    planBinding: {
      plannerCallId: "call:planner:one",
      plannerOutputHash: "a".repeat(64),
      strategyId: "strategy_opposing",
      strategyRevision: 1,
    },
    directive,
    knowledgeView: {
      schemaVersion: "knowledge-view.opponent-counsel-public.v1",
      trialId: "trial_counsel",
      stateVersion: 14,
      actorId: "actor_opposing_counsel",
      actorRole: "opposing_counsel",
      case: {
        caseId: "case_counsel",
        caseVersion: 1,
        title: "Counsel Fixture",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1",
        trialId: "trial_counsel",
        stateVersion: 14,
        facts: [],
        evidence: [],
        testimony: [
          {
            testimonyId: "testimony_foundation",
            witnessId: "witness_rina",
            speakerActorId: "actor_rina",
            text: "I recognize the metadata.",
            status: "active",
            factIds: [],
            evidenceIds: ["evidence_draft"],
            transcriptEventId: "event_foundation",
          },
        ],
        instructions: [],
      },
      counsel: {
        partyId: "party_opposing",
        facts: [
          {
            factId: "fact_draft",
            proposition: "The first draft predates the complaint.",
            status: "verified",
          },
        ],
        evidence: [
          {
            evidenceId: "evidence_draft",
            name: "Draft metadata",
            description: "Version metadata.",
            status: "indexed",
          },
        ],
        strategyMemory: [],
        privateSettlement: null,
      },
      currentExchange: null,
    },
  });
}

function questionOutput() {
  return CounselRoleResponseModelOutputSchema.parse({
    schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    speechSegments: [
      {
        text: "The first draft existed before the complaint, correct?",
        citations: citations({
          factIds: ["fact_draft"],
          evidenceIds: ["evidence_draft"],
          testimonyIds: ["testimony_foundation"],
        }),
      },
    ],
    proposedAction: {
      kind: "ask_question",
      presentedEvidenceIds: ["evidence_draft"],
    },
    performance: {
      activity: "speaking",
      emotion: "confident",
      intensity: 0.5,
      gazeTarget: "witness",
      gesture: "open_palm",
      speakingStyle: "firm",
    },
  });
}

describe("counsel response boundary", () => {
  it("accepts and materializes the exact grounded question directive", () => {
    const validation = validateCounselResponseOutput(request(), questionOutput());
    expect(validation.accepted).toBe(true);
    if (!validation.accepted) throw new Error("Expected acceptance");
    expect(validation.response).toMatchObject({
      text: "The first draft existed before the complaint, correct?",
      factIds: ["fact_draft"],
      evidenceIds: ["evidence_draft"],
      testimonyIds: ["testimony_foundation"],
      action: {
        kind: "ask_question",
        presentedEvidenceIds: ["evidence_draft"],
      },
    });
  });

  it("strictly rejects browser/private fields in the server request", () => {
    const value = request();
    expect(
      CounselResponseRequestSchema.safeParse({ ...value, ownerId: "owner_leak" })
        .success,
    ).toBe(false);
    expect(
      CounselResponseRequestSchema.safeParse({
        ...value,
        knowledgeView: {
          ...value.knowledgeView,
          counsel: {
            ...value.knowledgeView.counsel,
            privateSettlement: { reservationValue: 50_000 },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects foreign citations, private citation classes, and action drift", () => {
    const output = {
      ...questionOutput(),
      speechSegments: [
        {
          text: "A different fact is true.",
          citations: citations({
            factIds: ["fact_hidden"],
            settlementOfferIds: ["offer_private"],
          }),
        },
      ],
      proposedAction: { kind: "release_witness" },
    };
    const validation = validateCounselResponseOutput(request(), output);
    expect(validation.accepted).toBe(false);
    if (validation.accepted) throw new Error("Expected rejection");
    expect(validation.report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "unknown_fact_citation",
        "unsupported_citation",
        "directive_mismatch",
        "question_shape_invalid",
      ]),
    );
  });

  it("rejects ungrounded question segments and evidence drift", () => {
    const output = {
      ...questionOutput(),
      speechSegments: [
        {
          text: "What happened next?",
          citations: citations(),
        },
      ],
      proposedAction: {
        kind: "ask_question",
        presentedEvidenceIds: [],
      },
    };
    const validation = validateCounselResponseOutput(request(), output);
    expect(validation.accepted).toBe(false);
    if (validation.accepted) throw new Error("Expected rejection");
    expect(validation.report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["ungrounded_question", "directive_mismatch"]),
    );
  });

  it("accepts a bounded examination-ending response only for its exact disposition", () => {
    const endRequest = request({
      kind: "end_examination",
      disposition: "waived",
    });
    const output = CounselRoleResponseModelOutputSchema.parse({
      schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      speechSegments: [
        { text: "No questions, Your Honor.", citations: citations() },
      ],
      proposedAction: {
        kind: "end_examination",
        disposition: "waived",
      },
      performance: {
        activity: "speaking",
        emotion: "neutral",
        intensity: 0.2,
        gazeTarget: "judge",
        gesture: "small_nod",
        speakingStyle: "formal",
      },
    });
    const validation = validateCounselResponseOutput(endRequest, output);
    expect(validation.accepted).toBe(true);
  });
});
