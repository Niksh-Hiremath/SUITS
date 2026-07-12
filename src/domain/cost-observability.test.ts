import { describe, expect, it } from "vitest";

import { calculateElevenLabsCostUsd, calculateOpenAiCostUsd, formatCostUsd, totalKnownCostUsd, usageLabel } from "./cost-observability";

describe("OpenAI cost observability", () => {
  const pricing = {
    pricedModel: "verified-model",
    inputUsdPerMillionTokens: "2.50",
    outputUsdPerMillionTokens: "10",
  };

  it("calculates a model step from configured per-million-token pricing", () => {
    expect(calculateOpenAiCostUsd("openai", "verified-model", 1_000, 500, pricing)).toBe(0.0075);
  });

  it("prices ElevenLabs TTS at $0.05 per 1,000 characters", () => {
    expect(calculateElevenLabsCostUsd("elevenlabs", "synthesize_response", 1_000, undefined)).toBe(0.05);
  });

  it("prices Scribe v2 transcription at $0.22 per audio hour", () => {
    expect(calculateElevenLabsCostUsd("elevenlabs", "transcribe_push_to_talk", undefined, 1_800)).toBe(0.11);
  });

  it("does not fabricate zero cost when pricing is unknown or invalid", () => {
    expect(calculateOpenAiCostUsd("openai", "another-model", 1_000, 500, pricing)).toBeUndefined();
    expect(calculateOpenAiCostUsd("openai", "verified-model", 1_000, 500, { ...pricing, inputUsdPerMillionTokens: "" })).toBeUndefined();
    expect(formatCostUsd(undefined)).toBe("Unavailable");
  });

  it("totals costs only when every priced provider step has a persisted cost", () => {
    expect(totalKnownCostUsd([
      { provider: "code", action: "route" },
      { provider: "openai", action: "review", estimatedCostUsd: 0.002 },
      { provider: "openai", action: "review", estimatedCostUsd: 0.003 },
    ])).toBe(0.005);
    expect(totalKnownCostUsd([{ provider: "openai", action: "review" }])).toBe(0);
  });

  it("formats small known costs without rounding them to zero", () => {
    expect(formatCostUsd(0.0000123)).toBe("$0.000012");
  });

  it("uses characters when a step has no tokens", () => {
    expect(usageLabel({ outputCharacters: 83 })).toBe("83 chars");
    expect(usageLabel({ inputTokens: 10, outputTokens: 5 })).toBe("15 tokens");
  });
});
