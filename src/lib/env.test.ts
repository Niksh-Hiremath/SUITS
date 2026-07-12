import { afterEach, describe, expect, it } from "vitest";

import { readServerEnv } from "./env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("readServerEnv", () => {
  it("returns the verified provider configuration", () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    process.env.ELEVENLABS_TTS_MODEL = "eleven_flash_v2_5";
    process.env.ELEVENLABS_STT_MODEL = "scribe_v2";

    expect(readServerEnv()).toMatchObject({
      OPENAI_MODEL: "gpt-5.4-mini",
      ELEVENLABS_TTS_MODEL: "eleven_flash_v2_5",
      ELEVENLABS_STT_MODEL: "scribe_v2",
    });
  });

  it("reports missing variable names without exposing values", () => {
    const source = {
      OPENAI_MODEL: "gpt-5.4-mini",
      ELEVENLABS_TTS_MODEL: "eleven_flash_v2_5",
      ELEVENLABS_STT_MODEL: "scribe_v2",
    };

    expect(() => readServerEnv(source)).toThrow(
      "Missing required environment variables: ELEVENLABS_API_KEY, OPENAI_API_KEY",
    );
  });
});