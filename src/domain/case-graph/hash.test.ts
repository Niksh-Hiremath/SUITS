import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "./fixture";
import {
  assertCaseGraphContentHash,
  canonicalizeCaseGraphV1,
  collectCaseGraphProvenanceIds,
  computeCaseGraphContentHash,
  sha256Utf8,
} from "./hash";

describe("CaseGraph content hashing", () => {
  it("implements the standard SHA-256 UTF-8 vectors", () => {
    expect(sha256Utf8("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Utf8("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic and changes when private graph knowledge changes", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const first = computeCaseGraphContentHash(graph);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(computeCaseGraphContentHash(JSON.parse(canonicalizeCaseGraphV1(graph)))).toBe(first);
    expect(assertCaseGraphContentHash(graph, first)).toEqual(graph);
    expect(collectCaseGraphProvenanceIds(graph)).toContain("prov_fact_complaint");

    const changed = structuredClone(graph);
    changed.witnesses[0].knowledgeBoundary.allowedTopics.push("Private added topic");
    expect(computeCaseGraphContentHash(changed)).not.toBe(first);
    expect(() => assertCaseGraphContentHash(changed, first)).toThrow(
      "CASE_GRAPH_CONTENT_HASH_MISMATCH",
    );
  });
});
