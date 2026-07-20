import { v } from "convex/values";

import { sha256Utf8 } from "../src/domain/case-graph/hash";
import {
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DebriefGeneratorModelOutputSchema,
  JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JuryRoleResponseModelOutputSchema,
  type DebriefGeneratorModelOutput,
  type JuryRoleResponseModelOutput,
} from "../src/domain/courtroom-ai/call-contracts";
import {
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallAttemptTrace,
  type CourtroomModelCallTrace,
} from "../src/domain/courtroom-ai/model-call-trace";
import {
  debriefGeneratorCitedTranscriptTurnIds,
  debriefGeneratorOutputCitations,
  hashDebriefGeneratorModelOutput,
  hashJuryResponseModelOutput,
  juryResponseOutputCitations,
} from "../src/domain/hearing-runtime/model-boundary";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TRIAL_EVENT_SCHEMA_VERSION_V3,
  TRIAL_STATE_SCHEMA_VERSION_V3,
  TrialEventV3Schema,
  TrialStateV3Schema,
  type TrialEventV3,
  type TrialStateV3,
} from "../src/domain/trial-engine";
import type { Doc } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { CaseServiceOwnerIdSchema } from "./caseServiceBoundary";

const MAX_ARTIFACT_JSON_CHARACTERS = 512_000;
const MAX_TRACE_JSON_CHARACTERS = 512_000;
const MAX_PROJECTION_JSON_CHARACTERS = 2_000_000;
const MAX_GENERATED_ARTIFACTS_PER_TRIAL = 2;
const JURY_PROMPT_VERSION = "role-responder.jury.prompt.v1";
const DEBRIEF_PROMPT_VERSION = "debrief-generator.prompt.v1";

type ArtifactKind = "jury_deliberation" | "final_debrief";

type InternalArtifactMetadata = Readonly<{
  artifactId: string;
  trialId: string;
  callId: string;
  actionId: string;
  eventId: string;
  sourceStateVersion: number;
  sourceLastEventId: string;
  committedStateVersion: number;
  artifactHash: string;
  artifactSchemaVersion: string;
  promptVersion: string;
  model: "gpt-5.6-luna" | "gpt-5.6-terra";
  createdAt: number;
}>;

/**
 * INTERNAL ONLY. The raw jury artifact may contain jury-private reasoning and
 * the raw debrief may contain hidden/excluded audit strata. A server caller
 * must pass either artifact through the privacy projector before returning it
 * to a browser or any other public boundary.
 */
export type InternalCourtroomGeneratedArtifact =
  | Readonly<{
      artifactKind: "jury_deliberation";
      privacyProjectionRequired: true;
      decisionId: string;
      metadata: InternalArtifactMetadata;
      artifact: JuryRoleResponseModelOutput;
    }>
  | Readonly<{
      artifactKind: "final_debrief";
      privacyProjectionRequired: true;
      decisionId: null;
      metadata: InternalArtifactMetadata;
      artifact: DebriefGeneratorModelOutput;
    }>;

export type InternalCourtroomGeneratedArtifactList =
  readonly InternalCourtroomGeneratedArtifact[];

type AcceptedTrace = CourtroomModelCallTrace & {
  trialId: string;
  actorId: string;
  status: "accepted";
  completedAt: string;
  latencyMs: number;
  outputHash: string;
  committedActionId: string;
  committedEventId: string;
};

function invalidArtifact(): never {
  throw new Error("COURTROOM_GENERATED_ARTIFACT_INVALID");
}

function invalidAudit(): never {
  throw new Error("COURTROOM_GENERATED_ARTIFACT_AUDIT_INVALID");
}

function parseBoundedJson(value: string, maximum: number): unknown {
  if (value.length === 0 || value.length > maximum) return invalidArtifact();
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalidArtifact();
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : invalidAudit();
}

function requireOwnedV3Projection(
  projection: Doc<"trialProjections"> | null,
  ownerId: string,
  trialId: string,
): TrialStateV3 {
  if (!projection || projection.ownerId !== ownerId) {
    throw new Error("TRIAL_NOT_FOUND");
  }
  if (
    projection.stateSchemaVersion !== TRIAL_STATE_SCHEMA_VERSION_V3 ||
    projection.eventSchemaVersion !== TRIAL_EVENT_SCHEMA_VERSION_V3
  ) {
    throw new Error("TRIAL_MIGRATION_REQUIRED");
  }
  const stateJson = projection.stateJson;
  if (
    stateJson.length === 0 ||
    stateJson.length > MAX_PROJECTION_JSON_CHARACTERS
  ) {
    throw new Error("TRIAL_PROJECTION_INVALID");
  }
  let stateInput: unknown;
  try {
    stateInput = JSON.parse(stateJson) as unknown;
  } catch {
    throw new Error("TRIAL_PROJECTION_INVALID");
  }
  const parsed = TrialStateV3Schema.safeParse(stateInput);
  if (!parsed.success) throw new Error("TRIAL_PROJECTION_INVALID");
  const state = parsed.data;
  if (
    state.trialId !== trialId ||
    state.version !== projection.stateVersion ||
    state.lastSequence !== projection.lastSequence ||
    state.eventIds.length !== state.lastSequence ||
    state.committedActionIds.length !== state.lastSequence ||
    new Set(state.eventIds).size !== state.eventIds.length ||
    new Set(state.committedActionIds).size !==
      state.committedActionIds.length ||
    state.eventIds.at(-1) === undefined ||
    state.deliberated !== (state.verdictId !== null) ||
    (state.debriefId !== null &&
      (state.phase !== "complete" || state.status !== "complete")) ||
    ((state.phase === "complete" || state.status === "complete") &&
      state.debriefId === null)
  ) {
    throw new Error("TRIAL_PROJECTION_INVALID");
  }
  return state;
}

function modelMetadataForStoredEvent(row: Doc<"trialEvents">) {
  if (!row.model) {
    if (
      row.promptVersion !== undefined ||
      row.modelRequestId !== undefined ||
      row.modelSchemaVersion !== undefined ||
      row.modelLatencyMs !== undefined ||
      row.inputTokens !== undefined ||
      row.outputTokens !== undefined ||
      row.estimatedCostUsd !== undefined ||
      row.retryCount !== undefined ||
      row.validationFailureCount !== undefined
    ) {
      return invalidAudit();
    }
    return null;
  }
  if (!row.promptVersion || !row.modelSchemaVersion) return invalidAudit();
  return {
    model: row.model,
    requestId: row.modelRequestId ?? null,
    promptVersion: row.promptVersion,
    schemaVersion: row.modelSchemaVersion,
    latencyMs: row.modelLatencyMs ?? null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    estimatedCostUsd: row.estimatedCostUsd ?? null,
    retryCount: row.retryCount ?? 0,
    validationFailureCount: row.validationFailureCount ?? 0,
  };
}

function storedEvent(row: Doc<"trialEvents">): TrialEventV3 {
  if (
    row.eventSchemaVersion !== TRIAL_EVENT_SCHEMA_VERSION_V3 ||
    row.payloadSchemaVersion !== TRIAL_ACTION_SCHEMA_VERSION_V3
  ) {
    throw new Error("TRIAL_MIGRATION_REQUIRED");
  }
  const parsed = TrialEventV3Schema.safeParse({
    schemaVersion: row.eventSchemaVersion,
    eventId: row.eventId,
    trialId: row.trialId,
    sequence: row.sequence,
    stateVersion: row.stateVersion,
    actionId: row.actionId,
    actor: {
      actorId: row.actorId,
      role: row.actorRole,
      side: row.actorSide,
      witnessId: row.witnessId ?? null,
    },
    source: row.source,
    occurredAt: row.occurredAtIso ?? new Date(row.occurredAt).toISOString(),
    causationId: row.causationId ?? null,
    correlationId: row.correlationId ?? null,
    responseId: row.responseId ?? null,
    interruptId: row.interruptId ?? null,
    modelMetadata: modelMetadataForStoredEvent(row),
    citations: {
      factIds: row.factIds,
      evidenceIds: row.evidenceIds,
      testimonyIds: row.testimonyIds,
      eventIds: row.citationEventIds,
      sourceSegmentIds: row.sourceSegmentIds,
    },
    type: row.eventType,
    payload: parseBoundedJson(
      row.payloadJson,
      MAX_ARTIFACT_JSON_CHARACTERS,
    ),
  });
  return parsed.success ? parsed.data : invalidAudit();
}

function parseAcceptedTrace(row: Doc<"courtroomModelCalls">): AcceptedTrace {
  if (
    row.traceJson.length === 0 ||
    row.traceJson.length > MAX_TRACE_JSON_CHARACTERS
  ) {
    return invalidAudit();
  }
  let traceInput: unknown;
  try {
    traceInput = JSON.parse(row.traceJson) as unknown;
  } catch {
    return invalidAudit();
  }
  const parsed = CourtroomModelCallTraceSchema.safeParse(traceInput);
  if (!parsed.success) return invalidAudit();
  const trace = parsed.data;
  if (
    trace.trialId === null ||
    trace.actorId === null ||
    trace.status !== "accepted" ||
    trace.completedAt === null ||
    trace.latencyMs === null ||
    trace.outputHash === null ||
    trace.committedActionId === null ||
    trace.committedEventId === null ||
    row.traceJson !== JSON.stringify(trace)
  ) {
    return invalidAudit();
  }
  return trace as AcceptedTrace;
}

function storedAttemptMatchesTrace(
  row: Doc<"courtroomModelCallAttempts">,
  attempt: CourtroomModelCallAttemptTrace | undefined,
  ownerId: string,
  trialId: string,
): boolean {
  if (!attempt) return false;
  return (
    row.ownerId === ownerId &&
    row.trialId === trialId &&
    row.attempt === attempt.attempt &&
    row.mode === attempt.mode &&
    row.status === attempt.status &&
    row.providerRequestId === attempt.providerRequestId &&
    row.providerResponseId === attempt.providerResponseId &&
    row.startedAt === timestamp(attempt.startedAt) &&
    row.completedAt === timestamp(attempt.completedAt) &&
    row.latencyMs === attempt.latencyMs &&
    row.firstStructuredDeltaMs === attempt.firstStructuredDeltaMs &&
    row.streamEventCount === attempt.streamEventCount &&
    row.structuredDeltaCount === attempt.structuredDeltaCount &&
    row.streamedCharacterCount === attempt.streamedCharacterCount &&
    row.outputHash === attempt.outputHash &&
    row.proposedCitationCount === attempt.proposedCitationCount &&
    row.inputTokens === (attempt.usage?.inputTokens ?? null) &&
    row.outputTokens === (attempt.usage?.outputTokens ?? null) &&
    row.totalTokens === (attempt.usage?.totalTokens ?? null) &&
    row.cachedInputTokens === (attempt.usage?.cachedInputTokens ?? null) &&
    row.cacheWriteTokens === (attempt.usage?.cacheWriteTokens ?? null) &&
    row.reasoningTokens === (attempt.usage?.reasoningTokens ?? null) &&
    row.safeErrorCode === attempt.safeErrorCode &&
    row.schemaVersion === attempt.schemaVersion
  );
}

function callRowMatchesTrace(
  row: Doc<"courtroomModelCalls">,
  trace: AcceptedTrace,
  ownerId: string,
  trialId: string,
): boolean {
  return (
    row.ownerId === ownerId &&
    row.trialId === trialId &&
    row.callId === trace.callId &&
    row.responseId === trace.responseId &&
    row.actorId === trace.actorId &&
    row.actorRole === trace.actorRole &&
    row.callClass === trace.callClass &&
    row.task === trace.task &&
    row.status === trace.status &&
    row.provider === trace.provider &&
    row.model === trace.model &&
    row.promptVersion === trace.promptVersion &&
    row.outputSchemaVersion === trace.outputSchemaVersion &&
    row.startedAt === timestamp(trace.startedAt) &&
    row.completedAt === timestamp(trace.completedAt) &&
    row.latencyMs === trace.latencyMs &&
    row.attemptCount === trace.attempts.length &&
    row.retryCount === trace.retryCount &&
    row.validationFailureCount === trace.validationFailureCount &&
    row.acceptedCitationCount === trace.acceptedCitationCount &&
    row.outputCharacterCount === trace.outputCharacterCount &&
    row.schemaVersion === trace.schemaVersion
  );
}

async function requireAcceptedCallAudit(
  ctx: Pick<QueryCtx, "db">,
  artifact: Doc<"courtroomGeneratedArtifacts">,
): Promise<Readonly<{ trace: AcceptedTrace; acceptedAttempt: CourtroomModelCallAttemptTrace }>> {
  const row = await ctx.db
    .query("courtroomModelCalls")
    .withIndex("by_call_id", (index) => index.eq("callId", artifact.callId))
    .unique();
  if (!row) return invalidAudit();
  const trace = parseAcceptedTrace(row);
  if (!callRowMatchesTrace(row, trace, artifact.ownerId, artifact.trialId)) {
    return invalidAudit();
  }
  const attemptRows = await ctx.db
    .query("courtroomModelCallAttempts")
    .withIndex("by_call_attempt", (index) =>
      index.eq("callId", artifact.callId),
    )
    .take(5);
  const orderedAttemptRows = [...attemptRows].sort(
    (left, right) => left.attempt - right.attempt,
  );
  if (
    orderedAttemptRows.length !== trace.attempts.length ||
    orderedAttemptRows.some((attempt, index) =>
      !storedAttemptMatchesTrace(
        attempt,
        trace.attempts[index],
        artifact.ownerId,
        artifact.trialId,
      ),
    )
  ) {
    return invalidAudit();
  }
  const acceptedAttempt = trace.attempts.find(
    (attempt) => attempt.attempt === trace.acceptedAttempt,
  );
  if (
    trace.attempts.filter(({ status }) => status === "accepted").length !== 1 ||
    !acceptedAttempt ||
    acceptedAttempt.status !== "accepted" ||
    acceptedAttempt.outputHash === null
  ) {
    return invalidAudit();
  }
  return { trace, acceptedAttempt };
}

function expectedArtifactIdentity(
  row: Doc<"courtroomGeneratedArtifacts">,
):
  | Readonly<{
      artifactKind: "jury_deliberation";
      artifactId: string;
      actionId: string;
      verdictPhaseActionId: string;
      verdictActionId: string;
      debriefPhaseActionId: string;
      verdictId: string;
    }>
  | Readonly<{
      artifactKind: "final_debrief";
      artifactId: string;
      actionId: string;
      completePhaseActionId: string;
    }> {
  if (row.artifactKind === "jury_deliberation") {
    if (row.decisionId === null) return invalidArtifact();
    const material = JSON.stringify({
      trialId: row.trialId,
      decisionId: row.decisionId,
    });
    return {
      artifactKind: "jury_deliberation",
      artifactId: `artifact:jury:${sha256Utf8(material)}`,
      actionId: `action:jury-deliberation:${sha256Utf8(material)}`,
      verdictPhaseActionId: `action:phase-verdict:${sha256Utf8(material)}`,
      verdictActionId: `action:render-verdict:${sha256Utf8(material)}`,
      debriefPhaseActionId: `action:phase-debrief:${sha256Utf8(material)}`,
      verdictId: `verdict:jury:${sha256Utf8(material)}`,
    };
  }
  if (row.decisionId !== null) return invalidArtifact();
  const material = JSON.stringify({
    trialId: row.trialId,
    sourceStateVersion: row.sourceStateVersion,
    sourceLastEventId: row.sourceLastEventId,
  });
  return {
    artifactKind: "final_debrief",
    artifactId: `debrief:final:${sha256Utf8(material)}`,
    actionId: `action:debrief-generation:${sha256Utf8(material)}`,
    completePhaseActionId: `action:phase-complete:${sha256Utf8(
      JSON.stringify({
        trialId: row.trialId,
        debriefId: `debrief:final:${sha256Utf8(material)}`,
      }),
    )}`,
  };
}

function artifactMetadata(
  row: Doc<"courtroomGeneratedArtifacts">,
): InternalArtifactMetadata {
  return {
    artifactId: row.artifactId,
    trialId: row.trialId,
    callId: row.callId,
    actionId: row.actionId,
    eventId: row.eventId,
    sourceStateVersion: row.sourceStateVersion,
    sourceLastEventId: row.sourceLastEventId,
    committedStateVersion: row.committedStateVersion,
    artifactHash: row.artifactHash,
    artifactSchemaVersion: row.artifactSchemaVersion,
    promptVersion: row.promptVersion,
    model: row.model,
    createdAt: row.createdAt,
  };
}

async function requireStoredEvent(
  ctx: Pick<QueryCtx, "db">,
  eventId: string,
): Promise<TrialEventV3> {
  const row = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) => index.eq("eventId", eventId))
    .unique();
  return row ? storedEvent(row) : invalidAudit();
}

function eventOccupiesProjectionPosition(
  state: TrialStateV3,
  event: TrialEventV3,
): boolean {
  return (
    state.eventIds[event.sequence - 1] === event.eventId &&
    state.committedActionIds[event.sequence - 1] === event.actionId
  );
}

function sameOrderedIdentifiers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identifier, index) => identifier === right[index])
  );
}

function sameCallCitations(
  left: CourtroomModelCallTrace["acceptedCitations"],
  right: CourtroomModelCallTrace["acceptedCitations"],
): boolean {
  return (
    sameOrderedIdentifiers(left.factIds, right.factIds) &&
    sameOrderedIdentifiers(left.evidenceIds, right.evidenceIds) &&
    sameOrderedIdentifiers(left.testimonyIds, right.testimonyIds) &&
    sameOrderedIdentifiers(left.eventIds, right.eventIds) &&
    sameOrderedIdentifiers(left.sourceSegmentIds, right.sourceSegmentIds) &&
    sameOrderedIdentifiers(left.priorStatementIds, right.priorStatementIds)
  );
}

function citationCount(
  citations: CourtroomModelCallTrace["acceptedCitations"],
): number {
  return Object.values(citations).reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
}

function verdictCitationsMatchJuryAudit(
  citations: TrialEventV3["citations"],
  expected: CourtroomModelCallTrace["acceptedCitations"],
): boolean {
  return (
    sameOrderedIdentifiers(citations.factIds, expected.factIds) &&
    sameOrderedIdentifiers(citations.evidenceIds, expected.evidenceIds) &&
    sameOrderedIdentifiers(citations.testimonyIds, expected.testimonyIds) &&
    citations.eventIds.length === 0 &&
    citations.sourceSegmentIds.length === 0
  );
}

function isDeterministicJudgeContinuation(
  event: TrialEventV3,
  input: Readonly<{
    trialId: string;
    sequence: number;
    stateVersion: number;
    actionId: string;
    causationId: string;
    occurredAt: number;
  }>,
): boolean {
  return (
    event.eventId === `event:${input.actionId}` &&
    event.trialId === input.trialId &&
    event.sequence === input.sequence &&
    event.stateVersion === input.stateVersion &&
    event.actionId === input.actionId &&
    event.actor.role === "judge" &&
    event.actor.side === "neutral" &&
    event.actor.witnessId === null &&
    event.source === "deterministic" &&
    event.causationId === input.causationId &&
    event.correlationId === input.trialId &&
    event.responseId === null &&
    event.interruptId === null &&
    event.modelMetadata === null &&
    timestamp(event.occurredAt) === input.occurredAt
  );
}

async function requireJuryLifecycle(
  ctx: Pick<QueryCtx, "db">,
  state: TrialStateV3,
  row: Doc<"courtroomGeneratedArtifacts">,
  primary: Extract<TrialEventV3, { type: "DELIBERATE" }>,
  identity: Extract<
    ReturnType<typeof expectedArtifactIdentity>,
    { artifactKind: "jury_deliberation" }
  >,
  artifact: JuryRoleResponseModelOutput,
): Promise<void> {
  const acceptedCitations = juryResponseOutputCitations(artifact);
  const verdictPhase = await requireStoredEvent(
    ctx,
    `event:${identity.verdictPhaseActionId}`,
  );
  const verdict = await requireStoredEvent(
    ctx,
    `event:${identity.verdictActionId}`,
  );
  const debriefPhase = await requireStoredEvent(
    ctx,
    `event:${identity.debriefPhaseActionId}`,
  );
  const base = row.createdAt;
  if (
    state.verdictId !== identity.verdictId ||
    !eventOccupiesProjectionPosition(state, verdictPhase) ||
    !eventOccupiesProjectionPosition(state, verdict) ||
    !eventOccupiesProjectionPosition(state, debriefPhase) ||
    !isDeterministicJudgeContinuation(verdictPhase, {
      trialId: row.trialId,
      sequence: primary.sequence + 1,
      stateVersion: primary.stateVersion + 1,
      actionId: identity.verdictPhaseActionId,
      causationId: primary.eventId,
      occurredAt: base + 1,
    }) ||
    verdictPhase.type !== "BEGIN_PHASE" ||
    verdictPhase.payload.phase !== "verdict" ||
    !isDeterministicJudgeContinuation(verdict, {
      trialId: row.trialId,
      sequence: primary.sequence + 2,
      stateVersion: primary.stateVersion + 2,
      actionId: identity.verdictActionId,
      causationId: verdictPhase.eventId,
      occurredAt: base + 2,
    }) ||
    verdict.type !== "RENDER_VERDICT" ||
    verdict.payload.verdictId !== identity.verdictId ||
    verdict.payload.decision !== artifact.recommendation.decision ||
    !verdictCitationsMatchJuryAudit(
      verdict.payload.citations,
      acceptedCitations,
    ) ||
    !verdictCitationsMatchJuryAudit(verdict.citations, acceptedCitations) ||
    !isDeterministicJudgeContinuation(debriefPhase, {
      trialId: row.trialId,
      sequence: primary.sequence + 3,
      stateVersion: primary.stateVersion + 3,
      actionId: identity.debriefPhaseActionId,
      causationId: verdict.eventId,
      occurredAt: base + 3,
    }) ||
    debriefPhase.type !== "BEGIN_PHASE" ||
    debriefPhase.payload.phase !== "debrief" ||
    verdictPhase.actor.actorId !== verdict.actor.actorId ||
    verdictPhase.actor.actorId !== debriefPhase.actor.actorId
  ) {
    return invalidAudit();
  }
}

async function requireDebriefLifecycle(
  ctx: Pick<QueryCtx, "db">,
  state: TrialStateV3,
  row: Doc<"courtroomGeneratedArtifacts">,
  primary: Extract<TrialEventV3, { type: "GENERATE_DEBRIEF" }>,
  identity: Extract<
    ReturnType<typeof expectedArtifactIdentity>,
    { artifactKind: "final_debrief" }
  >,
): Promise<void> {
  const completePhase = await requireStoredEvent(
    ctx,
    `event:${identity.completePhaseActionId}`,
  );
  if (
    state.phase !== "complete" ||
    state.status !== "complete" ||
    !eventOccupiesProjectionPosition(state, completePhase) ||
    !isDeterministicJudgeContinuation(completePhase, {
      trialId: row.trialId,
      sequence: primary.sequence + 1,
      stateVersion: primary.stateVersion + 1,
      actionId: identity.completePhaseActionId,
      causationId: primary.eventId,
      occurredAt: row.createdAt + 1,
    }) ||
    completePhase.type !== "BEGIN_PHASE" ||
    completePhase.payload.phase !== "complete"
  ) {
    return invalidAudit();
  }
}

async function readStrictArtifact(
  ctx: Pick<QueryCtx, "db">,
  state: TrialStateV3,
  row: Doc<"courtroomGeneratedArtifacts">,
): Promise<InternalCourtroomGeneratedArtifact> {
  const [artifactIdRows, artifactCallRows, artifactEventRows] =
    await Promise.all([
      ctx.db
        .query("courtroomGeneratedArtifacts")
        .withIndex("by_artifact_id", (index) =>
          index.eq("artifactId", row.artifactId),
        )
        .take(2),
      ctx.db
        .query("courtroomGeneratedArtifacts")
        .withIndex("by_call_id", (index) => index.eq("callId", row.callId))
        .take(2),
      ctx.db
        .query("courtroomGeneratedArtifacts")
        .withIndex("by_trial_event", (index) =>
          index.eq("trialId", row.trialId).eq("eventId", row.eventId),
        )
        .take(2),
    ]);
  if (
    artifactIdRows.length !== 1 ||
    artifactIdRows[0]?._id !== row._id ||
    artifactCallRows.length !== 1 ||
    artifactCallRows[0]?._id !== row._id ||
    artifactEventRows.length !== 1 ||
    artifactEventRows[0]?._id !== row._id
  ) {
    throw new Error("COURTROOM_GENERATED_ARTIFACT_DUPLICATE");
  }
  const identity = expectedArtifactIdentity(row);
  if (
    identity.artifactKind !== row.artifactKind ||
    row.artifactId !== identity.artifactId ||
    row.actionId !== identity.actionId ||
    row.eventId !== `event:${row.actionId}` ||
    row.sourceStateVersion + 1 !== row.committedStateVersion ||
    row.committedStateVersion > state.version
  ) {
    return invalidArtifact();
  }
  const primaryRow = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) => index.eq("eventId", row.eventId))
    .unique();
  const sourceRow = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) =>
      index.eq("eventId", row.sourceLastEventId),
    )
    .unique();
  if (!primaryRow || !sourceRow) return invalidAudit();
  const primary = storedEvent(primaryRow);
  const source = storedEvent(sourceRow);
  const expectedType =
    row.artifactKind === "jury_deliberation"
      ? "DELIBERATE"
      : "GENERATE_DEBRIEF";
  if (
    primary.trialId !== row.trialId ||
    primary.eventId !== row.eventId ||
    primary.actionId !== row.actionId ||
    primary.type !== expectedType ||
    primary.stateVersion !== row.committedStateVersion ||
    primary.sequence !== source.sequence + 1 ||
    primary.causationId !== row.sourceLastEventId ||
    primary.correlationId !== row.trialId ||
    primary.source !== "ai" ||
    primary.responseId !== null ||
    primary.interruptId !== null ||
    primary.modelMetadata === null ||
    timestamp(primary.occurredAt) !== row.createdAt ||
    source.trialId !== row.trialId ||
    source.eventId !== row.sourceLastEventId ||
    source.stateVersion !== row.sourceStateVersion ||
    state.eventIds[primary.sequence - 1] !== primary.eventId ||
    state.eventIds[source.sequence - 1] !== source.eventId ||
    state.committedActionIds[primary.sequence - 1] !== primary.actionId ||
    state.committedActionIds[source.sequence - 1] !== source.actionId
  ) {
    return invalidAudit();
  }
  if (row.artifactKind === "jury_deliberation") {
    if (
      primary.type !== "DELIBERATE" ||
      primary.actor.role !== "jury" ||
      primary.actor.side !== "neutral" ||
      primary.actor.witnessId !== null ||
      !state.deliberated
    ) {
      return invalidAudit();
    }
  } else {
    if (
      primary.type !== "GENERATE_DEBRIEF" ||
      primary.actor.role !== "debrief_coach" ||
      primary.actor.side !== "neutral" ||
      primary.actor.witnessId !== null ||
      primary.payload.debriefId !== row.artifactId ||
      state.debriefId !== row.artifactId
    ) {
      return invalidAudit();
    }
  }
  const callAudit = await requireAcceptedCallAudit(ctx, row);
  const { trace, acceptedAttempt } = callAudit;
  const expectedCall =
    row.artifactKind === "jury_deliberation"
      ? {
          actorRole: "jury" as const,
          callClass: "role_responder" as const,
          task: "jury_deliberation" as const,
          model: "gpt-5.6-luna" as const,
          promptVersion: JURY_PROMPT_VERSION,
          schemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
        }
      : {
          actorRole: "debrief" as const,
          callClass: "debrief_generator" as const,
          task: "generate_debrief" as const,
          model: "gpt-5.6-terra" as const,
          promptVersion: DEBRIEF_PROMPT_VERSION,
          schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
        };
  const usageMatches =
    trace.usage === null
      ? primary.modelMetadata.inputTokens === null &&
        primary.modelMetadata.outputTokens === null
      : primary.modelMetadata.inputTokens === trace.usage.inputTokens &&
        primary.modelMetadata.outputTokens === trace.usage.outputTokens;
  if (
    trace.callId !== row.callId ||
    trace.trialId !== row.trialId ||
    trace.responseId !== primary.responseId ||
    trace.actorId !== primary.actor.actorId ||
    trace.actorRole !== expectedCall.actorRole ||
    trace.callClass !== expectedCall.callClass ||
    trace.task !== expectedCall.task ||
    trace.inputEventIds.length !== 1 ||
    trace.inputEventIds[0] !== row.sourceLastEventId ||
    trace.expectedStateVersion !== row.sourceStateVersion ||
    trace.expectedLastEventId !== row.sourceLastEventId ||
    trace.knowledgeScope.stateVersion !== row.sourceStateVersion ||
    trace.committedActionId !== row.actionId ||
    trace.committedEventId !== row.eventId ||
    trace.outputHash !== row.artifactHash ||
    acceptedAttempt.outputHash !== row.artifactHash ||
    trace.outputCharacterCount !== row.artifactJson.length ||
    trace.model !== expectedCall.model ||
    trace.model !== row.model ||
    trace.model !== primary.modelMetadata.model ||
    trace.promptVersion !== expectedCall.promptVersion ||
    trace.promptVersion !== row.promptVersion ||
    trace.promptVersion !== primary.modelMetadata.promptVersion ||
    trace.outputSchemaVersion !== expectedCall.schemaVersion ||
    trace.outputSchemaVersion !== row.artifactSchemaVersion ||
    trace.outputSchemaVersion !== primary.modelMetadata.schemaVersion ||
    primary.modelMetadata.requestId !== acceptedAttempt.providerRequestId ||
    primary.modelMetadata.latencyMs !== trace.latencyMs ||
    primary.modelMetadata.estimatedCostUsd !== trace.estimatedCostUsd ||
    primary.modelMetadata.retryCount !== trace.retryCount ||
    primary.modelMetadata.validationFailureCount !==
      trace.validationFailureCount ||
    !usageMatches ||
    timestamp(trace.completedAt) !== row.createdAt
  ) {
    return invalidAudit();
  }

  const artifactInput = parseBoundedJson(
    row.artifactJson,
    MAX_ARTIFACT_JSON_CHARACTERS,
  );
  if (row.artifactKind === "jury_deliberation") {
    if (row.decisionId === null) return invalidArtifact();
    const parsed = JuryRoleResponseModelOutputSchema.safeParse(artifactInput);
    if (!parsed.success) return invalidArtifact();
    const artifact = parsed.data;
    if (
      row.artifactJson !== JSON.stringify(artifact) ||
      row.artifactSchemaVersion !== artifact.schemaVersion ||
      row.artifactHash !== hashJuryResponseModelOutput(artifact)
    ) {
      return invalidArtifact();
    }
    const acceptedCitations = juryResponseOutputCitations(artifact);
    if (
      !sameCallCitations(trace.acceptedCitations, acceptedCitations) ||
      trace.acceptedCitationCount !== citationCount(acceptedCitations)
    ) {
      return invalidAudit();
    }
    if (
      primary.type !== "DELIBERATE" ||
      identity.artifactKind !== "jury_deliberation"
    ) {
      return invalidAudit();
    }
    await requireJuryLifecycle(
      ctx,
      state,
      row,
      primary,
      identity,
      artifact,
    );
    return {
      artifactKind: "jury_deliberation",
      privacyProjectionRequired: true,
      decisionId: row.decisionId,
      metadata: artifactMetadata(row),
      artifact,
    };
  }
  const parsed = DebriefGeneratorModelOutputSchema.safeParse(artifactInput);
  if (!parsed.success) return invalidArtifact();
  const artifact = parsed.data;
  if (
    row.artifactJson !== JSON.stringify(artifact) ||
    row.artifactSchemaVersion !== artifact.schemaVersion ||
    row.artifactHash !== hashDebriefGeneratorModelOutput(artifact)
  ) {
    return invalidArtifact();
  }
  let acceptedCitations: CourtroomModelCallTrace["acceptedCitations"];
  try {
    const transcriptEventBindings =
      [...debriefGeneratorCitedTranscriptTurnIds(artifact)]
        .sort((left, right) => left.localeCompare(right))
        .map((turnId) => {
        const turn = state.transcriptTurns[turnId];
        if (turn === undefined) return invalidAudit();
        return { turnId, sourceEventId: turn.sourceEventId };
        });
    acceptedCitations = debriefGeneratorOutputCitations(
      artifact,
      transcriptEventBindings,
    );
  } catch {
    return invalidAudit();
  }
  if (
    !sameCallCitations(trace.acceptedCitations, acceptedCitations) ||
    trace.acceptedCitationCount !== citationCount(acceptedCitations)
  ) {
    return invalidAudit();
  }
  if (
    primary.type !== "GENERATE_DEBRIEF" ||
    identity.artifactKind !== "final_debrief"
  ) {
    return invalidAudit();
  }
  await requireDebriefLifecycle(ctx, state, row, primary, identity);
  return {
    artifactKind: "final_debrief",
    privacyProjectionRequired: true,
    decisionId: null,
    metadata: artifactMetadata(row),
    artifact,
  };
}

function assertNoDuplicates(
  rows: readonly Doc<"courtroomGeneratedArtifacts">[],
): void {
  const fields = [
    "artifactId",
    "artifactKind",
    "callId",
    "actionId",
    "eventId",
  ] as const;
  for (const field of fields) {
    if (new Set(rows.map((row) => row[field])).size !== rows.length) {
      throw new Error("COURTROOM_GENERATED_ARTIFACT_DUPLICATE");
    }
  }
}

function assertCompleteArtifactSet(
  state: TrialStateV3,
  rows: readonly Doc<"courtroomGeneratedArtifacts">[],
): void {
  const expectedKinds: ArtifactKind[] = [];
  if (state.deliberated) expectedKinds.push("jury_deliberation");
  if (state.debriefId !== null) expectedKinds.push("final_debrief");
  const actualKinds = rows
    .map(({ artifactKind }) => artifactKind)
    .sort((left, right) => left.localeCompare(right));
  expectedKinds.sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualKinds) !== JSON.stringify(expectedKinds)) {
    throw new Error("COURTROOM_GENERATED_ARTIFACT_SET_INVALID");
  }
}

async function listStrictForOwnerTrial(
  ctx: Pick<QueryCtx, "db">,
  ownerIdInput: string,
  trialId: string,
): Promise<InternalCourtroomGeneratedArtifactList> {
  const owner = CaseServiceOwnerIdSchema.safeParse(ownerIdInput);
  if (!owner.success) {
    throw new Error("COURTROOM_GENERATED_ARTIFACT_OWNER_INVALID");
  }
  const ownerId = owner.data;
  const projection = await ctx.db
    .query("trialProjections")
    .withIndex("by_trial", (index) => index.eq("trialId", trialId))
    .unique();
  const state = requireOwnedV3Projection(projection, ownerId, trialId);
  const rows = await ctx.db
    .query("courtroomGeneratedArtifacts")
    .withIndex("by_owner_trial_kind", (index) =>
      index.eq("ownerId", ownerId).eq("trialId", trialId),
    )
    .take(MAX_GENERATED_ARTIFACTS_PER_TRIAL + 1);
  if (rows.length > MAX_GENERATED_ARTIFACTS_PER_TRIAL) {
    throw new Error("COURTROOM_GENERATED_ARTIFACT_LIMIT_EXCEEDED");
  }
  assertNoDuplicates(rows);
  assertCompleteArtifactSet(state, rows);
  const artifacts = await Promise.all(
    rows.map((row) => readStrictArtifact(ctx, state, row)),
  );
  return artifacts.sort(
    (left, right) =>
      left.metadata.committedStateVersion -
        right.metadata.committedStateVersion ||
      left.metadata.artifactId.localeCompare(right.metadata.artifactId),
  );
}

/**
 * Server-internal owner/trial read. Never expose this result directly through
 * a public Convex function or browser route; apply the privacy projector first.
 */
export const listForOwnerTrial = internalQuery({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
  },
  handler: async (ctx, args): Promise<InternalCourtroomGeneratedArtifactList> =>
    await listStrictForOwnerTrial(ctx, args.ownerId, args.trialId),
});
