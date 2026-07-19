import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import {
  ServerPreflightRequestSchema,
  ServerPreflightResponseSchema,
  type ServerPreflightResponse,
} from "@/domain/preflight";
import {
  CASE_OWNER_COOKIE_MAX_AGE_SECONDS,
  CASE_OWNER_COOKIE_NAME,
  isTrustedRequestOrigin,
  readBoundedRequestBody,
  resolveCaseOwnerSession,
} from "@/server/case-api";
import {
  acquireDurablePreflightPermit,
  checkDurableService,
  runServerPreflight,
  serverPreflightCache,
} from "@/server/preflight";

export const runtime = "nodejs";

const MAX_PREFLIGHT_REQUEST_BYTES = 1_024;

class PreflightRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("PREFLIGHT_RATE_LIMITED");
    this.name = "PreflightRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Readonly<Record<string, string>> = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

async function parseRequest(request: Request): Promise<void> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("PREFLIGHT_JSON_REQUIRED");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new Error("PREFLIGHT_CONTENT_ENCODING_REJECTED");
  }
  const bytes = await readBoundedRequestBody(
    request,
    MAX_PREFLIGHT_REQUEST_BYTES,
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = ServerPreflightRequestSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("PREFLIGHT_REQUEST_INVALID");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isTrustedRequestOrigin(request)) {
    return errorResponse(
      403,
      "ORIGIN_REJECTED",
      "Cross-origin preflight requests are not allowed.",
    );
  }

  try {
    await parseRequest(request);
  } catch {
    return errorResponse(
      400,
      "PREFLIGHT_REQUEST_INVALID",
      "The preflight request is invalid.",
    );
  }

  let ownerSession;
  try {
    ownerSession = resolveCaseOwnerSession(
      request.cookies.get(CASE_OWNER_COOKIE_NAME)?.value,
    );
  } catch {
    return errorResponse(
      503,
      "PREFLIGHT_SESSION_UNAVAILABLE",
      "A secure preflight session could not be established.",
    );
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const client = apiKey ? new OpenAI({ apiKey }) : null;
  let result: ServerPreflightResponse;
  try {
    result = await serverPreflightCache.get(async () => {
      const permitAttempt = client
        ? acquireDurablePreflightPermit().then(
            (permit) => ({ status: "ready" as const, permit }),
            () => ({ status: "unavailable" as const }),
          )
        : Promise.resolve({ status: "not_required" as const });
      const preflight = await runServerPreflight({
        checkConvex: checkDurableService,
        checkOpenAIModel: async (model, signal) => {
          if (client === null) throw new Error("OPENAI_NOT_CONFIGURED");
          const permit = await permitAttempt;
          if (permit.status !== "ready" || !permit.permit.allowed) {
            throw new Error("OPENAI_PREFLIGHT_PERMIT_UNAVAILABLE");
          }
          await client.responses.create(
            {
              model,
              store: false,
              max_output_tokens: 32,
              reasoning: { effort: "low" },
              metadata: {
                component: "suits-preflight",
                purpose: "responses-access-check",
              },
              input: [
                {
                  role: "developer",
                  content: [
                    {
                      type: "input_text",
                      text: "SUITS readiness probe. Reply only with the word ready.",
                    },
                  ],
                },
              ],
            },
            { signal },
          );
        },
      });
      const permit = await permitAttempt;
      if (permit.status === "ready" && !permit.permit.allowed) {
        throw new PreflightRateLimitError(permit.permit.retryAfterSeconds);
      }
      return preflight;
    });
  } catch (error) {
    if (error instanceof PreflightRateLimitError) {
      return errorResponse(
        429,
        "PREFLIGHT_RATE_LIMITED",
        "The live model checks were run recently. Please retry later.",
        { "Retry-After": String(error.retryAfterSeconds) },
      );
    }
    return errorResponse(
      503,
      "PREFLIGHT_CHECK_UNAVAILABLE",
      "The server checks could not be completed safely.",
    );
  }
  const response = NextResponse.json(ServerPreflightResponseSchema.parse(result), {
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(CASE_OWNER_COOKIE_NAME, ownerSession.cookieValue, {
    httpOnly: true,
    maxAge: CASE_OWNER_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
