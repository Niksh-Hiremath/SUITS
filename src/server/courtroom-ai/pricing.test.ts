import { describe, expect, it } from "vitest";

import {
  COURTROOM_PRICING_VERSION,
  estimateCourtroomModelCostUsd,
} from "./pricing";

describe("courtroom model price estimates", () => {
  it("prices Luna uncached, cached-read, cache-write, and output tokens", () => {
    expect(COURTROOM_PRICING_VERSION).toBe(
      "openai-standard-2026-07-09.v1",
    );
    expect(
      estimateCourtroomModelCostUsd("gpt-5.6-luna", {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
        cachedInputTokens: 200_000,
        cacheWriteTokens: 300_000,
        reasoningTokens: 20_000,
      }),
    ).toBe(1.495);
  });

  it("uses Terra rates for final coaching", () => {
    expect(
      estimateCourtroomModelCostUsd("gpt-5.6-terra", {
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 100,
      }),
    ).toBe(0.01);
  });

  it("declines an estimate when provider input categories overlap", () => {
    expect(
      estimateCourtroomModelCostUsd("gpt-5.6-luna", {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        cachedInputTokens: 80,
        cacheWriteTokens: 30,
        reasoningTokens: 1,
      }),
    ).toBeNull();
  });
});
