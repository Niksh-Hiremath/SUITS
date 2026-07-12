import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

const artifactStatus = v.union(
  v.literal("pending"),
  v.literal("valid"),
  v.literal("fallback"),
  v.literal("failed"),
);

export default defineSchema({
  cases: defineTable({
    caseId: v.string(),
    slug: v.string(),
    title: v.string(),
    version: v.number(),
    status: v.union(v.literal("active"), v.literal("archived")),
    disclaimer: v.string(),
    neutralSummary: v.string(),
    publicFacts: v.array(v.object({ factId: v.string(), text: v.string() })),
    publicEvidence: v.array(
      v.object({ evidenceId: v.string(), name: v.string(), summary: v.string() }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_case_id", ["caseId"]),

  privateCases: defineTable({
    caseId: v.string(),
    witnessFacts: v.array(v.object({ factId: v.string(), text: v.string() })),
    hiddenEvidence: v.array(
      v.object({
        evidenceId: v.string(),
        name: v.string(),
        content: v.string(),
      }),
    ),
    canonicalAssessment: v.array(v.string()),
    decisiveAnswer: v.string(),
    unsupportedAnswer: v.string(),
    version: v.number(),
  }).index("by_case_id", ["caseId"]),

  trials: defineTable({
    trialId: v.string(),
    caseId: v.string(),
    caseVersion: v.number(),
    mode: v.union(v.literal("participatory"), v.literal("autonomous")),
    side: v.union(v.literal("claimant"), v.literal("respondent")),
    phase,
    status: v.union(
      v.literal("active"),
      v.literal("waiting_for_user"),
      v.literal("running_actor"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    allowedActions: v.array(v.string()),
    phaseSequence: v.number(),
    stateVersion: v.number(),
    lastCommittedActionId: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_trial_id", ["trialId"])
    .index("by_status", ["status"]),

  turns: defineTable({
    turnId: v.string(),
    trialId: v.string(),
    sequence: v.number(),
    speaker: v.string(),
    actor: v.string(),
    phase,
    text: v.string(),
    source: v.string(),
    audioUrl: v.optional(v.string()),
    inputMode: v.optional(v.union(v.literal("typed"), v.literal("stt"))),
    factIds: v.array(v.string()),
    evidenceIds: v.array(v.string()),
    replyToTurnId: v.optional(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_trial", ["trialId"])
    .index("by_trial_sequence", ["trialId", "sequence"]),

  traces: defineTable({
    traceId: v.string(),
    trialId: v.string(),
    parentId: v.optional(v.string()),
    actor: v.string(),
    action: v.string(),
    phase,
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("repaired"),
      v.literal("fallback"),
      v.literal("interrupted"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    retryCount: v.number(),
    fallbackUsed: v.boolean(),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    inputTurnIds: v.array(v.string()),
    outputTurnIds: v.array(v.string()),
    artifactIds: v.array(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
  })
    .index("by_trace_id", ["traceId"])
    .index("by_trial", ["trialId"])
    .index("by_trial_started", ["trialId", "startedAt"]),

  juryVotes: defineTable({
    voteId: v.string(),
    trialId: v.string(),
    juror: v.string(),
    persona: v.string(),
    vote: v.union(
      v.literal("claimant"),
      v.literal("respondent"),
      v.literal("insufficient_record"),
    ),
    confidence: v.number(),
    reasoning: v.string(),
    turnCitations: v.array(v.string()),
    evidenceIds: v.array(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
    caseVersion: v.number(),
    model: v.string(),
    createdAt: v.number(),
  }).index("by_trial", ["trialId"]),

  debriefs: defineTable({
    debriefId: v.string(),
    trialId: v.string(),
    status: artifactStatus,
    overallAssessment: v.string(),
    strengths: v.array(
      v.object({ finding: v.string(), turnCitations: v.array(v.string()) }),
    ),
    missedOpportunities: v.array(
      v.object({
        finding: v.string(),
        turnCitations: v.array(v.string()),
        recommendedQuestion: v.string(),
      }),
    ),
    contradictions: v.array(
      v.object({
        description: v.string(),
        status: v.union(v.literal("found"), v.literal("missed")),
        turnCitations: v.array(v.string()),
        evidenceIds: v.array(v.string()),
      }),
    ),
    evidenceUsed: v.array(
      v.object({ evidenceId: v.string(), turnCitations: v.array(v.string()) }),
    ),
    evidenceMissed: v.array(
      v.object({ evidenceId: v.string(), reason: v.string() }),
    ),
    jurorMovement: v.array(
      v.object({
        juror: v.string(),
        direction: v.string(),
        reason: v.string(),
        turnCitations: v.array(v.string()),
      }),
    ),
    revisedClosing: v.object({
      text: v.string(),
      basedOnTurnIds: v.array(v.string()),
    }),
    limitations: v.array(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
    caseVersion: v.number(),
    model: v.string(),
    createdAt: v.number(),
  }).index("by_trial", ["trialId"]),

  evalRuns: defineTable({
    evalId: v.string(),
    trialId: v.string(),
    caseId: v.string(),
    scenarioId: v.string(),
    status: v.union(v.literal("passed"), v.literal("failed")),
    assertions: v.array(
      v.object({ name: v.string(), passed: v.boolean(), evidenceJson: v.string() }),
    ),
    passedCount: v.number(),
    totalCount: v.number(),
    score: v.number(),
    failureReason: v.optional(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
    caseVersion: v.number(),
    model: v.string(),
    createdAt: v.number(),
    completedAt: v.number(),
  }).index("by_trial", ["trialId"]),
});
