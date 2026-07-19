import {
  CourtroomModelCallTraceSchema,
  type ObjectionRulingModelOutput,
  type DebriefGeneratorModelOutput,
  type DebriefGeneratorRequest,
  type CourtroomModelCallTrace,
} from "@/domain/courtroom-ai";
import {
  HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
  HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingCounselResponsePrecommitSchema,
  HearingDebriefGeneratorPrecommitSchema,
  HearingJuryResponsePrecommitSchema,
  HearingNegotiationPrecommitSchema,
  HearingObjectionRulingPrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingPlayerCommandSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  isHearingCounselResponseModelRequiredPreparation,
  isHearingDebriefGeneratorModelRequiredPreparation,
  isHearingJuryResponseModelRequiredPreparation,
  isHearingNegotiationModelRequiredPreparation,
  isHearingObjectionRulingModelRequiredPreparation,
  isHearingOpponentPlanModelRequiredPreparation,
  isHearingWitnessModelRequiredPreparation,
  type HearingCommandPreparation,
  type HearingCounselResponsePrecommit,
  type HearingDebriefGeneratorPrecommit,
  type HearingDebriefTranscriptEventBinding,
  type HearingJuryResponsePrecommit,
  type HearingNegotiationPrecommit,
  type HearingObjectionRulingPrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingPlayerCommand,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "@/domain/hearing-runtime";
import {
  CounselResponseGenerationError,
  DebriefGenerationError,
  JuryResponseGenerationError,
  NegotiationAgentGenerationError,
  ObjectionRulingGenerationError,
  OpponentPlannerGenerationError,
  WitnessAnswerGenerationError,
  generateCounselResponse,
  generateDebrief,
  generateJuryResponse,
  generateNegotiationDecision,
  generateObjectionRuling,
  generateOpponentPlan,
  generateWitnessAnswer,
  type CourtroomModelProvider,
} from "@/server/courtroom-ai";

export const MAX_HEARING_MODEL_STEPS = 12;

export type CourtroomCommandDurableService = Readonly<{
  prepare: (
    command: HearingPlayerCommand,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  commitWitness: (
    precommit: HearingWitnessGenerationPrecommit,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  commitOpponentPlan: (
    precommit: HearingOpponentPlanPrecommit,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  commitCounselResponse: (
    precommit: HearingCounselResponsePrecommit,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  commitObjectionRuling: (
    precommit: HearingObjectionRulingPrecommit,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  commitNegotiationDecision: (
    precommit: HearingNegotiationPrecommit,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  commitJuryResponse: (
    precommit: HearingJuryResponsePrecommit,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  commitDebrief: (
    precommit: HearingDebriefGeneratorPrecommit,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  recordTerminalTrace: (
    trace: CourtroomModelCallTrace,
    signal?: AbortSignal,
  ) => Promise<void>;
}>;

export type HearingModelTask =
  | "witness_answer"
  | "opponent_plan"
  | "counsel_response"
  | "objection_ruling"
  | "negotiation_decision"
  | "jury_response"
  | "debrief_generation";

export type CourtroomCommandOrchestrationErrorCode =
  | "HEARING_MODEL_GENERATION_CANCELLED"
  | "HEARING_MODEL_GENERATION_FAILED"
  | "HEARING_MODEL_LOOP_EXHAUSTED";

export type CourtroomTerminalTracePersistence = "recorded" | "failed";

/** Bounded orchestration error that never carries role requests or outputs. */
export class CourtroomCommandOrchestrationError extends Error {
  readonly code: CourtroomCommandOrchestrationErrorCode;
  readonly category: "cancelled" | "generation_failed" | "loop_exhausted";
  readonly retryable: boolean;
  readonly task: HearingModelTask | null;
  readonly terminalTracePersistence: CourtroomTerminalTracePersistence | null;

  constructor(input: Readonly<{
    code: CourtroomCommandOrchestrationErrorCode;
    task: HearingModelTask | null;
    terminalTracePersistence: CourtroomTerminalTracePersistence | null;
  }>) {
    super(
      input.code === "HEARING_MODEL_GENERATION_CANCELLED"
        ? "Courtroom response generation was cancelled."
        : input.code === "HEARING_MODEL_LOOP_EXHAUSTED"
          ? "The courtroom reached its bounded model-step limit."
          : "A courtroom response could not be generated.",
    );
    this.name = "CourtroomCommandOrchestrationError";
    this.code = input.code;
    this.category =
      input.code === "HEARING_MODEL_GENERATION_CANCELLED"
        ? "cancelled"
        : input.code === "HEARING_MODEL_LOOP_EXHAUSTED"
          ? "loop_exhausted"
          : "generation_failed";
    this.retryable = input.code !== "HEARING_MODEL_LOOP_EXHAUSTED";
    this.task = input.task;
    this.terminalTracePersistence = input.terminalTracePersistence;
  }
}

type CourtroomGenerationError =
  | WitnessAnswerGenerationError
  | OpponentPlannerGenerationError
  | CounselResponseGenerationError
  | ObjectionRulingGenerationError
  | NegotiationAgentGenerationError
  | JuryResponseGenerationError
  | DebriefGenerationError;

function generationFailure(error: unknown): Readonly<{
  error: CourtroomGenerationError;
  task: HearingModelTask;
  cancelled: boolean;
}> | null {
  if (error instanceof WitnessAnswerGenerationError) {
    return {
      error,
      task: "witness_answer",
      cancelled: error.code === "witness_answer_cancelled",
    };
  }
  if (error instanceof OpponentPlannerGenerationError) {
    return {
      error,
      task: "opponent_plan",
      cancelled: error.code === "opponent_plan_cancelled",
    };
  }
  if (error instanceof CounselResponseGenerationError) {
    return {
      error,
      task: "counsel_response",
      cancelled: error.code === "counsel_response_cancelled",
    };
  }
  if (error instanceof ObjectionRulingGenerationError) {
    return {
      error,
      task: "objection_ruling",
      cancelled: error.code === "objection_ruling_cancelled",
    };
  }
  if (error instanceof NegotiationAgentGenerationError) {
    return {
      error,
      task: "negotiation_decision",
      cancelled: error.code === "negotiation_decision_cancelled",
    };
  }
  if (error instanceof JuryResponseGenerationError) {
    return {
      error,
      task: "jury_response",
      cancelled: error.code === "jury_response_cancelled",
    };
  }
  if (error instanceof DebriefGenerationError) {
    return {
      error,
      task: "debrief_generation",
      cancelled: error.code === "debrief_generation_cancelled",
    };
  }
  return null;
}

function debriefCitationSets(output: DebriefGeneratorModelOutput) {
  return [
    output.overallAssessment.citations,
    ...output.strengths.map(({ citations }) => citations),
    ...output.weakQuestions.map(({ citations }) => citations),
    ...output.missedEvidence.map(({ citations }) => citations),
    ...output.contradictions.map(({ citations }) => citations),
    ...output.objectionAccuracy.map(({ citations }) => citations),
    ...output.witnessStrategy.map(({ citations }) => citations),
    ...output.settlementChoices.map(({ citations }) => citations),
    ...output.juryMovement.map(({ citations }) => citations),
    ...output.improvedClosing.segments.map(({ citations }) => citations),
  ];
}

function debriefTranscriptEventBindings(
  request: DebriefGeneratorRequest,
  output: DebriefGeneratorModelOutput,
): HearingDebriefTranscriptEventBinding[] {
  const sourceEventIdByTurnId = new Map(
    request.transcript.map(({ turnId, sourceEventId }) => [
      turnId,
      sourceEventId,
    ]),
  );
  const citedTurnIds = [
    ...new Set(
      debriefCitationSets(output).flatMap(
        ({ transcriptTurnIds }) => transcriptTurnIds,
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return citedTurnIds.map((turnId) => {
    const sourceEventId = sourceEventIdByTurnId.get(turnId);
    if (sourceEventId === undefined) {
      throw new Error("Generated debrief cited an unknown transcript turn");
    }
    return { turnId, sourceEventId };
  });
}

async function recordTerminalTraceBestEffort(
  durableService: CourtroomCommandDurableService,
  traceInput: CourtroomModelCallTrace,
): Promise<CourtroomTerminalTracePersistence> {
  try {
    const trace = CourtroomModelCallTraceSchema.parse(traceInput);
    if (trace.status === "accepted" || trace.status === "in_progress") {
      return "failed";
    }
    const persistenceController = new AbortController();
    await durableService.recordTerminalTrace(
      trace,
      persistenceController.signal,
    );
    return "recorded";
  } catch {
    return "failed";
  }
}

export type OrchestrateCourtroomCommandOptions = Readonly<{
  command: HearingPlayerCommand;
  provider: CourtroomModelProvider;
  durableService: CourtroomCommandDurableService;
  signal?: AbortSignal;
  maxModelSteps?: number;
}>;

export type OrchestratePreparedCourtroomCommandOptions = Readonly<{
  preparation: HearingCommandPreparation;
  provider: CourtroomModelProvider;
  durableService: CourtroomCommandDurableService;
  signal?: AbortSignal;
  maxModelSteps?: number;
  assertModelPreparation?: (
    preparation: Extract<
      HearingCommandPreparation,
      Readonly<{ status: "model_required" }>
    >,
  ) => void;
}>;

export type CommittedObjectionRulingOutcome = Readonly<
  Pick<ObjectionRulingModelOutput, "ruling" | "remedy"> & {
    objectionEventId: string;
    responseId: string;
  }
>;

export type PreparedCourtroomCommandResult = Readonly<{
  view: HearingRuntimeViewV1;
  objectionRulings: readonly CommittedObjectionRulingOutcome[];
}>;

function modelStepLimit(value: number | undefined): number {
  const limit = value ?? MAX_HEARING_MODEL_STEPS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HEARING_MODEL_STEPS) {
    throw new Error(
      `maxModelSteps must be between 1 and ${MAX_HEARING_MODEL_STEPS}`,
    );
  }
  return limit;
}

/**
 * Run a private, resumable model loop until Convex returns one redacted view.
 * Structured deltas and role-scoped requests never cross this server boundary.
 */
export async function orchestrateCourtroomCommand(
  options: OrchestrateCourtroomCommandOptions,
): Promise<HearingRuntimeViewV1> {
  const command = HearingPlayerCommandSchema.parse(options.command);
  const limit = modelStepLimit(options.maxModelSteps);
  const preparation = HearingCommandPreparationSchema.parse(
    await options.durableService.prepare(command, options.signal),
  );

  return (await runPreparedCourtroomCommand(preparation, options, limit)).view;
}

/**
 * Resume the private model loop from a preparation already committed by a
 * protected durable boundary. This is used by speech interruptions whose
 * atomic event prefix must not be reconstructed as a player command.
 */
export async function orchestratePreparedCourtroomCommand(
  options: OrchestratePreparedCourtroomCommandOptions,
): Promise<HearingRuntimeViewV1> {
  return (await orchestratePreparedCourtroomCommandResult(options)).view;
}

/** Return committed ruling outcomes as server-local orchestration metadata. */
export async function orchestratePreparedCourtroomCommandResult(
  options: OrchestratePreparedCourtroomCommandOptions,
): Promise<PreparedCourtroomCommandResult> {
  const preparation = HearingCommandPreparationSchema.parse(options.preparation);
  const limit = modelStepLimit(options.maxModelSteps);

  return runPreparedCourtroomCommand(preparation, options, limit);
}

async function runPreparedCourtroomCommand(
  initialPreparation: HearingCommandPreparation,
  options: Readonly<{
    provider: CourtroomModelProvider;
    durableService: CourtroomCommandDurableService;
    signal?: AbortSignal;
    assertModelPreparation?: OrchestratePreparedCourtroomCommandOptions["assertModelPreparation"];
  }>,
  limit: number,
): Promise<PreparedCourtroomCommandResult> {
  let preparation = initialPreparation;
  const objectionRulings: CommittedObjectionRulingOutcome[] = [];

  for (let step = 0; step < limit; step += 1) {
    if (preparation.status === "completed") {
      return {
        view: HearingRuntimeViewV1Schema.parse(preparation.view),
        objectionRulings,
      };
    }
    options.assertModelPreparation?.(preparation);

    try {
      if (isHearingWitnessModelRequiredPreparation(preparation)) {
        const request = preparation.request;
        const generated = await generateWitnessAnswer({
          provider: options.provider,
          request,
          signal: options.signal,
        });
        const precommit = HearingWitnessGenerationPrecommitSchema.parse({
          schemaVersion: HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
          trialId: request.trialId,
          callId: request.callId,
          responseId: request.responseId,
          output: generated.output,
          modelMetadata: generated.modelMetadata,
          trace: generated.trace,
        });
        preparation = HearingCommandPreparationSchema.parse(
          await options.durableService.commitWitness(
            precommit,
            options.signal,
          ),
        );
        continue;
      }

      if (isHearingOpponentPlanModelRequiredPreparation(preparation)) {
        const request = preparation.request;
        const generated = await generateOpponentPlan({
          provider: options.provider,
          request,
          signal: options.signal,
        });
        const precommit = HearingOpponentPlanPrecommitSchema.parse({
          schemaVersion: HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
          trialId: request.trialId,
          callId: request.callId,
          decisionId: request.decisionId,
          output: generated.output,
          modelMetadata: generated.modelMetadata,
          trace: generated.trace,
        });
        preparation = HearingCommandPreparationSchema.parse(
          await options.durableService.commitOpponentPlan(
            precommit,
            options.signal,
          ),
        );
        continue;
      }

      if (isHearingCounselResponseModelRequiredPreparation(preparation)) {
        const request = preparation.request;
        const generated = await generateCounselResponse({
          provider: options.provider,
          request,
          signal: options.signal,
        });
        const precommit = HearingCounselResponsePrecommitSchema.parse({
          schemaVersion: HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
          trialId: request.trialId,
          callId: request.callId,
          decisionId: request.decisionId,
          expectedStateVersion: request.expectedStateVersion,
          expectedLastEventId: request.expectedLastEventId,
          planBinding: request.planBinding,
          output: generated.output,
          modelMetadata: generated.modelMetadata,
          trace: generated.trace,
        });
        preparation = HearingCommandPreparationSchema.parse(
          await options.durableService.commitCounselResponse(
            precommit,
            options.signal,
          ),
        );
        continue;
      }

      if (isHearingObjectionRulingModelRequiredPreparation(preparation)) {
        const request = preparation.request;
        if (request.interruption === null) {
          throw new Error(
            "The hearing objection boundary requires an interrupted response",
          );
        }
        const generated = await generateObjectionRuling({
          provider: options.provider,
          request,
          signal: options.signal,
        });
        const precommit = HearingObjectionRulingPrecommitSchema.parse({
          schemaVersion: HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
          trialId: request.trialId,
          callId: request.callId,
          decisionId: request.decisionId,
          expectedStateVersion: request.expectedStateVersion,
          expectedLastEventId: request.expectedLastEventId,
          objectionEventId: request.objection.sourceEventId,
          responseId: request.interruption.interruptedResponseId,
          questionEventBinding: {
            turnId: request.question.turnId,
            sourceEventId: request.question.eventId,
          },
          output: generated.output,
          modelMetadata: generated.modelMetadata,
          trace: generated.trace,
        });
        const committedPreparation = HearingCommandPreparationSchema.parse(
          await options.durableService.commitObjectionRuling(
            precommit,
            options.signal,
          ),
        );
        objectionRulings.push({
          objectionEventId: precommit.objectionEventId,
          responseId: precommit.responseId,
          ruling: generated.output.ruling,
          remedy: generated.output.remedy,
        });
        preparation = committedPreparation;
        continue;
      }

      if (isHearingNegotiationModelRequiredPreparation(preparation)) {
        const request = preparation.request;
        const generated = await generateNegotiationDecision({
          provider: options.provider,
          request,
          signal: options.signal,
        });
        const precommit = HearingNegotiationPrecommitSchema.parse({
          schemaVersion: HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION,
          trialId: request.trialId,
          callId: request.callId,
          decisionId: request.decisionId,
          expectedStateVersion: request.expectedStateVersion,
          expectedLastEventId: request.expectedLastEventId,
          output: generated.output,
          modelMetadata: generated.modelMetadata,
          trace: generated.trace,
        });
        preparation = HearingCommandPreparationSchema.parse(
          await options.durableService.commitNegotiationDecision(
            precommit,
            options.signal,
          ),
        );
        continue;
      }

      if (isHearingJuryResponseModelRequiredPreparation(preparation)) {
        const request = preparation.request;
        const generated = await generateJuryResponse({
          provider: options.provider,
          request,
          signal: options.signal,
        });
        const precommit = HearingJuryResponsePrecommitSchema.parse({
          schemaVersion: HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
          trialId: request.trialId,
          callId: request.callId,
          decisionId: request.decisionId,
          expectedStateVersion: request.expectedStateVersion,
          expectedLastEventId: request.expectedLastEventId,
          output: generated.output,
          modelMetadata: generated.modelMetadata,
          trace: generated.trace,
        });
        preparation = HearingCommandPreparationSchema.parse(
          await options.durableService.commitJuryResponse(
            precommit,
            options.signal,
          ),
        );
        continue;
      }

      if (isHearingDebriefGeneratorModelRequiredPreparation(preparation)) {
        const request = preparation.request;
        const generated = await generateDebrief({
          provider: options.provider,
          request,
          signal: options.signal,
        });
        const precommit = HearingDebriefGeneratorPrecommitSchema.parse({
          schemaVersion: HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
          trialId: request.trialId,
          callId: request.callId,
          expectedStateVersion: request.expectedStateVersion,
          expectedLastEventId: request.expectedLastEventId,
          transcriptEventBindings: debriefTranscriptEventBindings(
            request,
            generated.output,
          ),
          output: generated.output,
          modelMetadata: generated.modelMetadata,
          trace: generated.trace,
        });
        preparation = HearingCommandPreparationSchema.parse(
          await options.durableService.commitDebrief(
            precommit,
            options.signal,
          ),
        );
        continue;
      }

      throw new Error("Unsupported hearing model preparation");
    } catch (error) {
      const failure = generationFailure(error);
      if (failure === null) throw error;
      const terminalTracePersistence = await recordTerminalTraceBestEffort(
        options.durableService,
        failure.error.trace,
      );
      throw new CourtroomCommandOrchestrationError({
        code: failure.cancelled
          ? "HEARING_MODEL_GENERATION_CANCELLED"
          : "HEARING_MODEL_GENERATION_FAILED",
        task: failure.task,
        terminalTracePersistence,
      });
    }
  }

  throw new CourtroomCommandOrchestrationError({
    code: "HEARING_MODEL_LOOP_EXHAUSTED",
    task: null,
    terminalTracePersistence: null,
  });
}
