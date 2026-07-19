import type {
  ExaminationKind,
  TrialStateV3,
} from "../trial-engine";

export type ExaminingSide = "user" | "opposing";

export type OutstandingRephraseTargetInput = Readonly<{
  state: TrialStateV3;
  examiningActorId: string;
  examiningSide: ExaminingSide;
}>;

export type OutstandingRephraseTarget = Readonly<{
  originalQuestionId: string;
  objectionId: string;
  appearanceId: string;
  witnessId: string;
  examinationKind: ExaminationKind;
}>;

function activeExaminationKind(
  stage: TrialStateV3["appearances"][string]["stage"],
): ExaminationKind | null {
  switch (stage) {
    case "direct":
    case "cross":
    case "redirect":
    case "recross":
      return stage;
    case "awaiting_oath":
    case "ready_for_release":
    case "released":
      return null;
  }
}

/**
 * Finds the one question that the current examining counsel must rephrase.
 *
 * The caller supplies an actor and side already derived from the protected
 * owner-bound runtime. This helper still checks those constraints against the
 * canonical actor roster, appearance, leg, and question before returning an
 * identifier. It never searches older legs or earlier questions in the active
 * leg: only the ordered leg tail can remain outstanding. Consequently, asking
 * a rephrase consumes the prior target, while a sustained objection to that
 * rephrase makes the new tail the next target.
 */
export function findOutstandingRephraseTarget({
  state,
  examiningActorId,
  examiningSide,
}: OutstandingRephraseTargetInput): OutstandingRephraseTarget | null {
  const examiningActor = state.actors[examiningActorId];
  const expectedRole =
    examiningSide === "user" ? "user_counsel" : "opposing_counsel";
  if (
    !examiningActor ||
    examiningActor.side !== examiningSide ||
    examiningActor.role !== expectedRole ||
    examiningActor.witnessId !== null
  ) {
    return null;
  }

  const appearanceId = state.activeAppearanceId;
  if (!appearanceId) return null;
  const appearance = state.appearances[appearanceId];
  if (!appearance || state.activeWitnessId !== appearance.witnessId) {
    return null;
  }

  const examinationKind = activeExaminationKind(appearance.stage);
  if (!examinationKind) return null;
  const leg = appearance.legs[examinationKind];
  if (
    leg.kind !== examinationKind ||
    leg.ownerSide !== examiningSide ||
    leg.status !== "in_progress"
  ) {
    return null;
  }

  const originalQuestionId = leg.questionIds.at(-1);
  if (!originalQuestionId || state.activeQuestionId !== null) return null;
  const question = state.questions[originalQuestionId];
  if (
    !question ||
    question.questionId !== originalQuestionId ||
    question.appearanceId !== appearanceId ||
    question.witnessId !== appearance.witnessId ||
    question.examinationKind !== examinationKind ||
    question.askedByActorId !== examiningActorId ||
    question.askedBySide !== examiningSide ||
    question.status !== "sustained"
  ) {
    return null;
  }

  const matchingObjections = Object.values(state.objections).filter(
    (objection) =>
      objection.questionId === originalQuestionId &&
      objection.status === "sustained" &&
      objection.remedy === "rephrase" &&
      objection.rulingEventId !== null,
  );
  if (matchingObjections.length !== 1) return null;

  return Object.freeze({
    originalQuestionId,
    objectionId: matchingObjections[0].objectionId,
    appearanceId,
    witnessId: appearance.witnessId,
    examinationKind,
  });
}
