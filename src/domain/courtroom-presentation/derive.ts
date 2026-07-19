import type { HearingRuntimeViewV1 } from "@/domain/hearing-runtime";
import type { z } from "zod";

import {
  COURTROOM_PRESENTATION_FRAME_SCHEMA_VERSION,
  CourtroomPresentationFrameSchema,
  type CourtroomAnimation,
  type CourtroomPresentationFrame,
  type CourtroomQuality,
  type SceneActorKey,
} from "./schema";

export type CourtroomSpeechActivity = Readonly<{
  lifecycle:
    | "idle"
    | "preparing"
    | "ready"
    | "recording"
    | "processing"
    | "speaking"
    | "recoverable_error"
    | "fatal_error"
    | "closed";
  activeMode: "question" | "closing" | null;
}>;

export type DeriveCourtroomPresentationInput = Readonly<{
  view: HearingRuntimeViewV1;
  speech: CourtroomSpeechActivity | null;
  busy: boolean;
  quality: CourtroomQuality;
  reducedMotion: boolean;
}>;

type MutableCharacter = {
  slot: SceneActorKey;
  actorId: string | null;
  label: string;
  present: boolean;
  animation: CourtroomAnimation;
  posture: "seated" | "standing";
  emphasis: number;
};

const CHARACTER_ORDER = [
  "judge",
  "user_counsel",
  "opposing_counsel",
  "witness",
  "clerk",
  "jury",
] as const satisfies readonly SceneActorKey[];

const PRESENTATION_LABEL_LIMIT = 160;

function presentationLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= PRESENTATION_LABEL_LIMIT) return normalized;
  return `${normalized.slice(0, PRESENTATION_LABEL_LIMIT - 1).trimEnd()}…`;
}

function slotForActor(
  actor: HearingRuntimeViewV1["transcript"][number]["actor"],
  userSide: HearingRuntimeViewV1["trial"]["userSide"],
): SceneActorKey {
  switch (actor.role) {
    case "judge":
      return "judge";
    case "user_counsel":
    case "opposing_counsel":
      return actor.side === userSide ? "user_counsel" : "opposing_counsel";
    case "witness":
      return "witness";
    case "jury":
      return "jury";
    case "clerk":
    case "debrief_coach":
    case "system":
      return "clerk";
  }
}

function lastActorId(
  view: HearingRuntimeViewV1,
  slot: SceneActorKey,
): string | null {
  for (let index = view.transcript.length - 1; index >= 0; index -= 1) {
    const actor = view.transcript[index]?.actor;
    if (actor && slotForActor(actor, view.trial.userSide) === slot) {
      return actor.actorId;
    }
  }
  return null;
}

function closeShot(slot: SceneActorKey) {
  switch (slot) {
    case "judge":
      return "judge_close" as const;
    case "user_counsel":
      return "user_counsel_close" as const;
    case "opposing_counsel":
      return "opposing_counsel_close" as const;
    case "witness":
      return "witness_close" as const;
    case "jury":
      return "jury_box" as const;
    case "clerk":
      return "courtroom_wide" as const;
  }
}

function immutableFrame(
  input: z.input<typeof CourtroomPresentationFrameSchema>,
): CourtroomPresentationFrame {
  const parsed = CourtroomPresentationFrameSchema.parse(input);
  Object.freeze(parsed.head);
  Object.freeze(parsed.camera);
  Object.freeze(parsed.display);
  for (const character of parsed.characters) Object.freeze(character);
  Object.freeze(parsed.characters);
  return Object.freeze(parsed);
}

function characterLabel(
  view: HearingRuntimeViewV1,
  slot: SceneActorKey,
): string {
  switch (slot) {
    case "judge":
      return "Judge";
    case "user_counsel":
      return "Your counsel";
    case "opposing_counsel":
      return "Opposing counsel";
    case "witness":
      return presentationLabel(
        view.witnesses.find(
          ({ witnessId }) => witnessId === view.activeAppearance?.witnessId,
        )?.name ?? "Witness box"
      );
    case "clerk":
      return "Court clerk";
    case "jury":
      return "Jury";
  }
}

function defaultCharacters(view: HearingRuntimeViewV1): MutableCharacter[] {
  const activeWitnessId = view.activeAppearance?.witnessId ?? null;
  return CHARACTER_ORDER.map((slot) => ({
    slot,
    actorId:
      slot === "user_counsel"
        ? view.player.actorId
        : slot === "witness"
          ? lastActorId(view, "witness")
          : lastActorId(view, slot),
    label: characterLabel(view, slot),
    present: slot !== "witness" || activeWitnessId !== null,
    animation:
      slot === "judge" || slot === "jury" || slot === "witness"
        ? "listening"
        : "idle",
    posture: "seated",
    emphasis: slot === "judge" ? 0.25 : 0,
  }));
}

function updateCharacter(
  characters: MutableCharacter[],
  slot: SceneActorKey,
  update: Partial<MutableCharacter>,
): void {
  const character = characters.find((candidate) => candidate.slot === slot);
  if (character) Object.assign(character, update);
}

function activeLegOwner(view: HearingRuntimeViewV1): SceneActorKey | null {
  const leg = view.activeAppearance?.examinationLeg;
  if (leg?.status !== "in_progress") return null;
  const side = leg.ownerSide;
  if (side === undefined) return null;
  return side === view.trial.userSide ? "user_counsel" : "opposing_counsel";
}

function thinkingSlot(view: HearingRuntimeViewV1): SceneActorKey {
  if (view.activeQuestion?.pendingResponseId) return "witness";
  return activeLegOwner(view) ?? "judge";
}

export function deriveCourtroomPresentation(
  input: DeriveCourtroomPresentationInput,
): CourtroomPresentationFrame {
  const { view } = input;
  const characters = defaultCharacters(view);
  const legOwner = activeLegOwner(view);
  if (legOwner) {
    updateCharacter(characters, legOwner, {
      animation: "standing",
      posture: "standing",
      emphasis: 0.3,
    });
  }
  if (view.activeAppearance?.stage === "awaiting_oath") {
    updateCharacter(characters, "witness", {
      animation: "standing",
      posture: "standing",
      emphasis: 0.5,
    });
  }

  const presentedEvidenceId = view.activeQuestion?.presentedEvidenceIds.at(-1);
  const presentedEvidence = presentedEvidenceId
    ? view.player.evidence.find(
        ({ evidenceId }) => evidenceId === presentedEvidenceId,
      )
    : undefined;
  const openSettlement = view.player.settlement?.offers.find(
    ({ status }) => status === "open",
  );
  const display = presentedEvidence
    ? {
          mode: "evidence" as const,
          itemId: presentedEvidence.evidenceId,
          label: presentationLabel(presentedEvidence.name),
          status: presentedEvidence.status,
      }
    : openSettlement
      ? {
          mode: "settlement" as const,
          itemId: openSettlement.offerId,
          label: "Private settlement conference",
          status: openSettlement.status,
        }
      : { mode: "idle" as const, itemId: null, label: null, status: null };

  let activeSlot: SceneActorKey | null = null;
  let activeAnimation: CourtroomAnimation | null = null;
  if (input.speech?.lifecycle === "recording") {
    activeSlot = "user_counsel";
    activeAnimation = "standing";
  } else if (input.speech?.lifecycle === "processing") {
    activeSlot = "user_counsel";
    activeAnimation = "thinking";
  } else if (input.busy) {
    activeSlot = thinkingSlot(view);
    activeAnimation = "thinking";
  }

  if (activeSlot && activeAnimation) {
    for (const character of characters) {
      if (character.present && character.slot !== activeSlot) {
        character.animation = "listening";
        character.emphasis = 0;
      }
    }
    updateCharacter(characters, activeSlot, {
      animation: activeAnimation,
      posture:
        activeSlot === "user_counsel" || activeSlot === "opposing_counsel"
          ? "standing"
          : characters.find(({ slot }) => slot === activeSlot)?.posture,
      emphasis: 0.7,
    });
  } else if (presentedEvidence && legOwner) {
    updateCharacter(characters, legOwner, {
      animation: "presenting_evidence",
      posture: "standing",
      emphasis: 0.75,
    });
  }

  const camera = activeSlot
    ? {
        shot: closeShot(activeSlot),
        target: activeSlot,
        transition: input.reducedMotion ? ("cut" as const) : ("blend" as const),
      }
    : presentedEvidence
      ? {
          shot: "evidence_display" as const,
          target: legOwner,
          transition: input.reducedMotion ? ("cut" as const) : ("blend" as const),
        }
      : view.activeAppearance
        ? {
            shot: "witness_counsel_two_shot" as const,
            target: "witness" as const,
            transition: input.reducedMotion ? ("cut" as const) : ("blend" as const),
          }
        : {
            shot: "courtroom_wide" as const,
            target: null,
            transition: "cut" as const,
          };

  const activeCharacter = activeSlot
    ? characters.find(({ slot }) => slot === activeSlot)
    : null;
  const statusSummary = activeCharacter
    ? `${activeCharacter.label} is ${activeAnimation}.`
    : presentedEvidence
      ? `${presentationLabel(presentedEvidence.name)} is shown on the courtroom evidence display.`
      : openSettlement
        ? "A private settlement status is available only to the participating counsel."
      : view.activeAppearance
        ? `${characterLabel(view, "witness")} is in the witness box.`
        : "The courtroom is waiting for the next witness.";

  return immutableFrame({
    schemaVersion: COURTROOM_PRESENTATION_FRAME_SCHEMA_VERSION,
    head: {
      trialId: view.trial.trialId,
      stateVersion: view.trial.version,
      lastEventId: view.trial.lastEventId,
    },
    quality: input.quality,
    reducedMotion: input.reducedMotion,
    camera,
    characters,
    display,
    statusSummary,
  });
}
