import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_PATHS = {
  page: fileURLToPath(new URL("./page.tsx", import.meta.url)),
  startRoute: fileURLToPath(
    new URL("../api/hearings/route.ts", import.meta.url),
  ),
  readRoute: fileURLToPath(
    new URL("../api/hearings/[trialId]/route.ts", import.meta.url),
  ),
  commandRoute: fileURLToPath(
    new URL("../api/hearings/[trialId]/commands/route.ts", import.meta.url),
  ),
  convexHttp: fileURLToPath(
    new URL("../../../convex/http.ts", import.meta.url),
  ),
  runtime: fileURLToPath(
    new URL("../../../convex/hearingRuntime.ts", import.meta.url),
  ),
} as const;

describe("V3 hearing page boundary", () => {
  it("uses the owner-bound hearing API and keeps legacy runtime paths out of the page", async () => {
    const entries = await Promise.all(
      Object.entries(SOURCE_PATHS).map(async ([name, path]) => [
        name,
        await readFile(path, "utf8"),
      ]),
    );
    const sources = Object.fromEntries(entries) as Record<
      keyof typeof SOURCE_PATHS,
      string
    >;
    const boundedCallGraph = Object.values(sources).join("\n");

    expect(sources.page).toContain('fetch("/api/hearings"');
    expect(sources.page).toContain("/commands");
    expect(sources.page).not.toContain('href="/records/"');
    expect(sources.startRoute).toContain('path: "/service/hearings/start"');
    expect(sources.readRoute).toContain('path: "/service/hearings/read"');
    expect(sources.commandRoute).toContain(
      'path: "/service/hearings/command"',
    );
    expect(sources.convexHttp).toContain('>("hearingRuntime:start")');
    expect(sources.convexHttp).toContain('>("hearingRuntime:read")');
    expect(sources.convexHttp).toContain('>("hearingRuntime:command")');
    expect(sources.runtime).toContain("export const start = internalAction");
    expect(sources.runtime).toContain("export const read = internalAction");
    expect(sources.runtime).toContain("export const command = internalAction");

    for (const forbidden of [
      "convex/react",
      "api.participatory",
      "api.trials",
      "api.voice",
      "answerGoldenWitness",
      "replyAsOpposingCounsel",
      "assessGoldenVerdict",
      "ElevenLabs",
      "Asha",
      "Vertex",
      "Elena",
    ]) {
      expect(
        boundedCallGraph,
        `legacy hearing dependency: ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });
});
