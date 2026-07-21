import {
  MAX_CASE_UPLOAD_SIZE_BYTES,
  normalizeCaseUploadMimeType,
  type SupportedCaseUploadMimeType,
} from "../case-ingestion";

const MIME_BY_EXTENSION = {
  ".json": "application/json",
  ".markdown": "text/markdown",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
} as const satisfies Record<string, SupportedCaseUploadMimeType>;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

export function resolveCaseUploadMimeType(
  fileName: string,
  declaredMimeType: string,
  bytes: Uint8Array,
): SupportedCaseUploadMimeType {
  if (bytes.byteLength === 0) throw new Error("UPLOAD_CONTENT_EMPTY");
  if (bytes.byteLength > MAX_CASE_UPLOAD_SIZE_BYTES) throw new Error("UPLOAD_SIZE_EXCEEDED");

  const extensionMimeType = MIME_BY_EXTENSION[extensionOf(fileName) as keyof typeof MIME_BY_EXTENSION];
  if (!extensionMimeType) throw new Error("UPLOAD_FILE_EXTENSION_UNSUPPORTED");

  let declared: SupportedCaseUploadMimeType;
  const normalizedDeclaration = declaredMimeType.trim().toLowerCase();
  if (!normalizedDeclaration || normalizedDeclaration === "application/octet-stream") {
    declared = extensionMimeType;
  } else {
    declared = normalizeCaseUploadMimeType(normalizedDeclaration);
  }

  const markdownAliases = new Set<SupportedCaseUploadMimeType>(["text/markdown", "text/x-markdown"]);
  const declarationMatches = declared === extensionMimeType ||
    (markdownAliases.has(declared) && markdownAliases.has(extensionMimeType));
  if (!declarationMatches) throw new Error("UPLOAD_MIME_EXTENSION_MISMATCH");

  if (declared === "application/pdf" && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new Error("UPLOAD_PDF_SIGNATURE_INVALID");
  }
  return declared;
}
