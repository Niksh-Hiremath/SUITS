import { describe, expect, it, vi } from "vitest";

import { ServerPreflightResponseSchema } from "@/domain/preflight";

import { ServerPreflightCache } from "./cache";

const RESPONSE = ServerPreflightResponseSchema.parse({
  schemaVersion: "suits.server-preflight.v1",
  checkedAt: "2026-07-19T12:00:00.000Z",
  overallStatus: "ready",
  session: { status: "ready" },
  convex: { status: "ready", latencyMs: 1, code: null },
  openai: {
    status: "ready",
    latencyMs: 2,
    code: null,
    models: [
      {
        model: "gpt-5.6-luna",
        status: "ready",
        latencyMs: 2,
        code: null,
      },
      {
        model: "gpt-5.6-terra",
        status: "ready",
        latencyMs: 2,
        code: null,
      },
    ],
  },
});

describe("server preflight cache", () => {
  it("single-flights concurrent callers and shares one bounded snapshot", async () => {
    let resolveProbe!: (response: typeof RESPONSE) => void;
    const probe = vi.fn(
      () =>
        new Promise<typeof RESPONSE>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const cache = new ServerPreflightCache({ ttlMs: 100, now: () => 10 });

    const first = cache.get(probe);
    const second = cache.get(probe);
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe(RESPONSE);

    await expect(first).resolves.toBe(RESPONSE);
    await expect(second).resolves.toBe(RESPONSE);
    await expect(cache.get(probe)).resolves.toBe(RESPONSE);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("refreshes after expiry and never caches a rejected probe", async () => {
    let now = 0;
    const cache = new ServerPreflightCache({ ttlMs: 10, now: () => now });
    const failure = vi.fn(async () => {
      throw new Error("probe failed");
    });
    await expect(cache.get(failure)).rejects.toThrow("probe failed");
    await expect(cache.get(async () => RESPONSE)).resolves.toBe(RESPONSE);

    now = 11;
    const refreshed = { ...RESPONSE, checkedAt: "2026-07-19T12:01:00.000Z" };
    await expect(cache.get(async () => refreshed)).resolves.toBe(refreshed);
  });

  it("rechecks degraded snapshots after a short cooldown", async () => {
    let now = 0;
    const cache = new ServerPreflightCache({
      ttlMs: 100,
      degradedTtlMs: 5,
      now: () => now,
    });
    const degraded = ServerPreflightResponseSchema.parse({
      ...RESPONSE,
      overallStatus: "degraded",
      convex: {
        status: "unavailable",
        latencyMs: 1,
        code: "CONVEX_UNAVAILABLE",
      },
    });
    const probe = vi
      .fn<() => Promise<typeof RESPONSE>>()
      .mockResolvedValueOnce(degraded)
      .mockResolvedValue(RESPONSE);

    await expect(cache.get(probe)).resolves.toBe(degraded);
    now = 4;
    await expect(cache.get(probe)).resolves.toBe(degraded);
    now = 5;
    await expect(cache.get(probe)).resolves.toBe(RESPONSE);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
