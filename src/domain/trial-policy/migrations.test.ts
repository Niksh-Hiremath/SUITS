import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import {
  createTrialPolicySnapshotV1,
  migrateTrialPolicySnapshotV1ToV2,
  TrialPolicyMigrationError,
  TrialPolicySnapshotV1Schema,
  type TrialPolicyActorBindingInput,
} from "./index";

function actorBindings(): TrialPolicyActorBindingInput[] {
  return [
    {
      actor: {
        actorId: "actor_system",
        role: "system",
        side: "neutral",
        witnessId: null,
      },
      representedPartyIds: [],
    },
    {
      actor: {
        actorId: "actor_judge",
        role: "judge",
        side: "neutral",
        witnessId: null,
      },
      representedPartyIds: [],
    },
    {
      actor: {
        actorId: "actor_jury",
        role: "jury",
        side: "neutral",
        witnessId: null,
      },
      representedPartyIds: [],
    },
    {
      actor: {
        actorId: "actor_user_counsel",
        role: "user_counsel",
        side: "user",
        witnessId: null,
      },
      representedPartyIds: ["party_rina_shah"],
    },
    {
      actor: {
        actorId: "actor_opposing_counsel",
        role: "opposing_counsel",
        side: "opposing",
        witnessId: null,
      },
      representedPartyIds: ["party_redwood_signal"],
    },
    {
      actor: {
        actorId: "actor_witness_rina",
        role: "witness",
        side: "user",
        witnessId: "witness_rina_shah",
      },
      representedPartyIds: [],
    },
    {
      actor: {
        actorId: "actor_witness_theo",
        role: "witness",
        side: "opposing",
        witnessId: "witness_theo_morgan",
      },
      representedPartyIds: [],
    },
    {
      actor: {
        actorId: "actor_witness_maya",
        role: "witness",
        side: "neutral",
        witnessId: "witness_maya_ortiz",
      },
      representedPartyIds: [],
    },
  ];
}

function expectMigrationError(
  operation: () => unknown,
  code: TrialPolicyMigrationError["code"],
): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TrialPolicyMigrationError);
    expect((error as TrialPolicyMigrationError).code).toBe(code);
  }
}

describe("trial policy v1 to v2 migration", () => {
  it("enriches from trusted context deterministically without mutating v1", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const bindings = actorBindings();
    const policyV1 = createTrialPolicySnapshotV1({
      graph,
      actorBindings: bindings,
    });
    const before = JSON.stringify(policyV1);
    const context = {
      graph,
      actorBindings: bindings,
      expectedCaseGraphHash: graph.compilerMetadata.sourceContentHash,
      expectedCaseGraphJson: JSON.stringify(graph),
    };

    const first = migrateTrialPolicySnapshotV1ToV2(policyV1, context);
    const second = migrateTrialPolicySnapshotV1ToV2(policyV1, context);

    expect(JSON.stringify(policyV1)).toBe(before);
    expect(TrialPolicySnapshotV1Schema.parse(policyV1)).toEqual(policyV1);
    expect(first.schemaVersion).toBe("trial-policy-snapshot.v2");
    expect(first.witnessKnowledge).toHaveLength(graph.witnesses.length);
    expect(
      first.evidencePermissions.find(
        (rule) => rule.evidenceId === "evidence_complaint_email",
      )?.relatedFactIds,
    ).toEqual(["fact_complaint_sent"]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("fails closed when the pinned graph hash does not match", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const bindings = actorBindings();
    const policyV1 = createTrialPolicySnapshotV1({
      graph,
      actorBindings: bindings,
    });

    expectMigrationError(
      () =>
        migrateTrialPolicySnapshotV1ToV2(policyV1, {
          graph,
          actorBindings: bindings,
          expectedCaseGraphHash: "0".repeat(64),
          expectedCaseGraphJson: JSON.stringify(graph),
        }),
      "CASE_GRAPH_HASH_MISMATCH",
    );
  });

  it("fails closed on valid-schema v1 policy or actor-context drift", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const bindings = actorBindings();
    const policyV1 = createTrialPolicySnapshotV1({
      graph,
      actorBindings: bindings,
    });
    const tamperedPolicy = structuredClone(policyV1);
    tamperedPolicy.witnessCallability[0].recallPermitted = false;
    expect(TrialPolicySnapshotV1Schema.safeParse(tamperedPolicy).success).toBe(
      true,
    );

    const context = {
      graph,
      actorBindings: bindings,
      expectedCaseGraphHash: graph.compilerMetadata.sourceContentHash,
      expectedCaseGraphJson: JSON.stringify(graph),
    };
    expectMigrationError(
      () => migrateTrialPolicySnapshotV1ToV2(tamperedPolicy, context),
      "V1_POLICY_CONTEXT_MISMATCH",
    );

    const changedBindings = structuredClone(bindings);
    const system = changedBindings.find(
      (binding) => binding.actor.actorId === "actor_system",
    );
    if (!system) throw new Error("Missing system fixture binding");
    system.actor.actorId = "actor_system_changed";
    expectMigrationError(
      () =>
        migrateTrialPolicySnapshotV1ToV2(policyV1, {
          ...context,
          actorBindings: changedBindings,
        }),
      "V1_POLICY_CONTEXT_MISMATCH",
    );
  });

  it("rejects private graph drift even when the source hash and v1 projection still match", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const immutableGraphJson = JSON.stringify(graph);
    const bindings = actorBindings();
    const policyV1 = createTrialPolicySnapshotV1({
      graph,
      actorBindings: bindings,
    });
    const changedGraph = structuredClone(graph);
    const complaint = changedGraph.evidence.find(
      (evidence) => evidence.evidenceId === "evidence_complaint_email",
    );
    if (!complaint) throw new Error("Missing complaint evidence fixture");
    complaint.relatedFactIds.push("fact_manager_accessed_complaint");

    expectMigrationError(
      () =>
        migrateTrialPolicySnapshotV1ToV2(policyV1, {
          graph: changedGraph,
          actorBindings: bindings,
          expectedCaseGraphHash: graph.compilerMetadata.sourceContentHash,
          expectedCaseGraphJson: immutableGraphJson,
        }),
      "CASE_GRAPH_CONTENT_MISMATCH",
    );
  });
});
