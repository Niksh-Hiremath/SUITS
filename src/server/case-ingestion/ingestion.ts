import { createHash } from "node:crypto";

import {
  SourceSegmentSchema,
  type SourceSegment,
} from "../../domain/case-graph";
import {
  CASE_INGESTION_SCHEMA_VERSION,
  CaseUploadRegistrationSchema,
  ExtractedDocumentSchema,
  MAX_EXTRACTED_CHARACTERS,
  MAX_PROMPT_INJECTION_FLAGS,
  MAX_SOURCE_SEGMENT_CHARACTERS,
  PromptInjectionFlagSchema,
  Sha256DigestSchema,
  isBinaryCaseUploadMimeType,
  isTextCaseUploadMimeType,
  normalizeCaseUploadMimeType,
  type BinaryCaseUploadMimeType,
  type CaseUploadRegistration,
  type ExtractedBlock,
  type ExtractedDocument,
  type PromptInjectionFlag,
} from "./schema";

export type BinaryExtractionInput = {
  bytes: Uint8Array;
  originalName: string;
  mimeType: BinaryCaseUploadMimeType;
  maximumCharacters: number;
};

export interface DocumentExtractionAdapter {
  readonly adapterId: string;
  readonly supportedMimeTypes: readonly BinaryCaseUploadMimeType[];
  extract(input: BinaryExtractionInput): Promise<ExtractedDocument>;
}

export type IngestCaseUploadInput = {
  uploadId: string;
  caseId: string;
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
  expectedContentDigest?: string;
};

export type CaseIngestionResult = {
  schemaVersion: typeof CASE_INGESTION_SCHEMA_VERSION;
  upload: CaseUploadRegistration;
  sourceId: string;
  segments: SourceSegment[];
  injectionFlags: PromptInjectionFlag[];
  extractionAdapterId: string;
  extractionCharacterCount: number;
};

type InjectionPattern = {
  patternId: PromptInjectionFlag["patternId"];
  severity: PromptInjectionFlag["severity"];
  expression: RegExp;
};

const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    patternId: "instruction_override",
    severity: "high",
    expression: /\b(?:ignore|disregard|override)\b[\s\S]{0,80}\b(?:previous|prior|system|developer)\b[\s\S]{0,40}\binstructions?\b/iu,
  },
  {
    patternId: "role_impersonation",
    severity: "medium",
    expression: /(?:<\/?(?:system|developer|assistant)>|\b(?:system|developer)\s*:\s*you\s+(?:are|must)\b)/iu,
  },
  {
    patternId: "tool_invocation",
    severity: "medium",
    expression: /\b(?:call|invoke|execute|run)\b[\s\S]{0,50}\b(?:tool|function|shell|command)\b/iu,
  },
  {
    patternId: "secret_exfiltration",
    severity: "high",
    expression: /\b(?:reveal|print|return|exfiltrate|steal)\b[\s\S]{0,60}\b(?:secret|api[_ -]?key|token|credential|environment variable)\b/iu,
  },
  {
    patternId: "safety_bypass",
    severity: "high",
    expression: /\b(?:jailbreak|bypass|disable)\b[\s\S]{0,60}\b(?:safety|guardrail|policy|restriction)\b/iu,
  },
] as const;

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function detectPromptInjectionFlags(text: string): PromptInjectionFlag[] {
  const flags: PromptInjectionFlag[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const expression = new RegExp(pattern.expression.source, `${pattern.expression.flags}g`);
    for (const match of text.matchAll(expression)) {
      const matchedText = match[0];
      const startOffset = match.index;
      if (startOffset === undefined || matchedText.length === 0) continue;
      flags.push(
        PromptInjectionFlagSchema.parse({
          patternId: pattern.patternId,
          severity: pattern.severity,
          startOffset,
          endOffset: startOffset + matchedText.length,
          fingerprint: sha256Hex(matchedText),
        }),
      );
    }
  }
  return flags
    .sort(
      (left, right) => left.startOffset - right.startOffset || left.patternId.localeCompare(right.patternId),
    )
    .slice(0, MAX_PROMPT_INJECTION_FLAGS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function extractTextDocument(bytes: Uint8Array, mimeType: CaseUploadRegistration["mimeType"]): ExtractedDocument {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("UPLOAD_TEXT_ENCODING_INVALID");
  }
  text = text.replace(/\r\n?/gu, "\n").trim();
  if (!text) throw new Error("UPLOAD_CONTENT_EMPTY");

  if (mimeType === "application/json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error("UPLOAD_JSON_INVALID");
    }
    const canonical = JSON.stringify(sortJsonValue(parsed), null, 2);
    if (!canonical) throw new Error("UPLOAD_JSON_INVALID");
    text = canonical;
  }

  return ExtractedDocumentSchema.parse({
    adapterId: "builtin-text-v1",
    mimeType,
    blocks: [{ text, pageNumber: null, label: null }],
  });
}

async function extractBinaryDocument(
  bytes: Uint8Array,
  originalName: string,
  mimeType: BinaryCaseUploadMimeType,
  adapters: readonly DocumentExtractionAdapter[],
): Promise<ExtractedDocument> {
  const adapter = adapters.find((candidate) => candidate.supportedMimeTypes.includes(mimeType));
  if (!adapter) throw new Error("UPLOAD_EXTRACTION_ADAPTER_UNAVAILABLE");
  const document = ExtractedDocumentSchema.parse(
    await adapter.extract({
      bytes,
      originalName,
      mimeType,
      maximumCharacters: MAX_EXTRACTED_CHARACTERS,
    }),
  );
  if (document.adapterId !== adapter.adapterId || document.mimeType !== mimeType) {
    throw new Error("UPLOAD_EXTRACTION_ADAPTER_MISMATCH");
  }
  return document;
}

type TextSlice = { text: string; startOffset: number; endOffset: number };

function splitText(text: string, maximumCharacters: number): TextSlice[] {
  const slices: TextSlice[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/u.test(text[cursor] ?? "")) cursor += 1;
    if (cursor >= text.length) break;

    let end = Math.min(cursor + maximumCharacters, text.length);
    if (end < text.length) {
      const candidate = text.slice(cursor, end);
      const minimumBreak = Math.floor(maximumCharacters * 0.6);
      const paragraphBreak = candidate.lastIndexOf("\n\n");
      const lineBreak = candidate.lastIndexOf("\n");
      const wordBreak = candidate.lastIndexOf(" ");
      const chosen = [paragraphBreak, lineBreak, wordBreak].find((offset) => offset >= minimumBreak);
      if (chosen !== undefined) end = cursor + chosen;
    }

    while (end > cursor && /\s/u.test(text[end - 1] ?? "")) end -= 1;
    if (end <= cursor) end = Math.min(cursor + maximumCharacters, text.length);
    slices.push({ text: text.slice(cursor, end), startOffset: cursor, endOffset: end });
    cursor = end;
  }
  return slices;
}

function createSourceSegments(
  upload: CaseUploadRegistration,
  document: ExtractedDocument,
): { sourceId: string; segments: SourceSegment[] } {
  const sourceFingerprint = sha256Hex(`${upload.uploadId}:${upload.contentDigest}`);
  const sourceId = `source:${sourceFingerprint.slice(0, 32)}`;
  const segments: SourceSegment[] = [];
  let globalOffset = 0;

  for (const block of document.blocks) {
    const slices = splitText(block.text, MAX_SOURCE_SEGMENT_CHARACTERS);
    for (const slice of slices) {
      const segmentIndex = segments.length;
      const excerptDigest = sha256Hex(slice.text);
      segments.push(
        SourceSegmentSchema.parse({
          sourceSegmentId: `segment:${sourceFingerprint.slice(0, 20)}:${String(segmentIndex + 1).padStart(4, "0")}:${excerptDigest.slice(0, 12)}`,
          sourceId,
          documentName: upload.originalName,
          mimeType: upload.mimeType,
          locator:
            block.pageNumber === null
              ? {
                  kind: "text",
                  startOffset: globalOffset + slice.startOffset,
                  endOffset: globalOffset + slice.endOffset,
                }
              : { kind: "page", page: block.pageNumber, label: block.label },
          excerpt: slice.text,
          sha256: excerptDigest,
        }),
      );
    }
    globalOffset += block.text.length + 2;
  }
  if (segments.length === 0) throw new Error("UPLOAD_CONTENT_EMPTY");
  return { sourceId, segments };
}

function combinedExtractedText(blocks: readonly ExtractedBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

export async function ingestCaseUpload(
  input: IngestCaseUploadInput,
  adapters: readonly DocumentExtractionAdapter[] = [],
): Promise<CaseIngestionResult> {
  const mimeType = normalizeCaseUploadMimeType(input.mimeType);
  const contentDigest = sha256Hex(input.bytes);
  if (input.expectedContentDigest !== undefined) {
    const expected = Sha256DigestSchema.parse(input.expectedContentDigest);
    if (expected !== contentDigest) throw new Error("UPLOAD_DIGEST_MISMATCH");
  }

  const upload = CaseUploadRegistrationSchema.parse({
    uploadId: input.uploadId,
    caseId: input.caseId,
    originalName: input.originalName,
    mimeType,
    sizeBytes: input.bytes.byteLength,
    contentDigest,
  });

  let document: ExtractedDocument;
  if (isTextCaseUploadMimeType(upload.mimeType)) {
    document = extractTextDocument(input.bytes, upload.mimeType);
  } else if (isBinaryCaseUploadMimeType(upload.mimeType)) {
    document = await extractBinaryDocument(
      input.bytes,
      upload.originalName,
      upload.mimeType,
      adapters,
    );
  } else {
    throw new Error("UPLOAD_MIME_TYPE_UNSUPPORTED");
  }

  const extractedText = combinedExtractedText(document.blocks);
  const { sourceId, segments } = createSourceSegments(upload, document);
  return {
    schemaVersion: CASE_INGESTION_SCHEMA_VERSION,
    upload,
    sourceId,
    segments,
    injectionFlags: detectPromptInjectionFlags(extractedText),
    extractionAdapterId: document.adapterId,
    extractionCharacterCount: extractedText.length,
  };
}
