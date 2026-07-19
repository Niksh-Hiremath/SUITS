import type { HearingControllerLifecycle } from "@/lib/speech/hearing-controller";

type HearingSessionTransition = Readonly<{
  previousSearchTrialId: string | undefined;
  currentSearchTrialId: string | undefined;
  createdTrialId: string | undefined;
  activeTrialId: string | undefined;
}>;

export function shouldReloadHearingSession({
  previousSearchTrialId,
  currentSearchTrialId,
  createdTrialId,
  activeTrialId,
}: HearingSessionTransition): boolean {
  if (previousSearchTrialId === currentSearchTrialId) return false;
  if (
    createdTrialId !== undefined &&
    currentSearchTrialId === createdTrialId
  ) {
    return false;
  }
  return activeTrialId !== undefined && activeTrialId !== currentSearchTrialId;
}

export function hearingLifecycleBlocksCourtroomControls(
  lifecycle: HearingControllerLifecycle | undefined,
): boolean {
  return (
    lifecycle === "preparing" ||
    lifecycle === "recording" ||
    lifecycle === "processing"
  );
}
