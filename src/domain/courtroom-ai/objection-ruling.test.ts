import { describe, expect, it } from "vitest";

import {
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  ObjectionRulingModelOutputSchema,
  type ObjectionRulingModelOutput,
} from "./call-contracts";
import {
  OBJECTION_RULING_REQUEST_SCHEMA_VERSION,
  ObjectionRulingRequestSchema,
  validateObjectionRulingOutput,
  type ObjectionRulingRequest,
} from "./objection-ruling";

function requestFixture(): ObjectionRulingRequest {
  return ObjectionRulingRequestSchema.parse({
    schemaVersion: OBJECTION_RULING_REQUEST_SCHEMA_VERSION,
    callId: "call:objection:ruling:001",
    decisionId: "decision:objection:ruling:001",
    trialId: "trial_objection",
    expectedStateVersion: 12,
    expectedLastEventId: "event_interrupt",
    actorId: "actor_judge",
    objection: {
      objectionId: "objection_001",
      sourceEventId: "event_objection",
      questionId: "question_001",
      objectorActorId: "actor_opposing_counsel",
      ground: "hearsay",
      interruptedResponseId: "response_001",
    },
    question: {
      questionId: "question_001",
      turnId: "turn_question_001",
      eventId: "event_question_001",
      speakerActorId: "actor_user_counsel",
      text: "What did the dispatcher tell you?",
      factIds: ["fact_dispatch"],
      evidenceIds: ["evidence_log"],
    },
    interruption: {
      interruptId: "interrupt_001",
      interruptedResponseId: "response_001",
      sourceEventId: "event_interrupt",
    },
    permittedOutcomes: [
      { ruling: "sustained", remedy: "cancel_response" },
      { ruling: "sustained", remedy: "rephrase" },
      { ruling: "overruled", remedy: "resume_response" },
    ],
    knowledgeView: {
      schemaVersion: "knowledge-view.v2",
      trialId: "trial_objection",
      stateVersion: 12,
      actorId: "actor_judge",
      actorRole: "judge",
      case: {
        caseId: "case_objection",
        caseVersion: 1,
        title: "Objection Fixture",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1",
        trialId: "trial_objection",
        stateVersion: 12,
        facts: [
          {
            factId: "fact_dispatch",
            proposition: "A dispatch occurred at noon.",
            status: "admitted",
            sourceSegmentIds: ["source_dispatch"],
          },
        ],
        evidence: [
          {
            evidenceId: "evidence_log",
            name: "Dispatch log",
            description: "A timestamped dispatch record.",
            status: "admitted",
            sourceSegmentIds: ["source_log"],
          },
        ],
        testimony: [
          {
            testimonyId: "testimony_dispatch",
            witnessId: "witness_dispatcher",
            speakerActorId: "actor_dispatcher",
            text: "I made the dispatch at noon.",
            status: "active",
            factIds: ["fact_dispatch"],
            evidenceIds: ["evidence_log"],
            transcriptEventId: "event_testimony_dispatch",
          },
        ],
        instructions: [],
      },
      rules: {
        profileId: "rules_fixture",
        name: "Fixture Rules",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional educational procedure",
        burdenOfProof: "preponderance",
        permittedObjectionGrounds: ["hearsay", "relevance"],
      },
      proceduralRecord: {
        excludedFactIds: [],
        excludedEvidenceIds: ["evidence_excluded"],
        strickenTestimonyIds: ["testimony_stricken"],
      },
      currentExchange: {
        exchangeId: "turn_question_001",
        speakerActorId: "actor_user_counsel",
        text: "What did the dispatcher tell you?",
        factIds: ["fact_dispatch"],
        evidenceIds: ["evidence_log"],
      },
    },
  });
}

function outputFixture(): ObjectionRulingModelOutput {
  return ObjectionRulingModelOutputSchema.parse({
    schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
    ruling: "sustained",
    remedy: "cancel_response",
    reason: "The question calls for an out-of-court statement.",
    citations: {
      factIds: ["fact_dispatch"],
      evidenceIds: ["evidence_log"],
      testimonyIds: [],
      transcriptTurnIds: ["turn_question_001"],
      sourceSegmentIds: ["source_dispatch"],
      priorStatementIds: [],
      issueIds: [],
      instructionIds: [],
      ruleIds: [],
      settlementOfferIds: [],
    },
    performance: {
      activity: "ruling",
      emotion: "neutral",
      intensity: 0.5,
      gazeTarget: "questioning_counsel",
      gesture: "gavel",
      speakingStyle: "formal",
    },
  });
}

describe("ObjectionRulingRequestSchema", () => {
  it("binds only a judge KnowledgeView to the exact trial, head, and exchange", () => {
    const request = requestFixture();
    expect(request.knowledgeView.actorRole).toBe("judge");
    expect(
      ObjectionRulingRequestSchema.safeParse({
        ...request,
        expectedStateVersion: 11,
      }).success,
    ).toBe(false);
    expect(
      ObjectionRulingRequestSchema.safeParse({
        ...request,
        expectedLastEventId: "event_stale",
      }).success,
    ).toBe(false);
    expect(
      ObjectionRulingRequestSchema.safeParse({
        ...request,
        actorId: "actor_other_judge",
      }).success,
    ).toBe(false);
    expect(
      ObjectionRulingRequestSchema.safeParse({
        ...request,
        knowledgeView: {
          ...request.knowledgeView,
          counsel: { privateSettlement: "PRIVATE_CANARY" },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects grounds and ruling remedies outside the pinned rule context", () => {
    const request = requestFixture();
    expect(
      ObjectionRulingRequestSchema.safeParse({
        ...request,
        objection: { ...request.objection, ground: "privilege" },
      }).success,
    ).toBe(false);
    expect(
      ObjectionRulingRequestSchema.safeParse({
        ...request,
        permittedOutcomes: [{ ruling: "overruled", remedy: "none" }],
      }).success,
    ).toBe(false);
  });
});

describe("validateObjectionRulingOutput", () => {
  it("accepts an exact permitted ruling grounded in the bound question", () => {
    const validation = validateObjectionRulingOutput(
      requestFixture(),
      outputFixture(),
    );
    expect(validation.accepted).toBe(true);
    if (!validation.accepted) return;
    expect(validation.ruling).toMatchObject({
      ruling: "sustained",
      remedy: "cancel_response",
      factIds: ["fact_dispatch"],
      evidenceIds: ["evidence_log"],
      transcriptTurnIds: ["turn_question_001"],
    });
    expect(validation.report).toMatchObject({
      status: "accepted",
      issues: [],
    });
  });

  it("rejects a structurally valid ruling outside the permitted outcomes", () => {
    const request = requestFixture();
    const output = ObjectionRulingModelOutputSchema.parse({
      ...outputFixture(),
      ruling: "overruled",
      remedy: "resume_response",
    });
    const restricted = ObjectionRulingRequestSchema.parse({
      ...request,
      permittedOutcomes: [
        { ruling: "sustained", remedy: "cancel_response" },
      ],
    });
    const validation = validateObjectionRulingOutput(restricted, output);
    expect(validation.accepted).toBe(false);
    expect(validation.report.issues.map((entry) => entry.code)).toContain(
      "outcome_not_permitted",
    );
  });

  it("rejects foreign, unsupported, and missing question citations", () => {
    const output = outputFixture();
    const validation = validateObjectionRulingOutput(requestFixture(), {
      ...output,
      citations: {
        ...output.citations,
        factIds: ["fact_hidden"],
        transcriptTurnIds: ["turn_foreign"],
        settlementOfferIds: ["offer_private"],
      },
    });
    expect(validation.accepted).toBe(false);
    expect(validation.report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "unknown_fact_citation",
        "unknown_transcript_turn_citation",
        "unsupported_citation",
        "question_not_cited",
      ]),
    );
  });

  it("retains the existing remedy and ruling-performance semantic gates", () => {
    const output = outputFixture();
    const validation = validateObjectionRulingOutput(requestFixture(), {
      ...output,
      remedy: "none",
      performance: { ...output.performance, activity: "speaking" },
    });
    expect(validation.accepted).toBe(false);
    expect(validation.report.issues.map((entry) => entry.code)).toContain(
      "semantic_contract_invalid",
    );
  });
});
