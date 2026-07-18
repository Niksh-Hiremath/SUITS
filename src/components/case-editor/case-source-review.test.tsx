import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../../domain/case-graph";

import {
  CaseSourceReview,
  buildCaseSourceReviewModel,
  formatSourceLocator,
} from "./case-source-review";

describe("CaseSourceReview", () => {
  it("retains every source segment and maps explicit entity provenance back to it", () => {
    const caseGraph = createThreeWitnessCaseGraphV1Fixture();
    const model = buildCaseSourceReviewModel(caseGraph);

    expect(model.segments.map(({ source }) => source)).toEqual(caseGraph.sourceSegments);
    expect(model.unresolvedProvenance).toEqual([]);
    expect(model.provenanceCount).toBeGreaterThan(caseGraph.facts.length);

    const fact = caseGraph.facts[0];
    const factProvenance = fact.provenance[0];
    const citedSegment = model.segments.find(
      ({ source }) => source.sourceSegmentId === factProvenance.sourceSegmentIds[0],
    );
    expect(citedSegment?.citations).toContainEqual(expect.objectContaining({
      entityType: "Fact",
      entityId: fact.factId,
      entityLabel: fact.proposition,
      provenanceId: factProvenance.provenanceId,
      sourceSegmentIds: factProvenance.sourceSegmentIds,
    }));

    expect(model.unlinkedProvenance.length).toBeGreaterThan(0);
    expect(model.unlinkedProvenance.every((record) => record.sourceSegmentIds.length === 0)).toBe(true);
  });

  it("renders complete source metadata without controls or compiler-internal records", () => {
    const caseGraph = createThreeWitnessCaseGraphV1Fixture();
    const hiddenReasoningSentinel = "PRIVATE_MODEL_REASONING_MUST_NOT_RENDER";
    caseGraph.compilerMetadata.warnings.push({
      code: "private_reasoning_sentinel",
      message: hiddenReasoningSentinel,
      sourceSegmentIds: [caseGraph.sourceSegments[0].sourceSegmentId],
    });

    const markup = renderToStaticMarkup(<CaseSourceReview caseGraph={caseGraph} />);
    for (const segment of caseGraph.sourceSegments) {
      expect(markup).toContain(segment.sourceSegmentId);
      expect(markup).toContain(segment.sourceId);
      expect(markup).toContain(segment.documentName);
      expect(markup).toContain(segment.mimeType);
      expect(markup).toContain(segment.sha256);
    }
    expect(markup.match(/<pre/g)).toHaveLength(caseGraph.sourceSegments.length);
    expect(markup).toContain("never requests or displays private model reasoning");
    expect(markup).not.toContain(hiddenReasoningSentinel);
    expect(markup).not.toMatch(/<(?:input|textarea|select|button)\b/u);
  });

  it("formats page and text locators without losing their exact bounds", () => {
    expect(formatSourceLocator({ kind: "page", page: 7, label: "Exhibit C" })).toBe(
      "Page 7 · Exhibit C",
    );
    expect(formatSourceLocator({ kind: "page", page: 2, label: null })).toBe("Page 2");
    expect(formatSourceLocator({ kind: "text", startOffset: 120, endOffset: 480 })).toBe(
      "Characters 120–480",
    );
  });
});
