import { z } from "zod";

export const CASE_UPLOAD_SCHEMA_VERSION = "case-upload.v1" as const;
export const CASE_INGESTION_SCHEMA_VERSION = "case-ingestion.v1" as const;
export const MAX_CASE_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 2_000_000;
export const MAX_EXTRACTED_BLOCKS = 2_000;
export const MAX_SOURCE_SEGMENT_CHARACTERS = 6_000;
export const MAX_PROMPT_INJECTION_FLAGS = 500;

export const SUPPORTED_CASE_UPLOAD_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const TEXT_CASE_UPLOAD_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
] as const;

export const BINARY_CASE_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const entityIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export const CaseIngestionEntityIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(entityIdPattern, "IDs may contain only letters, numbers, dot, underscore, colon, and hyphen");

export const Sha256DigestSchema = z
  .string()
  .regex(sha256Pattern, "Expected a lowercase SHA-256 digest");

export const CaseUploadMimeTypeSchema = z.enum(SUPPORTED_CASE_UPLOAD_MIME_TYPES);
export const TextCaseUploadMimeTypeSchema = z.enum(TEXT_CASE_UPLOAD_MIME_TYPES);
export const BinaryCaseUploadMimeTypeSchema = z.enum(BINARY_CASE_UPLOAD_MIME_TYPES);

export const OriginalFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (name) => !/[\\/\u0000-\u001f\u007f]/u.test(name) && name !== "." && name !== "..",
    "File name must not contain paths or control characters",
  );

export const CaseUploadStatusSchema = z.enum(["uploaded", "indexed", "rejected"]);

export const PromptInjectionFlagSchema = z
  .object({
    patternId: z.enum([
      "instruction_override",
      "role_impersonation",
      "tool_invocation",
      "secret_exfiltration",
      "safety_bypass",
    ]),
    severity: z.enum(["low", "medium", "high"]),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    fingerprint: Sha256DigestSchema,
  })
  .strict()
  .superRefine((flag, ctx) => {
    if (flag.endOffset <= flag.startOffset) {
      ctx.addIssue({
        code: "custom",
        path: ["endOffset"],
        message: "Flag endOffset must be greater than startOffset",
      });
    }
  });

export const CaseUploadRegistrationSchema = z
  .object({
    uploadId: CaseIngestionEntityIdSchema,
    caseId: CaseIngestionEntityIdSchema,
    originalName: OriginalFileNameSchema,
    mimeType: CaseUploadMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_CASE_UPLOAD_SIZE_BYTES),
    contentDigest: Sha256DigestSchema,
  })
  .strict();

export const CaseUploadVersionMetadataSchema = z
  .object({
    schemaVersion: z.literal(CASE_UPLOAD_SCHEMA_VERSION),
    digestVerified: z.boolean(),
    extractionAdapterId: CaseIngestionEntityIdSchema.nullable(),
    extractionCharacterCount: z.number().int().nonnegative(),
    sourceSegmentCount: z.number().int().nonnegative(),
    injectionFlags: z.array(PromptInjectionFlagSchema).max(MAX_PROMPT_INJECTION_FLAGS),
    rejectionCode: z
      .enum(["digest_mismatch", "extraction_failed", "unsupported_content", "unsafe_content"])
      .nullable(),
  })
  .strict();

export const CaseUploadVersionSchema = z
  .object({
    uploadRecordId: CaseIngestionEntityIdSchema,
    uploadId: CaseIngestionEntityIdSchema,
    version: z.number().int().positive(),
    caseId: CaseIngestionEntityIdSchema,
    caseVersion: z.number().int().positive().nullable(),
    ownerId: z.string().trim().min(1).max(500),
    originalName: OriginalFileNameSchema,
    mimeType: CaseUploadMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_CASE_UPLOAD_SIZE_BYTES),
    contentDigest: Sha256DigestSchema,
    status: CaseUploadStatusSchema,
    metadata: CaseUploadVersionMetadataSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const ExtractedBlockSchema = z
  .object({
    text: z.string().min(1).max(MAX_EXTRACTED_CHARACTERS),
    pageNumber: z.number().int().positive().max(100_000).nullable(),
    label: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

export const ExtractedDocumentSchema = z
  .object({
    adapterId: CaseIngestionEntityIdSchema,
    mimeType: CaseUploadMimeTypeSchema,
    blocks: z.array(ExtractedBlockSchema).min(1).max(MAX_EXTRACTED_BLOCKS),
  })
  .strict()
  .superRefine((document, ctx) => {
    const characterCount = document.blocks.reduce((total, block) => total + block.text.length, 0);
    if (characterCount > MAX_EXTRACTED_CHARACTERS) {
      ctx.addIssue({
        code: "custom",
        path: ["blocks"],
        message: `Extracted content exceeds ${MAX_EXTRACTED_CHARACTERS} characters`,
      });
    }
  });

export type CaseUploadMimeType = z.infer<typeof CaseUploadMimeTypeSchema>;
export type TextCaseUploadMimeType = z.infer<typeof TextCaseUploadMimeTypeSchema>;
export type BinaryCaseUploadMimeType = z.infer<typeof BinaryCaseUploadMimeTypeSchema>;
export type CaseUploadStatus = z.infer<typeof CaseUploadStatusSchema>;
export type PromptInjectionFlag = z.infer<typeof PromptInjectionFlagSchema>;
export type CaseUploadRegistration = z.infer<typeof CaseUploadRegistrationSchema>;
export type CaseUploadVersionMetadata = z.infer<typeof CaseUploadVersionMetadataSchema>;
export type CaseUploadVersion = z.infer<typeof CaseUploadVersionSchema>;
export type ExtractedBlock = z.infer<typeof ExtractedBlockSchema>;
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

export function normalizeCaseUploadMimeType(value: string): CaseUploadMimeType {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return CaseUploadMimeTypeSchema.parse(normalized);
}

export function isTextCaseUploadMimeType(
  mimeType: CaseUploadMimeType,
): mimeType is TextCaseUploadMimeType {
  return (TEXT_CASE_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isBinaryCaseUploadMimeType(
  mimeType: CaseUploadMimeType,
): mimeType is BinaryCaseUploadMimeType {
  return (BINARY_CASE_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType);
}
