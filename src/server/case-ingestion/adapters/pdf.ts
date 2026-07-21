import { getResolvedPDFJS } from "unpdf";

import type { BinaryExtractionInput, DocumentExtractionAdapter } from "../ingestion";
import { ExtractedDocumentSchema, type ExtractedBlock } from "../schema";
import {
  DocumentExtractionError,
  ExtractionDeadline,
  normalizeExtractedText,
  requireExtractedContent,
  rethrowExtractionFailure,
} from "./shared";

export const PDF_EXTRACTION_ADAPTER_ID = "unpdf-v1.6.2" as const;
export const MAX_PDF_PAGE_COUNT = 300;
export const MAX_PDF_CLEANUP_DURATION_MS = 2_000;

async function runBoundedPdfCleanup(cleanup: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(
      () =>
        finish(() => reject(new DocumentExtractionError("UPLOAD_PDF_CLEANUP_TIMEOUT"))),
      MAX_PDF_CLEANUP_DURATION_MS,
    );
    try {
      void cleanup().then(
        () => finish(resolve),
        (error: unknown) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

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
    let pdfjs: Awaited<ReturnType<typeof getResolvedPDFJS>>;
    try {
      pdfjs = await runPdfOperation(
        () => getResolvedPDFJS(),
        deadline,
        () => Promise.resolve(),
        "UPLOAD_PDF_EXTRACTION_TIMEOUT",
      );
    } catch (error) {
      rethrowExtractionFailure("UPLOAD_PDF_EXTRACTION_FAILED", error);
    }

    let loadingTask: ReturnType<typeof pdfjs.getDocument>;
    try {
      loadingTask = pdfjs.getDocument({
        data: Uint8Array.from(input.bytes),
        disableFontFace: true,
        isEvalSupported: false,
        stopAtErrors: true,
        useSystemFonts: true,
      });
    } catch (error) {
      rethrowExtractionFailure("UPLOAD_PDF_EXTRACTION_FAILED", error);
    }

    let parser: Awaited<(typeof loadingTask)["promise"]> | undefined;
    let destroyPromise: Promise<void> | undefined;
    let boundedDestroyPromise: Promise<void> | undefined;
    const destroy = () => {
      destroyPromise ??=
        parser === undefined ? loadingTask.destroy() : parser.destroy();
      return destroyPromise;
    };
    const destroyWithinLimit = () => {
      boundedDestroyPromise ??= runBoundedPdfCleanup(destroy);
      return boundedDestroyPromise;
    };
    let document: ReturnType<typeof ExtractedDocumentSchema.parse> | undefined;
    let failure: unknown;
    try {
      const loadedParser = await runPdfOperation(
        () => loadingTask.promise,
        deadline,
        destroyWithinLimit,
        "UPLOAD_PDF_EXTRACTION_TIMEOUT",
      );
      parser = loadedParser;
      if (loadedParser.numPages > MAX_PDF_PAGE_COUNT) {
        throw new DocumentExtractionError("UPLOAD_PDF_PAGE_LIMIT_EXCEEDED");
      }
      if (loadedParser.numPages <= 0) {
        throw new DocumentExtractionError("UPLOAD_CONTENT_EMPTY");
      }

      const blocks: ExtractedBlock[] = [];
      let extractedCharacters = 0;
      for (let pageNumber = 1; pageNumber <= loadedParser.numPages; pageNumber += 1) {
        const page = await runPdfOperation(
          () => loadedParser.getPage(pageNumber),
          deadline,
          destroyWithinLimit,
          "UPLOAD_PDF_EXTRACTION_TIMEOUT",
        );
        try {
          const content = await runPdfOperation(
            () => page.getTextContent(),
            deadline,
            destroyWithinLimit,
            "UPLOAD_PDF_EXTRACTION_TIMEOUT",
          );
          const remainingCharacters =
            input.maximumCharacters - extractedCharacters - (blocks.length === 0 ? 0 : 2);
          if (remainingCharacters <= 0) {
            throw new DocumentExtractionError("UPLOAD_EXTRACTION_CHARACTER_LIMIT_EXCEEDED");
          }
          const textParts: string[] = [];
          let rawPageCharacters = 0;
          for (const item of content.items) {
            if (!("str" in item)) continue;
            const part = `${item.str}${item.hasEOL ? "\n" : ""}`;
            rawPageCharacters += part.length;
            if (rawPageCharacters > remainingCharacters) {
              throw new DocumentExtractionError("UPLOAD_EXTRACTION_CHARACTER_LIMIT_EXCEEDED");
            }
            textParts.push(part);
          }
          const text = normalizeExtractedText(textParts.join(""));
          if (text.length === 0) continue;
          extractedCharacters += text.length + (blocks.length === 0 ? 0 : 2);
          if (extractedCharacters > input.maximumCharacters) {
            throw new DocumentExtractionError("UPLOAD_EXTRACTION_CHARACTER_LIMIT_EXCEEDED");
          }
          blocks.push({ text, pageNumber, label: `Page ${pageNumber}` });
        } finally {
          page.cleanup();
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
      await destroyWithinLimit();
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
