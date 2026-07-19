import { z } from "zod";

import {
  HearingRoleSemanticPerformanceSchema,
  HearingWitnessSemanticPerformanceSchema,
  type HearingCommittedPerformance,
  type HearingRuntimeViewV1,
  type HearingSemanticPerformance,
} from "../hearing-runtime";

import type { CourtroomPresentationRuntimeSnapshot } from "./runtime";
import type { SceneActorKey } from "./schema";

export const CourtroomAudibleRoleSemanticPerformanceSchema =
  HearingRoleSemanticPerformanceSchema.omit({ activity: true }).strict();
export const CourtroomAudibleSemanticPerformanceSchema = z.discriminatedUnion(
  "kind",
  [
    HearingWitnessSemanticPerformanceSchema,
    CourtroomAudibleRoleSemanticPerformanceSchema,
  ],
);
export type CourtroomAudibleSemanticPerformance = z.infer<
  typeof CourtroomAudibleSemanticPerformanceSchema
>;

function sameActor(
  left: HearingCommittedPerformance["actor"],
  right: HearingCommittedPerformance["actor"],
): boolean {
  return (
    left.actorId === right.actorId &&
    left.role === right.role &&
    left.side === right.side &&
    left.witnessId === right.witnessId
  );
}

function sceneActorForCommittedPerformance(
  performance: HearingCommittedPerformance,
  userSide: HearingRuntimeViewV1["trial"]["userSide"],
): SceneActorKey | null {
  switch (performance.actor.role) {
    case "witness":
      return "witness";
    case "opposing_counsel":
    case "user_counsel":
      return performance.actor.side === userSide
        ? "user_counsel"
        : "opposing_counsel";
    case "judge":
      return "judge";
    case "jury":
      return "jury";
    case "clerk":
      return "clerk";
    case "system":
    case "debrief_coach":
      return null;
  }
}

function rendererSemantic(
  semantic: HearingSemanticPerformance,
): CourtroomAudibleSemanticPerformance {
  return semantic.kind === "witness"
    ? HearingWitnessSemanticPerformanceSchema.parse(semantic)
    : CourtroomAudibleRoleSemanticPerformanceSchema.parse({
        kind: "role",
        emotion: semantic.emotion,
        intensity: semantic.intensity,
        gazeTarget: semantic.gazeTarget,
        gesture: semantic.gesture,
        speakingStyle: semantic.speakingStyle,
      });
}

function semanticFromTurn(
  view: HearingRuntimeViewV1,
  snapshot: CourtroomPresentationRuntimeSnapshot,
): CourtroomAudibleSemanticPerformance | null {
  const playback = snapshot.playback;
  const turnId = playback?.identity.turnId;
  if (playback === null || turnId === null || turnId === undefined) return null;
  const turns = view.transcript.filter((turn) => turn.turnId === turnId);
  const turn = turns[0];
  const performance = turn?.semanticCue ?? null;
  if (
    turns.length !== 1 ||
    turn === undefined ||
    turn.status !== "active" ||
    performance === null ||
    performance.context !== "courtroom" ||
    performance.kind === "objection_ruling" ||
    performance.kind === "negotiation_decision" ||
    performance.kind === "jury_deliberation" ||
    performance.head.trialId !== view.trial.trialId ||
    performance.head.stateVersion > view.trial.version ||
    performance.source.turnId !== turnId ||
    !sameActor(performance.actor, turn.actor) ||
    snapshot.sceneActor !==
      sceneActorForCommittedPerformance(performance, view.trial.userSide) ||
    performance.source.interruptId !== playback.identity.interruptId
  ) {
    return null;
  }
  const expectedPurpose =
    performance.kind === "witness_answer" ? "testimony" : "transcript";
  if (playback.identity.purpose !== expectedPurpose) return null;
  return rendererSemantic(performance.semantic);
}

function semanticFromRuling(
  view: HearingRuntimeViewV1,
  snapshot: CourtroomPresentationRuntimeSnapshot,
): CourtroomAudibleSemanticPerformance | null {
  const playback = snapshot.playback;
  const performance = view.currentSemanticCue ?? null;
  if (
    playback === null ||
    playback.identity.purpose !== "ruling" ||
    playback.identity.turnId !== null ||
    playback.identity.interruptId === null ||
    performance === null ||
    performance.kind !== "objection_ruling" ||
    performance.context !== "courtroom" ||
    performance.head.trialId !== view.trial.trialId ||
    performance.head.stateVersion !== view.trial.version ||
    performance.head.lastEventId !== view.trial.lastEventId ||
    performance.source.turnId !== null ||
    performance.source.interruptId !== playback.identity.interruptId ||
    performance.actor.role !== "judge" ||
    snapshot.sceneActor !== "judge"
  ) {
    return null;
  }
  return rendererSemantic(performance.semantic);
}

/**
 * Select only the semantic allowlist bound to the exact audible local playback.
 * Durable model metadata never chooses the actor, lifecycle, camera, mouth, or
 * timing, and a baseline/reloaded/requested turn therefore returns no cue.
 */
export function selectAudibleCourtroomSemanticPerformance(
  view: HearingRuntimeViewV1,
  snapshot: CourtroomPresentationRuntimeSnapshot,
): CourtroomAudibleSemanticPerformance | null {
  if (
    snapshot.source !== "playback" ||
    snapshot.playback === null ||
    snapshot.playback.phase === "requested"
  ) {
    return null;
  }
  return snapshot.playback.identity.turnId === null
    ? semanticFromRuling(view, snapshot)
    : semanticFromTurn(view, snapshot);
}
