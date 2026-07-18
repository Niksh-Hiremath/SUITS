import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import { buildKnowledgeView } from "../knowledge";
import {
  commitAction,
  createStartTrialAction,
  type TrialStateV3,
} from "../trial-engine";
import { deriveTrialActorBindings } from "./actors";
import { createDeterministicWitnessAnswer } from "./mock-role-adapter";

function witnessView(witnessId: string) {
  const graph = createThreeWitnessCaseGraphV1Fixture();
  const bindings = deriveTrialActorBindings(graph);
  const start = createStartTrialAction({
    trialId: "trial:mock-witness-answer",
    actionId: "action:mock-witness-answer:start",
    requestedAt: "2026-07-19T00:00:00.000Z",
    graph,
    actors: bindings.map((binding) => binding.actor),
    actorBindings: bindings,
  });
  const state = commitAction(null, start).state as TrialStateV3;
  const actor = bindings.find(
    (binding) => binding.actor.witnessId === witnessId,
  )?.actor;
  if (!actor) throw new Error("Missing fixture witness actor");
  const view = buildKnowledgeView({ trial: state, caseGraph: graph }, actor.actorId);
  if (view.actorRole !== "witness") throw new Error("Expected witness view");
  return view;
}

describe("deterministic witness mock adapter", () => {
  it("selects only a relevant fact inside the witness KnowledgeView", () => {
    const view = witnessView("witness_rina_shah");
    const answer = createDeterministicWitnessAnswer(
      view,
      "When did you send the battery safety complaint?",
      [],
    );
    expect(answer.factIds).toHaveLength(1);
    expect(view.witness.facts.map((fact) => fact.factId)).toContain(
      answer.factIds[0],
    );
    expect(answer.text).toContain(
      view.witness.facts.find((fact) => fact.factId === answer.factIds[0])
        ?.proposition,
    );
  });

  it("does not borrow a fact from another witness", () => {
    const rina = witnessView("witness_rina_shah");
    const theo = witnessView("witness_theo_morgan");
    const theoOnly = theo.witness.facts.find(
      (fact) => !rina.witness.facts.some((candidate) => candidate.factId === fact.factId),
    );
    if (!theoOnly) throw new Error("Fixture requires isolated witness facts");
    const answer = createDeterministicWitnessAnswer(rina, theoOnly.proposition, []);
    expect(answer.factIds).not.toContain(theoOnly.factId);
  });

  it("cannot cite evidence that was not presented in the bounded view", () => {
    const view = witnessView("witness_rina_shah");
    const answer = createDeterministicWitnessAnswer(
      view,
      "Can you identify this exhibit?",
      ["evidence_not_presented"],
    );
    expect(answer.evidenceIds).toEqual([]);
  });
});
