import {
  COURTROOM_FINAL_DEBRIEF_MODEL,
  COURTROOM_INTERACTIVE_MODEL,
} from "@/domain/courtroom-ai";
import {
  DurablePreflightPermitResponseSchema,
  DURABLE_SERVICE_HEALTH_SCHEMA_VERSION,
  DurableServiceHealthResponseSchema,
  SERVER_PREFLIGHT_SCHEMA_VERSION,
  ServerPreflightResponseSchema,
  type DurablePreflightPermitResponse,
  type ServerPreflightResponse,
} from "@/domain/preflight";
import { callConvexCaseService } from "@/server/case-api";

export const PREFLIGHT_TIMEOUT_MS = 10_000;

type CheckResult = Readonly<{
  status: "ready" | "unavailable";
  latencyMs: number;
  code: string | null;
}>;

export type ServerPreflightDependencies = Readonly<{
  checkConvex: (signal: AbortSignal) => Promise<void>;
  checkOpenAIModel: (model: string, signal: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  now?: () => number;
  checkedAt?: () => string;
}>;

function boundedLatency(startedAt: number, completedAt: number): number {
  return Math.min(120_000, Math.max(0, Math.round(completedAt - startedAt)));
}

async function runCheck(
  check: (signal: AbortSignal) => Promise<void>,
  safeFailureCode: string,
  now: () => number,
  parentSignal?: AbortSignal,
): Promise<CheckResult> {
  const startedAt = now();
  const controller = new AbortController();
  let rejectTimeout: ((reason: Error) => void) | null = null;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = setTimeout(() => {
    controller.abort();
    rejectTimeout?.(new Error("PREFLIGHT_TIMEOUT"));
  }, PREFLIGHT_TIMEOUT_MS);
  const signal = parentSignal
    ? AbortSignal.any([controller.signal, parentSignal])
    : controller.signal;
  try {
    await Promise.race([check(signal), timeoutFailure]);
    return {
      status: "ready",
      latencyMs: boundedLatency(startedAt, now()),
      code: null,
    };
  } catch {
    return {
      status: "unavailable",
      latencyMs: boundedLatency(startedAt, now()),
      code: safeFailureCode,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runServerPreflight(
  dependencies: ServerPreflightDependencies,
): Promise<ServerPreflightResponse> {
  const now = dependencies.now ?? performance.now.bind(performance);
  const checkedAt = dependencies.checkedAt ?? (() => new Date().toISOString());
  const [convex, luna, terra] = await Promise.all([
    runCheck(
      dependencies.checkConvex,
      "CONVEX_UNAVAILABLE",
      now,
      dependencies.signal,
    ),
    runCheck(
      (signal) =>
        dependencies.checkOpenAIModel(COURTROOM_INTERACTIVE_MODEL, signal),
      "OPENAI_LUNA_UNAVAILABLE",
      now,
      dependencies.signal,
    ),
    runCheck(
      (signal) =>
        dependencies.checkOpenAIModel(COURTROOM_FINAL_DEBRIEF_MODEL, signal),
      "OPENAI_TERRA_UNAVAILABLE",
      now,
      dependencies.signal,
    ),
  ]);
  const openAIReady = luna.status === "ready" && terra.status === "ready";

  return ServerPreflightResponseSchema.parse({
    schemaVersion: SERVER_PREFLIGHT_SCHEMA_VERSION,
    checkedAt: checkedAt(),
    overallStatus:
      convex.status === "ready" && openAIReady ? "ready" : "degraded",
    session: { status: "ready" },
    convex,
    openai: {
      status: openAIReady ? "ready" : "unavailable",
      latencyMs: Math.max(luna.latencyMs, terra.latencyMs),
      code: openAIReady ? null : "OPENAI_MODELS_UNAVAILABLE",
      models: [
        { model: COURTROOM_INTERACTIVE_MODEL, ...luna },
        { model: COURTROOM_FINAL_DEBRIEF_MODEL, ...terra },
      ],
    },
  });
}

export async function checkDurableService(signal: AbortSignal): Promise<void> {
  await callConvexCaseService({
    path: "/service/health",
    body: {},
    responseSchema: DurableServiceHealthResponseSchema,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
    signal,
  });
}

export async function acquireDurablePreflightPermit(): Promise<
  DurablePreflightPermitResponse
> {
  return callConvexCaseService({
    path: "/service/preflight-permit/acquire",
    body: {},
    responseSchema: DurablePreflightPermitResponseSchema,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });
}

export const DURABLE_SERVICE_READY_RESPONSE = Object.freeze({
  schemaVersion: DURABLE_SERVICE_HEALTH_SCHEMA_VERSION,
  status: "ready" as const,
});
