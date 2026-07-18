import { describe, expect, it } from "vitest";

import { listSeededCaseGraphs } from "../seeded-cases";
import {
  createStartTrialAction,
  TrialActionV3Schema,
} from "../trial-engine";
import { deriveTrialActorBindings } from "./actors";

describe("runtime actor derivation", () => {
  it.each(listSeededCaseGraphs().map((graph) => [graph.caseId, graph] as const))(
    "derives a deterministic complete roster for %s",
    (_caseId, graph) => {
      const first = deriveTrialActorBindings(graph);
      const second = deriveTrialActorBindings(graph);
      expect(second).toEqual(first);
      expect(first.map((binding) => binding.actor.actorId)).toEqual(
        [...first.map((binding) => binding.actor.actorId)].sort(),
      );
      expect(first.filter((binding) => binding.actor.role === "witness")).toHaveLength(
        graph.witnesses.length,
      );
      for (const party of graph.parties.filter(
        (candidate) => candidate.simulationSide !== "neutral",
      )) {
        expect(first).toContainEqual(
          expect.objectContaining({ representedPartyIds: [party.partyId] }),
        );
      }

      expect(
        TrialActionV3Schema.parse(
          createStartTrialAction({
            trialId: `trial:${graph.caseId}`,
            actionId: `action:start:${graph.caseId}`,
            requestedAt: "2026-07-19T00:00:00.000Z",
            graph,
            actors: first.map((binding) => binding.actor),
            actorBindings: first,
          }),
        ).type,
      ).toBe("START_TRIAL");
    },
  );

  it("keeps each counsel binding scoped to one represented party", () => {
    const graph = listSeededCaseGraphs()[0];
    const counsel = deriveTrialActorBindings(graph).filter((binding) =>
      ["user_counsel", "opposing_counsel"].includes(binding.actor.role),
    );
    expect(counsel.every((binding) => binding.representedPartyIds.length === 1)).toBe(true);
    expect(new Set(counsel.flatMap((binding) => binding.representedPartyIds))).toEqual(
      new Set(
        graph.parties
          .filter((party) => party.simulationSide !== "neutral")
          .map((party) => party.partyId),
      ),
    );
  });
});
