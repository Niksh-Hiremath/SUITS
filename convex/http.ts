import { httpRouter, makeFunctionReference } from "convex/server";
import type { z } from "zod";

import {
  CasePublishResponseSchema,
  OwnedCaseListResponseSchema,
  type OwnedCaseListResponse,
} from "../src/domain/case-api";
import type { CaseGraphV1 } from "../src/domain/case-graph";

import { httpAction } from "./_generated/server";
import {
  CaseCompileReplayRequestSchema,
  CaseCompileReplayResponseSchema,
  type CaseCompileReplayResponse,
} from "./caseCompileReplay";
import {
  PublishCaseDraftRequestSchema,
  RegisterCaseDraftRequestSchema,
  CaseServiceUploadUrlRequestSchema,
  authorizeCaseServiceRequest,
  caseServiceErrorResponse,
  caseServiceJson,
  deriveDraftGraphId,
  derivePublishedGraphId,
  parseCaseServiceJson,
  verifyRegisterCaseDraftIntegrity,
} from "./caseServiceBoundary";
import {
  AcquireCaseCompileClaimRequestSchema,
  AcquireCaseCompileClaimResponseSchema,
  HeartbeatCaseCompileClaimRequestSchema,
  HeartbeatCaseCompileClaimResponseSchema,
  ReleaseCaseCompileClaimRequestSchema,
  ReleaseCaseCompileClaimResponseSchema,
  type AcquireCaseCompileClaimRequest,
  type AcquireCaseCompileClaimResponse,
  type HeartbeatCaseCompileClaimRequest,
  type ReleaseCaseCompileClaimRequest,
} from "./caseCompileClaims";
import {
  CaseUploadCleanupRequestSchema,
  CaseUploadCleanupResponseSchema,
} from "./caseUploadCleanup";
import { OwnedCaseListRequestSchema } from "./publishedCases";

type RegisterDraftMutationArgs = {
  ownerId: string;
  uploadId: string;
  caseId: string;
  draftGraphId: string;
  storageId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentDigest: string;
  claimId: string;
  generation: number;
  leaseToken: string;
  extractionAdapterId: string;
  extractionCharacterCount: number;
  injectionFlags: Array<{
    patternId: "instruction_override" | "role_impersonation" | "tool_invocation" | "secret_exfiltration" | "safety_bypass";
    severity: "low" | "medium" | "high";
    startOffset: number;
    endOffset: number;
    fingerprint: string;
  }>;
  sourceSegmentsJson: string;
  caseGraphJson: string;
  validationReportJson: string;
  observabilityJson: string;
};

type RegisterDraftMutationResult = {
  uploadId: string;
  caseId: string;
  version: number;
  status: "indexed";
  replayed: boolean;
};

type PublishDraftMutationArgs = {
  ownerId: string;
  uploadId: string;
  draftGraphId: string;
  publishedGraphId: string;
  caseGraphJson: string;
};

type PublishDraftMutationResult = {
  caseId: string;
  version: number;
  published: boolean;
  replayed: boolean;
  caseGraph: CaseGraphV1;
};

type CaseCompileReplayQueryArgs = {
  ownerId: string;
  uploadId: string;
};

type CaseUploadCleanupMutationArgs = {
  ownerId: string;
  uploadId: string;
  storageId: string;
};

type CaseUploadCleanupMutationResult = {
  deleted: boolean;
};

type HeartbeatCaseCompileClaimResponse = z.infer<
  typeof HeartbeatCaseCompileClaimResponseSchema
>;
type ReleaseCaseCompileClaimResponse = z.infer<
  typeof ReleaseCaseCompileClaimResponseSchema
>;

const generateUploadUrlReference = makeFunctionReference<
  "mutation",
  Record<string, never>,
  string
>("caseUploads:generateServiceUploadUrl");
const registerDraftReference = makeFunctionReference<
  "mutation",
  RegisterDraftMutationArgs,
  RegisterDraftMutationResult
>("caseDrafts:registerCompiledDraft");
const publishDraftReference = makeFunctionReference<
  "mutation",
  PublishDraftMutationArgs,
  PublishDraftMutationResult
>("caseDrafts:publishCompiledDraft");
const acquireCaseCompileClaimReference = makeFunctionReference<
  "mutation",
  AcquireCaseCompileClaimRequest,
  AcquireCaseCompileClaimResponse
>("caseCompileClaims:acquire");
const heartbeatCaseCompileClaimReference = makeFunctionReference<
  "mutation",
  HeartbeatCaseCompileClaimRequest,
  HeartbeatCaseCompileClaimResponse
>("caseCompileClaims:heartbeat");
const releaseCaseCompileClaimReference = makeFunctionReference<
  "mutation",
  ReleaseCaseCompileClaimRequest,
  ReleaseCaseCompileClaimResponse
>("caseCompileClaims:release");
const lookupCaseCompileReplayReference = makeFunctionReference<
  "query",
  CaseCompileReplayQueryArgs,
  CaseCompileReplayResponse
>("caseCompileReplay:lookupCompiledDraft");
const cleanupCaseUploadReference = makeFunctionReference<
  "mutation",
  CaseUploadCleanupMutationArgs,
  CaseUploadCleanupMutationResult
>("caseUploadCleanup:cleanupOrphanedStorage");
const listOwnedCasesReference = makeFunctionReference<
  "query",
  { ownerId: string },
  OwnedCaseListResponse
>("publishedCases:listOwnedCases");

const acquireCaseCompileClaim = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, AcquireCaseCompileClaimRequestSchema);
    const result = await ctx.runMutation(acquireCaseCompileClaimReference, body);
    return caseServiceJson(AcquireCaseCompileClaimResponseSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const heartbeatCaseCompileClaim = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, HeartbeatCaseCompileClaimRequestSchema);
    const result = await ctx.runMutation(heartbeatCaseCompileClaimReference, body);
    return caseServiceJson(HeartbeatCaseCompileClaimResponseSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const releaseCaseCompileClaim = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, ReleaseCaseCompileClaimRequestSchema);
    const result = await ctx.runMutation(releaseCaseCompileClaimReference, body);
    return caseServiceJson(ReleaseCaseCompileClaimResponseSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const lookupCaseCompileReplay = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, CaseCompileReplayRequestSchema);
    const result = await ctx.runQuery(lookupCaseCompileReplayReference, body);
    return caseServiceJson(CaseCompileReplayResponseSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const cleanupCaseUpload = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, CaseUploadCleanupRequestSchema);
    const result = await ctx.runMutation(cleanupCaseUploadReference, body);
    return caseServiceJson(CaseUploadCleanupResponseSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const generateUploadUrl = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    await parseCaseServiceJson(request, CaseServiceUploadUrlRequestSchema);
    const uploadUrl = await ctx.runMutation(generateUploadUrlReference, {});
    return caseServiceJson({ uploadUrl });
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const registerDraft = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const parsed = await parseCaseServiceJson(request, RegisterCaseDraftRequestSchema);
    const body = await verifyRegisterCaseDraftIntegrity(parsed);
    const draftGraphId = await deriveDraftGraphId(body.uploadId);
    const result = await ctx.runMutation(registerDraftReference, {
      ownerId: body.ownerId,
      uploadId: body.uploadId,
      caseId: body.caseId,
      draftGraphId,
      storageId: body.storageId,
      originalName: body.originalName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      contentDigest: body.contentDigest,
      claimId: body.claimId,
      generation: body.generation,
      leaseToken: body.leaseToken,
      extractionAdapterId: body.extractionAdapterId,
      extractionCharacterCount: body.extractionCharacterCount,
      injectionFlags: body.injectionFlags,
      sourceSegmentsJson: JSON.stringify(body.sourceSegments),
      caseGraphJson: JSON.stringify(body.caseGraph),
      validationReportJson: JSON.stringify(body.validationReport),
      observabilityJson: JSON.stringify(body.observability),
    });
    return caseServiceJson(
      {
        uploadId: result.uploadId,
        caseId: result.caseId,
        version: result.version,
        status: result.status,
      },
      result.replayed ? 200 : 201,
    );
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const publishDraft = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, PublishCaseDraftRequestSchema);
    const [draftGraphId, publishedGraphId] = await Promise.all([
      deriveDraftGraphId(body.uploadId),
      derivePublishedGraphId(body.ownerId, body.uploadId),
    ]);
    const result = await ctx.runMutation(publishDraftReference, {
      ownerId: body.ownerId,
      uploadId: body.uploadId,
      draftGraphId,
      publishedGraphId,
      caseGraphJson: JSON.stringify(body.caseGraph),
    });
    return caseServiceJson(
      CasePublishResponseSchema.parse({
        caseId: result.caseId,
        version: result.version,
        published: result.published,
        replayed: result.replayed,
        caseGraph: result.caseGraph,
      }),
      result.replayed ? 200 : 201,
    );
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const listOwnedCases = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, OwnedCaseListRequestSchema);
    const result = await ctx.runQuery(listOwnedCasesReference, body);
    return caseServiceJson(OwnedCaseListResponseSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const http = httpRouter();

http.route({ path: "/service/case-compile-claim/acquire", method: "POST", handler: acquireCaseCompileClaim });
http.route({ path: "/service/case-compile-claim/heartbeat", method: "POST", handler: heartbeatCaseCompileClaim });
http.route({ path: "/service/case-compile-claim/release", method: "POST", handler: releaseCaseCompileClaim });
http.route({ path: "/service/case-draft/lookup", method: "POST", handler: lookupCaseCompileReplay });
http.route({ path: "/service/case-upload/cleanup", method: "POST", handler: cleanupCaseUpload });
http.route({ path: "/service/case-upload-url", method: "POST", handler: generateUploadUrl });
http.route({ path: "/service/case-draft/register", method: "POST", handler: registerDraft });
http.route({ path: "/service/case-draft/publish", method: "POST", handler: publishDraft });
http.route({ path: "/service/cases/owned/list", method: "POST", handler: listOwnedCases });

export default http;
