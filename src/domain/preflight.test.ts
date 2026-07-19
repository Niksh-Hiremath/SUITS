import { describe, expect, it } from "vitest";

import {
  DurableServiceHealthRequestSchema,
  DurableServiceHealthResponseSchema,
  DurablePreflightPermitResponseSchema,
  ServerPreflightResponseSchema,
} from "./preflight";

describe("preflight contracts", () => {
  it("accepts only the strict durable-service health exchange", () => {
    expect(DurableServiceHealthRequestSchema.parse({})).toEqual({});
    expect(
      DurableServiceHealthResponseSchema.parse({
        schemaVersion: "suits.durable-service.health.v1",
        status: "ready",
      }),
    ).toEqual({
      schemaVersion: "suits.durable-service.health.v1",
      status: "ready",
    });
    expect(DurableServiceHealthRequestSchema.safeParse({ probe: true }).success).toBe(
      false,
    );
  });

  it("keeps server readiness bounded to safe statuses and the pinned models", () => {
    const parsed = ServerPreflightResponseSchema.parse({
      schemaVersion: "suits.server-preflight.v1",
      checkedAt: "2026-07-19T12:00:00.000Z",
      overallStatus: "ready",
      session: { status: "ready" },
      convex: { status: "ready", latencyMs: 12, code: null },
      openai: {
        status: "ready",
        latencyMs: 18,
        code: null,
        models: [
          {
            model: "gpt-5.6-luna",
            status: "ready",
            latencyMs: 15,
            code: null,
          },
          {
            model: "gpt-5.6-terra",
            status: "ready",
            latencyMs: 18,
            code: null,
          },
        ],
      },
    });

    expect(parsed.overallStatus).toBe("ready");
    expect(
      ServerPreflightResponseSchema.safeParse({
        ...parsed,
        openai: {
          ...parsed.openai,
          models: [
            { ...parsed.openai.models[0], model: "other-model" },
            parsed.openai.models[1],
          ],
        },
      }).success,
    ).toBe(false);

    for (const contradictory of [
      {
        ...parsed,
        convex: {
          status: "ready",
          latencyMs: 1,
          code: "RAW_DIAGNOSTIC",
        },
      },
      {
        ...parsed,
        overallStatus: "ready",
        convex: {
          status: "unavailable",
          latencyMs: 1,
          code: "CONVEX_UNAVAILABLE",
        },
      },
      {
        ...parsed,
        overallStatus: "degraded",
      },
      {
        ...parsed,
        overallStatus: "degraded",
        openai: {
          status: "unavailable",
          latencyMs: parsed.openai.latencyMs,
          code: "OPENAI_MODELS_UNAVAILABLE",
          models: parsed.openai.models,
        },
      },
    ]) {
      expect(ServerPreflightResponseSchema.safeParse(contradictory).success).toBe(
        false,
      );
    }
  });

  it("binds a durable permit decision to a safe retry delay", () => {
    expect(
      DurablePreflightPermitResponseSchema.parse({
        schemaVersion: "suits.durable-preflight-permit.v1",
        allowed: true,
        retryAfterSeconds: 0,
      }).allowed,
    ).toBe(true);
    expect(
      DurablePreflightPermitResponseSchema.safeParse({
        schemaVersion: "suits.durable-preflight-permit.v1",
        allowed: false,
        retryAfterSeconds: 0,
      }).success,
    ).toBe(false);
  });
});
