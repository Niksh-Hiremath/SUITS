export type OpenAiPricing = {
  pricedModel?: string;
  inputUsdPerMillionTokens?: string;
  outputUsdPerMillionTokens?: string;
};

function configuredRate(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : undefined;
}

export function calculateOpenAiCostUsd(
  provider: string | undefined,
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  pricing: OpenAiPricing,
): number | undefined {
  if (provider !== "openai" || !model || model !== pricing.pricedModel) return undefined;
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const inputRate = configuredRate(pricing.inputUsdPerMillionTokens);
  const outputRate = configuredRate(pricing.outputUsdPerMillionTokens);
  if (inputRate === undefined || outputRate === undefined) return undefined;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

export function calculateElevenLabsCostUsd(
  provider: string | undefined,
  action: string,
  inputCharacters: number | undefined,
  audioDurationSeconds: number | undefined,
): number | undefined {
  if (provider !== "elevenlabs") return undefined;
  if (action === "synthesize_response" && inputCharacters !== undefined) {
    return (inputCharacters * 0.05) / 1_000;
  }
  if (action === "transcribe_push_to_talk" && audioDurationSeconds !== undefined) {
    return (audioDurationSeconds * 0.22) / 3_600;
  }
  return undefined;
}

export function totalKnownCostUsd(
  traces: Array<{ provider?: string; model?: string; action: string; estimatedCostUsd?: number; inputCharacters?: number; outputCharacters?: number; audioDurationSeconds?: number }>,
): number {
  return traces.reduce((sum, trace) => sum + (traceCostUsd(trace) ?? 0), 0);
}

export function traceCostUsd(trace: { provider?: string; model?: string; action: string; estimatedCostUsd?: number; inputCharacters?: number; outputCharacters?: number; audioDurationSeconds?: number }): number | undefined {
  if (trace.estimatedCostUsd !== undefined) return trace.estimatedCostUsd;
  const measured = calculateElevenLabsCostUsd(trace.provider, trace.action, trace.inputCharacters, trace.audioDurationSeconds);
  if (measured !== undefined) return measured;
  if (trace.model === "scribe_v2" && trace.outputCharacters !== undefined) {
    const estimatedSpeechSeconds = trace.outputCharacters / 15;
    return (estimatedSpeechSeconds * 0.22) / 3_600;
  }
  if (trace.model === "golden-case-counsel.v1" && trace.outputCharacters !== undefined) {
    return (trace.outputCharacters * 0.05) / 1_000;
  }
  return undefined;
}

export function usageLabel(trace: { inputTokens?: number; outputTokens?: number; inputCharacters?: number; outputCharacters?: number }): string {
  const tokens = (trace.inputTokens ?? 0) + (trace.outputTokens ?? 0);
  if (tokens > 0) return `${tokens} tokens`;
  return `${trace.outputCharacters ?? trace.inputCharacters ?? 0} chars`;
}

export function formatCostUsd(cost: number | undefined): string {
  if (cost === undefined) return "Unavailable";
  return `$${cost.toFixed(6)}`;
}
