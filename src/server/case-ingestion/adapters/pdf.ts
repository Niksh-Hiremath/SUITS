import { PDFParse } from "pdf-parse";

import type { BinaryExtractionInput, DocumentExtractionAdapter } from "../ingestion";
import { ExtractedDocumentSchema, type ExtractedBlock } from "../schema";
import {
  DocumentExtractionError,
  normalizeExtractedText,
  requireExtractedContent,
  rethrowExtractionFailure,
} from "./shared";

export const PDF_EXTRACTION_ADAPTER_ID = "pdf-parse-v2.4.5" as const;

export const PDF_EXTRACTION_ADAPTER: DocumentExtractionAdapter = Object.freeze({
  adapterId: PDF_EXTRACTION_ADAPTER_ID,
  supportedMimeTypes: ["application/pdf"] as const,
  async extract(input: BinaryExtractionInput) {
    if (input.mimeType !== "application/pdf") {
      throw new DocumentExtractionError("UPLOAD_PDF_MIME_TYPE_MISMATCH");
    }

    const parser = new PDFParse({
      data: Uint8Array.from(input.bytes),
      disableFontFace: true,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: false,
    });
    try {
      const result = await parser.getText();
      const blocks: ExtractedBlock[] = result.pages.flatMap((page) => {
        const text = normalizeExtractedText(page.text);
        return text.length === 0
          ? []
          : [{ text, pageNumber: page.num, label: `Page ${page.num}` }];
      });
      return ExtractedDocumentSchema.parse({
        adapterId: PDF_EXTRACTION_ADAPTER_ID,
        mimeType: input.mimeType,
        blocks: requireExtractedContent(blocks, input.maximumCharacters),
      });
    } catch (error) {
      rethrowExtractionFailure("UPLOAD_PDF_EXTRACTION_FAILED", error);
    } finally {
      await parser.destroy();
    }
  },
});
