import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  HearingTrialIdSchema,
  hearingRouteError,
  parseHearingJson,
} from "./http";
import { CourtroomCommandOrchestrationError } from "./courtroom-command";
import { HearingCommandOrchestrationError } from "./witness-command";

describe("hearing HTTP boundary", () => {
  it("accepts only bounded uncompressed JSON", async () => {
    const request = new Request("https://suits.test/api/hearings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "ready" }),
    });
    await expect(
      parseHearingJson(request, z.object({ value: z.literal("ready") }).strict()),
    ).resolves.toEqual({ value: "ready" });

    await expect(
      parseHearingJson(
        new Request("https://suits.test/api/hearings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
          },
          body: "compressed",
        }),
        z.unknown(),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("recognizes only generated V3 trial IDs", () => {
    expect(
      HearingTrialIdSchema.safeParse(
        "trial_11111111111141118111111111111111",
      ).success,
    ).toBe(true);
    expect(HearingTrialIdSchema.safeParse("trial_legacy").success).toBe(false);
  });

  it("returns a user-safe malformed-request response", async () => {
    let caught: unknown;
    try {
      await parseHearingJson(
        new Request("https://suits.test/api/hearings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not-json",
        }),
        z.unknown(),
      );
    } catch (error) {
      caught = error;
    }
    const response = hearingRouteError(caught, "The hearing could not be updated.");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HEARING_REQUEST_INVALID",
        message: "The hearing request is invalid.",
      },
    });
  });

  it("returns a retryable safe witness-generation response", async () => {
    const response = hearingRouteError(
      new HearingCommandOrchestrationError(
        "HEARING_WITNESS_GENERATION_FAILED",
        "recorded",
      ),
      "The hearing could not be updated.",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HEARING_WITNESS_GENERATION_FAILED",
        message:
          "The witness could not answer right now. Retry the pending question.",
      },
    });
  });

  it.each([
    {
      code: "HEARING_MODEL_GENERATION_CANCELLED" as const,
      status: 499,
      message: "The courtroom response was cancelled. Retry the pending action.",
    },
    {
      code: "HEARING_MODEL_GENERATION_FAILED" as const,
      status: 503,
      message:
        "The courtroom participant could not respond right now. Retry the pending action.",
    },
    {
      code: "HEARING_MODEL_LOOP_EXHAUSTED" as const,
      status: 500,
      message:
        "The courtroom action could not finish safely. Reload the hearing before retrying.",
    },
  ])("maps $code to a bounded courtroom response", async ({ code, status, message }) => {
    const response = hearingRouteError(
      new CourtroomCommandOrchestrationError({
        code,
        task: code === "HEARING_MODEL_LOOP_EXHAUSTED" ? null : "opponent_plan",
        terminalTracePersistence:
          code === "HEARING_MODEL_LOOP_EXHAUSTED" ? null : "recorded",
      }),
      "The hearing could not be updated.",
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: { code, message },
    });
  });
});
