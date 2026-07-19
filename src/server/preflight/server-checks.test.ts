import { afterEach, describe, expect, it, vi } from "vitest";

import { PREFLIGHT_TIMEOUT_MS, runServerPreflight } from "./server-checks";

afterEach(() => {
  vi.useRealTimers();
});

describe("server preflight", () => {
  it("checks only the pinned Luna and Terra models and reports readiness", async () => {
    const models: string[] = [];
    const response = await runServerPreflight({
      checkConvex: vi.fn(async () => undefined),
      checkOpenAIModel: vi.fn(async (model) => {
        models.push(model);
      }),
      now: (() => {
        let value = 10;
        return () => value++;
      })(),
      checkedAt: () => "2026-07-19T12:00:00.000Z",
    });

    expect(models).toEqual(["gpt-5.6-luna", "gpt-5.6-terra"]);
    expect(response).toMatchObject({
      overallStatus: "ready",
      session: { status: "ready" },
      convex: { status: "ready", code: null },
      openai: { status: "ready", code: null },
    });
  });

  it("returns only safe component codes when external checks fail", async () => {
    const response = await runServerPreflight({
      checkConvex: async () => {
        throw new Error("RAW_CONVEX_SECRET_DETAIL");
      },
      checkOpenAIModel: async (model) => {
        if (model === "gpt-5.6-terra") {
          throw new Error("RAW_OPENAI_KEY_DETAIL");
        }
      },
      now: () => 25,
      checkedAt: () => "2026-07-19T12:00:00.000Z",
    });

    expect(response.overallStatus).toBe("degraded");
    expect(response.convex.code).toBe("CONVEX_UNAVAILABLE");
    expect(response.openai.models[0].status).toBe("ready");
    expect(response.openai.models[1].code).toBe("OPENAI_TERRA_UNAVAILABLE");
    expect(JSON.stringify(response)).not.toMatch(/RAW_|secret|key_detail/iu);
  });

  it("bounds dependencies that ignore cancellation", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<void>(() => undefined);
    const pending = runServerPreflight({
      checkConvex: never,
      checkOpenAIModel: never,
      now: () => 50,
      checkedAt: () => "2026-07-19T12:00:00.000Z",
    });

    await vi.advanceTimersByTimeAsync(PREFLIGHT_TIMEOUT_MS);
    const response = await pending;

    expect(response.overallStatus).toBe("degraded");
    expect(response.convex.code).toBe("CONVEX_UNAVAILABLE");
    expect(response.openai.models.map(({ status }) => status)).toEqual([
      "unavailable",
      "unavailable",
    ]);
  });
});
