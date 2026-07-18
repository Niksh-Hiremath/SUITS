import { describe, expect, it } from "vitest";

import {
  hearingProgress,
  hearingUrl,
  ownedCaseWorkspaceUrl,
  ownedHearingUrl,
  seededHearingUrl,
  trialIdFromSearch,
} from "./hearing-journey";

describe("hearing journey URL helpers", () => {
  const trialId = "trial_123e4567e89b42d3a456426614174000";

  it("reads a valid trial ID so a refresh can resume the hearing", () => {
    expect(trialIdFromSearch(`?trial=${trialId}&source=home`)).toBe(trialId);
  });

  it("rejects missing or malformed trial IDs", () => {
    expect(trialIdFromSearch("")).toBeUndefined();
    expect(trialIdFromSearch("?trial=%20%20")).toBeUndefined();
    expect(trialIdFromSearch("?trial=trial/unsafe")).toBeUndefined();
    expect(trialIdFromSearch("?trial=trial_legacy")).toBeUndefined();
  });

  it("builds only a V3 hearing resume URL", () => {
    expect(hearingUrl(trialId)).toBe(`/hearing/?trial=${trialId}`);
    expect(() => hearingUrl("trial_legacy")).toThrow();
  });

  it("builds encoded seeded and private-case launch URLs", () => {
    expect(seededHearingUrl("greenline-cold-chain")).toBe(
      "/hearing/?case=greenline-cold-chain",
    );
    expect(ownedHearingUrl("upload:abc/123")).toBe(
      "/hearing/?upload=upload%3Aabc%2F123",
    );
  });

  it("sends published private cases to a hearing and drafts back to review", () => {
    expect(ownedCaseWorkspaceUrl("published", "upload:abc")).toBe(
      "/hearing/?upload=upload%3Aabc",
    );
    expect(ownedCaseWorkspaceUrl("draft", "upload:abc")).toBe(
      "/cases/new?draft=upload%3Aabc",
    );
  });
});

describe("hearing progress guidance", () => {
  it("maps cross-examination to the questioning step and next-step coaching", () => {
    expect(hearingProgress("cross_examination", 0)).toMatchObject({
      step: 2,
      totalSteps: 4,
      label: "Question the witness",
      next: "Test the timeline with a focused leading question.",
    });
  });

  it("encourages natural iteration after the first witness answer", () => {
    expect(hearingProgress("cross_examination", 1)).toMatchObject({
      step: 2,
      label: "Follow the evidence",
      next: "Ask a follow-up or move to your closing when the record is clear.",
    });
  });

  it("treats deliberation and debrief as an active verdict transition", () => {
    expect(hearingProgress("deliberation", 1)).toMatchObject({
      step: 4,
      label: "Jury review",
    });
    expect(hearingProgress("complete", 1)).toMatchObject({
      step: 4,
      label: "Debrief ready",
    });
  });
});
