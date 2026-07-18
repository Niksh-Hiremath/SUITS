import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const CASE_OWNER_COOKIE_NAME = "suits_owner_session" as const;
export const CASE_OWNER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SESSION_VERSION = "v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type EnvironmentSource = Partial<Record<string, string | undefined>>;

export type CaseOwnerSession = Readonly<{
  ownerId: string;
  cookieValue: string;
  isNew: boolean;
}>;

export function readCaseServiceSecret(source: EnvironmentSource = process.env): string {
  const secret = source.SUITS_CONVEX_SERVICE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("SUITS_CONVEX_SERVICE_SECRET must contain at least 32 characters");
  }
  return secret;
}

function signatureFor(sessionId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`suits-owner-session:${SESSION_VERSION}:${sessionId}`)
    .digest("base64url");
}

function signaturesMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function parseCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const [version, sessionId, signature, ...remainder] = value.split(".");
  if (
    version !== SESSION_VERSION ||
    !sessionId ||
    !UUID_PATTERN.test(sessionId) ||
    !signature ||
    remainder.length > 0
  ) {
    return null;
  }
  return signaturesMatch(signature, signatureFor(sessionId, secret)) ? sessionId : null;
}

export function resolveCaseOwnerSession(
  cookieValue: string | undefined,
  options: Readonly<{
    secret?: string;
    createSessionId?: () => string;
  }> = {},
): CaseOwnerSession {
  const secret = options.secret ?? readCaseServiceSecret();
  const existingSessionId = parseCookie(cookieValue, secret);
  const sessionId = existingSessionId ?? (options.createSessionId ?? randomUUID)();
  if (!UUID_PATTERN.test(sessionId)) throw new Error("Case owner session IDs must be UUIDv4 values");
  return {
    ownerId: `owner:${sessionId}`,
    cookieValue: `${SESSION_VERSION}.${sessionId}.${signatureFor(sessionId, secret)}`,
    isNew: existingSessionId === null,
  };
}

