import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS,
  MAX_PDF_PAGE_COUNT,
  PDF_EXTRACTION_ADAPTER,
  PDF_EXTRACTION_ADAPTER_ID,
  ingestCaseUpload,
} from "..";

function escapePdfText(text: string): string {
  return text.replace(/([\\()])/gu, "\\$1");
}

function createPdf(pages: readonly string[]): Uint8Array {
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const objects = new Map<number, string>();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((text, index) => {
    const pageObjectId = pageObjectIds[index];
    if (pageObjectId === undefined) throw new Error("Missing generated PDF page ID");
    const contentObjectId = pageObjectId + 1;
    const content = `BT\n/F1 12 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET`;
    objects.set(
      pageObjectId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    objects.set(
      contentObjectId,
      `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let objectId = 1; objectId <= objects.size; objectId += 1) {
    const body = objects.get(objectId);
    if (body === undefined) throw new Error(`Missing generated PDF object ${objectId}`);
    offsets[objectId] = Buffer.byteLength(pdf, "ascii");
    pdf += `${objectId} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.size + 1}\n0000000000 65535 f \n`;
  for (let objectId = 1; objectId <= objects.size; objectId += 1) {
    pdf += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("production document extraction adapters", () => {
  it("exports a stable default set for every binary ingestion MIME type", () => {
    expect(DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS).toEqual([PDF_EXTRACTION_ADAPTER]);
    expect(DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS.map((adapter) => adapter.adapterId)).toEqual([
      PDF_EXTRACTION_ADAPTER_ID,
    ]);
    expect(DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS.flatMap((adapter) => adapter.supportedMimeTypes)).toEqual([
      "application/pdf",
    ]);
    expect(Object.isFrozen(DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS)).toBe(true);
  });

  it("extracts real PDF pages with page provenance through the ingestion boundary", async () => {
    const bytes = createPdf([
      "Fictional Harbor filing page one.",
      "Page two records the disputed inspection.",
    ]);
    const originalByteLength = bytes.byteLength;
    const result = await ingestCaseUpload(
      {
        uploadId: "upload:real-pdf-001",
        caseId: "case:real-pdf-001",
        originalName: "fictional-filing.pdf",
        mimeType: "application/pdf",
        bytes,
      },
      DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS,
    );

    expect(result.extractionAdapterId).toBe(PDF_EXTRACTION_ADAPTER_ID);
    expect(result.segments.map((segment) => segment.excerpt)).toEqual([
      "Fictional Harbor filing page one.",
      "Page two records the disputed inspection.",
    ]);
    expect(result.segments.map((segment) => segment.locator)).toEqual([
      { kind: "page", page: 1, label: "Page 1" },
      { kind: "page", page: 2, label: "Page 2" },
    ]);
    expect(bytes.byteLength).toBe(originalByteLength);
  });

  it("fails closed on corrupt documents and extraction over budget", async () => {
    await expect(
      PDF_EXTRACTION_ADAPTER.extract({
        bytes: new Uint8Array([1, 2, 3]),
        originalName: "broken.pdf",
        mimeType: "application/pdf",
        maximumCharacters: 100,
      }),
    ).rejects.toThrow("UPLOAD_PDF_EXTRACTION_FAILED");
    const pdf = createPdf(["Short first page.", "This second page crosses the extraction budget."]);
    await expect(
      PDF_EXTRACTION_ADAPTER.extract({
        bytes: pdf,
        originalName: "large.pdf",
        mimeType: "application/pdf",
        maximumCharacters: 30,
      }),
    ).rejects.toThrow("UPLOAD_EXTRACTION_CHARACTER_LIMIT_EXCEEDED");
  });

  it("rejects a PDF above the page cap before page text extraction", async () => {
    const bytes = createPdf(
      Array.from({ length: MAX_PDF_PAGE_COUNT + 1 }, (_, index) => `Bounded page ${index + 1}`),
    );
    await expect(
      PDF_EXTRACTION_ADAPTER.extract({
        bytes,
        originalName: "too-many-pages.pdf",
        mimeType: "application/pdf",
        maximumCharacters: 2_000_000,
      }),
    ).rejects.toThrow("UPLOAD_PDF_PAGE_LIMIT_EXCEEDED");
  });

  it("supports external cancellation and enforces bounded extraction deadlines", async () => {
    const controller = new AbortController();
    controller.abort("test cancellation");
    const pdf = createPdf(
      Array.from({ length: 100 }, (_, index) => `Deadline page ${index + 1}`),
    );
    await expect(
      PDF_EXTRACTION_ADAPTER.extract({
        bytes: pdf,
        originalName: "cancelled.pdf",
        mimeType: "application/pdf",
        maximumCharacters: 2_000_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow("UPLOAD_EXTRACTION_CANCELLED");

    await expect(
      PDF_EXTRACTION_ADAPTER.extract({
        bytes: pdf,
        originalName: "deadline.pdf",
        mimeType: "application/pdf",
        maximumCharacters: 2_000_000,
        timeoutMilliseconds: 1,
      }),
    ).rejects.toThrow("UPLOAD_PDF_EXTRACTION_TIMEOUT");
  });
});
