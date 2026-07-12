import { v } from "convex/values";

import { calculateElevenLabsCostUsd, calculateOpenAiCostUsd } from "../src/domain/cost-observability";
import { mutation } from "./_generated/server";

const phase = v.union(
  v.literal("briefing"),
  v.literal("opening"),
  v.literal("cross_examination"),
  v.literal("closing"),
  v.literal("deliberation"),
  v.literal("debrief"),
  v.literal("complete"),
  v.literal("failed"),
);

export const start = mutation({
  args: {
    trialId: v.string(),
    parentId: v.optional(v.string()),
    actor: v.string(),
    action: v.string(),
    phase,
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    inputTurnIds: v.optional(v.array(v.string())),
    promptVersion: v.optional(v.string()),
    plan: v.optional(v.array(v.string())),
    selectedSpecialist: v.optional(v.string()),
    persona: v.optional(v.string()),
    contractJson: v.optional(v.string()),
    delegationRationale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trial = await ctx.db.query("trials").withIndex("by_trial_id", (q) => q.eq("trialId", args.trialId)).unique();
    if (!trial) throw new Error("Trial not found");
    const traceId = `trace_${crypto.randomUUID()}`;
    await ctx.db.insert("traces", {
      traceId,
      trialId: args.trialId,
      parentId: args.parentId,
      actor: args.actor,
      action: args.action,
      phase: args.phase,
      status: "running",
      startedAt: Date.now(),
      provider: args.provider,
      model: args.model,
      retryCount: 0,
      fallbackUsed: false,
      inputTurnIds: args.inputTurnIds ?? [],
      outputTurnIds: [],
      artifactIds: [],
      schemaVersion: "trace.v1",
      promptVersion: args.promptVersion ?? "authored.v1",
      plan: args.plan,
      selectedSpecialist: args.selectedSpecialist,
      persona: args.persona,
      contractJson: args.contractJson,
      delegationRationale: args.delegationRationale,
    });
    return traceId;
  },
});

export const finish = mutation({
  args: {
    traceId: v.string(),
    status: v.union(
      v.literal("succeeded"),
      v.literal("repaired"),
      v.literal("fallback"),
      v.literal("interrupted"),
      v.literal("failed"),
    ),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    inputCharacters: v.optional(v.number()),
    outputCharacters: v.optional(v.number()),
    audioDurationSeconds: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    fallbackUsed: v.optional(v.boolean()),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    outputTurnIds: v.optional(v.array(v.string())),
    artifactIds: v.optional(v.array(v.string())),
    reviewJson: v.optional(v.string()),
    escalation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("traces")
      .withIndex("by_trace_id", (q) => q.eq("traceId", args.traceId))
      .unique();
    if (!trace) throw new Error("Trace not found");
    const endedAt = Date.now();
    const estimatedCostUsd = calculateOpenAiCostUsd(
      trace.provider,
      trace.model,
      args.inputTokens,
      args.outputTokens,
      {
        pricedModel: process.env.OPENAI_PRICED_MODEL,
        inputUsdPerMillionTokens: process.env.OPENAI_INPUT_USD_PER_MILLION_TOKENS,
        outputUsdPerMillionTokens: process.env.OPENAI_OUTPUT_USD_PER_MILLION_TOKENS,
      },
    ) ?? calculateElevenLabsCostUsd(trace.provider, trace.action, args.inputCharacters, args.audioDurationSeconds);
    await ctx.db.patch(trace._id, {
      status: args.status,
      endedAt,
      latencyMs: endedAt - trace.startedAt,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      inputCharacters: args.inputCharacters,
      outputCharacters: args.outputCharacters,
      audioDurationSeconds: args.audioDurationSeconds,
      estimatedCostUsd,
      retryCount: args.retryCount ?? trace.retryCount,
      fallbackUsed: args.fallbackUsed ?? trace.fallbackUsed,
      errorCode: args.errorCode,
      errorSummary: args.errorSummary,
      outputTurnIds: args.outputTurnIds ?? trace.outputTurnIds,
      artifactIds: args.artifactIds ?? trace.artifactIds,
      reviewJson: args.reviewJson,
      escalation: args.escalation,
    });
    return args.traceId;
  },
});
