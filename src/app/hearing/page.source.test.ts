import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PAGE_PATH = fileURLToPath(new URL("./page.tsx", import.meta.url));

describe("V3 hearing page boundary", () => {
  it("uses the owner-bound hearing API and keeps legacy runtime paths out of the page", async () => {
    const source = await readFile(PAGE_PATH, "utf8");

    expect(source).toContain('fetch("/api/hearings"');
    expect(source).toContain("/commands");

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
      expect(source, `legacy hearing dependency: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});
