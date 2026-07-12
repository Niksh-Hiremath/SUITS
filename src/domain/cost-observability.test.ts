import { describe, expect, it } from "vitest";

import { calculateOpenAiCostUsd, formatCostUsd, totalKnownCostUsd } from "./cost-observability";

describe("OpenAI cost observability", () => {
  const pricing = {
    pricedModel: "verified-model",
    inputUsdPerMillionTokens: "2.50",
    outputUsdPerMillionTokens: "10",
  };

  it("calculates a model step from configured per-million-token pricing", () => {
    expect(calculateOpenAiCostUsd("openai", "verified-model", 1_000, 500, pricing)).toBe(0.0075);
  });

  it("does not fabricate zero cost when pricing is unknown or invalid", () => {
    expect(calculateOpenAiCostUsd("openai", "another-model", 1_000, 500, pricing)).toBeUndefined();
    expect(calculateOpenAiCostUsd("openai", "verified-model", 1_000, 500, { ...pricing, inputUsdPerMillionTokens: "" })).toBeUndefined();
    expect(formatCostUsd(undefined)).toBe("Unavailable");
  });

  it("totals costs only when every priced provider step has a persisted cost", () => {
    expect(totalKnownCostUsd([
      { provider: "code" },
      { provider: "openai", estimatedCostUsd: 0.002 },
      { provider: "openai", estimatedCostUsd: 0.003 },
    ])).toBe(0.005);
    expect(totalKnownCostUsd([{ provider: "openai" }])).toBeUndefined();
  });

  it("formats small known costs without rounding them to zero", () => {
    expect(formatCostUsd(0.0000123)).toBe("$0.000012");
  });
});
