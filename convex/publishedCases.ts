import { v } from "convex/values";
import { z } from "zod";

import {
  OwnedCaseListResponseSchema,
  type OwnedCaseSummary,
} from "../src/domain/case-api";
import { CaseGraphV1Schema } from "../src/domain/case-graph";
import { internalQuery } from "./_generated/server";
import { CaseServiceOwnerIdSchema } from "./caseServiceBoundary";

export const OwnedCaseListRequestSchema = z
  .object({ ownerId: CaseServiceOwnerIdSchema })
  .strict();

export type OwnedCaseListGraphRecord = Readonly<{
  caseId: string;
  version: number;
  lifecycle: string;
  visibility: string;
  ownerId?: string;
  uploadId?: string;
  title: string;
  graphJson: string;
  graphSchemaVersion: string;
  createdBy: string;
  createdAt: number;
}>;

export type OwnedCaseListUploadRecord = Readonly<{
  uploadId: string;
  version: number;
  caseId: string;
  caseVersion?: number;
  ownerId: string;
  status: string;
}>;

function conflict(): never {
  throw new Error("CASE_OWNED_CASE_CONFLICT");
}

export function reconstructOwnedCaseList(
  requestValue: unknown,
  graphRecords: readonly OwnedCaseListGraphRecord[],
  uploadRecords: readonly OwnedCaseListUploadRecord[],
): { cases: OwnedCaseSummary[] } {
  const request = OwnedCaseListRequestSchema.parse(requestValue);
  const latestByCase = new Map<string, OwnedCaseListGraphRecord>();
  const graphVersions = new Set<string>();
  for (const record of graphRecords) {
    if (record.ownerId !== request.ownerId) continue;
    if (record.lifecycle !== "draft" && record.lifecycle !== "published") continue;
    const expectedVersion = record.lifecycle === "draft" ? 1 : 2;
    if (
      record.version !== expectedVersion ||
      record.visibility !== "private" ||
      record.createdBy !== "user"
    ) {
      conflict();
    }
    const versionKey = `${record.caseId}:${record.version}`;
    if (graphVersions.has(versionKey)) conflict();
    graphVersions.add(versionKey);
    const existing = latestByCase.get(record.caseId);
    if (!existing || record.version > existing.version) latestByCase.set(record.caseId, record);
  }

  const selectedGraphs = [...latestByCase.values()];
  const indexedUploads = new Map<string, OwnedCaseListUploadRecord>();
  const uploadVersions = new Set<string>();
  for (const upload of uploadRecords) {
    const relevant = selectedGraphs.some((graph) => graph.uploadId !== undefined
      ? graph.uploadId === upload.uploadId
      : graph.caseId === upload.caseId);
    if (!relevant) continue;
    if (upload.ownerId !== request.ownerId) conflict();
    const versionKey = `${upload.uploadId}:${upload.version}`;
    if (uploadVersions.has(versionKey)) conflict();
    uploadVersions.add(versionKey);
    if (upload.version === 1) {
      if (upload.status !== "uploaded" || upload.caseVersion !== undefined) conflict();
      continue;
    }
    if (
      upload.version !== 2 ||
      upload.status !== "indexed" ||
      upload.caseVersion !== 1 ||
      indexedUploads.has(upload.caseId)
    ) {
      conflict();
    }
    indexedUploads.set(upload.caseId, upload);
  }

  const cases: OwnedCaseSummary[] = [];
  for (const record of selectedGraphs.sort((left, right) => right.createdAt - left.createdAt)) {
    const lifecycle = record.lifecycle;
    if (lifecycle !== "draft" && lifecycle !== "published") conflict();
    const upload = indexedUploads.get(record.caseId);
    if (!upload || (record.uploadId !== undefined && record.uploadId !== upload.uploadId)) conflict();
    let value: unknown;
    try {
      value = JSON.parse(record.graphJson) as unknown;
    } catch {
      conflict();
    }
    const graph = CaseGraphV1Schema.safeParse(value);
    if (
      !graph.success ||
      graph.data.caseId !== record.caseId ||
      graph.data.status !== lifecycle ||
      graph.data.title !== record.title ||
      graph.data.schemaVersion !== record.graphSchemaVersion
    ) {
      conflict();
    }
    cases.push({
      uploadId: upload.uploadId,
      caseId: graph.data.caseId,
      title: graph.data.title,
      summary: graph.data.summary,
      witnessCount: graph.data.witnesses.length,
      evidenceCount: graph.data.evidence.length,
      status: lifecycle,
      recordVersion: expectedRecordVersion(lifecycle),
      updatedAt: record.createdAt,
    });
  }
  return OwnedCaseListResponseSchema.parse({ cases: cases.slice(0, 100) });
}

function expectedRecordVersion(lifecycle: "draft" | "published"): 1 | 2 {
  return lifecycle === "draft" ? 1 : 2;
}

export const listOwnedCases = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const request = OwnedCaseListRequestSchema.parse(args);
    const [drafts, publications] = await Promise.all([
      ctx.db
        .query("caseGraphs")
        .withIndex("by_owner_lifecycle", (index) =>
          index.eq("ownerId", request.ownerId).eq("lifecycle", "draft"),
        )
        .order("desc")
        .take(100),
      ctx.db
        .query("caseGraphs")
        .withIndex("by_owner_lifecycle", (index) =>
          index.eq("ownerId", request.ownerId).eq("lifecycle", "published"),
        )
        .order("desc")
        .take(100),
    ]);
    const graphs = [...drafts, ...publications];
    const latestByCase = new Map<string, (typeof graphs)[number]>();
    for (const graph of graphs) {
      const current = latestByCase.get(graph.caseId);
      if (!current || graph.version > current.version) latestByCase.set(graph.caseId, graph);
    }
    const uploadGroups = await Promise.all(
      [...latestByCase.values()].map(async (graph) => {
        const uploadId = graph.uploadId;
        return uploadId
          ? await ctx.db
            .query("caseUploads")
            .withIndex("by_upload_version", (index) => index.eq("uploadId", uploadId))
            .take(3)
          : await ctx.db
            .query("caseUploads")
            .withIndex("by_case_version", (index) =>
              index.eq("caseId", graph.caseId).eq("caseVersion", 1),
            )
            .take(3);
      }),
    );
    return reconstructOwnedCaseList(request, graphs, uploadGroups.flat());
  },
});
