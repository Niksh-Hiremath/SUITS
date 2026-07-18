import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { buildKnowledgeView, type KnowledgeStateProjection } from "./build";
import { OpposingCounselKnowledgeViewV2Schema } from "./schema";

export const OPPONENT_PLANNER_KNOWLEDGE_VIEW_SCHEMA_VERSION =
  "knowledge-view.opponent-planner.v1" as const;

const UniqueIdListSchema = z
  .array(CaseGraphEntityIdSchema)
  .max(128)
  .superRefine((identifiers, context) => {
    const seen = new Set<string>();
    identifiers.forEach((identifier, index) => {
      if (seen.has(identifier)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Planning identifiers must be unique",
        });
      }
      seen.add(identifier);
    });
  });

export const OpponentPlannerWitnessViewSchema = z
  .object({
    witnessId: CaseGraphEntityIdSchema,
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["fact", "expert", "character"]),
    role: z.string().trim().min(1).max(500),
    alignedWithCounsel: z.boolean(),
    callableByCounsel: z.boolean(),
    permittedKnownFactIds: UniqueIdListSchema,
    permittedSeenEvidenceIds: UniqueIdListSchema,
  })
  .strict();

export const OpponentPlannerKnowledgeViewSchema =
  OpposingCounselKnowledgeViewV2Schema.omit({ schemaVersion: true })
    .extend({
      schemaVersion: z.literal(
        OPPONENT_PLANNER_KNOWLEDGE_VIEW_SCHEMA_VERSION,
      ),
      planning: z
        .object({
          witnesses: z.array(OpponentPlannerWitnessViewSchema).max(64),
          permittedObjectionGrounds: z.array(
            z.enum([
              "relevance",
              "hearsay",
              "leading",
              "speculation",
              "foundation",
              "asked_and_answered",
              "argumentative",
              "compound",
              "privilege",
            ]),
          ),
        })
        .strict(),
    })
    .strict();

export type OpponentPlannerKnowledgeView = z.infer<
  typeof OpponentPlannerKnowledgeViewSchema
>;

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * Builds the private planning view for the canonical AI-controlled opposing
 * counsel. Witness biographies remain deliberately narrow: the planner sees
 * public identity plus links to material already present in that counsel's
 * permitted case view, never authored summaries, unknown facts, or statement
 * text from a witness-only boundary.
 */
export function buildOpponentPlannerKnowledgeView(
  state: KnowledgeStateProjection,
  actorId: string,
): OpponentPlannerKnowledgeView {
  const base = buildKnowledgeView(state, actorId);
  if (base.actorRole !== "opposing_counsel") {
    throw new Error(
      `Opponent planning requires opposing counsel, received ${base.actorRole}`,
    );
  }

  const permittedFactIds = new Set([
    ...base.counsel.facts.map((fact) => fact.factId),
    ...base.publicRecord.facts.map((fact) => fact.factId),
  ]);
  const permittedEvidenceIds = new Set([
    ...base.counsel.evidence.map((evidence) => evidence.evidenceId),
    ...base.publicRecord.evidence.map((evidence) => evidence.evidenceId),
  ]);

  return OpponentPlannerKnowledgeViewSchema.parse({
    ...base,
    schemaVersion: OPPONENT_PLANNER_KNOWLEDGE_VIEW_SCHEMA_VERSION,
    planning: {
      witnesses: [...state.caseGraph.witnesses]
        .sort((left, right) => left.witnessId.localeCompare(right.witnessId))
        .map((witness) => ({
          witnessId: witness.witnessId,
          name: witness.name,
          kind: witness.kind,
          role: witness.role,
          alignedWithCounsel:
            witness.alignedPartyId === base.counsel.partyId,
          callableByCounsel: witness.callableByPartyIds.includes(
            base.counsel.partyId,
          ),
          permittedKnownFactIds: stableUnique(
            witness.knowledgeBoundary.knownFactIds.filter((factId) =>
              permittedFactIds.has(factId),
            ),
          ),
          permittedSeenEvidenceIds: stableUnique(
            witness.knowledgeBoundary.seenEvidenceIds.filter((evidenceId) =>
              permittedEvidenceIds.has(evidenceId),
            ),
          ),
        })),
      permittedObjectionGrounds: [
        ...state.caseGraph.jurisdictionProfile.permittedObjectionGrounds,
      ],
    },
  });
}
