import { v } from "convex/values";

import { evaluateGoldenRun, summarizePromptVersions } from "../src/evals/formal-evals";
import { mutation, query } from "./_generated/server";

export const evaluateAndPersist = mutation({
  args: {
    trialId: v.string(),
    scenarioId: v.optional(v.string()),
    promptVersion: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const trial = await ctx.db.query("trials").withIndex("by_trial_id", (q) => q.eq("trialId", args.trialId)).unique();
    if (!trial) throw new Error("Trial not found");
    const [turns, traces, votes, debrief, publicCase, privateCase] = await Promise.all([
      ctx.db.query("turns").withIndex("by_trial_sequence", (q) => q.eq("trialId", args.trialId)).collect(),
      ctx.db.query("traces").withIndex("by_trial_started", (q) => q.eq("trialId", args.trialId)).collect(),
      ctx.db.query("juryVotes").withIndex("by_trial", (q) => q.eq("trialId", args.trialId)).collect(),
      ctx.db.query("debriefs").withIndex("by_trial", (q) => q.eq("trialId", args.trialId)).unique(),
      ctx.db.query("cases").withIndex("by_case_id", (q) => q.eq("caseId", trial.caseId)).unique(),
      ctx.db.query("privateCases").withIndex("by_case_id", (q) => q.eq("caseId", trial.caseId)).unique(),
    ]);
    const result = evaluateGoldenRun({
      trial,
      turns,
      traces,
      votes,
      debrief,
      allowedFactIds: [...(publicCase?.publicFacts.map((fact) => fact.factId) ?? []), ...(privateCase?.witnessFacts.map((fact) => fact.factId) ?? [])],
      allowedEvidenceIds: [...(publicCase?.publicEvidence.map((item) => item.evidenceId) ?? []), ...(privateCase?.hiddenEvidence.map((item) => item.evidenceId) ?? [])],
    });
    const now = Date.now();
    const evalId = `eval_${crypto.randomUUID()}`;
    await ctx.db.insert("evalRuns", {
      evalId,
      trialId: args.trialId,
      caseId: trial.caseId,
      scenarioId: args.scenarioId ?? "golden-autonomous-v1",
      ...result,
      schemaVersion: "eval-run.v1",
      promptVersion: args.promptVersion,
      caseVersion: trial.caseVersion,
      model: args.model,
      createdAt: now,
      completedAt: now,
    });
    return { evalId, ...result };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("evalRuns").order("desc").take(100),
});

export const comparison = query({
  args: {},
  handler: async (ctx) => summarizePromptVersions(await ctx.db.query("evalRuns").order("desc").take(100)),
});
