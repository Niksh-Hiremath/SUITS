import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";

import {
  CaseApiErrorResponseSchema,
  CaseCompileResponseSchema,
  OwnedCaseListResponseSchema,
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
    const publishedGraph = {
      ...graph,
      caseId: `case:${"b".repeat(48)}`,
      status: "published" as const,
    };
    expect(
      CasePublishResponseSchema.parse({
        caseId: publishedGraph.caseId,
        version: 2,
        published: true,
        replayed: false,
        caseGraph: publishedGraph,
      }).published,
    ).toBe(true);
    expect(
      OwnedCaseListResponseSchema.parse({
        cases: [{
          uploadId: `upload:${"a".repeat(48)}`,
          caseId: publishedGraph.caseId,
          title: publishedGraph.title,
          summary: publishedGraph.summary,
          witnessCount: publishedGraph.witnesses.length,
          evidenceCount: publishedGraph.evidence.length,
          status: "published",
          recordVersion: 2,
          updatedAt: 1,
        }],
      }).cases,
    ).toHaveLength(1);
  });

  it("rejects malformed success and error payloads", () => {
    expect(() => CaseCompileResponseSchema.parse({ caseGraph: {} })).toThrow();
    expect(() => CasePublishResponseSchema.parse({ published: "yes" })).toThrow();
    expect(() => CaseApiErrorResponseSchema.parse({ error: { message: "Missing code" } })).toThrow();
  });
});
