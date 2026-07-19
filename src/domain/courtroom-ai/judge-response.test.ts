import { describe, expect, it } from "vitest";

import {
  JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JudgeRoleResponseModelOutputSchema,
  type JudgeRoleResponseModelOutput,
} from "./call-contracts";
import {
  JUDGE_RESPONSE_REQUEST_SCHEMA_VERSION,
  JudgeResponseRequestSchema,
  validateJudgeResponseOutput,
  type JudgeResponseRequest,
} from "./judge-response";

function requestFixture(): JudgeResponseRequest {
  return JudgeResponseRequestSchema.parse({
    schemaVersion: JUDGE_RESPONSE_REQUEST_SCHEMA_VERSION,
    callId: "call:judge:evidence:001",
    decisionId: "decision:judge:evidence:001",
    trialId: "trial_judge",
    expectedStateVersion: 20,
    expectedLastEventId: "event_offer_exhibit",
    actorId: "actor_judge",
    directive: {
      kind: "rule_on_evidence",
      triggerEventId: "event_offer_exhibit",
      evidenceId: "evidence_pending",
      permittedRulings: ["excluded"],
    },
    knowledgeView: {
      schemaVersion: "knowledge-view.v2",
      trialId: "trial_judge",
      stateVersion: 20,
      actorId: "actor_judge",
      actorRole: "judge",
      case: {
        caseId: "case_judge",
        caseVersion: 1,
        title: "Judge Fixture",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1",
        trialId: "trial_judge",
        stateVersion: 20,
        facts: [
          {
            factId: "fact_public",
            proposition: "The public event occurred.",
            status: "admitted",
            sourceSegmentIds: ["source_public_fact"],
          },
        ],
        evidence: [
          {
            evidenceId: "evidence_admitted",
            name: "Admitted exhibit",
            description: "Already admitted evidence.",
            status: "admitted",
            sourceSegmentIds: ["source_public_evidence"],
          },
        ],
        testimony: [
          {
            testimonyId: "testimony_active",
            witnessId: "witness_public",
            speakerActorId: "actor_public_witness",
            text: "I observed the public event.",
            status: "active",
            factIds: ["fact_public"],
            evidenceIds: ["evidence_admitted"],
            transcriptEventId: "event_public_testimony",
          },
        ],
        instructions: [
          {
            instructionId: "instruction_burden",
            title: "Burden",
            text: "Apply the preponderance standard.",
          },
        ],
      },
      rules: {
        profileId: "rules_fixture",
        name: "Fixture Rules",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional educational procedure",
        burdenOfProof: "preponderance",
        permittedObjectionGrounds: ["relevance", "hearsay"],
      },
      proceduralRecord: {
        excludedFactIds: ["fact_excluded"],
        excludedEvidenceIds: ["evidence_excluded"],
        strickenTestimonyIds: ["testimony_stricken"],
      },
      currentExchange: {
        exchangeId: "turn_offer_exhibit",
        speakerActorId: "actor_user_counsel",
        text: "We offer the pending exhibit.",
        factIds: [],
        evidenceIds: ["evidence_pending"],
      },
    },
  });
}

function outputFixture(): JudgeRoleResponseModelOutput {
  return JudgeRoleResponseModelOutputSchema.parse({
    schemaVersion: JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    speechSegments: [
      {
        text: "The exhibit is excluded for lack of foundation.",
        citations: {
          factIds: [],
          evidenceIds: ["evidence_pending"],
          testimonyIds: [],
          transcriptTurnIds: [],
          sourceSegmentIds: [],
          priorStatementIds: [],
          issueIds: [],
          instructionIds: [],
          ruleIds: [],
          settlementOfferIds: [],
        },
      },
    ],
    proposedAction: {
      kind: "rule_on_evidence",
      ruling: "excluded",
      reason: "No admissible foundation was identified.",
    },
    performance: {
      activity: "ruling",
      emotion: "neutral",
      intensity: 0.45,
      gazeTarget: "questioning_counsel",
      gesture: "gavel",
      speakingStyle: "formal",
    },
  });
}

describe("JudgeResponseRequestSchema", () => {
  it("rejects stale or non-judge role bindings and private role data", () => {
    const request = requestFixture();
    expect(
      JudgeResponseRequestSchema.safeParse({
        ...request,
        expectedStateVersion: 19,
      }).success,
    ).toBe(false);
    expect(
      JudgeResponseRequestSchema.safeParse({
        ...request,
        expectedLastEventId: "event_stale",
      }).success,
    ).toBe(false);
    expect(
      JudgeResponseRequestSchema.safeParse({
        ...request,
        actorId: "actor_opposing_counsel",
      }).success,
    ).toBe(false);
    expect(
      JudgeResponseRequestSchema.safeParse({
        ...request,
        knowledgeView: {
          ...request.knowledgeView,
          counsel: {
            strategyMemory: ["PRIVATE_STRATEGY_CANARY"],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("binds jury instruction options to instructions visible in the judge view", () => {
    const request = requestFixture();
    const directive = {
      kind: "instruct_jury" as const,
      triggerEventId: request.expectedLastEventId,
      permittedInstructionIds: ["instruction_hidden"],
    };
    expect(
      JudgeResponseRequestSchema.safeParse({ ...request, directive }).success,
    ).toBe(false);
  });
});

describe("validateJudgeResponseOutput", () => {
  it("accepts the exact grounded ruling selected by the server directive", () => {
    const validation = validateJudgeResponseOutput(
      requestFixture(),
      outputFixture(),
    );
    expect(validation.accepted).toBe(true);
    if (!validation.accepted) return;
    expect(validation.response).toMatchObject({
      text: "The exhibit is excluded for lack of foundation.",
      action: { kind: "rule_on_evidence", ruling: "excluded" },
      evidenceIds: ["evidence_pending"],
    });
  });

  it("rejects a different action or a ruling outside the bound options", () => {
    const wrongAction = validateJudgeResponseOutput(requestFixture(), {
      ...outputFixture(),
      proposedAction: { kind: "maintain_order" },
      performance: { ...outputFixture().performance, activity: "speaking" },
    });
    expect(wrongAction.accepted).toBe(false);
    expect(wrongAction.report.issues.map((entry) => entry.code)).toContain(
      "directive_mismatch",
    );

    const wrongRuling = validateJudgeResponseOutput(requestFixture(), {
      ...outputFixture(),
      proposedAction: {
        kind: "rule_on_evidence",
        ruling: "admitted",
        reason: "Admitted.",
      },
    });
    expect(wrongRuling.accepted).toBe(false);
    expect(wrongRuling.report.issues.map((entry) => entry.code)).toContain(
      "ruling_not_permitted",
    );
  });

  it("requires the exact target and rejects hidden or private citation IDs", () => {
    const output = outputFixture();
    const validation = validateJudgeResponseOutput(requestFixture(), {
      ...output,
      speechSegments: [
        {
          ...output.speechSegments[0],
          citations: {
            ...output.speechSegments[0]?.citations,
            evidenceIds: ["evidence_hidden"],
            settlementOfferIds: ["offer_private"],
          },
        },
      ],
    });
    expect(validation.accepted).toBe(false);
    expect(validation.report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "unknown_evidence_citation",
        "unsupported_citation",
        "target_not_cited",
      ]),
    );
  });

  it("keeps the existing judge performance and strict-output gates", () => {
    const output = outputFixture();
    const semantic = validateJudgeResponseOutput(requestFixture(), {
      ...output,
      performance: { ...output.performance, activity: "speaking" },
    });
    expect(semantic.accepted).toBe(false);
    expect(semantic.report.issues.map((entry) => entry.code)).toContain(
      "semantic_contract_invalid",
    );

    const strict = validateJudgeResponseOutput(requestFixture(), {
      ...output,
      hiddenReasoning: "PRIVATE_CHAIN_OF_THOUGHT",
    });
    expect(strict.accepted).toBe(false);
    expect(strict.report.issues.map((entry) => entry.code)).toContain(
      "strict_schema_invalid",
    );
  });
});
