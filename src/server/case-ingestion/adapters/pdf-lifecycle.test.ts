import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unpdfMocks = vi.hoisted(() => ({
  getResolvedPDFJS: vi.fn(),
}));

vi.mock("unpdf", () => ({
  getResolvedPDFJS: unpdfMocks.getResolvedPDFJS,
}));

import { PDF_EXTRACTION_ADAPTER } from "./pdf";

function pendingPromise<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

describe("PDF extraction lifecycle", () => {
  beforeEach(() => {
    unpdfMocks.getResolvedPDFJS.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels an in-flight PDF.js load and preserves the cancellation result", async () => {
    const destroy = vi.fn(() => Promise.resolve());
    unpdfMocks.getResolvedPDFJS.mockResolvedValue({
      getDocument: () => ({ promise: pendingPromise(), destroy }),
    });
    const controller = new AbortController();
    const extraction = PDF_EXTRACTION_ADAPTER.extract({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      originalName: "cancelled-in-flight.pdf",
      mimeType: "application/pdf",
      maximumCharacters: 1_000,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(unpdfMocks.getResolvedPDFJS).toHaveBeenCalledOnce());
    controller.abort("test cancellation");

    await expect(extraction).rejects.toThrow("UPLOAD_EXTRACTION_CANCELLED");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("bounds stalled cancellation cleanup and preserves the primary timeout", async () => {
    vi.useFakeTimers();
    const destroy = vi.fn(() => pendingPromise<void>());
    unpdfMocks.getResolvedPDFJS.mockResolvedValue({
      getDocument: () => ({ promise: pendingPromise(), destroy }),
    });
    const extraction = PDF_EXTRACTION_ADAPTER.extract({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      originalName: "cleanup-stall.pdf",
      mimeType: "application/pdf",
      maximumCharacters: 1_000,
      timeoutMilliseconds: 5,
    });
    const rejection = expect(extraction).rejects.toThrow("UPLOAD_PDF_EXTRACTION_TIMEOUT");

    await vi.runAllTimersAsync();

    await rejection;
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("fails within the cleanup bound when PDF.js stalls after successful extraction", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const destroy = vi.fn(() => pendingPromise<void>());
    unpdfMocks.getResolvedPDFJS.mockResolvedValue({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () =>
            Promise.resolve({
              getTextContent: () =>
                Promise.resolve({ items: [{ str: "Bounded cleanup.", hasEOL: false }] }),
              cleanup,
            }),
          destroy,
        }),
        destroy,
      }),
    });
    const extraction = PDF_EXTRACTION_ADAPTER.extract({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      originalName: "post-extraction-cleanup-stall.pdf",
      mimeType: "application/pdf",
      maximumCharacters: 1_000,
    });
    const rejection = expect(extraction).rejects.toThrow("UPLOAD_PDF_CLEANUP_FAILED");

    await vi.runAllTimersAsync();

    await rejection;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
