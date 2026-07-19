import type { TrialStateV3 } from "../trial-engine";

export type OpponentStrikeOpportunityInput = Readonly<{
  state: TrialStateV3;
  publicTestimonyIds: readonly string[];
}>;

const NO_STRIKE_OPPORTUNITIES: readonly string[] = Object.freeze([]);

function compareIdentifiers(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function eligibleExaminationKinds(
  stage: TrialStateV3["appearances"][string]["stage"],
): Readonly<{
  active: "cross" | "recross";
  source: "direct" | "redirect";
}> | null {
  if (stage === "cross") return { active: "cross", source: "direct" };
  if (stage === "recross") return { active: "recross", source: "redirect" };
  return null;
}

function testimonyBelongsToAppearance(
  state: TrialStateV3,
  testimonyId: string,
  appearanceId: string,
): boolean {
  const testimony = state.testimony[testimonyId];
  const question = testimony
    ? state.questions[testimony.questionId]
    : undefined;
  return question?.appearanceId === appearanceId;
}

/**
 * Derives the public testimony that the AI opponent may target at the start of
 * the current cross or recross leg.
 *
 * A cross can target only player-elicited direct testimony, while a recross can
 * target only player-elicited redirect testimony. The selector fails closed on
 * inconsistent canonical references and consumes the appearance's opportunity
 * as soon as any strike motion has targeted testimony from that appearance.
 */
export function deriveOpponentStrikeableTestimonyIds({
  state,
  publicTestimonyIds,
}: OpponentStrikeOpportunityInput): readonly string[] {
  if (state.status !== "active" || state.phase !== "case_in_chief") {
    return NO_STRIKE_OPPORTUNITIES;
  }

  const appearanceId = state.activeAppearanceId;
  if (!appearanceId) return NO_STRIKE_OPPORTUNITIES;
  const appearance = state.appearances[appearanceId];
  if (!appearance || state.activeWitnessId !== appearance.witnessId) {
    return NO_STRIKE_OPPORTUNITIES;
  }

  const eligibleKinds = eligibleExaminationKinds(appearance.stage);
  if (!eligibleKinds) return NO_STRIKE_OPPORTUNITIES;

  const opponentSide = state.userSide === "user" ? "opposing" : "user";
  const activeLeg = appearance.legs[eligibleKinds.active];
  const sourceLeg = appearance.legs[eligibleKinds.source];
  if (
    activeLeg.kind !== eligibleKinds.active ||
    activeLeg.ownerSide !== opponentSide ||
    (activeLeg.status !== "available" && activeLeg.status !== "in_progress") ||
    sourceLeg.kind !== eligibleKinds.source ||
    sourceLeg.ownerSide !== state.userSide ||
    sourceLeg.status !== "completed"
  ) {
    return NO_STRIKE_OPPORTUNITIES;
  }

  const targetedTestimonyIds = new Set(
    Object.values(state.strikeMotions).flatMap(
      (motion) => motion.testimonyIds,
    ),
  );
  const appearanceAlreadyHasMotion = [...targetedTestimonyIds].some(
    (testimonyId) =>
      testimonyBelongsToAppearance(state, testimonyId, appearanceId),
  );
  if (appearanceAlreadyHasMotion) return NO_STRIKE_OPPORTUNITIES;

  const publicAllowlist = new Set(publicTestimonyIds);
  const sourceQuestionIds = new Set(sourceLeg.questionIds);
  const strikeableIds = Object.values(state.testimony)
    .filter((testimony) => {
      if (
        !publicAllowlist.has(testimony.testimonyId) ||
        targetedTestimonyIds.has(testimony.testimonyId) ||
        testimony.status !== "active" ||
        testimony.witnessId !== appearance.witnessId
      ) {
        return false;
      }

      const question = state.questions[testimony.questionId];
      const turn = state.transcriptTurns[testimony.turnId];
      if (
        !question ||
        !sourceQuestionIds.has(question.questionId) ||
        question.appearanceId !== appearanceId ||
        question.witnessId !== appearance.witnessId ||
        question.examinationKind !== eligibleKinds.source ||
        question.askedBySide !== state.userSide ||
        question.status !== "answered" ||
        question.testimonyId !== testimony.testimonyId ||
        !turn ||
        turn.status !== "active" ||
        turn.testimonyId !== testimony.testimonyId
      ) {
        return false;
      }

      const examiningActor = state.actors[question.askedByActorId];
      return (
        examiningActor?.side === state.userSide &&
        examiningActor.witnessId === null &&
        (examiningActor.role === "user_counsel" ||
          examiningActor.role === "opposing_counsel")
      );
    })
    .map((testimony) => testimony.testimonyId)
    .sort(compareIdentifiers);

  return strikeableIds.length === 0
    ? NO_STRIKE_OPPORTUNITIES
    : Object.freeze(strikeableIds);
}
