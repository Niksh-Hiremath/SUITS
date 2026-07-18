import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
  CaseGraphV1Schema,
  type CaseGraphV1,
} from "../src/domain/case-graph";
import {
  HearingCaseSelectorSchema,
  HearingPlayerCommandSchema,
  StartHearingRequestSchema,
  buildHearingRuntimeView,
  createDeterministicWitnessAnswer,
  deriveTrialActorBindings,
  type HearingCaseSelector,
  type HearingRuntimeViewV1,
} from "../src/domain/hearing-runtime";
import { buildKnowledgeView } from "../src/domain/knowledge";
import { getSeededCaseBySlug as seededCaseBySlug } from "../src/domain/seeded-cases";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  TrialStateV3Schema,
  type ActorRef,
  type EventSource,
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
  const allowed = new Set(rule.callableByActorIds);
  const matches = Object.values(state.actors)
    .filter(
      (actor) =>
        actor.role === playerRole(state) &&
        actor.side === state.userSide &&
        allowed.has(actor.actorId),
    )
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  if (matches.length === 0) throw new Error("PLAYER_CANNOT_CALL_WITNESS");
  return matches[0];
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
    modelMetadata: null,
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

async function askWitness(
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
  const answerActionId = runtimeActionId(
    trialId,
    command.requestId,
    "answer-question",
  );
  if (
    await ctx.runQuery(eventExistsReference, {
      ownerId,
      trialId,
      actionId: answerActionId,
    })
  ) {
    return;
  }
  const responseHead = await loadHead(ctx, ownerId, trialId);
  const witnessKnowledge = buildKnowledgeView(
    { caseGraph: responseHead.graph, trial: responseHead.state },
    witnessActor.actorId,
  );
  if (witnessKnowledge.actorRole !== "witness") {
    throw new Error("WITNESS_KNOWLEDGE_REQUIRED");
  }
  const answer = createDeterministicWitnessAnswer(
    witnessKnowledge,
    command.intent.text,
    command.intent.presentedEvidenceIds,
  );
  await appendRuntimeAction(
    ctx,
    ownerId,
    actionFromIntent({
      actionId: answerActionId,
      trialId,
      expectedStateVersion: command.expectedStateVersion + 2,
      actor: witnessActor,
      source: "deterministic",
      requestedAt: requestedAtWithOffset(command.requestedAt, 2),
      causationId: eventIdForAction(requestResponseActionId),
      type: "ANSWER_QUESTION",
      payload: {
        responseId,
        questionId,
        witnessId: command.intent.witnessId,
        testimonyId: `testimony:${command.requestId}`,
        turnId: `turn:answer:${command.requestId}`,
        text: answer.text,
        factIds: answer.factIds,
        evidenceIds: answer.evidenceIds,
      },
    }),
    false,
    true,
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

export const command = internalAction({
  args: { ownerId: v.string(), trialId: v.string(), commandJson: v.string() },
  handler: async (ctx, args): Promise<HearingRuntimeViewV1> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const commandInput = HearingPlayerCommandSchema.parse(
      parseJson(args.commandJson, "hearing_player_command"),
    );
    const head = await loadHead(ctx, ownerId, args.trialId);
    switch (commandInput.intent.type) {
      case "call_witness":
        await callWitness(ctx, ownerId, args.trialId, commandInput, head.state);
        break;
      case "ask_question":
        await askWitness(ctx, ownerId, args.trialId, commandInput, head);
        break;
      case "finish_witness":
        await finishWitness(ctx, ownerId, args.trialId, commandInput, head.state);
        break;
      case "finish_trial":
        await finishTrial(ctx, ownerId, args.trialId, commandInput, head.state);
        break;
    }
    return (await loadHead(ctx, ownerId, args.trialId)).view;
  },
});
