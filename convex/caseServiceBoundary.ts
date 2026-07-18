import { z } from "zod";

import {
  CaseGraphEntityIdSchema,
  CaseGraphV1Schema,
  SourceSegmentSchema,
  type CaseGraphV1,
  type Provenance,
  type SourceSegment,
} from "../src/domain/case-graph";
import {
  CaseCompilerObservabilitySchema,
  CaseCompilerPersistedObservabilitySchema,
  CaseCompilerPersistedValidationReportSchema,
  CaseCompilerValidationReportSchema,
} from "../src/server/case-compiler/schemas";
import {
  CaseIngestionEntityIdSchema,
  CaseUploadMimeTypeSchema,
  MAX_EXTRACTED_CHARACTERS,
  MAX_PROMPT_INJECTION_FLAGS,
  OriginalFileNameSchema,
  PromptInjectionFlagSchema,
  Sha256DigestSchema,
} from "../src/server/case-ingestion/schema";
import {
  MAX_CASE_COMPILER_SOURCE_CHARACTERS,
  MAX_CASE_COMPILER_SOURCE_SEGMENTS,
} from "../src/server/case-compiler/constants";

const MAX_SERVICE_SECRET_CHARACTERS = 512;
export const MAX_SERVICE_REQUEST_BYTES = 8 * 1024 * 1024;
const OWNER_ID_PATTERN = /^owner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CASE_COMPILE_CLAIM_ID_PATTERN = /^claim:[a-f0-9]{64}$/u;
const CASE_COMPILE_LEASE_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;

export const CASE_COMPILATION_AUDIT_SCHEMA_VERSION = "case-compilation-audit.v1" as const;
export const CASE_PUBLICATION_AUDIT_SCHEMA_VERSION = "case-publication-audit.v1" as const;
export const CASE_HUMAN_REVIEW_AUDIT_SCHEMA_VERSION = "case-human-review-audit.v1" as const;
export const MAX_RECORDED_HUMAN_REVIEW_CHANGES = 256;

export const CaseServiceOwnerIdSchema = z
  .string()
  .regex(OWNER_ID_PATTERN, "Expected a server-verified owner session ID");

export const CaseServiceUploadUrlRequestSchema = z.object({}).strict();

const CaseCompileClaimIdSchema = z.string().regex(CASE_COMPILE_CLAIM_ID_PATTERN);
const CaseCompileLeaseTokenSchema = z.string().regex(CASE_COMPILE_LEASE_TOKEN_PATTERN);
const CaseCompileClaimGenerationSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const RegisterCaseDraftRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    caseId: CaseGraphEntityIdSchema,
    storageId: z.string().trim().min(1).max(256),
    originalName: OriginalFileNameSchema,
    mimeType: CaseUploadMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
    contentDigest: Sha256DigestSchema,
    claimId: CaseCompileClaimIdSchema,
    generation: CaseCompileClaimGenerationSchema,
    leaseToken: CaseCompileLeaseTokenSchema,
    extractionAdapterId: CaseIngestionEntityIdSchema,
    extractionCharacterCount: z.number().int().positive().max(MAX_EXTRACTED_CHARACTERS),
    injectionFlags: z.array(PromptInjectionFlagSchema).max(MAX_PROMPT_INJECTION_FLAGS),
    sourceSegments: z.array(SourceSegmentSchema).min(1).max(MAX_CASE_COMPILER_SOURCE_SEGMENTS),
    caseGraph: CaseGraphV1Schema,
    validationReport: CaseCompilerValidationReportSchema,
    observability: CaseCompilerObservabilitySchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    const addIssue = (path: Array<string | number>, message: string) => {
      ctx.addIssue({ code: "custom", path, message });
    };

    if (request.caseGraph.caseId !== request.caseId) {
      addIssue(["caseGraph", "caseId"], "The CaseGraph case ID must match the trusted request case ID");
    }
    if (request.caseGraph.status !== "draft") {
      addIssue(["caseGraph", "status"], "Only a draft CaseGraph may be registered");
    }
    if (JSON.stringify(request.caseGraph.sourceSegments) !== JSON.stringify(request.sourceSegments)) {
      addIssue(["caseGraph", "sourceSegments"], "The CaseGraph must preserve source segments exactly and in order");
    }

    let sourceCharacters = 0;
    request.sourceSegments.forEach((segment, index) => {
      sourceCharacters += segment.excerpt.length;
      if (segment.documentName !== request.originalName) {
        addIssue(["sourceSegments", index, "documentName"], "Source document name does not match the stored upload");
      }
      if (segment.mimeType !== request.mimeType) {
        addIssue(["sourceSegments", index, "mimeType"], "Source MIME type does not match the stored upload");
      }
    });
    if (sourceCharacters > MAX_CASE_COMPILER_SOURCE_CHARACTERS) {
      addIssue(["sourceSegments"], `Source packet exceeds ${MAX_CASE_COMPILER_SOURCE_CHARACTERS} characters`);
    }
    request.injectionFlags.forEach((flag, index) => {
      if (flag.endOffset > request.extractionCharacterCount) {
        addIssue(
          ["injectionFlags", index, "endOffset"],
          "Prompt-injection flag extends beyond the extracted document",
        );
      }
    });

    const metadata = request.caseGraph.compilerMetadata;
    if (metadata.method !== "gpt" || metadata.model !== "gpt-5.6-terra") {
      addIssue(["caseGraph", "compilerMetadata", "model"], "Uploaded cases must be compiled by gpt-5.6-terra");
    }
    if (metadata.sourceContentHash !== request.observability.sourceContentHash) {
      addIssue(["observability", "sourceContentHash"], "Compiler observability source hash does not match the CaseGraph");
    }
    if (metadata.sourceSegmentCount !== request.observability.sourceSegmentCount) {
      addIssue(["observability", "sourceSegmentCount"], "Compiler observability source count does not match the CaseGraph");
    }
    if (metadata.promptVersion !== request.observability.promptVersion) {
      addIssue(["observability", "promptVersion"], "Compiler observability prompt version does not match the CaseGraph");
    }
    if (request.validationReport.status === "rejected" || request.validationReport.issues.length > 0) {
      addIssue(["validationReport", "status"], "A rejected or invalid compiler result cannot be registered");
    }
    if (request.validationReport.checks.some((check) => check.status === "fail")) {
      addIssue(["validationReport", "checks"], "A failing deterministic compiler check cannot be registered");
    }

    const attempts = request.observability.attempts;
    const acceptedAttempts = attempts.filter((attempt) => attempt.outcome === "accepted");
    const acceptedAttempt = acceptedAttempts[0];
    if (acceptedAttempts.length !== 1 || attempts.at(-1)?.outcome !== "accepted") {
      addIssue(["observability", "attempts"], "Compiler observability must end with exactly one accepted attempt");
    }
    if (request.observability.retryCount !== attempts.length - 1) {
      addIssue(["observability", "retryCount"], "Compiler retry count does not match the attempt trace");
    }
    if (acceptedAttempt && metadata.requestId !== acceptedAttempt.requestId) {
      addIssue(["caseGraph", "compilerMetadata", "requestId"], "CaseGraph request ID does not match the accepted compiler attempt");
    }
  });

export const PublishCaseDraftRequestSchema = z
  .object({
    ownerId: CaseServiceOwnerIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    caseGraph: CaseGraphV1Schema,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.caseGraph.status !== "published") {
      ctx.addIssue({
        code: "custom",
        path: ["caseGraph", "status"],
        message: "Only a reviewed, published CaseGraph may be published",
      });
    }
  });

export type RegisterCaseDraftRequest = z.infer<typeof RegisterCaseDraftRequestSchema>;
export type PublishCaseDraftRequest = z.infer<typeof PublishCaseDraftRequestSchema>;

export class CaseServiceBoundaryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "CaseServiceBoundaryError";
    this.code = code;
    this.status = status;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function canonicalizeSourceSegments(sourceSegments: readonly SourceSegment[]): string {
  return JSON.stringify(
    sourceSegments.map((segment) => ({
      sourceSegmentId: segment.sourceSegmentId,
      sourceId: segment.sourceId,
      documentName: segment.documentName,
      mimeType: segment.mimeType,
      locator: segment.locator,
      excerpt: segment.excerpt,
      sha256: segment.sha256,
    })),
  );
}

export async function verifyRegisterCaseDraftIntegrity(
  input: RegisterCaseDraftRequest,
): Promise<RegisterCaseDraftRequest> {
  const request = RegisterCaseDraftRequestSchema.parse(input);
  const sourceFingerprint = await sha256Hex(`${request.uploadId}:${request.contentDigest}`);
  const expectedSourceId = `source:${sourceFingerprint.slice(0, 32)}`;

  for (let index = 0; index < request.sourceSegments.length; index += 1) {
    const segment = request.sourceSegments[index];
    if (!segment) throw new CaseServiceBoundaryError("CASE_DRAFT_SOURCE_INVALID", 422);
    const excerptDigest = await sha256Hex(segment.excerpt);
    const expectedSegmentId = `segment:${sourceFingerprint.slice(0, 20)}:${String(index + 1).padStart(4, "0")}:${excerptDigest.slice(0, 12)}`;
    if (
      segment.sha256 !== excerptDigest ||
      segment.sourceId !== expectedSourceId ||
      segment.sourceSegmentId !== expectedSegmentId
    ) {
      throw new CaseServiceBoundaryError("CASE_DRAFT_SOURCE_INVALID", 422);
    }
  }

  const sourceContentHash = await sha256Hex(canonicalizeSourceSegments(request.sourceSegments));
  if (
    request.caseGraph.compilerMetadata.sourceContentHash !== sourceContentHash ||
    request.observability.sourceContentHash !== sourceContentHash
  ) {
    throw new CaseServiceBoundaryError("CASE_DRAFT_SOURCE_HASH_MISMATCH", 422);
  }
  return request;
}

export async function deriveDraftGraphId(uploadId: string): Promise<string> {
  const uploadHash = await sha256Hex(`suits-draft:${uploadId}`);
  return CaseGraphEntityIdSchema.parse(`graph:draft:${uploadHash}`);
}

export async function derivePublishedGraphId(ownerId: string, uploadId: string): Promise<string> {
  const publicationHash = await sha256Hex(`suits-published:${ownerId}:${uploadId}`);
  return CaseGraphEntityIdSchema.parse(`graph:published:${publicationHash}`);
}

/**
 * Human review may correct the compiled entity content, but it must not rewrite
 * the model's source/authoring/inference grounding. IDs are retained in this
 * snapshot so reordering or moving provenance between entities is also caught.
 */
export function caseGraphProvenanceSnapshot(graph: CaseGraphV1): string {
  return JSON.stringify({
    jurisdictionProfile: {
      profileId: graph.jurisdictionProfile.profileId,
      provenance: graph.jurisdictionProfile.provenance,
    },
    parties: graph.parties.map((item) => ({ id: item.partyId, provenance: item.provenance })),
    issues: graph.issues.map((item) => ({ id: item.issueId, provenance: item.provenance })),
    timeline: graph.timeline.map((item) => ({ id: item.timelineEventId, provenance: item.provenance })),
    facts: graph.facts.map((item) => ({ id: item.factId, provenance: item.provenance })),
    evidence: graph.evidence.map((item) => ({ id: item.evidenceId, provenance: item.provenance })),
    witnesses: graph.witnesses.map((item) => ({
      id: item.witnessId,
      provenance: item.provenance,
      priorStatements: item.priorStatements.map((statement) => ({
        id: statement.priorStatementId,
        provenance: statement.provenance,
      })),
    })),
    contradictions: graph.contradictions.map((item) => ({
      id: item.contradictionId,
      provenance: item.provenance,
    })),
    settlement: graph.settlement.provenance,
    juryInstructions: graph.juryInstructions.map((item) => ({
      id: item.instructionId,
      provenance: item.provenance,
    })),
  });
}

export const HumanReviewEntityTypeSchema = z.enum([
  "case",
  "jurisdiction_profile",
  "party",
  "issue",
  "timeline_event",
  "fact",
  "evidence",
  "witness",
  "prior_statement",
  "contradiction",
  "settlement",
  "jury_instruction",
]);

export const HumanReviewChangeSchema = z
  .object({
    path: z.string().trim().min(1).max(500),
    entityType: HumanReviewEntityTypeSchema,
    entityId: CaseGraphEntityIdSchema,
    changedFields: z.array(z.string().trim().min(1).max(128)).min(1).max(64),
    provenanceId: CaseGraphEntityIdSchema.nullable(),
  })
  .strict();

export const HumanReviewAuditSchema = z
  .object({
    schemaVersion: z.literal(CASE_HUMAN_REVIEW_AUDIT_SCHEMA_VERSION),
    publicationGraphId: CaseGraphEntityIdSchema,
    draftVersion: z.literal(1),
    publishedVersion: z.literal(2),
    totalChangeCount: z.number().int().nonnegative(),
    annotatedEntityCount: z.number().int().nonnegative(),
    recordedChangeCount: z.number().int().nonnegative().max(MAX_RECORDED_HUMAN_REVIEW_CHANGES),
    truncated: z.boolean(),
    changes: z.array(HumanReviewChangeSchema).max(MAX_RECORDED_HUMAN_REVIEW_CHANGES),
  })
  .strict()
  .superRefine((audit, ctx) => {
    const recordedAnnotated = audit.changes.filter((change) => change.provenanceId !== null).length;
    const provenanceIds = audit.changes.flatMap((change) => change.provenanceId ? [change.provenanceId] : []);
    if (audit.recordedChangeCount !== audit.changes.length) {
      ctx.addIssue({ code: "custom", path: ["recordedChangeCount"], message: "Recorded review count mismatch" });
    }
    if (
      audit.recordedChangeCount > audit.totalChangeCount ||
      audit.annotatedEntityCount > audit.totalChangeCount ||
      recordedAnnotated > audit.annotatedEntityCount
    ) {
      ctx.addIssue({ code: "custom", path: ["totalChangeCount"], message: "Invalid review audit counts" });
    }
    if (
      (!audit.truncated && (
        audit.totalChangeCount !== audit.recordedChangeCount ||
        audit.annotatedEntityCount !== recordedAnnotated
      )) ||
      (audit.truncated && audit.totalChangeCount <= audit.recordedChangeCount)
    ) {
      ctx.addIssue({ code: "custom", path: ["truncated"], message: "Invalid review truncation metadata" });
    }
    if (new Set(provenanceIds).size !== provenanceIds.length) {
      ctx.addIssue({ code: "custom", path: ["changes"], message: "Duplicate review provenance ID" });
    }
  });

export const CaseCompilationAuditSchema = z
  .object({
    schemaVersion: z.literal(CASE_COMPILATION_AUDIT_SCHEMA_VERSION),
    validationReport: CaseCompilerPersistedValidationReportSchema,
    observability: CaseCompilerPersistedObservabilitySchema,
  })
  .strict();

export const CasePublicationAuditSchema = z
  .object({
    schemaVersion: z.literal(CASE_PUBLICATION_AUDIT_SCHEMA_VERSION),
    compilation: CaseCompilationAuditSchema,
    humanReview: HumanReviewAuditSchema,
  })
  .strict();

export type HumanReviewEntityType = z.infer<typeof HumanReviewEntityTypeSchema>;
export type HumanReviewChange = z.infer<typeof HumanReviewChangeSchema>;
export type HumanReviewAudit = z.infer<typeof HumanReviewAuditSchema>;

export type HumanReviewAnnotation = Readonly<{
  caseGraph: CaseGraphV1;
  audit: HumanReviewAudit;
}>;

function allProvenance(graph: CaseGraphV1): Provenance[] {
  return [
    ...graph.jurisdictionProfile.provenance,
    ...graph.parties.flatMap((item) => item.provenance),
    ...graph.issues.flatMap((item) => item.provenance),
    ...graph.timeline.flatMap((item) => item.provenance),
    ...graph.facts.flatMap((item) => item.provenance),
    ...graph.evidence.flatMap((item) => item.provenance),
    ...graph.witnesses.flatMap((item) => [
      ...item.provenance,
      ...item.priorStatements.flatMap((statement) => statement.provenance),
    ]),
    ...graph.contradictions.flatMap((item) => item.provenance),
    ...graph.settlement.provenance,
    ...graph.juryInstructions.flatMap((item) => item.provenance),
  ];
}

function changedFields<T extends object>(
  before: T,
  after: T,
  ignoredFields: readonly string[],
): string[] {
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const ignored = new Set(ignoredFields);
  return [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
    .filter((field) =>
      !ignored.has(field) && JSON.stringify(beforeRecord[field]) !== JSON.stringify(afterRecord[field]),
    )
    .sort();
}

function reviewProvenance(
  provenanceId: string,
  entityType: HumanReviewEntityType,
  changed: readonly string[],
): Provenance {
  return {
    provenanceId,
    kind: "authoring",
    sourceSegmentIds: [],
    note: `Server-validated human review changed ${entityType.replaceAll("_", " ")} fields: ${changed.join(", ")}.`,
    confidence: 1,
  };
}

/**
 * Applies only server-authored provenance. The reviewed input must still carry
 * the draft provenance byte-for-byte; this prevents a browser from laundering
 * an edit as source-grounded while preserving legitimate human corrections.
 */
export function annotateHumanReview(
  draftInput: CaseGraphV1,
  reviewedInput: CaseGraphV1,
  publicationGraphId: string,
): HumanReviewAnnotation {
  const draft = CaseGraphV1Schema.parse(draftInput);
  const reviewed = CaseGraphV1Schema.parse(reviewedInput);
  CaseGraphEntityIdSchema.parse(publicationGraphId);

  if (
    draft.status !== "draft" ||
    reviewed.status !== "published" ||
    draft.caseId !== reviewed.caseId ||
    draft.schemaVersion !== reviewed.schemaVersion ||
    draft.version !== reviewed.version ||
    draft.educationalDisclaimer !== reviewed.educationalDisclaimer ||
    JSON.stringify(draft.sourceSegments) !== JSON.stringify(reviewed.sourceSegments) ||
    JSON.stringify(draft.compilerMetadata) !== JSON.stringify(reviewed.compilerMetadata)
  ) {
    throw new CaseServiceBoundaryError("CASE_PUBLISH_IMMUTABLE_FIELD_CHANGED", 409);
  }
  if (caseGraphProvenanceSnapshot(draft) !== caseGraphProvenanceSnapshot(reviewed)) {
    throw new CaseServiceBoundaryError("CASE_PUBLISH_PROVENANCE_TAMPERED", 409);
  }

  const publicationToken = /^graph:published:([a-f0-9]{64})$/u.exec(publicationGraphId)?.[1];
  if (!publicationToken) {
    throw new CaseServiceBoundaryError("CASE_PUBLISH_CONFLICT", 409);
  }

  const annotated = structuredClone(reviewed);
  const usedProvenanceIds = new Set(allProvenance(draft).map((item) => item.provenanceId));
  const changes: HumanReviewChange[] = [];
  let provenanceSequence = 0;

  const nextProvenanceId = (): string => {
    let candidate: string;
    do {
      provenanceSequence += 1;
      candidate = `prov:review:${publicationToken.slice(0, 16)}:${String(provenanceSequence).padStart(4, "0")}`;
    } while (usedProvenanceIds.has(candidate));
    usedProvenanceIds.add(candidate);
    return candidate;
  };

  const recordEntityEdit = <T extends object>(options: Readonly<{
    before: T;
    after: T;
    ignoredFields: readonly string[];
    entityType: HumanReviewEntityType;
    entityId: string;
    path: string;
    append: (provenance: Provenance) => void;
  }>): void => {
    const fields = changedFields(options.before, options.after, options.ignoredFields);
    if (fields.length === 0) return;
    const provenanceId = nextProvenanceId();
    options.append(reviewProvenance(provenanceId, options.entityType, fields));
    changes.push({
      path: options.path,
      entityType: options.entityType,
      entityId: options.entityId,
      changedFields: fields,
      provenanceId,
    });
  };

  const caseFields = (["title", "summary"] as const).filter(
    (field) => draft[field] !== reviewed[field],
  );
  if (caseFields.length > 0) {
    changes.push({
      path: "case",
      entityType: "case",
      entityId: reviewed.caseId,
      changedFields: caseFields,
      provenanceId: null,
    });
  }

  recordEntityEdit({
    before: draft.jurisdictionProfile,
    after: reviewed.jurisdictionProfile,
    ignoredFields: ["profileId", "provenance"],
    entityType: "jurisdiction_profile",
    entityId: reviewed.jurisdictionProfile.profileId,
    path: "jurisdictionProfile",
    append: (provenance) => annotated.jurisdictionProfile.provenance.push(provenance),
  });

  const recordArrayEdits = <T extends object>(options: Readonly<{
    before: readonly T[];
    after: readonly T[];
    ignoredFields: readonly string[];
    entityType: HumanReviewEntityType;
    id: (item: T) => string;
    path: (item: T) => string;
    append: (index: number, provenance: Provenance) => void;
  }>): void => {
    options.before.forEach((before, index) => {
      const after = options.after[index];
      if (!after) throw new CaseServiceBoundaryError("CASE_PUBLISH_PROVENANCE_TAMPERED", 409);
      recordEntityEdit({
        before,
        after,
        ignoredFields: options.ignoredFields,
        entityType: options.entityType,
        entityId: options.id(after),
        path: options.path(after),
        append: (provenance) => options.append(index, provenance),
      });
    });
  };

  const appendAt = <T extends { provenance: Provenance[] }>(
    items: T[],
    index: number,
    provenance: Provenance,
  ): void => {
    const item = items[index];
    if (!item) throw new CaseServiceBoundaryError("CASE_PUBLISH_PROVENANCE_TAMPERED", 409);
    item.provenance.push(provenance);
  };

  recordArrayEdits({
    before: draft.parties,
    after: reviewed.parties,
    ignoredFields: ["partyId", "provenance"],
    entityType: "party",
    id: (item) => item.partyId,
    path: (item) => `parties.${item.partyId}`,
    append: (index, provenance) => appendAt(annotated.parties, index, provenance),
  });
  recordArrayEdits({
    before: draft.issues,
    after: reviewed.issues,
    ignoredFields: ["issueId", "provenance"],
    entityType: "issue",
    id: (item) => item.issueId,
    path: (item) => `issues.${item.issueId}`,
    append: (index, provenance) => appendAt(annotated.issues, index, provenance),
  });
  recordArrayEdits({
    before: draft.timeline,
    after: reviewed.timeline,
    ignoredFields: ["timelineEventId", "provenance"],
    entityType: "timeline_event",
    id: (item) => item.timelineEventId,
    path: (item) => `timeline.${item.timelineEventId}`,
    append: (index, provenance) => appendAt(annotated.timeline, index, provenance),
  });
  recordArrayEdits({
    before: draft.facts,
    after: reviewed.facts,
    ignoredFields: ["factId", "provenance"],
    entityType: "fact",
    id: (item) => item.factId,
    path: (item) => `facts.${item.factId}`,
    append: (index, provenance) => appendAt(annotated.facts, index, provenance),
  });
  recordArrayEdits({
    before: draft.evidence,
    after: reviewed.evidence,
    ignoredFields: ["evidenceId", "provenance"],
    entityType: "evidence",
    id: (item) => item.evidenceId,
    path: (item) => `evidence.${item.evidenceId}`,
    append: (index, provenance) => appendAt(annotated.evidence, index, provenance),
  });
  recordArrayEdits({
    before: draft.witnesses,
    after: reviewed.witnesses,
    ignoredFields: ["witnessId", "provenance", "priorStatements"],
    entityType: "witness",
    id: (item) => item.witnessId,
    path: (item) => `witnesses.${item.witnessId}`,
    append: (index, provenance) => appendAt(annotated.witnesses, index, provenance),
  });

  draft.witnesses.forEach((witness, witnessIndex) => {
    const reviewedWitness = reviewed.witnesses[witnessIndex];
    if (!reviewedWitness) throw new CaseServiceBoundaryError("CASE_PUBLISH_PROVENANCE_TAMPERED", 409);
    recordArrayEdits({
      before: witness.priorStatements,
      after: reviewedWitness.priorStatements,
      ignoredFields: ["priorStatementId", "provenance"],
      entityType: "prior_statement",
      id: (item) => item.priorStatementId,
      path: (item) => `witnesses.${reviewedWitness.witnessId}.priorStatements.${item.priorStatementId}`,
      append: (statementIndex, provenance) => {
        const annotatedWitness = annotated.witnesses[witnessIndex];
        if (!annotatedWitness) {
          throw new CaseServiceBoundaryError("CASE_PUBLISH_PROVENANCE_TAMPERED", 409);
        }
        appendAt(annotatedWitness.priorStatements, statementIndex, provenance);
      },
    });
  });

  recordArrayEdits({
    before: draft.contradictions,
    after: reviewed.contradictions,
    ignoredFields: ["contradictionId", "provenance"],
    entityType: "contradiction",
    id: (item) => item.contradictionId,
    path: (item) => `contradictions.${item.contradictionId}`,
    append: (index, provenance) => appendAt(annotated.contradictions, index, provenance),
  });
  recordEntityEdit({
    before: draft.settlement,
    after: reviewed.settlement,
    ignoredFields: ["provenance"],
    entityType: "settlement",
    entityId: "settlement",
    path: "settlement",
    append: (provenance) => annotated.settlement.provenance.push(provenance),
  });
  recordArrayEdits({
    before: draft.juryInstructions,
    after: reviewed.juryInstructions,
    ignoredFields: ["instructionId", "provenance"],
    entityType: "jury_instruction",
    id: (item) => item.instructionId,
    path: (item) => `juryInstructions.${item.instructionId}`,
    append: (index, provenance) => appendAt(annotated.juryInstructions, index, provenance),
  });

  const parsedAnnotated = CaseGraphV1Schema.parse(annotated);
  const recordedChanges = changes.slice(0, MAX_RECORDED_HUMAN_REVIEW_CHANGES);
  return {
    caseGraph: parsedAnnotated,
    audit: {
      schemaVersion: CASE_HUMAN_REVIEW_AUDIT_SCHEMA_VERSION,
      publicationGraphId,
      draftVersion: 1,
      publishedVersion: 2,
      totalChangeCount: changes.length,
      annotatedEntityCount: changes.filter((change) => change.provenanceId !== null).length,
      recordedChangeCount: recordedChanges.length,
      truncated: recordedChanges.length !== changes.length,
      changes: recordedChanges,
    },
  };
}

export function serializePublishedCompilerMetadata(
  compilationAudit: unknown,
  humanReview: HumanReviewAudit,
): string {
  return JSON.stringify(CasePublicationAuditSchema.parse({
    schemaVersion: CASE_PUBLICATION_AUDIT_SCHEMA_VERSION,
    compilation: compilationAudit,
    humanReview,
  }));
}

async function secretsMatch(received: string, expected: string): Promise<boolean> {
  const [receivedHash, expectedHash] = await Promise.all([
    sha256Hex(`suits-service-secret:${received}`),
    sha256Hex(`suits-service-secret:${expected}`),
  ]);
  let difference = receivedHash.length ^ expectedHash.length;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash.charCodeAt(index) ^ (receivedHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function authorizeCaseServiceRequest(
  request: Request,
  configuredSecret: string | undefined,
): Promise<void> {
  const expected = configuredSecret?.trim() ?? "";
  if (expected.length < 32 || expected.length > MAX_SERVICE_SECRET_CHARACTERS) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_UNAVAILABLE", 503);
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_UNAUTHORIZED", 401);
  }
  const received = authorization.slice("Bearer ".length);
  if (
    received.length < 32 ||
    received.length > MAX_SERVICE_SECRET_CHARACTERS ||
    !(await secretsMatch(received, expected))
  ) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_UNAUTHORIZED", 401);
  }
}

export async function parseCaseServiceJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new CaseServiceBoundaryError("CASE_SERVICE_CONTENT_TYPE_INVALID", 415);
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") {
    throw new CaseServiceBoundaryError("CASE_SERVICE_CONTENT_TYPE_INVALID", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SERVICE_REQUEST_BYTES) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_TOO_LARGE", 413);
  }

  if (request.body === null) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value.byteLength === 0) continue;
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_SERVICE_REQUEST_BYTES) {
        await reader.cancel("case service request too large");
        throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_TOO_LARGE", 413);
      }
      chunks.push(Uint8Array.from(result.value));
    }
  } catch (error) {
    if (error instanceof CaseServiceBoundaryError) throw error;
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  } finally {
    reader.releaseLock();
  }
  if (totalBytes === 0) {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CaseServiceBoundaryError("CASE_SERVICE_REQUEST_INVALID", 400);
  return parsed.data;
}

export function caseServiceJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const INTERNAL_ERROR_STATUS = new Map<string, number>([
  ["CASE_DRAFT_ALREADY_EXISTS", 409],
  ["CASE_DRAFT_CONFLICT", 409],
  ["CASE_DRAFT_NOT_FOUND", 404],
  ["CASE_DRAFT_SOURCE_COLLISION", 409],
  ["CASE_DRAFT_TOO_LARGE", 413],
  ["CASE_PUBLISH_CONFLICT", 409],
  ["CASE_PUBLISH_IMMUTABLE_FIELD_CHANGED", 409],
  ["CASE_PUBLISH_PROVENANCE_TAMPERED", 409],
  ["CASE_OWNED_CASE_CONFLICT", 409],
  ["CASE_UPLOAD_CONFLICT", 409],
  ["CASE_UPLOAD_DIGEST_MISMATCH", 422],
  ["CASE_UPLOAD_MIME_TYPE_MISMATCH", 422],
  ["CASE_UPLOAD_SIZE_MISMATCH", 422],
  ["CASE_UPLOAD_STORAGE_OBJECT_NOT_FOUND", 404],
  ["HEARING_CASE_GRAPH_CONFLICT", 409],
  ["HEARING_CASE_NOT_FOUND", 404],
  ["TRIAL_NOT_FOUND", 404],
  ["TRIAL_MIGRATION_REQUIRED", 409],
  ["TRIAL_ALREADY_EXISTS", 409],
  ["STALE_STATE_VERSION", 409],
  ["ACTION_ID_CONFLICT", 409],
  ["ILLEGAL_PHASE_TRANSITION", 409],
  ["WRONG_PHASE", 409],
  ["INVALID_ACTION", 409],
  ["WITNESS_NOT_ACTIVE", 409],
  ["WITNESS_NOT_AVAILABLE", 409],
  ["WITNESS_GENERATION_STALE", 409],
  ["WITNESS_GENERATION_INVALID", 422],
  ["COURTROOM_MODEL_CALL_CONFLICT", 409],
  ["COURTROOM_MODEL_CALL_TRACE_INVALID", 422],
  ["PLAYER_ACTION_NOT_PERMITTED", 403],
  ["PLAYER_CANNOT_CALL_WITNESS", 403],
  ["PLAYER_DOES_NOT_OWN_EXAMINATION", 403],
  ["ACTOR_NOT_PERMITTED", 403],
]);

export function caseServiceErrorResponse(error: unknown): Response {
  if (error instanceof CaseServiceBoundaryError) {
    return caseServiceJson({ error: error.code }, error.status);
  }
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("CASE_COMPILE_CLAIM_CONFLICT") ||
    message.includes("CASE_COMPILE_CLAIM_FENCE")
  ) {
    return caseServiceJson({ error: "CASE_COMPILE_CLAIM_REJECTED" }, 409);
  }
  for (const [code, status] of INTERNAL_ERROR_STATUS) {
    if (message.includes(code)) return caseServiceJson({ error: code }, status);
  }
  return caseServiceJson({ error: "CASE_SERVICE_INTERNAL_ERROR" }, 500);
}
