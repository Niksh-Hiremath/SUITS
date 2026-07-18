import { describe, expect, it } from "vitest";

import {
  CaseGraphSchema,
  type CaseGraphV1,
  type Provenance,
} from "../case-graph";
import {
  getSeededCaseById,
  getSeededCaseBySlug,
  listSeededCaseGraphs,
  listSeededCases,
} from "./index";

type ProvenanceRecord = {
  label: string;
  provenance: Provenance[];
};

function factualProvenanceRecords(graph: CaseGraphV1): ProvenanceRecord[] {
  return [
    ...graph.parties.map((item) => ({ label: item.partyId, provenance: item.provenance })),
    ...graph.issues.map((item) => ({ label: item.issueId, provenance: item.provenance })),
    ...graph.timeline.map((item) => ({ label: item.timelineEventId, provenance: item.provenance })),
    ...graph.facts.map((item) => ({ label: item.factId, provenance: item.provenance })),
    ...graph.evidence.map((item) => ({ label: item.evidenceId, provenance: item.provenance })),
    ...graph.witnesses.map((item) => ({ label: item.witnessId, provenance: item.provenance })),
    ...graph.witnesses.flatMap((witness) =>
      witness.priorStatements.map((item) => ({
        label: item.priorStatementId,
        provenance: item.provenance,
      })),
    ),
    ...graph.contradictions.map((item) => ({
      label: item.contradictionId,
      provenance: item.provenance,
    })),
  ];
}

function allProvenance(graph: CaseGraphV1): Provenance[] {
  return [
    ...graph.jurisdictionProfile.provenance,
    ...factualProvenanceRecords(graph).flatMap((record) => record.provenance),
    ...graph.settlement.provenance,
    ...graph.juryInstructions.flatMap((instruction) => instruction.provenance),
  ];
}

describe("seeded case catalog", () => {
  it("publishes exactly three distinct, schema-valid CaseGraph v1 cases", () => {
    const catalog = listSeededCases();
    const graphs = listSeededCaseGraphs();

    expect(catalog).toHaveLength(3);
    expect(graphs).toHaveLength(3);
    expect(new Set(catalog.map((item) => item.catalogId)).size).toBe(3);
    expect(new Set(catalog.map((item) => item.slug)).size).toBe(3);
    expect(new Set(catalog.map((item) => item.caseId)).size).toBe(3);
    expect(new Set(catalog.map((item) => item.title)).size).toBe(3);
    expect(new Set(catalog.map((item) => item.category)).size).toBe(3);

    graphs.forEach((graph) => {
      expect(CaseGraphSchema.parse(graph)).toEqual(graph);
    });
  });

  it("keeps catalog metadata synchronized with each case graph", () => {
    listSeededCases().forEach((entry) => {
      expect(entry.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(entry.estimatedHearingMinutes).toBeGreaterThan(0);

      const graph = getSeededCaseBySlug(entry.slug);
      expect(graph).toBeDefined();
      if (graph === undefined) throw new Error(`Missing seeded case ${entry.slug}`);

      expect(entry).toMatchObject({
        caseId: graph.caseId,
        title: graph.title,
        summary: graph.summary,
        witnessCount: graph.witnesses.length,
        evidenceCount: graph.evidence.length,
        issueCount: graph.issues.length,
        educationalDisclaimer: graph.educationalDisclaimer,
      });
      expect(getSeededCaseById(entry.caseId)).toEqual(graph);
    });
  });

  it("provides multiple witnesses, evidence disputes, settlement, instructions, and a clear disclaimer", () => {
    listSeededCaseGraphs().forEach((graph) => {
      expect(graph.witnesses.length).toBeGreaterThanOrEqual(2);
      expect(graph.witnesses.every((witness) => witness.priorStatements.length > 0)).toBe(true);
      expect(graph.evidence.length).toBeGreaterThan(0);
      expect(graph.contradictions.length).toBeGreaterThan(0);
      expect(graph.settlement.enabled).toBe(true);
      expect(graph.settlement.participants.length).toBeGreaterThanOrEqual(2);
      expect(graph.juryInstructions.length).toBeGreaterThan(0);
      expect(graph.educationalDisclaimer).toMatch(/fictional educational simulation only/i);
      expect(graph.educationalDisclaimer).toMatch(/not legal advice/i);
    });
  });

  it("source-links every factual record and accounts for every source segment", () => {
    listSeededCaseGraphs().forEach((graph) => {
      const sourceSegmentIds = new Set(
        graph.sourceSegments.map((segment) => segment.sourceSegmentId),
      );
      const factualRecords = factualProvenanceRecords(graph);

      factualRecords.forEach((record) => {
        const hasSourceLink = record.provenance.some(
          (entry) => entry.kind === "source" && entry.sourceSegmentIds.length > 0,
        );
        expect(hasSourceLink, `${graph.caseId}:${record.label} lacks source provenance`).toBe(true);
      });

      graph.facts.forEach((fact) => {
        const groundedOrUncertain = fact.provenance.some(
          (entry) =>
            (entry.kind === "source" && entry.sourceSegmentIds.length > 0) ||
            entry.kind === "inferred",
        );
        expect(groundedOrUncertain, `${graph.caseId}:${fact.factId} lacks fact provenance`).toBe(true);
      });

      const citedSegmentIds = new Set([
        ...allProvenance(graph).flatMap((entry) => entry.sourceSegmentIds),
        ...graph.compilerMetadata.warnings.flatMap((warning) => warning.sourceSegmentIds),
        ...graph.compilerMetadata.uncertainties.flatMap(
          (uncertainty) => uncertainty.sourceSegmentIds,
        ),
      ]);
      expect(
        [...sourceSegmentIds].filter((sourceSegmentId) => !citedSegmentIds.has(sourceSegmentId)),
      ).toEqual([]);
    });
  });

  it("returns defensive clones and handles unknown catalog lookups", () => {
    const first = getSeededCaseBySlug("HARBORLIGHT-RIG-NEGLIGENCE");
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("Expected Harborlight seeded case");
    first.title = "Local mutation";

    expect(getSeededCaseBySlug("harborlight-rig-negligence")?.title).toBe(
      "Elena Park v. Harborlight Community Theater",
    );
    expect(getSeededCaseBySlug("missing-case")).toBeUndefined();
    expect(getSeededCaseById("missing_case_id")).toBeUndefined();
  });
});
