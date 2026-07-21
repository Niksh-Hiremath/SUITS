import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PREFLIGHT_PAGE = fileURLToPath(
  new URL("./preflight/page.tsx", import.meta.url),
);
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx"]);
const DIRECT_PREFLIGHT_DESTINATION =
  /["'`]\/preflight\/?(?:[?#][^"'`]*)?["'`]/u;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      if (!entry.isFile()) return [];
      if (!TYPESCRIPT_EXTENSIONS.has(extname(entry.name))) return [];
      if (/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)) return [];
      return [path];
    }),
  );
  return files.flat();
}

describe("application navigation boundary", () => {
  it("keeps system preflight available only through its direct URL", async () => {
    const files = await sourceFiles(SOURCE_ROOT);
    const inspected = await Promise.all(
      files.map(async (path) => ({ path, source: await readFile(path, "utf8") })),
    );
    const offenders = inspected
      .filter(({ source }) => DIRECT_PREFLIGHT_DESTINATION.test(source))
      .map(({ path }) => relative(SOURCE_ROOT, path));

    expect(offenders).toEqual([]);
    await expect(readFile(PREFLIGHT_PAGE, "utf8")).resolves.toContain(
      "PreflightClient",
    );
  });
});
