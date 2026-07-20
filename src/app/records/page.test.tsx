import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RecordsPage from "./page";

vi.mock("@/components/records/court-records-workspace", () => ({
  CourtRecordsWorkspace: ({
    initialSelection,
  }: {
    initialSelection:
      | { kind: "none" }
      | { kind: "valid"; trialId: string }
      | { kind: "invalid" };
  }) => (
    <section
      data-selection-kind={initialSelection.kind}
      data-selection-trial-id={
        initialSelection.kind === "valid"
          ? initialSelection.trialId
          : undefined
      }
    >
      Strict Court Records selection
      <span>{JSON.stringify(initialSelection)}</span>
    </section>
  ),
}));

const RECORDS_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));
const TRIAL_ID = `trial_${"a".repeat(32)}`;
const OTHER_TRIAL_ID = `trial_${"b".repeat(32)}`;

async function renderRecordsPage(
  trial?: string | string[],
): Promise<string> {
  const page = await RecordsPage({
    searchParams: Promise.resolve(
      trial === undefined ? {} : { trial },
    ),
  });
  return renderToStaticMarkup(page);
}

describe("owner-bound Court Records server boundary", () => {
  it("passes no initial selection when the trial query is absent", async () => {
    const markup = await renderRecordsPage();

    expect(markup).toContain('data-selection-kind="none"');
    expect(markup).not.toContain("data-selection-trial-id");
    expect(markup).toContain("Owner-bound audit");
    expect(markup).toContain('href="/cases"');
  });

  it("passes one exact V3 trial selection to the workspace", async () => {
    const markup = await renderRecordsPage(TRIAL_ID);

    expect(markup).toContain('data-selection-kind="valid"');
    expect(markup).toContain(`data-selection-trial-id="${TRIAL_ID}"`);
  });

  it.each([
    ["malformed", "ATTACKER_SECRET_TRIAL_CANARY"],
    ["padded", ` ${TRIAL_ID}`],
    ["duplicate", [TRIAL_ID, OTHER_TRIAL_ID]],
  ] as const)(
    "fails closed for a %s trial query without rendering its raw value",
    async (_label, trial) => {
      const markup = await renderRecordsPage(
        typeof trial === "string" ? trial : [...trial],
      );

      expect(markup).toContain('data-selection-kind="invalid"');
      expect(markup).not.toContain("data-selection-trial-id");
      if (typeof trial === "string") {
        expect(markup).not.toContain(trial);
        if (_label === "padded") {
          expect(markup).not.toContain(trial.trim());
        }
      } else {
        for (const rawValue of trial) {
          expect(markup).not.toContain(rawValue);
        }
      }
    },
  );

  it("keeps browser authority, persistence, and legacy reads out of the server page", async () => {
    const source = await readFile(RECORDS_PAGE, "utf8");

    for (const forbidden of [
      '"use client"',
      "convex/react",
      "_generated/api",
      "court-records-client",
      "useQuery",
      "useMutation",
      "useAction",
      "ownerId",
      "CASE_OWNER_COOKIE_NAME",
      "document.cookie",
      "localStorage",
      "sessionStorage",
      "api.trials",
      "trials.list",
      "trials.get",
    ]) {
      expect(source, `records page authority leak: ${forbidden}`).not.toContain(
        forbidden,
      );
    }

    expect(source).toContain("parseCourtRecordsInitialSelection");
    expect(source).toContain("<CourtRecordsWorkspace");
  });
});
