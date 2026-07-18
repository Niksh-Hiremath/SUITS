import { describe, expect, it } from "vitest";

import { resolveCaseUploadMimeType } from "./upload-boundary";

describe("case upload MIME boundary", () => {
  it("accepts supported text types and infers missing browser MIME metadata", () => {
    const bytes = new TextEncoder().encode("A fictional packet");
    expect(resolveCaseUploadMimeType("packet.txt", "", bytes)).toBe("text/plain");
    expect(resolveCaseUploadMimeType("packet.md", "text/x-markdown", bytes)).toBe("text/x-markdown");
    expect(resolveCaseUploadMimeType("packet.json", "application/octet-stream", bytes)).toBe("application/json");
  });

  it("requires MIME, extension, and binary signatures to agree", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(resolveCaseUploadMimeType("packet.pdf", "application/pdf", pdf)).toBe("application/pdf");
    expect(resolveCaseUploadMimeType("packet.docx", "application/octet-stream", docx)).toContain(
      "wordprocessingml",
    );
    expect(() => resolveCaseUploadMimeType("packet.pdf", "application/pdf", docx)).toThrow(
      "UPLOAD_PDF_SIGNATURE_INVALID",
    );
    expect(() => resolveCaseUploadMimeType("packet.txt", "application/pdf", pdf)).toThrow(
      "UPLOAD_MIME_EXTENSION_MISMATCH",
    );
  });

  it("rejects empty and unsupported uploads before extraction", () => {
    expect(() => resolveCaseUploadMimeType("packet.txt", "text/plain", new Uint8Array())).toThrow(
      "UPLOAD_CONTENT_EMPTY",
    );
    expect(() =>
      resolveCaseUploadMimeType("packet.exe", "application/octet-stream", new Uint8Array([1])),
    ).toThrow("UPLOAD_FILE_EXTENSION_UNSUPPORTED");
  });
});

