import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TRIAL_EVENTS_SOURCE_PATH = fileURLToPath(
  new URL("../../../convex/trialEvents.ts", import.meta.url),
);

describe("canonical trial-event browser boundary", () => {
  it("keeps low-level create and append writes behind internal mutations", async () => {
    const source = await readFile(TRIAL_EVENTS_SOURCE_PATH, "utf8");

    expect(source).toContain("export const createTrial = internalMutation");
    expect(source).toContain("export const append = internalMutation");
    expect(source).not.toMatch(
      /export const (?:createTrial|append)\s*=\s*mutation\s*\(/u,
    );
    expect(source).not.toContain('>("trialEvents:createTrial")');
    expect(source).not.toContain('>("trialEvents:append")');
  });

  it("keeps raw replay state and event payloads behind an internal query", async () => {
    const source = await readFile(TRIAL_EVENTS_SOURCE_PATH, "utf8");
    const reloadStart = source.indexOf("async function reloadForOwner(");
    const internalExport = source.indexOf(
      "export const reloadForOwnerSession = internalQuery",
    );

    expect(reloadStart).toBeGreaterThanOrEqual(0);
    expect(internalExport).toBeGreaterThan(reloadStart);
    const internalReloadSection = source.slice(reloadStart, internalExport);
    expect(internalReloadSection).toContain("stateJson: projection.stateJson");
    expect(internalReloadSection).toContain("events: page.map(publicEvent)");

    expect(source).not.toMatch(/export const reload\s*=\s*query\s*\(/u);
    expect(source).not.toContain('>("trialEvents:reload")');
    expect(source).toContain(
      "export const reloadForOwnerSession = internalQuery",
    );
  });
});
