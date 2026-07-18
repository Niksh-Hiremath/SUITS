import { createHmac } from "node:crypto";

import { readCaseSessionSecret } from "./session";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OWNER_PATTERN = new RegExp(`^owner:${UUID_PATTERN.source.slice(1, -1)}$`, "u");
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function hmacHex(purpose: string, value: string, secret: string): string {
  return createHmac("sha256", secret).update(`suits:${purpose}:${value}`).digest("hex");
}

function uuidV4FromHex(value: string): string {
  const bytes = Buffer.from(value.slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function parseCaseCompileRequestId(value: FormDataEntryValue | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("CASE_COMPILE_REQUEST_ID_INVALID");
  }
  return value;
}

export function deriveCaseOwnerSessionId(
  requestId: string,
  secret = readCaseSessionSecret(),
): string {
  if (!UUID_PATTERN.test(requestId)) throw new Error("CASE_COMPILE_REQUEST_ID_INVALID");
  return uuidV4FromHex(hmacHex("owner-session", requestId, secret));
}

export function deriveCaseCompilationIds(
  ownerId: string,
  requestId: string,
  contentDigest: string,
  secret = readCaseSessionSecret(),
): Readonly<{ uploadId: string; caseId: string }> {
  if (!OWNER_PATTERN.test(ownerId) || !UUID_PATTERN.test(requestId)) {
    throw new Error("CASE_COMPILE_IDENTITY_INVALID");
  }
  if (!SHA256_PATTERN.test(contentDigest)) throw new Error("CASE_COMPILE_DIGEST_INVALID");
  const seed = `${ownerId}:${requestId}:${contentDigest}`;
  return {
    uploadId: `upload:${hmacHex("upload", seed, secret).slice(0, 48)}`,
    caseId: `case:${hmacHex("case", seed, secret).slice(0, 48)}`,
  };
}
