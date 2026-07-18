import { Worker } from "node:worker_threads";

import type { BinaryExtractionInput, DocumentExtractionAdapter } from "../ingestion";
import { ExtractedDocumentSchema, type ExtractedBlock } from "../schema";
import { preflightDocxArchive } from "./docx-preflight";
import {
  DocumentExtractionError,
  ExtractionDeadline,
  normalizeExtractedText,
  requireExtractedContent,
  rethrowExtractionFailure,
} from "./shared";

export {
  MAX_DOCX_ZIP_COMPRESSION_RATIO,
  MAX_DOCX_ZIP_ENTRY_COUNT,
  MAX_DOCX_ZIP_ENTRY_UNCOMPRESSED_BYTES,
  MAX_DOCX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
} from "./docx-preflight";

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
export const DOCX_EXTRACTION_ADAPTER_ID = "mammoth-v1.12.0" as const;

const MAMMOTH_WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const mammoth = require("mammoth");
void mammoth.extractRawText({ buffer: Buffer.from(workerData.bytes) }).then(
  (result) => parentPort.postMessage({
    ok: true,
    value: result.value,
    messages: result.messages.map((message) => ({
      type: message.type,
      description: message.message || (message.error && message.error.message) || "Parser message",
    })),
  }),
  (error) => parentPort.postMessage({
    ok: false,
    description: error && error.message ? error.message : "Mammoth extraction failed",
  }),
);
`;

type MammothWorkerResult =
  | Readonly<{
      ok: true;
      value: string;
      messages: ReadonlyArray<Readonly<{ type: string; description: string }>>;
    }>
  | Readonly<{ ok: false; description: string }>;

function isMammothWorkerResult(value: unknown): value is MammothWorkerResult {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  if (value.ok === false) return "description" in value && typeof value.description === "string";
  return value.ok === true &&
    "value" in value &&
    typeof value.value === "string" &&
    "messages" in value &&
    Array.isArray(value.messages) &&
    value.messages.every((message) =>
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      typeof message.type === "string" &&
      "description" in message &&
      typeof message.description === "string");
}

async function extractRawTextInWorker(
  bytes: Uint8Array,
  deadline: ExtractionDeadline,
): Promise<MammothWorkerResult> {
  deadline.throwIfUnavailable("UPLOAD_DOCX_EXTRACTION_TIMEOUT");
  const worker = new Worker(MAMMOTH_WORKER_SOURCE, {
    eval: true,
    workerData: { bytes: Uint8Array.from(bytes) },
  });
  return new Promise<MammothWorkerResult>((resolve, reject) => {
    let settled = false;
    const signal = deadline.signal;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
      worker.removeAllListeners();
    };
    const terminateWith = (error: DocumentExtractionError) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().then(
        () => reject(error),
        (terminationError: unknown) =>
          reject(new DocumentExtractionError(error.message, { terminationError })),
      );
    };
    function handleAbort() {
      terminateWith(new DocumentExtractionError("UPLOAD_EXTRACTION_CANCELLED", signal?.reason));
    }

    const timer = setTimeout(
      () => terminateWith(new DocumentExtractionError("UPLOAD_DOCX_EXTRACTION_TIMEOUT")),
      Math.max(1, Math.ceil(deadline.remainingMilliseconds())),
    );
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    worker.once("message", (message: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate();
      if (!isMammothWorkerResult(message)) {
        reject(new DocumentExtractionError("UPLOAD_DOCX_WORKER_RESPONSE_INVALID"));
        return;
      }
      resolve(message);
    });
    worker.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DocumentExtractionError("UPLOAD_DOCX_EXTRACTION_FAILED", error));
    });
    worker.once("exit", (exitCode) => {
      if (settled || exitCode === 0) return;
      settled = true;
      cleanup();
      reject(new DocumentExtractionError("UPLOAD_DOCX_WORKER_EXITED"));
    });
  });
}

export const DOCX_EXTRACTION_ADAPTER: DocumentExtractionAdapter = Object.freeze({
  adapterId: DOCX_EXTRACTION_ADAPTER_ID,
  supportedMimeTypes: [DOCX_MIME_TYPE] as const,
  async extract(input: BinaryExtractionInput) {
    if (input.mimeType !== DOCX_MIME_TYPE) {
      throw new DocumentExtractionError("UPLOAD_DOCX_MIME_TYPE_MISMATCH");
    }

    const deadline = new ExtractionDeadline(input.signal, input.timeoutMilliseconds);
    try {
      deadline.throwIfUnavailable("UPLOAD_DOCX_EXTRACTION_TIMEOUT");
      preflightDocxArchive(input.bytes, deadline);
      deadline.throwIfUnavailable("UPLOAD_DOCX_EXTRACTION_TIMEOUT");
      const result = await extractRawTextInWorker(input.bytes, deadline);
      deadline.throwIfUnavailable("UPLOAD_DOCX_EXTRACTION_TIMEOUT");
      if (!result.ok) {
        throw new DocumentExtractionError("UPLOAD_DOCX_EXTRACTION_FAILED", result.description);
      }
      const extractionError = result.messages.find((message) => message.type === "error");
      if (extractionError) {
        throw new DocumentExtractionError("UPLOAD_DOCX_EXTRACTION_FAILED", extractionError.description);
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
      if (!(error instanceof DocumentExtractionError)) {
        deadline.throwIfUnavailable("UPLOAD_DOCX_EXTRACTION_TIMEOUT");
      }
      rethrowExtractionFailure("UPLOAD_DOCX_EXTRACTION_FAILED", error);
    }
  },
});
