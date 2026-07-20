import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("SUITS landing-page product contract", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

  it("describes the canonical multi-witness event-engine product", () => {
    expect(source).toContain("Three seeded cases");
    expect(source).toContain("multiple knowledge-isolated witnesses");
    expect(source).toContain("Deterministic trial engine");
    expect(source).toContain("Records + debrief");
  });

  it("does not market the retired golden-case or manager-chain runtime", () => {
    expect(source).not.toContain("Asha Mehta v. Vertex Logistics");
    expect(source).not.toContain("Golden case");
    expect(source).not.toContain("Court Director");
    expect(source).not.toContain("Managed agent team");
  });
});
