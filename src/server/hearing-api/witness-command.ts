import {
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallTrace,
} from "@/domain/courtroom-ai";
import {
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingPlayerCommandSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  isHearingWitnessModelRequiredPreparation,
  type HearingCommandPreparation,
  type HearingPlayerCommand,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "@/domain/hearing-runtime";
import {
  WitnessAnswerGenerationError,
  generateWitnessAnswer,
  type CourtroomModelProvider,
} from "@/server/courtroom-ai";

export type HearingCommandDurableService = Readonly<{
  prepare: (
    command: HearingPlayerCommand,
    signal?: AbortSignal,
  ) => Promise<HearingCommandPreparation>;
  commit: (
    precommit: HearingWitnessGenerationPrecommit,
    signal?: AbortSignal,
  ) => Promise<HearingRuntimeViewV1>;
  recordTerminalTrace: (
    trace: CourtroomModelCallTrace,
    signal?: AbortSignal,
  ) => Promise<void>;
}>;

export type HearingCommandOrchestrationErrorCode =
  | "HEARING_WITNESS_GENERATION_CANCELLED"
  | "HEARING_WITNESS_GENERATION_FAILED";

export type TerminalTracePersistence = "recorded" | "failed";

/**
 * Bounded error safe for an HTTP adapter to classify. It intentionally omits
 * the role request, KnowledgeView, model candidate, validation report, trace,
 * provider error, and abort reason.
 */
export class HearingCommandOrchestrationError extends Error {
  readonly code: HearingCommandOrchestrationErrorCode;
  readonly category: "cancelled" | "generation_failed";
  readonly retryable = true;
  readonly terminalTracePersistence: TerminalTracePersistence;

  constructor(
    code: HearingCommandOrchestrationErrorCode,
    terminalTracePersistence: TerminalTracePersistence,
  ) {
    super(
      code === "HEARING_WITNESS_GENERATION_CANCELLED"
        ? "Witness response generation was cancelled."
        : "The witness response could not be generated.",
    );
    this.name = "HearingCommandOrchestrationError";
    this.code = code;
    this.category =
      code === "HEARING_WITNESS_GENERATION_CANCELLED"
        ? "cancelled"
        : "generation_failed";
    this.terminalTracePersistence = terminalTracePersistence;
  }
}

export type OrchestrateHearingCommandOptions = Readonly<{
  command: HearingPlayerCommand;
  provider: CourtroomModelProvider;
  durableService: HearingCommandDurableService;
  signal?: AbortSignal;
}>;

async function recordTerminalTraceBestEffort(
  durableService: HearingCommandDurableService,
  error: WitnessAnswerGenerationError,
): Promise<TerminalTracePersistence> {
  try {
    const trace = CourtroomModelCallTraceSchema.parse(error.trace);
    if (trace.status === "accepted") return "failed";

    // A browser disconnect may already have aborted the generation signal.
    // Auditing is a separate durable operation and must receive a fresh signal.
    const persistenceController = new AbortController();
    await durableService.recordTerminalTrace(
      trace,
      persistenceController.signal,
    );
    return "recorded";
  } catch {
    // The safe orchestration error exposes this diagnostic outcome without
    // leaking or replacing the original model-generation failure.
    return "failed";
  }
}

function safeGenerationErrorCode(
  error: WitnessAnswerGenerationError,
): HearingCommandOrchestrationErrorCode {
  return error.code === "witness_answer_cancelled"
    ? "HEARING_WITNESS_GENERATION_CANCELLED"
    : "HEARING_WITNESS_GENERATION_FAILED";
}

/**
 * Execute one high-level owner-bound hearing command without exposing a model
 * request or model audit to the browser. Convex prepares role-scoped context,
 * the provider proposes one validated answer, and Convex atomically commits
 * the accepted trace with the resulting courtroom event.
 */
export async function orchestrateHearingCommand(
  options: OrchestrateHearingCommandOptions,
): Promise<HearingRuntimeViewV1> {
  const command = HearingPlayerCommandSchema.parse(options.command);
  const preparation = HearingCommandPreparationSchema.parse(
    await options.durableService.prepare(command, options.signal),
  );

  if (preparation.status === "completed") {
    return HearingRuntimeViewV1Schema.parse(preparation.view);
  }
  if (!isHearingWitnessModelRequiredPreparation(preparation)) {
    throw new Error(
      "Witness command orchestration received a non-witness model request",
    );
  }

  let generation: Awaited<ReturnType<typeof generateWitnessAnswer>>;
  try {
    generation = await generateWitnessAnswer({
      provider: options.provider,
      request: preparation.request,
      signal: options.signal,
    });
  } catch (error) {
    if (!(error instanceof WitnessAnswerGenerationError)) throw error;

    const terminalTracePersistence = await recordTerminalTraceBestEffort(
      options.durableService,
      error,
    );
    throw new HearingCommandOrchestrationError(
      safeGenerationErrorCode(error),
      terminalTracePersistence,
    );
  }

  const precommit = HearingWitnessGenerationPrecommitSchema.parse({
    schemaVersion: HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
    trialId: preparation.request.trialId,
    callId: preparation.request.callId,
    responseId: preparation.request.responseId,
    output: generation.output,
    modelMetadata: generation.modelMetadata,
    trace: generation.trace,
  });
  const view = await options.durableService.commit(
    precommit,
    options.signal,
  );
  return HearingRuntimeViewV1Schema.parse(view);
}
