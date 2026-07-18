import type { ExtractedBlock } from "../schema";

export class DocumentExtractionError extends Error {
  constructor(code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "DocumentExtractionError";
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
