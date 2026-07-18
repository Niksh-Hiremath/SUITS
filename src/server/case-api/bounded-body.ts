export class RequestBodyLimitError extends Error {
  constructor(readonly code: "REQUEST_BODY_EMPTY" | "REQUEST_BODY_TOO_LARGE") {
    super(code);
    this.name = "RequestBodyLimitError";
  }
}

type BodySource = Readonly<{
  body: ReadableStream<Uint8Array> | null;
  signal?: AbortSignal;
}>;

export async function readBoundedRequestBody(
  request: BodySource,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer");
  }
  if (request.body === null) throw new RequestBodyLimitError("REQUEST_BODY_EMPTY");

  const reader = request.body.getReader();
  const cancelForAbort = () => {
    void reader.cancel(request.signal?.reason ?? "request aborted");
  };
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let totalBytes = 0;
  try {
    request.signal?.throwIfAborted();
    request.signal?.addEventListener("abort", cancelForAbort, { once: true });
    while (true) {
      const result = await reader.read();
      request.signal?.throwIfAborted();
      if (result.done) break;
      if (result.value.byteLength === 0) continue;
      totalBytes += result.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("request body limit exceeded");
        throw new RequestBodyLimitError("REQUEST_BODY_TOO_LARGE");
      }
      chunks.push(Uint8Array.from(result.value));
    }
  } finally {
    request.signal?.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }

  if (totalBytes === 0) throw new RequestBodyLimitError("REQUEST_BODY_EMPTY");
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
