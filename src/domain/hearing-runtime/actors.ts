import {
  CaseGraphV1Schema,
  type CaseGraphV1,
} from "../case-graph";
import type { TrialPolicyActorBindingInput } from "../trial-policy";
import type { ActorRef } from "../trial-engine";

const FIXED_NEUTRAL_ACTORS = [
  { actorId: "actor:clerk", role: "clerk" },
  { actorId: "actor:debrief", role: "debrief_coach" },
  { actorId: "actor:judge", role: "judge" },
  { actorId: "actor:jury", role: "jury" },
  { actorId: "actor:system", role: "system" },
] as const;

function compareActorBindings(
  left: TrialPolicyActorBindingInput,
  right: TrialPolicyActorBindingInput,
): number {
  return left.actor.actorId.localeCompare(right.actor.actorId);
}

function neutralActor(
  input: (typeof FIXED_NEUTRAL_ACTORS)[number],
): TrialPolicyActorBindingInput {
  return {
    actor: {
      actorId: input.actorId,
      role: input.role,
      side: "neutral",
      witnessId: null,
    },
    representedPartyIds: [],
  };
}

function counselActor(
  party: CaseGraphV1["parties"][number],
): TrialPolicyActorBindingInput | null {
  if (party.simulationSide === "neutral") return null;
  return {
    actor: {
      actorId: `actor:counsel:${party.partyId}`,
      role:
        party.simulationSide === "user"
          ? "user_counsel"
          : "opposing_counsel",
      side: party.simulationSide,
      witnessId: null,
    },
    representedPartyIds: [party.partyId],
  };
}

function witnessActor(
  graph: CaseGraphV1,
  witness: CaseGraphV1["witnesses"][number],
): TrialPolicyActorBindingInput {
  const side = witness.alignedPartyId
    ? graph.parties.find((party) => party.partyId === witness.alignedPartyId)
        ?.simulationSide ?? "neutral"
    : "neutral";
  return {
    actor: {
      actorId: `actor:witness:${witness.witnessId}`,
      role: "witness",
      side,
      witnessId: witness.witnessId,
    },
    representedPartyIds: [],
  };
}

/**
 * Builds the canonical runtime roster exclusively from the immutable CaseGraph.
 * A counsel actor represents one party so settlement authority never becomes
 * ambiguous when a future uploaded case contains multiple parties per side.
 */
export function deriveTrialActorBindings(
  graphInput: CaseGraphV1,
): TrialPolicyActorBindingInput[] {
  const graph = CaseGraphV1Schema.parse(graphInput);
  const bindings = [
    ...FIXED_NEUTRAL_ACTORS.map(neutralActor),
    ...graph.parties.flatMap((party) => {
      const binding = counselActor(party);
      return binding ? [binding] : [];
    }),
    ...graph.witnesses.map((witness) => witnessActor(graph, witness)),
  ].sort(compareActorBindings);

  const actorIds = bindings.map((binding) => binding.actor.actorId);
  if (new Set(actorIds).size !== actorIds.length) {
    throw new Error("CASE_GRAPH_ACTOR_ID_CONFLICT");
  }
  return bindings;
}

export function actorFromBindings(
  bindings: readonly TrialPolicyActorBindingInput[],
  predicate: (actor: ActorRef) => boolean,
  errorCode: string,
): ActorRef {
  const matches = bindings
    .map((binding) => binding.actor)
    .filter(predicate)
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  if (matches.length !== 1) throw new Error(errorCode);
  return matches[0];
}
