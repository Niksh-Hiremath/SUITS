import { describe, expect, it } from "vitest";

import { RequestBodyLimitError, readBoundedRequestBody } from "./bounded-body";

function chunkedBody(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("bounded request bodies", () => {
  it("assembles chunked bodies without requiring Content-Length", async () => {
    const bytes = await readBoundedRequestBody({ body: chunkedBody("case", " packet") }, 20);
    expect(new TextDecoder().decode(bytes)).toBe("case packet");
  });

  it("cancels bodies as soon as the byte limit is crossed", async () => {
    await expect(readBoundedRequestBody({ body: chunkedBody("1234", "5678") }, 7)).rejects.toEqual(
      new RequestBodyLimitError("REQUEST_BODY_TOO_LARGE"),
    );
  });

  it("rejects empty bodies and invalid limits", async () => {
    await expect(readBoundedRequestBody({ body: null }, 10)).rejects.toEqual(
      new RequestBodyLimitError("REQUEST_BODY_EMPTY"),
    );
    await expect(readBoundedRequestBody({ body: chunkedBody("data") }, 0)).rejects.toBeInstanceOf(RangeError);
  });

  it("cancels a stalled body when the request is aborted", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const reason = new DOMException("request disconnected", "AbortError");
    const pending = readBoundedRequestBody({ body, signal: controller.signal }, 20);

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(cancelled).toBe(true);
  });
});
