import { v } from "convex/values";

import { mutation } from "./_generated/server";

export const saveReview = mutation({
  args: {
    trialId: v.string(),
    verdict: v.union(v.literal("claimant"), v.literal("respondent"), v.literal("insufficient_record")),
    confidence: v.number(),
    jurorParts: v.array(v.object({ juror: v.string(), persona: v.string(), text: v.string(), turnCitations: v.array(v.string()) })),
    overallAssessment: v.string(),
    strength: v.object({ finding: v.string(), turnCitations: v.array(v.string()) }),
    missedOpportunity: v.object({ finding: v.string(), turnCitations: v.array(v.string()), recommendedQuestion: v.string() }),
    contradictionFound: v.boolean(),
    contradictionTurnIds: v.array(v.string()),
    revisedClosing: v.object({ text: v.string(), basedOnTurnIds: v.array(v.string()) }),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const debriefId = `debrief_${crypto.randomUUID()}`;
    const existing = await ctx.db.query("debriefs").withIndex("by_trial", (q) => q.eq("trialId", args.trialId)).unique();
    if (existing) await ctx.db.delete(existing._id);

    for (let index = 0; index < args.jurorParts.length; index += 1) {
      const part = args.jurorParts[index];
      await ctx.db.insert("juryVotes", {
        voteId: `vote_${crypto.randomUUID()}`,
        trialId: args.trialId,
        juror: part.juror,
        persona: part.persona,
        vote: args.verdict,
        confidence: args.confidence,
        reasoning: part.text,
        turnCitations: part.turnCitations,
        evidenceIds: args.contradictionFound ? ["E-005"] : [],
        schemaVersion: "juryVote.v1",
        promptVersion: "jury-review.v1",
        caseVersion: 1,
        model: args.model,
        createdAt: Date.now(),
      });
    }

    await ctx.db.insert("debriefs", {
      debriefId,
      trialId: args.trialId,
      status: "valid",
      overallAssessment: args.overallAssessment,
      strengths: [args.strength],
      missedOpportunities: [args.missedOpportunity],
      contradictions: [{
        description: "Whether Vertex added a complaint-related rationale after receiving Asha's safety report.",
        status: args.contradictionFound ? "found" : "missed",
        turnCitations: args.contradictionTurnIds,
        evidenceIds: args.contradictionFound ? ["E-005"] : [],
      }],
      evidenceUsed: args.contradictionFound ? [{ evidenceId: "E-005", turnCitations: args.contradictionTurnIds }] : [],
      evidenceMissed: args.contradictionFound ? [] : [{ evidenceId: "E-005", reason: "The post-complaint revision was not confronted in cross-examination." }],
      jurorMovement: args.jurorParts.map((part) => ({
        juror: part.juror,
        direction: args.verdict === "respondent" ? "toward_respondent" : "toward_claimant",
        reason: part.text,
        turnCitations: part.turnCitations,
      })),
      revisedClosing: args.revisedClosing,
      limitations: ["Assessment is limited to this fictional transcript and is not legal advice."],
      schemaVersion: "debrief.v1",
      promptVersion: "jury-review.v1",
      caseVersion: 1,
      model: args.model,
      createdAt: Date.now(),
    });
    return debriefId;
  },
});
