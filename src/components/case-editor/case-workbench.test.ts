import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../../domain/case-graph";

import { publicationTargetIsCurrent } from "./case-workbench-lifecycle";

const UPLOAD_ID = `upload:${"a".repeat(48)}`;

function compiled() {
  return {
    caseGraph: createThreeWitnessCaseGraphV1Fixture(),
    report: {
      status: "ready_for_review" as const,
      warnings: [],
      uncertainties: [],
      injectionSignals: [],
      provenance: { factualFields: 1, sourceLinked: 1, explicitlyInferred: 0 },
    },
    upload: {
      uploadId: UPLOAD_ID,
      fileName: "case.md",
      mimeType: "text/markdown",
      sizeBytes: 100,
      contentDigest: "b".repeat(64),
      sourceSegmentCount: 1,
    },
  };
}

describe("publication lifecycle guard", () => {
  it("accepts only the exact active generation, upload, and case", () => {
    const current = compiled();
    const target = { generation: 4, uploadId: UPLOAD_ID, caseId: current.caseGraph.caseId };
    expect(publicationTargetIsCurrent(target, 4, current)).toBe(true);
    expect(publicationTargetIsCurrent(target, 5, current)).toBe(false);
    expect(publicationTargetIsCurrent({ ...target, uploadId: `upload:${"c".repeat(48)}` }, 4, current)).toBe(false);
    expect(publicationTargetIsCurrent({ ...target, caseId: `case:${"d".repeat(48)}` }, 4, current)).toBe(false);
    expect(publicationTargetIsCurrent(target, 4, null)).toBe(false);
  });

  it("keeps the educational and not-legal-advice disclaimer on the upload surface", () => {
    const source = readFileSync(new URL("./case-workbench.tsx", import.meta.url), "utf8");

    expect(source).toContain("fictional educational simulation, not legal advice");
    expect(source).toContain("does not predict real-case outcomes");
  });
});
