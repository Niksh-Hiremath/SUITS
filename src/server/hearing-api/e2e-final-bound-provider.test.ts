import { describe, expect, it } from "vitest";

import {
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  OBJECTION_RULING_STRUCTURED_OUTPUT_NAME,
  ObjectionRulingModelOutputSchema,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
  WitnessAnswerModelOutputSchema,
} from "@/domain/courtroom-ai";
import {
  COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  CourtroomModelProviderError,
} from "@/server/courtroom-ai";

import {
  E2E_FINAL_BOUND_SCENARIO,
  resolveE2EFinalBoundProvider,
} from "./e2e-final-bound-provider";

const LOOPBACK_ENVIRONMENT = {
  nodeEnv: "development",
  hostname: "127.0.0.1",
  scenario: E2E_FINAL_BOUND_SCENARIO,
} as const;

function baseRequest() {
  return {
    protocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
    mode: "initial" as const,
    attempt: 1,
    prompt: {
      promptVersion: "e2e.prompt.v1",
      cacheKey: "suits:e2e:final-bound:v1",
      developerPrefix: "stable fixture rules",
      developerContext: [
        "TRUSTED SERVER OBJECTION-RULING BINDING MANIFEST",
        JSON.stringify({
          objectionBinding: { ground: "leading" },
          questionBinding: { turnId: "turn_e2e_leading_question" },
          permittedOutcomes: [
            { ruling: "sustained", remedy: "rephrase" },
            { ruling: "overruled", remedy: "resume_response" },
          ],
        }),
      ].join("\n"),
      untrustedUserContent: "untrusted courtroom text",
    },
  };
}

describe("final-bound Playwright provider gate", () => {
  it("leaves the normal OpenAI path untouched when the flag is unset", () => {
    expect(
      resolveE2EFinalBoundProvider({
        ...LOOPBACK_ENVIRONMENT,
        scenario: undefined,
      }),
    ).toBeUndefined();
  });

  it.each([
    {
      name: "production",
      environment: { ...LOOPBACK_ENVIRONMENT, nodeEnv: "production" },
    },
    {
      name: "non-loopback",
      environment: { ...LOOPBACK_ENVIRONMENT, hostname: "dev.example.test" },
    },
    {
      name: "unknown scenario",
      environment: { ...LOOPBACK_ENVIRONMENT, scenario: "arbitrary-fixture" },
    },
  ])("rejects the fixture in $name", ({ environment }) => {
    expect(() => resolveE2EFinalBoundProvider(environment)).toThrow(
      expect.objectContaining({
        name: CourtroomModelProviderError.name,
        code: "e2e_provider_forbidden",
        retryable: false,
      }),
    );
  });

  it("proposes only an exact overruled/resume ruling and boundary answer", async () => {
    const provider = resolveE2EFinalBoundProvider(LOOPBACK_ENVIRONMENT);
    expect(provider).toBeDefined();
    if (provider === undefined) throw new Error("Expected the E2E provider");

    await expect(
      provider.generate({
        ...baseRequest(),
        callClass: "objection_resolver",
        task: "resolve_objection",
        schema: ObjectionRulingModelOutputSchema,
        schemaName: OBJECTION_RULING_STRUCTURED_OUTPUT_NAME,
        schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
      }),
    ).resolves.toMatchObject({
      output: {
        ruling: "overruled",
        remedy: "resume_response",
        citations: {
          transcriptTurnIds: ["turn_e2e_leading_question"],
        },
      },
    });

    await expect(
      provider.generate({
        ...baseRequest(),
        callClass: "role_responder",
        task: "witness_answer",
        schema: WitnessAnswerModelOutputSchema,
        schemaName: WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
        schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      }),
    ).resolves.toMatchObject({
      output: {
        disposition: "cannot_recall",
        segments: [],
      },
    });
  });
});
