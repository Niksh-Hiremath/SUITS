import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
  CaseGraphV1Schema,
  sha256Utf8,
  type CaseGraphV1,
} from "../src/domain/case-graph";
import {
  WitnessAnswerRequestSchema,
  validateWitnessAnswerOutput,
  validateWitnessAnswerRequestBinding,
  type CourtroomModelCallTrace,
  type WitnessAnswerRequest,
} from "../src/domain/courtroom-ai";
import {
  HearingCommandPreparationSchema,
  HearingCaseSelectorSchema,
  HearingPlayerCommandSchema,
  HearingWitnessGenerationPrecommitSchema,
  StartHearingRequestSchema,
  buildHearingRuntimeView,
  deriveTrialActorBindings,
  type HearingCommandPreparation,
  type HearingCaseSelector,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime";
import { buildKnowledgeView } from "../src/domain/knowledge";
import { getSeededCaseBySlug as seededCaseBySlug } from "../src/domain/seeded-cases";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  TrialStateV3Schema,
  type ActorRef,
  type EventSource,
  type ModelMetadata,
  type TrialActionV3,
  type TrialStateV3,
} from "../src/domain/trial-engine";
import {
  CaseServiceOwnerIdSchema,
  derivePublishedGraphId,
} from "./caseServiceBoundary";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";

const MAX_GRAPH_JSON_CHARACTERS = 750_000;

type ActionReceipt = Readonly<{
  receiptId: string;
  trialId: string;
  actionId: string;
  committedStateVersion: number;
  firstSequence: number;
  lastSequence: number;
  eventIds: string[];
  replayed: boolean;
}>;

type ReloadResult = Readonly<{
  trialId: string;
  graphId: string | null;
  stateJson: string;
  validated: boolean;
  requiresMigration: boolean;
}>;

type ResolvedGraph = Readonly<{
  graphId: string;
  graphJson: string;
}>;

const createForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    trialId: string;
    graphId: string;
    actionId: string;
    requestedAt: number;
    actorBindings: ReturnType<typeof deriveTrialActorBindings>;
    userSide?: "user" | "opposing";
  }>,
  ActionReceipt
>("trialEvents:createForOwner");

const appendPlayerForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; actionJson: string }>,
  ActionReceipt
>("trialEvents:appendPlayerForOwner");

const appendTrustedForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    writeSnapshot?: boolean;
  }>,
  ActionReceipt
>("trialEvents:appendTrustedForOwner");

const appendGeneratedForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    generationJson: string;
    writeSnapshot?: boolean;
  }>,
  ActionReceipt
>("trialEvents:appendGeneratedForOwner");

const reloadForOwnerReference = makeFunctionReference<
  "query",
  Readonly<{
    ownerId: string;
    trialId: string;
    afterSequence?: number;
    limit?: number;
  }>,
  ReloadResult
>("trialEvents:reloadForOwnerSession");

const resolveGraphReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; selectorJson: string }>,
  ResolvedGraph
>("hearingRuntime:resolveGraph");

const loadGraphReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; graphId: string }>,
  ResolvedGraph
>("hearingRuntime:loadGraphForOwner");

const eventExistsReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string; actionId: string }>,
  boolean
>("hearingRuntime:eventExistsForOwner");

const loadGeneratedAnswerActionReference = makeFunctionReference<
  "query",
  Readonly<{
    ownerId: string;
    trialId: string;
    actionId: string;
  }>,
  Readonly<{ actionJson: string }> | null
>("hearingRuntime:loadGeneratedAnswerActionForOwner");

function parseJson(value: string, label: string): unknown {
  if (!value.trim() || value.length > MAX_GRAPH_JSON_CHARACTERS) {
    throw new Error(`${label.toUpperCase()}_INVALID`);
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label.toUpperCase()}_INVALID`);
  }
}

function parseGraphJson(value: string): CaseGraphV1 {
  return CaseGraphV1Schema.parse(parseJson(value, "case_graph_json"));
}

function seededGraphId(graph: CaseGraphV1): string {
  return `graph:seeded:${graph.caseId}:v${graph.version}`;
}

function assertStoredGraph(
  record: {
    graphId: string;
    caseId: string;
    lifecycle: "draft" | "published" | "archived";
    visibility: "private" | "seeded_public";
    ownerId?: string;
    uploadId?: string;
    title: string;
    graphJson: string;
    graphSchemaVersion: string;
  },
  graph: CaseGraphV1,
  expected: {
    graphId: string;
    visibility: "private" | "seeded_public";
    ownerId?: string;
    uploadId?: string;
  },
): void {
  if (
    record.graphId !== expected.graphId ||
    record.caseId !== graph.caseId ||
    record.lifecycle !== "published" ||
    record.visibility !== expected.visibility ||
    record.ownerId !== expected.ownerId ||
    record.uploadId !== expected.uploadId ||
    record.title !== graph.title ||
    record.graphSchemaVersion !== graph.schemaVersion ||
    record.graphJson !== JSON.stringify(graph)
  ) {
    throw new Error("HEARING_CASE_GRAPH_CONFLICT");
  }
}

/** Resolves only a seeded graph or the caller's immutable published graph. */
export const resolveGraph = internalMutation({
  args: { ownerId: v.string(), selectorJson: v.string() },
  handler: async (ctx, args): Promise<ResolvedGraph> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const selector = HearingCaseSelectorSchema.parse(
      parseJson(args.selectorJson, "case_selector_json"),
    );

    if (selector.kind === "seeded") {
      const graph = getSeededGraph(selector);
      const graphId = seededGraphId(graph);
      const graphJson = JSON.stringify(graph);
      const existing = await ctx.db
        .query("caseGraphs")
        .withIndex("by_graph_id", (index) => index.eq("graphId", graphId))
        .unique();
      if (existing) {
        assertStoredGraph(existing, graph, {
          graphId,
          visibility: "seeded_public",
        });
        return { graphId, graphJson };
      }
      await ctx.db.insert("caseGraphs", {
        graphId,
        caseId: graph.caseId,
        version: graph.version,
        lifecycle: "published",
        visibility: "seeded_public",
        title: graph.title,
        graphJson,
        graphSchemaVersion: graph.schemaVersion,
        compilerMetadataJson: JSON.stringify(graph.compilerMetadata),
        sourceDigest: graph.compilerMetadata.sourceContentHash,
        createdBy: "system",
        createdAt: Date.now(),
      });
      return { graphId, graphJson };
    }

    const graphId = await derivePublishedGraphId(ownerId, selector.uploadId);
    const existing = await ctx.db
      .query("caseGraphs")
      .withIndex("by_graph_id", (index) => index.eq("graphId", graphId))
      .unique();
    if (!existing) throw new Error("HEARING_CASE_NOT_FOUND");
    const graph = parseGraphJson(existing.graphJson);
    assertStoredGraph(existing, graph, {
      graphId,
      visibility: "private",
      ownerId,
      uploadId: selector.uploadId,
    });
    return { graphId, graphJson: existing.graphJson };
  },
});

function getSeededGraph(
  selector: Extract<HearingCaseSelector, { kind: "seeded" }>,
): CaseGraphV1 {
  // Delayed import is unnecessary in Convex; the static catalog is immutable.
  const graph = seededCaseBySlug(selector.slug);
  if (!graph || graph.status !== "published") {
    throw new Error("HEARING_CASE_NOT_FOUND");
  }
  return CaseGraphV1Schema.parse(graph);
}

/** Loads a graph only after applying the same visibility/owner rule as start. */
export const loadGraphForOwner = internalQuery({
  args: { ownerId: v.string(), graphId: v.string() },
  handler: async (ctx, args): Promise<ResolvedGraph> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const record = await ctx.db
      .query("caseGraphs")
      .withIndex("by_graph_id", (index) => index.eq("graphId", args.graphId))
      .unique();
    if (
      !record ||
      record.lifecycle !== "published" ||
      (record.visibility !== "seeded_public" && record.ownerId !== ownerId)
    ) {
      throw new Error("HEARING_CASE_NOT_FOUND");
    }
    const graph = parseGraphJson(record.graphJson);
    if (
      graph.caseId !== record.caseId ||
      graph.title !== record.title ||
      graph.schemaVersion !== record.graphSchemaVersion ||
      graph.status !== "published"
    ) {
      throw new Error("HEARING_CASE_GRAPH_CONFLICT");
    }
    return { graphId: record.graphId, graphJson: record.graphJson };
  },
});

export const eventExistsForOwner = internalQuery({
  args: { ownerId: v.string(), trialId: v.string(), actionId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const projection = await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", args.trialId))
      .unique();
    if (!projection || projection.ownerId !== ownerId) {
      throw new Error("TRIAL_NOT_FOUND");
    }
    const event = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_action", (index) =>
        index.eq("trialId", args.trialId).eq("actionId", args.actionId),
      )
      .unique();
    return event?.trialId === args.trialId;
  },
});

/**
 * Reconstructs an already-committed generated answer for exact idempotent
 * replay. The result never crosses the secret server boundary; it exists only
 * so the generated append mutation can compare the original action hash and
 * terminal generation audit before returning its durable receipt.
 */
export const loadGeneratedAnswerActionForOwner = internalQuery({
  args: { ownerId: v.string(), trialId: v.string(), actionId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Readonly<{ actionJson: string }> | null> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const projection = await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", args.trialId))
      .unique();
    if (!projection || projection.ownerId !== ownerId) {
      throw new Error("TRIAL_NOT_FOUND");
    }
    const event = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_action", (index) =>
        index.eq("trialId", args.trialId).eq("actionId", args.actionId),
      )
      .unique();
    if (!event) return null;
    if (
      event.eventType !== "ANSWER_QUESTION" ||
      event.source !== "ai" ||
      event.model === undefined ||
      event.promptVersion === undefined ||
      event.modelSchemaVersion === undefined ||
      event.retryCount === undefined ||
      event.validationFailureCount === undefined
    ) {
      throw new Error("WITNESS_GENERATION_INVALID");
    }
    const action = TrialActionV3Schema.safeParse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
      actionId: event.actionId,
      trialId: event.trialId,
      expectedStateVersion: event.stateVersion - 1,
      actor: {
        actorId: event.actorId,
        role: event.actorRole,
        side: event.actorSide,
        witnessId: event.witnessId ?? null,
      },
      source: event.source,
      requestedAt:
        event.occurredAtIso ?? new Date(event.occurredAt).toISOString(),
      causationId: event.causationId ?? null,
      correlationId: event.correlationId ?? null,
      responseId: event.responseId ?? null,
      interruptId: event.interruptId ?? null,
      modelMetadata: {
        model: event.model,
        requestId: event.modelRequestId ?? null,
        promptVersion: event.promptVersion,
        schemaVersion: event.modelSchemaVersion,
        latencyMs: event.modelLatencyMs ?? null,
        inputTokens: event.inputTokens ?? null,
        outputTokens: event.outputTokens ?? null,
        estimatedCostUsd: event.estimatedCostUsd ?? null,
        retryCount: event.retryCount,
        validationFailureCount: event.validationFailureCount,
      },
      type: event.eventType,
      payload: parseJson(event.payloadJson, "trial_event_payload"),
    });
    if (!action.success) throw new Error("WITNESS_GENERATION_INVALID");
    return { actionJson: JSON.stringify(action.data) };
  },
});

function playerRole(state: TrialStateV3): "user_counsel" | "opposing_counsel" {
  return state.userSide === "user" ? "user_counsel" : "opposing_counsel";
}

function opposingSide(side: "user" | "opposing"): "user" | "opposing" {
  return side === "user" ? "opposing" : "user";
}

function counselRoleForSide(
  side: "user" | "opposing",
): "user_counsel" | "opposing_counsel" {
  return side === "user" ? "user_counsel" : "opposing_counsel";
}

function actorByRole(
  state: TrialStateV3,
  role: ActorRef["role"],
  side?: ActorRef["side"],
  requiredActorId?: string,
): ActorRef {
  const matches = Object.values(state.actors)
    .filter(
      (actor) =>
        actor.role === role &&
        (side === undefined || actor.side === side) &&
        (requiredActorId === undefined || actor.actorId === requiredActorId),
    )
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  if (matches.length === 0) throw new Error(`RUNTIME_ACTOR_NOT_FOUND:${role}`);
  return matches[0];
}

function playerCounsel(state: TrialStateV3): ActorRef {
  return actorByRole(state, playerRole(state), state.userSide);
}

function playerCounselForWitness(
  state: TrialStateV3,
  witnessId: string,
): ActorRef {
  const rule = state.policySnapshot.witnessCallability.find(
    (candidate) => candidate.witnessId === witnessId,
  );
  if (!rule) throw new Error("UNKNOWN_WITNESS");
  const counsel = playerCounsel(state);
  if (!rule.callableByActorIds.includes(counsel.actorId)) {
    throw new Error("PLAYER_CANNOT_CALL_WITNESS");
  }
  return counsel;
}

function runtimeActionId(
  trialId: string,
  requestId: string,
  step: string,
): string {
  const value = `action:${trialId}:${requestId}:${step}`;
  if (value.length > 256) throw new Error("RUNTIME_ACTION_ID_TOO_LONG");
  return value;
}

function eventIdForAction(actionId: string): string {
  return `event:${actionId}`;
}

function requestedAtWithOffset(value: string, offset: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error("HEARING_REQUESTED_AT_INVALID");
  }
  return new Date(timestamp + offset).toISOString();
}

function actionFromIntent(input: {
  actionId: string;
  trialId: string;
  expectedStateVersion: number;
  actor: ActorRef;
  source: EventSource;
  requestedAt: string;
  causationId: string | null;
  modelMetadata?: ModelMetadata | null;
  type: TrialActionV3["type"];
  payload: unknown;
}): TrialActionV3 {
  const payload = input.payload as Record<string, unknown>;
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: input.actionId,
    trialId: input.trialId,
    expectedStateVersion: input.expectedStateVersion,
    actor: input.actor,
    source: input.source,
    requestedAt: input.requestedAt,
    causationId: input.causationId,
    correlationId: input.trialId,
    responseId:
      typeof payload.responseId === "string" ? payload.responseId : null,
    interruptId:
      typeof payload.interruptId === "string" ? payload.interruptId : null,
    modelMetadata: input.modelMetadata ?? null,
    type: input.type,
    payload: input.payload,
  });
}

async function appendRuntimeAction(
  ctx: ActionCtx,
  ownerId: string,
  action: TrialActionV3,
  playerControlled: boolean,
  writeSnapshot = false,
): Promise<ActionReceipt> {
  return playerControlled
    ? await ctx.runMutation(appendPlayerForOwnerReference, {
        ownerId,
        actionJson: JSON.stringify(action),
      })
    : await ctx.runMutation(appendTrustedForOwnerReference, {
        ownerId,
        actionJson: JSON.stringify(action),
        writeSnapshot,
      });
}

async function loadHead(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
): Promise<{
  graph: CaseGraphV1;
  state: TrialStateV3;
  view: HearingRuntimeViewV1;
}> {
  const reload = await ctx.runQuery(reloadForOwnerReference, {
    ownerId,
    trialId,
    limit: 1,
  });
  if (!reload.validated || reload.requiresMigration || !reload.graphId) {
    throw new Error("TRIAL_MIGRATION_REQUIRED");
  }
  const state = TrialStateV3Schema.parse(
    parseJson(reload.stateJson, "trial_state_json"),
  );
  const storedGraph = await ctx.runQuery(loadGraphReference, {
    ownerId,
    graphId: reload.graphId,
  });
  const graph = parseGraphJson(storedGraph.graphJson);
  const actor = playerCounsel(state);
  return {
    graph,
    state,
    view: buildHearingRuntimeView({
      caseGraph: graph,
      trialState: state,
      playerActorId: actor.actorId,
    }),
  };
}

export const start = internalAction({
  args: { ownerId: v.string(), requestJson: v.string() },
  handler: async (ctx, args): Promise<HearingRuntimeViewV1> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const request = StartHearingRequestSchema.parse(
      parseJson(args.requestJson, "hearing_start_request"),
    );
    const resolved = await ctx.runMutation(resolveGraphReference, {
      ownerId,
      selectorJson: JSON.stringify(request.case),
    });
    const graph = parseGraphJson(resolved.graphJson);
    const bindings = deriveTrialActorBindings(graph);
    const trialId = `trial_${request.requestId.replaceAll("-", "")}`;
    const startActionId = runtimeActionId(trialId, request.requestId, "start");
    const startReceipt = await ctx.runMutation(createForOwnerReference, {
      ownerId,
      trialId,
      graphId: resolved.graphId,
      actionId: startActionId,
      requestedAt: Date.parse(request.requestedAt),
      actorBindings: bindings,
      userSide: request.userSide,
    });
    const judge = bindings.find((binding) => binding.actor.role === "judge")?.actor;
    if (!judge) throw new Error("RUNTIME_JUDGE_REQUIRED");
    const openingActionId = runtimeActionId(
      trialId,
      request.requestId,
      "phase-opening",
    );
    const opening = actionFromIntent({
      actionId: openingActionId,
      trialId,
      expectedStateVersion: 1,
      actor: judge,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(request.requestedAt, 1),
      causationId: startReceipt.eventIds[0],
      type: "BEGIN_PHASE",
      payload: { phase: "opening" },
    });
    await appendRuntimeAction(ctx, ownerId, opening, false);
    const caseInChief = actionFromIntent({
      actionId: runtimeActionId(
        trialId,
        request.requestId,
        "phase-case-in-chief",
      ),
      trialId,
      expectedStateVersion: 2,
      actor: judge,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(request.requestedAt, 2),
      causationId: eventIdForAction(openingActionId),
      type: "BEGIN_PHASE",
      payload: { phase: "case_in_chief" },
    });
    await appendRuntimeAction(ctx, ownerId, caseInChief, false, true);
    return (await loadHead(ctx, ownerId, trialId)).view;
  },
});

export const read = internalAction({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
  },
  handler: async (ctx, args): Promise<HearingRuntimeViewV1> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    return (await loadHead(ctx, ownerId, args.trialId)).view;
  },
});

async function callWitness(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  state: TrialStateV3,
): Promise<void> {
  if (command.intent.type !== "call_witness") throw new Error("INVALID_INTENT");
  const counsel = playerCounselForWitness(
    state,
    command.intent.witnessId,
  );
  const actionId = runtimeActionId(trialId, command.requestId, "call-witness");
  const callType =
    state.witnesses[command.intent.witnessId]?.status === "released"
      ? "RECALL_WITNESS"
      : "CALL_WITNESS";
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId,
      trialId,
      expectedStateVersion: command.expectedStateVersion,
      actor: counsel,
      source: "user",
      requestedAt: command.requestedAt,
      causationId: command.expectedLastEventId,
      type: callType,
      payload: {
        witnessId: command.intent.witnessId,
        calledBySide: state.userSide,
      },
    }),
    true,
  );
  const clerk = actorByRole(state, "clerk", "neutral");
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: runtimeActionId(trialId, command.requestId, "swear-witness"),
      trialId,
      expectedStateVersion: command.expectedStateVersion + 1,
      actor: clerk,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(command.requestedAt, 1),
      causationId: eventIdForAction(actionId),
      type: "SWEAR_WITNESS",
      payload: { witnessId: command.intent.witnessId },
    }),
    false,
    true,
  );
}

function witnessRequestId(responseId: string): string {
  const prefix = "response:";
  if (!responseId.startsWith(prefix) || responseId.length === prefix.length) {
    throw new Error("WITNESS_GENERATION_INVALID");
  }
  return responseId.slice(prefix.length);
}

function witnessAnswerActionId(trialId: string, responseId: string): string {
  return runtimeActionId(
    trialId,
    witnessRequestId(responseId),
    "answer-question",
  );
}

function createWitnessModelCallId(trialId: string, responseId: string): string {
  const callId = `call:${trialId}:${responseId}:${globalThis.crypto.randomUUID()}`;
  if (callId.length > 128) throw new Error("WITNESS_GENERATION_INVALID");
  return callId;
}

function isWitnessModelCallId(
  callId: string,
  trialId: string,
  responseId: string,
): boolean {
  const prefix = `call:${trialId}:${responseId}:`;
  const suffix = callId.slice(prefix.length);
  return (
    callId.length <= 128 &&
    callId.startsWith(prefix) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      suffix,
    )
  );
}

type PreparedWitnessQuestion = Readonly<{
  responseId: string;
  callId: string;
  answerActionId: string;
}>;

async function prepareWitnessQuestion(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  head: { graph: CaseGraphV1; state: TrialStateV3 },
): Promise<PreparedWitnessQuestion> {
  if (command.intent.type !== "ask_question") throw new Error("INVALID_INTENT");
  const intent = command.intent;
  const counsel = playerCounsel(head.state);
  const witnessActorId = Object.values(head.state.actors).find(
    (actor) => actor.witnessId === intent.witnessId,
  )?.actorId;
  if (!witnessActorId) throw new Error("WITNESS_ACTOR_NOT_FOUND");
  const witnessActor = actorByRole(
    head.state,
    "witness",
    undefined,
    witnessActorId,
  );
  const questionId = `question:${command.requestId}`;
  const questionActionId = runtimeActionId(
    trialId,
    command.requestId,
    "ask-question",
  );
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: questionActionId,
      trialId,
      expectedStateVersion: command.expectedStateVersion,
      actor: counsel,
      source: "user",
      requestedAt: command.requestedAt,
      causationId: command.expectedLastEventId,
      type: "ASK_QUESTION",
      payload: {
        questionId,
        witnessId: command.intent.witnessId,
        examinationKind: command.intent.examinationKind,
        text: command.intent.text,
        turnId: `turn:question:${command.requestId}`,
        presentedEvidenceIds: command.intent.presentedEvidenceIds,
      },
    }),
    true,
  );
  const responseId = `response:${command.requestId}`;
  const requestResponseActionId = runtimeActionId(
    trialId,
    command.requestId,
    "request-response",
  );
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: requestResponseActionId,
      trialId,
      expectedStateVersion: command.expectedStateVersion + 1,
      actor: actorByRole(head.state, "system", "neutral"),
      source: "system",
      requestedAt: requestedAtWithOffset(command.requestedAt, 1),
      causationId: eventIdForAction(questionActionId),
      type: "REQUEST_RESPONSE",
      payload: {
        responseId,
        actorId: witnessActor.actorId,
        purpose: "answer_question",
      },
    }),
    false,
  );
  return {
    responseId,
    callId: createWitnessModelCallId(trialId, responseId),
    answerActionId: witnessAnswerActionId(trialId, responseId),
  };
}

function staleWitnessGeneration(): never {
  throw new Error("WITNESS_GENERATION_STALE");
}

function invalidWitnessGeneration(): never {
  throw new Error("WITNESS_GENERATION_INVALID");
}

function canonicalWitnessAnswerRequest(input: {
  trialId: string;
  responseId: string;
  callId: string;
  graph: CaseGraphV1;
  state: TrialStateV3;
}): WitnessAnswerRequest {
  if (
    input.state.trialId !== input.trialId ||
    !isWitnessModelCallId(input.callId, input.trialId, input.responseId)
  ) {
    return invalidWitnessGeneration();
  }
  const pending = input.state.pendingResponses[input.responseId];
  if (
    !pending ||
    pending.status === "cancelled" ||
    pending.status === "committed" ||
    pending.interruptId !== null ||
    pending.questionId === null ||
    pending.appearanceId === null ||
    pending.witnessId === null
  ) {
    return staleWitnessGeneration();
  }
  const question = input.state.questions[pending.questionId];
  const questionTurn = question
    ? input.state.transcriptTurns[question.questionTurnId]
    : undefined;
  const actor = input.state.actors[pending.actorId];
  const expectedLastEventId = input.state.eventIds.at(-1);
  if (
    !question ||
    !questionTurn ||
    !actor ||
    actor.role !== "witness" ||
    actor.witnessId !== pending.witnessId ||
    expectedLastEventId === undefined
  ) {
    return staleWitnessGeneration();
  }

  let knowledgeView: ReturnType<typeof buildKnowledgeView>;
  try {
    knowledgeView = buildKnowledgeView(
      {
        caseGraph: input.graph,
        trial: input.state,
        currentExchangeTurnId: question.questionTurnId,
      },
      actor.actorId,
    );
  } catch {
    return invalidWitnessGeneration();
  }
  if (knowledgeView.actorRole !== "witness") {
    return invalidWitnessGeneration();
  }

  const request = WitnessAnswerRequestSchema.safeParse({
    schemaVersion: "role-responder.witness-answer.request.v1",
    callId: input.callId,
    trialId: input.trialId,
    responseId: input.responseId,
    expectedStateVersion: input.state.version,
    expectedLastEventId,
    actorId: actor.actorId,
    witnessId: pending.witnessId,
    question: {
      questionId: question.questionId,
      appearanceId: question.appearanceId,
      turnId: question.questionTurnId,
      eventId: questionTurn.sourceEventId,
      examinationKind: question.examinationKind,
      text: questionTurn.text,
      presentedEvidenceIds: question.presentedEvidenceIds,
    },
    knowledgeView,
  });
  if (!request.success) return invalidWitnessGeneration();
  if (validateWitnessAnswerRequestBinding(request.data, input.state).length > 0) {
    return staleWitnessGeneration();
  }
  return request.data;
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameOrderedIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((identifier, index) => identifier === right[index])
  );
}

function traceMatchesWitnessRequest(
  trace: CourtroomModelCallTrace,
  request: WitnessAnswerRequest,
): boolean {
  const view = request.knowledgeView;
  const sourceSegmentCount = new Set([
    ...view.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...view.publicRecord.evidence.flatMap(
      (evidence) => evidence.sourceSegmentIds,
    ),
  ]).size;
  const publicRecordEventCount = new Set(
    view.publicRecord.testimony.map((testimony) => testimony.transcriptEventId),
  ).size;
  const expectedInputEventIds = stableUnique([
    request.question.eventId,
    request.expectedLastEventId,
  ]);
  return (
    trace.trialId === request.trialId &&
    trace.callId === request.callId &&
    trace.responseId === request.responseId &&
    trace.actorId === request.actorId &&
    trace.actorRole === "witness" &&
    trace.expectedStateVersion === request.expectedStateVersion &&
    trace.expectedLastEventId === request.expectedLastEventId &&
    sameOrderedIds(trace.inputEventIds, expectedInputEventIds) &&
    trace.knowledgeScope.knowledgeSchemaVersion === view.schemaVersion &&
    trace.knowledgeScope.knowledgeViewHash ===
      sha256Utf8(JSON.stringify(view)) &&
    trace.knowledgeScope.stateVersion === view.stateVersion &&
    trace.knowledgeScope.factCount === view.witness.facts.length &&
    trace.knowledgeScope.evidenceCount ===
      new Set([
        ...view.witness.admittedSeenEvidence.map(
          (evidence) => evidence.evidenceId,
        ),
        ...view.presentedEvidence.map((evidence) => evidence.evidenceId),
      ]).size &&
    trace.knowledgeScope.testimonyCount ===
      view.publicRecord.testimony.length &&
    trace.knowledgeScope.priorStatementCount ===
      view.witness.priorStatements.length &&
    trace.knowledgeScope.sourceSegmentCount === sourceSegmentCount &&
    trace.knowledgeScope.publicRecordEventCount === publicRecordEventCount &&
    trace.knowledgeScope.currentExchangeCount ===
      (view.currentExchange === null ? 0 : 1)
  );
}

const NEXT_EXAMINATION = {
  direct: "cross",
  cross: "redirect",
  redirect: "recross",
  recross: null,
} as const;

async function finishWitness(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  state: TrialStateV3,
): Promise<void> {
  if (command.intent.type !== "finish_witness") throw new Error("INVALID_INTENT");
  const appearance = state.activeAppearanceId
    ? state.appearances[state.activeAppearanceId]
    : undefined;
  if (!appearance || appearance.witnessId !== command.intent.witnessId) {
    throw new Error("WITNESS_NOT_ACTIVE");
  }
  const leg = appearance.legs[command.intent.examinationKind];
  const firstCounsel = actorByRole(
    state,
    counselRoleForSide(leg.ownerSide),
    leg.ownerSide,
  );
  if (leg.ownerSide !== state.userSide) {
    throw new Error("PLAYER_DOES_NOT_OWN_EXAMINATION");
  }
  const disposition = leg.answeredQuestionCount > 0 ? "completed" : "waived";
  const endActionId = runtimeActionId(
    trialId,
    command.requestId,
    `end-${command.intent.examinationKind}`,
  );
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: endActionId,
      trialId,
      expectedStateVersion: command.expectedStateVersion,
      actor: firstCounsel,
      source: "user",
      requestedAt: command.requestedAt,
      causationId: command.expectedLastEventId,
      type: "END_EXAMINATION",
      payload: {
        witnessId: command.intent.witnessId,
        examinationKind: command.intent.examinationKind,
        disposition,
      },
    }),
    true,
  );

  let versionOffset = 1;
  let causationId = eventIdForAction(endActionId);
  const nextKind =
    disposition === "completed"
      ? NEXT_EXAMINATION[command.intent.examinationKind]
      : null;
  if (nextKind) {
    const nextLeg = appearance.legs[nextKind];
    const nextCounsel = actorByRole(
      state,
      counselRoleForSide(nextLeg.ownerSide),
      nextLeg.ownerSide,
    );
    const waiverActionId = runtimeActionId(
      trialId,
      command.requestId,
      `waive-${nextKind}`,
    );
    await appendRuntimeAction(
      ctx,
      ownerId,
      actionFromIntent({
        actionId: waiverActionId,
        trialId,
        expectedStateVersion: command.expectedStateVersion + versionOffset,
        actor: nextCounsel,
        source: nextLeg.ownerSide === state.userSide ? "user" : "deterministic",
        requestedAt: requestedAtWithOffset(
          command.requestedAt,
          versionOffset,
        ),
        causationId,
        type: "END_EXAMINATION",
        payload: {
          witnessId: command.intent.witnessId,
          examinationKind: nextKind,
          disposition: "waived",
        },
      }),
      nextLeg.ownerSide === state.userSide,
    );
    versionOffset += 1;
    causationId = eventIdForAction(waiverActionId);
  }

  const releaseCounsel = actorByRole(
    state,
    counselRoleForSide(appearance.callingSide),
    appearance.callingSide,
  );
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: runtimeActionId(trialId, command.requestId, "release-witness"),
      trialId,
      expectedStateVersion: command.expectedStateVersion + versionOffset,
      actor: releaseCounsel,
      source:
        appearance.callingSide === state.userSide ? "user" : "deterministic",
      requestedAt: requestedAtWithOffset(
        command.requestedAt,
        versionOffset,
      ),
      causationId,
      type: "RELEASE_WITNESS",
      payload: { witnessId: command.intent.witnessId },
    }),
    appearance.callingSide === state.userSide,
    true,
  );
}

async function finishTrial(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  state: TrialStateV3,
): Promise<void> {
  if (command.intent.type !== "finish_trial") throw new Error("INVALID_INTENT");
  const playerSide = state.userSide;
  const otherSide = opposingSide(playerSide);
  const player = playerCounsel(state);
  const otherCounsel = actorByRole(
    state,
    counselRoleForSide(otherSide),
    otherSide,
  );
  const judge = actorByRole(state, "judge", "neutral");
  const jury = actorByRole(state, "jury", "neutral");
  const coach = actorByRole(state, "debrief_coach", "neutral");
  const emptyCitations = {
    factIds: [],
    evidenceIds: [],
    testimonyIds: [],
    eventIds: [],
    sourceSegmentIds: [],
  };
  const steps: Array<{
    suffix: string;
    actor: ActorRef;
    source: EventSource;
    player: boolean;
    type: TrialActionV3["type"];
    payload: unknown;
    snapshot?: boolean;
  }> = [
    {
      suffix: "rest-player",
      actor: player,
      source: "user",
      player: true,
      type: "REST_CASE",
      payload: { side: playerSide },
    },
    {
      suffix: "rest-opponent",
      actor: otherCounsel,
      source: "deterministic",
      player: false,
      type: "REST_CASE",
      payload: { side: otherSide },
    },
    {
      suffix: "phase-pre-closing",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "BEGIN_PHASE",
      payload: { phase: "pre_closing" },
    },
    {
      suffix: "phase-closing",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "BEGIN_PHASE",
      payload: { phase: "closing" },
    },
    {
      suffix: "closing-player",
      actor: player,
      source: "user",
      player: true,
      type: "GIVE_CLOSING",
      payload: {
        side: playerSide,
        turnId: `turn:closing:${command.requestId}:player`,
        text: command.intent.closingText,
        citations: emptyCitations,
      },
    },
    {
      suffix: "closing-opponent",
      actor: otherCounsel,
      source: "deterministic",
      player: false,
      type: "GIVE_CLOSING",
      payload: {
        side: otherSide,
        turnId: `turn:closing:${command.requestId}:opponent`,
        text: "The opposing side submits the matter on the jury-considerable record.",
        citations: emptyCitations,
      },
    },
    {
      suffix: "phase-jury-instructions",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "BEGIN_PHASE",
      payload: { phase: "jury_instructions" },
    },
    {
      suffix: "instruct-jury",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "INSTRUCT_JURY",
      payload: { instructionIds: state.juryInstructionIds },
    },
    {
      suffix: "phase-deliberation",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "BEGIN_PHASE",
      payload: { phase: "deliberation" },
    },
    {
      suffix: "deliberate",
      actor: jury,
      source: "deterministic",
      player: false,
      type: "DELIBERATE",
      payload: {},
    },
    {
      suffix: "phase-verdict",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "BEGIN_PHASE",
      payload: { phase: "verdict" },
    },
    {
      suffix: "render-mock-verdict",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "RENDER_VERDICT",
      payload: {
        verdictId: `verdict:${command.requestId}`,
        decision:
          "The deterministic development jury preserves the record for the GPT-5.6 deliberation adapter.",
        citations: emptyCitations,
      },
    },
    {
      suffix: "phase-debrief",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "BEGIN_PHASE",
      payload: { phase: "debrief" },
    },
    {
      suffix: "generate-mock-debrief",
      actor: coach,
      source: "deterministic",
      player: false,
      type: "GENERATE_DEBRIEF",
      payload: { debriefId: `debrief:${command.requestId}` },
    },
    {
      suffix: "phase-complete",
      actor: judge,
      source: "deterministic",
      player: false,
      type: "BEGIN_PHASE",
      payload: { phase: "complete" },
      snapshot: true,
    },
  ];

  let causationId = command.expectedLastEventId;
  for (const [index, step] of steps.entries()) {
    const actionId = runtimeActionId(trialId, command.requestId, step.suffix);
    await appendRuntimeAction(
      ctx,
      ownerId,
      actionFromIntent({
        actionId,
        trialId,
        expectedStateVersion: command.expectedStateVersion + index,
        actor: step.actor,
        source: step.source,
        requestedAt: requestedAtWithOffset(command.requestedAt, index),
        causationId,
        type: step.type,
        payload: step.payload,
      }),
      step.player,
      step.snapshot,
    );
    causationId = eventIdForAction(actionId);
  }
}

async function prepareCommandHandler(
  ctx: ActionCtx,
  args: Readonly<{
    ownerId: string;
    trialId: string;
    commandJson: string;
  }>,
): Promise<HearingCommandPreparation> {
  const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
  const commandInput = HearingPlayerCommandSchema.parse(
    parseJson(args.commandJson, "hearing_player_command"),
  );
  const head = await loadHead(ctx, ownerId, args.trialId);
  switch (commandInput.intent.type) {
    case "call_witness":
      await callWitness(ctx, ownerId, args.trialId, commandInput, head.state);
      break;
    case "ask_question": {
      const prepared = await prepareWitnessQuestion(
        ctx,
        ownerId,
        args.trialId,
        commandInput,
        head,
      );
      const responseHead = await loadHead(ctx, ownerId, args.trialId);
      if (
        responseHead.state.pendingResponses[prepared.responseId]?.status ===
          "committed" ||
        (await ctx.runQuery(eventExistsReference, {
          ownerId,
          trialId: args.trialId,
          actionId: prepared.answerActionId,
        }))
      ) {
        return HearingCommandPreparationSchema.parse({
          schemaVersion: "hearing-command-preparation.v1",
          status: "completed",
          view: responseHead.view,
        });
      }
      const request = canonicalWitnessAnswerRequest({
        trialId: args.trialId,
        responseId: prepared.responseId,
        callId: prepared.callId,
        graph: responseHead.graph,
        state: responseHead.state,
      });
      return HearingCommandPreparationSchema.parse({
        schemaVersion: "hearing-command-preparation.v1",
        status: "model_required",
        request,
      });
    }
    case "finish_witness":
      await finishWitness(
        ctx,
        ownerId,
        args.trialId,
        commandInput,
        head.state,
      );
      break;
    case "finish_trial":
      await finishTrial(ctx, ownerId, args.trialId, commandInput, head.state);
      break;
  }
  return HearingCommandPreparationSchema.parse({
    schemaVersion: "hearing-command-preparation.v1",
    status: "completed",
    view: (await loadHead(ctx, ownerId, args.trialId)).view,
  });
}

/** Secret-only prepare boundary. Only witness-scoped model context may leave Convex. */
export const prepareCommand = internalAction({
  args: { ownerId: v.string(), trialId: v.string(), commandJson: v.string() },
  handler: prepareCommandHandler,
});

function generatedAppendError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("STALE_STATE_VERSION") ||
    message.includes("STALE_RESPONSE") ||
    message.includes("WITNESS_GENERATION_STALE")
  ) {
    return staleWitnessGeneration();
  }
  if (
    message.includes("CONFLICT") ||
    message.includes("GENERATION") ||
    message.includes("MODEL_CALL")
  ) {
    return invalidWitnessGeneration();
  }
  throw error;
}

async function appendWitnessGeneration(
  ctx: ActionCtx,
  ownerId: string,
  actionJson: string,
  generation: HearingWitnessGenerationPrecommit,
): Promise<void> {
  try {
    await ctx.runMutation(appendGeneratedForOwnerReference, {
      ownerId,
      actionJson,
      generationJson: JSON.stringify(generation),
      writeSnapshot: true,
    });
  } catch (error) {
    generatedAppendError(error);
  }
}

/**
 * Revalidates a completed Luna proposal against the latest canonical head and
 * atomically commits its AI testimony event plus redacted model-call audit.
 */
export const commitWitnessGeneration = internalAction({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    generationJson: v.string(),
  },
  handler: async (ctx, args): Promise<HearingRuntimeViewV1> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    let generationInput: unknown;
    try {
      generationInput = parseJson(
        args.generationJson,
        "witness_generation_precommit",
      );
    } catch {
      return invalidWitnessGeneration();
    }
    const generation = HearingWitnessGenerationPrecommitSchema.safeParse(
      generationInput,
    );
    if (!generation.success || generation.data.trialId !== args.trialId) {
      return invalidWitnessGeneration();
    }
    const envelope = generation.data;
    const actionId = witnessAnswerActionId(
      args.trialId,
      envelope.responseId,
    );
    const head = await loadHead(ctx, ownerId, args.trialId);
    const existingAction = await ctx.runQuery(
      loadGeneratedAnswerActionReference,
      { ownerId, trialId: args.trialId, actionId },
    );
    if (existingAction !== null) {
      await appendWitnessGeneration(
        ctx,
        ownerId,
        existingAction.actionJson,
        envelope,
      );
      return (await loadHead(ctx, ownerId, args.trialId)).view;
    }

    const request = canonicalWitnessAnswerRequest({
      trialId: args.trialId,
      responseId: envelope.responseId,
      callId: envelope.callId,
      graph: head.graph,
      state: head.state,
    });
    if (!traceMatchesWitnessRequest(envelope.trace, request)) {
      return invalidWitnessGeneration();
    }
    const validated = validateWitnessAnswerOutput(request, envelope.output);
    if (!validated.accepted) return invalidWitnessGeneration();
    const actor = head.state.actors[request.actorId];
    if (
      !actor ||
      actor.role !== "witness" ||
      actor.witnessId !== request.witnessId ||
      envelope.trace.completedAt === null
    ) {
      return invalidWitnessGeneration();
    }
    const requestId = witnessRequestId(envelope.responseId);
    if (request.question.questionId !== `question:${requestId}`) {
      return invalidWitnessGeneration();
    }
    const action = actionFromIntent({
      actionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion,
      actor,
      source: "ai",
      requestedAt: envelope.trace.completedAt,
      causationId: request.expectedLastEventId,
      modelMetadata: envelope.modelMetadata,
      type: "ANSWER_QUESTION",
      payload: {
        responseId: envelope.responseId,
        questionId: request.question.questionId,
        witnessId: request.witnessId,
        testimonyId: `testimony:${requestId}`,
        turnId: `turn:answer:${requestId}`,
        text: validated.answer.text,
        factIds: validated.answer.factIds,
        evidenceIds: validated.answer.evidenceIds,
      },
    });
    await appendWitnessGeneration(
      ctx,
      ownerId,
      JSON.stringify(action),
      envelope,
    );
    return (await loadHead(ctx, ownerId, args.trialId)).view;
  },
});

/**
 * Legacy secret service wrapper for non-model commands. Question preparation
 * is durable, but this compatibility boundary never fabricates witness text.
 */
export const command = internalAction({
  args: { ownerId: v.string(), trialId: v.string(), commandJson: v.string() },
  handler: async (ctx, args): Promise<HearingRuntimeViewV1> => {
    const preparation = await prepareCommandHandler(ctx, args);
    if (preparation.status === "model_required") {
      throw new Error("MODEL_REQUIRED");
    }
    return preparation.view;
  },
});
