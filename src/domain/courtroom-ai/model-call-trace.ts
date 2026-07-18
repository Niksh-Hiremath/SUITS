import { z } from "zod";

export const COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION =
  "courtroom-model-call-attempt-trace.v1" as const;
export const COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION =
  "courtroom-model-call-trace.v1" as const;

const SafeIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    "Identifiers may contain only letters, numbers, dot, underscore, colon, and hyphen",
  );
const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");
const DateTimeSchema = z.string().datetime({ offset: true });
const CountSchema = z.number().int().nonnegative();
const DurationSchema = z.number().nonnegative();

function uniqueIdentifierList(maximum: number) {
  return z
    .array(SafeIdentifierSchema)
    .max(maximum)
    .superRefine((identifiers, context) => {
      const seen = new Set<string>();
      identifiers.forEach((identifier, index) => {
        if (seen.has(identifier)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate identifier: ${identifier}`,
          });
        }
        seen.add(identifier);
      });
    });
}

export const CourtroomModelSchema = z.enum([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
]);
export type CourtroomModel = z.infer<typeof CourtroomModelSchema>;

export const CourtroomModelCallClassSchema = z.enum([
  "case_compiler",
  "opponent_planner",
  "role_responder",
  "objection_resolver",
  "negotiation_agent",
  "debrief_generator",
]);
export type CourtroomModelCallClass = z.infer<
  typeof CourtroomModelCallClassSchema
>;

export const CourtroomModelCallTaskSchema = z.enum([
  "compile_case",
  "plan_opponent",
  "witness_answer",
  "counsel_response",
  "judge_response",
  "jury_deliberation",
  "resolve_objection",
  "evaluate_settlement",
  "generate_debrief",
]);
export type CourtroomModelCallTask = z.infer<
  typeof CourtroomModelCallTaskSchema
>;

const permittedTasksByCallClass: Readonly<
  Record<CourtroomModelCallClass, readonly CourtroomModelCallTask[]>
> = {
  case_compiler: ["compile_case"],
  opponent_planner: ["plan_opponent"],
  role_responder: [
    "witness_answer",
    "counsel_response",
    "judge_response",
    "jury_deliberation",
  ],
  objection_resolver: ["resolve_objection"],
  negotiation_agent: ["evaluate_settlement"],
  debrief_generator: ["generate_debrief"],
};

export const CourtroomModelTokenUsageSchema = z
  .object({
    inputTokens: CountSchema,
    outputTokens: CountSchema,
    totalTokens: CountSchema,
    cachedInputTokens: CountSchema,
    cacheWriteTokens: CountSchema,
    reasoningTokens: CountSchema,
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      context.addIssue({
        code: "custom",
        path: ["totalTokens"],
        message: "Total tokens must equal input tokens plus output tokens",
      });
    }
    if (usage.cachedInputTokens > usage.inputTokens) {
      context.addIssue({
        code: "custom",
        path: ["cachedInputTokens"],
        message: "Cached input tokens cannot exceed input tokens",
      });
    }
    if (usage.reasoningTokens > usage.outputTokens) {
      context.addIssue({
        code: "custom",
        path: ["reasoningTokens"],
        message: "Reasoning tokens cannot exceed output tokens",
      });
    }
  });
export type CourtroomModelTokenUsage = z.infer<
  typeof CourtroomModelTokenUsageSchema
>;

export const CourtroomModelCallCitationSetSchema = z
  .object({
    factIds: uniqueIdentifierList(128),
    evidenceIds: uniqueIdentifierList(128),
    testimonyIds: uniqueIdentifierList(128),
    eventIds: uniqueIdentifierList(128),
    sourceSegmentIds: uniqueIdentifierList(128),
    priorStatementIds: uniqueIdentifierList(128),
  })
  .strict();
export type CourtroomModelCallCitationSet = z.infer<
  typeof CourtroomModelCallCitationSetSchema
>;

export const CourtroomModelKnowledgeScopeAuditSchema = z
  .object({
    knowledgeSchemaVersion: SafeIdentifierSchema.nullable(),
    knowledgeViewHash: Sha256Schema.nullable(),
    stateVersion: CountSchema.nullable(),
    factCount: CountSchema,
    evidenceCount: CountSchema,
    testimonyCount: CountSchema,
    priorStatementCount: CountSchema,
    sourceSegmentCount: CountSchema,
    publicRecordEventCount: CountSchema,
    currentExchangeCount: CountSchema,
  })
  .strict()
  .superRefine((scope, context) => {
    const knowledgeIdentity = [
      scope.knowledgeSchemaVersion,
      scope.knowledgeViewHash,
      scope.stateVersion,
    ];
    const populatedIdentityFields = knowledgeIdentity.filter(
      (value) => value !== null,
    ).length;
    if (populatedIdentityFields !== 0 && populatedIdentityFields !== 3) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeViewHash"],
        message:
          "Knowledge schema version, view hash, and state version must be populated together",
      });
    }
  });
export type CourtroomModelKnowledgeScopeAudit = z.infer<
  typeof CourtroomModelKnowledgeScopeAuditSchema
>;

export const CourtroomModelPromptAuditSchema = z
  .object({
    stablePrefixHash: Sha256Schema,
    trustedContextHash: Sha256Schema,
    untrustedInputHash: Sha256Schema,
    inputCharacterCount: CountSchema,
  })
  .strict();
export type CourtroomModelPromptAudit = z.infer<
  typeof CourtroomModelPromptAuditSchema
>;

export const CourtroomModelCallAttemptStatusSchema = z.enum([
  "accepted",
  "validation_failed",
  "provider_failed",
  "cancelled",
  "stale",
]);

export const CourtroomModelCallAttemptTraceSchema = z
  .object({
    schemaVersion: z.literal(
      COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
    ),
    attempt: z.number().int().positive(),
    mode: z.enum(["initial", "repair"]),
    status: CourtroomModelCallAttemptStatusSchema,
    providerRequestId: SafeIdentifierSchema.nullable(),
    providerResponseId: SafeIdentifierSchema.nullable(),
    startedAt: DateTimeSchema,
    completedAt: DateTimeSchema,
    latencyMs: DurationSchema,
    firstStructuredDeltaMs: DurationSchema.nullable(),
    streamEventCount: CountSchema,
    structuredDeltaCount: CountSchema,
    streamedCharacterCount: CountSchema,
    outputHash: Sha256Schema.nullable(),
    proposedCitationCount: CountSchema,
    usage: CourtroomModelTokenUsageSchema.nullable(),
    validationIssueCodes: z.array(SafeIdentifierSchema).max(64),
    safeErrorCode: SafeIdentifierSchema.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Attempt completion cannot precede its start",
      });
    }
    if (
      attempt.firstStructuredDeltaMs !== null &&
      attempt.firstStructuredDeltaMs > attempt.latencyMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["firstStructuredDeltaMs"],
        message: "First structured delta cannot occur after attempt completion",
      });
    }
    if (
      (attempt.status === "accepted" ||
        attempt.status === "validation_failed") &&
      attempt.outputHash === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["outputHash"],
        message: "A parsed model candidate must retain its redacted output hash",
      });
    }
    if (
      attempt.status === "validation_failed" &&
      attempt.validationIssueCodes.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["validationIssueCodes"],
        message: "A validation failure must retain at least one safe issue code",
      });
    }
    if (
      (attempt.status === "provider_failed" ||
        attempt.status === "cancelled" ||
        attempt.status === "stale") &&
      attempt.safeErrorCode === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["safeErrorCode"],
        message: "A failed, cancelled, or stale attempt requires a safe error code",
      });
    }
  });
export type CourtroomModelCallAttemptTrace = z.infer<
  typeof CourtroomModelCallAttemptTraceSchema
>;

export const CourtroomModelCallStatusSchema = z.enum([
  "in_progress",
  "accepted",
  "failed",
  "cancelled",
  "stale",
]);

export const CourtroomModelCallTraceSchema = z
  .object({
    schemaVersion: z.literal(COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION),
    callId: SafeIdentifierSchema,
    trialId: SafeIdentifierSchema.nullable(),
    responseId: SafeIdentifierSchema.nullable(),
    actorId: SafeIdentifierSchema.nullable(),
    actorRole: z
      .enum(["witness", "counsel", "judge", "jury", "debrief", "system"])
      .nullable(),
    callClass: CourtroomModelCallClassSchema,
    task: CourtroomModelCallTaskSchema,
    inputEventIds: uniqueIdentifierList(128),
    expectedStateVersion: CountSchema.nullable(),
    expectedLastEventId: SafeIdentifierSchema.nullable(),
    provider: SafeIdentifierSchema,
    model: CourtroomModelSchema,
    providerProtocolVersion: SafeIdentifierSchema,
    promptVersion: SafeIdentifierSchema,
    outputSchemaVersion: SafeIdentifierSchema,
    knowledgeScope: CourtroomModelKnowledgeScopeAuditSchema,
    promptAudit: CourtroomModelPromptAuditSchema,
    status: CourtroomModelCallStatusSchema,
    startedAt: DateTimeSchema,
    completedAt: DateTimeSchema.nullable(),
    latencyMs: DurationSchema.nullable(),
    firstStructuredDeltaMs: DurationSchema.nullable(),
    firstAcceptedSegmentMs: DurationSchema.nullable(),
    retryCount: CountSchema,
    validationFailureCount: CountSchema,
    estimatedCostUsd: z.number().nonnegative().nullable(),
    usage: CourtroomModelTokenUsageSchema.nullable(),
    acceptedAttempt: z.number().int().positive().nullable(),
    acceptedCitations: CourtroomModelCallCitationSetSchema,
    acceptedCitationCount: CountSchema,
    outputHash: Sha256Schema.nullable(),
    outputCharacterCount: CountSchema,
    committedActionId: SafeIdentifierSchema.nullable(),
    committedEventId: SafeIdentifierSchema.nullable(),
    safeFailureCode: SafeIdentifierSchema.nullable(),
    attempts: z.array(CourtroomModelCallAttemptTraceSchema).max(4),
  })
  .strict()
  .superRefine((trace, context) => {
    if (!permittedTasksByCallClass[trace.callClass].includes(trace.task)) {
      context.addIssue({
        code: "custom",
        path: ["task"],
        message: `Task ${trace.task} is not valid for ${trace.callClass}`,
      });
    }

    const expectedModel =
      trace.task === "compile_case" || trace.task === "generate_debrief"
        ? "gpt-5.6-terra"
        : "gpt-5.6-luna";
    if (trace.model !== expectedModel) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: `${trace.task} must use ${expectedModel}`,
      });
    }

    const hasKnowledgeIdentity = trace.knowledgeScope.knowledgeViewHash !== null;
    if (trace.callClass === "case_compiler" && hasKnowledgeIdentity) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeScope", "knowledgeViewHash"],
        message: "Case compilation does not consume a courtroom KnowledgeView",
      });
    }
    if (trace.callClass !== "case_compiler" && !hasKnowledgeIdentity) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeScope", "knowledgeViewHash"],
        message: "Courtroom calls must retain a KnowledgeView hash",
      });
    }

    const terminal = trace.status !== "in_progress";
    if (
      terminal !==
      (trace.completedAt !== null && trace.latencyMs !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message:
          "Terminal calls require completion timing; in-progress calls must omit it",
      });
    }
    if (
      trace.completedAt !== null &&
      Date.parse(trace.completedAt) < Date.parse(trace.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Call completion cannot precede its start",
      });
    }
    for (const [field, value] of [
      ["firstStructuredDeltaMs", trace.firstStructuredDeltaMs],
      ["firstAcceptedSegmentMs", trace.firstAcceptedSegmentMs],
    ] as const) {
      if (value !== null && trace.latencyMs !== null && value > trace.latencyMs) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} cannot occur after call completion`,
        });
      }
    }
    if (
      trace.firstAcceptedSegmentMs !== null &&
      trace.firstStructuredDeltaMs !== null &&
      trace.firstAcceptedSegmentMs < trace.firstStructuredDeltaMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["firstAcceptedSegmentMs"],
        message: "An accepted segment cannot precede the first structured delta",
      });
    }

    trace.attempts.forEach((attempt, index) => {
      if (attempt.attempt !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index, "attempt"],
          message: "Attempts must be numbered contiguously from one",
        });
      }
      if (
        (index === 0 && attempt.mode !== "initial") ||
        (index > 0 && attempt.mode !== "repair")
      ) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index, "mode"],
          message: "The first attempt is initial and later attempts are repairs",
        });
      }
    });

    if (trace.retryCount !== Math.max(0, trace.attempts.length - 1)) {
      context.addIssue({
        code: "custom",
        path: ["retryCount"],
        message: "Retry count must equal completed attempts after the first",
      });
    }
    const validationFailures = trace.attempts.filter(
      (attempt) => attempt.status === "validation_failed",
    ).length;
    if (trace.validationFailureCount !== validationFailures) {
      context.addIssue({
        code: "custom",
        path: ["validationFailureCount"],
        message: "Validation failure count must match attempt outcomes",
      });
    }

    const citationCount = Object.values(trace.acceptedCitations).reduce(
      (total, identifiers) => total + identifiers.length,
      0,
    );
    if (trace.acceptedCitationCount !== citationCount) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCitationCount"],
        message: "Accepted citation count must match the redacted citation sets",
      });
    }

    if (trace.status === "accepted") {
      const acceptedAttempt = trace.attempts.find(
        (attempt) => attempt.attempt === trace.acceptedAttempt,
      );
      if (acceptedAttempt?.status !== "accepted") {
        context.addIssue({
          code: "custom",
          path: ["acceptedAttempt"],
          message: "Accepted calls must identify an accepted attempt",
        });
      }
      if (trace.outputHash === null) {
        context.addIssue({
          code: "custom",
          path: ["outputHash"],
          message: "Accepted calls must retain a redacted output hash",
        });
      }
    } else if (trace.acceptedAttempt !== null) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAttempt"],
        message: "Only accepted calls may identify an accepted attempt",
      });
    }

    if (
      (trace.status === "failed" ||
        trace.status === "cancelled" ||
        trace.status === "stale") &&
      trace.safeFailureCode === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["safeFailureCode"],
        message: "Terminal unsuccessful calls require a safe failure code",
      });
    }
  });
export type CourtroomModelCallTrace = z.infer<
  typeof CourtroomModelCallTraceSchema
>;
