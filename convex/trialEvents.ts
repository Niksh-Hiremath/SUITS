import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

const MAX_EVENTS_PER_ACTION = 32;
const MAX_JSON_CHARACTERS = 750_000;
const MAX_ACTION_JSON_CHARACTERS = 1_500_000;
const MAX_REFERENCES_PER_EVENT = 128;

const eventType = v.union(
  v.literal("START_TRIAL"),
  v.literal("BEGIN_PHASE"),
  v.literal("CALL_WITNESS"),
  v.literal("SWEAR_WITNESS"),
  v.literal("ASK_QUESTION"),
  v.literal("ANSWER_QUESTION"),
  v.literal("END_EXAMINATION"),
  v.literal("RECALL_WITNESS"),
  v.literal("RELEASE_WITNESS"),
  v.literal("OBJECT"),
  v.literal("RULE_ON_OBJECTION"),
  v.literal("REPHRASE_QUESTION"),
  v.literal("MOVE_TO_STRIKE"),
  v.literal("STRIKE_TESTIMONY"),
  v.literal("OFFER_EVIDENCE"),
  v.literal("RULE_ON_EVIDENCE"),
  v.literal("WITHDRAW_EVIDENCE"),
  v.literal("REVEAL_HIDDEN_FACT"),
  v.literal("PROPOSE_ASSERTION"),
  v.literal("VERIFY_ASSERTION"),
  v.literal("DISPUTE_ASSERTION"),
  v.literal("RULE_ON_ASSERTION"),
  v.literal("REQUEST_RESPONSE"),
  v.literal("CANCEL_RESPONSE"),
  v.literal("COMPLETE_RESPONSE"),
  v.literal("BEGIN_INTERRUPTION"),
  v.literal("RESOLVE_INTERRUPTION"),
  v.literal("RESUME_INTERRUPTED_SPEECH"),
  v.literal("PAUSE_TRIAL"),
  v.literal("REQUEST_RECESS"),
  v.literal("RESUME_TRIAL"),
  v.literal("PROPOSE_SETTLEMENT"),
  v.literal("COUNTER_SETTLEMENT"),
  v.literal("ACCEPT_SETTLEMENT"),
  v.literal("REJECT_SETTLEMENT"),
  v.literal("WITHDRAW_SETTLEMENT"),
  v.literal("EXPIRE_SETTLEMENT"),
  v.literal("REST_CASE"),
  v.literal("GIVE_CLOSING"),
  v.literal("INSTRUCT_JURY"),
  v.literal("DELIBERATE"),
  v.literal("RENDER_VERDICT"),
  v.literal("GENERATE_DEBRIEF"),
  v.literal("FAIL_STEP"),
  v.literal("RECOVER_STEP"),
);

const eventSource = v.union(
  v.literal("user"),
  v.literal("ai"),
  v.literal("deterministic"),
  v.literal("speech"),
  v.literal("system"),
);

const permittedOpenAiModel = v.union(
  v.literal("gpt-5.6-luna"),
  v.literal("gpt-5.6-terra"),
);

const trialSide = v.union(
  v.literal("user"),
  v.literal("opposing"),
  v.literal("neutral"),
);

const actorRole = v.union(
  v.literal("user_counsel"),
  v.literal("opposing_counsel"),
  v.literal("judge"),
  v.literal("witness"),
  v.literal("clerk"),
  v.literal("jury"),
  v.literal("system"),
  v.literal("debrief_coach"),
);

const eventInput = v.object({
  eventId: v.string(),
  eventType,
  actorId: v.string(),
  actorRole,
  actorSide: trialSide,
  witnessId: v.optional(v.string()),
  source: eventSource,
  causationId: v.optional(v.string()),
  correlationId: v.optional(v.string()),
  responseId: v.optional(v.string()),
  interruptId: v.optional(v.string()),
  utteranceId: v.optional(v.string()),
  utteranceRevision: v.optional(v.number()),
  payloadJson: v.string(),
  payloadSchemaVersion: v.string(),
  eventSchemaVersion: v.string(),
  promptVersion: v.optional(v.string()),
  model: v.optional(permittedOpenAiModel),
  modelRequestId: v.optional(v.string()),
  modelSchemaVersion: v.optional(v.string()),
  modelLatencyMs: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  estimatedCostUsd: v.optional(v.number()),
  retryCount: v.optional(v.number()),
  validationFailureCount: v.optional(v.number()),
  factIds: v.optional(v.array(v.string())),
  evidenceIds: v.optional(v.array(v.string())),
  testimonyIds: v.optional(v.array(v.string())),
  citationEventIds: v.optional(v.array(v.string())),
  sourceSegmentIds: v.optional(v.array(v.string())),
  turnIds: v.optional(v.array(v.string())),
  occurredAt: v.optional(v.number()),
});

function assertIdentifier(value: string, label: string) {
  if (!value.trim() || value.length > 256) {
    throw new Error(`${label} must contain 1-256 characters`);
  }
}

function assertNonNegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertOptionalNonNegativeNumber(
  value: number | undefined,
  label: string,
) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}

function assertJsonObject(value: string, label: string) {
  if (!value.trim() || value.length > MAX_JSON_CHARACTERS) {
    throw new Error(
      `${label} must contain 1-${MAX_JSON_CHARACTERS} serialized JSON characters`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must be valid serialized JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must serialize a JSON object`);
  }
}

function normalizeReferences(values: string[] | undefined, label: string) {
  const references = values ?? [];
  if (references.length > MAX_REFERENCES_PER_EVENT) {
    throw new Error(
      `${label} cannot contain more than ${MAX_REFERENCES_PER_EVENT} IDs`,
    );
  }
  for (const reference of references) assertIdentifier(reference, label);
  return references;
}

/**
 * Commits one validated action as an atomic batch of immutable material events.
 * The mutation is internal so browser code cannot forge actors, citations, or
 * state. The caller must reduce and validate the action before supplying the
 * resulting projection.
 */
export const append = internalMutation({
  args: {
    trialId: v.string(),
    actionId: v.string(),
    expectedStateVersion: v.number(),
    requestHash: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    receiptSchemaVersion: v.string(),
    projection: v.object({
      stateJson: v.string(),
      stateSchemaVersion: v.string(),
      eventSchemaVersion: v.string(),
    }),
    writeSnapshot: v.optional(v.boolean()),
    events: v.array(eventInput),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.trialId, "trialId");
    assertIdentifier(args.actionId, "actionId");
    assertIdentifier(args.receiptSchemaVersion, "receiptSchemaVersion");
    assertIdentifier(
      args.projection.stateSchemaVersion,
      "projection.stateSchemaVersion",
    );
    assertIdentifier(
      args.projection.eventSchemaVersion,
      "projection.eventSchemaVersion",
    );
    assertNonNegativeInteger(args.expectedStateVersion, "expectedStateVersion");
    assertJsonObject(args.projection.stateJson, "projection.stateJson");
    if (args.resultJson !== undefined) {
      assertJsonObject(args.resultJson, "resultJson");
    }
    if (args.requestHash !== undefined) {
      assertIdentifier(args.requestHash, "requestHash");
    }
    if (args.events.length === 0 || args.events.length > MAX_EVENTS_PER_ACTION) {
      throw new Error(
        `events must contain 1-${MAX_EVENTS_PER_ACTION} material events`,
      );
    }
    const actionJsonCharacters =
      args.projection.stateJson.length +
      (args.resultJson?.length ?? 0) +
      args.events.reduce((total, event) => total + event.payloadJson.length, 0);
    if (actionJsonCharacters > MAX_ACTION_JSON_CHARACTERS) {
      throw new Error(
        `ACTION_JSON_BUDGET_EXCEEDED:${actionJsonCharacters}:${MAX_ACTION_JSON_CHARACTERS}`,
      );
    }

    const legacyTrial = await ctx.db
      .query("trials")
      .withIndex("by_trial_id", (query) => query.eq("trialId", args.trialId))
      .unique();
    if (!legacyTrial) throw new Error("TRIAL_NOT_FOUND");

    const duplicateAction = await ctx.db
      .query("actionReceipts")
      .withIndex("by_action_id", (query) => query.eq("actionId", args.actionId))
      .unique();
    if (duplicateAction) throw new Error("DUPLICATE_ACTION_ID");

    const eventIds = new Set<string>();
    for (const event of args.events) {
      assertIdentifier(event.eventId, "eventId");
      if (eventIds.has(event.eventId)) throw new Error("DUPLICATE_EVENT_ID");
      eventIds.add(event.eventId);
      assertIdentifier(event.actorId, "actorId");
      if (event.witnessId !== undefined) {
        assertIdentifier(event.witnessId, "witnessId");
      }
      if (event.causationId !== undefined) {
        assertIdentifier(event.causationId, "causationId");
      }
      if (event.correlationId !== undefined) {
        assertIdentifier(event.correlationId, "correlationId");
      }
      if (event.responseId !== undefined) {
        assertIdentifier(event.responseId, "responseId");
      }
      if (event.interruptId !== undefined) {
        assertIdentifier(event.interruptId, "interruptId");
      }
      if (event.utteranceId !== undefined) {
        assertIdentifier(event.utteranceId, "utteranceId");
      }
      if (event.utteranceRevision !== undefined) {
        assertNonNegativeInteger(event.utteranceRevision, "utteranceRevision");
      }
      assertIdentifier(event.payloadSchemaVersion, "payloadSchemaVersion");
      assertIdentifier(event.eventSchemaVersion, "eventSchemaVersion");
      if (event.eventSchemaVersion !== args.projection.eventSchemaVersion) {
        throw new Error("EVENT_SCHEMA_VERSION_MISMATCH");
      }
      assertJsonObject(event.payloadJson, "payloadJson");
      if (
        event.source === "ai" &&
        (!event.promptVersion || !event.model || !event.modelSchemaVersion)
      ) {
        throw new Error("AI_EVENT_REQUIRES_PROMPT_AND_MODEL_VERSION");
      }
      if (event.promptVersion !== undefined) {
        assertIdentifier(event.promptVersion, "promptVersion");
      }
      if (event.modelRequestId !== undefined) {
        assertIdentifier(event.modelRequestId, "modelRequestId");
      }
      if (event.modelSchemaVersion !== undefined) {
        assertIdentifier(event.modelSchemaVersion, "modelSchemaVersion");
      }
      assertOptionalNonNegativeNumber(event.modelLatencyMs, "modelLatencyMs");
      assertOptionalNonNegativeNumber(event.inputTokens, "inputTokens");
      assertOptionalNonNegativeNumber(event.outputTokens, "outputTokens");
      assertOptionalNonNegativeNumber(
        event.estimatedCostUsd,
        "estimatedCostUsd",
      );
      if (event.retryCount !== undefined) {
        assertNonNegativeInteger(event.retryCount, "retryCount");
      }
      if (event.validationFailureCount !== undefined) {
        assertNonNegativeInteger(
          event.validationFailureCount,
          "validationFailureCount",
        );
      }
      if (
        event.occurredAt !== undefined &&
        (!Number.isFinite(event.occurredAt) || event.occurredAt < 0)
      ) {
        throw new Error("occurredAt must be a non-negative finite timestamp");
      }
      normalizeReferences(event.factIds, "factIds");
      normalizeReferences(event.evidenceIds, "evidenceIds");
      normalizeReferences(event.testimonyIds, "testimonyIds");
      normalizeReferences(event.citationEventIds, "citationEventIds");
      normalizeReferences(event.sourceSegmentIds, "sourceSegmentIds");
      normalizeReferences(event.turnIds, "turnIds");
    }

    const duplicateEvents = await Promise.all(
      args.events.map((event) =>
        ctx.db
          .query("trialEvents")
          .withIndex("by_event_id", (query) => query.eq("eventId", event.eventId))
          .unique(),
      ),
    );
    if (duplicateEvents.some(Boolean)) throw new Error("DUPLICATE_EVENT_ID");

    const [projection, lastEvent] = await Promise.all([
      ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (query) => query.eq("trialId", args.trialId))
        .unique(),
      ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (query) =>
          query.eq("trialId", args.trialId),
        )
        .order("desc")
        .first(),
    ]);
    const currentStateVersion = projection?.stateVersion ?? 0;
    const currentSequence = projection?.lastSequence ?? 0;

    if (currentStateVersion !== args.expectedStateVersion) {
      throw new Error(
        `STALE_STATE_VERSION:${args.expectedStateVersion}:${currentStateVersion}`,
      );
    }
    if (
      projection &&
      (lastEvent?.sequence ?? 0) !== projection.lastSequence
    ) {
      throw new Error("EVENT_HEAD_MISMATCH");
    }
    if (!projection && lastEvent) throw new Error("PROJECTION_MISSING");

    const committedAt = Date.now();
    const committedStateVersion = currentStateVersion + 1;
    const firstSequence = currentSequence + 1;
    const lastSequence = currentSequence + args.events.length;

    for (let index = 0; index < args.events.length; index += 1) {
      const event = args.events[index];
      await ctx.db.insert("trialEvents", {
        eventId: event.eventId,
        trialId: args.trialId,
        sequence: firstSequence + index,
        stateVersion: committedStateVersion,
        actionId: args.actionId,
        eventType: event.eventType,
        actorId: event.actorId,
        actorRole: event.actorRole,
        actorSide: event.actorSide,
        witnessId: event.witnessId,
        source: event.source,
        causationId: event.causationId,
        correlationId: event.correlationId,
        responseId: event.responseId,
        interruptId: event.interruptId,
        utteranceId: event.utteranceId,
        utteranceRevision: event.utteranceRevision,
        payloadJson: event.payloadJson,
        payloadSchemaVersion: event.payloadSchemaVersion,
        eventSchemaVersion: event.eventSchemaVersion,
        promptVersion: event.promptVersion,
        model: event.model,
        modelRequestId: event.modelRequestId,
        modelSchemaVersion: event.modelSchemaVersion,
        modelLatencyMs: event.modelLatencyMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        estimatedCostUsd: event.estimatedCostUsd,
        retryCount: event.retryCount,
        validationFailureCount: event.validationFailureCount,
        factIds: normalizeReferences(event.factIds, "factIds"),
        evidenceIds: normalizeReferences(event.evidenceIds, "evidenceIds"),
        testimonyIds: normalizeReferences(event.testimonyIds, "testimonyIds"),
        citationEventIds: normalizeReferences(
          event.citationEventIds,
          "citationEventIds",
        ),
        sourceSegmentIds: normalizeReferences(
          event.sourceSegmentIds,
          "sourceSegmentIds",
        ),
        turnIds: normalizeReferences(event.turnIds, "turnIds"),
        occurredAt: event.occurredAt ?? committedAt,
        committedAt,
      });
    }

    if (projection) {
      await ctx.db.patch(projection._id, {
        stateVersion: committedStateVersion,
        lastSequence,
        stateJson: args.projection.stateJson,
        stateSchemaVersion: args.projection.stateSchemaVersion,
        eventSchemaVersion: args.projection.eventSchemaVersion,
        updatedAt: committedAt,
      });
    } else {
      await ctx.db.insert("trialProjections", {
        projectionId: `projection:${args.trialId}`,
        trialId: args.trialId,
        stateVersion: committedStateVersion,
        lastSequence,
        stateJson: args.projection.stateJson,
        stateSchemaVersion: args.projection.stateSchemaVersion,
        eventSchemaVersion: args.projection.eventSchemaVersion,
        createdAt: committedAt,
        updatedAt: committedAt,
      });
    }

    if (args.writeSnapshot) {
      const existingSnapshot = await ctx.db
        .query("trialSnapshots")
        .withIndex("by_trial_version", (query) =>
          query
            .eq("trialId", args.trialId)
            .eq("stateVersion", committedStateVersion),
        )
        .unique();
      if (existingSnapshot) throw new Error("DUPLICATE_SNAPSHOT_VERSION");
      await ctx.db.insert("trialSnapshots", {
        snapshotId: `snapshot:${args.trialId}:${committedStateVersion}`,
        trialId: args.trialId,
        stateVersion: committedStateVersion,
        lastSequence,
        stateJson: args.projection.stateJson,
        stateSchemaVersion: args.projection.stateSchemaVersion,
        source: "event_commit",
        createdAt: committedAt,
      });
    }

    const receiptId = `receipt:${args.actionId}`;
    await ctx.db.insert("actionReceipts", {
      receiptId,
      actionId: args.actionId,
      trialId: args.trialId,
      status: "committed",
      expectedStateVersion: args.expectedStateVersion,
      committedStateVersion,
      firstSequence,
      lastSequence,
      eventIds: [...eventIds],
      requestHash: args.requestHash,
      resultJson: args.resultJson,
      schemaVersion: args.receiptSchemaVersion,
      createdAt: committedAt,
    });

    return {
      receiptId,
      trialId: args.trialId,
      actionId: args.actionId,
      committedStateVersion,
      firstSequence,
      lastSequence,
      eventIds: [...eventIds],
    };
  },
});
