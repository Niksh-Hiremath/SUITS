const REQUIRED_SERVER_VARIABLES = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_TTS_MODEL",
  "ELEVENLABS_STT_MODEL",
] as const;

type RequiredServerVariable = (typeof REQUIRED_SERVER_VARIABLES)[number];

export type ServerEnv = Record<RequiredServerVariable, string>;

type EnvironmentSource = Partial<Record<string, string | undefined>>;

export function readServerEnv(
  source: EnvironmentSource = process.env,
): ServerEnv {
  const missing = REQUIRED_SERVER_VARIABLES.filter(
    (name) => !source[name]?.trim(),
  ).sort();

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  return Object.fromEntries(
    REQUIRED_SERVER_VARIABLES.map((name) => [name, source[name]!.trim()]),
  ) as ServerEnv;
}