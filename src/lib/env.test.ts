import { describe, expect, it } from "vitest";

import {
  OPENAI_DEEP_MODEL,
  OPENAI_LIVE_MODEL,
  readServerEnv,
} from "./env";

describe("readServerEnv", () => {
  it("requires only the server-side API key and applies exact model defaults", () => {
    expect(readServerEnv({ OPENAI_API_KEY: "test-openai" })).toEqual({
      OPENAI_API_KEY: "test-openai",
      OPENAI_LIVE_MODEL,
      OPENAI_DEEP_MODEL,
    });
  });

  it("accepts only the configured Luna and Terra roles", () => {
    expect(
      readServerEnv({
        OPENAI_API_KEY: "test-openai",
        OPENAI_LIVE_MODEL: "gpt-5.6-luna",
        OPENAI_DEEP_MODEL: "gpt-5.6-terra",
      }),
    ).toMatchObject({
      OPENAI_LIVE_MODEL: "gpt-5.6-luna",
      OPENAI_DEEP_MODEL: "gpt-5.6-terra",
    });

    expect(() =>
      readServerEnv({
        OPENAI_API_KEY: "test-openai",
        OPENAI_LIVE_MODEL: "unexpected-model",
      }),
    ).toThrow("OPENAI_LIVE_MODEL must be gpt-5.6-luna");
  });

  it("reports a missing key without exposing any configured value", () => {
    expect(() => readServerEnv({})).toThrow(
      "Missing required environment variables: OPENAI_API_KEY",
    );
  });
});
