import { describe, expect, it } from "vitest";

import {
  CourtRecordsInitialSelectionSchema,
  courtRecordsUrl,
  parseCourtRecordsInitialSelection,
} from "./navigation";

const TRIAL_ID = `trial_${"a".repeat(32)}`;

describe("Court Records navigation contract", () => {
  it("builds an exact Records URL from a strict V3 trial ID", () => {
    expect(courtRecordsUrl(TRIAL_ID)).toBe(`/records?trial=${TRIAL_ID}`);
  });

  it("rejects malformed trial IDs instead of encoding attacker-controlled navigation", () => {
    for (const value of [
      "",
      "trial_legacy",
      ` ${TRIAL_ID}`,
      `${TRIAL_ID} `,
      TRIAL_ID.toUpperCase(),
      `${TRIAL_ID}&ownerId=owner_attacker`,
      `${TRIAL_ID}#fragment`,
      `${TRIAL_ID}/download`,
      `trial_${"a".repeat(31)}%61`,
    ]) {
      expect(() => courtRecordsUrl(value)).toThrow();
    }
  });

  it("distinguishes no selection from one strict V3 trial selection", () => {
    expect(parseCourtRecordsInitialSelection(undefined)).toEqual({
      kind: "none",
    });
    expect(parseCourtRecordsInitialSelection(TRIAL_ID)).toEqual({
      kind: "valid",
      trialId: TRIAL_ID,
    });
  });

  it("fails closed for malformed, padded, or duplicate trial parameters", () => {
    for (const value of [
      "",
      "trial_legacy",
      ` ${TRIAL_ID}`,
      TRIAL_ID.toUpperCase(),
      [TRIAL_ID],
      [TRIAL_ID, `trial_${"b".repeat(32)}`],
    ] as const) {
      const selection = parseCourtRecordsInitialSelection(value);
      expect(selection).toEqual({ kind: "invalid" });
      expect(Object.keys(selection)).toEqual(["kind"]);
    }
  });

  it("exports a strict serializable selection schema", () => {
    expect(
      CourtRecordsInitialSelectionSchema.safeParse({
        kind: "valid",
        trialId: TRIAL_ID,
      }).success,
    ).toBe(true);
    expect(
      CourtRecordsInitialSelectionSchema.safeParse({
        kind: "invalid",
        trialId: "attacker-controlled",
      }).success,
    ).toBe(false);
  });
});
