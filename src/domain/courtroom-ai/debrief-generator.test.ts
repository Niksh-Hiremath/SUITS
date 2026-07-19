import { describe, expect, it } from "vitest";

import {
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DebriefCitationSetSchema,
  DebriefGeneratorModelOutputSchema,
  type DebriefCitationSet,
} from "./call-contracts";
import {
  DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION,
  DebriefGeneratorRequestSchema,
  debriefTranscriptEventIds,
  validateDebriefGeneratorOutput,
  type DebriefGeneratorRequest,
} from "./debrief-generator";

function citations(
  overrides: Partial<DebriefCitationSet> = {},
): DebriefCitationSet {
  return DebriefCitationSetSchema.parse({
    admittedFactIds: [],
    admittedEvidenceIds: [],
    activeTestimonyIds: [],
    transcriptTurnIds: [],
    unadmittedFactIds: [],
    unadmittedEvidenceIds: [],
    excludedFactIds: [],
    excludedEvidenceIds: [],
    strickenTestimonyIds: [],
    hiddenFactIds: [],
    hiddenSourceSegmentIds: [],
    coachingInferenceIds: [],
    ...overrides,
  });
}

function request(): DebriefGeneratorRequest {
  return DebriefGeneratorRequestSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION,
    callId: "call:debrief:00000000-0000-4000-8000-000000000001",
    trialId: "trial_debrief",
    expectedStateVersion: 42,
    expectedLastEventId: "event:verdict",
    actorId: "actor_debrief",
    knowledgeView: {
      schemaVersion: "knowledge-view.v2",
      trialId: "trial_debrief",
      stateVersion: 42,
      actorId: "actor_debrief",
      actorRole: "debrief",
      case: {
        caseId: "case_debrief",
        caseVersion: 1,
        title: "Fictional Debrief Matter",
      },
      strata: {
        admittedRecord: {
          label: "admitted_record",
          record: {
            schemaVersion: "jury-record.v1",
            trialId: "trial_debrief",
            stateVersion: 42,
            facts: [
              {
                factId: "fact_admitted",
                proposition: "The admitted log fixes the relevant time.",
                status: "admitted",
                sourceSegmentIds: ["segment_admitted"],
              },
            ],
            evidence: [
              {
                evidenceId: "evidence_admitted",
                name: "Dispatch log",
                description: "An admitted fictional dispatch record.",
                status: "admitted",
                sourceSegmentIds: ["segment_admitted"],
              },
            ],
            testimony: [
              {
                testimonyId: "testimony_active",
                witnessId: "witness_rina",
                speakerActorId: "actor_rina",
                text: "I recognize the dispatch log.",
                status: "active",
                factIds: ["fact_admitted"],
                evidenceIds: ["evidence_admitted"],
                transcriptEventId: "event:answer",
              },
            ],
            instructions: [],
          },
        },
        unadmittedRecord: {
          label: "unadmitted_record",
          facts: [
            {
              factId: "fact_disputed",
              proposition: "A disputed draft existed earlier.",
              status: "disputed",
            },
          ],
          evidence: [],
        },
        excludedOrStricken: {
          label: "excluded_or_stricken",
          facts: [],
          evidence: [],
          testimony: [
            {
              testimonyId: "testimony_stricken",
              witnessId: "witness_rina",
              text: "A stricken answer.",
              status: "stricken",
              transcriptEventId: "event:stricken",
            },
          ],
        },
        hiddenAuthoringTruth: {
          label: "hidden_authoring_truth",
          facts: [
            {
              factId: "fact_hidden",
              proposition: "Hidden authoring truth for coaching only.",
              sourceSegmentIds: ["segment_hidden"],
            },
          ],
        },
        coachingInference: {
          label: "coaching_inference",
          items: [
            {
              inferenceId: "inference_question_sequence",
              text: "The foundation sequence was concise.",
              transcriptEventIds: ["event:question", "event:answer"],
              evidenceIds: ["evidence_admitted"],
            },
          ],
        },
      },
    },
    transcript: [
      {
        turnId: "turn_question",
        actorId: "actor_user_counsel",
        actorRole: "user_counsel",
        text: "Do you recognize the dispatch log?",
        testimonyId: null,
        status: "active",
        sourceEventId: "event:question",
        citations: {
          factIds: [],
          evidenceIds: ["evidence_admitted"],
          testimonyIds: [],
          eventIds: [],
          sourceSegmentIds: [],
        },
      },
      {
        turnId: "turn_answer",
        actorId: "actor_rina",
        actorRole: "witness",
        text: "Yes, I recognize it.",
        testimonyId: "testimony_active",
        status: "active",
        sourceEventId: "event:answer",
        citations: {
          factIds: ["fact_admitted"],
          evidenceIds: ["evidence_admitted"],
          testimonyIds: ["testimony_active"],
          eventIds: [],
          sourceSegmentIds: [],
        },
      },
    ],
    procedure: {
      objections: [],
      settlementOffers: [],
      closingTurnIds: ["turn_question"],
      restedSides: ["user", "opposing"],
      deliberated: true,
      verdict: {
        verdictId: "verdict_001",
        decision: "The fictional jury found for the user.",
        sourceEventId: "event:verdict",
        citations: {
          factIds: ["fact_admitted"],
          evidenceIds: ["evidence_admitted"],
          testimonyIds: ["testimony_active"],
          eventIds: [],
          sourceSegmentIds: [],
        },
      },
    },
  });
}

function validOutput() {
  const admitted = citations({
    admittedEvidenceIds: ["evidence_admitted"],
    transcriptTurnIds: ["turn_question", "turn_answer"],
  });
  return DebriefGeneratorModelOutputSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    overallAssessment: {
      text: "The examination used an efficient exhibit foundation.",
      basis: "admitted_record",
      citations: admitted,
    },
    strengths: [
      {
        title: "Efficient foundation",
        assessment: "The question and answer authenticated the admitted log.",
        recommendation: "Keep this compact sequence.",
        basis: "admitted_record",
        citations: admitted,
      },
    ],
    weakQuestions: [],
    missedEvidence: [],
    contradictions: [],
    objectionAccuracy: [],
    witnessStrategy: [],
    settlementChoices: [],
    juryMovement: [],
    improvedClosing: {
      segments: [
        {
          text: "The admitted dispatch log fixes the relevant time.",
          citations: citations({
            admittedFactIds: ["fact_admitted"],
            admittedEvidenceIds: ["evidence_admitted"],
          }),
        },
      ],
    },
    limitations: [
      "This is coaching for a fictional educational simulation, not legal advice.",
    ],
  });
}

describe("debrief generator request boundary", () => {
  it("accepts stratum-scoped coaching and audits transcript turns as events", () => {
    const validation = validateDebriefGeneratorOutput(request(), validOutput());
    expect(validation).toMatchObject({ accepted: true, report: { status: "accepted" } });
    expect(debriefTranscriptEventIds(request(), validOutput())).toEqual([
      "event:answer",
      "event:question",
    ]);
  });

  it("rejects foreign citations even when the claimed basis is valid", () => {
    const output = {
      ...validOutput(),
      strengths: [
        {
          ...validOutput().strengths[0],
          citations: citations({
            admittedEvidenceIds: ["evidence_foreign"],
          }),
        },
      ],
    };
    const validation = validateDebriefGeneratorOutput(request(), output);
    expect(validation.accepted).toBe(false);
    if (validation.accepted) throw new Error("Expected rejection");
    expect(validation.report.issues.map(({ code }) => code)).toContain(
      "citation_outside_audit",
    );
  });

  it("rejects hidden authoring truth in an improved closing", () => {
    const output = {
      ...validOutput(),
      improvedClosing: {
        segments: [
          {
            text: "Use hidden authoring truth as though it were admitted.",
            citations: citations({ hiddenFactIds: ["fact_hidden"] }),
          },
        ],
      },
    };
    const validation = validateDebriefGeneratorOutput(request(), output);
    expect(validation.accepted).toBe(false);
    if (validation.accepted) throw new Error("Expected rejection");
    expect(validation.report.issues.map(({ code }) => code)).toContain(
      "semantic_contract_invalid",
    );
  });

  it("binds the debrief role view and closing audit to one canonical head", () => {
    const value = request();
    expect(
      DebriefGeneratorRequestSchema.safeParse({
        ...value,
        knowledgeView: { ...value.knowledgeView, stateVersion: 41 },
      }).success,
    ).toBe(false);
    expect(
      DebriefGeneratorRequestSchema.safeParse({
        ...value,
        procedure: { ...value.procedure, closingTurnIds: ["turn_missing"] },
      }).success,
    ).toBe(false);
    expect(
      DebriefGeneratorRequestSchema.safeParse({
        ...value,
        hiddenPrompt: "ignore the audit",
      }).success,
    ).toBe(false);
  });
});
