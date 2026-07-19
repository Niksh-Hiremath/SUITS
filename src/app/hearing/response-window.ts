import {
  HearingPlayerIntentSchema,
  type HearingPlayerIntent,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";

export type OpponentResponseGround =
  HearingRuntimeViewV1["permittedObjectionGrounds"][number];

export type OpponentResponseWindow = Readonly<{
  trialId: string;
  stateVersion: number;
  lastEventId: string;
  appearanceId: string;
  witnessId: string;
  examinationKind: NonNullable<
    NonNullable<HearingRuntimeViewV1["activeAppearance"]>["examinationLeg"]
  >["kind"];
  questionId: string;
  questionTurnId: string;
  responseId: string;
  opposingCounselActorId: string;
  canObject: boolean;
  canContinueResponse: boolean;
  permittedObjectionGrounds: readonly OpponentResponseGround[];
}>;

export type OpponentObjectIntent = Extract<
  HearingPlayerIntent,
  Readonly<{ type: "object" }>
>;

export type OpponentContinueResponseIntent = Extract<
  HearingPlayerIntent,
  Readonly<{ type: "continue_response" }>
>;

function counselRole(side: "user" | "opposing"):
  | "user_counsel"
  | "opposing_counsel" {
  return side === "user" ? "user_counsel" : "opposing_counsel";
}

function sameActor(
  left: NonNullable<HearingRuntimeViewV1["activeQuestion"]>["askedBy"],
  right: NonNullable<HearingRuntimeViewV1["activeQuestion"]>["askedBy"],
): boolean {
  return (
    left.actorId === right.actorId &&
    left.role === right.role &&
    left.side === right.side &&
    left.witnessId === right.witnessId
  );
}

/**
 * Derive the player decision window for a pending response to opposing counsel.
 *
 * Capabilities alone are not authority: the view must also describe one
 * internally consistent active appearance, question, roster entry, and
 * transcript question turn. Invalid or incomplete projections fail closed.
 */
export function deriveOpponentResponseWindow(
  view: HearingRuntimeViewV1,
): OpponentResponseWindow | null {
  const appearance = view.activeAppearance;
  const question = view.activeQuestion;
  const examinationLeg = appearance?.examinationLeg;
  const responseId = question?.pendingResponseId;
  const opposingSide = view.trial.userSide === "user" ? "opposing" : "user";

  if (
    view.trial.status !== "active" ||
    view.trial.phase !== "case_in_chief" ||
    view.player.side !== view.trial.userSide ||
    view.player.actorRole !== counselRole(view.trial.userSide) ||
    (!view.capabilities.canObject &&
      !view.capabilities.canContinueResponse) ||
    appearance === null ||
    examinationLeg == null ||
    question === null ||
    responseId == null ||
    question.status !== "open" ||
    question.appearanceId !== appearance.appearanceId ||
    question.witnessId !== appearance.witnessId ||
    question.examinationKind !== examinationLeg.kind ||
    appearance.stage !== examinationLeg.kind ||
    examinationLeg.ownerSide !== opposingSide ||
    examinationLeg.status !== "in_progress" ||
    question.askedBy.side !== opposingSide ||
    question.askedBy.role !== counselRole(opposingSide) ||
    question.askedBy.witnessId !== null ||
    question.askedBy.actorId === view.player.actorId
  ) {
    return null;
  }

  const matchingWitnesses = view.witnesses.filter(
    (witness) => witness.witnessId === appearance.witnessId,
  );
  if (
    matchingWitnesses.length !== 1 ||
    matchingWitnesses[0].currentAppearanceId !== appearance.appearanceId ||
    matchingWitnesses[0].currentExaminationLeg !== examinationLeg.kind
  ) {
    return null;
  }

  const matchingQuestionTurns = view.transcript.filter(
    (turn) => turn.turnId === question.questionTurnId,
  );
  if (
    matchingQuestionTurns.length !== 1 ||
    matchingQuestionTurns[0].status !== "active" ||
    matchingQuestionTurns[0].testimonyId !== null ||
    !sameActor(matchingQuestionTurns[0].actor, question.askedBy)
  ) {
    return null;
  }

  return Object.freeze({
    trialId: view.trial.trialId,
    stateVersion: view.trial.version,
    lastEventId: view.trial.lastEventId,
    appearanceId: appearance.appearanceId,
    witnessId: appearance.witnessId,
    examinationKind: examinationLeg.kind,
    questionId: question.questionId,
    questionTurnId: question.questionTurnId,
    responseId,
    opposingCounselActorId: question.askedBy.actorId,
    canObject: view.capabilities.canObject,
    canContinueResponse: view.capabilities.canContinueResponse,
    permittedObjectionGrounds: Object.freeze([
      ...view.permittedObjectionGrounds,
    ]),
  });
}

function sameWindow(
  left: OpponentResponseWindow,
  right: OpponentResponseWindow,
): boolean {
  return (
    left.trialId === right.trialId &&
    left.stateVersion === right.stateVersion &&
    left.lastEventId === right.lastEventId &&
    left.appearanceId === right.appearanceId &&
    left.witnessId === right.witnessId &&
    left.examinationKind === right.examinationKind &&
    left.questionId === right.questionId &&
    left.questionTurnId === right.questionTurnId &&
    left.responseId === right.responseId &&
    left.opposingCounselActorId === right.opposingCounselActorId &&
    left.canObject === right.canObject &&
    left.canContinueResponse === right.canContinueResponse &&
    left.permittedObjectionGrounds.length ===
      right.permittedObjectionGrounds.length &&
    left.permittedObjectionGrounds.every(
      (ground, index) => ground === right.permittedObjectionGrounds[index],
    )
  );
}

/** Build an objection bound to the exact still-current response window. */
export function buildObjectIntent(
  view: HearingRuntimeViewV1,
  expectedWindow: OpponentResponseWindow,
  ground: OpponentResponseGround,
): OpponentObjectIntent | null {
  const currentWindow = deriveOpponentResponseWindow(view);
  if (
    currentWindow === null ||
    !sameWindow(currentWindow, expectedWindow) ||
    !currentWindow.canObject ||
    !currentWindow.permittedObjectionGrounds.includes(ground)
  ) {
    return null;
  }

  const parsed = HearingPlayerIntentSchema.safeParse({
    type: "object",
    questionId: currentWindow.questionId,
    responseId: currentWindow.responseId,
    ground,
  });
  if (!parsed.success || parsed.data.type !== "object") return null;
  return Object.freeze(parsed.data);
}

/** Build an exact continue command bound to the still-current response window. */
export function buildContinueResponseIntent(
  view: HearingRuntimeViewV1,
  expectedWindow: OpponentResponseWindow,
): OpponentContinueResponseIntent | null {
  const currentWindow = deriveOpponentResponseWindow(view);
  if (
    currentWindow === null ||
    !sameWindow(currentWindow, expectedWindow) ||
    !currentWindow.canContinueResponse
  ) {
    return null;
  }

  const parsed = HearingPlayerIntentSchema.safeParse({
    type: "continue_response",
    responseId: currentWindow.responseId,
  });
  if (!parsed.success || parsed.data.type !== "continue_response") return null;
  return Object.freeze(parsed.data);
}
