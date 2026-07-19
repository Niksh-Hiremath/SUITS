import { z } from "zod";

import {
  CourtroomModelCitationSetSchema,
  OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
  ObjectionGroundSchema,
  ObjectionRulingModelOutputSchema,
} from "@/domain/courtroom-ai/call-contracts";
import {
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WitnessAnswerModelOutputSchema,
} from "@/domain/courtroom-ai/witness-answer";
import { CaseGraphEntityIdSchema } from "@/domain/case-graph";
import {
  CourtroomModelProviderError,
  ScriptedCourtroomModelProvider,
  type CourtroomModelProvider,
  type CourtroomModelProviderRequest,
} from "@/server/courtroom-ai";

export const E2E_FINAL_BOUND_SCENARIO = "overruled-resume" as const;

type E2EFinalBoundProviderEnvironment = Readonly<{
  nodeEnv: string | undefined;
  hostname: string;
  scenario: string | undefined;
}>;

const TrustedObjectionManifestSchema = z
  .object({
    objectionBinding: z
      .object({ ground: ObjectionGroundSchema })
      .passthrough(),
    questionBinding: z
      .object({ turnId: CaseGraphEntityIdSchema })
      .passthrough(),
    permittedOutcomes: z
      .array(
        z
          .object({
            ruling: z.enum(["sustained", "overruled"]),
            remedy: z.enum([
              "none",
              "rephrase",
              "cancel_response",
              "resume_response",
            ]),
          })
          .strict(),
      )
      .min(1),
  })
  .passthrough();

function fixtureError(message: string, cause?: unknown): CourtroomModelProviderError {
  return new CourtroomModelProviderError(
    "e2e_fixture_mismatch",
    message,
    false,
    cause === undefined ? undefined : { cause },
  );
}

function parseTrustedManifest(
  request: CourtroomModelProviderRequest,
): z.infer<typeof TrustedObjectionManifestSchema> {
  const jsonLine = request.prompt.developerContext
    .split("\n")
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (jsonLine === undefined) {
    throw fixtureError("The objection fixture could not find its trusted binding");
  }
  try {
    return TrustedObjectionManifestSchema.parse(JSON.parse(jsonLine));
  } catch (error) {
    throw fixtureError("The objection fixture received an invalid trusted binding", error);
  }
}

function emptyCitations() {
  return CourtroomModelCitationSetSchema.parse({
    factIds: [],
    evidenceIds: [],
    testimonyIds: [],
    transcriptTurnIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
    issueIds: [],
    instructionIds: [],
    ruleIds: [],
    settlementOfferIds: [],
  });
}

function objectionOutput(request: CourtroomModelProviderRequest) {
  const manifest = parseTrustedManifest(request);
  const outcome = manifest.permittedOutcomes.find(
    (candidate) =>
      candidate.ruling === "overruled" &&
      candidate.remedy === "resume_response",
  );
  if (outcome === undefined) {
    throw fixtureError(
      "The objection fixture requires an interrupted response that can resume",
    );
  }
  return ObjectionRulingModelOutputSchema.parse({
    schemaVersion: OBJECTION_RULING_OUTPUT_SCHEMA_VERSION,
    ...outcome,
    reason: `The ${manifest.objectionBinding.ground} objection is overruled; the witness may answer.`,
    citations: {
      ...emptyCitations(),
      transcriptTurnIds: [manifest.questionBinding.turnId],
    },
    performance: {
      activity: "ruling",
      emotion: "neutral",
      intensity: 0.45,
      gazeTarget: "questioning_counsel",
      gesture: "gavel",
      speakingStyle: "formal",
    },
  });
}

function witnessOutput() {
  return WitnessAnswerModelOutputSchema.parse({
    schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    disposition: "cannot_recall",
    performance: {
      emotion: "neutral",
      intensity: 0.25,
      delivery: "measured",
      gesture: "head_shake",
      gazeTarget: "questioning_counsel",
    },
    segments: [],
  });
}

function outputForRequest(request: CourtroomModelProviderRequest): unknown {
  switch (request.task) {
    case "resolve_objection":
      return objectionOutput(request);
    case "witness_answer":
      return witnessOutput();
    default:
      throw fixtureError(
        `The objection fixture does not support the ${request.task} task`,
      );
  }
}

function scriptedProvider(): CourtroomModelProvider {
  return new ScriptedCourtroomModelProvider(
    [{ type: "output", output: outputForRequest }],
    { repeatLastStep: true },
  );
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Return the one allowlisted browser-E2E provider only on a loopback,
 * non-production server. An unset flag preserves the normal Responses API path.
 */
export function resolveE2EFinalBoundProvider(
  environment: E2EFinalBoundProviderEnvironment,
): CourtroomModelProvider | undefined {
  const scenario = environment.scenario?.trim();
  if (scenario === undefined || scenario === "") return undefined;
  if (
    (environment.nodeEnv !== "development" && environment.nodeEnv !== "test") ||
    !isLoopback(environment.hostname) ||
    scenario !== E2E_FINAL_BOUND_SCENARIO
  ) {
    throw new CourtroomModelProviderError(
      "e2e_provider_forbidden",
      "The deterministic courtroom fixture is unavailable",
      false,
    );
  }
  return scriptedProvider();
}
