import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

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

type Phase = "briefing" | "opening" | "cross_examination" | "closing" | "deliberation" | "debrief" | "complete" | "failed";

const nextPhase: Partial<Record<Phase, Phase>> = {
  briefing: "opening",
  opening: "cross_examination",
  cross_examination: "closing",
  closing: "deliberation",
  deliberation: "debrief",
  debrief: "complete",
};

const actions: Record<Phase, string[]> = {
  briefing: ["present_briefing", "acknowledge_briefing", "resume"],
  opening: ["request_opening", "accept_opening", "use_default_opening", "resume"],
  cross_examination: ["submit_question", "answer_question", "repeat_or_clarify", "end_cross", "resume"],
  closing: ["submit_closing", "use_default_closing", "accept_closing", "resume"],
  deliberation: ["request_deliberation", "accept_deliberation", "use_fallback_deliberation", "resume"],
  debrief: ["request_debrief", "accept_debrief", "repair_citations", "use_fallback_debrief", "resume"],
  complete: ["view_transcript", "view_debrief", "download_debrief"],
  failed: ["view_failure", "restart_trial"],
};

function stableId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export const create = mutation({
  args: {
    mode: v.union(v.literal("participatory"), v.literal("autonomous")),
    side: v.optional(v.union(v.literal("claimant"), v.literal("respondent"))),
  },
  handler: async (ctx, args) => {
    const trialId = stableId("trial");
    const now = Date.now();
    await ctx.db.insert("trials", {
      trialId,
      caseId: "case_harbor_lantern_v1",
      caseVersion: 1,
      mode: args.mode,
      side: args.side ?? "respondent",
      phase: "briefing",
      status: "active",
      allowedActions: actions.briefing,
      phaseSequence: 0,
      stateVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    return trialId;
  },
});

export const appendTurn = mutation({
  args: {
    trialId: v.string(),
    speaker: v.string(),
    actor: v.string(),
    phase,
    text: v.string(),
    source: v.string(),
    factIds: v.optional(v.array(v.string())),
    evidenceIds: v.optional(v.array(v.string())),
    replyToTurnId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trial = await ctx.db.query("trials").withIndex("by_trial_id", (q) => q.eq("trialId", args.trialId)).unique();
    if (!trial) throw new Error("Trial not found");
    if (trial.phase !== args.phase) throw new Error(`Turn phase mismatch: ${args.phase} != ${trial.phase}`);
    if (!args.text.trim()) throw new Error("Turn text cannot be empty");

    const previous = await ctx.db.query("turns").withIndex("by_trial_sequence", (q) => q.eq("trialId", args.trialId)).order("desc").first();
    const turnId = stableId("turn");
    await ctx.db.insert("turns", {
      turnId,
      trialId: args.trialId,
      sequence: (previous?.sequence ?? 0) + 1,
      speaker: args.speaker,
      actor: args.actor,
      phase: args.phase,
      text: args.text.trim(),
      source: args.source,
      factIds: args.factIds ?? [],
      evidenceIds: args.evidenceIds ?? [],
      replyToTurnId: args.replyToTurnId,
      schemaVersion: "turn.v1",
      promptVersion: args.promptVersion ?? "authored.v1",
      createdAt: Date.now(),
    });
    return turnId;
  },
});

export const transition = mutation({
  args: { trialId: v.string(), requested: phase, actionId: v.string() },
  handler: async (ctx, args) => {
    const trial = await ctx.db.query("trials").withIndex("by_trial_id", (q) => q.eq("trialId", args.trialId)).unique();
    if (!trial) throw new Error("Trial not found");
    if (trial.lastCommittedActionId === args.actionId) return trial.phase;
    if (nextPhase[trial.phase] !== args.requested) throw new Error(`Illegal phase transition: ${trial.phase} -> ${args.requested}`);

    const now = Date.now();
    await ctx.db.patch(trial._id, {
      phase: args.requested,
      status: args.requested === "complete" ? "complete" : "active",
      allowedActions: actions[args.requested],
      phaseSequence: trial.phaseSequence + 1,
      stateVersion: trial.stateVersion + 1,
      lastCommittedActionId: args.actionId,
      updatedAt: now,
      completedAt: args.requested === "complete" ? now : undefined,
    });
    return args.requested;
  },
});

export const get = query({
  args: { trialId: v.string() },
  handler: async (ctx, args) => {
    const trial = await ctx.db.query("trials").withIndex("by_trial_id", (q) => q.eq("trialId", args.trialId)).unique();
    if (!trial) return null;
    const turns = await ctx.db.query("turns").withIndex("by_trial_sequence", (q) => q.eq("trialId", args.trialId)).collect();
    const traces = await ctx.db.query("traces").withIndex("by_trial_started", (q) => q.eq("trialId", args.trialId)).collect();
    const debrief = await ctx.db.query("debriefs").withIndex("by_trial", (q) => q.eq("trialId", args.trialId)).unique();
    const votes = await ctx.db.query("juryVotes").withIndex("by_trial", (q) => q.eq("trialId", args.trialId)).collect();
    return { trial, turns, traces, debrief, votes };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("trials").order("desc").take(50),
});
