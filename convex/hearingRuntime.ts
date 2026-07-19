import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
  CaseGraphV1Schema,
  sha256Utf8,
  type CaseGraphV1,
} from "../src/domain/case-graph";
import {
  CounselResponseRequestSchema,
  DebriefGeneratorRequestSchema,
  JuryResponseRequestSchema,
  NegotiationAgentRequestSchema,
  ObjectionRulingRequestSchema,
  OpponentPlannerRequestSchema,
  WitnessAnswerRequestSchema,
  validateCounselResponseOutput,
  validateDebriefGeneratorOutput,
  validateJuryResponseOutput,
  validateNegotiationAgentOutput,
  validateObjectionRulingOutput,
  validateOpponentPlannerOutput,
  validateWitnessAnswerOutput,
  validateWitnessAnswerRequestBinding,
  type CounselResponseRequest,
  type CourtroomModelCallTrace,
  type DebriefGeneratorRequest,
  type JuryResponseRequest,
  type NegotiationAgentRequest,
  type ObjectionRulingRequest,
  type OpponentPlannerRequest,
  type WitnessAnswerRequest,
} from "../src/domain/courtroom-ai";
import {
  HearingCounselResponsePrecommitSchema,
  HearingCommandPreparationSchema,
  HearingCaseSelectorSchema,
  HearingDebriefGeneratorPrecommitSchema,
  HearingJuryResponsePrecommitSchema,
  HearingNegotiationPrecommitSchema,
  HearingObjectionRulingPrecommitSchema,
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
  type HearingDebriefGeneratorPrecommit,
  type HearingJuryResponsePrecommit,
  type HearingNegotiationPrecommit,
  type HearingObjectionRulingPrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime";
import {
  buildKnowledgeView,
  buildJuryRecord,
  buildOpponentCounselPublicKnowledgeView,
  buildOpponentPlannerKnowledgeView,
} from "../src/domain/knowledge";
import { getSeededCaseBySlug as seededCaseBySlug } from "../src/domain/seeded-cases";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TRIAL_EVENT_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  TrialStateV3Schema,
  type ActorRef,
  type EventSource,
  type ModelMetadata,
  type TrialActionV3,
  type TrialStateV3,
} from "../src/domain/trial-engine";
import {
  canActorCounterSettlement,
  isSettlementOfferExpired,
  settlementExpirySequence,
} from "../src/domain/trial-policy";
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

type VerdictAction = Extract<TrialActionV3, { type: "RENDER_VERDICT" }>;

type FinalTrialAudit = Readonly<{
  trialId: string;
  stateVersion: number;
  lastEventId: string;
  closingTurnIds: string[];
  verdict: Readonly<{
    verdictId: string;
    decision: string;
    sourceEventId: string;
    citations: VerdictAction["payload"]["citations"];
  }> | null;
}>;

type GeneratedFinalBundle = Readonly<{
  actionJsons: string[];
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

const appendJuryGenerationForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJsons: string[];
    generationJson: string;
  }>,
  ActionReceipt
>("trialEvents:appendJuryGenerationForOwner");

const appendDebriefGenerationForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJsons: string[];
    generationJson: string;
  }>,
  ActionReceipt
>("trialEvents:appendDebriefGenerationForOwner");

const appendObjectionRulingForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJsons: string[];
    generationJson: string;
  }>,
  ActionReceipt
>("trialEvents:appendObjectionRulingForOwner");

const appendNegotiationDecisionForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    generationJson: string;
  }>,
  ActionReceipt
>("trialEvents:appendNegotiationDecisionForOwner");

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

const loadFinalTrialAuditReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  FinalTrialAudit
>("hearingRuntime:loadFinalTrialAuditForOwner");

const loadGeneratedFinalBundleReference = makeFunctionReference<
  "query",
  Readonly<{
    ownerId: string;
    trialId: string;
    actionId: string;
    kind: "jury_deliberation" | "final_debrief";
  }>,
  GeneratedFinalBundle | null
>("hearingRuntime:loadGeneratedFinalBundleForOwner");

const loadGeneratedObjectionBundleReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string; actionId: string }>,
  GeneratedFinalBundle | null
>("hearingRuntime:loadGeneratedObjectionBundleForOwner");

const loadGeneratedNegotiationActionReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string; actionId: string }>,
  Readonly<{ actionJson: string }> | null
>("hearingRuntime:loadGeneratedNegotiationActionForOwner");

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
  ): Promise<Readonly<{
    actionJson: string;
    continuationActionJson: string | null;
  }> | null> => {
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
        "GIVE_CLOSING",
      ].includes(event.eventType)
    ) {
      throw new Error("COURTROOM_GENERATION_INVALID");
    }

    const nextEvent = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index.eq("trialId", args.trialId).eq("sequence", event.sequence + 1),
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
    return {
      actionJson: storedEventActionJson(event),
      continuationActionJson: continuation,
    };
  },
});

/** Reconstruct an exact ruling/resolution bundle for idempotent replay. */
export const loadGeneratedObjectionBundleForOwner = internalQuery({
  args: { ownerId: v.string(), trialId: v.string(), actionId: v.string() },
  handler: async (ctx, args): Promise<GeneratedFinalBundle | null> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const projection = await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", args.trialId))
      .unique();
    if (!projection || projection.ownerId !== ownerId) {
      throw new Error("TRIAL_NOT_FOUND");
    }
    const primary = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_action", (index) =>
        index.eq("trialId", args.trialId).eq("actionId", args.actionId),
      )
      .unique();
    if (!primary) return null;
    if (
      primary.eventType !== "RULE_ON_OBJECTION" ||
      primary.source !== "ai" ||
      primary.model === undefined
    ) {
      throw new Error("OBJECTION_RULING_GENERATION_INVALID");
    }
    const resolve = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index
          .eq("trialId", args.trialId)
          .eq("sequence", primary.sequence + 1),
      )
      .unique();
    if (
      !resolve ||
      resolve.eventType !== "RESOLVE_INTERRUPTION" ||
      resolve.source !== "deterministic" ||
      resolve.causationId !== primary.eventId
    ) {
      throw new Error("OBJECTION_RULING_GENERATION_INVALID");
    }
    const resolveAction = TrialActionV3Schema.parse(
      parseJson(storedEventActionJson(resolve), "stored_resolve_action"),
    );
    if (resolveAction.type !== "RESOLVE_INTERRUPTION") {
      throw new Error("OBJECTION_RULING_GENERATION_INVALID");
    }
    const rows = [primary, resolve];
    if (resolveAction.payload.outcome === "resume") {
      const resume = await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index
            .eq("trialId", args.trialId)
            .eq("sequence", resolve.sequence + 1),
        )
        .unique();
      if (
        !resume ||
        resume.eventType !== "RESUME_INTERRUPTED_SPEECH" ||
        resume.source !== "deterministic" ||
        resume.causationId !== resolve.eventId
      ) {
        throw new Error("OBJECTION_RULING_GENERATION_INVALID");
      }
      rows.push(resume);
    }
    return { actionJsons: rows.map(storedEventActionJson) };
  },
});

/** Reconstruct one exact generated settlement action for replay. */
export const loadGeneratedNegotiationActionForOwner = internalQuery({
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
      event.source !== "ai" ||
      event.model === undefined ||
      ![
        "COUNTER_SETTLEMENT",
        "ACCEPT_SETTLEMENT",
        "REJECT_SETTLEMENT",
      ].includes(event.eventType)
    ) {
      throw new Error("NEGOTIATION_GENERATION_INVALID");
    }
    return { actionJson: storedEventActionJson(event) };
  },
});

/**
 * Owner-guarded reconstruction of final-flow fields intentionally omitted
 * from TrialStateV3. The query walks the full canonical stream, so snapshots
 * cannot hide an earlier closing or verdict event.
 */
export const loadFinalTrialAuditForOwner = internalQuery({
  args: { ownerId: v.string(), trialId: v.string() },
  handler: async (ctx, args): Promise<FinalTrialAudit> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const projection = await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", args.trialId))
      .unique();
    if (!projection || projection.ownerId !== ownerId) {
      throw new Error("TRIAL_NOT_FOUND");
    }
    if (
      projection.stateSchemaVersion !== "trial-state.v3" ||
      projection.eventSchemaVersion !== TRIAL_EVENT_SCHEMA_VERSION_V3
    ) {
      throw new Error("TRIAL_MIGRATION_REQUIRED");
    }
    const state = TrialStateV3Schema.parse(
      parseJson(projection.stateJson, "trial_state_json"),
    );
    if (
      state.trialId !== args.trialId ||
      state.version !== projection.stateVersion ||
      state.lastSequence !== projection.lastSequence
    ) {
      throw new Error("TRIAL_PROJECTION_INVALID");
    }
    const rows = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index.eq("trialId", args.trialId),
      )
      .order("asc")
      .take(5_001);
    if (
      rows.length === 0 ||
      rows.length > 5_000 ||
      rows.length !== projection.lastSequence ||
      rows.some((row, index) => row.sequence !== index + 1) ||
      rows.at(-1)?.eventId !== state.eventIds.at(-1)
    ) {
      throw new Error("TRIAL_EVENT_STREAM_INVALID");
    }

    const closingTurnIds: string[] = [];
    const verdicts: FinalTrialAudit["verdict"][] = [];
    for (const row of rows) {
      if (row.eventType !== "GIVE_CLOSING" && row.eventType !== "RENDER_VERDICT") {
        continue;
      }
      const action = TrialActionV3Schema.parse(
        parseJson(storedEventActionJson(row), "trial_event_action"),
      );
      if (action.type === "GIVE_CLOSING") {
        closingTurnIds.push(action.payload.turnId);
      } else if (action.type === "RENDER_VERDICT") {
        verdicts.push({
          verdictId: action.payload.verdictId,
          decision: action.payload.decision,
          sourceEventId: row.eventId,
          citations: action.payload.citations,
        });
      }
    }
    if (
      closingTurnIds.length !== state.closingSides.length ||
      closingTurnIds.some((turnId) => state.transcriptTurns[turnId] === undefined)
    ) {
      throw new Error("TRIAL_CLOSING_AUDIT_INVALID");
    }
    const verdict = verdicts.length === 1 ? verdicts[0] ?? null : null;
    if (
      (state.verdictId === null && verdicts.length !== 0) ||
      (state.verdictId !== null &&
        (verdicts.length !== 1 || verdict?.verdictId !== state.verdictId))
    ) {
      throw new Error("TRIAL_VERDICT_AUDIT_INVALID");
    }
    const headEventId = state.eventIds.at(-1);
    if (!headEventId) throw new Error("TRIAL_EVENT_HEAD_REQUIRED");
    return {
      trialId: args.trialId,
      stateVersion: state.version,
      lastEventId: headEventId,
      closingTurnIds,
      verdict,
    };
  },
});

/** Return only the exact stored action bundle needed for idempotent replay. */
export const loadGeneratedFinalBundleForOwner = internalQuery({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    actionId: v.string(),
    kind: v.union(
      v.literal("jury_deliberation"),
      v.literal("final_debrief"),
    ),
  },
  handler: async (ctx, args): Promise<GeneratedFinalBundle | null> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const projection = await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", args.trialId))
      .unique();
    if (!projection || projection.ownerId !== ownerId) {
      throw new Error("TRIAL_NOT_FOUND");
    }
    const primary = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_action", (index) =>
        index.eq("trialId", args.trialId).eq("actionId", args.actionId),
      )
      .unique();
    if (!primary) return null;
    const expectedTypes =
      args.kind === "jury_deliberation"
        ? (["DELIBERATE", "BEGIN_PHASE", "RENDER_VERDICT", "BEGIN_PHASE"] as const)
        : (["GENERATE_DEBRIEF", "BEGIN_PHASE"] as const);
    if (
      primary.eventType !== expectedTypes[0] ||
      primary.source !== "ai" ||
      primary.model === undefined
    ) {
      throw new Error("COURTROOM_GENERATION_INVALID");
    }
    const artifact = await ctx.db
      .query("courtroomGeneratedArtifacts")
      .withIndex("by_trial_event", (index) =>
        index.eq("trialId", args.trialId).eq("eventId", primary.eventId),
      )
      .unique();
    if (
      !artifact ||
      artifact.ownerId !== ownerId ||
      artifact.artifactKind !== args.kind ||
      artifact.actionId !== primary.actionId ||
      artifact.eventId !== primary.eventId
    ) {
      throw new Error("COURTROOM_GENERATED_ARTIFACT_INVALID");
    }
    const rows = [primary];
    for (let offset = 1; offset < expectedTypes.length; offset += 1) {
      const row = await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index
            .eq("trialId", args.trialId)
            .eq("sequence", primary.sequence + offset),
        )
        .unique();
      const previous = rows.at(-1);
      if (
        !row ||
        !previous ||
        row.eventType !== expectedTypes[offset] ||
        row.causationId !== previous.eventId
      ) {
        throw new Error("COURTROOM_GENERATION_INVALID");
      }
      rows.push(row);
    }
    return { actionJsons: rows.map(storedEventActionJson) };
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
    (actor) => actor.role === "opposing_counsel" && actor.side === "opposing",
  );
  if (matches.length !== 1) {
    throw new Error("RUNTIME_OPPOSING_COUNSEL_AMBIGUOUS");
  }
  return matches[0];
}

function assertSupportedAiRuntimeRoster(
  bindings: ReturnType<typeof deriveTrialActorBindings>,
): void {
  const userCounselCount = bindings.filter(
    ({ actor }) => actor.role === "user_counsel" && actor.side === "user",
  ).length;
  if (userCounselCount !== 1) {
    throw new Error("RUNTIME_USER_COUNSEL_AMBIGUOUS");
  }
  const opposingCounselCount = bindings.filter(
    ({ actor }) =>
      actor.role === "opposing_counsel" && actor.side === "opposing",
  ).length;
  if (opposingCounselCount !== 1) {
    throw new Error("RUNTIME_OPPOSING_COUNSEL_AMBIGUOUS");
  }
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

function juryGenerationIds(trialId: string, decisionId: string) {
  const material = { trialId, decisionId };
  return {
    actionId: stableRuntimeId("action:jury-deliberation", material),
    verdictPhaseActionId: stableRuntimeId("action:phase-verdict", material),
    verdictActionId: stableRuntimeId("action:render-verdict", material),
    debriefPhaseActionId: stableRuntimeId("action:phase-debrief", material),
    verdictId: stableRuntimeId("verdict:jury", material),
  };
}

function debriefGenerationIds(
  trialId: string,
  sourceStateVersion: number,
  sourceLastEventId: string,
) {
  const material = { trialId, sourceStateVersion, sourceLastEventId };
  const debriefId = stableRuntimeId("debrief:final", material);
  return {
    actionId: stableRuntimeId("action:debrief-generation", material),
    completePhaseActionId: stableRuntimeId("action:phase-complete", {
      trialId,
      debriefId,
    }),
    debriefId,
  };
}

function freshModelCallId(
  prefix:
    | "opponent"
    | "counsel"
    | "objection"
    | "negotiation"
    | "jury"
    | "debrief",
  material: unknown,
): string {
  const callId = `call:${prefix}:${sha256Utf8(JSON.stringify(material))}:${globalThis.crypto.randomUUID()}`;
  if (callId.length > 128) throw new Error("COURTROOM_GENERATION_INVALID");
  return callId;
}

function isFreshModelCallId(
  callId: string,
  prefix:
    | "opponent"
    | "counsel"
    | "objection"
    | "negotiation"
    | "jury"
    | "debrief",
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
  responseId?: string | null;
  interruptId?: string | null;
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
      input.responseId ??
      (typeof payload.responseId === "string" ? payload.responseId : null),
    interruptId:
      input.interruptId ??
      (typeof payload.interruptId === "string" ? payload.interruptId : null),
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
    if (request.userSide !== "user") {
      throw new Error("RUNTIME_AI_USER_SIDE_UNSUPPORTED");
    }
    const resolved = await ctx.runMutation(resolveGraphReference, {
      ownerId,
      selectorJson: JSON.stringify(request.case),
    });
    const graph = parseGraphJson(resolved.graphJson);
    const bindings = deriveTrialActorBindings(graph);
    assertSupportedAiRuntimeRoster(bindings);
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
    const judge = bindings.find(
      (binding) => binding.actor.role === "judge",
    )?.actor;
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
  const counsel = playerCounselForWitness(state, command.intent.witnessId);
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
  const resumedInterruption =
    pending?.interruptId !== null &&
    pending?.interruptId !== undefined &&
    input.state.activeInterruption?.interruptId === pending.interruptId &&
    input.state.activeInterruption.interruptedResponseId === pending.responseId &&
    input.state.activeInterruption.status === "resumed";
  if (
    !pending ||
    pending.status === "cancelled" ||
    pending.status === "committed" ||
    (pending.interruptId !== null && !resumedInterruption) ||
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
  if (
    validateWitnessAnswerRequestBinding(request.data, input.state).length > 0
  ) {
    return staleWitnessGeneration();
  }
  return request.data;
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameOrderedIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
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

type OpponentDecisionMaterialBase = Readonly<{
  trialId: string;
  stateVersion: number;
  lastEventId: string;
  actorId: string;
  answeredQuestionCount: number;
}>;
type OpponentDecisionMaterial =
  | (OpponentDecisionMaterialBase &
      Readonly<{
        mode: "examination";
        appearanceId: string;
        witnessId: string;
        examinationKind: "cross" | "recross";
      }>)
  | (OpponentDecisionMaterialBase &
      Readonly<{
        mode: "closing";
        appearanceId: null;
        witnessId: null;
        examinationKind: null;
      }>);

function opponentDecisionMaterial(
  state: TrialStateV3,
  actor: ActorRef,
): OpponentDecisionMaterial {
  if (
    state.phase === "closing" &&
    state.activeAppearanceId === null &&
    state.activeWitnessId === null &&
    !state.closingSides.includes("opposing")
  ) {
    return {
      mode: "closing",
      trialId: state.trialId,
      stateVersion: state.version,
      lastEventId: lastEventId(state),
      actorId: actor.actorId,
      appearanceId: null,
      witnessId: null,
      examinationKind: null,
      answeredQuestionCount: 0,
    };
  }
  const appearance = activeAppearance(state);
  if (appearance.stage !== "cross" && appearance.stage !== "recross") {
    throw new Error("RUNTIME_AI_EXAMINATION_REQUIRED");
  }
  const leg = appearance.legs[appearance.stage];
  if (leg.ownerSide !== "opposing") {
    throw new Error("RUNTIME_AI_EXAMINATION_REQUIRED");
  }
  return {
    mode: "examination",
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

function canonicalOpponentPlannerRequest(
  input: Readonly<{
    graph: CaseGraphV1;
    state: TrialStateV3;
    actor: ActorRef;
    callId?: string;
    decisionId?: string;
  }>,
): OpponentPlannerRequest {
  const material = opponentDecisionMaterial(input.state, input.actor);
  const decisionId = stableRuntimeId("decision:opponent", material);
  if (input.decisionId !== undefined && input.decisionId !== decisionId) {
    throw new Error("OPPONENT_PLAN_GENERATION_STALE");
  }
  const callId =
    input.callId ?? freshModelCallId("opponent", { decisionId, material });
  if (!isFreshModelCallId(callId, "opponent", { decisionId, material })) {
    throw new Error("OPPONENT_PLAN_GENERATION_INVALID");
  }
  const knowledgeView = buildOpponentPlannerKnowledgeView(
    { caseGraph: input.graph, trial: input.state },
    input.actor.actorId,
  );
  const counselEvidenceIds = new Set(
    knowledgeView.counsel.evidence.map((evidence) => evidence.evidenceId),
  );
  const witness =
    material.witnessId === null
      ? null
      : input.graph.witnesses.find(
          (candidate) => candidate.witnessId === material.witnessId,
        );
  if (material.mode === "examination" && !witness) {
    throw new Error("UNKNOWN_WITNESS");
  }
  const seenEvidenceIds = new Set(
    witness?.knowledgeBoundary.seenEvidenceIds ?? [],
  );
  const presentableEvidenceIds =
    material.mode === "closing"
      ? []
      : Object.values(input.state.evidence)
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
        material.mode === "closing"
          ? "pre_closing"
          : material.answeredQuestionCount === 0
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
        material.mode === "closing" ||
        material.answeredQuestionCount >= MAX_OPPONENT_QUESTIONS_PER_LEG
          ? []
          : material.witnessId === null
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
      canClose: material.mode === "closing",
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
    trace.knowledgeScope.testimonyCount ===
      view.publicRecord.testimony.length &&
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

function canonicalCounselResponseRequest(
  input: Readonly<{
    graph: CaseGraphV1;
    state: TrialStateV3;
    actor: ActorRef;
    callId?: string;
    decisionId?: string;
  }>,
): CounselResponseRequest {
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
      appearance:
        material.mode === "closing"
          ? null
          : {
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
  const callId = input.callId ?? freshModelCallId("counsel", callMaterial);
  if (!isFreshModelCallId(callId, "counsel", callMaterial)) {
    throw new Error("COUNSEL_GENERATION_INVALID");
  }
  return CounselResponseRequestSchema.parse({
    schemaVersion: "role-responder.counsel.request.v2",
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

function canonicalObjectionRulingRequest(
  input: Readonly<{
    graph: CaseGraphV1;
    state: TrialStateV3;
    actor: ActorRef;
    callId?: string;
    decisionId?: string;
  }>,
): ObjectionRulingRequest {
  const interruption = input.state.activeInterruption;
  if (
    interruption === null ||
    interruption.status !== "active" ||
    interruption.objectionId === null
  ) {
    throw new Error("OBJECTION_RULING_GENERATION_STALE");
  }
  const objection = input.state.objections[interruption.objectionId];
  const response =
    input.state.pendingResponses[interruption.interruptedResponseId];
  const question = response?.questionId
    ? input.state.questions[response.questionId]
    : undefined;
  const questionTurn = question
    ? input.state.transcriptTurns[question.questionTurnId]
    : undefined;
  if (
    objection === undefined ||
    objection.status !== "pending" ||
    objection.questionId !== question?.questionId ||
    objection.interruptedResponseId !== response?.responseId ||
    interruption.objectionId !== objection.objectionId ||
    interruption.interruptedResponseId !== response?.responseId ||
    response.status !== "pending" && response.status !== "streaming" ||
    response.interruptId !== interruption.interruptId ||
    question === undefined ||
    question.status !== "open" ||
    question.activeResponseId !== response.responseId ||
    input.state.activeQuestionId !== question.questionId ||
    questionTurn === undefined ||
    questionTurn.actor.actorId !== question.askedByActorId ||
    input.actor.role !== "judge" ||
    input.actor.side !== "neutral" ||
    lastEventId(input.state) !== interruption.sourceEventId
  ) {
    throw new Error("OBJECTION_RULING_GENERATION_STALE");
  }
  const knowledgeView = buildKnowledgeView(
    {
      caseGraph: input.graph,
      trial: input.state,
      currentExchangeTurnId: question.questionTurnId,
    },
    input.actor.actorId,
  );
  if (knowledgeView.actorRole !== "judge") {
    throw new Error("OBJECTION_RULING_INVALID");
  }
  const material = {
    trialId: input.state.trialId,
    stateVersion: input.state.version,
    lastEventId: interruption.sourceEventId,
    actorId: input.actor.actorId,
    objectionId: objection.objectionId,
    objectionEventId: objection.sourceEventId,
    interruptId: interruption.interruptId,
    responseId: response.responseId,
    questionId: question.questionId,
    questionEventId: questionTurn.sourceEventId,
  };
  const decisionId = stableRuntimeId("decision:objection-ruling", material);
  if (input.decisionId !== undefined && input.decisionId !== decisionId) {
    throw new Error("OBJECTION_RULING_GENERATION_STALE");
  }
  const callMaterial = { decisionId, material };
  const callId =
    input.callId ?? freshModelCallId("objection", callMaterial);
  if (!isFreshModelCallId(callId, "objection", callMaterial)) {
    throw new Error("OBJECTION_RULING_INVALID");
  }
  return ObjectionRulingRequestSchema.parse({
    schemaVersion: "objection-resolver.ruling.request.v1",
    callId,
    decisionId,
    trialId: input.state.trialId,
    expectedStateVersion: input.state.version,
    expectedLastEventId: interruption.sourceEventId,
    actorId: input.actor.actorId,
    objection: {
      objectionId: objection.objectionId,
      sourceEventId: objection.sourceEventId,
      questionId: objection.questionId,
      objectorActorId: objection.objectorActorId,
      ground: objection.ground,
      interruptedResponseId: objection.interruptedResponseId,
    },
    question: {
      questionId: question.questionId,
      turnId: question.questionTurnId,
      eventId: questionTurn.sourceEventId,
      speakerActorId: questionTurn.actor.actorId,
      text: questionTurn.text,
      factIds: questionTurn.citations.factIds,
      evidenceIds: questionTurn.citations.evidenceIds,
    },
    interruption: {
      interruptId: interruption.interruptId,
      interruptedResponseId: interruption.interruptedResponseId,
      sourceEventId: interruption.sourceEventId,
    },
    permittedOutcomes: [
      { ruling: "sustained", remedy: "cancel_response" },
      { ruling: "overruled", remedy: "resume_response" },
    ],
    knowledgeView,
  });
}

function canonicalNegotiationAgentRequest(
  input: Readonly<{
    graph: CaseGraphV1;
    state: TrialStateV3;
    actor: ActorRef;
    callId?: string;
    decisionId?: string;
  }>,
): NegotiationAgentRequest | null {
  const offerId = input.state.activeSettlementOfferId;
  if (offerId === null) return null;
  const targetOffer = input.state.settlementOffers[offerId];
  if (
    targetOffer === undefined ||
    targetOffer.status !== "open" ||
    isSettlementOfferExpired(
      targetOffer.expiresAtSequence,
      input.state.lastSequence + 1,
    )
  ) {
    return null;
  }
  const parties = settlementPartyIds(input.state, input.actor);
  if (
    targetOffer.proposedByPartyId !== parties.counterpartyPartyId ||
    targetOffer.recipientPartyIds.length !== 1 ||
    targetOffer.recipientPartyIds[0] !== parties.representedPartyId
  ) {
    return null;
  }
  const knowledgeView = buildKnowledgeView(
    { caseGraph: input.graph, trial: input.state },
    input.actor.actorId,
  );
  if (
    knowledgeView.actorRole !== "opposing_counsel" ||
    knowledgeView.counsel.privateSettlement === null
  ) {
    throw new Error("NEGOTIATION_GENERATION_INVALID");
  }
  const lastEvent = lastEventId(input.state);
  const material = {
    trialId: input.state.trialId,
    stateVersion: input.state.version,
    lastEventId: lastEvent,
    actorId: input.actor.actorId,
    representedPartyId: parties.representedPartyId,
    counterpartyPartyId: parties.counterpartyPartyId,
    targetOfferId: targetOffer.offerId,
    targetOfferLastEventId: targetOffer.lastEventId,
  };
  const decisionId = stableRuntimeId("decision:negotiation", material);
  if (input.decisionId !== undefined && input.decisionId !== decisionId) {
    throw new Error("NEGOTIATION_GENERATION_STALE");
  }
  const canCounter = canActorCounterSettlement(
    input.state.policySnapshot,
    input.actor.actorId,
    input.state.phase,
  );
  const proposedOfferId = canCounter
    ? stableRuntimeId("offer:negotiation-counter", {
        trialId: input.state.trialId,
        decisionId,
        targetOfferId: targetOffer.offerId,
      })
    : null;
  const callMaterial = { decisionId, material };
  const callId =
    input.callId ?? freshModelCallId("negotiation", callMaterial);
  if (!isFreshModelCallId(callId, "negotiation", callMaterial)) {
    throw new Error("NEGOTIATION_GENERATION_INVALID");
  }
  return NegotiationAgentRequestSchema.parse({
    schemaVersion: "negotiation-agent.request.v1",
    callId,
    decisionId,
    trialId: input.state.trialId,
    expectedStateVersion: input.state.version,
    expectedLastEventId: lastEvent,
    actorId: input.actor.actorId,
    representedPartyId: parties.representedPartyId,
    counterpartyPartyId: parties.counterpartyPartyId,
    offerBinding: {
      mode: "respond_to_offer",
      targetOfferId: targetOffer.offerId,
      proposedOfferId,
      counterParentOfferId: canCounter ? targetOffer.offerId : null,
      allowedRecommendations: [
        ...(canCounter ? (["counter"] as const) : []),
        "accept",
        "reject",
      ],
    },
    knowledgeView,
  });
}

function objectionRulingActionIds(trialId: string, decisionId: string) {
  const material = { trialId, decisionId };
  return {
    rulingActionId: stableRuntimeId("action:objection-ruling", material),
    resolveActionId: stableRuntimeId("action:resolve-objection", material),
    resumeActionId: stableRuntimeId(
      "action:resume-objection-response",
      material,
    ),
  };
}

function negotiationDecisionActionId(
  trialId: string,
  decisionId: string,
): string {
  return stableRuntimeId("action:negotiation-decision", {
    trialId,
    decisionId,
  });
}

function traceMatchesObjectionRulingRequest(
  envelope: HearingObjectionRulingPrecommit,
  request: ObjectionRulingRequest,
): boolean {
  const trace = envelope.trace;
  const view = request.knowledgeView;
  const sourceSegmentIds = [
    ...view.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...view.publicRecord.evidence.flatMap(
      (evidence) => evidence.sourceSegmentIds,
    ),
  ];
  const inputEventIds = stableUnique([
    request.question.eventId,
    request.objection.sourceEventId,
    request.expectedLastEventId,
  ]);
  return (
    envelope.decisionId === request.decisionId &&
    envelope.expectedStateVersion === request.expectedStateVersion &&
    envelope.expectedLastEventId === request.expectedLastEventId &&
    envelope.objectionEventId === request.objection.sourceEventId &&
    envelope.responseId === request.interruption?.interruptedResponseId &&
    envelope.questionEventBinding.turnId === request.question.turnId &&
    envelope.questionEventBinding.sourceEventId === request.question.eventId &&
    trace.trialId === request.trialId &&
    trace.callId === request.callId &&
    trace.responseId === request.interruption?.interruptedResponseId &&
    trace.actorId === request.actorId &&
    trace.actorRole === "judge" &&
    trace.expectedStateVersion === request.expectedStateVersion &&
    trace.expectedLastEventId === request.expectedLastEventId &&
    sameOrderedIds(trace.inputEventIds, inputEventIds) &&
    trace.knowledgeScope.knowledgeSchemaVersion === view.schemaVersion &&
    trace.knowledgeScope.knowledgeViewHash ===
      sha256Utf8(JSON.stringify(view)) &&
    trace.knowledgeScope.stateVersion === view.stateVersion &&
    trace.knowledgeScope.factCount === view.publicRecord.facts.length &&
    trace.knowledgeScope.evidenceCount === view.publicRecord.evidence.length &&
    trace.knowledgeScope.testimonyCount ===
      view.publicRecord.testimony.length &&
    trace.knowledgeScope.priorStatementCount === 0 &&
    trace.knowledgeScope.sourceSegmentCount ===
      new Set(sourceSegmentIds).size &&
    trace.knowledgeScope.publicRecordEventCount ===
      new Set(
        view.publicRecord.testimony.map(
          (testimony) => testimony.transcriptEventId,
        ),
      ).size &&
    trace.knowledgeScope.currentExchangeCount ===
      (view.currentExchange === null ? 0 : 1)
  );
}

function traceMatchesNegotiationRequest(
  envelope: HearingNegotiationPrecommit,
  request: NegotiationAgentRequest,
): boolean {
  const trace = envelope.trace;
  const view = request.knowledgeView;
  const sourceSegmentIds = [
    ...view.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...view.publicRecord.evidence.flatMap(
      (evidence) => evidence.sourceSegmentIds,
    ),
  ];
  const factCount = new Set([
    ...view.counsel.facts.map((fact) => fact.factId),
    ...view.publicRecord.facts.map((fact) => fact.factId),
    ...(view.currentExchange?.factIds ?? []),
  ]).size;
  const evidenceCount = new Set([
    ...view.counsel.evidence.map((evidence) => evidence.evidenceId),
    ...view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
    ...(view.currentExchange?.evidenceIds ?? []),
  ]).size;
  return (
    envelope.decisionId === request.decisionId &&
    envelope.expectedStateVersion === request.expectedStateVersion &&
    envelope.expectedLastEventId === request.expectedLastEventId &&
    trace.trialId === request.trialId &&
    trace.callId === request.callId &&
    trace.responseId === null &&
    trace.actorId === request.actorId &&
    trace.actorRole === "counsel" &&
    trace.expectedStateVersion === request.expectedStateVersion &&
    trace.expectedLastEventId === request.expectedLastEventId &&
    sameOrderedIds(trace.inputEventIds, [request.expectedLastEventId]) &&
    trace.knowledgeScope.knowledgeSchemaVersion === view.schemaVersion &&
    trace.knowledgeScope.knowledgeViewHash ===
      sha256Utf8(JSON.stringify(view)) &&
    trace.knowledgeScope.stateVersion === view.stateVersion &&
    trace.knowledgeScope.factCount === factCount &&
    trace.knowledgeScope.evidenceCount === evidenceCount &&
    trace.knowledgeScope.testimonyCount ===
      view.publicRecord.testimony.length &&
    trace.knowledgeScope.priorStatementCount === 0 &&
    trace.knowledgeScope.sourceSegmentCount ===
      new Set(sourceSegmentIds).size &&
    trace.knowledgeScope.publicRecordEventCount ===
      new Set(
        view.publicRecord.testimony.map(
          (testimony) => testimony.transcriptEventId,
        ),
      ).size &&
    trace.knowledgeScope.currentExchangeCount ===
      (view.currentExchange === null ? 0 : 1)
  );
}

function canonicalJuryResponseRequest(
  input: Readonly<{
    graph: CaseGraphV1;
    state: TrialStateV3;
    actor: ActorRef;
    callId?: string;
    decisionId?: string;
  }>,
): JuryResponseRequest {
  if (
    input.state.phase !== "deliberation" ||
    input.state.deliberated ||
    input.state.instructionIds.length === 0 ||
    input.state.closingSides.length !== 2 ||
    input.actor.role !== "jury" ||
    input.actor.side !== "neutral"
  ) {
    throw new Error("JURY_GENERATION_STALE");
  }
  const knowledgeView = buildKnowledgeView(
    { caseGraph: input.graph, trial: input.state },
    input.actor.actorId,
  );
  if (knowledgeView.actorRole !== "jury") {
    throw new Error("JURY_GENERATION_INVALID");
  }
  const instructionIds = knowledgeView.publicRecord.instructions.map(
    ({ instructionId }) => instructionId,
  );
  const material = {
    trialId: input.state.trialId,
    stateVersion: input.state.version,
    lastEventId: lastEventId(input.state),
    actorId: input.actor.actorId,
    instructionIds,
  };
  const decisionId = stableRuntimeId("decision:jury", material);
  if (input.decisionId !== undefined && input.decisionId !== decisionId) {
    throw new Error("JURY_GENERATION_STALE");
  }
  const callMaterial = { decisionId, material };
  const callId = input.callId ?? freshModelCallId("jury", callMaterial);
  if (!isFreshModelCallId(callId, "jury", callMaterial)) {
    throw new Error("JURY_GENERATION_INVALID");
  }
  return JuryResponseRequestSchema.parse({
    schemaVersion: "role-responder.jury.request.v1",
    callId,
    decisionId,
    trialId: input.state.trialId,
    expectedStateVersion: input.state.version,
    expectedLastEventId: material.lastEventId,
    actorId: input.actor.actorId,
    decisionManifest: {
      schemaVersion: "role-responder.jury.decision-manifest.v1",
      kind: "instructions",
      instructionIds,
    },
    knowledgeView,
  });
}

function juryScopeMatchesTrace(
  trace: CourtroomModelCallTrace,
  request: JuryResponseRequest,
): boolean {
  const record = request.knowledgeView.publicRecord;
  const sourceSegmentIds = [
    ...record.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...record.evidence.flatMap((evidence) => evidence.sourceSegmentIds),
  ];
  return (
    trace.knowledgeScope.knowledgeSchemaVersion ===
      request.knowledgeView.schemaVersion &&
    trace.knowledgeScope.knowledgeViewHash ===
      sha256Utf8(JSON.stringify(request.knowledgeView)) &&
    trace.knowledgeScope.stateVersion === request.knowledgeView.stateVersion &&
    trace.knowledgeScope.factCount === record.facts.length &&
    trace.knowledgeScope.evidenceCount === record.evidence.length &&
    trace.knowledgeScope.testimonyCount === record.testimony.length &&
    trace.knowledgeScope.priorStatementCount === 0 &&
    trace.knowledgeScope.sourceSegmentCount ===
      new Set(sourceSegmentIds).size &&
    trace.knowledgeScope.publicRecordEventCount ===
      new Set(record.testimony.map(({ transcriptEventId }) => transcriptEventId))
        .size &&
    trace.knowledgeScope.currentExchangeCount === 0
  );
}

function traceMatchesJuryResponseRequest(
  envelope: HearingJuryResponsePrecommit,
  request: JuryResponseRequest,
): boolean {
  const trace = envelope.trace;
  return (
    envelope.decisionId === request.decisionId &&
    envelope.expectedStateVersion === request.expectedStateVersion &&
    envelope.expectedLastEventId === request.expectedLastEventId &&
    trace.trialId === request.trialId &&
    trace.callId === request.callId &&
    trace.responseId === null &&
    trace.actorId === request.actorId &&
    trace.actorRole === "jury" &&
    trace.expectedStateVersion === request.expectedStateVersion &&
    trace.expectedLastEventId === request.expectedLastEventId &&
    sameOrderedIds(trace.inputEventIds, [request.expectedLastEventId]) &&
    juryScopeMatchesTrace(trace, request)
  );
}

function transcriptForDebrief(state: TrialStateV3) {
  return state.transcriptTurnIds.map((turnId) => {
    const turn = state.transcriptTurns[turnId];
    if (!turn) throw new Error("DEBRIEF_GENERATION_INVALID");
    return {
      turnId: turn.turnId,
      actorId: turn.actor.actorId,
      actorRole: turn.actor.role,
      text: turn.text,
      testimonyId: turn.testimonyId,
      status: turn.status,
      sourceEventId: turn.sourceEventId,
      citations: turn.citations,
    };
  });
}

async function canonicalDebriefGeneratorRequest(
  ctx: ActionCtx,
  ownerId: string,
  input: Readonly<{
    graph: CaseGraphV1;
    state: TrialStateV3;
    actor: ActorRef;
    callId?: string;
  }>,
): Promise<DebriefGeneratorRequest> {
  const settledWithoutVerdict =
    input.state.status === "settled" && input.state.verdictId === null;
  if (
    input.state.phase !== "debrief" ||
    (!settledWithoutVerdict && input.state.verdictId === null) ||
    input.state.debriefId !== null ||
    input.actor.role !== "debrief_coach" ||
    input.actor.side !== "neutral"
  ) {
    throw new Error("DEBRIEF_GENERATION_STALE");
  }
  const knowledgeView = buildKnowledgeView(
    { caseGraph: input.graph, trial: input.state },
    input.actor.actorId,
  );
  if (knowledgeView.actorRole !== "debrief") {
    throw new Error("DEBRIEF_GENERATION_INVALID");
  }
  const audit = await ctx.runQuery(loadFinalTrialAuditReference, {
    ownerId,
    trialId: input.state.trialId,
  });
  if (
    audit.trialId !== input.state.trialId ||
    audit.stateVersion !== input.state.version ||
    audit.lastEventId !== lastEventId(input.state) ||
    (settledWithoutVerdict
      ? audit.verdict !== null
      : audit.verdict === null ||
        audit.verdict.verdictId !== input.state.verdictId)
  ) {
    throw new Error("DEBRIEF_GENERATION_STALE");
  }
  const transcript = transcriptForDebrief(input.state);
  const transcriptTurnIds = new Set(transcript.map(({ turnId }) => turnId));
  if (audit.closingTurnIds.some((turnId) => !transcriptTurnIds.has(turnId))) {
    throw new Error("DEBRIEF_GENERATION_INVALID");
  }
  const material = {
    trialId: input.state.trialId,
    stateVersion: input.state.version,
    lastEventId: audit.lastEventId,
    actorId: input.actor.actorId,
  };
  const callId = input.callId ?? freshModelCallId("debrief", material);
  if (!isFreshModelCallId(callId, "debrief", material)) {
    throw new Error("DEBRIEF_GENERATION_INVALID");
  }
  return DebriefGeneratorRequestSchema.parse({
    schemaVersion: "debrief-generator.request.v1",
    callId,
    trialId: input.state.trialId,
    expectedStateVersion: input.state.version,
    expectedLastEventId: audit.lastEventId,
    actorId: input.actor.actorId,
    knowledgeView,
    transcript,
    procedure: {
      objections: Object.values(input.state.objections)
        .sort(
          (left, right) =>
            left.sourceEventId.localeCompare(right.sourceEventId) ||
            left.objectionId.localeCompare(right.objectionId),
        )
        .map((objection) => ({
          objectionId: objection.objectionId,
          questionId: objection.questionId,
          objectorActorId: objection.objectorActorId,
          ground: objection.ground,
          status: objection.status,
          remedy: objection.remedy,
          rulingReason: objection.rulingReason,
          sourceEventId: objection.sourceEventId,
          rulingEventId: objection.rulingEventId,
        })),
      settlementOffers: Object.values(input.state.settlementOffers)
        .sort(
          (left, right) =>
            left.sourceEventId.localeCompare(right.sourceEventId) ||
            left.offerId.localeCompare(right.offerId),
        )
        .map((offer) => ({
          offerId: offer.offerId,
          parentOfferId: offer.parentOfferId,
          proposedByPartyId: offer.proposedByPartyId,
          recipientPartyIds: offer.recipientPartyIds,
          amount: offer.terms.amount,
          currency: offer.terms.currency,
          nonMonetaryTerms: offer.terms.nonMonetaryTerms,
          summary: offer.terms.summary,
          status: offer.status,
          sourceEventId: offer.sourceEventId,
          lastEventId: offer.lastEventId,
        })),
      closingTurnIds: audit.closingTurnIds,
      restedSides: input.state.restedSides,
      deliberated: input.state.deliberated,
      verdict: audit.verdict,
    },
  });
}

function uniqueIdentifierCount(...lists: readonly string[][]): number {
  return new Set(lists.flat()).size;
}

function debriefProceduralEventIds(request: DebriefGeneratorRequest): string[] {
  return [
    ...request.transcript.map(({ sourceEventId }) => sourceEventId),
    ...request.procedure.objections.flatMap((objection) => [
      objection.sourceEventId,
      ...(objection.rulingEventId === null ? [] : [objection.rulingEventId]),
    ]),
    ...request.procedure.settlementOffers.flatMap((offer) => [
      offer.sourceEventId,
      offer.lastEventId,
    ]),
    ...(request.procedure.verdict === null
      ? []
      : [request.procedure.verdict.sourceEventId]),
  ];
}

function debriefScopeMatchesTrace(
  trace: CourtroomModelCallTrace,
  request: DebriefGeneratorRequest,
): boolean {
  const { strata } = request.knowledgeView;
  const admitted = strata.admittedRecord.record;
  const sourceSegmentIds = [
    ...admitted.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...admitted.evidence.flatMap((evidence) => evidence.sourceSegmentIds),
    ...strata.hiddenAuthoringTruth.facts.flatMap(
      (fact) => fact.sourceSegmentIds,
    ),
  ];
  return (
    trace.knowledgeScope.knowledgeSchemaVersion ===
      request.knowledgeView.schemaVersion &&
    trace.knowledgeScope.knowledgeViewHash ===
      sha256Utf8(JSON.stringify(request.knowledgeView)) &&
    trace.knowledgeScope.stateVersion === request.knowledgeView.stateVersion &&
    trace.knowledgeScope.factCount ===
      uniqueIdentifierCount(
        admitted.facts.map(({ factId }) => factId),
        strata.unadmittedRecord.facts.map(({ factId }) => factId),
        strata.excludedOrStricken.facts.map(({ factId }) => factId),
        strata.hiddenAuthoringTruth.facts.map(({ factId }) => factId),
      ) &&
    trace.knowledgeScope.evidenceCount ===
      uniqueIdentifierCount(
        admitted.evidence.map(({ evidenceId }) => evidenceId),
        strata.unadmittedRecord.evidence.map(({ evidenceId }) => evidenceId),
        strata.excludedOrStricken.evidence.map(
          ({ evidenceId }) => evidenceId,
        ),
      ) &&
    trace.knowledgeScope.testimonyCount ===
      uniqueIdentifierCount(
        admitted.testimony.map(({ testimonyId }) => testimonyId),
        strata.excludedOrStricken.testimony.map(
          ({ testimonyId }) => testimonyId,
        ),
      ) &&
    trace.knowledgeScope.priorStatementCount === 0 &&
    trace.knowledgeScope.sourceSegmentCount ===
      new Set(sourceSegmentIds).size &&
    trace.knowledgeScope.publicRecordEventCount ===
      new Set(debriefProceduralEventIds(request)).size &&
    trace.knowledgeScope.currentExchangeCount === 0
  );
}

function traceMatchesDebriefGeneratorRequest(
  envelope: HearingDebriefGeneratorPrecommit,
  request: DebriefGeneratorRequest,
): boolean {
  const sourceEventByTurnId = new Map(
    request.transcript.map(({ turnId, sourceEventId }) => [turnId, sourceEventId]),
  );
  return (
    envelope.expectedStateVersion === request.expectedStateVersion &&
    envelope.expectedLastEventId === request.expectedLastEventId &&
    envelope.transcriptEventBindings.every(
      ({ turnId, sourceEventId }) =>
        sourceEventByTurnId.get(turnId) === sourceEventId,
    ) &&
    envelope.trace.trialId === request.trialId &&
    envelope.trace.callId === request.callId &&
    envelope.trace.responseId === null &&
    envelope.trace.actorId === request.actorId &&
    envelope.trace.actorRole === "debrief" &&
    envelope.trace.expectedStateVersion === request.expectedStateVersion &&
    envelope.trace.expectedLastEventId === request.expectedLastEventId &&
    sameOrderedIds(envelope.trace.inputEventIds, [request.expectedLastEventId]) &&
    debriefScopeMatchesTrace(envelope.trace, request)
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

async function advanceToDeliberation(
  ctx: ActionCtx,
  ownerId: string,
  initialHead: Awaited<ReturnType<typeof loadHead>>,
): Promise<Awaited<ReturnType<typeof loadHead>>> {
  let head = initialHead;
  while (true) {
    const judge = actorByRole(head.state, "judge", "neutral");
    const causationId = lastEventId(head.state);
    let action: TrialActionV3 | null = null;
    if (
      head.state.phase === "closing" &&
      head.state.closingSides.includes("user") &&
      head.state.closingSides.includes("opposing")
    ) {
      action = actionFromIntent({
        actionId: stableRuntimeId("action:phase-jury-instructions", {
          trialId: head.state.trialId,
        }),
        trialId: head.state.trialId,
        expectedStateVersion: head.state.version,
        actor: judge,
        source: "deterministic",
        requestedAt: requestedAtWithOffset(head.state.updatedAt, 1),
        causationId,
        type: "BEGIN_PHASE",
        payload: { phase: "jury_instructions" },
      });
    } else if (
      head.state.phase === "jury_instructions" &&
      head.state.instructionIds.length === 0
    ) {
      if (head.state.juryInstructionIds.length === 0) {
        throw new Error("JURY_INSTRUCTIONS_REQUIRED");
      }
      action = actionFromIntent({
        actionId: stableRuntimeId("action:instruct-jury", {
          trialId: head.state.trialId,
        }),
        trialId: head.state.trialId,
        expectedStateVersion: head.state.version,
        actor: judge,
        source: "deterministic",
        requestedAt: requestedAtWithOffset(head.state.updatedAt, 1),
        causationId,
        type: "INSTRUCT_JURY",
        payload: { instructionIds: head.state.juryInstructionIds },
      });
    } else if (
      head.state.phase === "jury_instructions" &&
      head.state.instructionIds.length > 0
    ) {
      action = actionFromIntent({
        actionId: stableRuntimeId("action:phase-deliberation", {
          trialId: head.state.trialId,
        }),
        trialId: head.state.trialId,
        expectedStateVersion: head.state.version,
        actor: judge,
        source: "deterministic",
        requestedAt: requestedAtWithOffset(head.state.updatedAt, 1),
        causationId,
        type: "BEGIN_PHASE",
        payload: { phase: "deliberation" },
      });
    }
    if (action === null) return head;
    await appendRuntimeAction(ctx, ownerId, action, false, true);
    head = await loadHead(ctx, ownerId, head.state.trialId);
  }
}

async function canonicalContinuation(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
): Promise<HearingCommandPreparation> {
  let head = await loadHead(ctx, ownerId, trialId);
  if (
    head.state.activeInterruption?.status === "active" &&
    head.state.activeInterruption.objectionId !== null
  ) {
    const actor = actorByRole(head.state, "judge", "neutral");
    const request = canonicalObjectionRulingRequest({
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
    const questioningActor = activeQuestion
      ? head.state.actors[activeQuestion.askedByActorId]
      : undefined;
    const hasPendingObjection = activeQuestion
      ? Object.values(head.state.objections).some(
          (objection) =>
            objection.questionId === activeQuestion.questionId &&
            objection.status === "pending",
        )
      : false;
    if (
      questioningActor?.side !== head.state.userSide &&
      activeResponse.interruptId === null &&
      !hasPendingObjection
    ) {
      return HearingCommandPreparationSchema.parse({
        schemaVersion: "hearing-command-preparation.v1",
        status: "completed",
        view: head.view,
      });
    }
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

  const negotiationRequest = canonicalNegotiationAgentRequest({
    graph: head.graph,
    state: head.state,
    actor: opposingCounselForAiRuntime(head.state),
  });
  if (negotiationRequest !== null) {
    return HearingCommandPreparationSchema.parse({
      schemaVersion: "hearing-command-preparation.v1",
      status: "model_required",
      request: negotiationRequest,
    });
  }

  if (head.state.activeAppearanceId !== null) {
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
  }

  if (
    (head.state.phase === "closing" &&
      head.state.closingSides.includes("user") &&
      head.state.closingSides.includes("opposing")) ||
    head.state.phase === "jury_instructions"
  ) {
    head = await advanceToDeliberation(ctx, ownerId, head);
  }

  if (head.state.phase === "deliberation" && !head.state.deliberated) {
    const actor = actorByRole(head.state, "jury", "neutral");
    const request = canonicalJuryResponseRequest({
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

  if (head.state.phase === "debrief" && head.state.debriefId === null) {
    const actor = actorByRole(head.state, "debrief_coach", "neutral");
    const request = await canonicalDebriefGeneratorRequest(
      ctx,
      ownerId,
      {
        graph: head.graph,
        state: head.state,
        actor,
      },
    );
    return HearingCommandPreparationSchema.parse({
      schemaVersion: "hearing-command-preparation.v1",
      status: "model_required",
      request,
    });
  }

  const needsOpponentClosing =
    head.state.phase === "closing" &&
    head.state.activeAppearanceId === null &&
    head.state.activeWitnessId === null &&
    !head.state.closingSides.includes("opposing");
  if (head.state.activeAppearanceId === null && !needsOpponentClosing) {
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
  if (command.intent.type !== "finish_witness")
    throw new Error("INVALID_INTENT");
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

async function objectToPendingResponse(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  state: TrialStateV3,
): Promise<void> {
  if (command.intent.type !== "object") throw new Error("INVALID_INTENT");
  const objectionActionId = runtimeActionId(
    trialId,
    command.requestId,
    "object",
  );
  const existing = await ctx.runQuery(eventExistsReference, {
    ownerId,
    trialId,
    actionId: objectionActionId,
  });
  if (!existing) {
    const question = state.questions[command.intent.questionId];
    const response = state.pendingResponses[command.intent.responseId];
    const questioningActor = question
      ? state.actors[question.askedByActorId]
      : undefined;
    if (
      !question ||
      state.activeQuestionId !== question.questionId ||
      question.status !== "open" ||
      question.activeResponseId !== command.intent.responseId ||
      !response ||
      response.questionId !== question.questionId ||
      (response.status !== "pending" && response.status !== "streaming") ||
      response.interruptId !== null ||
      !questioningActor ||
      questioningActor.side === state.userSide ||
      state.activeInterruption !== null ||
      Object.values(state.objections).some(
        (objection) =>
          objection.questionId === question.questionId &&
          objection.status === "pending",
      )
    ) {
      throw new Error("OBJECTION_WINDOW_CLOSED");
    }
  }
  const objectionId = `objection:${command.requestId}`;
  const interruptId = `interrupt:${command.requestId}`;
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: objectionActionId,
      trialId,
      expectedStateVersion: command.expectedStateVersion,
      actor: playerCounsel(state),
      source: "user",
      requestedAt: command.requestedAt,
      causationId: command.expectedLastEventId,
      type: "OBJECT",
      payload: {
        objectionId,
        questionId: command.intent.questionId,
        ground: command.intent.ground,
        interruptedResponseId: command.intent.responseId,
      },
    }),
    true,
  );
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: runtimeActionId(
        trialId,
        command.requestId,
        "begin-interruption",
      ),
      trialId,
      expectedStateVersion: command.expectedStateVersion + 1,
      actor: actorByRole(state, "system", "neutral"),
      source: "system",
      requestedAt: requestedAtWithOffset(command.requestedAt, 1),
      causationId: eventIdForAction(objectionActionId),
      type: "BEGIN_INTERRUPTION",
      payload: {
        interruptId,
        interruptedResponseId: command.intent.responseId,
        objectionId,
      },
    }),
    false,
    true,
  );
}

function continuePendingResponse(
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  head: { graph: CaseGraphV1; state: TrialStateV3 },
): HearingCommandPreparation {
  if (command.intent.type !== "continue_response") {
    throw new Error("INVALID_INTENT");
  }
  if (
    command.expectedStateVersion !== head.state.version ||
    command.expectedLastEventId !== lastEventId(head.state)
  ) {
    throw new Error("STALE_STATE_VERSION");
  }
  const response = head.state.pendingResponses[command.intent.responseId];
  const question = response?.questionId
    ? head.state.questions[response.questionId]
    : undefined;
  const questioningActor = question
    ? head.state.actors[question.askedByActorId]
    : undefined;
  if (
    !response ||
    !question ||
    head.state.activeQuestionId !== question.questionId ||
    question.activeResponseId !== response.responseId ||
    (response.status !== "pending" && response.status !== "streaming") ||
    response.interruptId !== null ||
    !questioningActor ||
    questioningActor.side === head.state.userSide ||
    Object.values(head.state.objections).some(
      (objection) =>
        objection.questionId === question.questionId &&
        objection.status === "pending",
    )
  ) {
    throw new Error("RESPONSE_WINDOW_CLOSED");
  }
  return HearingCommandPreparationSchema.parse({
    schemaVersion: "hearing-command-preparation.v1",
    status: "model_required",
    request: canonicalWitnessAnswerRequest({
      trialId: head.state.trialId,
      responseId: response.responseId,
      callId: createWitnessModelCallId(
        head.state.trialId,
        response.responseId,
      ),
      graph: head.graph,
      state: head.state,
    }),
  });
}

function settlementPartyIds(
  state: TrialStateV3,
  actor: ActorRef,
): Readonly<{ representedPartyId: string; counterpartyPartyId: string }> {
  const participants = new Set(
    state.policySnapshot.settlement.participantPartyIds,
  );
  const actorBinding = state.policySnapshot.mappings.actors.find(
    (binding) => binding.actorId === actor.actorId,
  );
  const represented = (actorBinding?.representedPartyIds ?? []).filter(
    (partyId) => participants.has(partyId),
  );
  const counterparties = [...participants].filter(
    (partyId) => partyId !== represented[0],
  );
  if (represented.length !== 1 || counterparties.length !== 1) {
    throw new Error("SETTLEMENT_PARTIES_AMBIGUOUS");
  }
  return {
    representedPartyId: represented[0],
    counterpartyPartyId: counterparties[0],
  };
}

async function commitPlayerSettlementIntent(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  graph: CaseGraphV1,
  state: TrialStateV3,
): Promise<void> {
  if (
    command.intent.type !== "propose_settlement" &&
    command.intent.type !== "counter_settlement" &&
    command.intent.type !== "accept_settlement" &&
    command.intent.type !== "reject_settlement" &&
    command.intent.type !== "withdraw_settlement"
  ) {
    throw new Error("INVALID_INTENT");
  }
  if (
    command.intent.type === "propose_settlement" ||
    command.intent.type === "counter_settlement" ||
    command.intent.type === "accept_settlement"
  ) {
    const juryRecord = buildJuryRecord({ caseGraph: graph, trial: state });
    if (
      juryRecord.facts.length === 0 &&
      juryRecord.evidence.length === 0 &&
      juryRecord.testimony.length === 0
    ) {
      throw new Error("SETTLEMENT_DEBRIEF_RECORD_REQUIRED");
    }
  }
  const actionId = runtimeActionId(
    trialId,
    command.requestId,
    command.intent.type,
  );
  if (
    await ctx.runQuery(eventExistsReference, {
      ownerId,
      trialId,
      actionId,
    })
  ) {
    return;
  }
  const actor = playerCounsel(state);
  const parties = settlementPartyIds(state, actor);
  let type: TrialActionV3["type"];
  let payload: unknown;
  if (
    command.intent.type === "propose_settlement" ||
    command.intent.type === "counter_settlement"
  ) {
    const parentOffer =
      command.intent.type === "counter_settlement"
        ? state.settlementOffers[command.intent.offerId]
        : undefined;
    if (command.intent.type === "counter_settlement" && !parentOffer) {
      throw new Error("UNKNOWN_SETTLEMENT_OFFER");
    }
    type =
      command.intent.type === "propose_settlement"
        ? "PROPOSE_SETTLEMENT"
        : "COUNTER_SETTLEMENT";
    payload = {
      offerId: `offer:${command.requestId}`,
      parentOfferId: parentOffer?.offerId ?? null,
      proposedByPartyId: parties.representedPartyId,
      recipientPartyIds: [
        parentOffer?.proposedByPartyId ?? parties.counterpartyPartyId,
      ],
      terms: {
        amount: command.intent.terms.amount,
        currency:
          command.intent.terms.amount === null
            ? null
            : state.policySnapshot.settlement.currency,
        nonMonetaryTerms: command.intent.terms.nonMonetaryTerms,
        summary: command.intent.terms.summary,
      },
      expiresAtSequence: settlementExpirySequence(
        state.policySnapshot,
        state.lastSequence + 1,
      ),
    };
  } else {
    type =
      command.intent.type === "accept_settlement"
        ? "ACCEPT_SETTLEMENT"
        : command.intent.type === "reject_settlement"
          ? "REJECT_SETTLEMENT"
          : "WITHDRAW_SETTLEMENT";
    payload = { offerId: command.intent.offerId };
  }
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId,
      trialId,
      expectedStateVersion: command.expectedStateVersion,
      actor,
      source: "user",
      requestedAt: command.requestedAt,
      causationId: command.expectedLastEventId,
      type,
      payload,
    }),
    true,
    true,
  );
}

async function finishTrial(
  ctx: ActionCtx,
  ownerId: string,
  trialId: string,
  command: ReturnType<typeof HearingPlayerCommandSchema.parse>,
  graph: CaseGraphV1,
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
  const juryView = buildKnowledgeView(
    { caseGraph: graph, trial: state },
    jury.actorId,
  );
  if (
    juryView.actorRole !== "jury" ||
    juryView.publicRecord.facts.length +
      juryView.publicRecord.evidence.length +
      juryView.publicRecord.testimony.length ===
      0
  ) {
    throw new Error("JURY_CONSIDERABLE_RECORD_REQUIRED");
  }
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
        citations: {
          factIds: [],
          evidenceIds: [],
          testimonyIds: [],
          eventIds: [],
          sourceSegmentIds: [],
        },
      },
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
      await finishWitness(ctx, ownerId, args.trialId, commandInput, head.state);
      break;
    case "finish_trial":
      await finishTrial(
        ctx,
        ownerId,
        args.trialId,
        commandInput,
        head.graph,
        head.state,
      );
      break;
    case "object":
      await objectToPendingResponse(
        ctx,
        ownerId,
        args.trialId,
        commandInput,
        head.state,
      );
      break;
    case "continue_response":
      return continuePendingResponse(commandInput, head);
    case "propose_settlement":
    case "counter_settlement":
    case "accept_settlement":
    case "reject_settlement":
    case "withdraw_settlement":
      await commitPlayerSettlementIntent(
        ctx,
        ownerId,
        args.trialId,
        commandInput,
        head.graph,
        head.state,
      );
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
    const parsed =
      HearingOpponentPlanPrecommitSchema.safeParse(generationInput);
    if (!parsed.success || parsed.data.trialId !== args.trialId) {
      return invalidOpponentPlanGeneration();
    }
    const envelope = parsed.data;
    const actionId = opponentPlanActionId(args.trialId, envelope.decisionId);
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
        appearance:
          request.procedure.activeAppearanceId === null ||
          request.procedure.activeWitnessId === null ||
          request.procedure.activeExaminationKind === null
            ? null
            : {
                appearanceId: request.procedure.activeAppearanceId,
                witnessId: request.procedure.activeWitnessId,
                examinationKind: request.procedure.activeExaminationKind,
                answeredQuestionCount:
                  request.procedure.answeredQuestionCount,
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
        pendingDirectiveJson:
          serializePersistedOpponentDirective(persistedDirective),
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

function counselContinuationForAction(
  input: Readonly<{
    state: TrialStateV3;
    decisionId: string;
    action: TrialActionV3;
  }>,
): TrialActionV3 | null {
  if (input.action.type === "GIVE_CLOSING") return null;
  const appearance = activeAppearance(input.state);
  if (input.action.type === "ASK_QUESTION") {
    const witnessActor = Object.values(input.state.actors).find(
      (actor) =>
        actor.role === "witness" && actor.witnessId === appearance.witnessId,
    );
    if (!witnessActor) return invalidCounselGeneration();
    const responseId = stableRuntimeId("response:counsel", {
      trialId: input.state.trialId,
      decisionId: input.decisionId,
    });
    return actionFromIntent({
      actionId: stableRuntimeId("action:request-counsel-response", {
        trialId: input.state.trialId,
        decisionId: input.decisionId,
      }),
      trialId: input.state.trialId,
      expectedStateVersion: input.action.expectedStateVersion + 1,
      actor: actorByRole(input.state, "system", "neutral"),
      source: "system",
      requestedAt: requestedAtWithOffset(input.action.requestedAt, 1),
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
    input.action.payload.examinationKind === "recross";
  if (!shouldRelease) return null;
  const releaseCounsel = actorByRole(
    input.state,
    counselRoleForSide(appearance.callingSide),
    appearance.callingSide,
  );
  return actionFromIntent({
    actionId: stableRuntimeId("action:release-after-counsel", {
      trialId: input.state.trialId,
      decisionId: input.decisionId,
    }),
    trialId: input.state.trialId,
    expectedStateVersion: input.action.expectedStateVersion + 1,
    actor: releaseCounsel,
    source: "deterministic",
    requestedAt: requestedAtWithOffset(input.action.requestedAt, 1),
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
    const parsed =
      HearingCounselResponsePrecommitSchema.safeParse(generationInput);
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
      const existingAction = TrialActionV3Schema.safeParse(
        parseJson(existing.actionJson, "stored_counsel_action"),
      );
      if (
        !existingAction.success ||
        (existingAction.data.type !== "ASK_QUESTION" &&
          existingAction.data.type !== "END_EXAMINATION" &&
          existingAction.data.type !== "GIVE_CLOSING")
      ) {
        return invalidCounselGeneration();
      }
      let continuationActionJson = existing.continuationActionJson;
      if (continuationActionJson === null) {
        const currentHead = await loadHead(ctx, ownerId, args.trialId);
        const recoveredContinuation = counselContinuationForAction({
          state: currentHead.state,
          decisionId: envelope.decisionId,
          action: existingAction.data,
        });
        continuationActionJson =
          recoveredContinuation === null
            ? null
            : JSON.stringify(recoveredContinuation);
      }
      await appendCounselGeneration(
        ctx,
        ownerId,
        existing.actionJson,
        continuationActionJson,
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
      if (request.appearance === null) return invalidCounselGeneration();
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
      if (request.appearance === null) return invalidCounselGeneration();
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
    } else if (response.action.kind === "give_closing") {
      if (request.appearance !== null) return invalidCounselGeneration();
      action = actionFromIntent({
        actionId,
        trialId: args.trialId,
        expectedStateVersion: request.expectedStateVersion,
        actor,
        source: "ai",
        requestedAt: envelope.trace.completedAt,
        causationId: request.expectedLastEventId,
        modelMetadata: envelope.modelMetadata,
        type: "GIVE_CLOSING",
        payload: {
          side: "opposing",
          turnId: stableRuntimeId("turn:counsel-closing", {
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
      decisionId: request.decisionId,
      action,
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
    const generation =
      HearingWitnessGenerationPrecommitSchema.safeParse(generationInput);
    if (!generation.success || generation.data.trialId !== args.trialId) {
      return invalidWitnessGeneration();
    }
    const envelope = generation.data;
    const actionId = witnessAnswerActionId(args.trialId, envelope.responseId);
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

function invalidObjectionRulingGeneration(): never {
  throw new Error("OBJECTION_RULING_GENERATION_INVALID");
}

async function appendObjectionRulingGeneration(
  ctx: ActionCtx,
  ownerId: string,
  actionJsons: string[],
  generation: HearingObjectionRulingPrecommit,
): Promise<void> {
  try {
    await ctx.runMutation(appendObjectionRulingForOwnerReference, {
      ownerId,
      actionJsons,
      generationJson: JSON.stringify(generation),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("STALE")) {
      throw new Error("OBJECTION_RULING_GENERATION_STALE");
    }
    if (
      message.includes("CONFLICT") ||
      message.includes("GENERATION") ||
      message.includes("MODEL_CALL") ||
      message.includes("OBJECTION") ||
      message.includes("INTERRUPTION")
    ) {
      return invalidObjectionRulingGeneration();
    }
    throw error;
  }
}

/** Commit one Luna judge ruling and its interruption resolution atomically. */
export const commitObjectionRulingGeneration = internalAction({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    generationJson: v.string(),
  },
  handler: async (ctx, args): Promise<HearingCommandPreparation> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    let generationInput: unknown;
    try {
      generationInput = parseJson(args.generationJson, "objection_precommit");
    } catch {
      return invalidObjectionRulingGeneration();
    }
    const parsed =
      HearingObjectionRulingPrecommitSchema.safeParse(generationInput);
    if (!parsed.success || parsed.data.trialId !== args.trialId) {
      return invalidObjectionRulingGeneration();
    }
    const envelope = parsed.data;
    const ids = objectionRulingActionIds(
      args.trialId,
      envelope.decisionId,
    );
    const existing = await ctx.runQuery(
      loadGeneratedObjectionBundleReference,
      {
        ownerId,
        trialId: args.trialId,
        actionId: ids.rulingActionId,
      },
    );
    if (existing !== null) {
      await appendObjectionRulingGeneration(
        ctx,
        ownerId,
        existing.actionJsons,
        envelope,
      );
      return await canonicalContinuation(ctx, ownerId, args.trialId);
    }

    const head = await loadHead(ctx, ownerId, args.trialId);
    const judge = actorByRole(head.state, "judge", "neutral");
    const request = canonicalObjectionRulingRequest({
      graph: head.graph,
      state: head.state,
      actor: judge,
      callId: envelope.callId,
      decisionId: envelope.decisionId,
    });
    if (
      envelope.trace.completedAt === null ||
      !traceMatchesObjectionRulingRequest(envelope, request)
    ) {
      return invalidObjectionRulingGeneration();
    }
    const validation = validateObjectionRulingOutput(
      request,
      envelope.output,
    );
    if (!validation.accepted || request.interruption === null) {
      return invalidObjectionRulingGeneration();
    }
    const completedAt = envelope.trace.completedAt;
    const responseId = request.interruption.interruptedResponseId;
    const interruptId = request.interruption.interruptId;
    const ruling = actionFromIntent({
      actionId: ids.rulingActionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion,
      actor: judge,
      source: "ai",
      requestedAt: requestedAtWithOffset(completedAt, 0),
      causationId: request.expectedLastEventId,
      responseId,
      interruptId,
      modelMetadata: envelope.modelMetadata,
      type: "RULE_ON_OBJECTION",
      payload: {
        objectionId: request.objection.objectionId,
        ruling: validation.ruling.ruling,
        remedy: validation.ruling.remedy,
        reason: validation.ruling.reason,
      },
    });
    const system = actorByRole(head.state, "system", "neutral");
    const resolve = actionFromIntent({
      actionId: ids.resolveActionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion + 1,
      actor: system,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(completedAt, 1),
      causationId: eventIdForAction(ruling.actionId),
      responseId,
      interruptId,
      type: "RESOLVE_INTERRUPTION",
      payload: {
        interruptId,
        outcome:
          validation.ruling.ruling === "overruled" ? "resume" : "cancel",
      },
    });
    const actions = [ruling, resolve];
    if (validation.ruling.ruling === "overruled") {
      actions.push(
        actionFromIntent({
          actionId: ids.resumeActionId,
          trialId: args.trialId,
          expectedStateVersion: request.expectedStateVersion + 2,
          actor: system,
          source: "deterministic",
          requestedAt: requestedAtWithOffset(completedAt, 2),
          causationId: eventIdForAction(resolve.actionId),
          responseId,
          interruptId,
          type: "RESUME_INTERRUPTED_SPEECH",
          payload: { interruptId, interruptedResponseId: responseId },
        }),
      );
    }
    await appendObjectionRulingGeneration(
      ctx,
      ownerId,
      actions.map((action) => JSON.stringify(action)),
      envelope,
    );
    return await canonicalContinuation(ctx, ownerId, args.trialId);
  },
});

function invalidNegotiationGeneration(): never {
  throw new Error("NEGOTIATION_GENERATION_INVALID");
}

async function appendNegotiationGeneration(
  ctx: ActionCtx,
  ownerId: string,
  actionJson: string,
  generation: HearingNegotiationPrecommit,
): Promise<void> {
  try {
    await ctx.runMutation(appendNegotiationDecisionForOwnerReference, {
      ownerId,
      actionJson,
      generationJson: JSON.stringify(generation),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("STALE")) {
      throw new Error("NEGOTIATION_GENERATION_STALE");
    }
    if (
      message.includes("CONFLICT") ||
      message.includes("GENERATION") ||
      message.includes("MODEL_CALL") ||
      message.includes("SETTLEMENT")
    ) {
      return invalidNegotiationGeneration();
    }
    throw error;
  }
}

/** Commit one private Luna settlement decision and resume canonically. */
export const commitNegotiationGeneration = internalAction({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    generationJson: v.string(),
  },
  handler: async (ctx, args): Promise<HearingCommandPreparation> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    let generationInput: unknown;
    try {
      generationInput = parseJson(args.generationJson, "negotiation_precommit");
    } catch {
      return invalidNegotiationGeneration();
    }
    const parsed = HearingNegotiationPrecommitSchema.safeParse(generationInput);
    if (!parsed.success || parsed.data.trialId !== args.trialId) {
      return invalidNegotiationGeneration();
    }
    const envelope = parsed.data;
    const actionId = negotiationDecisionActionId(
      args.trialId,
      envelope.decisionId,
    );
    const existing = await ctx.runQuery(
      loadGeneratedNegotiationActionReference,
      { ownerId, trialId: args.trialId, actionId },
    );
    if (existing !== null) {
      await appendNegotiationGeneration(
        ctx,
        ownerId,
        existing.actionJson,
        envelope,
      );
      return await canonicalContinuation(ctx, ownerId, args.trialId);
    }

    const head = await loadHead(ctx, ownerId, args.trialId);
    const actor = opposingCounselForAiRuntime(head.state);
    const request = canonicalNegotiationAgentRequest({
      graph: head.graph,
      state: head.state,
      actor,
      callId: envelope.callId,
      decisionId: envelope.decisionId,
    });
    if (
      request === null ||
      envelope.trace.completedAt === null ||
      !traceMatchesNegotiationRequest(envelope, request)
    ) {
      return invalidNegotiationGeneration();
    }
    const validation = validateNegotiationAgentOutput(
      request,
      envelope.output,
    );
    if (!validation.accepted) return invalidNegotiationGeneration();
    const decision = validation.decision;
    let type: TrialActionV3["type"];
    let payload: unknown;
    if (decision.recommendation === "counter") {
      if (
        decision.terms === null ||
        decision.offerId === null ||
        decision.parentOfferId === null
      ) {
        return invalidNegotiationGeneration();
      }
      type = "COUNTER_SETTLEMENT";
      payload = {
        offerId: decision.offerId,
        parentOfferId: decision.parentOfferId,
        proposedByPartyId: request.representedPartyId,
        recipientPartyIds: [request.counterpartyPartyId],
        terms: decision.terms,
        expiresAtSequence: settlementExpirySequence(
          head.state.policySnapshot,
          head.state.lastSequence + 1,
        ),
      };
    } else if (decision.recommendation === "accept") {
      if (decision.targetOfferId === null) {
        return invalidNegotiationGeneration();
      }
      type = "ACCEPT_SETTLEMENT";
      payload = { offerId: decision.targetOfferId };
    } else if (decision.recommendation === "reject") {
      if (decision.targetOfferId === null) {
        return invalidNegotiationGeneration();
      }
      type = "REJECT_SETTLEMENT";
      payload = { offerId: decision.targetOfferId };
    } else {
      return invalidNegotiationGeneration();
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
      type,
      payload,
    });
    await appendNegotiationGeneration(
      ctx,
      ownerId,
      JSON.stringify(action),
      envelope,
    );
    return await canonicalContinuation(ctx, ownerId, args.trialId);
  },
});

function invalidJuryGeneration(): never {
  throw new Error("JURY_GENERATION_INVALID");
}

async function appendJuryGeneration(
  ctx: ActionCtx,
  ownerId: string,
  actionJsons: string[],
  generation: HearingJuryResponsePrecommit,
): Promise<void> {
  try {
    await ctx.runMutation(appendJuryGenerationForOwnerReference, {
      ownerId,
      actionJsons,
      generationJson: JSON.stringify(generation),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("STALE")) {
      throw new Error("JURY_GENERATION_STALE");
    }
    if (
      message.includes("CONFLICT") ||
      message.includes("GENERATION") ||
      message.includes("MODEL_CALL") ||
      message.includes("ARTIFACT")
    ) {
      return invalidJuryGeneration();
    }
    throw error;
  }
}

/** Commit one Luna jury artifact and its deterministic verdict atomically. */
export const commitJuryGeneration = internalAction({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    generationJson: v.string(),
  },
  handler: async (ctx, args): Promise<HearingCommandPreparation> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    let generationInput: unknown;
    try {
      generationInput = parseJson(args.generationJson, "jury_precommit");
    } catch {
      return invalidJuryGeneration();
    }
    const parsed = HearingJuryResponsePrecommitSchema.safeParse(generationInput);
    if (!parsed.success || parsed.data.trialId !== args.trialId) {
      return invalidJuryGeneration();
    }
    const envelope = parsed.data;
    const ids = juryGenerationIds(args.trialId, envelope.decisionId);
    const existing = await ctx.runQuery(loadGeneratedFinalBundleReference, {
      ownerId,
      trialId: args.trialId,
      actionId: ids.actionId,
      kind: "jury_deliberation",
    });
    if (existing !== null) {
      await appendJuryGeneration(
        ctx,
        ownerId,
        existing.actionJsons,
        envelope,
      );
      return await canonicalContinuation(ctx, ownerId, args.trialId);
    }

    const head = await loadHead(ctx, ownerId, args.trialId);
    const jury = actorByRole(head.state, "jury", "neutral");
    const request = canonicalJuryResponseRequest({
      graph: head.graph,
      state: head.state,
      actor: jury,
      callId: envelope.callId,
      decisionId: envelope.decisionId,
    });
    if (
      envelope.trace.completedAt === null ||
      !traceMatchesJuryResponseRequest(envelope, request)
    ) {
      return invalidJuryGeneration();
    }
    const validation = validateJuryResponseOutput(request, envelope.output);
    if (!validation.accepted) return invalidJuryGeneration();
    const judge = actorByRole(head.state, "judge", "neutral");
    const completedAt = envelope.trace.completedAt;
    const deliberation = actionFromIntent({
      actionId: ids.actionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion,
      actor: jury,
      source: "ai",
      requestedAt: requestedAtWithOffset(completedAt, 0),
      causationId: request.expectedLastEventId,
      modelMetadata: envelope.modelMetadata,
      type: "DELIBERATE",
      payload: {},
    });
    const verdictPhase = actionFromIntent({
      actionId: ids.verdictPhaseActionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion + 1,
      actor: judge,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(completedAt, 1),
      causationId: eventIdForAction(deliberation.actionId),
      type: "BEGIN_PHASE",
      payload: { phase: "verdict" },
    });
    const recommendation = validation.response.recommendation;
    const verdict = actionFromIntent({
      actionId: ids.verdictActionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion + 2,
      actor: judge,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(completedAt, 2),
      causationId: eventIdForAction(verdictPhase.actionId),
      type: "RENDER_VERDICT",
      payload: {
        verdictId: ids.verdictId,
        decision: recommendation.decision,
        citations: {
          factIds: recommendation.citations.factIds,
          evidenceIds: recommendation.citations.evidenceIds,
          testimonyIds: recommendation.citations.testimonyIds,
          eventIds: [],
          sourceSegmentIds: [],
        },
      },
    });
    const debriefPhase = actionFromIntent({
      actionId: ids.debriefPhaseActionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion + 3,
      actor: judge,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(completedAt, 3),
      causationId: eventIdForAction(verdict.actionId),
      type: "BEGIN_PHASE",
      payload: { phase: "debrief" },
    });
    await appendJuryGeneration(
      ctx,
      ownerId,
      [deliberation, verdictPhase, verdict, debriefPhase].map((action) =>
        JSON.stringify(action),
      ),
      envelope,
    );
    return await canonicalContinuation(ctx, ownerId, args.trialId);
  },
});

function invalidDebriefGeneration(): never {
  throw new Error("DEBRIEF_GENERATION_INVALID");
}

async function appendDebriefGeneration(
  ctx: ActionCtx,
  ownerId: string,
  actionJsons: string[],
  generation: HearingDebriefGeneratorPrecommit,
): Promise<void> {
  try {
    await ctx.runMutation(appendDebriefGenerationForOwnerReference, {
      ownerId,
      actionJsons,
      generationJson: JSON.stringify(generation),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("STALE")) {
      throw new Error("DEBRIEF_GENERATION_STALE");
    }
    if (
      message.includes("CONFLICT") ||
      message.includes("GENERATION") ||
      message.includes("MODEL_CALL") ||
      message.includes("ARTIFACT")
    ) {
      return invalidDebriefGeneration();
    }
    throw error;
  }
}

/** Commit one Terra coaching artifact and complete the trial atomically. */
export const commitDebriefGeneration = internalAction({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    generationJson: v.string(),
  },
  handler: async (ctx, args): Promise<HearingCommandPreparation> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    let generationInput: unknown;
    try {
      generationInput = parseJson(args.generationJson, "debrief_precommit");
    } catch {
      return invalidDebriefGeneration();
    }
    const parsed =
      HearingDebriefGeneratorPrecommitSchema.safeParse(generationInput);
    if (!parsed.success || parsed.data.trialId !== args.trialId) {
      return invalidDebriefGeneration();
    }
    const envelope = parsed.data;
    const ids = debriefGenerationIds(
      args.trialId,
      envelope.expectedStateVersion,
      envelope.expectedLastEventId,
    );
    const existing = await ctx.runQuery(loadGeneratedFinalBundleReference, {
      ownerId,
      trialId: args.trialId,
      actionId: ids.actionId,
      kind: "final_debrief",
    });
    if (existing !== null) {
      await appendDebriefGeneration(
        ctx,
        ownerId,
        existing.actionJsons,
        envelope,
      );
      return await canonicalContinuation(ctx, ownerId, args.trialId);
    }

    const head = await loadHead(ctx, ownerId, args.trialId);
    const coach = actorByRole(head.state, "debrief_coach", "neutral");
    const request = await canonicalDebriefGeneratorRequest(
      ctx,
      ownerId,
      {
        graph: head.graph,
        state: head.state,
        actor: coach,
        callId: envelope.callId,
      },
    );
    if (
      envelope.trace.completedAt === null ||
      !traceMatchesDebriefGeneratorRequest(envelope, request)
    ) {
      return invalidDebriefGeneration();
    }
    const validation = validateDebriefGeneratorOutput(request, envelope.output);
    if (!validation.accepted) return invalidDebriefGeneration();
    const completedAt = envelope.trace.completedAt;
    const debrief = actionFromIntent({
      actionId: ids.actionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion,
      actor: coach,
      source: "ai",
      requestedAt: requestedAtWithOffset(completedAt, 0),
      causationId: request.expectedLastEventId,
      modelMetadata: envelope.modelMetadata,
      type: "GENERATE_DEBRIEF",
      payload: { debriefId: ids.debriefId },
    });
    const completePhase = actionFromIntent({
      actionId: ids.completePhaseActionId,
      trialId: args.trialId,
      expectedStateVersion: request.expectedStateVersion + 1,
      actor: actorByRole(head.state, "judge", "neutral"),
      source: "deterministic",
      requestedAt: requestedAtWithOffset(completedAt, 1),
      causationId: eventIdForAction(debrief.actionId),
      type: "BEGIN_PHASE",
      payload: { phase: "complete" },
    });
    await appendDebriefGeneration(
      ctx,
      ownerId,
      [debrief, completePhase].map((action) => JSON.stringify(action)),
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
