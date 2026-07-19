import { createHash } from "node:crypto";

import { z } from "zod";

import {
  COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION,
  COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  COUNSEL_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  CounselResponseRequestSchema,
  CounselRoleResponseModelOutputSchema,
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION,
  DEBRIEF_GENERATOR_STRUCTURED_OUTPUT_NAME,
  DebriefCitationSetSchema,
  DebriefGeneratorModelOutputSchema,
  DebriefGeneratorRequestSchema,
  JURY_RESPONSE_REQUEST_SCHEMA_VERSION,
  JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JURY_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  JuryResponseRequestSchema,
  JuryRoleResponseModelOutputSchema,
  OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION,
  OPPONENT_PLANNER_STRUCTURED_OUTPUT_NAME,
  OpponentPlannerModelOutputSchema,
  OpponentPlannerRequestSchema,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
  WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
  WitnessAnswerModelOutputSchema,
  WitnessAnswerRequestSchema,
  type CounselResponseRequest,
  type CourtroomModelCitationSet,
  type DebriefCitationSet,
  type DebriefGeneratorRequest,
  type JuryResponseRequest,
  type OpponentPlannerRequest,
  type WitnessAnswerRequest,
} from "@/domain/courtroom-ai";
import {
  COUNSEL_RESPONSE_PROMPT_CACHE_KEY,
  COUNSEL_RESPONSE_PROMPT_VERSION,
  DEBRIEF_GENERATOR_PROMPT_CACHE_KEY,
  DEBRIEF_GENERATOR_PROMPT_VERSION,
  JURY_RESPONSE_PROMPT_CACHE_KEY,
  JURY_RESPONSE_PROMPT_VERSION,
  OPPONENT_PLANNER_PROMPT_CACHE_KEY,
  OPPONENT_PLANNER_PROMPT_VERSION,
  WITNESS_ANSWER_PROMPT_CACHE_KEY,
  WITNESS_ANSWER_PROMPT_VERSION,
  CourtroomModelProviderError,
  ScriptedCourtroomModelProvider,
  getCounselResponseStableDeveloperPrefix,
  getDebriefGeneratorStableDeveloperPrefix,
  getJuryResponseStableDeveloperPrefix,
  getOpponentPlannerStableDeveloperPrefix,
  getWitnessAnswerStableDeveloperPrefix,
  type CourtroomModelProvider,
  type CourtroomModelProviderRequest,
} from "@/server/courtroom-ai";

export const E2E_PRIMARY_TRIAL_SCENARIO = "complete-two-witness" as const;

type E2EPrimaryTrialProviderEnvironment = Readonly<{
  nodeEnv: string | undefined;
  hostname: string;
  scenario: string | undefined;
}>;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ManifestModeSchema = z.enum(["initial", "repair"]);
const ManifestAttemptSchema = z.number().int().min(1).max(2);

const OpponentManifestSchema = z
  .object({
    promptVersion: z.literal(OPPONENT_PLANNER_PROMPT_VERSION),
    requestSchemaVersion: z.literal(OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION),
    outputSchemaVersion: z.literal(OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION),
    mode: ManifestModeSchema,
    attempt: ManifestAttemptSchema,
    immutableRequestSha256: Sha256Schema,
    callBinding: z
      .object({
        callId: z.string(),
        decisionId: z.string(),
        trialId: z.string(),
        expectedStateVersion: z.number().int().nonnegative(),
        expectedLastEventId: z.string(),
        actorId: z.string(),
      })
      .strict(),
  })
  .passthrough();

const CounselManifestSchema = z
  .object({
    promptVersion: z.literal(COUNSEL_RESPONSE_PROMPT_VERSION),
    requestSchemaVersion: z.literal(COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION),
    outputSchemaVersion: z.literal(COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION),
    mode: ManifestModeSchema,
    attempt: ManifestAttemptSchema,
    immutableRequestSha256: Sha256Schema,
    callBinding: z
      .object({
        callId: z.string(),
        decisionId: z.string(),
        trialId: z.string(),
        expectedStateVersion: z.number().int().nonnegative(),
        expectedLastEventId: z.string(),
        actorId: z.string(),
      })
      .strict(),
    appearanceBinding: z
      .object({
        appearanceId: z.string(),
        witnessId: z.string(),
        examinationKind: z.enum(["direct", "cross", "redirect", "recross"]),
        answeredQuestionCount: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    planBinding: z
      .object({
        plannerCallId: z.string(),
        plannerOutputHash: Sha256Schema,
        strategyId: z.string(),
        strategyRevision: z.number().int().positive(),
      })
      .strict(),
  })
  .passthrough();

const JuryManifestSchema = z
  .object({
    promptVersion: z.literal(JURY_RESPONSE_PROMPT_VERSION),
    requestSchemaVersion: z.literal(JURY_RESPONSE_REQUEST_SCHEMA_VERSION),
    outputSchemaVersion: z.literal(JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION),
    mode: ManifestModeSchema,
    attempt: ManifestAttemptSchema,
    immutableRequestSha256: Sha256Schema,
    callBinding: z
      .object({
        callId: z.string(),
        decisionId: z.string(),
        trialId: z.string(),
        expectedStateVersion: z.number().int().nonnegative(),
        expectedLastEventId: z.string(),
        actorId: z.string(),
      })
      .strict(),
  })
  .passthrough();

const DebriefManifestSchema = z
  .object({
    promptVersion: z.literal(DEBRIEF_GENERATOR_PROMPT_VERSION),
    requestSchemaVersion: z.literal(DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION),
    outputSchemaVersion: z.literal(DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION),
    mode: ManifestModeSchema,
    attempt: ManifestAttemptSchema,
    immutableRequestSha256: Sha256Schema,
    callBinding: z
      .object({
        callId: z.string(),
        trialId: z.string(),
        expectedStateVersion: z.number().int().nonnegative(),
        expectedLastEventId: z.string(),
        actorId: z.string(),
      })
      .strict(),
  })
  .passthrough();

const WitnessManifestSchema = z
  .object({
    promptVersion: z.literal(WITNESS_ANSWER_PROMPT_VERSION),
    requestSchemaVersion: z.literal(WITNESS_ANSWER_REQUEST_SCHEMA_VERSION),
    outputSchemaVersion: z.literal(WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION),
    mode: ManifestModeSchema,
    attempt: ManifestAttemptSchema,
    immutableRequestSha256: Sha256Schema,
    callBinding: z
      .object({
        callId: z.string(),
        trialId: z.string(),
        responseId: z.string(),
        expectedStateVersion: z.number().int().nonnegative(),
        expectedLastEventId: z.string(),
        actorId: z.string(),
        witnessId: z.string(),
      })
      .strict(),
  })
  .passthrough();

type TaskIdentity = Readonly<{
  callClass: CourtroomModelProviderRequest["callClass"];
  task: CourtroomModelProviderRequest["task"];
  promptVersion: string;
  cacheKey: string;
  developerPrefix: string;
  schemaName: string;
  schemaVersion: string;
  manifestHeading: string;
  envelopeStart: string;
  envelopeEnd: string;
  dataClassification: string;
  instructionAuthority: string;
}>;

function fixtureError(message: string, cause?: unknown): CourtroomModelProviderError {
  return new CourtroomModelProviderError(
    "e2e_fixture_mismatch",
    message,
    false,
    cause === undefined ? undefined : { cause },
  );
}

function sha256Json(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function parseJson(serialized: string, description: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch (error) {
    throw fixtureError(`The primary-trial fixture received invalid ${description}`, error);
  }
}

function assertTaskIdentity(
  request: CourtroomModelProviderRequest,
  identity: TaskIdentity,
): void {
  if (
    request.callClass !== identity.callClass ||
    request.task !== identity.task ||
    request.prompt.promptVersion !== identity.promptVersion ||
    request.prompt.cacheKey !== identity.cacheKey ||
    request.prompt.developerPrefix !== identity.developerPrefix ||
    request.schemaName !== identity.schemaName ||
    request.schemaVersion !== identity.schemaVersion
  ) {
    throw fixtureError("The primary-trial fixture received the wrong call contract");
  }
}

function parseManifest<TSchema extends z.ZodType>(
  request: CourtroomModelProviderRequest,
  identity: TaskIdentity,
  schema: TSchema,
): z.output<TSchema> {
  assertTaskIdentity(request, identity);
  const [heading, serialized, ...remainder] =
    request.prompt.developerContext.split("\n");
  if (
    heading !== identity.manifestHeading ||
    serialized === undefined ||
    remainder.length !== 0
  ) {
    throw fixtureError("The primary-trial fixture received an invalid binding manifest");
  }
  try {
    const manifest = schema.parse(parseJson(serialized, "binding manifest"));
    const mode = (manifest as { mode: string }).mode;
    const attempt = (manifest as { attempt: number }).attempt;
    if (mode !== request.mode || attempt !== request.attempt) {
      throw fixtureError("The primary-trial fixture received a stale prompt attempt");
    }
    return manifest;
  } catch (error) {
    if (error instanceof CourtroomModelProviderError) throw error;
    throw fixtureError("The primary-trial fixture received an invalid binding manifest", error);
  }
}

function parseEnvelope(
  request: CourtroomModelProviderRequest,
  identity: TaskIdentity,
): Record<string, unknown> {
  const lines = request.prompt.untrustedUserContent.split("\n");
  if (
    lines.length !== 4 ||
    lines[0] !== identity.envelopeStart ||
    lines[2] === undefined ||
    lines[3] !== identity.envelopeEnd
  ) {
    throw fixtureError("The primary-trial fixture received an invalid data envelope");
  }
  try {
    const envelope = z
      .record(z.string(), z.unknown())
      .parse(parseJson(lines[2], "data envelope"));
    if (
      envelope.dataClassification !== identity.dataClassification ||
      envelope.instructionAuthority !== identity.instructionAuthority
    ) {
      throw fixtureError("The primary-trial fixture received the wrong data boundary");
    }
    return envelope;
  } catch (error) {
    if (error instanceof CourtroomModelProviderError) throw error;
    throw fixtureError("The primary-trial fixture received an invalid data envelope", error);
  }
}

function parseBoundRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  candidate: unknown,
  expectedHash: string,
): z.output<TSchema> {
  try {
    const parsed = schema.parse(candidate);
    if (sha256Json(parsed) !== expectedHash) {
      throw fixtureError("The primary-trial fixture request hash does not match");
    }
    return parsed;
  } catch (error) {
    if (error instanceof CourtroomModelProviderError) throw error;
    throw fixtureError("The primary-trial fixture received an invalid bound request", error);
  }
}

const OPPONENT_IDENTITY: TaskIdentity = {
  callClass: "opponent_planner",
  task: "plan_opponent",
  promptVersion: OPPONENT_PLANNER_PROMPT_VERSION,
  cacheKey: OPPONENT_PLANNER_PROMPT_CACHE_KEY,
  developerPrefix: getOpponentPlannerStableDeveloperPrefix(),
  schemaName: OPPONENT_PLANNER_STRUCTURED_OUTPUT_NAME,
  schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
  manifestHeading: "TRUSTED SERVER OPPONENT-PLAN BINDING MANIFEST",
  envelopeStart: "BEGIN UNTRUSTED OPPONENT PLANNING INPUT JSON",
  envelopeEnd: "END UNTRUSTED OPPONENT PLANNING INPUT JSON",
  dataClassification: "untrusted_opponent_planning_input",
  instructionAuthority: "none",
};

const COUNSEL_IDENTITY: TaskIdentity = {
  callClass: "role_responder",
  task: "counsel_response",
  promptVersion: COUNSEL_RESPONSE_PROMPT_VERSION,
  cacheKey: COUNSEL_RESPONSE_PROMPT_CACHE_KEY,
  developerPrefix: getCounselResponseStableDeveloperPrefix(),
  schemaName: COUNSEL_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  manifestHeading: "TRUSTED SERVER COUNSEL-RESPONSE BINDING MANIFEST",
  envelopeStart: "BEGIN UNTRUSTED PUBLIC COUNSEL INPUT JSON",
  envelopeEnd: "END UNTRUSTED PUBLIC COUNSEL INPUT JSON",
  dataClassification: "untrusted_public_counsel_input",
  instructionAuthority: "none",
};

const JURY_IDENTITY: TaskIdentity = {
  callClass: "role_responder",
  task: "jury_deliberation",
  promptVersion: JURY_RESPONSE_PROMPT_VERSION,
  cacheKey: JURY_RESPONSE_PROMPT_CACHE_KEY,
  developerPrefix: getJuryResponseStableDeveloperPrefix(),
  schemaName: JURY_ROLE_RESPONSE_STRUCTURED_OUTPUT_NAME,
  schemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  manifestHeading: "TRUSTED SERVER JURY-RESPONSE BINDING MANIFEST",
  envelopeStart: "BEGIN UNTRUSTED JURY INPUT JSON",
  envelopeEnd: "END UNTRUSTED JURY INPUT JSON",
  dataClassification: "untrusted_jury_record_and_manifest",
  instructionAuthority: "none_outside_simulated_jury_evaluation",
};

const DEBRIEF_IDENTITY: TaskIdentity = {
  callClass: "debrief_generator",
  task: "generate_debrief",
  promptVersion: DEBRIEF_GENERATOR_PROMPT_VERSION,
  cacheKey: DEBRIEF_GENERATOR_PROMPT_CACHE_KEY,
  developerPrefix: getDebriefGeneratorStableDeveloperPrefix(),
  schemaName: DEBRIEF_GENERATOR_STRUCTURED_OUTPUT_NAME,
  schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  manifestHeading: "TRUSTED SERVER DEBRIEF-GENERATOR BINDING MANIFEST",
  envelopeStart: "BEGIN UNTRUSTED DEBRIEF AUDIT JSON",
  envelopeEnd: "END UNTRUSTED DEBRIEF AUDIT JSON",
  dataClassification: "untrusted_debrief_audit",
  instructionAuthority: "none",
};

const WITNESS_IDENTITY: TaskIdentity = {
  callClass: "role_responder",
  task: "witness_answer",
  promptVersion: WITNESS_ANSWER_PROMPT_VERSION,
  cacheKey: WITNESS_ANSWER_PROMPT_CACHE_KEY,
  developerPrefix: getWitnessAnswerStableDeveloperPrefix(),
  schemaName: WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
  schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  manifestHeading: "TRUSTED SERVER WITNESS BINDING MANIFEST",
  envelopeStart: "BEGIN UNTRUSTED WITNESS INPUT JSON",
  envelopeEnd: "END UNTRUSTED WITNESS INPUT JSON",
  dataClassification: "untrusted_witness_input",
  instructionAuthority: "none",
};

function opponentRequest(request: CourtroomModelProviderRequest): OpponentPlannerRequest {
  const manifest = parseManifest(request, OPPONENT_IDENTITY, OpponentManifestSchema);
  const envelope = parseEnvelope(request, OPPONENT_IDENTITY);
  return parseBoundRequest(
    OpponentPlannerRequestSchema,
    {
      schemaVersion: OPPONENT_PLANNER_REQUEST_SCHEMA_VERSION,
      ...manifest.callBinding,
      procedure: envelope.procedure,
      opportunities: envelope.opportunities,
      knowledgeView: envelope.knowledgeView,
    },
    manifest.immutableRequestSha256,
  );
}

function counselRequest(request: CourtroomModelProviderRequest): CounselResponseRequest {
  const manifest = parseManifest(request, COUNSEL_IDENTITY, CounselManifestSchema);
  const envelope = parseEnvelope(request, COUNSEL_IDENTITY);
  return parseBoundRequest(
    CounselResponseRequestSchema,
    {
      schemaVersion: COUNSEL_RESPONSE_REQUEST_SCHEMA_VERSION,
      ...manifest.callBinding,
      appearance: manifest.appearanceBinding,
      planBinding: manifest.planBinding,
      directive: envelope.directive,
      knowledgeView: envelope.knowledgeView,
    },
    manifest.immutableRequestSha256,
  );
}

function juryRequest(request: CourtroomModelProviderRequest): JuryResponseRequest {
  const manifest = parseManifest(request, JURY_IDENTITY, JuryManifestSchema);
  const envelope = parseEnvelope(request, JURY_IDENTITY);
  return parseBoundRequest(
    JuryResponseRequestSchema,
    {
      schemaVersion: JURY_RESPONSE_REQUEST_SCHEMA_VERSION,
      ...manifest.callBinding,
      decisionManifest: envelope.decisionManifest,
      knowledgeView: envelope.knowledgeView,
    },
    manifest.immutableRequestSha256,
  );
}

function debriefRequest(request: CourtroomModelProviderRequest): DebriefGeneratorRequest {
  const manifest = parseManifest(request, DEBRIEF_IDENTITY, DebriefManifestSchema);
  const envelope = parseEnvelope(request, DEBRIEF_IDENTITY);
  return parseBoundRequest(
    DebriefGeneratorRequestSchema,
    {
      schemaVersion: DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION,
      ...manifest.callBinding,
      knowledgeView: envelope.knowledgeView,
      transcript: envelope.transcript,
      procedure: envelope.procedure,
    },
    manifest.immutableRequestSha256,
  );
}

function witnessRequest(request: CourtroomModelProviderRequest): WitnessAnswerRequest {
  const manifest = parseManifest(request, WITNESS_IDENTITY, WitnessManifestSchema);
  const envelope = parseEnvelope(request, WITNESS_IDENTITY);
  return parseBoundRequest(
    WitnessAnswerRequestSchema,
    {
      schemaVersion: WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
      ...manifest.callBinding,
      question: envelope.question,
      knowledgeView: envelope.knowledgeView,
    },
    manifest.immutableRequestSha256,
  );
}

function emptyCitations(): CourtroomModelCitationSet {
  return {
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
  };
}

function plannerOutput(providerRequest: CourtroomModelProviderRequest) {
  const request = opponentRequest(providerRequest);
  const record = request.knowledgeView.publicRecord;
  const citations: CourtroomModelCitationSet = {
    ...emptyCitations(),
    factIds: record.facts.slice(0, 1).map(({ factId }) => factId),
    evidenceIds: record.evidence.slice(0, 1).map(({ evidenceId }) => evidenceId),
    testimonyIds: record.testimony
      .slice(0, 1)
      .map(({ testimonyId }) => testimonyId),
  };
  const canGroundClosing =
    citations.factIds.length +
      citations.evidenceIds.length +
      citations.testimonyIds.length >
    0;
  if (request.opportunities.canClose && !canGroundClosing) {
    throw fixtureError("The primary-trial fixture cannot ground the closing");
  }
  return OpponentPlannerModelOutputSchema.parse({
    schemaVersion: OPPONENT_PLANNER_OUTPUT_SCHEMA_VERSION,
    objectives: ["Complete the permitted examination step from the public record."],
    witnessPriorityIds: [],
    evidencePriorityIds: [],
    settlementPosture: "avoid",
    privateNotes: ["Keep the deterministic browser flow concise and record-grounded."],
    proposedMoves: request.opportunities.canClose
      ? [
          {
            kind: "give_closing",
            rationale: "A short record-grounded closing completes the opposing case.",
            citations,
          },
        ]
      : [
          {
            kind: "no_action",
            rationale: "No further examination is needed for this appearance.",
            citations: emptyCitations(),
          },
        ],
  });
}

function counselOutput(providerRequest: CourtroomModelProviderRequest) {
  const request = counselRequest(providerRequest);
  const directive = request.directive;
  if (directive.kind === "end_examination") {
    return CounselRoleResponseModelOutputSchema.parse({
      schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      speechSegments: [
        {
          text: "No further questions, Your Honor.",
          citations: emptyCitations(),
        },
      ],
      proposedAction: {
        kind: "end_examination",
        disposition: directive.disposition,
      },
      performance: {
        activity: "speaking",
        emotion: "confident",
        intensity: 0.4,
        gazeTarget: "judge",
        gesture: "small_nod",
        speakingStyle: "formal",
      },
    });
  }
  if (directive.kind !== "give_closing") {
    throw fixtureError("The primary-trial fixture received an unsupported counsel directive");
  }
  const citations: CourtroomModelCitationSet = {
    ...emptyCitations(),
    factIds: directive.permittedFactIds.slice(0, 1),
    evidenceIds: directive.permittedEvidenceIds.slice(0, 1),
    testimonyIds: directive.permittedTestimonyIds.slice(0, 1),
  };
  return CounselRoleResponseModelOutputSchema.parse({
    schemaVersion: COUNSEL_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    speechSegments: [
      {
        text: "The jury-considerable record does not carry the user's fictional burden.",
        citations,
      },
    ],
    proposedAction: { kind: "give_closing" },
    performance: {
      activity: "speaking",
      emotion: "confident",
      intensity: 0.5,
      gazeTarget: "jury",
      gesture: "open_palm",
      speakingStyle: "firm",
    },
  });
}

function juryOutput(providerRequest: CourtroomModelProviderRequest) {
  const request = juryRequest(providerRequest);
  const record = request.knowledgeView.publicRecord;
  const citations: CourtroomModelCitationSet = {
    ...emptyCitations(),
    factIds: record.facts.slice(0, 1).map(({ factId }) => factId),
    evidenceIds: record.evidence.slice(0, 1).map(({ evidenceId }) => evidenceId),
    testimonyIds: record.testimony
      .slice(0, 1)
      .map(({ testimonyId }) => testimonyId),
    instructionIds: record.instructions.map(({ instructionId }) => instructionId),
  };
  const findingCount =
    request.decisionManifest.kind === "issues"
      ? request.decisionManifest.issues.length
      : 1;
  return JuryRoleResponseModelOutputSchema.parse({
    schemaVersion: JURY_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    deliberationSegments: [
      {
        text: "The admitted record and every issued instruction support a fictional verdict.",
        citations,
      },
    ],
    findings: Array.from({ length: findingCount }, () => ({
      conclusion: "The user carried the fictional burden on the admitted record.",
      weight: "strong" as const,
      citations,
    })),
    recommendation: {
      outcome: "user_prevails",
      decision: "The jury finds for the user on the jury-considerable record.",
      confidence: 0.76,
    },
    performance: {
      activity: "speaking",
      emotion: "neutral",
      intensity: 0.45,
      gazeTarget: "judge",
      gesture: "none",
      speakingStyle: "deliberative",
    },
  });
}

function emptyDebriefCitations(
  overrides: Partial<DebriefCitationSet> = {},
): DebriefCitationSet {
  return DebriefCitationSetSchema.parse({
    admittedFactIds: [],
    admittedEvidenceIds: [],
    activeTestimonyIds: [],
    transcriptTurnIds: [],
    unadmittedFactIds: [],
    unadmittedEvidenceIds: [],
    excludedFactIds: [],
    excludedEvidenceIds: [],
    strickenTestimonyIds: [],
    hiddenFactIds: [],
    hiddenSourceSegmentIds: [],
    coachingInferenceIds: [],
    ...overrides,
  });
}

function debriefOutput(providerRequest: CourtroomModelProviderRequest) {
  const request = debriefRequest(providerRequest);
  const admitted = request.knowledgeView.strata.admittedRecord.record;
  const citations = emptyDebriefCitations({
    admittedFactIds: admitted.facts.slice(0, 1).map(({ factId }) => factId),
    admittedEvidenceIds: admitted.evidence
      .slice(0, 1)
      .map(({ evidenceId }) => evidenceId),
    activeTestimonyIds: admitted.testimony
      .slice(0, 2)
      .map(({ testimonyId }) => testimonyId),
    transcriptTurnIds: request.transcript
      .filter(({ status }) => status === "active")
      .slice(0, 8)
      .map(({ turnId }) => turnId),
  });
  if (Object.values(citations).every((identifiers) => identifiers.length === 0)) {
    throw fixtureError("The primary-trial fixture cannot ground the debrief");
  }
  return DebriefGeneratorModelOutputSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    overallAssessment: {
      text: "The examination created a coherent admitted record for this fictional hearing.",
      basis: "admitted_record",
      citations,
    },
    strengths: [
      {
        title: "Coherent examination",
        assessment: "The active transcript shows a focused witness sequence.",
        recommendation: "Keep the same disciplined structure.",
        basis: "admitted_record",
        citations,
      },
    ],
    weakQuestions: [],
    missedEvidence: [],
    contradictions: [],
    objectionAccuracy: [],
    witnessStrategy: [],
    settlementChoices: [],
    juryMovement: [],
    improvedClosing: {
      segments: [
        {
          text: "The admitted record supports the requested fictional result.",
          citations,
        },
      ],
    },
    limitations: [
      "This fictional educational coaching is not legal advice or a real-case prediction.",
    ],
  });
}

function witnessOutput(providerRequest: CourtroomModelProviderRequest) {
  witnessRequest(providerRequest);
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
    case "plan_opponent":
      return plannerOutput(request);
    case "counsel_response":
      return counselOutput(request);
    case "jury_deliberation":
      return juryOutput(request);
    case "generate_debrief":
      return debriefOutput(request);
    case "witness_answer":
      return witnessOutput(request);
    default:
      throw fixtureError(
        `The primary-trial fixture does not support the ${request.task} task`,
      );
  }
}

function scriptedProvider(): CourtroomModelProvider {
  return new ScriptedCourtroomModelProvider(
    [{ type: "output", output: outputForRequest, chunkSize: 4_096 }],
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
 * Enable the deterministic complete-trial provider only for the exact browser
 * fixture on a loopback, non-production server. An unset flag leaves the real
 * Responses API path untouched; every present but invalid flag fails closed.
 */
export function resolveE2EPrimaryTrialProvider(
  environment: E2EPrimaryTrialProviderEnvironment,
): CourtroomModelProvider | undefined {
  if (environment.scenario === undefined || environment.scenario === "") {
    return undefined;
  }
  if (
    (environment.nodeEnv !== "development" && environment.nodeEnv !== "test") ||
    !isLoopback(environment.hostname) ||
    environment.scenario !== E2E_PRIMARY_TRIAL_SCENARIO
  ) {
    throw new CourtroomModelProviderError(
      "e2e_provider_forbidden",
      "The deterministic courtroom fixture is unavailable",
      false,
    );
  }
  return scriptedProvider();
}
