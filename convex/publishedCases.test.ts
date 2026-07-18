import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../src/domain/case-graph";
import {
  reconstructOwnedCaseList,
  type OwnedCaseListGraphRecord,
  type OwnedCaseListUploadRecord,
} from "./publishedCases";

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const CASE_ID = `case:${"b".repeat(48)}`;
const UPLOAD_ID = `upload:${"a".repeat(48)}`;

function records(): {
  graph: OwnedCaseListGraphRecord;
  upload: OwnedCaseListUploadRecord;
} {
  const caseGraph = {
    ...createThreeWitnessCaseGraphV1Fixture(),
    caseId: CASE_ID,
    status: "published" as const,
  };
  return {
    graph: {
      caseId: CASE_ID,
      version: 2,
      lifecycle: "published",
      visibility: "private",
      ownerId: OWNER_ID,
      uploadId: UPLOAD_ID,
      title: caseGraph.title,
      graphJson: JSON.stringify(caseGraph),
      graphSchemaVersion: caseGraph.schemaVersion,
      createdBy: "user",
      createdAt: 42,
    },
    upload: {
      uploadId: UPLOAD_ID,
      version: 2,
      caseId: CASE_ID,
      caseVersion: 1,
      ownerId: OWNER_ID,
      status: "indexed",
    },
  };
}

describe("owned case library boundary", () => {
  it("returns bounded owner-scoped summaries with resumable upload IDs", () => {
    const record = records();
    const result = reconstructOwnedCaseList(
      { ownerId: OWNER_ID },
      [record.graph],
      [record.upload],
    );
    expect(result.cases).toEqual([
      expect.objectContaining({
        uploadId: UPLOAD_ID,
        caseId: CASE_ID,
        status: "published",
        recordVersion: 2,
        updatedAt: 42,
      }),
    ]);
  });

  it("does not expose another owner's records", () => {
    const record = records();
    expect(
      reconstructOwnedCaseList(
        { ownerId: "owner:223e4567-e89b-42d3-a456-426614174000" },
        [record.graph],
        [record.upload],
      ),
    ).toEqual({ cases: [] });
  });

  it("fails closed when a publication has no canonical indexed upload", () => {
    const record = records();
    expect(() => reconstructOwnedCaseList({ ownerId: OWNER_ID }, [record.graph], [])).toThrow(
      "CASE_OWNED_CASE_CONFLICT",
    );
  });

  it("rejects uploads that cannot be reopened by the replay boundary", () => {
    const record = records();
    expect(() => reconstructOwnedCaseList(
      { ownerId: OWNER_ID },
      [record.graph],
      [{ ...record.upload, caseVersion: 2 }],
    )).toThrow("CASE_OWNED_CASE_CONFLICT");
    expect(() => reconstructOwnedCaseList(
      { ownerId: OWNER_ID },
      [record.graph],
      [record.upload, { ...record.upload }],
    )).toThrow("CASE_OWNED_CASE_CONFLICT");
    expect(() => reconstructOwnedCaseList(
      { ownerId: OWNER_ID },
      [record.graph],
      [{ ...record.upload, ownerId: "owner:223e4567-e89b-42d3-a456-426614174000" }],
    )).toThrow("CASE_OWNED_CASE_CONFLICT");
  });

  it("lists an unpublished draft and prefers its later publication", () => {
    const record = records();
    const draftGraph = { ...JSON.parse(record.graph.graphJson), status: "draft" } as Record<string, unknown>;
    const draft: OwnedCaseListGraphRecord = {
      ...record.graph,
      version: 1,
      lifecycle: "draft",
      graphJson: JSON.stringify(draftGraph),
      createdAt: 20,
    };
    const draftOnly = reconstructOwnedCaseList(
      { ownerId: OWNER_ID },
      [draft],
      [record.upload],
    );
    expect(draftOnly.cases[0]).toEqual(expect.objectContaining({ status: "draft", recordVersion: 1 }));

    const published = reconstructOwnedCaseList(
      { ownerId: OWNER_ID },
      [draft, record.graph],
      [record.upload],
    );
    expect(published.cases).toHaveLength(1);
    expect(published.cases[0]).toEqual(expect.objectContaining({ status: "published" }));
  });

  it("rejects duplicate lifecycle records regardless of query order", () => {
    const record = records();
    const draftGraph = { ...JSON.parse(record.graph.graphJson), status: "draft" } as Record<string, unknown>;
    const draft: OwnedCaseListGraphRecord = {
      ...record.graph,
      version: 1,
      lifecycle: "draft",
      graphJson: JSON.stringify(draftGraph),
    };
    expect(() => reconstructOwnedCaseList(
      { ownerId: OWNER_ID },
      [record.graph, draft, { ...draft }],
      [record.upload],
    )).toThrow("CASE_OWNED_CASE_CONFLICT");
  });
});
