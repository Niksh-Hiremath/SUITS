import { httpRouter, makeFunctionReference } from "convex/server";
import { z } from "zod";

import {
  CasePublishResponseSchema,
  OwnedCaseListResponseSchema,
  type OwnedCaseListResponse,
} from "../src/domain/case-api";
import type { CaseGraphV1 } from "../src/domain/case-graph";
import {
  CourtroomModelCallTraceSchema,
  type CourtroomModelCallTrace,
} from "../src/domain/courtroom-ai";
import {
  HearingCounselResponsePrecommitSchema,
  HearingCommandPreparationSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingPlayerCommandSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  StartHearingRequestSchema,
  type HearingCommandPreparation,
  type HearingRuntimeViewV1,
} from "../src/domain/hearing-runtime";

import { httpAction } from "./_generated/server";
import {
  CaseCompileReplayRequestSchema,
  CaseCompileReplayResponseSchema,
  type CaseCompileReplayResponse,
} from "./caseCompileReplay";
import {
  PublishCaseDraftRequestSchema,
  RegisterCaseDraftRequestSchema,
  CaseServiceOwnerIdSchema,
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
const startHearingReference = makeFunctionReference<
  "action",
  { ownerId: string; requestJson: string },
  HearingRuntimeViewV1
>("hearingRuntime:start");
const prepareHearingCommandReference = makeFunctionReference<
  "action",
  { ownerId: string; trialId: string; commandJson: string },
  HearingCommandPreparation
>("hearingRuntime:prepareCommand");
const commitWitnessGenerationReference = makeFunctionReference<
  "action",
  { ownerId: string; trialId: string; generationJson: string },
  HearingCommandPreparation
>("hearingRuntime:commitWitnessGeneration");
const commitOpponentPlanGenerationReference = makeFunctionReference<
  "action",
  { ownerId: string; trialId: string; generationJson: string },
  HearingCommandPreparation
>("hearingRuntime:commitOpponentPlanGeneration");
const commitCounselGenerationReference = makeFunctionReference<
  "action",
  { ownerId: string; trialId: string; generationJson: string },
  HearingCommandPreparation
>("hearingRuntime:commitCounselGeneration");
const recordTerminalModelCallReference = makeFunctionReference<
  "mutation",
  { ownerId: string; traceJson: string },
  Readonly<{ callId: string; attemptCount: number; replayed: boolean }>
>("courtroomModelCalls:recordTerminalForOwner");
const readHearingReference = makeFunctionReference<
  "action",
  { ownerId: string; trialId: string },
  HearingRuntimeViewV1
>("hearingRuntime:read");

const HearingServiceStartRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    request: StartHearingRequestSchema,
  })
  .strict();
const HearingServiceCommandRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    trialId: z.string().trim().min(1).max(256),
    command: HearingPlayerCommandSchema,
  })
  .strict();
const HearingServiceWitnessCommitRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    trialId: z.string().trim().min(1).max(256),
    generation: HearingWitnessGenerationPrecommitSchema,
  })
  .strict()
  .superRefine((body, context) => {
    if (body.generation.trialId !== body.trialId) {
      context.addIssue({
        code: "custom",
        path: ["generation", "trialId"],
        message: "Generation trial must match the service request",
      });
    }
  });
export const HearingServiceOpponentPlanCommitRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    trialId: z.string().trim().min(1).max(256),
    generation: HearingOpponentPlanPrecommitSchema,
  })
  .strict()
  .superRefine((body, context) => {
    if (body.generation.trialId !== body.trialId) {
      context.addIssue({
        code: "custom",
        path: ["generation", "trialId"],
        message: "Generation trial must match the service request",
      });
    }
  });
export const HearingServiceCounselResponseCommitRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    trialId: z.string().trim().min(1).max(256),
    generation: HearingCounselResponsePrecommitSchema,
  })
  .strict()
  .superRefine((body, context) => {
    if (body.generation.trialId !== body.trialId) {
      context.addIssue({
        code: "custom",
        path: ["generation", "trialId"],
        message: "Generation trial must match the service request",
      });
    }
  });
const UnsuccessfulCourtroomModelCallTraceSchema =
  CourtroomModelCallTraceSchema.refine(
    (trace) =>
      trace.status === "failed" ||
      trace.status === "cancelled" ||
      trace.status === "stale",
    "Only unsuccessful terminal courtroom model calls may use this endpoint",
  );
const HearingServiceTerminalModelCallRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    trialId: z.string().trim().min(1).max(256),
    trace: UnsuccessfulCourtroomModelCallTraceSchema,
  })
  .strict()
  .superRefine((body, context) => {
    if (body.trace.trialId !== body.trialId) {
      context.addIssue({
        code: "custom",
        path: ["trace", "trialId"],
        message: "Trace trial must match the service request",
      });
    }
  });
const TerminalModelCallResponseSchema = z
  .object({
    callId: z.string().trim().min(1).max(240),
    attemptCount: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();
const HearingServiceReadRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    trialId: z.string().trim().min(1).max(256),
  })
  .strict();

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

const startHearing = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, HearingServiceStartRequestSchema);
    const result = await ctx.runAction(startHearingReference, {
      ownerId: body.ownerId,
      requestJson: JSON.stringify(body.request),
    });
    return caseServiceJson(HearingRuntimeViewV1Schema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const prepareHearingCommand = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, HearingServiceCommandRequestSchema);
    const result = await ctx.runAction(prepareHearingCommandReference, {
      ownerId: body.ownerId,
      trialId: body.trialId,
      commandJson: JSON.stringify(body.command),
    });
    return caseServiceJson(HearingCommandPreparationSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const commitWitnessGeneration = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(
      request,
      HearingServiceWitnessCommitRequestSchema,
    );
    const result = await ctx.runAction(commitWitnessGenerationReference, {
      ownerId: body.ownerId,
      trialId: body.trialId,
      generationJson: JSON.stringify(body.generation),
    });
    return caseServiceJson(HearingCommandPreparationSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const commitOpponentPlanGeneration = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(
      request,
      HearingServiceOpponentPlanCommitRequestSchema,
    );
    const result = await ctx.runAction(commitOpponentPlanGenerationReference, {
      ownerId: body.ownerId,
      trialId: body.trialId,
      generationJson: JSON.stringify(body.generation),
    });
    return caseServiceJson(HearingCommandPreparationSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const commitCounselGeneration = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(
      request,
      HearingServiceCounselResponseCommitRequestSchema,
    );
    const result = await ctx.runAction(commitCounselGenerationReference, {
      ownerId: body.ownerId,
      trialId: body.trialId,
      generationJson: JSON.stringify(body.generation),
    });
    return caseServiceJson(HearingCommandPreparationSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const recordTerminalModelCall = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(
      request,
      HearingServiceTerminalModelCallRequestSchema,
    );
    const result = await ctx.runMutation(recordTerminalModelCallReference, {
      ownerId: body.ownerId,
      traceJson: JSON.stringify(body.trace satisfies CourtroomModelCallTrace),
    });
    return caseServiceJson(TerminalModelCallResponseSchema.parse(result));
  } catch (error) {
    return caseServiceErrorResponse(error);
  }
});

const readHearing = httpAction(async (ctx, request) => {
  try {
    await authorizeCaseServiceRequest(request, process.env.SUITS_CONVEX_SERVICE_SECRET);
    const body = await parseCaseServiceJson(request, HearingServiceReadRequestSchema);
    const result = await ctx.runAction(readHearingReference, body);
    return caseServiceJson(HearingRuntimeViewV1Schema.parse(result));
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
http.route({ path: "/service/hearings/start", method: "POST", handler: startHearing });
http.route({ path: "/service/hearings/command/prepare", method: "POST", handler: prepareHearingCommand });
http.route({ path: "/service/hearings/command/commit", method: "POST", handler: commitWitnessGeneration });
http.route({ path: "/service/hearings/opponent-plan/commit", method: "POST", handler: commitOpponentPlanGeneration });
http.route({ path: "/service/hearings/counsel-response/commit", method: "POST", handler: commitCounselGeneration });
http.route({ path: "/service/hearings/model-call/terminal", method: "POST", handler: recordTerminalModelCall });
http.route({ path: "/service/hearings/read", method: "POST", handler: readHearing });

export default http;
