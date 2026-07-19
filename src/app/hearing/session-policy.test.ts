import { describe, expect, it } from "vitest";

import {
  hearingLifecycleBlocksCourtroomControls,
  shouldReloadHearingSession,
} from "./session-policy";

describe("hearing session UI policy", () => {
  it("keeps native new-hearing URL replacement in the current controller session", () => {
    expect(
      shouldReloadHearingSession({
        previousSearchTrialId: undefined,
        currentSearchTrialId: "trial-new",
        createdTrialId: "trial-new",
        activeTrialId: "trial-new",
      }),
    ).toBe(false);
  });

  it("reloads local-only controller state for cross-trial history navigation", () => {
    expect(
      shouldReloadHearingSession({
        previousSearchTrialId: "trial-one",
        currentSearchTrialId: "trial-two",
        createdTrialId: undefined,
        activeTrialId: "trial-one",
      }),
    ).toBe(true);
    expect(
      shouldReloadHearingSession({
        previousSearchTrialId: "trial-one",
        currentSearchTrialId: undefined,
        createdTrialId: "trial-one",
        activeTrialId: "trial-one",
      }),
    ).toBe(true);
  });

  it("does not reload an unchanged URL or a session with no active trial", () => {
    expect(
      shouldReloadHearingSession({
        previousSearchTrialId: "trial-one",
        currentSearchTrialId: "trial-one",
        createdTrialId: undefined,
        activeTrialId: "trial-one",
      }),
    ).toBe(false);
    expect(
      shouldReloadHearingSession({
        previousSearchTrialId: "missing",
        currentSearchTrialId: "trial-two",
        createdTrialId: undefined,
        activeTrialId: undefined,
      }),
    ).toBe(false);
  });

  it("blocks head-changing controls throughout microphone startup and finalization", () => {
    expect(hearingLifecycleBlocksCourtroomControls("preparing")).toBe(true);
    expect(hearingLifecycleBlocksCourtroomControls("recording")).toBe(true);
    expect(hearingLifecycleBlocksCourtroomControls("processing")).toBe(true);
    expect(hearingLifecycleBlocksCourtroomControls("ready")).toBe(false);
    expect(hearingLifecycleBlocksCourtroomControls("speaking")).toBe(false);
    expect(hearingLifecycleBlocksCourtroomControls(undefined)).toBe(false);
  });
});
