import type { NextRequest } from "next/server";

type EnvironmentSource = Partial<Record<string, string | undefined>>;

function normalizedHttpOrigin(value: string): string | null {
  try {
    const candidate = new URL(value);
    if (
      (candidate.protocol !== "http:" && candidate.protocol !== "https:") ||
      candidate.username !== "" ||
      candidate.password !== "" ||
      candidate.pathname !== "/" ||
      candidate.search !== "" ||
      candidate.hash !== ""
    ) {
      return null;
    }
    return candidate.origin;
  } catch {
    return null;
  }
}

function requestOrigin(request: NextRequest): string | null {
  const host = request.headers.get("host")?.trim();
  if (!host) return normalizedHttpOrigin(request.nextUrl.origin);
  if (/[\s,/@\\?#]/u.test(host)) return null;

  const protocol = request.nextUrl.protocol;
  if (protocol !== "http:" && protocol !== "https:") return null;
  return normalizedHttpOrigin(`${protocol}//${host}`);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function configuredPublicOrigin(value: string): string | null {
  const origin = normalizedHttpOrigin(value);
  if (!origin) return null;
  return isLoopbackOrigin(origin) || new URL(origin).protocol === "https:" ? origin : null;
}

/**
 * Accept browser requests only from the externally visible application origin.
 * NextRequest.nextUrl can retain an internal proxy hostname, so the request Host
 * header is used only for loopback development. Non-loopback deployments must
 * configure SUITS_PUBLIC_ORIGIN, which prevents Host-header/DNS-rebinding bypass.
 */
export function isTrustedRequestOrigin(
  request: NextRequest,
  source: EnvironmentSource = process.env,
): boolean {
  const supplied = request.headers.get("origin");
  if (supplied === null) return true;

  const suppliedOrigin = normalizedHttpOrigin(supplied.trim());
  if (!suppliedOrigin) return false;

  const configured = source.SUITS_PUBLIC_ORIGIN?.trim();
  const expectedOrigin = configured ? configuredPublicOrigin(configured) : requestOrigin(request);
  if (!configured && (expectedOrigin === null || !isLoopbackOrigin(expectedOrigin))) return false;
  return expectedOrigin !== null && suppliedOrigin === expectedOrigin;
}
