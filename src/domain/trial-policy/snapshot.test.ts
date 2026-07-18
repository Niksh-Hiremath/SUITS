import { describe, expect, it } from "vitest";

import {
  createThreeWitnessCaseGraphV1Fixture,
  type CaseGraphV1,
} from "../case-graph";
import type { ActorRef } from "../trial-engine/schemas";
import {
  actorSideForPolicy,
  buildJudgeTrialPolicyView,
  buildJuryTrialPolicyView,
  canActorAuthenticateEvidence,
  canActorAuthorizeSettlement,
  canActorCallWitness,
  canActorCounterSettlement,
  canActorOfferEvidence,
  canActorProposeSettlement,
  canActorRaiseObjection,
  canActorRecallWitness,
  createTrialPolicySnapshot,
  getSettlementAuthorityForActor,
  isObjectionGroundPermitted,
  isSettlementOfferExpired,
  isSettlementOpenInPhase,
  JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION,
  JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION,
  parseTrialPolicySnapshot,
  partySideForPolicy,
  settlementExpirySequence,
  TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION,
  TrialPolicyConfigurationError,
  TrialPolicySnapshotSchema,
  type TrialPolicyActorBindingInput,
  type TrialPolicySnapshot,
} from "./index";

const ACTORS = {
  system: {
    actorId: "actor_system",
    role: "system",
    side: "neutral",
    witnessId: null,
  },
  judge: {
    actorId: "actor_judge",
    role: "judge",
    side: "neutral",
    witnessId: null,
  },
  jury: {
    actorId: "actor_jury",
    role: "jury",
    side: "neutral",
    witnessId: null,
  },
  userCounsel: {
    actorId: "actor_user_counsel",
    role: "user_counsel",
    side: "user",
    witnessId: null,
  },
  opposingCounsel: {
    actorId: "actor_opposing_counsel",
    role: "opposing_counsel",
    side: "opposing",
    witnessId: null,
  },
  rina: {
    actorId: "actor_witness_rina",
    role: "witness",
    side: "user",
    witnessId: "witness_rina_shah",
  },
  theo: {
    actorId: "actor_witness_theo",
    role: "witness",
    side: "opposing",
    witnessId: "witness_theo_morgan",
  },
  maya: {
    actorId: "actor_witness_maya",
    role: "witness",
    side: "neutral",
    witnessId: "witness_maya_ortiz",
  },
} as const satisfies Record<string, ActorRef>;

function createActorBindings(): TrialPolicyActorBindingInput[] {
  return [
    { actor: ACTORS.system, representedPartyIds: [] },
    { actor: ACTORS.judge, representedPartyIds: [] },
    { actor: ACTORS.jury, representedPartyIds: [] },
    {
      actor: ACTORS.userCounsel,
      representedPartyIds: ["party_rina_shah"],
    },
    {
      actor: ACTORS.opposingCounsel,
      representedPartyIds: ["party_redwood_signal"],
    },
    { actor: ACTORS.rina, representedPartyIds: [] },
    { actor: ACTORS.theo, representedPartyIds: [] },
    { actor: ACTORS.maya, representedPartyIds: [] },
  ];
}

function createSnapshot(
  graph: CaseGraphV1 = createThreeWitnessCaseGraphV1Fixture(),
  actorBindings: TrialPolicyActorBindingInput[] = createActorBindings(),
): TrialPolicySnapshot {
  return createTrialPolicySnapshot({ graph, actorBindings });
}

function replaceBinding(
  bindings: TrialPolicyActorBindingInput[],
  actorId: string,
  replacement: TrialPolicyActorBindingInput,
): void {
  const index = bindings.findIndex(
    (binding) => binding.actor.actorId === actorId,
  );
  if (index === -1) throw new Error(`Missing test actor ${actorId}`);
  bindings[index] = replacement;
}

function expectPolicyError(
  operation: () => unknown,
  code: TrialPolicyConfigurationError["code"],
): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TrialPolicyConfigurationError);
    expect((error as TrialPolicyConfigurationError).code).toBe(code);
  }
}

describe("TrialPolicySnapshot derivation", () => {
  it("derives the versioned snapshot deterministically from set-like graph and mapping inputs", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const reorderedGraph = structuredClone(graph);
    reorderedGraph.parties.reverse();
    reorderedGraph.witnesses.reverse();
    reorderedGraph.evidence.reverse();
    reorderedGraph.settlement.participants.reverse();
    reorderedGraph.jurisdictionProfile.permittedObjectionGrounds.reverse();

    const first = createSnapshot(graph, createActorBindings());
    const second = createSnapshot(
      reorderedGraph,
      createActorBindings().reverse(),
    );

    expect(first.schemaVersion).toBe(TRIAL_POLICY_SNAPSHOT_SCHEMA_VERSION);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(parseTrialPolicySnapshot(first)).toEqual(first);
    expect(TrialPolicySnapshotSchema.safeParse(first).success).toBe(true);
  });

  it("materializes canonical actor, side, and party mappings", () => {
    const snapshot = createSnapshot();

    expect(actorSideForPolicy(snapshot, ACTORS.userCounsel.actorId)).toBe(
      "user",
    );
    expect(actorSideForPolicy(snapshot, "actor_missing")).toBeNull();
    expect(partySideForPolicy(snapshot, "party_rina_shah")).toBe("user");
    expect(partySideForPolicy(snapshot, "party_missing")).toBeNull();
    expect(
      snapshot.mappings.parties.find(
        (binding) => binding.partyId === "party_redwood_signal",
      ),
    ).toEqual({
      partyId: "party_redwood_signal",
      side: "opposing",
      representativeActorIds: [ACTORS.opposingCounsel.actorId],
    });
    expect(
      snapshot.mappings.sides.find((binding) => binding.side === "neutral"),
    ).toEqual({
      side: "neutral",
      partyIds: [],
      actorIds: [
        ACTORS.judge.actorId,
        ACTORS.jury.actorId,
        ACTORS.system.actorId,
        ACTORS.maya.actorId,
      ].sort(),
      counselActorIds: [],
    });
  });

  it("rejects duplicate actors and duplicate witness bindings", () => {
    const duplicateActor = createActorBindings();
    duplicateActor.push({ actor: ACTORS.system, representedPartyIds: [] });
    expectPolicyError(
      () => createSnapshot(createThreeWitnessCaseGraphV1Fixture(), duplicateActor),
      "DUPLICATE_ACTOR",
    );

    const duplicateWitness = createActorBindings();
    duplicateWitness.push({
      actor: {
        ...ACTORS.rina,
        actorId: "actor_witness_rina_duplicate",
      },
      representedPartyIds: [],
    });
    expectPolicyError(
      () =>
        createSnapshot(
          createThreeWitnessCaseGraphV1Fixture(),
          duplicateWitness,
        ),
      "DUPLICATE_WITNESS_ACTOR",
    );
  });

  it("rejects role/side mismatches and unauthorized party representation", () => {
    const wrongRoleSide = createActorBindings();
    replaceBinding(wrongRoleSide, ACTORS.userCounsel.actorId, {
      actor: { ...ACTORS.userCounsel, side: "opposing" },
      representedPartyIds: ["party_redwood_signal"],
    });
    expectPolicyError(
      () =>
        createSnapshot(
          createThreeWitnessCaseGraphV1Fixture(),
          wrongRoleSide,
        ),
      "ROLE_SIDE_MISMATCH",
    );

    const crossSideRepresentation = createActorBindings();
    replaceBinding(
      crossSideRepresentation,
      ACTORS.userCounsel.actorId,
      {
        actor: ACTORS.userCounsel,
        representedPartyIds: ["party_redwood_signal"],
      },
    );
    expectPolicyError(
      () =>
        createSnapshot(
          createThreeWitnessCaseGraphV1Fixture(),
          crossSideRepresentation,
        ),
      "INVALID_PARTY_REPRESENTATION",
    );

    const judgeRepresentsParty = createActorBindings();
    replaceBinding(judgeRepresentsParty, ACTORS.judge.actorId, {
      actor: ACTORS.judge,
      representedPartyIds: ["party_rina_shah"],
    });
    expectPolicyError(
      () =>
        createSnapshot(
          createThreeWitnessCaseGraphV1Fixture(),
          judgeRepresentsParty,
        ),
      "INVALID_PARTY_REPRESENTATION",
    );
  });

  it("requires counsel for each adversarial party and one actor for every witness", () => {
    const noUserCounsel = createActorBindings().filter(
      (binding) => binding.actor.actorId !== ACTORS.userCounsel.actorId,
    );
    expectPolicyError(
      () =>
        createSnapshot(
          createThreeWitnessCaseGraphV1Fixture(),
          noUserCounsel,
        ),
      "MISSING_PARTY_COUNSEL",
    );

    const noMaya = createActorBindings().filter(
      (binding) => binding.actor.actorId !== ACTORS.maya.actorId,
    );
    expectPolicyError(
      () => createSnapshot(createThreeWitnessCaseGraphV1Fixture(), noMaya),
      "MISSING_WITNESS_ACTOR",
    );
  });
});

describe("witness, evidence, and objection policy", () => {
  it("derives witness call and recall permissions through represented parties", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const rina = graph.witnesses.find(
      (witness) => witness.witnessId === "witness_rina_shah",
    );
    if (!rina) throw new Error("Missing fixture witness");
    rina.callableByPartyIds = ["party_rina_shah"];
    const snapshot = createSnapshot(graph);

    expect(
      canActorCallWitness(
        snapshot,
        ACTORS.userCounsel.actorId,
        rina.witnessId,
      ),
    ).toBe(true);
    expect(
      canActorRecallWitness(
        snapshot,
        ACTORS.userCounsel.actorId,
        rina.witnessId,
      ),
    ).toBe(true);
    expect(
      canActorCallWitness(
        snapshot,
        ACTORS.opposingCounsel.actorId,
        rina.witnessId,
      ),
    ).toBe(false);
    expect(
      canActorCallWitness(snapshot, ACTORS.judge.actorId, rina.witnessId),
    ).toBe(false);
    expect(
      canActorCallWitness(
        snapshot,
        ACTORS.userCounsel.actorId,
        "witness_missing",
      ),
    ).toBe(false);
  });

  it("separates evidence offer permission from witness authentication permission", () => {
    const snapshot = createSnapshot();
    const evidenceId = "evidence_complaint_email";
    const rule = snapshot.evidencePermissions.find(
      (candidate) => candidate.evidenceId === evidenceId,
    );

    expect(rule).toEqual({
      evidenceId,
      offerableByPartyIds: ["party_rina_shah"],
      offerableBySides: ["user"],
      offerableByActorIds: [ACTORS.userCounsel.actorId],
      custodianWitnessIds: ["witness_rina_shah"],
      authenticatingWitnessIds: ["witness_rina_shah"],
      authenticatingActorIds: [ACTORS.rina.actorId],
    });
    expect(
      canActorOfferEvidence(
        snapshot,
        ACTORS.userCounsel.actorId,
        evidenceId,
      ),
    ).toBe(true);
    expect(
      canActorOfferEvidence(
        snapshot,
        ACTORS.opposingCounsel.actorId,
        evidenceId,
      ),
    ).toBe(false);
    expect(
      canActorAuthenticateEvidence(snapshot, ACTORS.rina.actorId, evidenceId),
    ).toBe(true);
    expect(
      canActorAuthenticateEvidence(snapshot, ACTORS.theo.actorId, evidenceId),
    ).toBe(false);
    expect(
      canActorAuthenticateEvidence(
        snapshot,
        ACTORS.rina.actorId,
        "evidence_missing",
      ),
    ).toBe(false);
  });

  it("permits only configured objection grounds raised by counsel", () => {
    const snapshot = createSnapshot();

    expect(isObjectionGroundPermitted(snapshot, "hearsay")).toBe(true);
    expect(isObjectionGroundPermitted(snapshot, "unsupported_ground")).toBe(
      false,
    );
    expect(
      canActorRaiseObjection(
        snapshot,
        ACTORS.opposingCounsel.actorId,
        "foundation",
      ),
    ).toBe(true);
    expect(
      canActorRaiseObjection(snapshot, ACTORS.judge.actorId, "foundation"),
    ).toBe(false);
    expect(
      canActorRaiseObjection(
        snapshot,
        ACTORS.userCounsel.actorId,
        "unsupported_ground",
      ),
    ).toBe(false);
  });
});

describe("settlement policy and confidentiality", () => {
  it("opens settlement only at and after the configured phase", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    graph.settlement.opensAtPhase = "case_in_chief";
    const snapshot = createSnapshot(graph);

    expect(snapshot.settlement.openPhases).toEqual([
      "case_in_chief",
      "recess",
      "pre_closing",
    ]);
    expect(isSettlementOpenInPhase(snapshot, "pretrial")).toBe(false);
    expect(isSettlementOpenInPhase(snapshot, "opening")).toBe(false);
    expect(isSettlementOpenInPhase(snapshot, "case_in_chief")).toBe(true);
    expect(isSettlementOpenInPhase(snapshot, "recess")).toBe(true);
    expect(isSettlementOpenInPhase(snapshot, "pre_closing")).toBe(true);
    expect(isSettlementOpenInPhase(snapshot, "closing")).toBe(false);
    expect(
      canActorProposeSettlement(
        snapshot,
        ACTORS.userCounsel.actorId,
        "case_in_chief",
      ),
    ).toBe(true);
    expect(
      canActorProposeSettlement(
        snapshot,
        ACTORS.judge.actorId,
        "case_in_chief",
      ),
    ).toBe(false);
  });

  it("enforces disabled settlement and counteroffer switches", () => {
    const disabledGraph = createThreeWitnessCaseGraphV1Fixture();
    disabledGraph.settlement.enabled = false;
    const disabled = createSnapshot(disabledGraph);
    expect(disabled.settlement.openPhases).toEqual([]);
    expect(isSettlementOpenInPhase(disabled, "pretrial")).toBe(false);
    expect(
      canActorProposeSettlement(
        disabled,
        ACTORS.userCounsel.actorId,
        "pretrial",
      ),
    ).toBe(false);

    const noCountersGraph = createThreeWitnessCaseGraphV1Fixture();
    noCountersGraph.settlement.allowCounteroffers = false;
    const noCounters = createSnapshot(noCountersGraph);
    expect(
      canActorProposeSettlement(
        noCounters,
        ACTORS.opposingCounsel.actorId,
        "pretrial",
      ),
    ).toBe(true);
    expect(
      canActorCounterSettlement(
        noCounters,
        ACTORS.opposingCounsel.actorId,
        "pretrial",
      ),
    ).toBe(false);
  });

  it("calculates settlement expiry at the exact configured event boundary", () => {
    const snapshot = createSnapshot();
    const expiresAt = settlementExpirySequence(snapshot, 20);

    expect(expiresAt).toBe(32);
    expect(isSettlementOfferExpired(expiresAt, 31)).toBe(false);
    expect(isSettlementOfferExpired(expiresAt, 32)).toBe(true);
    expect(isSettlementOfferExpired(expiresAt, 33)).toBe(true);
    expect(() => settlementExpirySequence(snapshot, -1)).toThrow(RangeError);
    expect(() =>
      settlementExpirySequence(snapshot, Number.MAX_SAFE_INTEGER),
    ).toThrow(RangeError);
    expect(() => isSettlementOfferExpired(0, 0)).toThrow(RangeError);
  });

  it("allows counsel to inspect and authorize only its represented party rules", () => {
    const snapshot = createSnapshot();
    const ownAuthority = getSettlementAuthorityForActor(
      snapshot,
      ACTORS.userCounsel.actorId,
      "party_rina_shah",
    );

    expect(ownAuthority).toMatchObject({
      partyId: "party_rina_shah",
      minimumAuthority: 40_000,
      maximumAuthority: 150_000,
      reservationValue: 60_000,
      targetValue: 110_000,
    });
    expect(
      getSettlementAuthorityForActor(
        snapshot,
        ACTORS.userCounsel.actorId,
        "party_redwood_signal",
      ),
    ).toBeNull();
    expect(
      getSettlementAuthorityForActor(
        snapshot,
        ACTORS.judge.actorId,
        "party_rina_shah",
      ),
    ).toBeNull();

    expect(
      canActorAuthorizeSettlement(snapshot, ACTORS.userCounsel.actorId, {
        partyId: "party_rina_shah",
        amount: 60_000,
        nonMonetaryTerms: ["Neutral reference", "Written safety review"],
      }),
    ).toBe(true);
    expect(
      canActorAuthorizeSettlement(snapshot, ACTORS.userCounsel.actorId, {
        partyId: "party_rina_shah",
        amount: 39_999,
        nonMonetaryTerms: [],
      }),
    ).toBe(false);
    expect(
      canActorAuthorizeSettlement(snapshot, ACTORS.userCounsel.actorId, {
        partyId: "party_rina_shah",
        amount: 60_000,
        nonMonetaryTerms: ["Public admission"],
      }),
    ).toBe(false);
    expect(
      canActorAuthorizeSettlement(snapshot, ACTORS.opposingCounsel.actorId, {
        partyId: "party_rina_shah",
        amount: 60_000,
        nonMonetaryTerms: [],
      }),
    ).toBe(false);
  });

  it("redacts all authority values from judge and jury policy helpers", () => {
    const snapshot = createSnapshot();
    const judgeView = buildJudgeTrialPolicyView(snapshot);
    const juryView = buildJuryTrialPolicyView(snapshot);
    const judgeJson = JSON.stringify(judgeView);
    const juryJson = JSON.stringify(juryView);
    const confidentialKeys = [
      "partyAuthorities",
      "minimumAuthority",
      "maximumAuthority",
      "reservationValue",
      "targetValue",
      "confidentialPriorities",
      "permittedNonMonetaryTerms",
    ];

    expect(judgeView.schemaVersion).toBe(
      JUDGE_TRIAL_POLICY_VIEW_SCHEMA_VERSION,
    );
    expect(juryView.schemaVersion).toBe(JURY_TRIAL_POLICY_VIEW_SCHEMA_VERSION);
    for (const key of confidentialKeys) {
      expect(judgeJson).not.toContain(`"${key}"`);
      expect(juryJson).not.toContain(`"${key}"`);
    }
    expect(judgeJson).not.toContain("A neutral reference");
    expect(judgeJson).not.toContain("No admission of liability");
    expect(juryJson).not.toContain('"settlement"');
    expect(Object.keys(judgeView.settlement)).toEqual([
      "enabled",
      "currency",
      "opensAtPhase",
      "openPhases",
      "allowCounteroffers",
      "expiresAfterEventCount",
      "participantPartyIds",
    ]);
  });
});
