import {
  CourtroomModelTokenUsageSchema,
  type CourtroomModel,
  type CourtroomModelTokenUsage,
} from "@/domain/courtroom-ai";

export const COURTROOM_PRICING_VERSION =
  "openai-standard-2026-07-09.v1" as const;

type TokenRates = Readonly<{
  input: number;
  cachedInput: number;
  cacheWriteInput: number;
  output: number;
}>;

const PER_MILLION_TOKEN_RATES: Readonly<Record<CourtroomModel, TokenRates>> = {
  "gpt-5.6-luna": {
    input: 1,
    cachedInput: 0.1,
    cacheWriteInput: 1.25,
    output: 6,
  },
  "gpt-5.6-terra": {
    input: 2.5,
    cachedInput: 0.25,
    cacheWriteInput: 3.125,
    output: 15,
  },
};

/**
 * Estimates standard-processing text-token cost using the versioned public
 * OpenAI rates above. Returns null when provider counters cannot be separated
 * safely, rather than fabricating an estimate.
 */
export function estimateCourtroomModelCostUsd(
  model: CourtroomModel,
  usageInput: CourtroomModelTokenUsage,
): number | null {
  const usage = CourtroomModelTokenUsageSchema.parse(usageInput);
  const classifiedInputTokens =
    usage.cachedInputTokens + usage.cacheWriteTokens;
  if (classifiedInputTokens > usage.inputTokens) return null;

  const rates = PER_MILLION_TOKEN_RATES[model];
  const uncachedInputTokens = usage.inputTokens - classifiedInputTokens;
  const cost =
    (uncachedInputTokens * rates.input +
      usage.cachedInputTokens * rates.cachedInput +
      usage.cacheWriteTokens * rates.cacheWriteInput +
      usage.outputTokens * rates.output) /
    1_000_000;
  return Number(cost.toFixed(12));
}
