import { describe, expect, it, vi } from "vitest";

import {
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
  WitnessAnswerModelOutputSchema,
} from "@/domain/courtroom-ai";
import { OPENAI_DEEP_MODEL, OPENAI_LIVE_MODEL } from "@/lib/env";

import { COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION } from "./constants";
import { EnvironmentCourtroomModelProvider } from "./environment-provider";
import { ScriptedCourtroomModelProvider } from "./fake-provider";
import { CourtroomModelProviderError } from "./provider";

describe("environment courtroom provider", () => {
  it("does not read credentials until a model call and reuses one delegate", async () => {
    const output = WitnessAnswerModelOutputSchema.parse({
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      disposition: "cannot_recall",
      performance: {
        emotion: "neutral",
        intensity: 0.2,
        delivery: "measured",
        gesture: "none",
        gazeTarget: "questioning_counsel",
      },
      segments: [],
    });
    const scripted = new ScriptedCourtroomModelProvider(
      [{ type: "output", output }],
      { repeatLastStep: true },
    );
    const readEnvironment = vi.fn(() => ({
      OPENAI_API_KEY: "server-only-test-key",
      OPENAI_LIVE_MODEL,
      OPENAI_DEEP_MODEL,
    }));
    const createProvider = vi.fn(() => scripted);
    const provider = new EnvironmentCourtroomModelProvider({
      readEnvironment,
      createProvider,
    });

    expect(readEnvironment).not.toHaveBeenCalled();
    const request = {
      protocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
      callClass: "role_responder" as const,
      task: "witness_answer" as const,
      mode: "initial" as const,
      attempt: 1,
      prompt: {
        promptVersion: "role-responder.witness-answer.prompt.v1",
        cacheKey: "suits:witness:test",
        developerPrefix: "stable rules",
        developerContext: "trusted binding",
        untrustedUserContent: "untrusted question",
      },
      schema: WitnessAnswerModelOutputSchema,
      schemaName: WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    };

    await expect(provider.generate(request)).resolves.toMatchObject({ output });
    await expect(
      provider.generate({ ...request, attempt: 2, mode: "repair" }),
    ).resolves.toMatchObject({ output });
    expect(readEnvironment).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledOnce();
    expect(createProvider).toHaveBeenCalledWith("server-only-test-key");
  });

  it("turns missing server configuration into a safe provider code", async () => {
    const provider = new EnvironmentCourtroomModelProvider({
      readEnvironment: () => {
        throw new Error("RAW_ENVIRONMENT_DETAIL");
      },
    });
    const request = {
      protocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
      callClass: "role_responder" as const,
      task: "witness_answer" as const,
      mode: "initial" as const,
      attempt: 1,
      prompt: {
        promptVersion: "role-responder.witness-answer.prompt.v1",
        cacheKey: "suits:witness:test",
        developerPrefix: "stable rules",
        developerContext: "trusted binding",
        untrustedUserContent: "untrusted question",
      },
      schema: WitnessAnswerModelOutputSchema,
      schemaName: WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    };

    await expect(provider.generate(request)).rejects.toMatchObject({
      name: CourtroomModelProviderError.name,
      code: "openai_configuration_error",
      retryable: false,
    });
  });
});
