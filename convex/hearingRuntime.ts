import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
  CaseGraphV1Schema,
  sha256Utf8,
  type CaseGraphV1,
} from "../src/domain/case-graph";
import {
  CounselResponseRequestSchema,
  OpponentPlannerRequestSchema,
  WitnessAnswerRequestSchema,
  validateCounselResponseOutput,
  validateOpponentPlannerOutput,
  validateWitnessAnswerOutput,
  validateWitnessAnswerRequestBinding,
  type CounselResponseRequest,
  type CourtroomModelCallTrace,
  type OpponentPlannerRequest,
  type WitnessAnswerRequest,
} from "../src/domain/courtroom-ai";
import {
  HearingCounselResponsePrecommitSchema,
  HearingCommandPreparationSchema,
  HearingCaseSelectorSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingPlayerCommandSchema,
  HearingWitnessGenerationPrecommitSchema,
  MAX_OPPONENT_QUESTIONS_PER_LEG,
  StartHearingRequestSchema,
  assertPersistedOpponentDirectiveBinding,
  buildHearingRuntimeView,
  createPersistedOpponentDirective,
  deriveTrialActorBindings,
  parsePersistedOpponentDirective,
  serializePersistedOpponentDirective,
  type HearingCounselResponsePrecommit,
  type HearingCommandPreparation,
  type HearingCaseSelector,
  type HearingOpponentPlanPrecommit,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime";
import {
  buildKnowledgeView,
  buildOpponentCounselPublicKnowledgeView,
  buildOpponentPlannerKnowledgeView,
} from "../src/domain/knowledge";
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
import type { Doc } from "./_generated/dataModel";
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

const appendOpponentPlanForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    generationJson: string;
    writeSnapshot?: boolean;
  }>,
  ActionReceipt
>("trialEvents:appendOpponentPlanForOwner");

const appendCounselTurnForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    continuationActionJson: string | null;
    generationJson: string;
    writeSnapshot?: boolean;
  }>,
  ActionReceipt
>("trialEvents:appendCounselTurnForOwner");

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

const loadGeneratedCounselTurnReference = makeFunctionReference<
  "query",
  Readonly<{
    ownerId: string;
    trialId: string;
    actionId: string;
  }>,
  Readonly<{
    actionJson: string;
    continuationActionJson: string | null;
  }> | null
>("hearingRuntime:loadGeneratedCounselTurnForOwner");

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

function storedEventActionJson(event: Doc<"trialEvents">): string {
  const hasModelMetadata =
    event.model !== undefined ||
    event.promptVersion !== undefined ||
    event.modelSchemaVersion !== undefined ||
    event.retryCount !== undefined ||
    event.validationFailureCount !== undefined;
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
    modelMetadata: hasModelMetadata
      ? {
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
        }
      : null,
    type: event.eventType,
    payload: parseJson(event.payloadJson, "trial_event_payload"),
  });
  if (!action.success) throw new Error("COURTROOM_GENERATION_INVALID");
  return JSON.stringify(action.data);
}

/**
 * Reconstructs an already-committed generated counsel turn for exact replay.
 * The raw action pair remains inside the secret Convex action graph.
 */
export const loadGeneratedCounselTurnForOwner = internalQuery({
  args: { ownerId: v.string(), trialId: v.string(), actionId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    Readonly<{
      actionJson: string;
      continuationActionJson: string | null;
    }> | null
  > => {
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
      event.source !== "ai" ||
      ![
        "UPDATE_OPPOSING_STRATEGY",
        "ASK_QUESTION",
        "END_EXAMINATION",
      ].includes(event.eventType)
    ) {
      throw new Error("COURTROOM_GENERATION_INVALID");
    }

    const nextEvent = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index
          .eq("trialId", args.trialId)
          .eq("sequence", event.sequence + 1),
      )
      .unique();
    const continuation =
      nextEvent &&
      nextEvent.causationId === event.eventId &&
      ((event.eventType === "ASK_QUESTION" &&
        nextEvent.eventType === "REQUEST_RESPONSE" &&
        nextEvent.source === "system") ||
        (event.eventType === "END_EXAMINATION" &&
          nextEvent.eventType === "RELEASE_WITNESS" &&
          nextEvent.source === "deterministic"))
        ? storedEventActionJson(nextEvent)
        : null;
    if (event.eventType === "ASK_QUESTION" && continuation === null) {
      throw new Error("COURTROOM_GENERATION_INVALID");
    }
    return {
      actionJson: storedEventActionJson(event),
      continuationActionJson: continuation,
    };
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

function opposingCounselForAiRuntime(state: TrialStateV3): ActorRef {
  if (state.userSide !== "user") {
    throw new Error("RUNTIME_AI_USER_SIDE_UNSUPPORTED");
  }
  const matches = Object.values(state.actors).filter(
    (actor) =>
      actor.role === "opposing_counsel" && actor.side === "opposing",
  );
  if (matches.length !== 1) {
    throw new Error("RUNTIME_OPPOSING_COUNSEL_AMBIGUOUS");
  }
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

function stableRuntimeId(prefix: string, material: unknown): string {
  return `${prefix}:${sha256Utf8(JSON.stringify(material))}`;
}

function freshModelCallId(prefix: "opponent" | "counsel", material: unknown): string {
  const callId = `call:${prefix}:${sha256Utf8(JSON.stringify(material))}:${globalThis.crypto.randomUUID()}`;
  if (callId.length > 128) throw new Error("COURTROOM_GENERATION_INVALID");
  return callId;
}

function isFreshModelCallId(
  callId: string,
  prefix: "opponent" | "counsel",
  material: unknown,
): boolean {
  const expectedPrefix = `call:${prefix}:${sha256Utf8(JSON.stringify(material))}:`;
  const suffix = callId.slice(expectedPrefix.length);
  return (
    callId.length <= 128 &&
    callId.startsWith(expectedPrefix) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      suffix,
    )
  );
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
  witnessRequestId(responseId);
  return stableRuntimeId("action:witness-answer", { trialId, responseId });
}

function createWitnessModelCallId(trialId: string, responseId: string): string {
  const materialHash = sha256Utf8(JSON.stringify({ trialId, responseId }));
  const callId = `call:witness:${materialHash}:${globalThis.crypto.randomUUID()}`;
  if (callId.length > 128) throw new Error("WITNESS_GENERATION_INVALID");
  return callId;
}

function isWitnessModelCallId(
  callId: string,
  trialId: string,
  responseId: string,
): boolean {
  const materialHash = sha256Utf8(JSON.stringify({ trialId, responseId }));
  const prefix = `call:witness:${materialHash}:`;
  const suffix = callId.slice(prefix.length);
  return (
    callId.length <= 128 &&
    callId.startsWith(prefix) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      suffix,
    )
  );
}

async function prepareWitnessQuestion(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  head: { graph: CaseGraphV1; state: TrialStateV3 },
): Promise<void> {
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

function activeAppearance(state: TrialStateV3) {
  const appearance = state.activeAppearanceId
    ? state.appearances[state.activeAppearanceId]
    : undefined;
  if (!appearance) throw new Error("WITNESS_NOT_ACTIVE");
  return appearance;
}

function lastEventId(state: TrialStateV3): string {
  const eventId = state.eventIds.at(-1);
  if (!eventId) throw new Error("TRIAL_EVENT_HEAD_REQUIRED");
  return eventId;
}

function opponentDecisionMaterial(
  state: TrialStateV3,
  actor: ActorRef,
): Readonly<{
  trialId: string;
  stateVersion: number;
  lastEventId: string;
  actorId: string;
  appearanceId: string;
  witnessId: string;
  examinationKind: "cross" | "recross";
  answeredQuestionCount: number;
}> {
  const appearance = activeAppearance(state);
  if (appearance.stage !== "cross" && appearance.stage !== "recross") {
    throw new Error("RUNTIME_AI_EXAMINATION_REQUIRED");
  }
  const leg = appearance.legs[appearance.stage];
  if (leg.ownerSide !== "opposing") {
    throw new Error("RUNTIME_AI_EXAMINATION_REQUIRED");
  }
  return {
    trialId: state.trialId,
    stateVersion: state.version,
    lastEventId: lastEventId(state),
    actorId: actor.actorId,
    appearanceId: appearance.appearanceId,
    witnessId: appearance.witnessId,
    examinationKind: appearance.stage,
    answeredQuestionCount: leg.answeredQuestionCount,
  };
}

function canonicalOpponentPlannerRequest(input: Readonly<{
  graph: CaseGraphV1;
  state: TrialStateV3;
  actor: ActorRef;
  callId?: string;
  decisionId?: string;
}>): OpponentPlannerRequest {
  const material = opponentDecisionMaterial(input.state, input.actor);
  const decisionId = stableRuntimeId("decision:opponent", material);
  if (input.decisionId !== undefined && input.decisionId !== decisionId) {
    throw new Error("OPPONENT_PLAN_GENERATION_STALE");
  }
  const callId =
    input.callId ?? freshModelCallId("opponent", { decisionId, material });
  if (
    !isFreshModelCallId(callId, "opponent", { decisionId, material })
  ) {
    throw new Error("OPPONENT_PLAN_GENERATION_INVALID");
  }
  const knowledgeView = buildOpponentPlannerKnowledgeView(
    { caseGraph: input.graph, trial: input.state },
    input.actor.actorId,
  );
  const counselEvidenceIds = new Set(
    knowledgeView.counsel.evidence.map((evidence) => evidence.evidenceId),
  );
  const witness = input.graph.witnesses.find(
    (candidate) => candidate.witnessId === material.witnessId,
  );
  if (!witness) throw new Error("UNKNOWN_WITNESS");
  const seenEvidenceIds = new Set(
    witness.knowledgeBoundary.seenEvidenceIds,
  );
  const presentableEvidenceIds = Object.values(input.state.evidence)
    .filter(
      (evidence) =>
        counselEvidenceIds.has(evidence.evidenceId) &&
        seenEvidenceIds.has(evidence.evidenceId) &&
        evidence.status !== "excluded" &&
        evidence.status !== "withdrawn",
    )
    .map((evidence) => evidence.evidenceId)
    .sort((left, right) => left.localeCompare(right));

  return OpponentPlannerRequestSchema.parse({
    schemaVersion: "opponent-planner.request.v1",
    callId,
    decisionId,
    trialId: input.state.trialId,
    expectedStateVersion: input.state.version,
    expectedLastEventId: material.lastEventId,
    actorId: input.actor.actorId,
    procedure: {
      phase: input.state.phase,
      trigger:
        material.answeredQuestionCount === 0
          ? "player_examination_completed"
          : "opponent_turn_continues",
      activeAppearanceId: material.appearanceId,
      activeWitnessId: material.witnessId,
      activeExaminationKind: material.examinationKind,
      answeredQuestionCount: material.answeredQuestionCount,
    },
    opportunities: {
      callableWitnessIds: [],
      questionableWitnessIds:
        material.answeredQuestionCount >= MAX_OPPONENT_QUESTIONS_PER_LEG
          ? []
          : [material.witnessId],
      presentableEvidenceIds,
      offerableEvidenceIds: [],
      foundationTestimonyIds: [],
      strikeableTestimonyIds: [],
      permittedObjectionGrounds: [],
      canObject: false,
      canRequestNegotiation: false,
      canRest: false,
      canClose: false,
    },
    knowledgeView,
  });
}

function counselScopeMatchesTrace(
  trace: CourtroomModelCallTrace,
  request: OpponentPlannerRequest | CounselResponseRequest,
): boolean {
  const view = request.knowledgeView;
  const factCount = new Set([
    ...view.counsel.facts.map((fact) => fact.factId),
    ...view.publicRecord.facts.map((fact) => fact.factId),
  ]).size;
  const evidenceCount = new Set([
    ...view.counsel.evidence.map((evidence) => evidence.evidenceId),
    ...view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
  ]).size;
  const sourceSegmentCount = new Set([
    ...view.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...view.publicRecord.evidence.flatMap(
      (evidence) => evidence.sourceSegmentIds,
    ),
  ]).size;
  const publicRecordEventCount = new Set(
    view.publicRecord.testimony.map((testimony) => testimony.transcriptEventId),
  ).size;
  return (
    trace.knowledgeScope.knowledgeSchemaVersion === view.schemaVersion &&
    trace.knowledgeScope.knowledgeViewHash ===
      sha256Utf8(JSON.stringify(view)) &&
    trace.knowledgeScope.stateVersion === view.stateVersion &&
    trace.knowledgeScope.factCount === factCount &&
    trace.knowledgeScope.evidenceCount === evidenceCount &&
    trace.knowledgeScope.testimonyCount === view.publicRecord.testimony.length &&
    trace.knowledgeScope.priorStatementCount === 0 &&
    trace.knowledgeScope.sourceSegmentCount === sourceSegmentCount &&
    trace.knowledgeScope.publicRecordEventCount === publicRecordEventCount &&
    trace.knowledgeScope.currentExchangeCount ===
      (view.currentExchange === null ? 0 : 1)
  );
}

function traceMatchesOpponentPlanRequest(
  trace: CourtroomModelCallTrace,
  request: OpponentPlannerRequest,
): boolean {
  return (
    trace.trialId === request.trialId &&
    trace.callId === request.callId &&
    trace.responseId === null &&
    trace.actorId === request.actorId &&
    trace.actorRole === "counsel" &&
    trace.expectedStateVersion === request.expectedStateVersion &&
    trace.expectedLastEventId === request.expectedLastEventId &&
    sameOrderedIds(trace.inputEventIds, [request.expectedLastEventId]) &&
    counselScopeMatchesTrace(trace, request)
  );
}

function canonicalCounselResponseRequest(input: Readonly<{
  graph: CaseGraphV1;
  state: TrialStateV3;
  actor: ActorRef;
  callId?: string;
  decisionId?: string;
}>): CounselResponseRequest {
  const material = opponentDecisionMaterial(input.state, input.actor);
  const strategy = input.state.opposingStrategy;
  if (
    !strategy ||
    strategy.ownerActorId !== input.actor.actorId ||
    strategy.pendingDirectiveJson === undefined ||
    strategy.pendingDirectiveJson === null
  ) {
    throw new Error("COUNSEL_GENERATION_STALE");
  }
  const record = assertPersistedOpponentDirectiveBinding(
    parsePersistedOpponentDirective(strategy.pendingDirectiveJson),
    {
      trialId: input.state.trialId,
      stateVersion: input.state.version,
      lastEventId: material.lastEventId,
      actorId: input.actor.actorId,
      strategyId: strategy.strategyId,
      strategyRevision: strategy.revision,
      appearance: {
        appearanceId: material.appearanceId,
        witnessId: material.witnessId,
        examinationKind: material.examinationKind,
        answeredQuestionCount: material.answeredQuestionCount,
      },
    },
  );
  if (
    input.decisionId !== undefined &&
    input.decisionId !== record.decisionId
  ) {
    throw new Error("COUNSEL_GENERATION_STALE");
  }
  const callMaterial = {
    decisionId: record.decisionId,
    strategyEventId: record.strategyEventId,
    stateVersion: input.state.version,
  };
  const callId =
    input.callId ?? freshModelCallId("counsel", callMaterial);
  if (!isFreshModelCallId(callId, "counsel", callMaterial)) {
    throw new Error("COUNSEL_GENERATION_INVALID");
  }
  return CounselResponseRequestSchema.parse({
    schemaVersion: "role-responder.counsel.request.v1",
    callId,
    decisionId: record.decisionId,
    trialId: input.state.trialId,
    expectedStateVersion: input.state.version,
    expectedLastEventId: material.lastEventId,
    actorId: input.actor.actorId,
    appearance: record.appearance,
    planBinding: {
      plannerCallId: record.plannerCallId,
      plannerOutputHash: record.plannerOutputHash,
      strategyId: record.strategyId,
      strategyRevision: record.strategyRevision,
    },
    directive: record.directive,
    knowledgeView: buildOpponentCounselPublicKnowledgeView(
      { caseGraph: input.graph, trial: input.state },
      input.actor.actorId,
    ),
  });
}

function samePlanBinding(
  left: CounselResponseRequest["planBinding"],
  right: CounselResponseRequest["planBinding"],
): boolean {
  return (
    left.plannerCallId === right.plannerCallId &&
    left.plannerOutputHash === right.plannerOutputHash &&
    left.strategyId === right.strategyId &&
    left.strategyRevision === right.strategyRevision
  );
}

function traceMatchesCounselResponseRequest(
  envelope: HearingCounselResponsePrecommit,
  request: CounselResponseRequest,
): boolean {
  const trace = envelope.trace;
  return (
    envelope.decisionId === request.decisionId &&
    envelope.expectedStateVersion === request.expectedStateVersion &&
    envelope.expectedLastEventId === request.expectedLastEventId &&
    samePlanBinding(envelope.planBinding, request.planBinding) &&
    trace.trialId === request.trialId &&
    trace.callId === request.callId &&
    trace.responseId === null &&
    trace.actorId === request.actorId &&
    trace.actorRole === "counsel" &&
    trace.expectedStateVersion === request.expectedStateVersion &&
    trace.expectedLastEventId === request.expectedLastEventId &&
    sameOrderedIds(trace.inputEventIds, [request.expectedLastEventId]) &&
    counselScopeMatchesTrace(trace, request)
  );
}

async function releaseReadyWitness(
  ctx: ActionCtx,
  ownerId: string,
  head: { state: TrialStateV3 },
): Promise<void> {
  const appearance = activeAppearance(head.state);
  if (appearance.stage !== "ready_for_release") {
    throw new Error("WITNESS_NOT_READY_FOR_RELEASE");
  }
  const causationId = lastEventId(head.state);
  const releaseActionId = stableRuntimeId("action:release-witness", {
    trialId: head.state.trialId,
    appearanceId: appearance.appearanceId,
    causationId,
  });
  const releaseCounsel = actorByRole(
    head.state,
    counselRoleForSide(appearance.callingSide),
    appearance.callingSide,
  );
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: releaseActionId,
      trialId: head.state.trialId,
      expectedStateVersion: head.state.version,
      actor: releaseCounsel,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(head.state.updatedAt, 1),
      causationId,
      type: "RELEASE_WITNESS",
      payload: { witnessId: appearance.witnessId },
    }),
    false,
    true,
  );
}

async function canonicalContinuation(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
): Promise<HearingCommandPreparation> {
  let head = await loadHead(ctx, ownerId, trialId);
  const activeQuestion = head.state.activeQuestionId
    ? head.state.questions[head.state.activeQuestionId]
    : undefined;
  const activeResponse = activeQuestion?.activeResponseId
    ? head.state.pendingResponses[activeQuestion.activeResponseId]
    : undefined;
  if (
    activeResponse?.status === "pending" ||
    activeResponse?.status === "streaming"
  ) {
    const request = canonicalWitnessAnswerRequest({
      trialId,
      responseId: activeResponse.responseId,
      callId: createWitnessModelCallId(trialId, activeResponse.responseId),
      graph: head.graph,
      state: head.state,
    });
    return HearingCommandPreparationSchema.parse({
      schemaVersion: "hearing-command-preparation.v1",
      status: "model_required",
      request,
    });
  }

  if (head.state.activeAppearanceId === null) {
    return HearingCommandPreparationSchema.parse({
      schemaVersion: "hearing-command-preparation.v1",
      status: "completed",
      view: head.view,
    });
  }
  const appearance = activeAppearance(head.state);
  if (appearance.stage === "ready_for_release") {
    await releaseReadyWitness(ctx, ownerId, head);
    head = await loadHead(ctx, ownerId, trialId);
    return HearingCommandPreparationSchema.parse({
      schemaVersion: "hearing-command-preparation.v1",
      status: "completed",
      view: head.view,
    });
  }
  if (
    appearance.stage === "awaiting_oath" ||
    appearance.stage === "direct" ||
    appearance.stage === "redirect"
  ) {
    return HearingCommandPreparationSchema.parse({
      schemaVersion: "hearing-command-preparation.v1",
      status: "completed",
      view: head.view,
    });
  }

  const actor = opposingCounselForAiRuntime(head.state);
  const strategy = head.state.opposingStrategy;
  if (
    strategy?.ownerActorId === actor.actorId &&
    strategy.pendingDirectiveJson !== undefined &&
    strategy.pendingDirectiveJson !== null &&
    strategy.lastEventId === lastEventId(head.state)
  ) {
    const request = canonicalCounselResponseRequest({
      graph: head.graph,
      state: head.state,
      actor,
    });
    return HearingCommandPreparationSchema.parse({
      schemaVersion: "hearing-command-preparation.v1",
      status: "model_required",
      request,
    });
  }
  const request = canonicalOpponentPlannerRequest({
    graph: head.graph,
    state: head.state,
    actor,
  });
  return HearingCommandPreparationSchema.parse({
    schemaVersion: "hearing-command-preparation.v1",
    status: "model_required",
    request,
  });
}

async function finishWitness(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  state: TrialStateV3,
): Promise<void> {
  if (command.intent.type !== "finish_witness") throw new Error("INVALID_INTENT");
  const endActionId = runtimeActionId(
    trialId,
    command.requestId,
    `end-${command.intent.examinationKind}`,
  );
  if (
    await ctx.runQuery(eventExistsReference, {
      ownerId,
      trialId,
      actionId: endActionId,
    })
  ) {
    return;
  }
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
      await prepareWitnessQuestion(
        ctx,
        ownerId,
        args.trialId,
        commandInput,
        head,
      );
      return await canonicalContinuation(ctx, ownerId, args.trialId);
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
  return await canonicalContinuation(ctx, ownerId, args.trialId);
}

/** Secret-only prepare boundary for one strictly role-scoped model request. */
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

function opponentPlanActionId(trialId: string, decisionId: string): string {
  return stableRuntimeId("action:opponent-plan", { trialId, decisionId });
}

function counselTurnActionId(trialId: string, decisionId: string): string {
  return stableRuntimeId("action:counsel-turn", { trialId, decisionId });
}

function opponentStrategyIdentity(
  state: TrialStateV3,
  actor: ActorRef,
): Readonly<{ strategyId: string; revision: number }> {
  const current = state.opposingStrategy;
  if (current !== null && current.ownerActorId !== actor.actorId) {
    throw new Error("OPPONENT_PLAN_GENERATION_INVALID");
  }
  return {
    strategyId:
      current?.strategyId ??
      stableRuntimeId("strategy:opponent", {
        trialId: state.trialId,
        actorId: actor.actorId,
      }),
    revision: (current?.revision ?? 0) + 1,
  };
}

function invalidOpponentPlanGeneration(): never {
  throw new Error("OPPONENT_PLAN_GENERATION_INVALID");
}

function invalidCounselGeneration(): never {
  throw new Error("COUNSEL_GENERATION_INVALID");
}

async function appendOpponentPlanGeneration(
  ctx: ActionCtx,
  ownerId: string,
  actionJson: string,
  generation: HearingOpponentPlanPrecommit,
): Promise<void> {
  try {
    await ctx.runMutation(appendOpponentPlanForOwnerReference, {
      ownerId,
      actionJson,
      generationJson: JSON.stringify(generation),
      writeSnapshot: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("STALE")) {
      throw new Error("OPPONENT_PLAN_GENERATION_STALE");
    }
    if (
      message.includes("CONFLICT") ||
      message.includes("GENERATION") ||
      message.includes("MODEL_CALL") ||
      message.includes("OPPONENT_DIRECTIVE")
    ) {
      return invalidOpponentPlanGeneration();
    }
    throw error;
  }
}

/** Commit one private plan and return only its canonical next preparation. */
export const commitOpponentPlanGeneration = internalAction({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    generationJson: v.string(),
  },
  handler: async (ctx, args): Promise<HearingCommandPreparation> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    let generationInput: unknown;
    try {
      generationInput = parseJson(
        args.generationJson,
        "opponent_plan_precommit",
      );
    } catch {
      return invalidOpponentPlanGeneration();
    }
    const parsed = HearingOpponentPlanPrecommitSchema.safeParse(
      generationInput,
    );
    if (!parsed.success || parsed.data.trialId !== args.trialId) {
      return invalidOpponentPlanGeneration();
    }
    const envelope = parsed.data;
    const actionId = opponentPlanActionId(
      args.trialId,
      envelope.decisionId,
    );
    const existing = await ctx.runQuery(loadGeneratedCounselTurnReference, {
      ownerId,
      trialId: args.trialId,
      actionId,
    });
    if (existing !== null) {
      await appendOpponentPlanGeneration(
        ctx,
        ownerId,
        existing.actionJson,
        envelope,
      );
      return await canonicalContinuation(ctx, ownerId, args.trialId);
    }

    const head = await loadHead(ctx, ownerId, args.trialId);
    const actor = opposingCounselForAiRuntime(head.state);
    const request = canonicalOpponentPlannerRequest({
      graph: head.graph,
      state: head.state,
      actor,
      callId: envelope.callId,
      decisionId: envelope.decisionId,
    });
    if (
      envelope.trace.completedAt === null ||
      !traceMatchesOpponentPlanRequest(envelope.trace, request)
    ) {
      return invalidOpponentPlanGeneration();
    }
    const validation = validateOpponentPlannerOutput(request, envelope.output);
    if (!validation.accepted) return invalidOpponentPlanGeneration();
    const strategy = opponentStrategyIdentity(head.state, actor);
    const strategyEventId = eventIdForAction(actionId);
    const persistedDirective = createPersistedOpponentDirective({
      request,
      output: validation.output,
      canonicalBinding: {
        trialId: args.trialId,
        expectedStateVersion: request.expectedStateVersion,
        expectedLastEventId: request.expectedLastEventId,
        actorId: actor.actorId,
        strategyId: strategy.strategyId,
        strategyRevision: strategy.revision,
        strategyEventId,
        appearance: {
          appearanceId: request.procedure.activeAppearanceId!,
          witnessId: request.procedure.activeWitnessId!,
          examinationKind: request.procedure.activeExaminationKind!,
          answeredQuestionCount: request.procedure.answeredQuestionCount,
        },
      },
    });
    const action = actionFromIntent({
      actionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion,
      actor,
      source: "ai",
      requestedAt: envelope.trace.completedAt,
      causationId: request.expectedLastEventId,
      modelMetadata: envelope.modelMetadata,
      type: "UPDATE_OPPOSING_STRATEGY",
      payload: {
        strategyId: strategy.strategyId,
        revision: strategy.revision,
        objectives: validation.output.objectives,
        witnessPriorityIds: validation.output.witnessPriorityIds,
        evidencePriorityIds: validation.output.evidencePriorityIds,
        settlementPosture: validation.output.settlementPosture,
        privateNotes: validation.output.privateNotes,
        pendingDirectiveJson: serializePersistedOpponentDirective(
          persistedDirective,
        ),
      },
    });
    await appendOpponentPlanGeneration(
      ctx,
      ownerId,
      JSON.stringify(action),
      envelope,
    );
    return await canonicalContinuation(ctx, ownerId, args.trialId);
  },
});

function emptyCourtroomCitations() {
  return {
    factIds: [] as string[],
    evidenceIds: [] as string[],
    testimonyIds: [] as string[],
    eventIds: [] as string[],
    sourceSegmentIds: [] as string[],
  };
}

function counselContinuationForAction(input: Readonly<{
  state: TrialStateV3;
  request: CounselResponseRequest;
  action: TrialActionV3;
  completedAt: string;
}>): TrialActionV3 | null {
  const appearance = activeAppearance(input.state);
  if (input.action.type === "ASK_QUESTION") {
    const witnessActor = Object.values(input.state.actors).find(
      (actor) =>
        actor.role === "witness" &&
        actor.witnessId === appearance.witnessId,
    );
    if (!witnessActor) return invalidCounselGeneration();
    const responseId = stableRuntimeId("response:counsel", {
      trialId: input.state.trialId,
      decisionId: input.request.decisionId,
    });
    return actionFromIntent({
      actionId: stableRuntimeId("action:request-counsel-response", {
        trialId: input.state.trialId,
        decisionId: input.request.decisionId,
      }),
      trialId: input.state.trialId,
      expectedStateVersion: input.request.expectedStateVersion + 1,
      actor: actorByRole(input.state, "system", "neutral"),
      source: "system",
      requestedAt: requestedAtWithOffset(input.completedAt, 1),
      causationId: eventIdForAction(input.action.actionId),
      type: "REQUEST_RESPONSE",
      payload: {
        responseId,
        actorId: witnessActor.actorId,
        purpose: "answer_question",
      },
    });
  }
  if (input.action.type !== "END_EXAMINATION") {
    return invalidCounselGeneration();
  }
  const shouldRelease =
    input.action.payload.disposition === "waived" ||
    input.request.appearance.examinationKind === "recross";
  if (!shouldRelease) return null;
  const releaseCounsel = actorByRole(
    input.state,
    counselRoleForSide(appearance.callingSide),
    appearance.callingSide,
  );
  return actionFromIntent({
    actionId: stableRuntimeId("action:release-after-counsel", {
      trialId: input.state.trialId,
      decisionId: input.request.decisionId,
    }),
    trialId: input.state.trialId,
    expectedStateVersion: input.request.expectedStateVersion + 1,
    actor: releaseCounsel,
    source: "deterministic",
    requestedAt: requestedAtWithOffset(input.completedAt, 1),
    causationId: eventIdForAction(input.action.actionId),
    type: "RELEASE_WITNESS",
    payload: { witnessId: appearance.witnessId },
  });
}

async function appendCounselGeneration(
  ctx: ActionCtx,
  ownerId: string,
  actionJson: string,
  continuationActionJson: string | null,
  generation: HearingCounselResponsePrecommit,
): Promise<void> {
  try {
    await ctx.runMutation(appendCounselTurnForOwnerReference, {
      ownerId,
      actionJson,
      continuationActionJson,
      generationJson: JSON.stringify(generation),
      writeSnapshot: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("STALE")) {
      throw new Error("COUNSEL_GENERATION_STALE");
    }
    if (
      message.includes("CONFLICT") ||
      message.includes("GENERATION") ||
      message.includes("MODEL_CALL") ||
      message.includes("DIRECTIVE")
    ) {
      return invalidCounselGeneration();
    }
    throw error;
  }
}

/** Commit one public counsel turn and resume at its canonical next boundary. */
export const commitCounselGeneration = internalAction({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    generationJson: v.string(),
  },
  handler: async (ctx, args): Promise<HearingCommandPreparation> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    let generationInput: unknown;
    try {
      generationInput = parseJson(
        args.generationJson,
        "counsel_generation_precommit",
      );
    } catch {
      return invalidCounselGeneration();
    }
    const parsed = HearingCounselResponsePrecommitSchema.safeParse(
      generationInput,
    );
    if (!parsed.success || parsed.data.trialId !== args.trialId) {
      return invalidCounselGeneration();
    }
    const envelope = parsed.data;
    const actionId = counselTurnActionId(args.trialId, envelope.decisionId);
    const existing = await ctx.runQuery(loadGeneratedCounselTurnReference, {
      ownerId,
      trialId: args.trialId,
      actionId,
    });
    if (existing !== null) {
      await appendCounselGeneration(
        ctx,
        ownerId,
        existing.actionJson,
        existing.continuationActionJson,
        envelope,
      );
      return await canonicalContinuation(ctx, ownerId, args.trialId);
    }

    const head = await loadHead(ctx, ownerId, args.trialId);
    const actor = opposingCounselForAiRuntime(head.state);
    const request = canonicalCounselResponseRequest({
      graph: head.graph,
      state: head.state,
      actor,
      callId: envelope.callId,
      decisionId: envelope.decisionId,
    });
    if (
      envelope.trace.completedAt === null ||
      !traceMatchesCounselResponseRequest(envelope, request)
    ) {
      return invalidCounselGeneration();
    }
    const validation = validateCounselResponseOutput(request, envelope.output);
    if (!validation.accepted) return invalidCounselGeneration();
    const response = validation.response;
    let action: TrialActionV3;
    if (response.action.kind === "ask_question") {
      const questionId = stableRuntimeId("question:counsel", {
        trialId: args.trialId,
        decisionId: request.decisionId,
      });
      action = actionFromIntent({
        actionId,
        trialId: args.trialId,
        expectedStateVersion: request.expectedStateVersion,
        actor,
        source: "ai",
        requestedAt: envelope.trace.completedAt,
        causationId: request.expectedLastEventId,
        modelMetadata: envelope.modelMetadata,
        type: "ASK_QUESTION",
        payload: {
          questionId,
          witnessId: request.appearance.witnessId,
          examinationKind: request.appearance.examinationKind,
          text: response.text,
          turnId: stableRuntimeId("turn:counsel-question", {
            trialId: args.trialId,
            decisionId: request.decisionId,
          }),
          presentedEvidenceIds: response.action.presentedEvidenceIds,
          factIds: response.factIds,
          evidenceIds: response.evidenceIds,
          testimonyIds: response.testimonyIds,
        },
      });
    } else if (response.action.kind === "end_examination") {
      action = actionFromIntent({
        actionId,
        trialId: args.trialId,
        expectedStateVersion: request.expectedStateVersion,
        actor,
        source: "ai",
        requestedAt: envelope.trace.completedAt,
        causationId: request.expectedLastEventId,
        modelMetadata: envelope.modelMetadata,
        type: "END_EXAMINATION",
        payload: {
          witnessId: request.appearance.witnessId,
          examinationKind: request.appearance.examinationKind,
          disposition: response.action.disposition,
          turnId: stableRuntimeId("turn:counsel-end", {
            trialId: args.trialId,
            decisionId: request.decisionId,
          }),
          text: response.text,
          citations: {
            ...emptyCourtroomCitations(),
            factIds: response.factIds,
            evidenceIds: response.evidenceIds,
            testimonyIds: response.testimonyIds,
          },
        },
      });
    } else {
      return invalidCounselGeneration();
    }
    const continuation = counselContinuationForAction({
      state: head.state,
      request,
      action,
      completedAt: envelope.trace.completedAt,
    });
    await appendCounselGeneration(
      ctx,
      ownerId,
      JSON.stringify(action),
      continuation === null ? null : JSON.stringify(continuation),
      envelope,
    );
    return await canonicalContinuation(ctx, ownerId, args.trialId);
  },
});

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
  handler: async (ctx, args): Promise<HearingCommandPreparation> => {
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
      return await canonicalContinuation(ctx, ownerId, args.trialId);
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
    return await canonicalContinuation(ctx, ownerId, args.trialId);
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
