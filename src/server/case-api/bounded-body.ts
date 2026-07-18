export class RequestBodyLimitError extends Error {
  constructor(readonly code: "REQUEST_BODY_EMPTY" | "REQUEST_BODY_TOO_LARGE") {
    super(code);
    this.name = "RequestBodyLimitError";
  }
}

type BodySource = Readonly<{
  body: ReadableStream<Uint8Array> | null;
}>;

export async function readBoundedRequestBody(
  request: BodySource,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer");
  }
  if (request.body === null) throw new RequestBodyLimitError("REQUEST_BODY_EMPTY");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
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
