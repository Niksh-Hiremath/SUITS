import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

const eventName = v.union(
  v.literal("hearing_started"),
  v.literal("question_submitted"),
  v.literal("contradiction_exposed"),
  v.literal("closing_submitted"),
  v.literal("hearing_completed"),
  v.literal("debrief_downloaded"),
);

export const track = internalMutation({
  args: {
    trialId: v.optional(v.string()),
    name: eventName,
    source: v.optional(v.union(v.literal("product"), v.literal("evaluation"))),
    metadataJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const eventId = `event_${crypto.randomUUID()}`;
    await ctx.db.insert("productEvents", {
      eventId,
      trialId: args.trialId,
      name: args.name,
      source: args.source ?? "product",
      metadataJson: args.metadataJson ?? "{}",
      createdAt: Date.now(),
    });
    return eventId;
  },
});

export const summary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("productEvents").order("desc").take(1000);
    const counts = Object.fromEntries(
      ["hearing_started", "question_submitted", "contradiction_exposed", "closing_submitted", "hearing_completed", "debrief_downloaded"].map((name) => [
        name,
        events.filter((event) => event.name === name).length,
      ]),
    );
    return { counts, recent: events.slice(0, 20) };
  },
});
