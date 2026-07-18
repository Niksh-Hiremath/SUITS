import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";

import {
  CaseApiErrorResponseSchema,
  CaseCompileResponseSchema,
  CasePublishResponseSchema,
} from "./schema";

describe("browser case API contracts", () => {
  it("accepts canonical compile and publish responses", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    expect(
      CaseCompileResponseSchema.parse({
        caseGraph: graph,
        report: {
          schemaVersion: "case-compiler.validation.v2",
          warnings: [],
          uncertainties: [],
          provenance: { factualFields: 3, sourceLinked: 2, explicitlyInferred: 1 },
          injectionSignals: [],
        },
        upload: {
          uploadId: `upload:${"a".repeat(48)}`,
          fileName: "packet.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
          sourceSegmentCount: graph.sourceSegments.length,
        },
      }).caseGraph.caseId,
    ).toBe(graph.caseId);
    expect(
      CasePublishResponseSchema.parse({
        caseId: graph.caseId,
        version: 2,
        published: true,
        replayed: false,
      }).published,
    ).toBe(true);
  });

  it("rejects malformed success and error payloads", () => {
    expect(() => CaseCompileResponseSchema.parse({ caseGraph: {} })).toThrow();
    expect(() => CasePublishResponseSchema.parse({ published: "yes" })).toThrow();
    expect(() => CaseApiErrorResponseSchema.parse({ error: { message: "Missing code" } })).toThrow();
  });
});
