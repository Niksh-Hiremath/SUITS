import { z } from "zod";

import { readCaseServiceSecret } from "./session";

const DEFAULT_TIMEOUT_MS = 30_000;

type EnvironmentSource = Partial<Record<string, string | undefined>>;
type FetchImplementation = typeof fetch;

export class ConvexCaseServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, options?: ErrorOptions) {
    super("The durable case service rejected the request", options);
    this.name = "ConvexCaseServiceError";
    this.code = code;
    this.status = status;
  }
}

export type ConvexCaseServiceConfig = Readonly<{
  siteUrl: string;
  serviceSecret: string;
}>;

export function readConvexCaseServiceConfig(
  source: EnvironmentSource = process.env,
): ConvexCaseServiceConfig {
  const rawSiteUrl = source.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (!rawSiteUrl) throw new Error("NEXT_PUBLIC_CONVEX_SITE_URL is not configured");
  const siteUrl = new URL(rawSiteUrl);
  if (siteUrl.protocol !== "https:" && siteUrl.hostname !== "localhost" && siteUrl.hostname !== "127.0.0.1") {
    throw new Error("NEXT_PUBLIC_CONVEX_SITE_URL must use HTTPS outside localhost");
  }
  return {
    siteUrl: siteUrl.toString().replace(/\/$/u, ""),
    serviceSecret: readCaseServiceSecret(source),
  };
}

async function readFailureCode(response: Response): Promise<string> {
  try {
    const parsed = z.object({ error: z.string().trim().min(1).max(120) }).safeParse(await response.json());
    return parsed.success ? parsed.data.error : "CASE_SERVICE_REQUEST_FAILED";
  } catch {
    return "CASE_SERVICE_REQUEST_FAILED";
  }
}

export async function callConvexCaseService<T>(options: Readonly<{
  path: `/${string}`;
  body?: unknown;
  responseSchema: z.ZodType<T>;
  config?: ConvexCaseServiceConfig;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
  signal?: AbortSignal;
}>): Promise<T> {
  const config = options.config ?? readConvexCaseServiceConfig();
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error("Case service timeout must be between 1 and 120000 milliseconds");
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetchImplementation(`${config.siteUrl}${options.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceSecret}`,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new ConvexCaseServiceError("CASE_SERVICE_UNAVAILABLE", 503, { cause: error });
  }

  if (!response.ok) {
    throw new ConvexCaseServiceError(await readFailureCode(response), response.status);
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    throw new ConvexCaseServiceError("CASE_SERVICE_RESPONSE_INVALID", 502, { cause: error });
  }
  const parsed = options.responseSchema.safeParse(value);
  if (!parsed.success) throw new ConvexCaseServiceError("CASE_SERVICE_RESPONSE_INVALID", 502);
  return parsed.data;
}

