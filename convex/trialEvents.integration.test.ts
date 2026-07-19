import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../src/domain/case-graph";
import type { TrialPolicyActorBindingInput } from "../src/domain/trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  TrialStateV3Schema,
  type ActorRef,
  type TrialActionV3,
} from "../src/domain/trial-engine";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

const OWNER_ID = "owner:trial-events-primary";
const OTHER_OWNER_ID = "owner:trial-events-other";
const GRAPH_ID = "graph:trial-events-published";
const OTHER_GRAPH_ID = "graph:trial-events-other-owner";
const DRAFT_GRAPH_ID = "graph:trial-events-draft";
const STARTED_AT = Date.UTC(2026, 6, 19, 6, 0, 0);

const ACTORS = {
  system: {
    actorId: "actor_system",
    role: "system",
    side: "neutral",
    witnessId: null,
  },
  judge: {
    actorId: "actor_judge",
    role: "judge",
    side: "neutral",
    witnessId: null,
  },
  userCounsel: {
    actorId: "actor_user_counsel",
    role: "user_counsel",
    side: "user",
    witnessId: null,
  },
  opposingCounsel: {
    actorId: "actor_opposing_counsel",
    role: "opposing_counsel",
    side: "opposing",
    witnessId: null,
  },
  jury: {
    actorId: "actor_jury",
    role: "jury",
    side: "neutral",
    witnessId: null,
  },
  rina: {
    actorId: "actor_witness_rina",
    role: "witness",
    side: "user",
    witnessId: "witness_rina_shah",
  },
  theo: {
    actorId: "actor_witness_theo",
    role: "witness",
    side: "opposing",
    witnessId: "witness_theo_morgan",
  },
  maya: {
    actorId: "actor_witness_maya",
    role: "witness",
    side: "neutral",
    witnessId: "witness_maya_ortiz",
  },
} as const satisfies Record<string, ActorRef>;

function actorBindings(): TrialPolicyActorBindingInput[] {
  return Object.values(ACTORS).map((boundActor) => ({
    actor: boundActor,
    representedPartyIds:
      boundActor.role === "user_counsel"
        ? ["party_rina_shah"]
        : boundActor.role === "opposing_counsel"
          ? ["party_redwood_signal"]
          : [],
  }));
}

type TestBackend = TestConvex<typeof schema>;

type Receipt = Readonly<{
  receiptId: string;
  trialId: string;
  actionId: string;
  committedStateVersion: number;
  firstSequence: number;
  lastSequence: number;
  eventIds: string[];
  replayed: boolean;
}>;

type CreateArgs = Readonly<{
  trialId: string;
  graphId: string;
  actionId: string;
  requestedAt: number;
  actorBindings: TrialPolicyActorBindingInput[];
  userSide?: "user" | "opposing";
}>;

type ReloadResult = Readonly<{
  trialId: string;
  graphId: string | null;
  stateVersion: number;
  lastSequence: number;
  stateJson: string;
  stateSchemaVersion: string;
  eventSchemaVersion: string;
  validated: boolean;
  requiresMigration: boolean;
  snapshot: null | Readonly<{
    lastSequence: number;
    stateSchemaVersion: string;
  }>;
  events: Array<Readonly<{
    eventId: string;
    sequence: number;
    eventSchemaVersion: string;
  }>>;
  hasMore: boolean;
  nextAfterSequence: number | null;
}>;

const createReference = makeFunctionReference<"mutation", CreateArgs, Receipt>(
  "trialEvents:createTrial",
);
const createForOwnerReference = makeFunctionReference<
  "mutation",
  CreateArgs & Readonly<{ ownerId: string }>,
  Receipt
>("trialEvents:createForOwner");
const appendReference = makeFunctionReference<
  "mutation",
  Readonly<{ actionJson: string }>,
  Receipt
>("trialEvents:append");
const appendTrustedReference = makeFunctionReference<
  "mutation",
  Readonly<{ actionJson: string; writeSnapshot?: boolean }>,
  Receipt
>("trialEvents:appendTrusted");
const appendPlayerForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; actionJson: string }>,
  Receipt
>("trialEvents:appendPlayerForOwner");
const appendTrustedForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    writeSnapshot?: boolean;
  }>,
  Receipt
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

async function insertGraph(
  backend: TestBackend,
  input: {
    graphId: string;
    ownerId: string;
    lifecycle?: "draft" | "published";
  },
): Promise<void> {
  const graph = createThreeWitnessCaseGraphV1Fixture();
  const lifecycle = input.lifecycle ?? "published";
  graph.status = lifecycle;
  await backend.run(async (ctx) => {
    await ctx.db.insert("caseGraphs", {
      graphId: input.graphId,
      caseId: graph.caseId,
      version: lifecycle === "draft" ? 1 : 2,
      lifecycle,
      visibility: "private",
      ownerId: input.ownerId,
      uploadId: `upload:${input.graphId}`,
      title: graph.title,
      graphJson: JSON.stringify(graph),
      graphSchemaVersion: graph.schemaVersion,
      compilerMetadataJson: undefined,
      sourceDigest: graph.compilerMetadata.sourceContentHash,
      createdBy: "user",
      createdAt: STARTED_AT,
    });
  });
}

async function setup() {
  const backend = convexTest({ schema, modules });
  await insertGraph(backend, { graphId: GRAPH_ID, ownerId: OWNER_ID });
  return {
    backend,
    owner: backend.withIdentity({ tokenIdentifier: OWNER_ID }),
    otherOwner: backend.withIdentity({ tokenIdentifier: OTHER_OWNER_ID }),
  };
}

async function reloadOwned(
  backend: TestBackend,
  input: Readonly<{
    trialId: string;
    ownerId?: string;
    afterSequence?: number;
    limit?: number;
  }>,
): Promise<ReloadResult> {
  return await backend.query(reloadForOwnerReference, {
    ownerId: input.ownerId ?? OWNER_ID,
    trialId: input.trialId,
    ...(input.afterSequence === undefined
      ? {}
      : { afterSequence: input.afterSequence }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
}

function createArgs(
  trialId: string,
  actionId = `action:${trialId}:start`,
  graphId = GRAPH_ID,
): CreateArgs {
  return {
    trialId,
    graphId,
    actionId,
    requestedAt: STARTED_AT,
    actorBindings: actorBindings(),
  };
}

function settlementAction(
  trialId: string,
  actionId: string,
  expectedStateVersion: number,
  amount = 90_000,
): TrialActionV3 {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId,
    trialId,
    expectedStateVersion,
    actor: ACTORS.userCounsel,
    source: "user",
    requestedAt: new Date(
      STARTED_AT + (expectedStateVersion + 1) * 1_000,
    ).toISOString(),
    causationId: `event:action:${trialId}:start`,
    correlationId: trialId,
    responseId: null,
    interruptId: null,
    modelMetadata: null,
    type: "PROPOSE_SETTLEMENT",
    payload: {
      offerId: `offer:${actionId}`,
      parentOfferId: null,
      proposedByPartyId: "party_rina_shah",
      recipientPartyIds: ["party_redwood_signal"],
      terms: {
        amount,
        currency: "USD",
        nonMonetaryTerms: ["Neutral reference"],
        summary: "Claimant proposes an educational-simulation settlement.",
      },
      expiresAtSequence: 14,
    },
  });
}

function forgedJudgeAction(trialId: string): TrialActionV3 {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: `action:${trialId}:forged-judge`,
    trialId,
    expectedStateVersion: 1,
    actor: ACTORS.judge,
    source: "deterministic",
    requestedAt: new Date(STARTED_AT + 2_000).toISOString(),
    causationId: `event:action:${trialId}:start`,
    correlationId: trialId,
    responseId: null,
    interruptId: null,
    modelMetadata: null,
    type: "BEGIN_PHASE",
    payload: { phase: "opening" },
  });
}

describe("owner-bound trial event persistence", () => {
  it("creates, reloads, and appends only for the authenticated owner", async () => {
    const { backend, owner, otherOwner } = await setup();
    const trialId = "trial:owner-bound";

    await expect(
      backend.mutation(createReference, createArgs(trialId)),
    ).rejects.toThrow("AUTHENTICATION_REQUIRED");

    const created = await owner.mutation(createReference, createArgs(trialId));
    expect(created).toMatchObject({
      committedStateVersion: 1,
      firstSequence: 1,
      lastSequence: 1,
      replayed: false,
    });
    await expect(
      reloadOwned(backend, { ownerId: OTHER_OWNER_ID, trialId }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      otherOwner.mutation(appendReference, {
        actionJson: JSON.stringify(
          settlementAction(trialId, "action:other-owner", 1),
        ),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");

    await expect(
      owner.mutation(appendReference, {
        actionJson: JSON.stringify(forgedJudgeAction(trialId)),
      }),
    ).rejects.toThrow("PLAYER_ACTION_NOT_PERMITTED");

    const action = settlementAction(
      trialId,
      "action:owner-bound:settlement",
      1,
    );
    const appended = await owner.mutation(appendReference, {
      actionJson: JSON.stringify(action),
    });
    expect(appended).toMatchObject({
      committedStateVersion: 2,
      firstSequence: 2,
      lastSequence: 2,
      replayed: false,
    });

    const reload = await reloadOwned(backend, { trialId });
    expect(reload).toMatchObject({
      trialId,
      graphId: GRAPH_ID,
      stateVersion: 2,
      lastSequence: 2,
      stateSchemaVersion: "trial-state.v3",
      eventSchemaVersion: "trial-event.v3",
      validated: true,
      requiresMigration: false,
      snapshot: { lastSequence: 1, stateSchemaVersion: "trial-state.v3" },
      events: [{ sequence: 2, eventSchemaVersion: "trial-event.v3" }],
      hasMore: false,
      nextAfterSequence: null,
    });
    expect(TrialStateV3Schema.parse(JSON.parse(reload.stateJson))).toMatchObject({
      version: 2,
      lastSequence: 2,
      phase: "pretrial",
      settlementOffers: {
        "offer:action:owner-bound:settlement": { status: "open" },
      },
    });
    const delta = await reloadOwned(backend, {
      trialId,
      afterSequence: 1,
    });
    expect(delta).toMatchObject({
      snapshot: null,
      events: [{ sequence: 2 }],
      hasMore: false,
    });

    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) => index.eq("trialId", trialId))
        .collect(),
      projections: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", trialId))
        .collect(),
    }));
    expect(stored.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(stored.projections).toHaveLength(1);
    expect(stored.projections[0]).toMatchObject({
      ownerId: OWNER_ID,
      graphId: GRAPH_ID,
      stateVersion: 2,
      lastSequence: 2,
    });
  });

  it("retains owner and player/trusted guards through the server facade", async () => {
    const { backend } = await setup();
    const trialId = "trial:server-owner-facade";
    const created = await backend.mutation(createForOwnerReference, {
      ownerId: OWNER_ID,
      ...createArgs(trialId),
    });
    expect(created).toMatchObject({
      trialId,
      committedStateVersion: 1,
      replayed: false,
    });

    await expect(
      backend.query(reloadForOwnerReference, {
        ownerId: OTHER_OWNER_ID,
        trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.mutation(appendPlayerForOwnerReference, {
        ownerId: OTHER_OWNER_ID,
        actionJson: JSON.stringify(
          settlementAction(trialId, "action:server-other-owner", 1),
        ),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.mutation(appendTrustedForOwnerReference, {
        ownerId: OTHER_OWNER_ID,
        actionJson: JSON.stringify(forgedJudgeAction(trialId)),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.mutation(appendPlayerForOwnerReference, {
        ownerId: OWNER_ID,
        actionJson: JSON.stringify(forgedJudgeAction(trialId)),
      }),
    ).rejects.toThrow("PLAYER_ACTION_NOT_PERMITTED");

    const player = await backend.mutation(appendPlayerForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify(
        settlementAction(trialId, "action:server-owner-player", 1),
      ),
    });
    expect(player).toMatchObject({ committedStateVersion: 2 });
    const trusted = await backend.mutation(appendTrustedForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify({
        ...forgedJudgeAction(trialId),
        expectedStateVersion: 2,
        causationId: player.eventIds[0],
      }),
    });
    expect(trusted).toMatchObject({ committedStateVersion: 3 });

    await expect(
      backend.query(reloadForOwnerReference, { ownerId: OWNER_ID, trialId }),
    ).resolves.toMatchObject({
      trialId,
      stateVersion: 3,
      lastSequence: 3,
      validated: true,
    });
  });

  it("preserves an offset event timestamp across storage and replay", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:offset-timestamp";
    await owner.mutation(createReference, createArgs(trialId));
    const requestedAt = "2026-07-19T07:15:23+05:30";
    const action = TrialActionV3Schema.parse({
      ...settlementAction(trialId, "action:offset-timestamp", 1),
      requestedAt,
    });

    await owner.mutation(appendReference, {
      actionJson: JSON.stringify(action),
    });
    const reload = await reloadOwned(backend, { trialId });
    expect(
      TrialStateV3Schema.parse(JSON.parse(reload.stateJson)).updatedAt,
    ).toBe(requestedAt);
    const storedTimestamp = await backend.run(async (ctx) =>
      (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", trialId),
          )
          .order("desc")
          .first()
      )?.occurredAtIso,
    );
    expect(storedTimestamp).toBe(requestedAt);
  });

  it("hands a mismatched payload schema version to migration", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:payload-version-mismatch";
    await owner.mutation(createReference, createArgs(trialId));
    await owner.mutation(appendReference, {
      actionJson: JSON.stringify(
        settlementAction(trialId, "action:payload-version-mismatch", 1),
      ),
    });
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", trialId).eq("sequence", 2),
        )
        .unique();
      if (!row) throw new Error("Missing appended event fixture");
      await ctx.db.patch(row._id, {
        payloadSchemaVersion: "trial-action.v2",
      });
    });

    await expect(reloadOwned(backend, { trialId })).resolves.toMatchObject({
      validated: false,
      requiresMigration: true,
    });
  });

  it("requires a published graph owned by the caller", async () => {
    const { backend, owner } = await setup();
    await insertGraph(backend, {
      graphId: OTHER_GRAPH_ID,
      ownerId: OTHER_OWNER_ID,
    });
    await insertGraph(backend, {
      graphId: DRAFT_GRAPH_ID,
      ownerId: OWNER_ID,
      lifecycle: "draft",
    });

    await expect(
      owner.mutation(
        createReference,
        createArgs("trial:other-graph", "action:other-graph", OTHER_GRAPH_ID),
      ),
    ).rejects.toThrow("CASE_GRAPH_NOT_FOUND");
    await expect(
      owner.mutation(
        createReference,
        createArgs("trial:draft-graph", "action:draft-graph", DRAFT_GRAPH_ID),
      ),
    ).rejects.toThrow("CASE_GRAPH_NOT_FOUND");
  });

  it("keeps judge and generated actors behind the trusted internal boundary", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:trusted-actor";
    await owner.mutation(createReference, createArgs(trialId));
    const action = forgedJudgeAction(trialId);

    await expect(
      owner.mutation(appendReference, {
        actionJson: JSON.stringify(action),
      }),
    ).rejects.toThrow("PLAYER_ACTION_NOT_PERMITTED");

    await expect(
      backend.mutation(appendTrustedReference, {
        actionJson: JSON.stringify(action),
      }),
    ).resolves.toMatchObject({
      committedStateVersion: 2,
      firstSequence: 2,
      lastSequence: 2,
      replayed: false,
    });
    const reloaded = await reloadOwned(backend, { trialId });
    expect(TrialStateV3Schema.parse(JSON.parse(reloaded.stateJson))).toMatchObject(
      { phase: "opening", version: 2, lastSequence: 2 },
    );
  });

  it("returns the same receipt for exact retries without duplicate writes", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:idempotent";
    const creation = createArgs(trialId);
    const firstCreate = await owner.mutation(createReference, creation);
    const secondCreate = await owner.mutation(createReference, creation);
    expect(firstCreate.replayed).toBe(false);
    expect(secondCreate).toEqual({ ...firstCreate, replayed: true });

    const action = settlementAction(
      trialId,
      "action:idempotent:settlement",
      1,
    );
    const firstAppend = await owner.mutation(appendReference, {
      actionJson: JSON.stringify(action),
    });
    await expect(
      owner.mutation(appendReference, {
        actionJson: JSON.stringify(
          settlementAction(
            trialId,
            "action:idempotent:settlement",
            1,
            95_000,
          ),
        ),
      }),
    ).rejects.toThrow("ACTION_ID_CONFLICT");
    const secondAppend = await owner.mutation(appendReference, {
      actionJson: JSON.stringify(action),
    });
    expect(firstAppend.replayed).toBe(false);
    expect(secondAppend).toEqual({ ...firstAppend, replayed: true });

    const counts = await backend.run(async (ctx) => ({
      events: (await ctx.db.query("trialEvents").collect()).length,
      receipts: (await ctx.db.query("actionReceipts").collect()).length,
      projections: (await ctx.db.query("trialProjections").collect()).length,
      snapshots: (await ctx.db.query("trialSnapshots").collect()).length,
    }));
    expect(counts).toEqual({
      events: 2,
      receipts: 2,
      projections: 1,
      snapshots: 1,
    });
  });

  it("serializes competing expected versions so one action wins atomically", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:concurrency";
    await owner.mutation(createReference, createArgs(trialId));

    const competitors = [
      settlementAction(trialId, "action:concurrency:a", 1),
      settlementAction(trialId, "action:concurrency:b", 1),
    ];
    const results = await Promise.allSettled(
      competitors.map((action) =>
        owner.mutation(appendReference, {
          actionJson: JSON.stringify(action),
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain("STALE_STATE_VERSION:1:2");

    const persisted = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) => index.eq("trialId", trialId))
        .collect(),
      receipts: await ctx.db
        .query("actionReceipts")
        .withIndex("by_trial_version", (index) => index.eq("trialId", trialId))
        .collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", trialId))
        .unique(),
    }));
    expect(persisted.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(persisted.receipts).toHaveLength(2);
    expect(persisted.projection).toMatchObject({
      stateVersion: 2,
      lastSequence: 2,
    });
  });

  it("rejects a projection that does not match its snapshot and event suffix", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:projection-integrity";
    await owner.mutation(createReference, createArgs(trialId));
    await backend.run(async (ctx) => {
      const projection = await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", trialId))
        .unique();
      if (!projection) throw new Error("TEST_PROJECTION_MISSING");
      const state = JSON.parse(projection.stateJson) as Record<string, unknown>;
      await ctx.db.patch(projection._id, {
        stateJson: JSON.stringify({ ...state, phase: "closing" }),
      });
    });

    await expect(
      reloadOwned(backend, { trialId }),
    ).rejects.toThrow("TRIAL_PROJECTION_MISMATCH");
    await expect(
      owner.mutation(appendReference, {
        actionJson: JSON.stringify(
          settlementAction(
            trialId,
            "action:projection-integrity:settlement",
            1,
          ),
        ),
      }),
    ).rejects.toThrow("TRIAL_PROJECTION_MISMATCH");
    const counts = await backend.run(async (ctx) => ({
      events: (await ctx.db.query("trialEvents").collect()).length,
      receipts: (await ctx.db.query("actionReceipts").collect()).length,
    }));
    expect(counts).toEqual({ events: 1, receipts: 1 });
  });

  it("rejects a stored event whose envelope no longer matches its action", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:event-integrity";
    await owner.mutation(createReference, createArgs(trialId));
    await owner.mutation(appendReference, {
      actionJson: JSON.stringify(
        settlementAction(trialId, "action:event-integrity:settlement", 1),
      ),
    });
    await backend.run(async (ctx) => {
      const event = await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", trialId).eq("sequence", 2),
        )
        .unique();
      if (!event) throw new Error("TEST_EVENT_NOT_FOUND");
      await ctx.db.patch(event._id, { factIds: ["fact_tampered"] });
    });

    await expect(
      reloadOwned(backend, { trialId }),
    ).rejects.toThrow("TRIAL_EVENT_ENVELOPE_MISMATCH");
  });

  it("returns legacy rows for migration without rewriting them", async () => {
    const { backend } = await setup();
    const trialId = "trial:legacy-v2";
    await backend.run(async (ctx) => {
      await ctx.db.insert("trialEvents", {
        eventId: "event:legacy-v2:start",
        trialId,
        sequence: 1,
        stateVersion: 1,
        actionId: "action:legacy-v2:start",
        eventType: "START_TRIAL",
        actorId: ACTORS.system.actorId,
        actorRole: ACTORS.system.role,
        actorSide: ACTORS.system.side,
        source: "system",
        payloadJson: JSON.stringify({ legacy: true }),
        payloadSchemaVersion: "trial-action.v2",
        eventSchemaVersion: "trial-event.v2",
        factIds: [],
        evidenceIds: [],
        testimonyIds: [],
        citationEventIds: [],
        sourceSegmentIds: [],
        turnIds: [],
        occurredAt: STARTED_AT,
        committedAt: STARTED_AT,
      });
      await ctx.db.insert("trialProjections", {
        projectionId: `projection:${trialId}`,
        trialId,
        ownerId: OWNER_ID,
        graphId: GRAPH_ID,
        stateVersion: 1,
        lastSequence: 1,
        stateJson: JSON.stringify({ schemaVersion: "trial-state.v2", legacy: true }),
        stateSchemaVersion: "trial-state.v2",
        eventSchemaVersion: "trial-event.v2",
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      });
    });

    const reload = await reloadOwned(backend, { trialId });
    expect(reload).toMatchObject({
      validated: false,
      requiresMigration: true,
      stateSchemaVersion: "trial-state.v2",
      eventSchemaVersion: "trial-event.v2",
      snapshot: null,
      events: [{
        eventId: "event:legacy-v2:start",
        sequence: 1,
        eventSchemaVersion: "trial-event.v2",
      }],
    });
    const after = await backend.run(async (ctx) => ({
      eventCount: (await ctx.db.query("trialEvents").collect()).length,
      projectionCount: (await ctx.db.query("trialProjections").collect()).length,
      eventVersion: (await ctx.db.query("trialEvents").first())?.eventSchemaVersion,
      stateVersion: (await ctx.db.query("trialProjections").first())?.stateSchemaVersion,
    }));
    expect(after).toEqual({
      eventCount: 1,
      projectionCount: 1,
      eventVersion: "trial-event.v2",
      stateVersion: "trial-state.v2",
    });
  });
});
