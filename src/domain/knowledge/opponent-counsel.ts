import { z } from "zod";

import { buildKnowledgeView, type KnowledgeStateProjection } from "./build";
import { OpposingCounselKnowledgeViewV2Schema } from "./schema";

export const OPPONENT_COUNSEL_PUBLIC_KNOWLEDGE_VIEW_SCHEMA_VERSION =
  "knowledge-view.opponent-counsel-public.v1" as const;

/**
 * Open-court counsel dialogue receives permitted case material and the public
 * record, but never private strategy memory, settlement authority, priorities,
 * or offers. A separate server-selected directive supplies the immediate goal.
 */
export const OpponentCounselPublicKnowledgeViewSchema =
  OpposingCounselKnowledgeViewV2Schema.omit({ schemaVersion: true })
    .extend({
      schemaVersion: z.literal(
        OPPONENT_COUNSEL_PUBLIC_KNOWLEDGE_VIEW_SCHEMA_VERSION,
      ),
      counsel: OpposingCounselKnowledgeViewV2Schema.shape.counsel.extend({
        strategyMemory: z.tuple([]),
        privateSettlement: z.null(),
      }),
    })
    .strict();

export type OpponentCounselPublicKnowledgeView = z.infer<
  typeof OpponentCounselPublicKnowledgeViewSchema
>;

export function buildOpponentCounselPublicKnowledgeView(
  state: KnowledgeStateProjection,
  actorId: string,
): OpponentCounselPublicKnowledgeView {
  const base = buildKnowledgeView(state, actorId);
  if (base.actorRole !== "opposing_counsel") {
    throw new Error(
      `Opponent counsel response requires opposing counsel, received ${base.actorRole}`,
    );
  }
  return OpponentCounselPublicKnowledgeViewSchema.parse({
    ...base,
    schemaVersion: OPPONENT_COUNSEL_PUBLIC_KNOWLEDGE_VIEW_SCHEMA_VERSION,
    counsel: {
      ...base.counsel,
      strategyMemory: [],
      privateSettlement: null,
    },
  });
}
