import { describe, expect, it, vi } from "vitest";

import {
  DebriefGeneratorRequestSchema,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
  WitnessAnswerRequestSchema,
} from "@/domain/courtroom-ai";
import {
  createDebriefGeneratorOutputFixture,
  createDebriefGeneratorRequestFixture,
} from "@/domain/courtroom-ai/debrief-generator.test-fixtures";
import {
  createJuryResponseOutputFixture,
  createJuryResponseRequestFixture,
} from "@/domain/courtroom-ai/jury-response.test-fixtures";
import {
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V2,
  HearingCommandPreparationSchema,
  HearingCounselResponsePrecommitSchema,
  HearingDebriefGeneratorPrecommitSchema,
  HearingJudgeResponsePrecommitSchema,
  HearingJuryResponsePrecommitSchema,
  HearingNegotiationPrecommitSchema,
  HearingObjectionRulingPrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingPlayerCommandSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  type HearingCommandPreparation,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";
import { ScriptedCourtroomModelProvider } from "@/server/courtroom-ai";
import {
  createCounselQuestionOutputFixture,
  createCounselResponseRequestFixture,
} from "@/server/courtroom-ai/counsel-response.test-fixtures";
import {
  createOpponentPlannerOutputFixture,
  createOpponentPlannerRequestFixture,
} from "@/server/courtroom-ai/opponent-planner.test-fixtures";
import {
  createJudgeResponseOutputFixture,
  createJudgeResponseRequestFixture,
  createObjectionRulingOutputFixture,
  createObjectionRulingRequestFixture,
} from "@/server/courtroom-ai/judicial-response.test-fixtures";
import {
  createNegotiationAgentOutputFixture,
  createNegotiationAgentRequestFixture,
} from "@/server/courtroom-ai/negotiation-agent.test-fixtures";

import {
  CourtroomCommandOrchestrationError,
  orchestrateCourtroomCommand,
  orchestratePreparedCourtroomCommand,
  orchestratePreparedCourtroomCommandResult,
  type CourtroomCommandDurableService,
} from "./courtroom-command";

const TRIAL_ID = `trial_${"c".repeat(32)}`;

function command() {
  return HearingPlayerCommandSchema.parse({
    schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
    requestId: "11111111-1111-4111-8111-111111111111",
    requestedAt: "2026-07-19T07:00:00.000Z",
    expectedStateVersion: 9,
    expectedLastEventId: "event_before_finish",
    intent: {
      type: "finish_witness",
      witnessId: "witness_rina",
      examinationKind: "direct",
    },
  });
}

function completedView(): HearingRuntimeViewV1 {
  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V2,
    case: {
      caseId: "case_courtroom_loop",
      version: 1,
      title: "Courtroom Loop Fixture",
      summary: "A fictional educational hearing.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction_fixture",
        name: "Fixture Court",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional procedure",
        burdenOfProof: "preponderance",
      },
      issues: [],
    },
    trial: {
      trialId: TRIAL_ID,
      phase: "case_in_chief",
      status: "active",
      version: 18,
      sequence: 18,
      lastEventId: "event_answer_opponent_question",
      userSide: "user",
    },
    activeAppearance: null,
    activeQuestion: null,
    capabilities: {
      canAskQuestion: false,
      canFinishExamination: false,
      canFinishTrial: true,
      canObject: false,
      canContinueResponse: false,
      canProposeSettlement: false,
      counterableSettlementOfferIds: [],
      acceptableSettlementOfferIds: [],
      rejectableSettlementOfferIds: [],
      withdrawableSettlementOfferIds: [],
    },
    witnesses: [],
    player: {
      actorId: "actor_user_counsel",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party_user",
      facts: [],
      evidence: [],
      settlement: null,
    },
    transcript: [],
    permittedObjectionGrounds: [],
  });
}

function completedPreparation(): HearingCommandPreparation {
  return HearingCommandPreparationSchema.parse({
    schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
    status: "completed",
    view: completedView(),
  });
}

function modelPreparation(
  request: ReturnType<
    | typeof createOpponentPlannerRequestFixture
    | typeof createCounselResponseRequestFixture
    | typeof createJudgeResponseRequestFixture
    | typeof createObjectionRulingRequestFixture
    | typeof createNegotiationAgentRequestFixture
    | typeof createJuryResponseRequestFixture
    | typeof createDebriefGeneratorRequestFixture
    | typeof witnessRequest
  >,
): HearingCommandPreparation {
  return HearingCommandPreparationSchema.parse({
    schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
    status: "model_required",
    request,
  });
}

function witnessRequest() {
  return WitnessAnswerRequestSchema.parse({
    schemaVersion: WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
    callId: "call_witness_loop",
    trialId: TRIAL_ID,
    responseId: "response_witness_loop",
    expectedStateVersion: 17,
    expectedLastEventId: "event_request_witness_loop",
    actorId: "actor_witness_rina",
    witnessId: "witness_rina",
    question: {
      questionId: "question_witness_loop",
      appearanceId: "appearance_witness_loop",
      turnId: "turn_question_witness_loop",
      eventId: "event_question_witness_loop",
      examinationKind: "cross",
      text: "Do you know when the first draft was created?",
      presentedEvidenceIds: [],
    },
    knowledgeView: {
      schemaVersion: "knowledge-view.v2",
      trialId: TRIAL_ID,
      stateVersion: 17,
      actorId: "actor_witness_rina",
      actorRole: "witness",
      case: {
        caseId: "case_courtroom_loop",
        caseVersion: 1,
        title: "Courtroom Loop Fixture",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1",
        trialId: TRIAL_ID,
        stateVersion: 17,
        facts: [],
        evidence: [],
        testimony: [],
        instructions: [],
      },
      witness: {
        witnessId: "witness_rina",
        name: "Rina Shah",
        role: "Fact witness",
        emotionalState: "neutral",
        facts: [],
        admittedSeenEvidence: [],
        priorStatements: [],
        allowedTopics: ["personal knowledge"],
        forbiddenTopics: ["other witnesses' private knowledge"],
      },
      presentedEvidence: [],
      currentExchange: {
        exchangeId: "turn_question_witness_loop",
        speakerActorId: "actor_opposing_counsel",
        text: "Do you know when the first draft was created?",
        factIds: [],
        evidenceIds: [],
      },
    },
  });
}

function witnessBoundaryOutput() {
  return {
    schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    disposition: "insufficient_knowledge" as const,
    performance: {
      emotion: "neutral" as const,
      intensity: 0.2,
      delivery: "measured" as const,
      gesture: "none" as const,
      gazeTarget: "questioning_counsel" as const,
    },
    segments: [],
  };
}

describe("orchestrateCourtroomCommand", () => {
  it("privately dispatches every final-trial model task until completion", async () => {
    const plannerPreparation = modelPreparation(
      createOpponentPlannerRequestFixture(),
    );
    const counselPreparation = modelPreparation(
      createCounselResponseRequestFixture(),
    );
    const witnessPreparation = modelPreparation(witnessRequest());
    const objectionRequest = createObjectionRulingRequestFixture();
    const objectionPreparation = modelPreparation(objectionRequest);
    const negotiationPreparation = modelPreparation(
      createNegotiationAgentRequestFixture(),
    );
    const juryPreparation = modelPreparation(createJuryResponseRequestFixture());
    const debriefRequest = createDebriefGeneratorRequestFixture();
    const debriefPreparation = modelPreparation(
      DebriefGeneratorRequestSchema.parse({
        ...debriefRequest,
        transcript: [
          ...debriefRequest.transcript,
          {
            turnId: "turn_uncited",
            actorId: "actor_system",
            actorRole: "system",
            text: "The court recessed before deliberations.",
            testimonyId: null,
            status: "active",
            sourceEventId: "event:uncited",
            citations: {
              factIds: [],
              evidenceIds: [],
              testimonyIds: [],
              eventIds: [],
              sourceSegmentIds: [],
            },
          },
        ],
      }),
    );
    const commitOpponentPlan = vi.fn(async (precommit) => {
      expect(HearingOpponentPlanPrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      return counselPreparation;
    });
    const commitCounselResponse = vi.fn(async (precommit) => {
      expect(HearingCounselResponsePrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      return objectionPreparation;
    });
    const commitObjectionRuling = vi.fn(async (precommit) => {
      expect(HearingObjectionRulingPrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      expect(precommit).toMatchObject({
        trialId: objectionRequest.trialId,
        callId: objectionRequest.callId,
        decisionId: objectionRequest.decisionId,
        expectedStateVersion: objectionRequest.expectedStateVersion,
        expectedLastEventId: objectionRequest.expectedLastEventId,
        objectionEventId: objectionRequest.objection.sourceEventId,
        responseId: objectionRequest.interruption?.interruptedResponseId,
        questionEventBinding: {
          turnId: objectionRequest.question.turnId,
          sourceEventId: objectionRequest.question.eventId,
        },
      });
      return witnessPreparation;
    });
    const commitWitness = vi.fn(async (precommit) => {
      expect(HearingWitnessGenerationPrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      return negotiationPreparation;
    });
    const commitNegotiationDecision = vi.fn(async (precommit) => {
      expect(HearingNegotiationPrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      return juryPreparation;
    });
    const commitJuryResponse = vi.fn(async (precommit) => {
      expect(HearingJuryResponsePrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      return debriefPreparation;
    });
    const commitDebrief = vi.fn(async (precommit) => {
      expect(HearingDebriefGeneratorPrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      expect(precommit.transcriptEventBindings).toEqual([
        { turnId: "turn_answer", sourceEventId: "event:answer" },
        { turnId: "turn_question", sourceEventId: "event:question" },
      ]);
      return completedPreparation();
    });
    const durableService: CourtroomCommandDurableService = {
      prepare: vi.fn(async () => plannerPreparation),
      commitOpponentPlan,
      commitCounselResponse,
      commitJudgeResponse: vi.fn(),
      commitObjectionRuling,
      commitWitness,
      commitNegotiationDecision,
      commitJuryResponse,
      commitDebrief,
      recordTerminalTrace: vi.fn(async () => undefined),
    };
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: createOpponentPlannerOutputFixture() },
        { type: "output", output: createCounselQuestionOutputFixture() },
        { type: "output", output: createObjectionRulingOutputFixture() },
        { type: "output", output: witnessBoundaryOutput() },
        { type: "output", output: createNegotiationAgentOutputFixture() },
        { type: "output", output: createJuryResponseOutputFixture() },
        { type: "output", output: createDebriefGeneratorOutputFixture() },
      ],
      { repeatLastStep: false },
    );

    await expect(
      orchestrateCourtroomCommand({
        command: command(),
        provider,
        durableService,
      }),
    ).resolves.toEqual(completedView());

    expect(provider.requests.map(({ callClass, task }) => ({ callClass, task })))
      .toEqual([
        { callClass: "opponent_planner", task: "plan_opponent" },
        { callClass: "role_responder", task: "counsel_response" },
        { callClass: "objection_resolver", task: "resolve_objection" },
        { callClass: "role_responder", task: "witness_answer" },
        { callClass: "negotiation_agent", task: "evaluate_settlement" },
        { callClass: "role_responder", task: "jury_deliberation" },
        { callClass: "debrief_generator", task: "generate_debrief" },
      ]);
    expect(commitOpponentPlan).toHaveBeenCalledTimes(1);
    expect(commitCounselResponse).toHaveBeenCalledTimes(1);
    expect(commitObjectionRuling).toHaveBeenCalledTimes(1);
    expect(commitWitness).toHaveBeenCalledTimes(1);
    expect(commitNegotiationDecision).toHaveBeenCalledTimes(1);
    expect(commitJuryResponse).toHaveBeenCalledTimes(1);
    expect(commitDebrief).toHaveBeenCalledTimes(1);
  });

  it("resumes an already committed objection preparation without preparing a player command", async () => {
    const objectionRequest = createObjectionRulingRequestFixture();
    const prepare = vi.fn<CourtroomCommandDurableService["prepare"]>();
    const commitObjectionRuling = vi.fn(async (precommit) => {
      expect(HearingObjectionRulingPrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      expect(precommit).toMatchObject({
        trialId: objectionRequest.trialId,
        callId: objectionRequest.callId,
        decisionId: objectionRequest.decisionId,
        objectionEventId: objectionRequest.objection.sourceEventId,
        responseId: objectionRequest.interruption?.interruptedResponseId,
      });
      return completedPreparation();
    });
    const durableService: CourtroomCommandDurableService = {
      prepare,
      commitOpponentPlan: vi.fn(),
      commitCounselResponse: vi.fn(),
      commitJudgeResponse: vi.fn(),
      commitObjectionRuling,
      commitWitness: vi.fn(),
      commitNegotiationDecision: vi.fn(),
      commitJuryResponse: vi.fn(),
      commitDebrief: vi.fn(),
      recordTerminalTrace: vi.fn(async () => undefined),
    };
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createObjectionRulingOutputFixture() }],
      { repeatLastStep: false },
    );

    await expect(
      orchestratePreparedCourtroomCommandResult({
        preparation: modelPreparation(objectionRequest),
        provider,
        durableService,
      }),
    ).resolves.toEqual({
      view: completedView(),
      objectionRulings: [
        {
          objectionEventId: objectionRequest.objection.sourceEventId,
          responseId: objectionRequest.interruption?.interruptedResponseId,
          ruling: createObjectionRulingOutputFixture().ruling,
          remedy: createObjectionRulingOutputFixture().remedy,
        },
      ],
    });

    expect(prepare).not.toHaveBeenCalled();
    expect(commitObjectionRuling).toHaveBeenCalledTimes(1);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "objection_resolver",
      task: "resolve_objection",
    });
  });

  it("runs a generic judge response and commits its strict precommit", async () => {
    const request = createJudgeResponseRequestFixture();
    const prepare = vi.fn<CourtroomCommandDurableService["prepare"]>();
    const commitJudgeResponse = vi.fn(async (precommit) => {
      expect(HearingJudgeResponsePrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      expect(precommit).toMatchObject({
        trialId: request.trialId,
        callId: request.callId,
        decisionId: request.decisionId,
        expectedStateVersion: request.expectedStateVersion,
        expectedLastEventId: request.expectedLastEventId,
      });
      return completedPreparation();
    });
    const durableService: CourtroomCommandDurableService = {
      prepare,
      commitOpponentPlan: vi.fn(),
      commitCounselResponse: vi.fn(),
      commitJudgeResponse,
      commitObjectionRuling: vi.fn(),
      commitWitness: vi.fn(),
      commitNegotiationDecision: vi.fn(),
      commitJuryResponse: vi.fn(),
      commitDebrief: vi.fn(),
      recordTerminalTrace: vi.fn(async () => undefined),
    };
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createJudgeResponseOutputFixture() }],
      { repeatLastStep: false },
    );

    await expect(
      orchestratePreparedCourtroomCommand({
        preparation: modelPreparation(request),
        provider,
        durableService,
      }),
    ).resolves.toEqual(completedView());

    expect(prepare).not.toHaveBeenCalled();
    expect(commitJudgeResponse).toHaveBeenCalledTimes(1);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "role_responder",
      task: "judge_response",
    });
  });

  it("records terminal failures while resuming a committed preparation", async () => {
    const recordTerminalTrace = vi.fn<
      CourtroomCommandDurableService["recordTerminalTrace"]
    >(async () => undefined);
    const durableService: CourtroomCommandDurableService = {
      prepare: vi.fn(),
      commitOpponentPlan: vi.fn(),
      commitCounselResponse: vi.fn(),
      commitJudgeResponse: vi.fn(),
      commitObjectionRuling: vi.fn(),
      commitWitness: vi.fn(),
      commitNegotiationDecision: vi.fn(),
      commitJuryResponse: vi.fn(),
      commitDebrief: vi.fn(),
      recordTerminalTrace,
    };
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "error",
          code: "service_unavailable",
          message: "raw provider detail",
          retryable: true,
        },
      ],
      { repeatLastStep: false },
    );

    await expect(
      orchestratePreparedCourtroomCommand({
        preparation: modelPreparation(createObjectionRulingRequestFixture()),
        provider,
        durableService,
      }),
    ).rejects.toMatchObject({
      code: "HEARING_MODEL_GENERATION_FAILED",
      task: "objection_ruling",
      terminalTracePersistence: "recorded",
    });
    expect(durableService.prepare).not.toHaveBeenCalled();
    expect(recordTerminalTrace).toHaveBeenCalledTimes(1);
  });

  it("bounds a resumed nonterminating model loop", async () => {
    const plannerPreparation = modelPreparation(
      createOpponentPlannerRequestFixture(),
    );
    const durableService: CourtroomCommandDurableService = {
      prepare: vi.fn(),
      commitOpponentPlan: vi.fn(async () => plannerPreparation),
      commitCounselResponse: vi.fn(),
      commitJudgeResponse: vi.fn(),
      commitObjectionRuling: vi.fn(),
      commitWitness: vi.fn(),
      commitNegotiationDecision: vi.fn(),
      commitJuryResponse: vi.fn(),
      commitDebrief: vi.fn(),
      recordTerminalTrace: vi.fn(async () => undefined),
    };
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createOpponentPlannerOutputFixture() }],
      { repeatLastStep: true },
    );

    await expect(
      orchestratePreparedCourtroomCommand({
        preparation: plannerPreparation,
        provider,
        durableService,
        maxModelSteps: 2,
      }),
    ).rejects.toMatchObject({
      code: "HEARING_MODEL_LOOP_EXHAUSTED",
      task: null,
    });
    expect(durableService.prepare).not.toHaveBeenCalled();
    expect(provider.requests).toHaveLength(2);
  });

  it("rejects an out-of-scope prepared model step before provider dispatch", async () => {
    const plannerPreparation = modelPreparation(
      createOpponentPlannerRequestFixture(),
    );
    const durableService: CourtroomCommandDurableService = {
      prepare: vi.fn(),
      commitOpponentPlan: vi.fn(),
      commitCounselResponse: vi.fn(),
      commitJudgeResponse: vi.fn(),
      commitObjectionRuling: vi.fn(),
      commitWitness: vi.fn(),
      commitNegotiationDecision: vi.fn(),
      commitJuryResponse: vi.fn(),
      commitDebrief: vi.fn(),
      recordTerminalTrace: vi.fn(async () => undefined),
    };
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createOpponentPlannerOutputFixture() }],
      { repeatLastStep: false },
    );
    const assertModelPreparation = vi.fn(() => {
      throw new Error("MODEL_PREPARATION_OUT_OF_SCOPE");
    });

    await expect(
      orchestratePreparedCourtroomCommand({
        preparation: plannerPreparation,
        provider,
        durableService,
        assertModelPreparation,
      }),
    ).rejects.toThrow("MODEL_PREPARATION_OUT_OF_SCOPE");
    expect(assertModelPreparation).toHaveBeenCalledWith(plannerPreparation);
    expect(provider.requests).toHaveLength(0);
    expect(durableService.commitOpponentPlan).not.toHaveBeenCalled();
  });

  it("durably records a failed private planner trace with a fresh signal", async () => {
    const recordTerminalTrace = vi.fn<
      CourtroomCommandDurableService["recordTerminalTrace"]
    >(async () => undefined);
    const durableService: CourtroomCommandDurableService = {
      prepare: vi.fn(async () =>
        modelPreparation(createOpponentPlannerRequestFixture()),
      ),
      commitOpponentPlan: vi.fn(),
      commitCounselResponse: vi.fn(),
      commitJudgeResponse: vi.fn(),
      commitObjectionRuling: vi.fn(),
      commitWitness: vi.fn(),
      commitNegotiationDecision: vi.fn(),
      commitJuryResponse: vi.fn(),
      commitDebrief: vi.fn(),
      recordTerminalTrace,
    };
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "error",
          code: "service_unavailable",
          message: "raw provider detail",
          retryable: true,
        },
      ],
      { repeatLastStep: false },
    );

    const operation = orchestrateCourtroomCommand({
      command: command(),
      provider,
      durableService,
    });
    await expect(operation).rejects.toMatchObject({
      name: "CourtroomCommandOrchestrationError",
      code: "HEARING_MODEL_GENERATION_FAILED",
      category: "generation_failed",
      task: "opponent_plan",
      terminalTracePersistence: "recorded",
    });
    expect(recordTerminalTrace).toHaveBeenCalledTimes(1);
    expect(recordTerminalTrace.mock.calls[0]?.[0]).toMatchObject({
      status: "failed",
      task: "plan_opponent",
      safeFailureCode: "service_unavailable",
    });
    expect(recordTerminalTrace.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [
      "objection ruling",
      createObjectionRulingRequestFixture,
      "objection_ruling",
      "resolve_objection",
    ],
    [
      "negotiation decision",
      createNegotiationAgentRequestFixture,
      "negotiation_decision",
      "evaluate_settlement",
    ],
    [
      "jury response",
      createJuryResponseRequestFixture,
      "jury_response",
      "jury_deliberation",
    ],
    [
      "debrief generation",
      createDebriefGeneratorRequestFixture,
      "debrief_generation",
      "generate_debrief",
    ],
  ] as const)(
    "maps a failed %s to its bounded orchestration task",
    async (_label, createRequest, task, traceTask) => {
      const recordTerminalTrace = vi.fn<
        CourtroomCommandDurableService["recordTerminalTrace"]
      >(async () => undefined);
      const durableService: CourtroomCommandDurableService = {
        prepare: vi.fn(async () => modelPreparation(createRequest())),
        commitOpponentPlan: vi.fn(),
        commitCounselResponse: vi.fn(),
        commitJudgeResponse: vi.fn(),
        commitObjectionRuling: vi.fn(),
        commitWitness: vi.fn(),
        commitNegotiationDecision: vi.fn(),
        commitJuryResponse: vi.fn(),
        commitDebrief: vi.fn(),
        recordTerminalTrace,
      };
      const provider = new ScriptedCourtroomModelProvider(
        [
          {
            type: "error",
            code: "service_unavailable",
            message: "raw provider detail",
            retryable: true,
          },
        ],
        { repeatLastStep: false },
      );

      await expect(
        orchestrateCourtroomCommand({
          command: command(),
          provider,
          durableService,
        }),
      ).rejects.toMatchObject({
        code: "HEARING_MODEL_GENERATION_FAILED",
        category: "generation_failed",
        task,
        terminalTracePersistence: "recorded",
      });
      expect(recordTerminalTrace).toHaveBeenCalledTimes(1);
      expect(recordTerminalTrace.mock.calls[0]?.[0]).toMatchObject({
        status: "failed",
        task: traceTask,
        safeFailureCode: "service_unavailable",
      });
    },
  );

  it("stops a valid but nonterminating model loop at the configured bound", async () => {
    const plannerPreparation = modelPreparation(
      createOpponentPlannerRequestFixture(),
    );
    const durableService: CourtroomCommandDurableService = {
      prepare: vi.fn(async () => plannerPreparation),
      commitOpponentPlan: vi.fn(async () => plannerPreparation),
      commitCounselResponse: vi.fn(),
      commitJudgeResponse: vi.fn(),
      commitObjectionRuling: vi.fn(),
      commitWitness: vi.fn(),
      commitNegotiationDecision: vi.fn(),
      commitJuryResponse: vi.fn(),
      commitDebrief: vi.fn(),
      recordTerminalTrace: vi.fn(async () => undefined),
    };
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createOpponentPlannerOutputFixture() }],
      { repeatLastStep: true },
    );

    const operation = orchestrateCourtroomCommand({
      command: command(),
      provider,
      durableService,
      maxModelSteps: 2,
    });
    await expect(operation).rejects.toEqual(
      expect.objectContaining<Partial<CourtroomCommandOrchestrationError>>({
        code: "HEARING_MODEL_LOOP_EXHAUSTED",
        category: "loop_exhausted",
        retryable: false,
        task: null,
        terminalTracePersistence: null,
      }),
    );
    expect(provider.requests).toHaveLength(2);
  });
});
