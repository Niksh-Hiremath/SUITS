import { describe, expect, it } from "vitest";

import type { CourtroomAudibleSemanticPerformance } from "@/domain/courtroom-presentation";

import {
  courtroomSemanticDelivery,
  courtroomSemanticIntensityBand,
  deriveCourtroomSemanticStyle,
} from "./courtroom-semantic-style";

const witness: CourtroomAudibleSemanticPerformance = {
  kind: "witness",
  emotion: "neutral",
  intensity: 1,
  delivery: "measured",
  gesture: "none",
  gazeTarget: "judge",
};

const context = {
  animation: "speaking" as const,
  observedAtMs: 1_000,
  reducedMotion: false,
  rulingPhase: "idle" as const,
};

describe("courtroom semantic style", () => {
  it("returns an inert style without an audited audible cue", () => {
    expect(deriveCourtroomSemanticStyle(null, context)).toEqual({
      headPitch: 0,
      headRoll: 0,
      headYaw: 0,
      leanX: 0,
      leftArmX: 0,
      leftArmZ: 0,
      lift: 0,
      rightArmX: 0,
      rightArmZ: 0,
      scaleGain: 1,
    });
  });

  it("keeps every renderer offset inside its explicit bound", () => {
    const style = deriveCourtroomSemanticStyle(
      {
        kind: "role",
        emotion: "angry",
        intensity: 1,
        gazeTarget: "evidence_display",
        gesture: "open_palm",
        speakingStyle: "firm",
      },
      context,
    );
    expect(style.headPitch).toBeGreaterThanOrEqual(-0.08);
    expect(style.headPitch).toBeLessThanOrEqual(0.08);
    expect(style.headRoll).toBeGreaterThanOrEqual(-0.08);
    expect(style.headRoll).toBeLessThanOrEqual(0.08);
    expect(style.headYaw).toBeGreaterThanOrEqual(-0.16);
    expect(style.headYaw).toBeLessThanOrEqual(0.16);
    expect(style.leanX).toBeGreaterThanOrEqual(-0.06);
    expect(style.leanX).toBeLessThanOrEqual(0.06);
    for (const arm of [
      style.leftArmX,
      style.leftArmZ,
      style.rightArmX,
      style.rightArmZ,
    ]) {
      expect(arm).toBeGreaterThanOrEqual(-0.18);
      expect(arm).toBeLessThanOrEqual(0.18);
    }
    expect(style.lift).toBeGreaterThanOrEqual(-0.025);
    expect(style.lift).toBeLessThanOrEqual(0.025);
    expect(style.scaleGain).toBeGreaterThanOrEqual(0.99);
    expect(style.scaleGain).toBeLessThanOrEqual(1.02);
  });

  it("is time-invariant when reduced motion is active", () => {
    const cue = { ...witness, emotion: "nervous" as const, gesture: "small_nod" as const };
    const first = deriveCourtroomSemanticStyle(cue, {
      ...context,
      observedAtMs: 10,
      reducedMotion: true,
    });
    const later = deriveCourtroomSemanticStyle(cue, {
      ...context,
      observedAtMs: 99_999,
      reducedMotion: true,
    });
    expect(later).toEqual(first);
  });

  it("keeps stand, sit, and gavel inert regardless of local ruling phase", () => {
    const role: CourtroomAudibleSemanticPerformance = {
      kind: "role",
      emotion: "neutral",
      intensity: 1,
      gazeTarget: "judge",
      gesture: "none",
      speakingStyle: "formal",
    };
    const rulingContext = { ...context, rulingPhase: "gavel" as const };
    const none = deriveCourtroomSemanticStyle(role, rulingContext);
    for (const gesture of ["stand", "sit", "gavel"] as const) {
      expect(
        deriveCourtroomSemanticStyle(
          { ...role, gesture },
          rulingContext,
        ),
      ).toEqual(none);
    }
  });

  it("consumes emotion, delivery, gaze, gesture, and intensity", () => {
    const baseline = deriveCourtroomSemanticStyle(witness, context);
    expect(
      deriveCourtroomSemanticStyle(
        { ...witness, emotion: "confident" },
        context,
      ),
    ).not.toEqual(baseline);
    expect(
      deriveCourtroomSemanticStyle(
        { ...witness, delivery: "firm" },
        context,
      ),
    ).not.toEqual(baseline);
    expect(
      deriveCourtroomSemanticStyle(
        { ...witness, gazeTarget: "jury" },
        context,
      ),
    ).not.toEqual(baseline);
    expect(
      deriveCourtroomSemanticStyle(
        { ...witness, gesture: "indicate_evidence" },
        context,
      ),
    ).not.toEqual(baseline);
    expect(
      deriveCourtroomSemanticStyle(
        { ...witness, intensity: 0 },
        context,
      ),
    ).not.toEqual(baseline);
  });

  it("emits enum-only stage labels", () => {
    expect(courtroomSemanticIntensityBand(null)).toBe("none");
    expect(courtroomSemanticIntensityBand({ ...witness, intensity: 0.2 })).toBe(
      "low",
    );
    expect(courtroomSemanticIntensityBand({ ...witness, intensity: 0.5 })).toBe(
      "medium",
    );
    expect(courtroomSemanticIntensityBand(witness)).toBe("high");
    expect(courtroomSemanticDelivery(witness)).toBe("measured");
    expect(
      courtroomSemanticDelivery({
        kind: "role",
        emotion: "neutral",
        intensity: 0.5,
        gazeTarget: "judge",
        gesture: "none",
        speakingStyle: "formal",
      }),
    ).toBe("formal");
  });
});
