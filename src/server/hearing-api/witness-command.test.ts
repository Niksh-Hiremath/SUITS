import { describe, expect, it, vi } from "vitest";

import {
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
  WitnessAnswerModelOutputSchema,
  WitnessAnswerRequestSchema,
  type CourtroomModelCallTrace,
  type WitnessAnswerModelOutput,
  type WitnessAnswerRequest,
} from "@/domain/courtroom-ai";
import {
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V2,
  HearingPlayerCommandSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  type HearingCommandPreparation,
  type HearingPlayerCommand,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";
import { ScriptedCourtroomModelProvider } from "@/server/courtroom-ai";

import {
  HearingCommandOrchestrationError,
  orchestrateHearingCommand,
  type HearingCommandDurableService,
} from "./witness-command";

const TRIAL_ID = `trial_${"a".repeat(32)}`;
const CALL_ID = "model-call:witness:001";
const RESPONSE_ID = "response:witness:001";
const FACT_ID = "fact:witness:observed";
const EVIDENCE_ID = "evidence:presented:record";
const PRIOR_STATEMENT_ID = "statement:witness:interview";
const PRIVATE_KNOWLEDGE_CANARY =
  "PRIVATE_KNOWLEDGE_CANARY: condition known only to this witness.";
const PRIVATE_POLICY_CANARY =
  "PRIVATE_POLICY_CANARY: another witness's private account";

function command(): HearingPlayerCommand {
  return HearingPlayerCommandSchema.parse({
    schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
    requestId: "11111111-1111-4111-8111-111111111111",
    requestedAt: "2026-07-19T06:00:00.000Z",
    expectedStateVersion: 6,
    expectedLastEventId: "event:before-question:001",
    intent: {
      type: "ask_question",
      witnessId: "witness:rina",
      examinationKind: "direct",
      text: "What did you personally observe?",
      presentedEvidenceIds: [EVIDENCE_ID],
    },
  });
}

function witnessRequest(): WitnessAnswerRequest {
  return WitnessAnswerRequestSchema.parse({
    schemaVersion: WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
    callId: CALL_ID,
    trialId: TRIAL_ID,
    responseId: RESPONSE_ID,
    expectedStateVersion: 8,
    expectedLastEventId: "event:request-response:001",
    actorId: "actor:witness:rina",
    witnessId: "witness:rina",
    question: {
      questionId: "question:witness:001",
      appearanceId: "appearance:witness:001",
      turnId: "turn:question:001",
      eventId: "event:question:001",
      examinationKind: "direct",
      text: "What did you personally observe?",
      presentedEvidenceIds: [EVIDENCE_ID],
    },
    knowledgeView: {
      schemaVersion: "knowledge-view.v2",
      trialId: TRIAL_ID,
      stateVersion: 8,
      actorId: "actor:witness:rina",
      actorRole: "witness",
      case: {
        caseId: "case:fictional:001",
        caseVersion: 1,
        title: "Fictional Loading Bay Hearing",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1",
        trialId: TRIAL_ID,
        stateVersion: 8,
        facts: [],
        evidence: [],
        testimony: [],
        instructions: [],
      },
      witness: {
        witnessId: "witness:rina",
        name: "Rina Shah",
        role: "Loading-bay witness",
        emotionalState: "confident",
        facts: [
          {
            factId: FACT_ID,
            proposition: PRIVATE_KNOWLEDGE_CANARY,
            knowledgeBasis: "perceived",
          },
        ],
        admittedSeenEvidence: [],
        priorStatements: [
          {
            priorStatementId: PRIOR_STATEMENT_ID,
            madeAt: "2026-07-18T10:00:00.000Z",
            kind: "interview",
            text: "I saw the loading bay before the fictional incident.",
            relatedFactIds: [FACT_ID],
            relatedEvidenceIds: [EVIDENCE_ID],
          },
        ],
        allowedTopics: ["personal loading-bay observations"],
        forbiddenTopics: [PRIVATE_POLICY_CANARY],
      },
      presentedEvidence: [
        {
          evidenceId: EVIDENCE_ID,
          name: "Loading record",
          description: "A fictional record shown for identification.",
          status: "uploaded",
        },
      ],
      currentExchange: {
        exchangeId: "turn:question:001",
        speakerActorId: "actor:user-counsel",
        text: "What did you personally observe?",
        factIds: [],
        evidenceIds: [EVIDENCE_ID],
      },
    },
  });
}

function modelRequiredPreparation(): HearingCommandPreparation {
  return {
    schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
    status: "model_required",
    request: witnessRequest(),
  };
}

function runtimeView(): HearingRuntimeViewV1 {
  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: HEARING_RUNTIME_VIEW_SCHEMA_VERSION_V2,
    case: {
      caseId: "case:fictional:001",
      version: 1,
      title: "Fictional Loading Bay Hearing",
      summary: "A fictional educational hearing.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction:fixture",
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
      version: 9,
      sequence: 9,
      lastEventId: "event:answer-question:001",
      userSide: "user",
    },
    activeAppearance: null,
    activeQuestion: null,
    capabilities: {
      canAskQuestion: true,
      canFinishExamination: true,
      canFinishTrial: false,
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
      actorId: "actor:user-counsel",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party:claimant",
      facts: [],
      evidence: [],
      settlement: null,
    },
    transcript: [],
    permittedObjectionGrounds: [],
  });
}

function performance() {
  return {
    emotion: "confident" as const,
    intensity: 0.4,
    delivery: "measured" as const,
    gesture: "small_nod" as const,
    gazeTarget: "questioning_counsel" as const,
  };
}

function validOutput(): WitnessAnswerModelOutput {
  return WitnessAnswerModelOutputSchema.parse({
    schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    disposition: "substantive",
    performance: performance(),
    segments: [
      {
        text: "I personally observed the loading area before the incident.",
        factIds: [FACT_ID],
        evidenceIds: [],
        priorStatementIds: [PRIOR_STATEMENT_ID],
      },
    ],
  });
}

function invalidOutput(): WitnessAnswerModelOutput {
  return WitnessAnswerModelOutputSchema.parse({
    ...validOutput(),
    segments: [
      {
        text: "I saw something outside my permitted record.",
        factIds: ["fact:not-in-witness-view"],
        evidenceIds: [],
        priorStatementIds: [],
      },
    ],
  });
}

function durableHarness(
  preparation: HearingCommandPreparation,
  options: Readonly<{
    commitView?: HearingRuntimeViewV1;
    recordTerminalTrace?: (
      trace: CourtroomModelCallTrace,
      signal?: AbortSignal,
    ) => Promise<void>;
  }> = {},
) {
  const prepare = vi.fn(
    async (_command: HearingPlayerCommand, _signal?: AbortSignal) => {
      void _command;
      void _signal;
      return preparation;
    },
  );
  const commit = vi.fn(
    async (_precommit, _signal?: AbortSignal) => {
      void _precommit;
      void _signal;
      return options.commitView ?? runtimeView();
    },
  );
  const recordTerminalTrace = vi.fn(
    options.recordTerminalTrace ?? (async () => undefined),
  );
  const service: HearingCommandDurableService = {
    prepare,
    commit,
    recordTerminalTrace,
  };
  return { service, prepare, commit, recordTerminalTrace };
}

async function captureOrchestrationError(
  operation: Promise<unknown>,
): Promise<HearingCommandOrchestrationError> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HearingCommandOrchestrationError);
  return caught as HearingCommandOrchestrationError;
}

async function waitForProviderRequest(
  provider: ScriptedCourtroomModelProvider,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (provider.requests.length > 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("The provider request did not start");
}

describe("hearing witness command orchestrator", () => {
  it("returns a completed durable view without invoking the model", async () => {
    const view = runtimeView();
    const preparation: HearingCommandPreparation = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "completed",
      view,
    };
    const durable = durableHarness(preparation);
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: validOutput() }],
      { repeatLastStep: false },
    );

    await expect(
      orchestrateHearingCommand({
        command: command(),
        provider,
        durableService: durable.service,
      }),
    ).resolves.toEqual(view);
    expect(durable.prepare).toHaveBeenCalledTimes(1);
    expect(provider.requests).toEqual([]);
    expect(durable.commit).not.toHaveBeenCalled();
    expect(durable.recordTerminalTrace).not.toHaveBeenCalled();
  });

  it("commits one strictly bound accepted fake witness answer", async () => {
    const durable = durableHarness(modelRequiredPreparation());
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: validOutput() }],
      { repeatLastStep: false },
    );
    const controller = new AbortController();

    const result = await orchestrateHearingCommand({
      command: command(),
      provider,
      durableService: durable.service,
      signal: controller.signal,
    });

    expect(result).toEqual(runtimeView());
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].signal).toBe(controller.signal);
    expect(durable.commit).toHaveBeenCalledTimes(1);
    const precommit = HearingWitnessGenerationPrecommitSchema.parse(
      durable.commit.mock.calls[0][0],
    );
    expect(precommit).toMatchObject({
      trialId: TRIAL_ID,
      callId: CALL_ID,
      responseId: RESPONSE_ID,
      output: validOutput(),
      trace: {
        status: "accepted",
        acceptedAttempt: 1,
        committedActionId: null,
        committedEventId: null,
      },
    });
    expect(durable.commit.mock.calls[0][1]).toBe(controller.signal);
    expect(durable.recordTerminalTrace).not.toHaveBeenCalled();
  });

  it("uses exactly one targeted repair before committing", async () => {
    const durable = durableHarness(modelRequiredPreparation());
    const provider = new ScriptedCourtroomModelProvider(
      [
        { type: "output", output: invalidOutput() },
        { type: "output", output: validOutput() },
      ],
      { repeatLastStep: false },
    );

    await orchestrateHearingCommand({
      command: command(),
      provider,
      durableService: durable.service,
    });

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests.map((request) => request.mode)).toEqual([
      "initial",
      "repair",
    ]);
    expect(durable.commit).toHaveBeenCalledTimes(1);
    const precommit = HearingWitnessGenerationPrecommitSchema.parse(
      durable.commit.mock.calls[0][0],
    );
    expect(precommit.trace).toMatchObject({
      status: "accepted",
      acceptedAttempt: 2,
      retryCount: 1,
      validationFailureCount: 1,
      attempts: [
        { status: "validation_failed" },
        { status: "accepted" },
      ],
    });
    expect(durable.recordTerminalTrace).not.toHaveBeenCalled();
  });

  it("persists a provider failure trace and throws only a safe error", async () => {
    const durable = durableHarness(modelRequiredPreparation());
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "error",
          code: "provider_unavailable",
          message: "RAW_PROVIDER_SECRET_MESSAGE",
          retryable: true,
        },
      ],
      { repeatLastStep: false },
    );
    const controller = new AbortController();

    const error = await captureOrchestrationError(
      orchestrateHearingCommand({
        command: command(),
        provider,
        durableService: durable.service,
        signal: controller.signal,
      }),
    );

    expect(error).toMatchObject({
      code: "HEARING_WITNESS_GENERATION_FAILED",
      category: "generation_failed",
      retryable: true,
      terminalTracePersistence: "recorded",
    });
    expect(JSON.stringify(error)).not.toContain("RAW_PROVIDER_SECRET_MESSAGE");
    expect(durable.commit).not.toHaveBeenCalled();
    expect(durable.recordTerminalTrace).toHaveBeenCalledTimes(1);
    expect(durable.recordTerminalTrace.mock.calls[0][0]).toMatchObject({
      status: "failed",
      acceptedAttempt: null,
      safeFailureCode: "provider_unavailable",
      attempts: [{ status: "provider_failed" }],
    });
    const persistenceSignal = durable.recordTerminalTrace.mock.calls[0][1];
    expect(persistenceSignal).not.toBe(controller.signal);
    expect(persistenceSignal?.aborted).toBe(false);
  });

  it("persists cancellation with a fresh signal and never commits it", async () => {
    const durable = durableHarness(modelRequiredPreparation());
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: validOutput(), chunkSize: 1, chunkDelayMs: 5 }],
      { repeatLastStep: false },
    );
    const controller = new AbortController();
    const pending = orchestrateHearingCommand({
      command: command(),
      provider,
      durableService: durable.service,
      signal: controller.signal,
    });
    await waitForProviderRequest(provider);
    controller.abort(new Error("RAW_ABORT_REASON"));

    const error = await captureOrchestrationError(pending);

    expect(error).toMatchObject({
      code: "HEARING_WITNESS_GENERATION_CANCELLED",
      category: "cancelled",
      terminalTracePersistence: "recorded",
    });
    expect(JSON.stringify(error)).not.toContain("RAW_ABORT_REASON");
    expect(durable.commit).not.toHaveBeenCalled();
    expect(durable.recordTerminalTrace).toHaveBeenCalledTimes(1);
    expect(durable.recordTerminalTrace.mock.calls[0][0]).toMatchObject({
      status: "cancelled",
      acceptedAttempt: null,
      safeFailureCode: "request_aborted",
    });
    const persistenceSignal = durable.recordTerminalTrace.mock.calls[0][1];
    expect(persistenceSignal).not.toBe(controller.signal);
    expect(persistenceSignal?.aborted).toBe(false);
  });

  it("does not let terminal-trace persistence failure mask generation failure", async () => {
    const durable = durableHarness(modelRequiredPreparation(), {
      recordTerminalTrace: async () => {
        throw new Error("RAW_TRACE_PERSISTENCE_FAILURE");
      },
    });
    const provider = new ScriptedCourtroomModelProvider(
      [
        {
          type: "error",
          code: "provider_unavailable",
          message: "RAW_PROVIDER_FAILURE",
          retryable: true,
        },
      ],
      { repeatLastStep: false },
    );

    const error = await captureOrchestrationError(
      orchestrateHearingCommand({
        command: command(),
        provider,
        durableService: durable.service,
      }),
    );

    expect(error).toMatchObject({
      code: "HEARING_WITNESS_GENERATION_FAILED",
      terminalTracePersistence: "failed",
    });
    expect(error.message).toBe("The witness response could not be generated.");
    expect(JSON.stringify(error)).not.toContain("RAW_TRACE_PERSISTENCE_FAILURE");
    expect(JSON.stringify(error)).not.toContain("RAW_PROVIDER_FAILURE");
    expect(durable.commit).not.toHaveBeenCalled();
  });

  it("returns only the strict redacted runtime view to the browser caller", async () => {
    const durable = durableHarness(modelRequiredPreparation());
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: validOutput() }],
      { repeatLastStep: false },
    );

    const result = await orchestrateHearingCommand({
      command: command(),
      provider,
      durableService: durable.service,
    });
    const serialized = JSON.stringify(result);

    expect(Object.keys(result).sort()).toEqual(
      [
        "activeAppearance",
        "activeQuestion",
        "capabilities",
        "case",
        "permittedObjectionGrounds",
        "player",
        "schemaVersion",
        "transcript",
        "trial",
        "witnesses",
      ].sort(),
    );
    expect(serialized).not.toContain("knowledgeView");
    expect(serialized).not.toContain("modelMetadata");
    expect(serialized).not.toContain("trace");
    expect(serialized).not.toContain("providerRequestId");
    expect(serialized).not.toContain(PRIVATE_KNOWLEDGE_CANARY);
    expect(serialized).not.toContain(PRIVATE_POLICY_CANARY);
  });

  it("rejects a commit response carrying an extra server-only trace", async () => {
    const view = runtimeView();
    const prepare = vi.fn(async () => modelRequiredPreparation());
    const commit = vi.fn(async (precommit) => ({
      ...view,
      trace: precommit.trace,
    }));
    const durableService: HearingCommandDurableService = {
      prepare,
      commit,
      recordTerminalTrace: async () => undefined,
    };
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: validOutput() }],
      { repeatLastStep: false },
    );

    await expect(
      orchestrateHearingCommand({
        command: command(),
        provider,
        durableService,
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});
