import { PDFParse } from "pdf-parse";

import type { BinaryExtractionInput, DocumentExtractionAdapter } from "../ingestion";
import { ExtractedDocumentSchema, type ExtractedBlock } from "../schema";
import {
  DocumentExtractionError,
  ExtractionDeadline,
  normalizeExtractedText,
  requireExtractedContent,
  rethrowExtractionFailure,
} from "./shared";

export const PDF_EXTRACTION_ADAPTER_ID = "pdf-parse-v2.4.5" as const;
export const MAX_PDF_PAGE_COUNT = 300;

async function runPdfOperation<T>(
  operation: () => Promise<T>,
  deadline: ExtractionDeadline,
  cancel: () => Promise<void>,
  timeoutCode: string,
): Promise<T> {
  deadline.throwIfUnavailable(timeoutCode);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const signal = deadline.signal;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
    };
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const cancelWith = (error: DocumentExtractionError) => {
      if (settled) return;
      settled = true;
      cleanup();
      void cancel().then(
        () => reject(error),
        (cancellationError: unknown) =>
          reject(
            new DocumentExtractionError(error.message, {
              boundaryCause: error.cause,
              cancellationError,
            }),
          ),
      );
    };
    function handleAbort() {
      cancelWith(new DocumentExtractionError("UPLOAD_EXTRACTION_CANCELLED", signal?.reason));
    }

    const timer = setTimeout(
      () => cancelWith(new DocumentExtractionError(timeoutCode)),
      Math.max(1, Math.ceil(deadline.remainingMilliseconds())),
    );
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    try {
      void operation().then(resolveOnce, rejectOnce);
    } catch (error) {
      rejectOnce(error);
    }
  });
}

export const PDF_EXTRACTION_ADAPTER: DocumentExtractionAdapter = Object.freeze({
  adapterId: PDF_EXTRACTION_ADAPTER_ID,
  supportedMimeTypes: ["application/pdf"] as const,
  async extract(input: BinaryExtractionInput) {
    if (input.mimeType !== "application/pdf") {
      throw new DocumentExtractionError("UPLOAD_PDF_MIME_TYPE_MISMATCH");
    }

    const deadline = new ExtractionDeadline(input.signal, input.timeoutMilliseconds);
    deadline.throwIfUnavailable("UPLOAD_PDF_EXTRACTION_TIMEOUT");
    let parser: PDFParse;
    try {
      parser = new PDFParse({
        data: Uint8Array.from(input.bytes),
        disableFontFace: true,
        isEvalSupported: false,
        stopAtErrors: true,
        useSystemFonts: false,
      });
    } catch (error) {
      rethrowExtractionFailure("UPLOAD_PDF_EXTRACTION_FAILED", error);
    }

    let destroyPromise: Promise<void> | undefined;
    const destroy = () => {
      destroyPromise ??= parser.destroy();
      return destroyPromise;
    };
    let document: ReturnType<typeof ExtractedDocumentSchema.parse> | undefined;
    let failure: unknown;
    try {
      const info = await runPdfOperation(
        () => parser.getInfo(),
        deadline,
        destroy,
        "UPLOAD_PDF_EXTRACTION_TIMEOUT",
      );
      if (info.total > MAX_PDF_PAGE_COUNT) {
        throw new DocumentExtractionError("UPLOAD_PDF_PAGE_LIMIT_EXCEEDED");
      }
      if (info.total <= 0) throw new DocumentExtractionError("UPLOAD_CONTENT_EMPTY");

      const blocks: ExtractedBlock[] = [];
      let extractedCharacters = 0;
      for (let pageNumber = 1; pageNumber <= info.total; pageNumber += 1) {
        const result = await runPdfOperation(
          () => parser.getText({ partial: [pageNumber] }),
          deadline,
          destroy,
          "UPLOAD_PDF_EXTRACTION_TIMEOUT",
        );
        for (const page of result.pages) {
          const text = normalizeExtractedText(page.text);
          if (text.length === 0) continue;
          extractedCharacters += text.length + (blocks.length === 0 ? 0 : 2);
          if (extractedCharacters > input.maximumCharacters) {
            throw new DocumentExtractionError("UPLOAD_EXTRACTION_CHARACTER_LIMIT_EXCEEDED");
          }
          blocks.push({ text, pageNumber: page.num, label: `Page ${page.num}` });
        }
      }
      document = ExtractedDocumentSchema.parse({
        adapterId: PDF_EXTRACTION_ADAPTER_ID,
        mimeType: input.mimeType,
        blocks: requireExtractedContent(blocks, input.maximumCharacters),
      });
    } catch (error) {
      failure = error;
    }
    try {
      await destroy();
    } catch (cleanupError) {
      failure =
        failure instanceof DocumentExtractionError
          ? new DocumentExtractionError(failure.message, {
              extractionCause: failure.cause,
              cleanupError,
            })
          : new DocumentExtractionError(
              failure === undefined ? "UPLOAD_PDF_CLEANUP_FAILED" : "UPLOAD_PDF_EXTRACTION_FAILED",
              { extractionError: failure, cleanupError },
            );
    }
    if (failure !== undefined) rethrowExtractionFailure("UPLOAD_PDF_EXTRACTION_FAILED", failure);
    if (document === undefined) {
      throw new DocumentExtractionError("UPLOAD_PDF_EXTRACTION_FAILED");
    }
    return document;
  },
});
