import { createHmac } from "node:crypto";
import { isIP } from "node:net";

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
  const secret = source.SUITS_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("SUITS_SESSION_SECRET must contain at least 32 characters");
  }
  return createHmac("sha256", secret)
    .update(`suits-case-compiler-client.v1:${clientAddress}`)
    .digest("hex");
}
