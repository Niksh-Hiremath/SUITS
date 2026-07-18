import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";

const DEFAULT_PAGE_SIZE = 25;
const MAX_INVENTORY_PAGE_SIZE = 100;
const MAX_CASE_BACKFILL_PAGE_SIZE = 10;
const MAX_JSON_CHARACTERS = 750_000;
const MAX_BACKFILL_BATCH_JSON_CHARACTERS = 2_000_000;

const legacyTable = v.union(
  v.literal("cases"),
  v.literal("privateCases"),
  v.literal("trials"),
  v.literal("turns"),
  v.literal("traces"),
  v.literal("juryVotes"),
  v.literal("debriefs"),
  v.literal("evalRuns"),
  v.literal("productEvents"),
);

type LegacyTable =
  | "cases"
  | "privateCases"
  | "trials"
  | "turns"
  | "traces"
  | "juryVotes"
  | "debriefs"
  | "evalRuns"
  | "productEvents";

type PageSummary = {
  processed: number;
  isDone: boolean;
  continueCursor: string;
};

function assertIdentifier(value: string, label: string) {
  if (!value.trim() || value.length > 256) {
    throw new Error(`${label} must contain 1-256 characters`);
  }
}

function boundedPageSize(
  requested: number | undefined,
  maximum: number,
): number {
  const pageSize = requested ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maximum) {
    throw new Error(`limit must be an integer from 1 through ${maximum}`);
  }
  return pageSize;
}

function serializedObject(value: unknown, label: string) {
  const json = JSON.stringify(value);
  if (!json || json.length > MAX_JSON_CHARACTERS) {
    throw new Error(
      `${label} exceeds the ${MAX_JSON_CHARACTERS}-character migration limit`,
    );
  }
  return json;
}

function sameCursor(left: string | undefined, right: string | undefined) {
  return left === right;
}

async function summarizeLegacyPage(
  ctx: MutationCtx,
  table: LegacyTable,
  cursor: string | undefined,
  numItems: number,
): Promise<PageSummary> {
  const pagination = { cursor: cursor ?? null, numItems };
  switch (table) {
    case "cases": {
      const result = await ctx.db.query("cases").order("asc").paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    case "privateCases": {
      const result = await ctx.db
        .query("privateCases")
        .order("asc")
        .paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    case "trials": {
      const result = await ctx.db.query("trials").order("asc").paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    case "turns": {
      const result = await ctx.db.query("turns").order("asc").paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    case "traces": {
      const result = await ctx.db.query("traces").order("asc").paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    case "juryVotes": {
      const result = await ctx.db
        .query("juryVotes")
        .order("asc")
        .paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    case "debriefs": {
      const result = await ctx.db
        .query("debriefs")
        .order("asc")
        .paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    case "evalRuns": {
      const result = await ctx.db
        .query("evalRuns")
        .order("asc")
        .paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    case "productEvents": {
      const result = await ctx.db
        .query("productEvents")
        .order("asc")
        .paginate(pagination);
      return {
        processed: result.page.length,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
  }
}

/**
 * Counts one bounded page without returning document contents. A stable
 * batchId makes retries a no-op, and the opaque cursor must match the durable
 * checkpoint so pages cannot be skipped or counted twice.
 */
export const inventoryLegacyPage = internalMutation({
  args: {
    migrationId: v.string(),
    batchId: v.string(),
    table: legacyTable,
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.migrationId, "migrationId");
    assertIdentifier(args.batchId, "batchId");
    const limit = boundedPageSize(args.limit, MAX_INVENTORY_PAGE_SIZE);
    const scope = `legacy-inventory:${args.table}`;
    const checkpoint = await ctx.db
      .query("migrationCheckpoints")
      .withIndex("by_migration_scope", (query) =>
        query.eq("migrationId", args.migrationId).eq("scope", scope),
      )
      .unique();

    if (checkpoint?.lastBatchId === args.batchId) {
      return {
        checkpointId: checkpoint.checkpointId,
        table: args.table,
        processedThisBatch: checkpoint.lastBatchProcessedCount ?? 0,
        processedTotal: checkpoint.processedCount,
        nextCursor: checkpoint.cursor,
        isDone: checkpoint.status === "complete",
        replayed: true,
      };
    }
    if (checkpoint?.status === "complete") {
      return {
        checkpointId: checkpoint.checkpointId,
        table: args.table,
        processedThisBatch: 0,
        processedTotal: checkpoint.processedCount,
        nextCursor: undefined,
        isDone: true,
        replayed: true,
      };
    }
    if (!sameCursor(checkpoint?.cursor, args.cursor)) {
      throw new Error("MIGRATION_CURSOR_MISMATCH");
    }

    const page = await summarizeLegacyPage(ctx, args.table, args.cursor, limit);
    const now = Date.now();
    const checkpointId = checkpoint?.checkpointId ?? `${args.migrationId}:${scope}`;
    const processedTotal = (checkpoint?.processedCount ?? 0) + page.processed;
    const nextCursor = page.isDone ? undefined : page.continueCursor;
    const detailsJson = serializedObject(
      { table: args.table, lastPageSize: page.processed },
      "inventory details",
    );
    const update = {
      status: page.isDone ? ("complete" as const) : ("running" as const),
      cursor: nextCursor,
      processedCount: processedTotal,
      insertedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      lastBatchId: args.batchId,
      lastBatchInputCursor: args.cursor,
      lastBatchOutputCursor: page.continueCursor,
      lastBatchProcessedCount: page.processed,
      lastBatchInsertedCount: 0,
      lastBatchSkippedCount: 0,
      detailsJson,
      updatedAt: now,
      completedAt: page.isDone ? now : undefined,
    };

    if (checkpoint) {
      await ctx.db.patch(checkpoint._id, update);
    } else {
      await ctx.db.insert("migrationCheckpoints", {
        checkpointId,
        migrationId: args.migrationId,
        scope,
        ...update,
        schemaVersion: "migration-checkpoint.v1",
        createdAt: now,
      });
    }

    return {
      checkpointId,
      table: args.table,
      processedThisBatch: page.processed,
      processedTotal,
      nextCursor,
      isDone: page.isDone,
      replayed: false,
    };
  },
});

/**
 * Conservatively imports legacy cases as private immutable CaseGraph versions.
 * Unknown ownership remains unknown, and a mismatched private-case version is
 * recorded as a migration limitation rather than silently merged.
 */
export const backfillLegacyCaseGraphsPage = internalMutation({
  args: {
    migrationId: v.string(),
    batchId: v.string(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.migrationId, "migrationId");
    assertIdentifier(args.batchId, "batchId");
    const limit = boundedPageSize(args.limit, MAX_CASE_BACKFILL_PAGE_SIZE);
    const scope = "legacy-case-graphs:v1";
    const checkpoint = await ctx.db
      .query("migrationCheckpoints")
      .withIndex("by_migration_scope", (query) =>
        query.eq("migrationId", args.migrationId).eq("scope", scope),
      )
      .unique();

    if (checkpoint?.lastBatchId === args.batchId) {
      return {
        checkpointId: checkpoint.checkpointId,
        processedThisBatch: checkpoint.lastBatchProcessedCount ?? 0,
        insertedThisBatch: checkpoint.lastBatchInsertedCount ?? 0,
        skippedThisBatch: checkpoint.lastBatchSkippedCount ?? 0,
        processedTotal: checkpoint.processedCount,
        insertedTotal: checkpoint.insertedCount,
        skippedTotal: checkpoint.skippedCount,
        nextCursor: checkpoint.cursor,
        isDone: checkpoint.status === "complete",
        replayed: true,
      };
    }
    if (checkpoint?.status === "complete") {
      return {
        checkpointId: checkpoint.checkpointId,
        processedThisBatch: 0,
        insertedThisBatch: 0,
        skippedThisBatch: 0,
        processedTotal: checkpoint.processedCount,
        insertedTotal: checkpoint.insertedCount,
        skippedTotal: checkpoint.skippedCount,
        nextCursor: undefined,
        isDone: true,
        replayed: true,
      };
    }
    if (!sameCursor(checkpoint?.cursor, args.cursor)) {
      throw new Error("MIGRATION_CURSOR_MISMATCH");
    }

    const page = await ctx.db.query("cases").order("asc").paginate({
      cursor: args.cursor ?? null,
      numItems: limit,
    });
    let inserted = 0;
    let skipped = 0;
    let serializedCharacters = 0;
    for (const legacyCase of page.page) {
      if (!Number.isSafeInteger(legacyCase.version) || legacyCase.version < 1) {
        throw new Error(`INVALID_LEGACY_CASE_VERSION:${legacyCase.caseId}`);
      }
      const existing = await ctx.db
        .query("caseGraphs")
        .withIndex("by_case_version", (query) =>
          query
            .eq("caseId", legacyCase.caseId)
            .eq("version", legacyCase.version),
        )
        .unique();
      if (existing) {
        skipped += 1;
        continue;
      }

      const privateCase = await ctx.db
        .query("privateCases")
        .withIndex("by_case_id", (query) =>
          query.eq("caseId", legacyCase.caseId),
        )
        .unique();
      const privateVersionStatus = !privateCase
        ? "missing"
        : privateCase.version === legacyCase.version
          ? "matched"
          : "version_mismatch";
      const matchingPrivateCase =
        privateVersionStatus === "matched" ? privateCase : null;
      const graphSchemaVersion = "case-graph.legacy.v1";
      const graphJson = serializedObject(
        {
          schemaVersion: graphSchemaVersion,
          caseId: legacyCase.caseId,
          version: legacyCase.version,
          slug: legacyCase.slug,
          title: legacyCase.title,
          disclaimer: legacyCase.disclaimer,
          neutralSummary: legacyCase.neutralSummary,
          publicFacts: legacyCase.publicFacts,
          publicEvidence: legacyCase.publicEvidence,
          authoringTruth: matchingPrivateCase
            ? {
                witnessFacts: matchingPrivateCase.witnessFacts,
                hiddenEvidence: matchingPrivateCase.hiddenEvidence,
                canonicalAssessment: matchingPrivateCase.canonicalAssessment,
                decisiveAnswer: matchingPrivateCase.decisiveAnswer,
                unsupportedAnswer: matchingPrivateCase.unsupportedAnswer,
              }
            : null,
          migrationLimitations: [
            "Legacy rows do not contain owner identity or source-segment provenance.",
            "Legacy fact and evidence lifecycle states cannot be inferred.",
            ...(privateVersionStatus === "version_mismatch"
              ? ["The private-case version did not match and was not merged."]
              : []),
          ],
        },
        "legacy CaseGraph",
      );
      const compilerMetadataJson = serializedObject(
        {
          kind: "legacy_import",
          migrationId: args.migrationId,
          publicDocumentId: legacyCase._id,
          privateDocumentId: matchingPrivateCase?._id ?? null,
          privateVersionStatus,
        },
        "legacy compiler metadata",
      );
      serializedCharacters += graphJson.length + compilerMetadataJson.length;
      if (serializedCharacters > MAX_BACKFILL_BATCH_JSON_CHARACTERS) {
        throw new Error(
          `BACKFILL_JSON_BUDGET_EXCEEDED:${serializedCharacters}:${MAX_BACKFILL_BATCH_JSON_CHARACTERS}`,
        );
      }

      await ctx.db.insert("caseGraphs", {
        graphId: `casegraph:${legacyCase.caseId}:v${legacyCase.version}`,
        caseId: legacyCase.caseId,
        version: legacyCase.version,
        lifecycle: legacyCase.status === "archived" ? "archived" : "published",
        visibility: "private",
        title: legacyCase.title,
        graphJson,
        graphSchemaVersion,
        compilerMetadataJson,
        createdBy: "migration",
        createdAt: legacyCase.createdAt,
      });
      inserted += 1;
    }

    const now = Date.now();
    const processed = page.page.length;
    const processedTotal = (checkpoint?.processedCount ?? 0) + processed;
    const insertedTotal = (checkpoint?.insertedCount ?? 0) + inserted;
    const skippedTotal = (checkpoint?.skippedCount ?? 0) + skipped;
    const nextCursor = page.isDone ? undefined : page.continueCursor;
    const checkpointId = checkpoint?.checkpointId ?? `${args.migrationId}:${scope}`;
    const detailsJson = serializedObject(
      {
        sourceTable: "cases",
        destinationTable: "caseGraphs",
        visibilityPolicy: "private_until_ownership_review",
      },
      "case backfill details",
    );
    const update = {
      status: page.isDone ? ("complete" as const) : ("running" as const),
      cursor: nextCursor,
      processedCount: processedTotal,
      insertedCount: insertedTotal,
      skippedCount: skippedTotal,
      errorCount: 0,
      lastBatchId: args.batchId,
      lastBatchInputCursor: args.cursor,
      lastBatchOutputCursor: page.continueCursor,
      lastBatchProcessedCount: processed,
      lastBatchInsertedCount: inserted,
      lastBatchSkippedCount: skipped,
      detailsJson,
      updatedAt: now,
      completedAt: page.isDone ? now : undefined,
    };

    if (checkpoint) {
      await ctx.db.patch(checkpoint._id, update);
    } else {
      await ctx.db.insert("migrationCheckpoints", {
        checkpointId,
        migrationId: args.migrationId,
        scope,
        ...update,
        schemaVersion: "migration-checkpoint.v1",
        createdAt: now,
      });
    }

    return {
      checkpointId,
      processedThisBatch: processed,
      insertedThisBatch: inserted,
      skippedThisBatch: skipped,
      processedTotal,
      insertedTotal,
      skippedTotal,
      nextCursor,
      isDone: page.isDone,
      replayed: false,
    };
  },
});

export const getCheckpoint = internalQuery({
  args: { migrationId: v.string(), scope: v.string() },
  handler: async (ctx, args) => {
    assertIdentifier(args.migrationId, "migrationId");
    assertIdentifier(args.scope, "scope");
    return await ctx.db
      .query("migrationCheckpoints")
      .withIndex("by_migration_scope", (query) =>
        query.eq("migrationId", args.migrationId).eq("scope", args.scope),
      )
      .unique();
  },
});
