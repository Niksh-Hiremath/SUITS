import { v } from "convex/values";
import { z } from "zod";

import { CaseIngestionEntityIdSchema } from "../src/server/case-ingestion/schema";
import { internalMutation } from "./_generated/server";
import { CaseServiceOwnerIdSchema } from "./caseServiceBoundary";

export const CaseUploadCleanupRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    storageId: z.string().trim().min(1).max(256),
  })
  .strict();

export const CaseUploadCleanupResponseSchema = z
  .object({
    deleted: z.boolean(),
  })
  .strict();

export type CaseUploadCleanupResponse = z.infer<typeof CaseUploadCleanupResponseSchema>;

export type CaseUploadCleanupReference = Readonly<{
  ownerId: string;
  uploadId: string;
}>;

export type CaseUploadCleanupDecision = Readonly<
  | { deleteStorage: true; reason: "unreferenced" }
  | { deleteStorage: false; reason: "matching_registration" | "conflict" }
>;

/**
 * The externally visible result intentionally collapses matching registrations,
 * foreign references, and conflicts to `{ deleted: false }`. The richer reason
 * remains mutation-local so ownership state cannot leak through this boundary.
 */
export function decideCaseUploadCleanup(
  requestValue: unknown,
  storageReference: CaseUploadCleanupReference | null,
  uploadRegistration: CaseUploadCleanupReference | null,
): CaseUploadCleanupDecision {
  const request = CaseUploadCleanupRequestSchema.parse(requestValue);
  const matchesRequest = (reference: CaseUploadCleanupReference) =>
    reference.ownerId === request.ownerId && reference.uploadId === request.uploadId;

  if (storageReference) {
    return {
      deleteStorage: false,
      reason: matchesRequest(storageReference) ? "matching_registration" : "conflict",
    };
  }
  if (uploadRegistration) {
    return {
      deleteStorage: false,
      reason: matchesRequest(uploadRegistration) ? "matching_registration" : "conflict",
    };
  }
  return { deleteStorage: true, reason: "unreferenced" };
}

/**
 * Deletes only an unreferenced Convex storage object. Index reads and deletion
 * share one serializable mutation, so a concurrent registration either wins
 * first and retains the object, or observes that cleanup already removed it.
 */
export const cleanupOrphanedStorage = internalMutation({
  args: {
    ownerId: v.string(),
    uploadId: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const request = CaseUploadCleanupRequestSchema.parse(args);
    const storageReference = await ctx.db
      .query("caseUploads")
      .withIndex("by_storage_id", (index) => index.eq("storageId", args.storageId))
      .first();
    const uploadRegistration = await ctx.db
      .query("caseUploads")
      .withIndex("by_upload_version", (index) => index.eq("uploadId", request.uploadId))
      .first();
    const decision = decideCaseUploadCleanup(
      request,
      storageReference,
      uploadRegistration,
    );
    if (!decision.deleteStorage) {
      return CaseUploadCleanupResponseSchema.parse({ deleted: false });
    }

    const storedObject = await ctx.db.system.get("_storage", args.storageId);
    if (!storedObject) {
      return CaseUploadCleanupResponseSchema.parse({ deleted: false });
    }
    await ctx.storage.delete(args.storageId);
    return CaseUploadCleanupResponseSchema.parse({ deleted: true });
  },
});
