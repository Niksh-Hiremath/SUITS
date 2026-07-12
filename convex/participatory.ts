"use node";

import OpenAI from "openai";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { runReview } from "../src/domain/review";
import { runCourtDirector } from "../src/domain/court-director";

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["claimant", "respondent", "insufficient_record"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    jurorParts: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { juror: { type: "string" }, persona: { type: "string" }, text: { type: "string" }, turnCitations: { type: "array", items: { type: "string" } } }, required: ["juror", "persona", "text", "turnCitations"] } },
    overallAssessment: { type: "string" },
    strength: { type: "object", additionalProperties: false, properties: { finding: { type: "string" }, turnCitations: { type: "array", items: { type: "string" } } }, required: ["finding", "turnCitations"] },
    missedOpportunity: { type: "object", additionalProperties: false, properties: { finding: { type: "string" }, turnCitations: { type: "array", items: { type: "string" } }, recommendedQuestion: { type: "string" } }, required: ["finding", "turnCitations", "recommendedQuestion"] },
    revisedClosing: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, basedOnTurnIds: { type: "array", items: { type: "string" } } }, required: ["text", "basedOnTurnIds"] },
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

export const start = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const trialId: string = await ctx.runMutation(api.trials.create, { mode: "participatory", side: "respondent" });
    await ctx.runMutation(api.events.track, {
      trialId,
      name: "hearing_started",
      metadataJson: JSON.stringify({ mode: "participatory", caseId: "case_harbor_lantern_v1" }),
    });
    const root = await ctx.runMutation(api.traces.start, { trialId, actor: "Court Director", action: "manage_participatory_hearing", phase: "briefing", provider: "code", model: "deterministic-state-machine.v1", promptVersion: "director.v1" });
    await ctx.runMutation(api.trials.appendTurn, { trialId, speaker: "director", actor: "Court Director", phase: "briefing", text: "You represent Northstar. Test whether Harbor Lantern can prove the generator arrived after the 7:42 PM lighting failure.", source: "authored_fixture", promptVersion: "director.v1" });
    await ctx.runMutation(api.trials.transition, { trialId, requested: "opening", actionId: `${trialId}:briefing` });
    const opening = await ctx.runMutation(api.trials.appendTurn, { trialId, speaker: "opposing_advocate", actor: "Opposing Advocate", phase: "opening", text: "Northstar's generator was due at 6:00 PM. It had not entered when the venue lights failed at 7:42 PM. Harbor Lantern says Northstar failed its delivery obligation.", source: "authored_fixture", factIds: ["F-PUB-002", "F-PUB-003"], evidenceIds: ["E-001", "E-002"], promptVersion: "opposing-advocate.v1" });
    await ctx.runMutation(api.traces.finish, { traceId: root, status: "succeeded", outputTurnIds: [opening] });
    await ctx.runMutation(api.trials.transition, { trialId, requested: "cross_examination", actionId: `${trialId}:opening` });
    return trialId;
  },
});

export const askWitness = action({
  args: { trialId: v.string(), question: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const q = args.question.toLowerCase();
    const decisive = /(gate|security).*(log|record)/.test(q) && /(7[:.]?31|eleven minutes)/.test(q) && /(7[:.]?42|lights|outage)/.test(q);
    const questionId: string = await ctx.runMutation(api.trials.appendTurn, { trialId: args.trialId, speaker: "user_advocate", actor: "Advocate", phase: "cross_examination", text: args.question, source: "typed", evidenceIds: decisive ? ["E-003"] : [], promptVersion: "user.v1" });
    await ctx.runMutation(api.events.track, {
      trialId: args.trialId,
      name: "question_submitted",
      metadataJson: JSON.stringify({ inputMode: "typed", characterCount: args.question.length }),
    });
    const [run, publicCase, privateCase] = await Promise.all([
      ctx.runQuery(api.trials.get, { trialId: args.trialId }),
      ctx.runQuery(api.cases.getGoldenCase, {}),
      ctx.runQuery(internal.cases.getPrivateGoldenCase, {}),
    ]);
    if (!run || !publicCase || !privateCase) throw new Error("Court Director context unavailable");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured in Convex");
    const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
    const openai = new OpenAI({ apiKey });
    const modelCall = async (prompt: string, repair: boolean) => {
      const response = await openai.responses.create({
        model,
        input: `${repair ? "REPAIR: return complete strict JSON only.\n" : ""}${prompt}`,
        text: { format: { type: "json_object" } },
        max_output_tokens: 900,
      }, { timeout: 12_000 });
      return response.output_text;
    };
    const directed = await runCourtDirector({
      context: {
        caseId: run.trial.caseId,
        mode: run.trial.mode,
        side: run.trial.side,
        phase: run.trial.phase,
        allowedActions: run.trial.allowedActions,
        publicCase: {
          summary: publicCase.neutralSummary,
          facts: publicCase.publicFacts.map((fact) => `${fact.factId}: ${fact.text}`),
          evidence: publicCase.publicEvidence.map((item) => `${item.evidenceId}: ${item.summary}`),
        },
        transcript: run.turns.map(({ turnId, actor, phase, text }) => ({ turnId, actor, phase, text })),
      },
      privateWitnessSheet: privateCase.witnessFacts.map((fact) => `${fact.factId}: ${fact.text}`),
      manager: modelCall,
      specialist: modelCall,
      reviewer: modelCall,
      timeoutMs: 12_000,
    });
    const trace = await ctx.runMutation(api.traces.start, {
      trialId: args.trialId, actor: "Court Director", action: "plan_delegate_review", phase: "cross_examination",
      provider: "openai", model, inputTurnIds: [questionId], promptVersion: "director.v2",
      plan: directed.trace.plan, selectedSpecialist: directed.trace.selectedSpecialist, persona: directed.trace.persona,
      contractJson: JSON.stringify(directed.trace.contract), delegationRationale: directed.trace.delegationRationale,
    });
    if (decisive) {
      await ctx.runMutation(api.events.track, {
        trialId: args.trialId,
        name: "contradiction_exposed",
        metadataJson: JSON.stringify({ evidenceId: "E-003", matcherVersion: "contradiction-matcher.v1" }),
      });
    }
    // Preserve the authored contradiction exactly; all other answers use the reviewed specialist output.
    const answer = decisive
      ? "Yes. The Gate B log shows Northstar's truck at 7:31 PM, before the 7:42 PM lighting failure. My earlier statement reflected when I learned it was there."
      : directed.output.text;
    const answerId: string = await ctx.runMutation(api.trials.appendTurn, { trialId: args.trialId, speaker: "witness", actor: "Witness", phase: "cross_examination", text: answer, source: "deterministic_grounded", factIds: decisive ? ["F-WIT-005", "F-WIT-006"] : [], evidenceIds: decisive ? ["E-003"] : [], replyToTurnId: questionId, promptVersion: "witness.v1" });
    await ctx.runMutation(api.traces.finish, {
      traceId: trace, status: directed.status === "accepted" ? "succeeded" : directed.status,
      outputTurnIds: [answerId], retryCount: directed.trace.decisionRetryCount + directed.trace.outputRetryCount,
      fallbackUsed: directed.trace.fallbackUsed, reviewJson: JSON.stringify(directed.trace.review), escalation: directed.trace.escalation,
      errorSummary: directed.trace.fallbackUsed ? "Court Director used deterministic transcript-only fallback after bounded repair." : undefined,
    });
    return answerId;
  },
});

export const finish = action({
  args: { trialId: v.string(), closing: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const existing = await ctx.runQuery(api.trials.get, { trialId: args.trialId });
    if (!existing) throw new Error("Trial not found");
    if (existing.trial.phase === "complete" && existing.debrief) return existing.debrief.debriefId;
    await ctx.runMutation(api.trials.transition, { trialId: args.trialId, requested: "closing", actionId: `${args.trialId}:cross` });
    const closingId: string = await ctx.runMutation(api.trials.appendTurn, { trialId: args.trialId, speaker: "user_advocate", actor: "Advocate", phase: "closing", text: args.closing, source: "typed", promptVersion: "user.v1" });
    await ctx.runMutation(api.events.track, {
      trialId: args.trialId,
      name: "closing_submitted",
      metadataJson: JSON.stringify({ inputMode: "typed", characterCount: args.closing.length }),
    });
    await ctx.runMutation(api.trials.transition, { trialId: args.trialId, requested: "deliberation", actionId: `${args.trialId}:closing` });
    const run = await ctx.runQuery(api.trials.get, { trialId: args.trialId });
    if (!run) throw new Error("Trial not found");
    const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured in Convex");
    const turnIds = run.turns.map((turn) => turn.turnId);
    const contradictionTurns = Array.from(
      new Set(
        run.turns
          .filter((turn) => turn.evidenceIds.includes("E-003"))
          .flatMap((turn) => [turn.replyToTurnId, turn.turnId])
          .filter((turnId): turnId is string => Boolean(turnId)),
      ),
    );
    const rootTrace = run.traces.find((item) => !item.parentId);
    const trace = await ctx.runMutation(api.traces.start, { trialId: args.trialId, parentId: rootTrace?.traceId, actor: "Jury/Review Board", action: "deliberate_and_debrief", phase: "deliberation", provider: "openai", model, inputTurnIds: turnIds, promptVersion: "jury-review.v1" });
    const transcript = run.turns.map((turn) => `${turn.turnId} | ${turn.actor} | ${turn.phase} | ${turn.text}`).join("\n");
    const openai = new OpenAI({ apiKey });
    let inputTokens = 0;
    let outputTokens = 0;
    const result = await runReview({
      turns: run.turns.map(({ turnId, actor, phase, text }) => ({ turnId, actor, phase, text })),
      timeoutMs: 15_000,
      call: async (repair) => {
        const response = await openai.responses.create({
          model,
          input: `${repair ? "REPAIR: Return a complete valid object and cite only IDs below.\n" : ""}You are the Jury/Review Board for a fictional advocacy exercise. Harbor Lantern is claimant and Northstar is respondent. Use only the transcript and cite only exact turn IDs. Return three jurors and a practical coaching debrief. If the transcript proves Northstar was at Gate B before the 7:42 PM outage, distinguish that from missing the 6:00 PM schedule. Verdict respondent means Northstar wins this narrow causation hearing.\n\n${transcript}`,
          text: { format: { type: "json_schema", name: "jury_review", strict: true, schema: reviewSchema } },
          max_output_tokens: 1600,
        }, { timeout: 15_000 });
        inputTokens += response.usage?.input_tokens ?? 0;
        outputTokens += response.usage?.output_tokens ?? 0;
        return response.output_text;
      },
    });
    const review: Review = result.review;
    await ctx.runMutation(api.trials.transition, { trialId: args.trialId, requested: "debrief", actionId: `${args.trialId}:deliberation` });
    const debriefId: string = await ctx.runMutation(api.artifacts.saveReview, { trialId: args.trialId, ...review, contradictionFound: contradictionTurns.length >= 2, contradictionTurnIds: contradictionTurns, model });
    const inputRate = Number(process.env.OPENAI_INPUT_USD_PER_MILLION ?? 0);
    const outputRate = Number(process.env.OPENAI_OUTPUT_USD_PER_MILLION ?? 0);
    await ctx.runMutation(api.traces.finish, { traceId: trace, status: result.status, inputTokens, outputTokens, estimatedCostUsd: (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000, retryCount: result.retryCount, fallbackUsed: result.fallbackUsed, errorCode: result.errorCode, errorSummary: result.fallbackUsed ? "Model review unavailable after one repair attempt; deterministic transcript-only debrief used." : undefined, outputTurnIds: [closingId], artifactIds: [debriefId] });
    await ctx.runMutation(api.trials.transition, { trialId: args.trialId, requested: "complete", actionId: `${args.trialId}:debrief` });
    await ctx.runMutation(api.events.track, {
      trialId: args.trialId,
      name: "hearing_completed",
      metadataJson: JSON.stringify({ debriefId, contradictionFound: contradictionTurns.length >= 2 }),
    });
    return debriefId;
  },
});
