import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PAGE_PATH = fileURLToPath(new URL("./page.tsx", import.meta.url));
const ATLAS_PATH = fileURLToPath(
  new URL(
    "../../../components/courtroom/courtroom-visual-atlas.tsx",
    import.meta.url,
  ),
);

describe("courtroom visual atlas boundary", () => {
  it("is server-gated and structurally unavailable in production", async () => {
    const page = await readFile(PAGE_PATH, "utf8");

    expect(page).toContain('process.env.NODE_ENV === "production"');
    expect(page).toContain('process.env.SUITS_ENABLE_VISUAL_ATLAS !== "1"');
    expect(page).toContain("notFound()");
    expect(page).not.toContain("NEXT_PUBLIC");
  });

  it("renders only strict synthetic fixtures through the real stage", async () => {
    const atlas = await readFile(ATLAS_PATH, "utf8");

    expect(atlas).toContain("createCourtroomVisualFixture(stateId)");
    expect(atlas).toContain("CourtroomPresentationFrameSchema.parse");
    expect(atlas).toContain("<CourtroomStage");
    expect(atlas).toContain(
      "audibleSemanticPerformance={fixture.audibleSemanticPerformance}",
    );
    expect(atlas).not.toContain("view.transcript");
    expect(atlas).not.toContain("outputHash");
    expect(atlas).not.toContain("settlementTerms");
  });
});
