import type {
  HearingPlayerIntent,
  HearingRuntimeViewV1,
} from "../../domain/hearing-runtime";

export type HearingVoiceInputMode = "question" | "closing";

export type HearingExaminationKind =
  | "direct"
  | "cross"
  | "redirect"
  | "recross";

export type HearingVoiceContext = Readonly<{
  mode: HearingVoiceInputMode;
  trialId: string;
  stateVersion: number;
  lastEventId: string;
  witnessId: string | null;
  examinationKind: HearingExaminationKind | null;
}>;

export type HearingVoiceContextValidation =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; code: string; message: string }>;

export type HearingSpeechViewSource =
  | "baseline"
  | "new_hearing"
  | "command"
  | "recovery";

export type SpeakableTranscriptTurn =
  HearingRuntimeViewV1["transcript"][number];

export type SpeakableTranscriptDelta =
  | Readonly<{ ok: true; turns: readonly SpeakableTranscriptTurn[] }>
  | Readonly<{ ok: false; code: string; message: string }>;

export type HearingActivity = Readonly<{
  busy: boolean;
  pending: boolean;
}>;

export type SpeechPhraseOptions = Readonly<{
  targetChars?: number;
  maxChars?: number;
  maxPhrases?: number;
}>;

const DEFAULT_TARGET_CHARS = 220;
const DEFAULT_MAX_CHARS = 512;
const DEFAULT_MAX_PHRASES = 64;

const SAFE_MESSAGES = {
  CLOSING_NOT_AVAILABLE: "The trial is not ready for a closing argument.",
  HEARING_BUSY: "Wait for the current courtroom action to finish, then try again.",
  HEARING_HEAD_CHANGED: "The courtroom record changed. Please repeat your statement.",
  HEARING_NOT_READY: "The hearing is not ready for voice input.",
  QUESTION_NOT_AVAILABLE: "The current witness is not available for your question.",
  SPEECH_PHRASE_LIMIT: "The spoken response is too long for the local speech queue.",
  SPEECH_TEXT_INVALID: "The spoken text is empty or exceeds the courtroom limit.",
  SPEECH_TOKEN_TOO_LONG: "The spoken response contains a token that is too long to synthesize safely.",
  TRANSCRIPT_DIVERGED: "The courtroom transcript changed unexpectedly; earlier turns will not be replayed.",
} as const;

type HearingVoicePolicyErrorCode = keyof typeof SAFE_MESSAGES;

export class HearingVoicePolicyError extends Error {
  constructor(readonly code: HearingVoicePolicyErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "HearingVoicePolicyError";
  }
}

function invalid(
  code: HearingVoicePolicyErrorCode,
): HearingVoiceContextValidation {
  return Object.freeze({ valid: false, code, message: SAFE_MESSAGES[code] });
}

function deltaMismatch(): SpeakableTranscriptDelta {
  return Object.freeze({
    ok: false,
    code: "TRANSCRIPT_DIVERGED",
    message: SAFE_MESSAGES.TRANSCRIPT_DIVERGED,
  });
}

function playerOwnsQuestionLeg(view: HearingRuntimeViewV1): boolean {
  const appearance = view.activeAppearance;
  const leg = appearance?.examinationLeg;
  return (
    appearance !== null &&
    leg !== null &&
    leg !== undefined &&
    leg.ownerSide === view.trial.userSide &&
    leg.status === "in_progress" &&
    appearance.stage === leg.kind &&
    view.capabilities.canAskQuestion &&
    view.activeQuestion === null
  );
}

export function freezeHearingVoiceContext(
  mode: HearingVoiceInputMode,
  view: HearingRuntimeViewV1,
): HearingVoiceContext {
  if (mode === "question") {
    if (!playerOwnsQuestionLeg(view)) {
      throw new HearingVoicePolicyError("QUESTION_NOT_AVAILABLE");
    }
    const appearance = view.activeAppearance;
    const leg = appearance?.examinationLeg;
    if (appearance === null || leg === null || leg === undefined) {
      throw new HearingVoicePolicyError("QUESTION_NOT_AVAILABLE");
    }
    return Object.freeze({
      mode,
      trialId: view.trial.trialId,
      stateVersion: view.trial.version,
      lastEventId: view.trial.lastEventId,
      witnessId: appearance.witnessId,
      examinationKind: leg.kind,
    });
  }

  if (!view.capabilities.canFinishTrial) {
    throw new HearingVoicePolicyError("CLOSING_NOT_AVAILABLE");
  }
  return Object.freeze({
    mode,
    trialId: view.trial.trialId,
    stateVersion: view.trial.version,
    lastEventId: view.trial.lastEventId,
    witnessId: null,
    examinationKind: null,
  });
}

export function validateHearingVoiceContext(
  context: HearingVoiceContext,
  currentView: HearingRuntimeViewV1 | null,
  activity: HearingActivity,
): HearingVoiceContextValidation {
  if (activity.busy || activity.pending) return invalid("HEARING_BUSY");
  if (currentView === null) return invalid("HEARING_NOT_READY");
  if (
    currentView.trial.trialId !== context.trialId ||
    currentView.trial.version !== context.stateVersion ||
    currentView.trial.lastEventId !== context.lastEventId
  ) {
    return invalid("HEARING_HEAD_CHANGED");
  }

  if (context.mode === "closing") {
    return context.witnessId === null &&
      context.examinationKind === null &&
      currentView.capabilities.canFinishTrial
      ? Object.freeze({ valid: true })
      : invalid("CLOSING_NOT_AVAILABLE");
  }

  const appearance = currentView.activeAppearance;
  const leg = appearance?.examinationLeg;
  if (
    !playerOwnsQuestionLeg(currentView) ||
    appearance === null ||
    leg === null ||
    leg === undefined ||
    context.witnessId === null ||
    context.examinationKind === null ||
    appearance.witnessId !== context.witnessId ||
    leg.kind !== context.examinationKind
  ) {
    return invalid("QUESTION_NOT_AVAILABLE");
  }
  return Object.freeze({ valid: true });
}

function isSpeakableTurn(
  turn: SpeakableTranscriptTurn,
  next: HearingRuntimeViewV1,
): boolean {
  if (turn.status !== "active" || turn.actor.actorId === next.player.actorId) {
    return false;
  }
  if (
    turn.actor.role === "judge" ||
    turn.actor.role === "witness" ||
    turn.actor.role === "jury"
  ) {
    return true;
  }
  return (
    (turn.actor.role === "user_counsel" ||
      turn.actor.role === "opposing_counsel") &&
    turn.actor.side ===
      (next.trial.userSide === "user" ? "opposing" : "user")
  );
}

export function selectSpeakableTranscriptDelta(
  previous: HearingRuntimeViewV1 | null,
  next: HearingRuntimeViewV1,
  source: HearingSpeechViewSource,
): SpeakableTranscriptDelta {
  if (source === "baseline") {
    return Object.freeze({ ok: true, turns: Object.freeze([]) });
  }
  if (source === "new_hearing") {
    if (previous !== null) return deltaMismatch();
  } else if (
    previous === null ||
    previous.trial.trialId !== next.trial.trialId
  ) {
    return deltaMismatch();
  }

  const prefixLength = previous?.transcript.length ?? 0;
  if (prefixLength > next.transcript.length) return deltaMismatch();
  for (let index = 0; index < prefixLength; index += 1) {
    if (previous?.transcript[index]?.turnId !== next.transcript[index]?.turnId) {
      return deltaMismatch();
    }
  }

  const turns = next.transcript
    .slice(prefixLength)
    .filter((turn) => isSpeakableTurn(turn, next));
  return Object.freeze({ ok: true, turns: Object.freeze(turns) });
}

function validatePhraseOptions(options: SpeechPhraseOptions): {
  targetChars: number;
  maxChars: number;
  maxPhrases: number;
} {
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxPhrases = options.maxPhrases ?? DEFAULT_MAX_PHRASES;
  if (
    !Number.isSafeInteger(targetChars) ||
    !Number.isSafeInteger(maxChars) ||
    !Number.isSafeInteger(maxPhrases) ||
    targetChars < 1 ||
    maxChars < targetChars ||
    maxChars > DEFAULT_MAX_CHARS ||
    maxPhrases < 1 ||
    maxPhrases > DEFAULT_MAX_PHRASES
  ) {
    throw new HearingVoicePolicyError("SPEECH_PHRASE_LIMIT");
  }
  return { targetChars, maxChars, maxPhrases };
}

export function splitSpeechPhrases(
  text: string,
  options: SpeechPhraseOptions = {},
): readonly string[] {
  const { targetChars, maxChars, maxPhrases } =
    validatePhraseOptions(options);
  const normalized = text.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) {
    throw new HearingVoicePolicyError("SPEECH_TEXT_INVALID");
  }

  const phrases: string[] = [];
  const pushPhrase = (phrase: string): void => {
    if (phrase.length === 0 || phrase.length > maxChars) {
      throw new HearingVoicePolicyError("SPEECH_PHRASE_LIMIT");
    }
    phrases.push(phrase);
    if (phrases.length > maxPhrases) {
      throw new HearingVoicePolicyError("SPEECH_PHRASE_LIMIT");
    }
  };

  const units = normalized.split(/(?<=[.!?;:])\s+/u);
  let pending = "";
  const flushPending = (): void => {
    if (pending.length > 0) pushPhrase(pending);
    pending = "";
  };

  for (const unit of units) {
    if (unit.length <= targetChars) {
      const combined = pending.length === 0 ? unit : `${pending} ${unit}`;
      if (combined.length <= targetChars) {
        pending = combined;
      } else {
        flushPending();
        pending = unit;
      }
      continue;
    }

    flushPending();
    let wordChunk = "";
    for (const word of unit.split(" ")) {
      if (word.length > maxChars) {
        throw new HearingVoicePolicyError("SPEECH_TOKEN_TOO_LONG");
      }
      const combined = wordChunk.length === 0 ? word : `${wordChunk} ${word}`;
      if (combined.length <= targetChars || wordChunk.length === 0) {
        wordChunk = combined;
      } else {
        pushPhrase(wordChunk);
        wordChunk = word;
      }
    }
    if (wordChunk.length > 0) pushPhrase(wordChunk);
  }
  flushPending();

  if (phrases.join(" ") !== normalized) {
    throw new HearingVoicePolicyError("SPEECH_PHRASE_LIMIT");
  }
  return Object.freeze(phrases);
}

export function voiceContextToIntent(
  context: HearingVoiceContext,
  text: string,
): HearingPlayerIntent {
  const normalized = text.trim().replace(/\s+/gu, " ");
  const maximum = context.mode === "question" ? 8_000 : 20_000;
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new HearingVoicePolicyError("SPEECH_TEXT_INVALID");
  }
  if (context.mode === "closing") {
    return { type: "finish_trial", closingText: normalized };
  }
  if (context.witnessId === null || context.examinationKind === null) {
    throw new HearingVoicePolicyError("QUESTION_NOT_AVAILABLE");
  }
  return {
    type: "ask_question",
    witnessId: context.witnessId,
    examinationKind: context.examinationKind,
    text: normalized,
    presentedEvidenceIds: [],
  };
}
