import { describe, expect, it } from "vitest";

import {
  CourtroomAnimationSchema,
  CourtroomAudibleSemanticPerformanceSchema,
  CourtroomPresentationFrameSchema,
  CourtroomPresentationRuntimeSnapshotSchema,
  CourtroomPresentationRuntimeStateSchema,
  selectCourtroomPresentationRuntime,
  type CourtroomAnimation,
  type CourtroomDisplayDescriptor,
  type SceneActorKey,
} from "@/domain/courtroom-presentation";
import { HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION } from "@/lib/speech/hearing-performance";

import {
  COURTROOM_VISUAL_ATLAS_STATE_IDS,
  createCourtroomVisualFixture,
  type CourtroomVisualAtlasStateId,
  type CourtroomVisualFixture,
} from "./courtroom-visual-fixtures";

const EXPECTED_STATE_IDS = [
  "animation-idle-clerk",
  "animation-listening-jury",
  "animation-thinking-witness",
  "animation-speaking-witness",
  "animation-objecting-opposing-counsel",
  "animation-standing-user-counsel",
  "animation-sitting-user-counsel",
  "animation-presenting-evidence-user-counsel",
  "animation-reacting-witness",
  "animation-ruling-judge-ready",
  "animation-gavel-judge-active",
  "evidence-enter",
  "evidence-update",
  "evidence-switch",
  "evidence-exit",
  "evidence-steady",
  "settlement-enter",
  "settlement-update",
  "settlement-steady",
  "settlement-exit",
  "ruling-holding-judge",
  "reduced-motion-speaking-model-stand",
  "reduced-motion-speaking-model-sit",
  "reduced-motion-ruling-model-gavel",
] as const satisfies readonly CourtroomVisualAtlasStateId[];

const ANIMATION_EXPECTATIONS = [
  ["animation-idle-clerk", "clerk", "idle"],
  ["animation-listening-jury", "jury", "listening"],
  ["animation-thinking-witness", "witness", "thinking"],
  ["animation-speaking-witness", "witness", "speaking"],
  [
    "animation-objecting-opposing-counsel",
    "opposing_counsel",
    "objecting",
  ],
  ["animation-standing-user-counsel", "user_counsel", "standing"],
  ["animation-sitting-user-counsel", "user_counsel", "sitting"],
  [
    "animation-presenting-evidence-user-counsel",
    "user_counsel",
    "presenting_evidence",
  ],
  ["animation-reacting-witness", "witness", "reacting"],
  ["animation-ruling-judge-ready", "judge", "ruling"],
  ["animation-gavel-judge-active", "judge", "gavel"],
] as const satisfies readonly (readonly [
  CourtroomVisualAtlasStateId,
  SceneActorKey,
  CourtroomAnimation,
])[];

const DISPLAY_EXPECTATIONS = [
  ["evidence-enter", "entering", "evidence", "evidence", true],
  ["evidence-update", "updating", "evidence", "evidence", true],
  ["evidence-switch", "switching", "evidence", "evidence", true],
  ["evidence-exit", "exiting", "evidence", "idle", true],
  ["evidence-steady", "steady", "evidence", "evidence", false],
  ["settlement-enter", "entering", "settlement", "settlement", true],
  ["settlement-update", "updating", "settlement", "settlement", true],
  ["settlement-steady", "steady", "settlement", "settlement", false],
  ["settlement-exit", "exiting", "settlement", "idle", true],
] as const satisfies readonly (readonly [
  CourtroomVisualAtlasStateId,
  "steady" | "entering" | "updating" | "switching" | "exiting",
  CourtroomDisplayDescriptor["mode"],
  CourtroomDisplayDescriptor["mode"],
  boolean,
])[];

function fixture(stateId: CourtroomVisualAtlasStateId): CourtroomVisualFixture {
  return createCourtroomVisualFixture(stateId);
}

function effectiveAnimation(
  visual: CourtroomVisualFixture,
  actor: SceneActorKey,
): CourtroomAnimation | null {
  if (
    visual.runtimeSnapshot.sceneActor === actor &&
    visual.runtimeSnapshot.animation !== null
  ) {
    return visual.runtimeSnapshot.animation;
  }
  return (
    visual.frame.characters.find(({ slot }) => slot === actor)?.animation ??
    null
  );
}

function settlementDescriptors(
  visual: CourtroomVisualFixture,
): CourtroomDisplayDescriptor[] {
  return [
    visual.frame.display,
    visual.presentationRuntime.baseDisplay,
    visual.runtimeSnapshot.display,
    visual.runtimeSnapshot.displayTransition?.from,
    visual.runtimeSnapshot.displayTransition?.to,
  ].filter(
    (descriptor): descriptor is CourtroomDisplayDescriptor =>
      descriptor !== undefined && descriptor.mode === "settlement",
  );
}

describe("courtroom visual atlas fixtures", () => {
  it("publishes the exact immutable ordered state inventory", () => {
    expect(COURTROOM_VISUAL_ATLAS_STATE_IDS).toEqual(EXPECTED_STATE_IDS);
    expect(Object.isFrozen(COURTROOM_VISUAL_ATLAS_STATE_IDS)).toBe(true);
    expect(new Set(COURTROOM_VISUAL_ATLAS_STATE_IDS).size).toBe(
      COURTROOM_VISUAL_ATLAS_STATE_IDS.length,
    );
    expect(
      new Set(COURTROOM_VISUAL_ATLAS_STATE_IDS.map((stateId) => fixture(stateId).title))
        .size,
    ).toBe(COURTROOM_VISUAL_ATLAS_STATE_IDS.length);
  });

  it("strictly validates and freezes every deterministic fixture", () => {
    for (const stateId of COURTROOM_VISUAL_ATLAS_STATE_IDS) {
      const visual = fixture(stateId);
      expect(() => CourtroomPresentationFrameSchema.parse(visual.frame)).not.toThrow();
      expect(() =>
        CourtroomPresentationRuntimeStateSchema.parse(
          visual.presentationRuntime,
        ),
      ).not.toThrow();
      expect(() =>
        CourtroomPresentationRuntimeSnapshotSchema.parse(
          visual.runtimeSnapshot,
        ),
      ).not.toThrow();
      if (visual.audibleSemanticPerformance !== null) {
        expect(() =>
          CourtroomAudibleSemanticPerformanceSchema.parse(
            visual.audibleSemanticPerformance,
          ),
        ).not.toThrow();
        expect(Object.isFrozen(visual.audibleSemanticPerformance)).toBe(true);
      }
      expect(
        selectCourtroomPresentationRuntime(
          visual.presentationRuntime,
          visual.captureAtMs,
        ),
      ).toEqual(visual.runtimeSnapshot);
      expect(Number.isSafeInteger(visual.captureAtMs)).toBe(true);
      expect(Object.isFrozen(visual)).toBe(true);
      expect(Object.isFrozen(visual.frame)).toBe(true);
      expect(Object.isFrozen(visual.frame.characters)).toBe(true);
      expect(Object.isFrozen(visual.presentationRuntime)).toBe(true);
      expect(Object.isFrozen(visual.runtimeSnapshot)).toBe(true);

      const slots = visual.frame.characters.map(({ slot }) => slot);
      const actorIds = visual.frame.characters.map(({ actorId }) => actorId);
      expect(slots).toEqual([
        "judge",
        "user_counsel",
        "opposing_counsel",
        "witness",
        "clerk",
        "jury",
      ]);
      expect(new Set(slots).size).toBe(6);
      expect(new Set(actorIds).size).toBe(6);
      expect(visual.frame.characters).toHaveLength(6);
      expect(visual.frame.characters.every(({ present }) => present)).toBe(true);
      expect(visual.frame.reducedMotion).toBe(
        visual.presentationRuntime.reducedMotion,
      );
    }

    const first = fixture(COURTROOM_VISUAL_ATLAS_STATE_IDS[0]);
    expect(() =>
      CourtroomPresentationFrameSchema.parse({
        ...first.frame,
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      CourtroomPresentationRuntimeStateSchema.parse({
        ...first.presentationRuntime,
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      CourtroomPresentationRuntimeSnapshotSchema.parse({
        ...first.runtimeSnapshot,
        unexpected: true,
      }),
    ).toThrow();
  });

  it("covers every animation on its exact synthetic scene actor", () => {
    expect(
      new Set(ANIMATION_EXPECTATIONS.map(([, , animation]) => animation)),
    ).toEqual(new Set(CourtroomAnimationSchema.options));

    for (const [stateId, actor, animation] of ANIMATION_EXPECTATIONS) {
      const visual = fixture(stateId);
      expect(visual.runtimeSnapshot.sceneActor).toBe(actor);
      expect(effectiveAnimation(visual, actor)).toBe(animation);
      expect(
        visual.frame.characters.find(({ slot }) => slot === actor)?.actorId,
      ).toBe(`actor:visual:${actor.replaceAll("_", "-")}`);
    }
  });

  it("preserves every evidence and settlement transition at its capture clock", () => {
    for (const [
      stateId,
      phase,
      displayedMode,
      baseMode,
      transitionActive,
    ] of DISPLAY_EXPECTATIONS) {
      const visual = fixture(stateId);
      expect(visual.runtimeSnapshot.displayPhase).toBe(phase);
      expect(visual.runtimeSnapshot.display.mode).toBe(displayedMode);
      expect(visual.presentationRuntime.baseDisplay.mode).toBe(baseMode);
      expect(visual.runtimeSnapshot.transitionActive).toBe(transitionActive);
      if (phase === "steady") {
        expect(visual.runtimeSnapshot.displayTransition).toBeNull();
      } else {
        const transition = visual.runtimeSnapshot.displayTransition;
        expect(transition?.phase).toBe(phase);
        expect(transition?.startedAtMs).toBeLessThan(visual.captureAtMs);
        expect(transition?.endsAtMs).toBeGreaterThan(visual.captureAtMs);
      }
    }

    expect(fixture("evidence-enter").runtimeSnapshot.display).toMatchObject({
      itemId: "evidence:visual:a",
      status: "offered",
    });
    expect(fixture("evidence-update").runtimeSnapshot.display).toMatchObject({
      itemId: "evidence:visual:a",
      status: "admitted",
    });
    expect(fixture("evidence-switch").runtimeSnapshot.display).toMatchObject({
      itemId: "evidence:visual:b",
      status: "excluded",
    });
  });

  it("captures the exact ready, gavel, and holding ruling phases", () => {
    const expected = [
      ["animation-ruling-judge-ready", "ready", "ruling", "requested", false],
      ["animation-gavel-judge-active", "gavel", "gavel", "started", true],
      ["ruling-holding-judge", "holding", "ruling", "started", false],
    ] as const satisfies readonly (readonly [
      CourtroomVisualAtlasStateId,
      "ready" | "gavel" | "holding",
      CourtroomAnimation,
      "requested" | "started",
      boolean,
    ])[];

    for (const [stateId, phase, animation, playbackPhase, active] of expected) {
      const visual = fixture(stateId);
      expect(visual.runtimeSnapshot.sceneActor).toBe("judge");
      expect(visual.runtimeSnapshot.rulingPhase).toBe(phase);
      expect(visual.runtimeSnapshot.animation).toBe(animation);
      expect(visual.runtimeSnapshot.playback?.phase).toBe(playbackPhase);
      expect(visual.runtimeSnapshot.transitionActive).toBe(active);
      expect(
        visual.runtimeSnapshot.playback?.identity.eventSchemaVersion,
      ).toBe(HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION);
    }

    const gavel = fixture("animation-gavel-judge-active");
    expect(gavel.runtimeSnapshot.rulingTransition?.startedAtMs).toBeLessThan(
      gavel.captureAtMs,
    );
    expect(gavel.runtimeSnapshot.rulingTransition?.endsAtMs).toBeGreaterThan(
      gavel.captureAtMs,
    );
  });

  it("contains only synthetic labels and no transcript, provenance, or private terms", () => {
    for (const stateId of COURTROOM_VISUAL_ATLAS_STATE_IDS) {
      const visual = fixture(stateId);
      const serialized = JSON.stringify(visual);
      expect(serialized).not.toMatch(/Asha|Vertex|Mehta|Logistics/iu);
      expect(serialized).not.toMatch(
        /"(?:text|terms|amount|provenance|outputHash|callId|promptVersion)"\s*:/iu,
      );
      expect(serialized).not.toMatch(/[$\u20ac\u00a3\u20b9]/u);
      expect(serialized).not.toContain("activity");
      for (const descriptor of settlementDescriptors(visual)) {
        expect(descriptor.label).toBe("Private settlement conference");
        expect(descriptor.itemId).toMatch(/^settlement:visual:/u);
      }
    }
  });

  it("keeps model stand, sit, and gavel gestures inert to local lifecycle", () => {
    const stand = fixture("reduced-motion-speaking-model-stand");
    const sit = fixture("reduced-motion-speaking-model-sit");
    expect(stand.presentationRuntime).toEqual(sit.presentationRuntime);
    expect(stand.runtimeSnapshot).toEqual(sit.runtimeSnapshot);
    expect(stand.audibleSemanticPerformance).toMatchObject({ gesture: "stand" });
    expect(sit.audibleSemanticPerformance).toMatchObject({ gesture: "sit" });
    for (const visual of [stand, sit]) {
      expect(visual.runtimeSnapshot.animation).toBe("speaking");
      expect(visual.runtimeSnapshot.posture).toBe("standing");
      expect(visual.runtimeSnapshot.rulingPhase).toBe("idle");
    }

    const gavel = fixture("reduced-motion-ruling-model-gavel");
    expect(gavel.audibleSemanticPerformance).toMatchObject({ gesture: "gavel" });
    expect(gavel.runtimeSnapshot.animation).toBe("ruling");
    expect(gavel.runtimeSnapshot.rulingPhase).toBe("holding");
    expect(gavel.runtimeSnapshot.transitionActive).toBe(false);
  });

  it("marks only the explicit reduced-motion atlas states as reduced", () => {
    const reducedIds = new Set<CourtroomVisualAtlasStateId>([
      "reduced-motion-speaking-model-stand",
      "reduced-motion-speaking-model-sit",
      "reduced-motion-ruling-model-gavel",
    ]);
    for (const stateId of COURTROOM_VISUAL_ATLAS_STATE_IDS) {
      const visual = fixture(stateId);
      const expected = reducedIds.has(stateId);
      expect(visual.frame.reducedMotion).toBe(expected);
      expect(visual.presentationRuntime.reducedMotion).toBe(expected);
    }
  });
});
