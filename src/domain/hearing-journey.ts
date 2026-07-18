import type { HearingPhase } from "./workflow";

export type HearingProgress = {
  step: number;
  totalSteps: 4;
  label: string;
  next: string;
};

const SAFE_TRIAL_ID = /^[a-zA-Z0-9_-]+$/;

export function trialIdFromSearch(search: string): string | undefined {
  const trialId = new URLSearchParams(search).get("trial")?.trim();
  return trialId && SAFE_TRIAL_ID.test(trialId) ? trialId : undefined;
}

export function hearingUrl(trialId: string): string {
  return `/hearing/?trial=${encodeURIComponent(trialId)}`;
}

export function seededHearingUrl(slug: string): string {
  return `/hearing/?case=${encodeURIComponent(slug)}`;
}

export function ownedHearingUrl(uploadId: string): string {
  return `/hearing/?upload=${encodeURIComponent(uploadId)}`;
}

export function ownedCaseWorkspaceUrl(
  status: "draft" | "published",
  uploadId: string,
): string {
  return status === "published"
    ? ownedHearingUrl(uploadId)
    : `/cases/new?draft=${encodeURIComponent(uploadId)}`;
}

export function hearingProgress(
  phase: HearingPhase | undefined,
  witnessAnswerCount: number,
): HearingProgress {
  if (phase === "complete") {
    return { step: 4, totalSteps: 4, label: "Debrief ready", next: "Review what landed, then inspect the cited record." };
  }
  if (phase === "deliberation" || phase === "debrief") {
    return { step: 4, totalSteps: 4, label: "Jury review", next: "The jury is weighing only what entered the transcript." };
  }
  if (phase === "closing") {
    return { step: 3, totalSteps: 4, label: "Make your closing", next: "Connect the complaint, revision history, and final decision to Asha's position." };
  }
  if (phase === "cross_examination") {
    return witnessAnswerCount > 0
      ? { step: 2, totalSteps: 4, label: "Follow the evidence", next: "Ask a follow-up or move to your closing when the record is clear." }
      : { step: 2, totalSteps: 4, label: "Question the witness", next: "Test the timeline with a focused leading question." };
  }
  return { step: 1, totalSteps: 4, label: "Review the case", next: "Understand your objective and the available evidence." };
}
