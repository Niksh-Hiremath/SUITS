import { describe, expect, it, vi } from "vitest";

import {
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
  WitnessAnswerRequestSchema,
} from "@/domain/courtroom-ai";
import {
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
  HearingCommandPreparationSchema,
  HearingCounselResponsePrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingPlayerCommandSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  type HearingCommandPreparation,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";
import {
  ScriptedCourtroomModelProvider,
} from "@/server/courtroom-ai";
import {
  createCounselQuestionOutputFixture,
  createCounselResponseRequestFixture,
} from "@/server/courtroom-ai/counsel-response.test-fixtures";
import {
  createOpponentPlannerOutputFixture,
  createOpponentPlannerRequestFixture,
} from "@/server/courtroom-ai/opponent-planner.test-fixtures";

import {
  CourtroomCommandOrchestrationError,
  orchestrateCourtroomCommand,
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
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V1,
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
  it("privately dispatches planner, counsel, and witness work until completion", async () => {
    const plannerPreparation = modelPreparation(
      createOpponentPlannerRequestFixture(),
    );
    const counselPreparation = modelPreparation(
      createCounselResponseRequestFixture(),
    );
    const witnessPreparation = modelPreparation(witnessRequest());
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
      return witnessPreparation;
    });
    const commitWitness = vi.fn(async (precommit) => {
      expect(HearingWitnessGenerationPrecommitSchema.parse(precommit)).toEqual(
        precommit,
      );
      return completedPreparation();
    });
    const durableService: CourtroomCommandDurableService = {
      prepare: vi.fn(async () => plannerPreparation),
      commitOpponentPlan,
      commitCounselResponse,
      commitWitness,
      recordTerminalTrace: vi.fn(async () => undefined),
    };
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: createOpponentPlannerOutputFixture() },
        { type: "output", output: createCounselQuestionOutputFixture() },
        { type: "output", output: witnessBoundaryOutput() },
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
        { callClass: "role_responder", task: "witness_answer" },
      ]);
    expect(commitOpponentPlan).toHaveBeenCalledTimes(1);
    expect(commitCounselResponse).toHaveBeenCalledTimes(1);
    expect(commitWitness).toHaveBeenCalledTimes(1);
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
      commitWitness: vi.fn(),
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

  it("stops a valid but nonterminating model loop at the configured bound", async () => {
    const plannerPreparation = modelPreparation(
      createOpponentPlannerRequestFixture(),
    );
    const durableService: CourtroomCommandDurableService = {
      prepare: vi.fn(async () => plannerPreparation),
      commitOpponentPlan: vi.fn(async () => plannerPreparation),
      commitCounselResponse: vi.fn(),
      commitWitness: vi.fn(),
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
