export const HEARING_PHASES = [
  "briefing",
  "opening",
  "cross_examination",
  "closing",
  "deliberation",
  "debrief",
  "complete",
  "failed",
] as const;

export type HearingPhase = (typeof HEARING_PHASES)[number];

const NEXT_PHASE: Partial<Record<HearingPhase, HearingPhase>> = {
  briefing: "opening",
  opening: "cross_examination",
  cross_examination: "closing",
  closing: "deliberation",
  deliberation: "debrief",
  debrief: "complete",
};

const ACTIONS = {
  briefing: ["present_briefing", "acknowledge_briefing", "resume"],
  opening: [
    "request_opening",
    "accept_opening",
    "use_default_opening",
    "resume",
  ],
  cross_examination: [
    "submit_question",
    "answer_question",
    "repeat_or_clarify",
    "end_cross",
    "resume",
  ],
  closing: [
    "submit_closing",
    "use_default_closing",
    "accept_closing",
    "resume",
  ],
  deliberation: [
    "request_deliberation",
    "accept_deliberation",
    "use_fallback_deliberation",
    "resume",
  ],
  debrief: [
    "request_debrief",
    "accept_debrief",
    "repair_citations",
    "use_fallback_debrief",
    "resume",
  ],
  complete: ["view_transcript", "view_debrief", "download_debrief"],
  failed: ["view_failure", "restart_trial"],
} as const satisfies Record<HearingPhase, readonly string[]>;

export function advancePhase(
  current: HearingPhase,
  requested: HearingPhase,
): HearingPhase {
  if (NEXT_PHASE[current] !== requested) {
    throw new Error(`Illegal phase transition: ${current} -> ${requested}`);
  }
  return requested;
}

export function allowedActionsFor(phase: HearingPhase): readonly string[] {
  return ACTIONS[phase];
}