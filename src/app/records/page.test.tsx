import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "../page";
import RecordsPage from "./page";

const APP_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));
const RECORDS_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

async function appPageSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return appPageSources(entryPath);
      }
      if (entry.isFile() && entry.name === "page.tsx") {
        return [await readFile(entryPath, "utf8")];
      }
      return [];
    }),
  );
  return sources.flat();
}

describe("legacy records migration boundary", () => {
  it("does not link any active app page to the legacy records viewer", async () => {
    const sources = await appPageSources(APP_DIRECTORY);

    for (const source of sources) {
      expect(source).not.toMatch(
        /href\s*=\s*(?:["']\/records(?:\/|["'])|\{\s*["']\/records)/,
      );
    }

    const home = renderToStaticMarkup(<Home />);
    expect(home).toContain('href="/cases/new"');
    expect(home).not.toContain('href="/records');
  });

  it("renders a static migration notice without legacy Convex reads", async () => {
    const source = await readFile(RECORDS_PAGE, "utf8");
    const markup = renderToStaticMarkup(<RecordsPage />);

    for (const forbidden of [
      '"use client"',
      "convex/react",
      "_generated/api",
      "useQuery",
      "api.trials",
      "trials.list",
      "trials.get",
    ]) {
      expect(source, `legacy records dependency: ${forbidden}`).not.toContain(
        forbidden,
      );
    }

    expect(markup).toContain("Owner-bound Court Records are coming next.");
    expect(markup).toContain("No unauthenticated trial reads");
    expect(markup).toContain('href="/cases"');
    expect(markup).not.toContain("Trial history");
    expect(markup).not.toContain("Loading court record");
  });
});
