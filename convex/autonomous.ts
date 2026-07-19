"use node";

import OpenAI from "openai";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const decisiveQuestion =
  "Ms. Sen, the Gate B log records Northstar's truck at 7:31 PM, eleven minutes before the lights failed at 7:42, correct?";
const decisiveAnswer =
  "Yes. The Gate B log shows Northstar's truck at 7:31 PM, before the 7:42 PM lighting failure. My earlier statement reflected when I learned it was there.";
const closing =
  "Northstar was late against the schedule, but Harbor Lantern has not proved it arrived after the outage. Its own log places the truck there beforehand, blocked at Harbor Lantern's gate.";

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["claimant", "respondent", "insufficient_record"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    jurorParts: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          juror: { type: "string" },
          persona: { type: "string" },
          text: { type: "string" },
          turnCitations: { type: "array", items: { type: "string" } },
        },
        required: ["juror", "persona", "text", "turnCitations"],
      },
    },
    overallAssessment: { type: "string" },
    strength: {
      type: "object",
      additionalProperties: false,
      properties: { finding: { type: "string" }, turnCitations: { type: "array", items: { type: "string" } } },
      required: ["finding", "turnCitations"],
    },
    missedOpportunity: {
      type: "object",
      additionalProperties: false,
      properties: {
        finding: { type: "string" },
        turnCitations: { type: "array", items: { type: "string" } },
        recommendedQuestion: { type: "string" },
      },
      required: ["finding", "turnCitations", "recommendedQuestion"],
    },
    revisedClosing: {
      type: "object",
      additionalProperties: false,
      properties: { text: { type: "string" }, basedOnTurnIds: { type: "array", items: { type: "string" } } },
      required: ["text", "basedOnTurnIds"],
    },
  },
  required: ["verdict", "confidence", "jurorParts", "overallAssessment", "strength", "missedOpportunity", "revisedClosing"],
} as const;

type Review = {
  verdict: "claimant" | "respondent" | "insufficient_record";
  confidence: number;
  jurorParts: Array<{ juror: string; persona: string; text: string; turnCitations: string[] }>;
  overallAssessment: string;
  strength: { finding: string; turnCitations: string[] };
  missedOpportunity: { finding: string; turnCitations: string[]; recommendedQuestion: string };
  revisedClosing: { text: string; basedOnTurnIds: string[] };
};

export const runGolden = internalAction({
  args: {
    mode: v.optional(v.union(v.literal("autonomous"), v.literal("participatory"))),
    promptVersion: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ trialId: string; debriefId: string; evalId: string; passed: boolean }> => {
    const model = process.env.OPENAI_DEEP_MODEL ?? "gpt-5.6-terra";
    if (model !== "gpt-5.6-terra") {
      throw new Error("OPENAI_DEEP_MODEL must be gpt-5.6-terra");
    }
    const promptVersion = args.promptVersion ?? "jury-review.v1";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured in Convex");

    const trialId: string = await ctx.runMutation(internal.trials.create, { mode: "autonomous", side: "respondent" });
    const directorTrace = await ctx.runMutation(internal.traces.start, {
      trialId,
      actor: "Court Director",
      action: "run_hearing",
      phase: "briefing",
      provider: "code",
      model: "deterministic-state-machine.v1",
      promptVersion: "director.v1",
    });

    const briefingId = await ctx.runMutation(internal.trials.appendTurn, {
      trialId, speaker: "director", actor: "Court Director", phase: "briefing",
      text: "Court is in session for a fictional educational hearing. Northstar may test Harbor Lantern's account through one focused cross-examination.",
      source: "authored_fixture", promptVersion: "director.v1",
    });
    await ctx.runMutation(internal.trials.transition, { trialId, requested: "opening", actionId: `${trialId}:briefing` });

    const openingTrace = await ctx.runMutation(internal.traces.start, {
      trialId, parentId: directorTrace, actor: "Opposing Advocate", action: "deliver_opening", phase: "opening",
      provider: "authored", model: "deterministic-fallback.v1", promptVersion: "opposing-advocate.v1",
    });
    const openingId = await ctx.runMutation(internal.trials.appendTurn, {
      trialId, speaker: "opposing_advocate", actor: "Opposing Advocate", phase: "opening",
      text: "Northstar's generator was due at six. Harbor Lantern's lights later failed, and the generator had not entered the venue. The record will show Northstar missed the agreed delivery plan.",
      source: "authored_fixture", factIds: ["F-PUB-002", "F-PUB-003"], evidenceIds: ["E-001", "E-002"], promptVersion: "opposing-advocate.v1",
    });
    await ctx.runMutation(internal.traces.finish, { traceId: openingTrace, status: "succeeded", outputTurnIds: [openingId] });
    await ctx.runMutation(internal.trials.transition, { trialId, requested: "cross_examination", actionId: `${trialId}:opening` });

    const questionId: string = await ctx.runMutation(internal.trials.appendTurn, {
      trialId, speaker: "autonomous_advocate", actor: "Autonomous Advocate", phase: "cross_examination",
      text: decisiveQuestion, source: "authored_fixture", evidenceIds: ["E-003"], promptVersion: "autonomous-advocate.v1",
    });
    const witnessTrace = await ctx.runMutation(internal.traces.start, {
      trialId, parentId: directorTrace, actor: "Witness", action: "answer_question", phase: "cross_examination",
      provider: "deterministic", model: "contradiction-matcher.v1", inputTurnIds: [questionId], promptVersion: "witness.v1",
    });
    const answerId: string = await ctx.runMutation(internal.trials.appendTurn, {
      trialId, speaker: "witness", actor: "Witness", phase: "cross_examination",
      text: decisiveAnswer, source: "deterministic_fallback", factIds: ["F-WIT-005", "F-WIT-006"], evidenceIds: ["E-003"], replyToTurnId: questionId, promptVersion: "witness.v1",
    });
    await ctx.runMutation(internal.traces.finish, { traceId: witnessTrace, status: "succeeded", outputTurnIds: [answerId] });
    await ctx.runMutation(internal.trials.transition, { trialId, requested: "closing", actionId: `${trialId}:cross` });

    const closingId = await ctx.runMutation(internal.trials.appendTurn, {
      trialId, speaker: "autonomous_advocate", actor: "Autonomous Advocate", phase: "closing",
      text: closing, source: "authored_fixture", factIds: ["F-PUB-002", "F-PUB-003"], evidenceIds: ["E-003"], promptVersion: "autonomous-advocate.v1",
    });
    await ctx.runMutation(internal.trials.transition, { trialId, requested: "deliberation", actionId: `${trialId}:closing` });

    const reviewTrace = await ctx.runMutation(internal.traces.start, {
      trialId, parentId: directorTrace, actor: "Jury/Review Board", action: "deliberate_and_debrief", phase: "deliberation",
      provider: "openai", model, inputTurnIds: [briefingId, openingId, questionId, answerId, closingId], promptVersion,
    });

    const transcript = [
      [briefingId, "Director", "briefing", "Court is in session for a fictional educational hearing."],
      [openingId, "Opposing Advocate", "opening", "Northstar missed the agreed delivery plan."],
      [questionId, "Advocate", "cross_examination", decisiveQuestion],
      [answerId, "Witness", "cross_examination", decisiveAnswer],
      [closingId, "Advocate", "closing", closing],
    ].map(([id, speaker, phase, text]) => `${id} | ${speaker} | ${phase} | ${text}`).join("\n");

    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model,
      input: `You are the Jury/Review Board for a fictional advocacy exercise. Harbor Lantern is the claimant. Northstar is the respondent. Use only this transcript. Every performance claim must cite real turn IDs. Return three concise juror parts and a useful debrief. Distinguish missing the 6:00 PM deadline from arriving before the 7:42 PM outage. For this narrow hearing, if Harbor Lantern fails to prove that Northstar arrived after the outage and the transcript establishes pre-outage presence, the verdict must be \"respondent\" even if Northstar missed the earlier contractual schedule. Never call Northstar the claimant.\n\nTRANSCRIPT\n${transcript}`,
      text: { format: { type: "json_schema", name: "jury_review", strict: true, schema: reviewSchema } },
      max_output_tokens: 1600,
    });
    const review = JSON.parse(response.output_text) as Review;
    const validTurnIds = new Set([briefingId, openingId, questionId, answerId, closingId]);
    const cited = [
      ...review.jurorParts.flatMap((part) => part.turnCitations),
      ...review.strength.turnCitations,
      ...review.missedOpportunity.turnCitations,
      ...review.revisedClosing.basedOnTurnIds,
    ];
    if (cited.some((turnId) => !validTurnIds.has(turnId))) {
      throw new Error("Jury/Review Board returned an unknown transcript citation");
    }

    await ctx.runMutation(internal.trials.transition, { trialId, requested: "debrief", actionId: `${trialId}:deliberation` });
    const debriefId: string = await ctx.runMutation(internal.artifacts.saveReview, {
      trialId,
      ...review,
      contradictionFound: true,
      contradictionTurnIds: [questionId, answerId],
      model,
    });
    await ctx.runMutation(internal.traces.finish, {
      traceId: reviewTrace,
      status: "succeeded",
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      artifactIds: [debriefId],
    });
    await ctx.runMutation(internal.trials.transition, { trialId, requested: "complete", actionId: `${trialId}:debrief` });
    await ctx.runMutation(internal.traces.finish, {
      traceId: directorTrace,
      status: "succeeded",
      outputTurnIds: [briefingId, openingId, questionId, answerId, closingId],
      artifactIds: [debriefId],
    });
    const evaluated = await ctx.runMutation(internal.evals.evaluateAndPersist, {
      trialId,
      promptVersion,
      model,
    });
    return { trialId, debriefId, evalId: evaluated.evalId, passed: evaluated.status === "passed" };
  },
});

export const runGate3 = internalAction({
  args: { runs: v.optional(v.number()), promptVersion: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ passed: number; total: number; gatePassed: boolean; results: Array<{ trialId: string; evalId: string; passed: boolean }> }> => {
    const total = Math.max(1, Math.min(20, Math.floor(args.runs ?? 5)));
    const results = [];
    for (let index = 0; index < total; index += 1) {
      results.push(await ctx.runAction(internal.autonomous.runGolden, {
        mode: "autonomous",
        promptVersion: args.promptVersion ?? "jury-review.v1",
      }));
    }
    const passed = results.filter((result) => result.passed).length;
    return { passed, total, gatePassed: total === 5 && passed >= 4, results };
  },
});
