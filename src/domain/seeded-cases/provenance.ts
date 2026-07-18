import type { Provenance } from "../case-graph";

export function sourceProvenance(
  provenanceId: string,
  sourceSegmentIds: string[],
  note: string,
  confidence = 1,
): Provenance {
  return {
    provenanceId,
    kind: "source",
    sourceSegmentIds,
    note,
    confidence,
  };
}

export function authoringProvenance(provenanceId: string, note: string): Provenance {
  return {
    provenanceId,
    kind: "authoring",
    sourceSegmentIds: [],
    note,
    confidence: 1,
  };
}
