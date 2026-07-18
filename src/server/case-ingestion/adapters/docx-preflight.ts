import { DocumentExtractionError, type ExtractionDeadline } from "./shared";

export const MAX_DOCX_ZIP_ENTRY_COUNT = 1_000;
export const MAX_DOCX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
export const MAX_DOCX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_DOCX_ZIP_COMPRESSION_RATIO = 100;

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MINIMUM_END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const MAXIMUM_ZIP_COMMENT_BYTES = 65_535;
const CENTRAL_DIRECTORY_ENTRY_HEADER_BYTES = 46;
const LOCAL_FILE_HEADER_BYTES = 30;
const ZIP64_UINT16_SENTINEL = 0xffff;
const ZIP64_UINT32_SENTINEL = 0xffffffff;
const REQUIRED_DOCX_PARTS = new Set([
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
]);

type DocxZipEntry = {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
};

function fail(code: string, cause?: unknown): never {
  throw new DocumentExtractionError(code, cause);
}

function findEndOfCentralDirectory(view: DataView): number {
  if (view.byteLength < MINIMUM_END_OF_CENTRAL_DIRECTORY_BYTES) {
    fail("UPLOAD_DOCX_ZIP_INVALID");
  }
  const earliestOffset = Math.max(
    0,
    view.byteLength - MINIMUM_END_OF_CENTRAL_DIRECTORY_BYTES - MAXIMUM_ZIP_COMMENT_BYTES,
  );
  for (
    let offset = view.byteLength - MINIMUM_END_OF_CENTRAL_DIRECTORY_BYTES;
    offset >= earliestOffset;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + MINIMUM_END_OF_CENTRAL_DIRECTORY_BYTES + commentLength === view.byteLength) {
      return offset;
    }
  }
  fail("UPLOAD_DOCX_ZIP_INVALID");
}

function decodeEntryName(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail("UPLOAD_DOCX_ZIP_PATH_INVALID", error);
  }
}

function validateEntryPath(fileName: string): void {
  const pathParts = fileName.split("/");
  if (
    fileName.length === 0 ||
    fileName.includes("\\") ||
    fileName.includes("\0") ||
    fileName.startsWith("/") ||
    /^[A-Za-z]:/u.test(fileName) ||
    pathParts.some((part) => part === "..")
  ) {
    fail("UPLOAD_DOCX_ZIP_PATH_INVALID");
  }
}

function validateLocalHeader(
  view: DataView,
  bytes: Uint8Array,
  localHeaderOffset: number,
  centralDirectoryOffset: number,
  expectedFileName: string,
  expectedFlags: number,
  expectedCompressionMethod: number,
): void {
  if (
    localHeaderOffset + LOCAL_FILE_HEADER_BYTES > centralDirectoryOffset ||
    view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE
  ) {
    fail("UPLOAD_DOCX_ZIP_INVALID");
  }
  const localFlags = view.getUint16(localHeaderOffset + 6, true);
  const localCompressionMethod = view.getUint16(localHeaderOffset + 8, true);
  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const localNameStart = localHeaderOffset + LOCAL_FILE_HEADER_BYTES;
  const localNameEnd = localNameStart + localNameLength;
  if (localNameEnd + localExtraLength > centralDirectoryOffset) {
    fail("UPLOAD_DOCX_ZIP_INVALID");
  }
  const localFileName = decodeEntryName(bytes.subarray(localNameStart, localNameEnd));
  if (
    localFileName !== expectedFileName ||
    localFlags !== expectedFlags ||
    localCompressionMethod !== expectedCompressionMethod
  ) {
    fail("UPLOAD_DOCX_ZIP_INVALID");
  }
}

export function preflightDocxArchive(
  bytes: Uint8Array,
  deadline?: ExtractionDeadline,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralDirectorySize = view.getUint32(endOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    fail("UPLOAD_DOCX_ZIP_MULTIDISK_UNSUPPORTED");
  }
  if (
    totalEntries === ZIP64_UINT16_SENTINEL ||
    centralDirectorySize === ZIP64_UINT32_SENTINEL ||
    centralDirectoryOffset === ZIP64_UINT32_SENTINEL
  ) {
    fail("UPLOAD_DOCX_ZIP64_UNSUPPORTED");
  }
  if (totalEntries > MAX_DOCX_ZIP_ENTRY_COUNT) {
    fail("UPLOAD_DOCX_ZIP_ENTRY_LIMIT_EXCEEDED");
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset > endOffset ||
    centralDirectoryEnd > endOffset ||
    centralDirectoryEnd < centralDirectoryOffset
  ) {
    fail("UPLOAD_DOCX_ZIP_INVALID");
  }

  const entries: DocxZipEntry[] = [];
  const fileNames = new Set<string>();
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (index % 64 === 0) deadline?.throwIfUnavailable("UPLOAD_DOCX_EXTRACTION_TIMEOUT");
    if (
      cursor + CENTRAL_DIRECTORY_ENTRY_HEADER_BYTES > centralDirectoryEnd ||
      view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY_SIGNATURE
    ) {
      fail("UPLOAD_DOCX_ZIP_INVALID");
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const fileNameStart = cursor + CENTRAL_DIRECTORY_ENTRY_HEADER_BYTES;
    const fileNameEnd = fileNameStart + fileNameLength;
    const nextCursor = fileNameEnd + extraLength + commentLength;

    if (nextCursor > centralDirectoryEnd || diskStart !== 0) {
      fail("UPLOAD_DOCX_ZIP_INVALID");
    }
    if ((flags & 0x1) !== 0) fail("UPLOAD_DOCX_ZIP_ENCRYPTED");
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      fail("UPLOAD_DOCX_ZIP_COMPRESSION_UNSUPPORTED");
    }
    const fileName = decodeEntryName(bytes.subarray(fileNameStart, fileNameEnd));
    validateEntryPath(fileName);
    if (fileNames.has(fileName)) fail("UPLOAD_DOCX_ZIP_DUPLICATE_ENTRY");
    fileNames.add(fileName);
    validateLocalHeader(
      view,
      bytes,
      localHeaderOffset,
      centralDirectoryOffset,
      fileName,
      flags,
      compressionMethod,
    );
    entries.push({ fileName, compressedSize, uncompressedSize });
    cursor = nextCursor;
  }

  for (const requiredPart of REQUIRED_DOCX_PARTS) {
    if (!fileNames.has(requiredPart)) fail("UPLOAD_DOCX_REQUIRED_PART_MISSING");
  }
  if (entries.some((entry) => entry.uncompressedSize > MAX_DOCX_ZIP_ENTRY_UNCOMPRESSED_BYTES)) {
    fail("UPLOAD_DOCX_ZIP_ENTRY_SIZE_EXCEEDED");
  }
  const totalUncompressedBytes = entries.reduce(
    (total, entry) => total + entry.uncompressedSize,
    0,
  );
  if (totalUncompressedBytes > MAX_DOCX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
    fail("UPLOAD_DOCX_ZIP_TOTAL_SIZE_EXCEEDED");
  }
  if (
    entries.some(
      (entry) =>
        entry.uncompressedSize > 0 &&
        (entry.compressedSize === 0 ||
          entry.uncompressedSize / entry.compressedSize > MAX_DOCX_ZIP_COMPRESSION_RATIO),
    )
  ) {
    fail("UPLOAD_DOCX_ZIP_COMPRESSION_RATIO_EXCEEDED");
  }
  deadline?.throwIfUnavailable("UPLOAD_DOCX_EXTRACTION_TIMEOUT");
}
