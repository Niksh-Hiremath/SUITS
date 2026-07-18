import { performance } from "node:perf_hooks";

import type { ExtractedBlock } from "../schema";

export const MAX_DOCUMENT_EXTRACTION_DURATION_MS = 30_000;

export class DocumentExtractionError extends Error {
  constructor(code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "DocumentExtractionError";
  }
}

export class ExtractionDeadline {
  readonly #signal: AbortSignal | undefined;
  readonly #startedAt: number;
  readonly #timeoutMilliseconds: number;

  constructor(signal?: AbortSignal, timeoutMilliseconds?: number) {
    if (
      timeoutMilliseconds !== undefined &&
      (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0)
    ) {
      throw new DocumentExtractionError("UPLOAD_EXTRACTION_TIMEOUT_INVALID");
    }
    this.#signal = signal;
    this.#startedAt = performance.now();
    this.#timeoutMilliseconds = Math.min(
      timeoutMilliseconds ?? MAX_DOCUMENT_EXTRACTION_DURATION_MS,
      MAX_DOCUMENT_EXTRACTION_DURATION_MS,
    );
  }

  get signal(): AbortSignal | undefined {
    return this.#signal;
  }

  remainingMilliseconds(): number {
    return Math.max(0, this.#timeoutMilliseconds - (performance.now() - this.#startedAt));
  }

  throwIfUnavailable(timeoutCode: string): void {
    if (this.#signal?.aborted) {
      throw new DocumentExtractionError("UPLOAD_EXTRACTION_CANCELLED", this.#signal.reason);
    }
    if (this.remainingMilliseconds() <= 0) {
      throw new DocumentExtractionError(timeoutCode);
    }
  }
}

export function normalizeExtractedText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

export function requireExtractedContent(
  blocks: ExtractedBlock[],
  maximumCharacters: number,
): ExtractedBlock[] {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters <= 0) {
    throw new DocumentExtractionError("UPLOAD_EXTRACTION_CHARACTER_LIMIT_INVALID");
  }
  if (blocks.length === 0) {
    throw new DocumentExtractionError("UPLOAD_CONTENT_EMPTY");
  }
  const combinedCharacterCount = blocks.reduce(
    (total, block, index) => total + block.text.length + (index === 0 ? 0 : 2),
    0,
  );
  if (combinedCharacterCount > maximumCharacters) {
    throw new DocumentExtractionError("UPLOAD_EXTRACTION_CHARACTER_LIMIT_EXCEEDED");
  }
  return blocks;
}

export function rethrowExtractionFailure(code: string, error: unknown): never {
  if (error instanceof DocumentExtractionError) throw error;
  throw new DocumentExtractionError(code, error);
}
