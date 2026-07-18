import { createHash } from "node:crypto";
import { isIP } from "node:net";

const WINDOW_MS = 10 * 60 * 1_000;
const MAX_ATTEMPTS_PER_WINDOW = 5;
const MAX_TRACKED_CLIENTS = 10_000;

type Bucket = { attempts: number[]; lastSeenAt: number };

export type CaseCompileRateLimitResult = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}>;

export class CaseCompileRateLimiter {
  readonly #buckets = new Map<string, Bucket>();

  check(clientKey: string, now = Date.now()): CaseCompileRateLimitResult {
    if (!Number.isFinite(now) || now < 0) throw new Error("Rate-limit time must be nonnegative");
    const cutoff = now - WINDOW_MS;
    const prior = this.#buckets.get(clientKey);
    const attempts = prior?.attempts.filter((attemptedAt) => attemptedAt > cutoff) ?? [];
    if (attempts.length >= MAX_ATTEMPTS_PER_WINDOW) {
      const oldest = attempts[0] ?? now;
      this.#buckets.set(clientKey, { attempts, lastSeenAt: now });
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1_000)),
      };
    }

    attempts.push(now);
    this.#buckets.set(clientKey, { attempts, lastSeenAt: now });
    if (this.#buckets.size > MAX_TRACKED_CLIENTS) {
      const stale = [...this.#buckets.entries()]
        .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
        .slice(0, this.#buckets.size - MAX_TRACKED_CLIENTS);
      stale.forEach(([key]) => this.#buckets.delete(key));
    }
    return {
      allowed: true,
      remaining: MAX_ATTEMPTS_PER_WINDOW - attempts.length,
      retryAfterSeconds: 0,
    };
  }
}

type EnvironmentSource = Partial<Record<string, string | undefined>>;

function trustedClientAddress(headers: Headers, source: EnvironmentSource): string {
  const proxy = source.SUITS_TRUSTED_PROXY?.trim().toLowerCase() ||
    (source.VERCEL === "1" ? "vercel" : "none");
  const candidate = proxy === "vercel"
    ? headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]
    : proxy === "cloudflare"
      ? headers.get("cf-connecting-ip")
      : proxy === "x-real-ip"
        ? headers.get("x-real-ip")
        : proxy === "x-forwarded-for"
          ? headers.get("x-forwarded-for")?.split(",", 1)[0]
          : null;
  const address = candidate?.trim() ?? "";
  return isIP(address) === 0 ? "direct-client" : address.toLowerCase();
}

export function caseCompilationClientKey(
  headers: Headers,
  source: EnvironmentSource = process.env,
): string {
  const clientAddress = trustedClientAddress(headers, source);
  return createHash("sha256")
    .update(`suits-case-compiler-client:${clientAddress}`)
    .digest("hex");
}

export const caseCompileRateLimiter = new CaseCompileRateLimiter();
