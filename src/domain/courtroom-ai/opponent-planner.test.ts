import { describe, expect, it } from "vitest";

import {
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  OpponentPlannerModelOutputSchema,
  type CourtroomModelCitationSet,
} from "./call-contracts";
import {
  OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION,
  OpponentPlannerRequestSchema,
  validateOpponentPlannerOutput,
  type OpponentPlannerRequest,
} from "./opponent-planner";

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

function request(): OpponentPlannerRequest {
  return OpponentPlannerRequestSchema.parse({
    schemaVersion: OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION,
    callId: "call:trial_planner:decision_cross:00000000-0000-4000-8000-000000000001",
    decisionId: "decision:cross:request_001",
    trialId: "trial_planner",
    expectedStateVersion: 12,
    expectedLastEventId: "event:end_direct",
    actorId: "actor_opposing_counsel",
    procedure: {
      phase: "case_in_chief",
      trigger: "player_examination_completed",
      activeAppearanceId: "appearance_rina_1",
      activeWitnessId: "witness_rina",
      activeExaminationKind: "cross",
      answeredQuestionCount: 0,
    },
    opportunities: {
      callableWitnessIds: ["witness_theo"],
      questionableWitnessIds: ["witness_rina"],
      presentableEvidenceIds: ["evidence_draft"],
      offerableEvidenceIds: ["evidence_draft"],
      foundationTestimonyIds: ["testimony_foundation"],
      strikeableTestimonyIds: ["testimony_foundation"],
      permittedObjectionGrounds: ["relevance", "hearsay"],
      canObject: false,
      canRequestNegotiation: true,
      canRest: false,
      canClose: false,
    },
    knowledgeView: {
      schemaVersion: "knowledge-view.opponent-planner.v1",
      trialId: "trial_planner",
      stateVersion: 12,
      actorId: "actor_opposing_counsel",
      actorRole: "opposing_counsel",
      case: {
        caseId: "case_planner",
        caseVersion: 1,
        title: "Planner Fixture",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1",
        trialId: "trial_planner",
        stateVersion: 12,
        facts: [
          {
            factId: "fact_timing",
            proposition: "The edit occurred after the complaint.",
            status: "admitted",
            sourceSegmentIds: ["segment_timing"],
          },
        ],
        evidence: [],
        testimony: [
          {
            testimonyId: "testimony_foundation",
            witnessId: "witness_rina",
            speakerActorId: "actor_rina",
            text: "I recognize the draft metadata.",
            status: "active",
            factIds: ["fact_timing"],
            evidenceIds: ["evidence_draft"],
            transcriptEventId: "event_testimony_foundation",
          },
        ],
        instructions: [
          {
            instructionId: "instruction_causation",
            title: "Causation",
            text: "Consider whether the protected activity caused the action.",
          },
        ],
      },
      counsel: {
        partyId: "party_opposing",
        facts: [
          {
            factId: "fact_draft_created",
            proposition: "The first draft predates the complaint.",
            status: "verified",
          },
        ],
        evidence: [
          {
            evidenceId: "evidence_draft",
            name: "Draft metadata",
            description: "Version metadata for the draft.",
            status: "indexed",
          },
        ],
        strategyMemory: ["Separate the first draft from the final edit."],
        privateSettlement: {
          partyId: "party_opposing",
          currency: "USD",
          authority: {
            minimum: 10_000,
            maximum: 50_000,
            reservationValue: 35_000,
            targetValue: 20_000,
          },
          confidentialPriorities: ["Avoid an operational admission."],
          permittedNonMonetaryTerms: ["Neutral reference"],
          offers: [
            {
              offerId: "offer_private",
              proposerPartyId: "party_opposing",
              recipientPartyIds: ["party_user"],
              amount: 20_000,
              nonMonetaryTerms: [],
              status: "open",
            },
          ],
        },
      },
      currentExchange: {
        exchangeId: "turn_end_direct",
        speakerActorId: "actor_user_counsel",
        text: "No further questions.",
        factIds: [],
        evidenceIds: [],
      },
      planning: {
        witnesses: [
          {
            witnessId: "witness_rina",
            name: "Rina Shah",
            kind: "fact",
            role: "Complainant",
            alignedWithCounsel: false,
            callableByCounsel: false,
            permittedKnownFactIds: ["fact_timing"],
            permittedSeenEvidenceIds: ["evidence_draft"],
          },
          {
            witnessId: "witness_theo",
            name: "Theo Morgan",
            kind: "fact",
            role: "Operations manager",
            alignedWithCounsel: true,
            callableByCounsel: true,
            permittedKnownFactIds: ["fact_draft_created"],
            permittedSeenEvidenceIds: ["evidence_draft"],
          },
        ],
        permittedObjectionGrounds: ["relevance", "hearsay"],
      },
    },
  });
}

function validOutput() {
  return OpponentPlannerModelOutputSchema.parse({
    schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
    objectives: ["Separate the early draft from the later edit."],
    witnessPriorityIds: ["witness_rina", "witness_theo"],
    evidencePriorityIds: ["evidence_draft"],
    settlementPosture: "counter",
    privateNotes: ["Use the admitted timing record without overstating it."],
    proposedMoves: [
      {
        kind: "question_witness",
        witnessId: "witness_rina",
        goal: "Confirm that the first draft existed before the complaint.",
        presentedEvidenceIds: ["evidence_draft"],
        rationale: "The active cross can distinguish creation from revision.",
        citations: citations({
          factIds: ["fact_draft_created"],
          evidenceIds: ["evidence_draft"],
          testimonyIds: ["testimony_foundation"],
        }),
      },
    ],
  });
}

describe("opponent planner request boundary", () => {
  it("strictly parses the server-owned request and rejects unknown fields", () => {
    const value = request();
    expect(OpponentPlannerRequestSchema.parse(value)).toEqual(value);
    expect(
      OpponentPlannerRequestSchema.safeParse({ ...value, ownerId: "owner_leak" })
        .success,
    ).toBe(false);
    expect(
      OpponentPlannerRequestSchema.safeParse({
        ...value,
        knowledgeView: {
          ...value.knowledgeView,
          hiddenAuthoringTruth: { facts: ["fact_hidden"] },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a plan grounded in the exact role view and move manifest", () => {
    const validation = validateOpponentPlannerOutput(request(), validOutput());
    expect(validation).toMatchObject({
      accepted: true,
      report: { status: "accepted", issues: [] },
    });
  });

  it("rejects foreign knowledge citations and unavailable targets", () => {
    const output = {
      ...validOutput(),
      witnessPriorityIds: ["witness_hidden"],
      evidencePriorityIds: ["evidence_hidden"],
      proposedMoves: [
        {
          ...validOutput().proposedMoves[0],
          witnessId: "witness_theo",
          presentedEvidenceIds: ["evidence_hidden"],
          citations: citations({
            factIds: ["fact_hidden"],
            evidenceIds: ["evidence_hidden"],
            priorStatementIds: ["statement_hidden"],
            settlementOfferIds: ["offer_other_side"],
          }),
        },
      ],
    };
    const validation = validateOpponentPlannerOutput(request(), output);
    expect(validation.accepted).toBe(false);
    if (validation.accepted) throw new Error("Expected rejection");
    expect(validation.report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "unknown_witness_reference",
        "unknown_evidence_reference",
        "unknown_fact_citation",
        "unknown_evidence_citation",
        "unknown_prior_statement_citation",
        "unknown_settlement_offer_citation",
        "move_not_available",
      ]),
    );
  });

  it("rejects legal moves that the canonical state does not offer", () => {
    const output = {
      ...validOutput(),
      proposedMoves: [
        {
          kind: "object",
          ground: "privilege",
          rationale: "Attempt an unavailable objection.",
          citations: citations(),
        },
        {
          kind: "rest_case",
          rationale: "Attempt to rest during cross.",
          citations: citations(),
        },
      ],
    };
    const validation = validateOpponentPlannerOutput(request(), output);
    expect(validation.accepted).toBe(false);
    if (validation.accepted) throw new Error("Expected rejection");
    expect(validation.report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "move_not_available",
        "objection_ground_not_permitted",
      ]),
    );
  });

  it("keeps strict schema failures distinct for one targeted repair", () => {
    const validation = validateOpponentPlannerOutput(request(), {
      ...validOutput(),
      proposedMoves: [],
      rawReasoning: "must not be retained",
    });
    expect(validation.accepted).toBe(false);
    if (validation.accepted) throw new Error("Expected rejection");
    expect(validation.report.issues.map(({ code }) => code)).toContain(
      "strict_schema_invalid",
    );
  });
});
