import { PDF_EXTRACTION_ADAPTER } from "../../src/server/case-ingestion/adapters/pdf";

const EXPECTED_PAGE_TEXT = [
  "Fictional Harbor filing page one.",
  "Page two records the disputed inspection.",
] as const;

function escapePdfText(text: string): string {
  return text.replace(/([\\()])/gu, "\\$1");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
      `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let objectId = 1; objectId <= objects.size; objectId += 1) {
    const body = objects.get(objectId);
    if (body === undefined) throw new Error(`Missing generated PDF object ${objectId}`);
    offsets[objectId] = byteLength(pdf);
    pdf += `${objectId} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.size + 1}\n0000000000 65535 f \n`;
  for (let objectId = 1; objectId <= objects.size; objectId += 1) {
    pdf += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export default {
  async fetch(request: Request, environment: Record<string, unknown>): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    const document = await PDF_EXTRACTION_ADAPTER.extract({
      bytes: createPdf(EXPECTED_PAGE_TEXT),
      originalName: "workerd-smoke.pdf",
      mimeType: "application/pdf",
      maximumCharacters: 10_000,
      timeoutMilliseconds: 10_000,
    });

    return Response.json({
      adapterId: document.adapterId,
      mimeType: document.mimeType,
      blocks: document.blocks,
      bindingNames: Object.keys(environment).sort(),
    });
  },
} satisfies {
  fetch(request: Request, environment: Record<string, unknown>): Promise<Response>;
};
