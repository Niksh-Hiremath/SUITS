import { describe, expect, it } from "vitest";

import {
  HearingCommittedPerformanceSchema,
  normalizeRoleSemanticPerformance,
  normalizeWitnessSemanticPerformance,
} from "./performance";

function committedPerformance() {
  return {
    schemaVersion: "hearing-committed-performance.v2" as const,
    kind: "objection_ruling" as const,
    context: "courtroom" as const,
    head: {
      trialId: "trial:performance",
      stateVersion: 12,
      lastEventId: "event:action:resume",
    },
    source: {
      callId: "call:ruling",
      actionId: "action:ruling",
      eventId: "event:action:ruling",
      turnId: null,
      responseId: "response:witness",
      interruptId: "interrupt:objection",
      model: "gpt-5.6-luna" as const,
      outputSchemaVersion: "objection-resolver.ruling.output.v1",
      outputHash: "a".repeat(64),
    },
    actor: {
      actorId: "actor:judge",
      role: "judge" as const,
      side: "neutral" as const,
      witnessId: null,
    },
    evidenceIds: ["evidence:email"],
    semantic: {
      kind: "role" as const,
      activity: "ruling" as const,
      emotion: "neutral" as const,
      intensity: 0.72,
      gazeTarget: "user_counsel" as const,
      gesture: "gavel" as const,
      speakingStyle: "formal" as const,
    },
  };
}

describe("committed hearing performance", () => {
  it("normalizes the witness-only delivery and look-away fields", () => {
    expect(
      normalizeWitnessSemanticPerformance({
        emotion: "nervous",
        intensity: 0.61,
        delivery: "hesitant",
        gesture: "look_away",
        gazeTarget: "questioning_counsel",
      }),
    ).toEqual({
      kind: "witness",
      emotion: "nervous",
      intensity: 0.61,
      delivery: "hesitant",
      gesture: "look_away",
      gazeTarget: "questioning_counsel",
    });
  });

  it("retains only the common strict role allowlist", () => {
    const common = normalizeRoleSemanticPerformance({
      activity: "presenting",
      emotion: "confident",
      intensity: 0.8,
      gazeTarget: "evidence_display",
      gesture: "indicate_evidence",
      speakingStyle: "firm",
    });
    expect(common.kind).toBe("role");
    if (common.kind !== "role") {
      throw new Error("Expected a role semantic cue");
    }
    expect(common.activity).toBe("presenting");
    expect(
      HearingCommittedPerformanceSchema.safeParse({
        ...committedPerformance(),
        kind: "counsel_response",
        actor: {
          actorId: "actor:opposing",
          role: "opposing_counsel",
          side: "opposing",
          witnessId: null,
        },
        source: {
          ...committedPerformance().source,
          turnId: "turn:opposing",
          responseId: null,
          interruptId: null,
        },
        semantic: common,
      }).success,
    ).toBe(true);
  });

  it("accepts an exact head-bound renderer-safe judge ruling", () => {
    expect(HearingCommittedPerformanceSchema.parse(committedPerformance())).toEqual(
      committedPerformance(),
    );
  });

  it("rejects mismatched bindings, private context leaks, and unsafe gestures", () => {
    const base = committedPerformance();
    for (const candidate of [
      {
        ...base,
        source: { ...base.source, eventId: "event:another-action" },
      },
      { ...base, context: "private_settlement" },
      {
        ...base,
        kind: "negotiation_decision",
        context: "private_settlement",
      },
      {
        ...base,
        actor: { ...base.actor, role: "witness", witnessId: "witness:one" },
      },
      {
        ...base,
        evidenceIds: [],
        semantic: {
          ...base.semantic,
          gesture: "indicate_evidence",
        },
      },
      {
        ...base,
        semantic: { ...base.semantic, arbitraryThreeProperty: 999 },
      },
    ]) {
      expect(HearingCommittedPerformanceSchema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });
});
