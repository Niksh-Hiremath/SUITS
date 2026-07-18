export const OPENAI_LIVE_MODEL = "gpt-5.6-luna" as const;
export const OPENAI_DEEP_MODEL = "gpt-5.6-terra" as const;

export type ServerEnv = {
  OPENAI_API_KEY: string;
  OPENAI_LIVE_MODEL: typeof OPENAI_LIVE_MODEL;
  OPENAI_DEEP_MODEL: typeof OPENAI_DEEP_MODEL;
};

type EnvironmentSource = Partial<Record<string, string | undefined>>;

function exactModel<T extends string>(
  source: EnvironmentSource,
  name: "OPENAI_LIVE_MODEL" | "OPENAI_DEEP_MODEL",
  expected: T,
): T {
  const configured = source[name]?.trim() || expected;
  if (configured !== expected) {
    throw new Error(`${name} must be ${expected}`);
  }
  return expected;
}

export function readServerEnv(source: EnvironmentSource = process.env): ServerEnv {
  const apiKey = source.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing required environment variables: OPENAI_API_KEY");

  return {
    OPENAI_API_KEY: apiKey,
    OPENAI_LIVE_MODEL: exactModel(source, "OPENAI_LIVE_MODEL", OPENAI_LIVE_MODEL),
    OPENAI_DEEP_MODEL: exactModel(source, "OPENAI_DEEP_MODEL", OPENAI_DEEP_MODEL),
  };
}
