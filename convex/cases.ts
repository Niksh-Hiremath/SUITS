import { internalQuery, mutation, query } from "./_generated/server";

const CASE_ID = "case_harbor_lantern_v1";

export const seedGoldenCase = mutation({
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
      slug: "harbor-lantern-v-northstar",
      title: "Harbor Lantern Events v. Northstar Rentals",
      version: 1,
      status: "active",
      disclaimer: "Fictional educational exercise; not legal advice.",
      neutralSummary:
        "Harbor Lantern says Northstar's backup generator arrived after a 7:42 PM lighting failure. Northstar says its truck reached Gate B earlier but could not enter because the lane was blocked.",
      publicFacts: [
        { factId: "F-PUB-001", text: "Harbor Lantern contracted with Northstar for one backup generator." },
        { factId: "F-PUB-002", text: "The written schedule stated delivery by 6:00 PM at Service Gate B." },
        { factId: "F-PUB-003", text: "The gala's lighting interruption began at 7:42 PM." },
        { factId: "F-PUB-004", text: "Harbor Lantern alleges delivery occurred at 8:05 PM." },
        { factId: "F-PUB-005", text: "Northstar disputes that allegation and says Gate B was blocked." },
        { factId: "F-PUB-006", text: "Mira Sen coordinated Harbor Lantern's vendors." },
      ],
      publicEvidence: [
        { evidenceId: "E-001", name: "Delivery schedule", summary: "Generator due at Gate B by 6:00 PM." },
        { evidenceId: "E-002", name: "Lighting incident log", summary: "Lighting interruption began at 7:42 PM." },
      ],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("privateCases", {
      caseId: CASE_ID,
      witnessFacts: [
        { factId: "F-WIT-001", text: "Mira was responsible for ensuring Gate B was clear." },
        { factId: "F-WIT-002", text: "Mira did not personally see the truck arrive." },
        { factId: "F-WIT-003", text: "Mira learned of the truck from a later radio call." },
        { factId: "F-WIT-004", text: "Mira reviewed the gate log the following morning." },
        { factId: "F-WIT-005", text: "The log records Northstar at 7:31 PM and entry held because the lane was obstructed." },
        { factId: "F-WIT-006", text: "Mira's broad statement reflected when she learned of the truck, not personal observation." },
        { factId: "F-WIT-007", text: "A Harbor Lantern décor van obstructed the lane." },
      ],
      hiddenEvidence: [
        { evidenceId: "E-003", name: "Gate B security log", content: "7:31 PM — Northstar generator truck at Gate B; entry held—lane obstructed." },
        { evidenceId: "E-004", name: "Vendor radio note", content: "At 7:46 PM Mira received notice that Northstar was waiting at Gate B." },
        { evidenceId: "E-005", name: "Décor vehicle movement note", content: "Harbor Lantern's décor van cleared Gate B at 7:58 PM." },
      ],
      canonicalAssessment: [
        "Northstar missed the contractual 6:00 PM delivery time.",
        "The record does not support first arrival after the 7:42 PM interruption.",
        "Harbor Lantern's obstruction contributed to delayed entry.",
      ],
      decisiveAnswer:
        "Yes. The Gate B log shows Northstar's truck at 7:31 PM, before the 7:42 PM lighting failure. My earlier statement reflected when I learned it was there.",
      unsupportedAnswer:
        "I can't confirm that from what I observed or the records in this case.",
      version: 1,
    });

    return { caseId: CASE_ID, created: true };
  },
});

export const getGoldenCase = query({
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
