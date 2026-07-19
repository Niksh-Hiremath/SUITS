import type {
  CourtroomAnimation,
  CourtroomAudibleSemanticPerformance,
  CourtroomRulingPhase,
} from "@/domain/courtroom-presentation";

export type CourtroomSemanticIntensityBand =
  | "none"
  | "low"
  | "medium"
  | "high";
export type CourtroomSemanticDelivery =
  | "none"
  | "measured"
  | "hesitant"
  | "firm"
  | "soft"
  | "distressed"
  | "formal"
  | "deliberative";

export type CourtroomSemanticStyle = Readonly<{
  headPitch: number;
  headRoll: number;
  headYaw: number;
  leanX: number;
  leftArmX: number;
  leftArmZ: number;
  lift: number;
  rightArmX: number;
  rightArmZ: number;
  scaleGain: number;
}>;

export type CourtroomSemanticStyleContext = Readonly<{
  animation: CourtroomAnimation;
  observedAtMs: number;
  reducedMotion: boolean;
  rulingPhase: CourtroomRulingPhase;
}>;

const NEUTRAL_SEMANTIC_STYLE: CourtroomSemanticStyle = Object.freeze({
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function courtroomSemanticIntensityBand(
  semantic: CourtroomAudibleSemanticPerformance | null,
): CourtroomSemanticIntensityBand {
  if (semantic === null) return "none";
  if (semantic.intensity < 1 / 3) return "low";
  if (semantic.intensity < 2 / 3) return "medium";
  return "high";
}

export function courtroomSemanticDelivery(
  semantic: CourtroomAudibleSemanticPerformance | null,
): CourtroomSemanticDelivery {
  if (semantic === null) return "none";
  return semantic.kind === "witness"
    ? semantic.delivery
    : semantic.speakingStyle;
}

function deliveryGain(
  semantic: CourtroomAudibleSemanticPerformance,
): number {
  switch (courtroomSemanticDelivery(semantic)) {
    case "soft":
      return 0.62;
    case "hesitant":
      return 0.7;
    case "measured":
    case "deliberative":
      return 0.82;
    case "formal":
      return 0.9;
    case "distressed":
      return 1.06;
    case "firm":
      return 1.16;
    case "none":
      return 1;
  }
}

function gazeYaw(
  semantic: CourtroomAudibleSemanticPerformance,
): number {
  switch (semantic.gazeTarget) {
    case "none":
    case "judge":
      return 0;
    case "jury":
      return -0.1;
    case "witness":
      return 0.06;
    case "user_counsel":
      return -0.08;
    case "opposing_counsel":
      return 0.08;
    case "questioning_counsel":
      return -0.06;
    case "evidence_display":
      return -0.13;
  }
}

export function courtroomSemanticStyleIsAnimated(
  semantic: CourtroomAudibleSemanticPerformance | null,
  animation: CourtroomAnimation,
): boolean {
  if (semantic === null || semantic.intensity === 0) return false;
  return (
    animation === "speaking" ||
    semantic.emotion === "nervous" ||
    semantic.gesture === "small_nod" ||
    semantic.gesture === "head_shake"
  );
}

/**
 * Convert the audited semantic allowlist into modest style offsets only.
 * Local runtime state remains the sole owner of actor, animation, posture,
 * camera, mouth timing, evidence lifecycle, and gavel timing.
 */
export function deriveCourtroomSemanticStyle(
  semantic: CourtroomAudibleSemanticPerformance | null,
  context: CourtroomSemanticStyleContext,
): CourtroomSemanticStyle {
  if (semantic === null || semantic.intensity === 0) {
    return NEUTRAL_SEMANTIC_STYLE;
  }

  const intensity = semantic.intensity;
  const gain = deliveryGain(semantic);
  const observedAtMs = context.reducedMotion ? 0 : context.observedAtMs;
  const speakingBeat =
    context.animation === "speaking"
      ? Math.sin(observedAtMs * 0.008 * gain) * 0.012 * intensity * gain
      : 0;
  let headPitch = speakingBeat * 0.6;
  let headRoll = 0;
  let headYaw = gazeYaw(semantic) * intensity;
  let leanX = speakingBeat;
  let leftArmX = 0;
  let leftArmZ = 0;
  let lift = Math.abs(speakingBeat) * 0.25;
  let rightArmX = 0;
  let rightArmZ = 0;
  let scaleGain = 1;

  switch (semantic.emotion) {
    case "neutral":
      break;
    case "confident":
      headPitch -= 0.018 * intensity;
      leanX += 0.016 * intensity;
      scaleGain += 0.008 * intensity;
      break;
    case "nervous":
      headRoll +=
        (context.reducedMotion
          ? 0.012
          : 0.012 + Math.sin(observedAtMs * 0.011) * 0.012) * intensity;
      lift += 0.005 * intensity;
      break;
    case "angry":
      headPitch -= 0.026 * intensity;
      leanX += 0.028 * intensity;
      rightArmZ -= 0.035 * intensity;
      break;
    case "confused":
      headPitch += 0.018 * intensity;
      headRoll += 0.028 * intensity;
      headYaw -= 0.012 * intensity;
      break;
    case "defensive":
      leanX -= 0.022 * intensity;
      headRoll -= 0.014 * intensity;
      leftArmZ += 0.028 * intensity;
      rightArmZ -= 0.028 * intensity;
      break;
    case "empathetic":
      headPitch += 0.014 * intensity;
      leanX += 0.012 * intensity;
      headRoll += 0.008 * intensity;
      break;
  }

  switch (courtroomSemanticDelivery(semantic)) {
    case "hesitant":
      headRoll += 0.009 * intensity;
      break;
    case "firm":
      leanX += 0.014 * intensity;
      break;
    case "soft":
      headPitch += 0.008 * intensity;
      break;
    case "distressed":
      headRoll -= 0.012 * intensity;
      break;
    case "formal":
      headPitch -= 0.007 * intensity;
      break;
    case "deliberative":
      headPitch += 0.006 * intensity;
      break;
    case "measured":
    case "none":
      break;
  }

  switch (semantic.gesture) {
    case "none":
      break;
    case "small_nod":
      headPitch +=
        (context.reducedMotion
          ? -0.02
          : Math.sin(observedAtMs * 0.012) * 0.036) * intensity;
      break;
    case "head_shake":
      headYaw +=
        (context.reducedMotion
          ? 0.025
          : Math.sin(observedAtMs * 0.014) * 0.06) * intensity;
      break;
    case "look_away":
      headYaw += 0.085 * intensity;
      headRoll += 0.012 * intensity;
      break;
    case "open_palm":
      rightArmX -= 0.06 * intensity;
      rightArmZ -= 0.14 * intensity;
      break;
    case "lean_forward":
      leanX += 0.045 * intensity;
      break;
    case "indicate_evidence":
      leftArmX -= 0.07 * intensity;
      leftArmZ -= 0.16 * intensity;
      break;
    case "stand":
    case "sit":
    case "gavel":
      // These are lifecycle requests. The deterministic local runtime owns them.
      break;
  }

  return Object.freeze({
    headPitch: clamp(headPitch, -0.08, 0.08),
    headRoll: clamp(headRoll, -0.08, 0.08),
    headYaw: clamp(headYaw, -0.16, 0.16),
    leanX: clamp(leanX, -0.06, 0.06),
    leftArmX: clamp(leftArmX, -0.18, 0.18),
    leftArmZ: clamp(leftArmZ, -0.18, 0.18),
    lift: clamp(lift, -0.025, 0.025),
    rightArmX: clamp(rightArmX, -0.18, 0.18),
    rightArmZ: clamp(rightArmZ, -0.18, 0.18),
    scaleGain: clamp(scaleGain, 0.99, 1.02),
  });
}
