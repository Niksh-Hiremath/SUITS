import {
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallTrace,
} from "@/domain/courtroom-ai";
import {
  HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingCounselResponsePrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingPlayerCommandSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  isHearingCounselResponseModelRequiredPreparation,
  isHearingOpponentPlanModelRequiredPreparation,
  isHearingWitnessModelRequiredPreparation,
  type HearingCommandPreparation,
  type HearingCounselResponsePrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingPlayerCommand,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "@/domain/hearing-runtime";
import {
  CounselResponseGenerationError,
  OpponentPlannerGenerationError,
  WitnessAnswerGenerationError,
  generateCounselResponse,
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
  recordTerminalTrace: (
    trace: CourtroomModelCallTrace,
    signal?: AbortSignal,
  ) => Promise<void>;
}>;

export type HearingModelTask =
  | "witness_answer"
  | "opponent_plan"
  | "counsel_response";

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
  | CounselResponseGenerationError;

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
  return null;
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
  let preparation = HearingCommandPreparationSchema.parse(
    await options.durableService.prepare(command, options.signal),
  );

  for (let step = 0; step < limit; step += 1) {
    if (preparation.status === "completed") {
      return HearingRuntimeViewV1Schema.parse(preparation.view);
    }

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
