import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  CALL_CONTRACT_SEMANTIC_ISSUE_SCHEMA_VERSION,
  COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  COUNSEL_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  COUNSEL_ROLE_RESPONDER_MODEL,
  COURTROOM_FINAL_DEBRIEF_MODEL,
  COURTROOM_INTERACTIVE_MODEL,
  CourtroomModelCitationSetSchema,
  CounselRoleResponseModelOutputSchema,
  DEBRIEF_GENERATOR_MODEL,
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DEBRIEF_GENERATOR_STRUCTURED_OUTPUT_NAME,
  DebriefCitationSetSchema,
  DebriefGeneratorModelOutputSchema,
  JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JUDGE_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  JUDGE_ROLE_RESPONDER_MODEL,
  JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JURY_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  JURY_ROLE_RESPONDER_MODEL,
  JudgeRoleResponseModelOutputSchema,
  JuryRoleResponseModelOutputSchema,
  NEGOTIATION_AGENT_MODEL,
  NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
  NEGOTIATION_AGENT_STRUCTURED_OUTPUT_NAME,
  NegotiationAgentModelOutputSchema,
  OBJECTION_CANDIDATE_OUTPUT_SCHEMA_VERSION,
  OBJECTION_CANDIDATE_STRUCTURED_OUTPUT_NAME,
  OBJECTION_RESOLVER_MODEL,
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  OBJECTION_RULING_STRUCTURED_OUTPUT_NAME,
  OPPONENT_PLANNER_MODEL,
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  OPPONENT_PLANNER_STRUCTURED_OUTPUT_NAME,
  ObjectionCandidateModelOutputSchema,
  ObjectionRulingModelOutputSchema,
  OpponentPlannerModelOutputSchema,
  type CourtroomModelCitationSet,
  type DebriefCitationSet,
  type SemanticPerformance,
  validateCounselRoleResponseSemantics,
  validateDebriefGeneratorSemantics,
  validateJudgeRoleResponseSemantics,
  validateJuryRoleResponseSemantics,
  validateNegotiationAgentSemantics,
  validateObjectionCandidateSemantics,
  validateObjectionRulingSemantics,
  validateOpponentPlannerSemantics,
} from "./call-contracts";

function citations(
  overrides: Partial<CourtroomModelCitationSet> = {},
): CourtroomModelCitationSet {
  return CourtroomModelCitationSetSchema.parse({
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
  });
}

function performance(
  overrides: Partial<SemanticPerformance> = {},
): SemanticPerformance {
  return {
    activity: "speaking",
    emotion: "neutral",
    intensity: 0.4,
    gazeTarget: "judge",
    gesture: "open_palm",
    speakingStyle: "measured",
    ...overrides,
  };
}

function debriefCitations(
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

const opponentPlan = OpponentPlannerModelOutputSchema.parse({
  schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  objectives: ["Establish the document foundation before cross-examination."],
  witnessPriorityIds: ["witness_ops_manager"],
  evidencePriorityIds: ["evidence_dispatch_log"],
  settlementPosture: "explore",
  privateNotes: ["Keep privileged strategy out of the public record."],
  proposedMoves: [
    {
      kind: "offer_evidence",
      evidenceId: "evidence_dispatch_log",
      foundationTestimonyIds: ["testimony_foundation"],
      rationale: "The foundation is now in the active record.",
      citations: citations({
        evidenceIds: ["evidence_dispatch_log"],
        testimonyIds: ["testimony_foundation"],
      }),
    },
  ],
});

const counselResponse = CounselRoleResponseModelOutputSchema.parse({
  schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  speechSegments: [
    {
      text: "The dispatch log is supported by the witness's foundation.",
      citations: citations({
        evidenceIds: ["evidence_dispatch_log"],
        testimonyIds: ["testimony_foundation"],
      }),
    },
  ],
  proposedAction: {
    kind: "offer_evidence",
    evidenceId: "evidence_dispatch_log",
    foundationTestimonyIds: ["testimony_foundation"],
  },
  performance: performance({
    activity: "presenting",
    gazeTarget: "evidence_display",
    gesture: "indicate_evidence",
  }),
});

const judgeResponse = JudgeRoleResponseModelOutputSchema.parse({
  schemaVersion: JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  speechSegments: [
    {
      text: "The dispatch log is admitted after the established foundation.",
      citations: citations({ evidenceIds: ["evidence_dispatch_log"] }),
    },
  ],
  proposedAction: {
    kind: "rule_on_evidence",
    ruling: "admitted",
    reason: "The testimony supplies a sufficient foundation.",
  },
  performance: performance({
    activity: "ruling",
    gesture: "gavel",
    speakingStyle: "formal",
  }),
});

const juryResponse = JuryRoleResponseModelOutputSchema.parse({
  schemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  deliberationSegments: [
    {
      text: "The admitted dispatch log strongly supports the timing issue.",
      citations: citations({
        evidenceIds: ["evidence_dispatch_log"],
      }),
    },
  ],
  findings: [
    {
      conclusion: "The user proved the disputed timing by a preponderance.",
      weight: "strong",
      citations: citations({
        evidenceIds: ["evidence_dispatch_log"],
      }),
    },
  ],
  recommendation: {
    outcome: "user_prevails",
    decision: "Find for the user on the timing issue.",
    confidence: 0.82,
  },
  performance: performance({
    activity: "speaking",
    gazeTarget: "judge",
    speakingStyle: "deliberative",
  }),
});

const objectionCandidate = ObjectionCandidateModelOutputSchema.parse({
  schemaVersion: OBJECTION_CANDIDATE_OUTPUT_SCHEMA_VERSION,
  decision: "object",
  ground: "hearsay",
  confidence: 0.91,
  materiality: "high",
  explanation: "The question asks for an out-of-court statement for its truth.",
  citations: citations({ ruleIds: ["rule_hearsay"] }),
});

const objectionRuling = ObjectionRulingModelOutputSchema.parse({
  schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  ruling: "sustained",
  remedy: "rephrase",
  reason: "The question seeks inadmissible hearsay and must be rephrased.",
  citations: citations({ ruleIds: ["rule_hearsay"] }),
  performance: performance({
    activity: "ruling",
    gesture: "gavel",
    speakingStyle: "formal",
  }),
});

const negotiationDecision = NegotiationAgentModelOutputSchema.parse({
  schemaVersion: NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
  recommendation: "counter",
  utilityBand: "within_authority",
  terms: {
    amount: 55_000,
    currency: "USD",
    nonMonetaryTerms: ["Provide a neutral reference."],
    summary: "Counter at 55,000 USD with a neutral-reference term.",
  },
  decisionSummary: "The counter stays within delegated authority.",
  citations: citations({ settlementOfferIds: ["offer_pending_001"] }),
  performance: performance({ activity: "thinking", gazeTarget: "none" }),
});

const admittedPoint = {
  title: "Strong exhibit foundation",
  assessment: "The witness connected the log to the disputed timing.",
  recommendation: "Use the same compact foundation sequence in future rounds.",
  basis: "admitted_record" as const,
  citations: debriefCitations({
    admittedEvidenceIds: ["evidence_dispatch_log"],
    transcriptTurnIds: ["turn_foundation_question"],
  }),
};

const finalDebrief = DebriefGeneratorModelOutputSchema.parse({
  schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  overallAssessment: {
    text: "The examination was focused and evidence-grounded.",
    basis: "admitted_record",
    citations: debriefCitations({
      admittedEvidenceIds: ["evidence_dispatch_log"],
      transcriptTurnIds: ["turn_foundation_question"],
    }),
  },
  strengths: [admittedPoint],
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
        text: "The admitted dispatch log fixes the critical time in the record.",
        citations: debriefCitations({
          admittedEvidenceIds: ["evidence_dispatch_log"],
        }),
      },
    ],
  },
  limitations: [
    "This coaching is limited to the fictional simulation record and is not legal advice.",
  ],
});

const outputContracts = [
  {
    name: "opponent planner",
    schema: OpponentPlannerModelOutputSchema,
    structuredName: OPPONENT_PLANNER_STRUCTURED_OUTPUT_NAME,
    value: opponentPlan,
  },
  {
    name: "counsel role response",
    schema: CounselRoleResponseModelOutputSchema,
    structuredName: COUNSEL_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
    value: counselResponse,
  },
  {
    name: "judge role response",
    schema: JudgeRoleResponseModelOutputSchema,
    structuredName: JUDGE_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
    value: judgeResponse,
  },
  {
    name: "jury role response",
    schema: JuryRoleResponseModelOutputSchema,
    structuredName: JURY_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
    value: juryResponse,
  },
  {
    name: "objection candidate",
    schema: ObjectionCandidateModelOutputSchema,
    structuredName: OBJECTION_CANDIDATE_STRUCTURED_OUTPUT_NAME,
    value: objectionCandidate,
  },
  {
    name: "objection ruling",
    schema: ObjectionRulingModelOutputSchema,
    structuredName: OBJECTION_RULING_STRUCTURED_OUTPUT_NAME,
    value: objectionRuling,
  },
  {
    name: "negotiation decision",
    schema: NegotiationAgentModelOutputSchema,
    structuredName: NEGOTIATION_AGENT_STRUCTURED_OUTPUT_NAME,
    value: negotiationDecision,
  },
  {
    name: "final debrief",
    schema: DebriefGeneratorModelOutputSchema,
    structuredName: DEBRIEF_GENERATOR_STRUCTURED_OUTPUT_NAME,
    value: finalDebrief,
  },
] satisfies ReadonlyArray<{
  name: string;
  schema: z.ZodType;
  structuredName: string;
  value: unknown;
}>;

describe("remaining courtroom AI call contracts", () => {
  it.each(outputContracts)(
    "converts $name to a strict object-root Structured Output",
    ({ schema, structuredName }) => {
      const format = zodTextFormat(schema, structuredName);
      expect(format).toMatchObject({
        type: "json_schema",
        name: structuredName,
        strict: true,
        schema: { type: "object", additionalProperties: false },
      });
      const serialized = JSON.stringify(format.schema);
      expect(serialized).not.toContain('"actorId"');
      expect(serialized).not.toContain('"actionId"');
      expect(serialized).not.toContain('"eventId"');
      expect(serialized).not.toContain('"hiddenReasoning"');
    },
  );

  it.each(outputContracts)(
    "rejects unknown root identity keys in $name",
    ({ schema, value }) => {
      for (const key of ["actorId", "actionId", "eventId", "ownerId"]) {
        expect(schema.safeParse({ ...(value as object), [key]: "forged_id" }).success).toBe(
          false,
        );
      }
    },
  );

  it("rejects unknown nested citation, proposal, and renderer-control keys", () => {
    expect(
      ObjectionCandidateModelOutputSchema.safeParse({
        ...objectionCandidate,
        citations: {
          ...objectionCandidate.citations,
          excerpts: ["model-selected quote"],
        },
      }).success,
    ).toBe(false);
    expect(
      CounselRoleResponseModelOutputSchema.safeParse({
        ...counselResponse,
        proposedAction: {
          ...counselResponse.proposedAction,
          actionId: "forged_action",
        },
      }).success,
    ).toBe(false);
    expect(
      JudgeRoleResponseModelOutputSchema.safeParse({
        ...judgeResponse,
        performance: {
          ...judgeResponse.performance,
          arbitraryThreeJsProperty: 1,
        },
      }).success,
    ).toBe(false);
  });

  it("keeps every collection and free-text field bounded", () => {
    expect(
      CourtroomModelCitationSetSchema.safeParse({
        ...citations(),
        factIds: Array.from({ length: 65 }, (_, index) => `fact_${index}`),
      }).success,
    ).toBe(false);
    expect(
      CounselRoleResponseModelOutputSchema.safeParse({
        ...counselResponse,
        speechSegments: Array.from({ length: 17 }, () =>
          counselResponse.speechSegments[0],
        ),
      }).success,
    ).toBe(false);
    expect(
      CounselRoleResponseModelOutputSchema.safeParse({
        ...counselResponse,
        speechSegments: [
          {
            ...counselResponse.speechSegments[0],
            text: "x".repeat(801),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("pins Luna for interactive calls and Terra only for final debrief", () => {
    expect(COURTROOM_INTERACTIVE_MODEL).toBe("gpt-5.6-luna");
    expect([
      OPPONENT_PLANNER_MODEL,
      COUNSEL_ROLE_RESPONDER_MODEL,
      JUDGE_ROLE_RESPONDER_MODEL,
      JURY_ROLE_RESPONDER_MODEL,
      OBJECTION_RESOLVER_MODEL,
      NEGOTIATION_AGENT_MODEL,
    ]).toEqual(Array.from({ length: 6 }, () => "gpt-5.6-luna"));
    expect(COURTROOM_FINAL_DEBRIEF_MODEL).toBe("gpt-5.6-terra");
    expect(DEBRIEF_GENERATOR_MODEL).toBe("gpt-5.6-terra");
  });

  it("validates opponent move targets, conflicts, and citation identity", () => {
    expect(validateOpponentPlannerSemantics(opponentPlan)).toEqual([]);
    const invalid = OpponentPlannerModelOutputSchema.parse({
      ...opponentPlan,
      settlementPosture: "avoid",
      proposedMoves: [
        {
          ...opponentPlan.proposedMoves[0],
          citations: citations(),
        },
        {
          kind: "request_negotiation",
          rationale: "Open a private channel.",
          citations: citations(),
        },
        {
          kind: "no_action",
          rationale: "Wait.",
          citations: citations(),
        },
      ],
    });
    expect(validateOpponentPlannerSemantics(invalid).map(({ code }) => code)).toEqual(
      expect.arrayContaining(["target_not_cited", "proposal_conflict"]),
    );
  });

  it("validates counsel action grounding and allowlisted performance", () => {
    expect(validateCounselRoleResponseSemantics(counselResponse)).toEqual([]);
    const invalid = CounselRoleResponseModelOutputSchema.parse({
      ...counselResponse,
      speechSegments: [
        { text: "Objection.", citations: citations() },
      ],
      proposedAction: { kind: "object", ground: "hearsay" },
      performance: performance({ activity: "speaking", gesture: "gavel" }),
    });
    expect(
      validateCounselRoleResponseSemantics(invalid).map(({ code }) => code),
    ).toEqual(expect.arrayContaining(["performance_mismatch"]));
  });

  it("keeps pending-matter identities server-owned and validates ruling grounding", () => {
    expect(validateJudgeRoleResponseSemantics(judgeResponse)).toEqual([]);
    expect(
      JudgeRoleResponseModelOutputSchema.safeParse({
        ...judgeResponse,
        proposedAction: {
          ...judgeResponse.proposedAction,
          evidenceId: "evidence_model_selected",
        },
      }).success,
    ).toBe(false);
    const invalid = JudgeRoleResponseModelOutputSchema.parse({
      ...judgeResponse,
      speechSegments: [
        { text: "The exhibit is admitted.", citations: citations() },
      ],
      performance: performance({ activity: "speaking", gesture: "gavel" }),
    });
    expect(validateJudgeRoleResponseSemantics(invalid).map(({ code }) => code)).toEqual(
      expect.arrayContaining(["citation_required", "performance_mismatch"]),
    );
  });

  it("requires cited jury findings and jury-safe performance semantics", () => {
    expect(validateJuryRoleResponseSemantics(juryResponse)).toEqual([]);
    const invalid = JuryRoleResponseModelOutputSchema.parse({
      ...juryResponse,
      deliberationSegments: [
        { text: "We agree.", citations: citations() },
      ],
      findings: [
        { ...juryResponse.findings[0], citations: citations() },
      ],
      performance: performance({ activity: "ruling", gesture: "gavel" }),
    });
    expect(validateJuryRoleResponseSemantics(invalid).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "citation_required",
        "performance_mismatch",
      ]),
    );
  });

  it("validates objection candidate decisions and context-dependent remedies", () => {
    expect(validateObjectionCandidateSemantics(objectionCandidate)).toEqual([]);
    const invalidCandidate = ObjectionCandidateModelOutputSchema.parse({
      ...objectionCandidate,
      decision: "do_not_object",
    });
    expect(
      validateObjectionCandidateSemantics(invalidCandidate).map(({ code }) => code),
    ).toContain("decision_shape_mismatch");

    expect(
      validateObjectionRulingSemantics(objectionRuling, {
        interruptedResponse: false,
      }),
    ).toEqual([]);
    const invalidRuling = ObjectionRulingModelOutputSchema.parse({
      ...objectionRuling,
      ruling: "overruled",
      remedy: "none",
    });
    expect(
      validateObjectionRulingSemantics(invalidRuling, {
        interruptedResponse: true,
      }).map(({ code }) => code),
    ).toContain("remedy_mismatch");
    expect(
      validateObjectionRulingSemantics(
        ObjectionRulingModelOutputSchema.parse({
          ...invalidRuling,
          remedy: "resume_response",
        }),
        { interruptedResponse: true },
      ),
    ).toEqual([]);
  });

  it("validates negotiation terms, offer references, and authority-neutral shape", () => {
    expect(validateNegotiationAgentSemantics(negotiationDecision)).toEqual([]);
    const invalid = NegotiationAgentModelOutputSchema.parse({
      ...negotiationDecision,
      recommendation: "accept",
      terms: {
        ...negotiationDecision.terms,
        amount: 50_000,
        currency: null,
      },
      citations: citations(),
    });
    expect(validateNegotiationAgentSemantics(invalid).map(({ code }) => code)).toEqual(
      expect.arrayContaining(["terms_mismatch", "citation_required"]),
    );
  });

  it("keeps coaching claims stratum-labelled and improved closings admissible", () => {
    expect(validateDebriefGeneratorSemantics(finalDebrief)).toEqual([]);
    const invalid = DebriefGeneratorModelOutputSchema.parse({
      ...finalDebrief,
      strengths: [
        {
          ...admittedPoint,
          citations: debriefCitations({ hiddenFactIds: ["fact_hidden_truth"] }),
        },
      ],
      weakQuestions: [
        {
          ...admittedPoint,
          title: "Unsupported claim",
          citations: debriefCitations(),
        },
      ],
      improvedClosing: {
        segments: [
          {
            text: "Use hidden truth in the closing.",
            citations: debriefCitations({
              hiddenFactIds: ["fact_hidden_truth"],
            }),
          },
        ],
      },
    });
    const issues = validateDebriefGeneratorSemantics(invalid);
    expect(issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "citation_required",
        "citation_stratum_mismatch",
      ]),
    );
    expect(
      issues.every(
        (entry) =>
          entry.schemaVersion === CALL_CONTRACT_SEMANTIC_ISSUE_SCHEMA_VERSION,
      ),
    ).toBe(true);
  });
});
