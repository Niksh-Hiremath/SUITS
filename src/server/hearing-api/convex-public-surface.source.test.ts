import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CONVEX_DIRECTORY = fileURLToPath(
  new URL("../../../convex/", import.meta.url),
);

const LEGACY_MODULES = [
  "artifacts.ts",
  "autonomous.ts",
  "cases.ts",
  "evals.ts",
  "events.ts",
  "participatory.ts",
  "traces.ts",
  "trials.ts",
  "voice.ts",
] as const;

const SURFACE_MODULES = [...LEGACY_MODULES, "caseUploads.ts"] as const;

type PublicFunctionKind = "action" | "mutation" | "query";

type PublicFunction = Readonly<{
  module: (typeof SURFACE_MODULES)[number];
  name: string;
  kind: PublicFunctionKind;
}>;

const EXPECTED_PUBLIC_FUNCTIONS = [
  {
    module: "caseUploads.ts",
    name: "generateUploadUrl",
    kind: "mutation",
  },
  {
    module: "caseUploads.ts",
    name: "registerStoredUpload",
    kind: "mutation",
  },
  { module: "caseUploads.ts", name: "getLatest", kind: "query" },
  { module: "caseUploads.ts", name: "listMine", kind: "query" },
  { module: "caseUploads.ts", name: "getDownloadUrl", kind: "query" },
  {
    module: "caseUploads.ts",
    name: "listSourceSegments",
    kind: "query",
  },
] as const satisfies readonly PublicFunction[];

function publicFunctions(
  module: PublicFunction["module"],
  source: string,
): PublicFunction[] {
  const pattern =
    /export\s+const\s+(\w+)\s*=\s*(action|mutation|query)\s*\(/gu;
  return [...source.matchAll(pattern)].map((match) => ({
    module,
    name: match[1],
    kind: match[2] as PublicFunctionKind,
  }));
}

describe("Convex public function allowlist", () => {
  it("exposes only owner-authenticated case-upload functions", async () => {
    const sources = new Map(
      await Promise.all(
        SURFACE_MODULES.map(async (module) => [
          module,
          await readFile(path.join(CONVEX_DIRECTORY, module), "utf8"),
        ] as const),
      ),
    );
    const actual = SURFACE_MODULES.flatMap((module) =>
      publicFunctions(module, sources.get(module) ?? ""),
    );

    expect(actual).toEqual(EXPECTED_PUBLIC_FUNCTIONS);

    const caseUploads = sources.get("caseUploads.ts") ?? "";
    for (const expected of EXPECTED_PUBLIC_FUNCTIONS) {
      const marker = `export const ${expected.name} = ${expected.kind}(`;
      const start = caseUploads.indexOf(marker);
      expect(start, `missing public function ${expected.name}`).toBeGreaterThanOrEqual(
        0,
      );
      const nextExport = caseUploads.indexOf("export const ", start + marker.length);
      const section = caseUploads.slice(
        start,
        nextExport === -1 ? caseUploads.length : nextExport,
      );
      expect(section).toContain("await ctx.auth.getUserIdentity()");
      expect(section).toContain('throw new Error("AUTHENTICATION_REQUIRED")');
    }
  });
});
