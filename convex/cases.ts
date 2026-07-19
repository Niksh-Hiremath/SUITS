import { internalMutation, internalQuery } from "./_generated/server";

const CASE_ID = "case_asha_vertex_v1";

export const seedGoldenCase = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("cases")
      .withIndex("by_case_id", (q) => q.eq("caseId", CASE_ID))
      .unique();
    if (existing) return { caseId: CASE_ID, created: false };

    const now = Date.now();
    await ctx.db.insert("cases", {
      caseId: CASE_ID,
      slug: "asha-mehta-v-vertex-logistics",
      title: "Asha Mehta v. Vertex Logistics Ltd.",
      version: 1,
      status: "active",
      disclaimer: "Fictional educational exercise; not legal advice.",
      neutralSummary:
        "Asha Mehta says Vertex fired her for reporting a warehouse safety problem. Vertex says documented performance issues and a pre-complaint termination draft show the decision was already underway.",
      publicFacts: [
        { factId: "F-PUB-001", text: "Asha sent a warehouse safety complaint at 10:14 AM on May 14." },
        { factId: "F-PUB-002", text: "Vertex approved her termination at 9:20 AM on May 15." },
        { factId: "F-PUB-003", text: "Two inventory reports were submitted late during the preceding month." },
        { factId: "F-PUB-004", text: "HR created an initial termination memorandum on May 7." },
        { factId: "F-PUB-005", text: "The final letter cited performance failures and disruptive escalation." },
        { factId: "F-PUB-006", text: "Elena Kapoor was Vertex's HR Director." },
      ],
      publicEvidence: [
        { evidenceId: "E-001", name: "Safety complaint email", summary: "Asha reported a disabled loading-bay safety interlock at 10:14 AM on May 14." },
        { evidenceId: "E-002", name: "Termination letter", summary: "Approved at 9:20 AM on May 15; cites performance failures and disruptive escalation." },
        { evidenceId: "E-003", name: "Inventory report history", summary: "Two reports were submitted late during the preceding month." },
        { evidenceId: "E-004", name: "Draft termination memorandum", summary: "Document metadata shows an initial HR draft on May 7." },
        { evidenceId: "E-005", name: "Revision history", summary: "Disruptive escalation was added at 4:38 PM on May 14, after the complaint." },
        { evidenceId: "E-006", name: "Personnel file", summary: "No formal written warning or active performance-improvement plan appears before termination." },
      ],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("privateCases", {
      caseId: CASE_ID,
      witnessFacts: [
        { factId: "F-WIT-001", text: "Elena received Asha's complaint at 10:14 AM on May 14." },
        { factId: "F-WIT-002", text: "HR created a draft termination memorandum on May 7, but it was not finally approved." },
        { factId: "F-WIT-003", text: "Disruptive escalation was added at 4:38 PM on May 14." },
        { factId: "F-WIT-004", text: "That phrase referred to Asha's safety escalation." },
        { factId: "F-WIT-005", text: "Asha's file contained no formal warning or active performance plan." },
        { factId: "F-WIT-006", text: "Two late inventory reports were documented." },
        { factId: "F-WIT-007", text: "Final termination approval occurred at 9:20 AM on May 15." },
      ],
      hiddenEvidence: [
        { evidenceId: "E-004", name: "Draft metadata", content: "Initial termination memorandum created May 7; not finally approved." },
        { evidenceId: "E-005", name: "Revision history", content: "4:38 PM May 14 — added 'disruptive escalation' after complaint receipt." },
        { evidenceId: "E-006", name: "Personnel file", content: "No formal warning or active performance-improvement plan before termination." },
      ],
      canonicalAssessment: [
        "The May 7 draft supports Vertex's pre-existing performance explanation.",
        "The post-complaint revision supports Asha's retaliation theory.",
        "The verdict should depend on which causal theory the transcript establishes.",
      ],
      decisiveAnswer:
        "Yes. 'Disruptive escalation' was added at 4:38 PM after HR received Asha's safety complaint, and it referred to that escalation.",
      unsupportedAnswer:
        "I can't confirm that from what I observed or the records in this case.",
      version: 1,
    });

    return { caseId: CASE_ID, created: true };
  },
});

export const getGoldenCase = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("cases")
      .withIndex("by_case_id", (q) => q.eq("caseId", CASE_ID))
      .unique();
  },
});

export const getPrivateGoldenCase = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("privateCases")
      .withIndex("by_case_id", (q) => q.eq("caseId", CASE_ID))
      .unique();
  },
});
