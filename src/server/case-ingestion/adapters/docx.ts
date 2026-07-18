import { Buffer } from "node:buffer";

import mammoth from "mammoth";

import type { BinaryExtractionInput, DocumentExtractionAdapter } from "../ingestion";
import { ExtractedDocumentSchema, type ExtractedBlock } from "../schema";
import {
  DocumentExtractionError,
  normalizeExtractedText,
  requireExtractedContent,
  rethrowExtractionFailure,
} from "./shared";

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
export const DOCX_EXTRACTION_ADAPTER_ID = "mammoth-v1.12.0" as const;

export const DOCX_EXTRACTION_ADAPTER: DocumentExtractionAdapter = Object.freeze({
  adapterId: DOCX_EXTRACTION_ADAPTER_ID,
  supportedMimeTypes: [DOCX_MIME_TYPE] as const,
  async extract(input: BinaryExtractionInput) {
    if (input.mimeType !== DOCX_MIME_TYPE) {
      throw new DocumentExtractionError("UPLOAD_DOCX_MIME_TYPE_MISMATCH");
    }

    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
      const extractionError = result.messages.find((message) => message.type === "error");
      if (extractionError?.type === "error") {
        throw new DocumentExtractionError("UPLOAD_DOCX_EXTRACTION_FAILED", extractionError.error);
      }
      const text = normalizeExtractedText(result.value);
      const blocks: ExtractedBlock[] = text.length === 0
        ? []
        : [{ text, pageNumber: null, label: null }];
      return ExtractedDocumentSchema.parse({
        adapterId: DOCX_EXTRACTION_ADAPTER_ID,
        mimeType: input.mimeType,
        blocks: requireExtractedContent(blocks, input.maximumCharacters),
      });
    } catch (error) {
      rethrowExtractionFailure("UPLOAD_DOCX_EXTRACTION_FAILED", error);
    }
  },
});
