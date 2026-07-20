import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { createThreeWitnessCaseGraphV1Fixture } from "../src/domain/case-graph";
import { sha256Utf8 } from "../src/domain/case-graph/hash";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
  JudgeRoleResponseModelOutputSchema,
  type JudgeRoleResponseModelOutput,
} from "../src/domain/courtroom-ai";
import {
  HEARING_JUDGE_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HearingCommittedPerformanceSchema,
  HearingJudgeResponsePrecommitSchema,
  hashJudgeResponseModelOutput,
  judgeResponseOutputCitations,
  type HearingJudgeResponsePrecommit,
} from "../src/domain/hearing-runtime";
import type { TrialPolicyActorBindingInput } from "../src/domain/trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  TrialStateV3Schema,
  type ActorRef,
  type TrialActionV3,
} from "../src/domain/trial-engine";
import schema from "./schema";
import type { CanonicalTrialAudit } from "./trialEvents";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./courtroomModelCalls.ts": () => import("./courtroomModelCalls"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174001";
const OTHER_OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174002";
const GRAPH_ID = "graph:trial-events-published";
const OTHER_GRAPH_ID = "graph:trial-events-other-owner";
const DRAFT_GRAPH_ID = "graph:trial-events-draft";
const STARTED_AT = Date.UTC(2026, 6, 19, 6, 0, 0);

const ACTORS = {
  system: {
    actorId: "actor_system",
    role: "system",
    side: "neutral",
    witnessId: null,
  },
  judge: {
    actorId: "actor_judge",
    role: "judge",
    side: "neutral",
    witnessId: null,
  },
  userCounsel: {
    actorId: "actor_user_counsel",
    role: "user_counsel",
    side: "user",
    witnessId: null,
  },
  opposingCounsel: {
    actorId: "actor_opposing_counsel",
    role: "opposing_counsel",
    side: "opposing",
    witnessId: null,
  },
  jury: {
    actorId: "actor_jury",
    role: "jury",
    side: "neutral",
    witnessId: null,
  },
  rina: {
    actorId: "actor_witness_rina",
    role: "witness",
    side: "user",
    witnessId: "witness_rina_shah",
  },
  theo: {
    actorId: "actor_witness_theo",
    role: "witness",
    side: "opposing",
    witnessId: "witness_theo_morgan",
  },
  maya: {
    actorId: "actor_witness_maya",
    role: "witness",
    side: "neutral",
    witnessId: "witness_maya_ortiz",
  },
} as const satisfies Record<string, ActorRef>;

function actorBindings(): TrialPolicyActorBindingInput[] {
  return Object.values(ACTORS).map((boundActor) => ({
    actor: boundActor,
    representedPartyIds:
      boundActor.role === "user_counsel"
        ? ["party_rina_shah"]
        : boundActor.role === "opposing_counsel"
          ? ["party_redwood_signal"]
          : [],
  }));
}

type TestBackend = TestConvex<typeof schema>;

type Receipt = Readonly<{
  receiptId: string;
  trialId: string;
  actionId: string;
  committedStateVersion: number;
  firstSequence: number;
  lastSequence: number;
  eventIds: string[];
  replayed: boolean;
}>;

type CreateArgs = Readonly<{
  trialId: string;
  graphId: string;
  actionId: string;
  requestedAt: number;
  actorBindings: TrialPolicyActorBindingInput[];
  userSide?: "user" | "opposing";
}>;

type ReloadResult = Readonly<{
  trialId: string;
  graphId: string | null;
  stateVersion: number;
  lastSequence: number;
  stateJson: string;
  stateSchemaVersion: string;
  eventSchemaVersion: string;
  validated: boolean;
  requiresMigration: boolean;
  snapshot: null | Readonly<{
    lastSequence: number;
    stateSchemaVersion: string;
  }>;
  events: Array<Readonly<{
    eventId: string;
    sequence: number;
    eventSchemaVersion: string;
  }>>;
  hasMore: boolean;
  nextAfterSequence: number | null;
}>;

const createReference = makeFunctionReference<"mutation", CreateArgs, Receipt>(
  "trialEvents:createTrial",
);
const createForOwnerReference = makeFunctionReference<
  "mutation",
  CreateArgs & Readonly<{ ownerId: string }>,
  Receipt
>("trialEvents:createForOwner");
const appendReference = makeFunctionReference<
  "mutation",
  Readonly<{ actionJson: string }>,
  Receipt
>("trialEvents:append");
const appendTrustedReference = makeFunctionReference<
  "mutation",
  Readonly<{ actionJson: string; writeSnapshot?: boolean }>,
  Receipt
>("trialEvents:appendTrusted");
const appendPlayerForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; actionJson: string }>,
  Receipt
>("trialEvents:appendPlayerForOwner");
const appendTrustedForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    writeSnapshot?: boolean;
  }>,
  Receipt
>("trialEvents:appendTrustedForOwner");
const appendJudgeResponseForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    generationJson: string;
    writeSnapshot?: boolean;
  }>,
  Receipt
>("trialEvents:appendJudgeResponseForOwner");
const reloadForOwnerReference = makeFunctionReference<
  "query",
  Readonly<{
    ownerId: string;
    trialId: string;
    afterSequence?: number;
    limit?: number;
  }>,
  ReloadResult
>("trialEvents:reloadForOwnerSession");
const canonicalAuditForOwnerReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  CanonicalTrialAudit
>("trialEvents:readCanonicalAuditForOwner");

async function insertGraph(
  backend: TestBackend,
  input: {
    graphId: string;
    ownerId: string;
    lifecycle?: "draft" | "published";
  },
): Promise<void> {
  const graph = createThreeWitnessCaseGraphV1Fixture();
  const lifecycle = input.lifecycle ?? "published";
  graph.status = lifecycle;
  await backend.run(async (ctx) => {
    await ctx.db.insert("caseGraphs", {
      graphId: input.graphId,
      caseId: graph.caseId,
      version: lifecycle === "draft" ? 1 : 2,
      lifecycle,
      visibility: "private",
      ownerId: input.ownerId,
      uploadId: `upload:${input.graphId}`,
      title: graph.title,
      graphJson: JSON.stringify(graph),
      graphSchemaVersion: graph.schemaVersion,
      compilerMetadataJson: undefined,
      sourceDigest: graph.compilerMetadata.sourceContentHash,
      createdBy: "user",
      createdAt: STARTED_AT,
    });
  });
}

async function setup() {
  const backend = convexTest({ schema, modules });
  await insertGraph(backend, { graphId: GRAPH_ID, ownerId: OWNER_ID });
  return {
    backend,
    owner: backend.withIdentity({ tokenIdentifier: OWNER_ID }),
    otherOwner: backend.withIdentity({ tokenIdentifier: OTHER_OWNER_ID }),
  };
}

async function reloadOwned(
  backend: TestBackend,
  input: Readonly<{
    trialId: string;
    ownerId?: string;
    afterSequence?: number;
    limit?: number;
  }>,
): Promise<ReloadResult> {
  return await backend.query(reloadForOwnerReference, {
    ownerId: input.ownerId ?? OWNER_ID,
    trialId: input.trialId,
    ...(input.afterSequence === undefined
      ? {}
      : { afterSequence: input.afterSequence }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
}

function createArgs(
  trialId: string,
  actionId = `action:${trialId}:start`,
  graphId = GRAPH_ID,
): CreateArgs {
  return {
    trialId,
    graphId,
    actionId,
    requestedAt: STARTED_AT,
    actorBindings: actorBindings(),
  };
}

function settlementAction(
  trialId: string,
  actionId: string,
  expectedStateVersion: number,
  amount = 90_000,
): TrialActionV3 {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId,
    trialId,
    expectedStateVersion,
    actor: ACTORS.userCounsel,
    source: "user",
    requestedAt: new Date(
      STARTED_AT + (expectedStateVersion + 1) * 1_000,
    ).toISOString(),
    causationId: `event:action:${trialId}:start`,
    correlationId: trialId,
    responseId: null,
    interruptId: null,
    modelMetadata: null,
    type: "PROPOSE_SETTLEMENT",
    payload: {
      offerId: `offer:${actionId}`,
      parentOfferId: null,
      proposedByPartyId: "party_rina_shah",
      recipientPartyIds: ["party_redwood_signal"],
      terms: {
        amount,
        currency: "USD",
        nonMonetaryTerms: ["Neutral reference"],
        summary: "Claimant proposes an educational-simulation settlement.",
      },
      expiresAtSequence: 14,
    },
  });
}

function forgedJudgeAction(trialId: string): TrialActionV3 {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: `action:${trialId}:forged-judge`,
    trialId,
    expectedStateVersion: 1,
    actor: ACTORS.judge,
    source: "deterministic",
    requestedAt: new Date(STARTED_AT + 2_000).toISOString(),
    causationId: `event:action:${trialId}:start`,
    correlationId: trialId,
    responseId: null,
    interruptId: null,
    modelMetadata: null,
    type: "BEGIN_PHASE",
    payload: { phase: "opening" },
  });
}

const JUDGE_STRIKE_TESTIMONY_ID = "testimony:judge-response:answer";
const JUDGE_STRIKE_FACT_ID = "fact_complaint_sent";

function judgeFixtureAction(input: Readonly<{
  trialId: string;
  actionId: string;
  expectedStateVersion: number;
  actor: ActorRef;
  source: "user" | "ai" | "deterministic" | "system";
  causationId: string;
  type: TrialActionV3["type"];
  payload: unknown;
  responseId?: string;
  requestedAt?: string;
  modelMetadata?: TrialActionV3["modelMetadata"];
}>): TrialActionV3 {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: input.actionId,
    trialId: input.trialId,
    expectedStateVersion: input.expectedStateVersion,
    actor: input.actor,
    source: input.source,
    requestedAt:
      input.requestedAt ??
      new Date(
        STARTED_AT + (input.expectedStateVersion + 1) * 1_000,
      ).toISOString(),
    causationId: input.causationId,
    correlationId: input.trialId,
    responseId: input.responseId ?? null,
    interruptId: null,
    modelMetadata: input.modelMetadata ?? null,
    type: input.type,
    payload: input.payload,
  });
}

async function setupPendingJudgeStrikeMotion(ruling: "granted" | "denied") {
  const { backend } = await setup();
  const trialId = `trial:judge-response:${ruling}`;
  const append = async (trialAction: TrialActionV3): Promise<Receipt> =>
    await backend.mutation(appendTrustedForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify(trialAction),
    });
  const startActionId = `action:${trialId}:start`;
  await backend.mutation(createForOwnerReference, {
    ownerId: OWNER_ID,
    ...createArgs(trialId, startActionId),
  });

  const phaseActionId = `action:${trialId}:phase`;
  await append(
    judgeFixtureAction({
      trialId,
      actionId: phaseActionId,
      expectedStateVersion: 1,
      actor: ACTORS.judge,
      source: "deterministic",
      causationId: `event:${startActionId}`,
      type: "BEGIN_PHASE",
      payload: { phase: "case_in_chief" },
    }),
  );
  const callActionId = `action:${trialId}:call`;
  await append(
    judgeFixtureAction({
      trialId,
      actionId: callActionId,
      expectedStateVersion: 2,
      actor: ACTORS.userCounsel,
      source: "user",
      causationId: `event:${phaseActionId}`,
      type: "CALL_WITNESS",
      payload: { witnessId: ACTORS.rina.witnessId, calledBySide: "user" },
    }),
  );
  const swearActionId = `action:${trialId}:swear`;
  await append(
    judgeFixtureAction({
      trialId,
      actionId: swearActionId,
      expectedStateVersion: 3,
      actor: ACTORS.judge,
      source: "deterministic",
      causationId: `event:${callActionId}`,
      type: "SWEAR_WITNESS",
      payload: { witnessId: ACTORS.rina.witnessId },
    }),
  );
  const questionActionId = `action:${trialId}:question`;
  const questionId = `question:${trialId}`;
  await append(
    judgeFixtureAction({
      trialId,
      actionId: questionActionId,
      expectedStateVersion: 4,
      actor: ACTORS.userCounsel,
      source: "user",
      causationId: `event:${swearActionId}`,
      type: "ASK_QUESTION",
      payload: {
        questionId,
        witnessId: ACTORS.rina.witnessId,
        examinationKind: "direct",
        text: "Did you send the complaint?",
        turnId: `turn:${trialId}:question`,
        presentedEvidenceIds: [],
      },
    }),
  );
  const requestActionId = `action:${trialId}:request`;
  const responseId = `response:${trialId}`;
  await append(
    judgeFixtureAction({
      trialId,
      actionId: requestActionId,
      expectedStateVersion: 5,
      actor: ACTORS.system,
      source: "system",
      causationId: `event:${questionActionId}`,
      type: "REQUEST_RESPONSE",
      payload: {
        responseId,
        actorId: ACTORS.rina.actorId,
        purpose: "answer_question",
      },
      responseId,
    }),
  );
  const answerActionId = `action:${trialId}:answer`;
  await append(
    judgeFixtureAction({
      trialId,
      actionId: answerActionId,
      expectedStateVersion: 6,
      actor: ACTORS.rina,
      source: "deterministic",
      causationId: `event:${requestActionId}`,
      type: "ANSWER_QUESTION",
      payload: {
        responseId,
        questionId,
        witnessId: ACTORS.rina.witnessId,
        testimonyId: JUDGE_STRIKE_TESTIMONY_ID,
        turnId: `turn:${trialId}:answer`,
        text: "I sent the complaint.",
        factIds: [JUDGE_STRIKE_FACT_ID],
        evidenceIds: [],
      },
      responseId,
    }),
  );
  const motionActionId = `action:${trialId}:motion`;
  const motionId = `motion:${trialId}`;
  await append(
    judgeFixtureAction({
      trialId,
      actionId: motionActionId,
      expectedStateVersion: 7,
      actor: ACTORS.opposingCounsel,
      source: "user",
      causationId: `event:${answerActionId}`,
      type: "MOVE_TO_STRIKE",
      payload: {
        motionId,
        testimonyIds: [JUDGE_STRIKE_TESTIMONY_ID],
        reason: "The response exceeded the permitted scope.",
        speech: {
          turnId: `turn:${trialId}:motion`,
          text: "Move to strike the response.",
          citations: {
            factIds: [],
            evidenceIds: [],
            testimonyIds: [JUDGE_STRIKE_TESTIMONY_ID],
            eventIds: [],
            sourceSegmentIds: [],
          },
        },
      },
    }),
  );
  return {
    backend,
    trialId,
    motionId,
    motionEventId: `event:${motionActionId}`,
  };
}

function judgeStrikeOutput(
  ruling: "granted" | "denied",
): JudgeRoleResponseModelOutput {
  return JudgeRoleResponseModelOutputSchema.parse({
    schemaVersion: JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
    speechSegments: [
      {
        text:
          ruling === "granted"
            ? "The motion to strike is granted."
            : "The motion to strike is denied.",
        citations: {
          factIds: [],
          evidenceIds: [],
          testimonyIds: [JUDGE_STRIKE_TESTIMONY_ID],
          transcriptTurnIds: [],
          sourceSegmentIds: [],
          priorStatementIds: [],
          issueIds: [],
          instructionIds: [],
          ruleIds: [],
          settlementOfferIds: [],
        },
      },
    ],
    proposedAction: {
      kind: "rule_on_strike_motion",
      ruling,
      reason:
        ruling === "granted"
          ? "The challenged response exceeded the permitted scope."
          : "The challenged response remained within the permitted scope.",
    },
    performance: {
      activity: "ruling",
      emotion: "neutral",
      intensity: 0.5,
      gazeTarget: "questioning_counsel",
      gesture: "gavel",
      speakingStyle: "formal",
    },
  });
}

function judgeStrikeGeneration(input: Readonly<{
  trialId: string;
  motionEventId: string;
  ruling: "granted" | "denied";
  output?: JudgeRoleResponseModelOutput;
}>): HearingJudgeResponsePrecommit {
  const output = input.output ?? judgeStrikeOutput(input.ruling);
  const outputHash = hashJudgeResponseModelOutput(output);
  const citations = judgeResponseOutputCitations(output);
  const outputCharacterCount = JSON.stringify(output).length;
  const proposedCitationCount = output.speechSegments.reduce(
    (total, segment) =>
      total +
      Object.values(segment.citations).reduce(
        (segmentTotal, identifiers) => segmentTotal + identifiers.length,
        0,
      ),
    0,
  );
  const callId = `call:${input.trialId}:judge`;
  const decisionId = `decision:${input.trialId}:judge`;
  const providerRequestId = `request:${input.trialId}:judge`;
  const completedAt = "2026-07-19T06:00:08.700Z";
  const usage = {
    inputTokens: 420,
    outputTokens: 58,
    totalTokens: 478,
    cachedInputTokens: 180,
    cacheWriteTokens: 0,
    reasoningTokens: 10,
  };
  return HearingJudgeResponsePrecommitSchema.parse({
    schemaVersion: HEARING_JUDGE_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: input.trialId,
    callId,
    decisionId,
    expectedStateVersion: 8,
    expectedLastEventId: input.motionEventId,
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId: providerRequestId,
      promptVersion: "role-responder.judge.prompt.v1",
      schemaVersion: JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      latencyMs: 600,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: 0.001,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId,
      trialId: input.trialId,
      responseId: null,
      actorId: ACTORS.judge.actorId,
      actorRole: "judge",
      callClass: "role_responder",
      task: "judge_response",
      inputEventIds: [input.motionEventId],
      expectedStateVersion: 8,
      expectedLastEventId: input.motionEventId,
      provider: "openai",
      model: "gpt-5.6-luna",
      providerProtocolVersion: "responses-api.v1",
      promptVersion: "role-responder.judge.prompt.v1",
      outputSchemaVersion: JUDGE_ROLE_RESPONSE_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: "a".repeat(64),
        stateVersion: 8,
        factCount: 1,
        evidenceCount: 0,
        testimonyCount: 1,
        priorStatementCount: 0,
        sourceSegmentCount: 0,
        publicRecordEventCount: 8,
        currentExchangeCount: 1,
      },
      promptAudit: {
        stablePrefixHash: "b".repeat(64),
        trustedContextHash: "c".repeat(64),
        untrustedInputHash: "d".repeat(64),
        inputCharacterCount: 1_000,
      },
      status: "accepted",
      startedAt: "2026-07-19T06:00:08.100Z",
      completedAt,
      latencyMs: 600,
      firstStructuredDeltaMs: 190,
      firstAcceptedSegmentMs: 360,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd: 0.001,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: citations,
      acceptedCitationCount: Object.values(citations).reduce(
        (total, identifiers) => total + identifiers.length,
        0,
      ),
      outputHash,
      outputCharacterCount,
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
      attempts: [
        {
          schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
          attempt: 1,
          mode: "initial",
          status: "accepted",
          providerRequestId,
          providerResponseId: `response:${input.trialId}:judge`,
          startedAt: "2026-07-19T06:00:08.100Z",
          completedAt,
          latencyMs: 600,
          firstStructuredDeltaMs: 190,
          streamEventCount: 9,
          structuredDeltaCount: 3,
          streamedCharacterCount: outputCharacterCount,
          outputHash,
          proposedCitationCount,
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

function generatedJudgeStrikeAction(
  generation: HearingJudgeResponsePrecommit,
): Extract<TrialActionV3, { type: "STRIKE_TESTIMONY" | "DENY_STRIKE_MOTION" }> {
  const material = {
    trialId: generation.trialId,
    decisionId: generation.decisionId,
  };
  const digest = sha256Utf8(JSON.stringify(material));
  const actionId = `action:judge-strike-ruling:${digest}`;
  const text = generation.output.speechSegments
    .map((segment) => segment.text)
    .join(" ");
  const citations = judgeResponseOutputCitations(generation.output);
  const speech = {
    turnId: `turn:judge-strike-ruling:${digest}`,
    text,
    citations: {
      factIds: citations.factIds,
      evidenceIds: citations.evidenceIds,
      testimonyIds: citations.testimonyIds,
      eventIds: citations.eventIds,
      sourceSegmentIds: citations.sourceSegmentIds,
    },
  };
  const common = {
    trialId: generation.trialId,
    actionId,
    expectedStateVersion: generation.expectedStateVersion,
    actor: ACTORS.judge,
    source: "ai" as const,
    causationId: generation.expectedLastEventId,
    requestedAt: generation.trace.completedAt ?? undefined,
    modelMetadata: generation.modelMetadata,
  };
  const proposed = generation.output.proposedAction;
  if (proposed.kind !== "rule_on_strike_motion") {
    throw new Error("Judge strike fixture requires a strike ruling");
  }
  if (proposed.ruling === "granted") {
    return judgeFixtureAction({
      ...common,
      type: "STRIKE_TESTIMONY",
      payload: {
        motionId: `motion:${generation.trialId}`,
        testimonyIds: [JUDGE_STRIKE_TESTIMONY_ID],
        factIds: [JUDGE_STRIKE_FACT_ID],
        speech,
      },
    }) as Extract<TrialActionV3, { type: "STRIKE_TESTIMONY" }>;
  }
  return judgeFixtureAction({
    ...common,
    type: "DENY_STRIKE_MOTION",
    payload: {
      motionId: `motion:${generation.trialId}`,
      reason: proposed.reason,
      speech,
    },
  }) as Extract<TrialActionV3, { type: "DENY_STRIKE_MOTION" }>;
}

async function appendJudgeResponse(
  backend: TestBackend,
  trialAction: TrialActionV3,
  generation: HearingJudgeResponsePrecommit,
): Promise<Receipt> {
  return await backend.mutation(appendJudgeResponseForOwnerReference, {
    ownerId: OWNER_ID,
    actionJson: JSON.stringify(trialAction),
    generationJson: JSON.stringify(generation),
    writeSnapshot: true,
  });
}

describe("owner-bound trial event persistence", () => {
  it("returns only a complete owner-bound byte-stable canonical replay", async () => {
    const { backend } = await setup();
    const trialId = "trial:canonical-record-audit";
    await backend.mutation(createForOwnerReference, {
      ownerId: OWNER_ID,
      ...createArgs(trialId),
    });
    const first = await backend.query(canonicalAuditForOwnerReference, {
      ownerId: OWNER_ID,
      trialId,
    });
    const second = await backend.query(canonicalAuditForOwnerReference, {
      ownerId: OWNER_ID,
      trialId,
    });
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      trialId,
      graphId: GRAPH_ID,
      stateVersion: 1,
      lastSequence: 1,
      lastEventId: `event:action:${trialId}:start`,
    });
    expect(first.eventJsons).toHaveLength(1);
    expect(first.stateSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.eventStreamSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(
      backend.query(canonicalAuditForOwnerReference, {
        ownerId: OTHER_OWNER_ID,
        trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
  });

  it("creates, reloads, and appends only for the authenticated owner", async () => {
    const { backend, owner, otherOwner } = await setup();
    const trialId = "trial:owner-bound";

    await expect(
      backend.mutation(createReference, createArgs(trialId)),
    ).rejects.toThrow("AUTHENTICATION_REQUIRED");

    const created = await owner.mutation(createReference, createArgs(trialId));
    expect(created).toMatchObject({
      committedStateVersion: 1,
      firstSequence: 1,
      lastSequence: 1,
      replayed: false,
    });
    await expect(
      reloadOwned(backend, { ownerId: OTHER_OWNER_ID, trialId }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      otherOwner.mutation(appendReference, {
        actionJson: JSON.stringify(
          settlementAction(trialId, "action:other-owner", 1),
        ),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");

    await expect(
      owner.mutation(appendReference, {
        actionJson: JSON.stringify(forgedJudgeAction(trialId)),
      }),
    ).rejects.toThrow("PLAYER_ACTION_NOT_PERMITTED");

    const action = settlementAction(
      trialId,
      "action:owner-bound:settlement",
      1,
    );
    const appended = await owner.mutation(appendReference, {
      actionJson: JSON.stringify(action),
    });
    expect(appended).toMatchObject({
      committedStateVersion: 2,
      firstSequence: 2,
      lastSequence: 2,
      replayed: false,
    });

    const reload = await reloadOwned(backend, { trialId });
    expect(reload).toMatchObject({
      trialId,
      graphId: GRAPH_ID,
      stateVersion: 2,
      lastSequence: 2,
      stateSchemaVersion: "trial-state.v3",
      eventSchemaVersion: "trial-event.v3",
      validated: true,
      requiresMigration: false,
      snapshot: { lastSequence: 1, stateSchemaVersion: "trial-state.v3" },
      events: [{ sequence: 2, eventSchemaVersion: "trial-event.v3" }],
      hasMore: false,
      nextAfterSequence: null,
    });
    expect(TrialStateV3Schema.parse(JSON.parse(reload.stateJson))).toMatchObject({
      version: 2,
      lastSequence: 2,
      phase: "pretrial",
      settlementOffers: {
        "offer:action:owner-bound:settlement": { status: "open" },
      },
    });
    const delta = await reloadOwned(backend, {
      trialId,
      afterSequence: 1,
    });
    expect(delta).toMatchObject({
      snapshot: null,
      events: [{ sequence: 2 }],
      hasMore: false,
    });

    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) => index.eq("trialId", trialId))
        .collect(),
      projections: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", trialId))
        .collect(),
    }));
    expect(stored.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(stored.projections).toHaveLength(1);
    expect(stored.projections[0]).toMatchObject({
      ownerId: OWNER_ID,
      graphId: GRAPH_ID,
      stateVersion: 2,
      lastSequence: 2,
    });
  });

  it("retains owner and player/trusted guards through the server facade", async () => {
    const { backend } = await setup();
    const trialId = "trial:server-owner-facade";
    const created = await backend.mutation(createForOwnerReference, {
      ownerId: OWNER_ID,
      ...createArgs(trialId),
    });
    expect(created).toMatchObject({
      trialId,
      committedStateVersion: 1,
      replayed: false,
    });

    await expect(
      backend.query(reloadForOwnerReference, {
        ownerId: OTHER_OWNER_ID,
        trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.mutation(appendPlayerForOwnerReference, {
        ownerId: OTHER_OWNER_ID,
        actionJson: JSON.stringify(
          settlementAction(trialId, "action:server-other-owner", 1),
        ),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.mutation(appendTrustedForOwnerReference, {
        ownerId: OTHER_OWNER_ID,
        actionJson: JSON.stringify(forgedJudgeAction(trialId)),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");
    await expect(
      backend.mutation(appendPlayerForOwnerReference, {
        ownerId: OWNER_ID,
        actionJson: JSON.stringify(forgedJudgeAction(trialId)),
      }),
    ).rejects.toThrow("PLAYER_ACTION_NOT_PERMITTED");

    const player = await backend.mutation(appendPlayerForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify(
        settlementAction(trialId, "action:server-owner-player", 1),
      ),
    });
    expect(player).toMatchObject({ committedStateVersion: 2 });
    const trusted = await backend.mutation(appendTrustedForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify({
        ...forgedJudgeAction(trialId),
        expectedStateVersion: 2,
        causationId: player.eventIds[0],
      }),
    });
    expect(trusted).toMatchObject({ committedStateVersion: 3 });

    await expect(
      backend.query(reloadForOwnerReference, { ownerId: OWNER_ID, trialId }),
    ).resolves.toMatchObject({
      trialId,
      stateVersion: 3,
      lastSequence: 3,
      validated: true,
    });
  });

  it("preserves an offset event timestamp across storage and replay", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:offset-timestamp";
    await owner.mutation(createReference, createArgs(trialId));
    const requestedAt = "2026-07-19T07:15:23+05:30";
    const action = TrialActionV3Schema.parse({
      ...settlementAction(trialId, "action:offset-timestamp", 1),
      requestedAt,
    });

    await owner.mutation(appendReference, {
      actionJson: JSON.stringify(action),
    });
    const reload = await reloadOwned(backend, { trialId });
    expect(
      TrialStateV3Schema.parse(JSON.parse(reload.stateJson)).updatedAt,
    ).toBe(requestedAt);
    const storedTimestamp = await backend.run(async (ctx) =>
      (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", trialId),
          )
          .order("desc")
          .first()
      )?.occurredAtIso,
    );
    expect(storedTimestamp).toBe(requestedAt);
  });

  it("hands a mismatched payload schema version to migration", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:payload-version-mismatch";
    await owner.mutation(createReference, createArgs(trialId));
    await owner.mutation(appendReference, {
      actionJson: JSON.stringify(
        settlementAction(trialId, "action:payload-version-mismatch", 1),
      ),
    });
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", trialId).eq("sequence", 2),
        )
        .unique();
      if (!row) throw new Error("Missing appended event fixture");
      await ctx.db.patch(row._id, {
        payloadSchemaVersion: "trial-action.v2",
      });
    });

    await expect(reloadOwned(backend, { trialId })).resolves.toMatchObject({
      validated: false,
      requiresMigration: true,
    });
  });

  it("requires a published graph owned by the caller", async () => {
    const { backend, owner } = await setup();
    await insertGraph(backend, {
      graphId: OTHER_GRAPH_ID,
      ownerId: OTHER_OWNER_ID,
    });
    await insertGraph(backend, {
      graphId: DRAFT_GRAPH_ID,
      ownerId: OWNER_ID,
      lifecycle: "draft",
    });

    await expect(
      owner.mutation(
        createReference,
        createArgs("trial:other-graph", "action:other-graph", OTHER_GRAPH_ID),
      ),
    ).rejects.toThrow("CASE_GRAPH_NOT_FOUND");
    await expect(
      owner.mutation(
        createReference,
        createArgs("trial:draft-graph", "action:draft-graph", DRAFT_GRAPH_ID),
      ),
    ).rejects.toThrow("CASE_GRAPH_NOT_FOUND");
  });

  it("keeps judge and generated actors behind the trusted internal boundary", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:trusted-actor";
    await owner.mutation(createReference, createArgs(trialId));
    const action = forgedJudgeAction(trialId);

    await expect(
      owner.mutation(appendReference, {
        actionJson: JSON.stringify(action),
      }),
    ).rejects.toThrow("PLAYER_ACTION_NOT_PERMITTED");

    await expect(
      backend.mutation(appendTrustedReference, {
        actionJson: JSON.stringify(action),
      }),
    ).resolves.toMatchObject({
      committedStateVersion: 2,
      firstSequence: 2,
      lastSequence: 2,
      replayed: false,
    });
    const reloaded = await reloadOwned(backend, { trialId });
    expect(TrialStateV3Schema.parse(JSON.parse(reloaded.stateJson))).toMatchObject(
      { phase: "opening", version: 2, lastSequence: 2 },
    );
  });

  it("returns the same receipt for exact retries without duplicate writes", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:idempotent";
    const creation = createArgs(trialId);
    const firstCreate = await owner.mutation(createReference, creation);
    const secondCreate = await owner.mutation(createReference, creation);
    expect(firstCreate.replayed).toBe(false);
    expect(secondCreate).toEqual({ ...firstCreate, replayed: true });

    const action = settlementAction(
      trialId,
      "action:idempotent:settlement",
      1,
    );
    const firstAppend = await owner.mutation(appendReference, {
      actionJson: JSON.stringify(action),
    });
    await expect(
      owner.mutation(appendReference, {
        actionJson: JSON.stringify(
          settlementAction(
            trialId,
            "action:idempotent:settlement",
            1,
            95_000,
          ),
        ),
      }),
    ).rejects.toThrow("ACTION_ID_CONFLICT");
    const secondAppend = await owner.mutation(appendReference, {
      actionJson: JSON.stringify(action),
    });
    expect(firstAppend.replayed).toBe(false);
    expect(secondAppend).toEqual({ ...firstAppend, replayed: true });

    const counts = await backend.run(async (ctx) => ({
      events: (await ctx.db.query("trialEvents").collect()).length,
      receipts: (await ctx.db.query("actionReceipts").collect()).length,
      projections: (await ctx.db.query("trialProjections").collect()).length,
      snapshots: (await ctx.db.query("trialSnapshots").collect()).length,
    }));
    expect(counts).toEqual({
      events: 2,
      receipts: 2,
      projections: 1,
      snapshots: 1,
    });
  });

  it("serializes competing expected versions so one action wins atomically", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:concurrency";
    await owner.mutation(createReference, createArgs(trialId));

    const competitors = [
      settlementAction(trialId, "action:concurrency:a", 1),
      settlementAction(trialId, "action:concurrency:b", 1),
    ];
    const results = await Promise.allSettled(
      competitors.map((action) =>
        owner.mutation(appendReference, {
          actionJson: JSON.stringify(action),
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain("STALE_STATE_VERSION:1:2");

    const persisted = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) => index.eq("trialId", trialId))
        .collect(),
      receipts: await ctx.db
        .query("actionReceipts")
        .withIndex("by_trial_version", (index) => index.eq("trialId", trialId))
        .collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", trialId))
        .unique(),
    }));
    expect(persisted.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(persisted.receipts).toHaveLength(2);
    expect(persisted.projection).toMatchObject({
      stateVersion: 2,
      lastSequence: 2,
    });
  });

  it("rejects a projection that does not match its snapshot and event suffix", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:projection-integrity";
    await owner.mutation(createReference, createArgs(trialId));
    await backend.run(async (ctx) => {
      const projection = await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) => index.eq("trialId", trialId))
        .unique();
      if (!projection) throw new Error("TEST_PROJECTION_MISSING");
      const state = JSON.parse(projection.stateJson) as Record<string, unknown>;
      await ctx.db.patch(projection._id, {
        stateJson: JSON.stringify({ ...state, phase: "closing" }),
      });
    });

    await expect(
      reloadOwned(backend, { trialId }),
    ).rejects.toThrow("TRIAL_PROJECTION_MISMATCH");
    await expect(
      owner.mutation(appendReference, {
        actionJson: JSON.stringify(
          settlementAction(
            trialId,
            "action:projection-integrity:settlement",
            1,
          ),
        ),
      }),
    ).rejects.toThrow("TRIAL_PROJECTION_MISMATCH");
    const counts = await backend.run(async (ctx) => ({
      events: (await ctx.db.query("trialEvents").collect()).length,
      receipts: (await ctx.db.query("actionReceipts").collect()).length,
    }));
    expect(counts).toEqual({ events: 1, receipts: 1 });
  });

  it("rejects a stored event whose envelope no longer matches its action", async () => {
    const { backend, owner } = await setup();
    const trialId = "trial:event-integrity";
    await owner.mutation(createReference, createArgs(trialId));
    await owner.mutation(appendReference, {
      actionJson: JSON.stringify(
        settlementAction(trialId, "action:event-integrity:settlement", 1),
      ),
    });
    await backend.run(async (ctx) => {
      const event = await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", trialId).eq("sequence", 2),
        )
        .unique();
      if (!event) throw new Error("TEST_EVENT_NOT_FOUND");
      await ctx.db.patch(event._id, { factIds: ["fact_tampered"] });
    });

    await expect(
      reloadOwned(backend, { trialId }),
    ).rejects.toThrow("TRIAL_EVENT_ENVELOPE_MISMATCH");
  });

  it("returns legacy rows for migration without rewriting them", async () => {
    const { backend } = await setup();
    const trialId = "trial:legacy-v2";
    await backend.run(async (ctx) => {
      await ctx.db.insert("trialEvents", {
        eventId: "event:legacy-v2:start",
        trialId,
        sequence: 1,
        stateVersion: 1,
        actionId: "action:legacy-v2:start",
        eventType: "START_TRIAL",
        actorId: ACTORS.system.actorId,
        actorRole: ACTORS.system.role,
        actorSide: ACTORS.system.side,
        source: "system",
        payloadJson: JSON.stringify({ legacy: true }),
        payloadSchemaVersion: "trial-action.v2",
        eventSchemaVersion: "trial-event.v2",
        factIds: [],
        evidenceIds: [],
        testimonyIds: [],
        citationEventIds: [],
        sourceSegmentIds: [],
        turnIds: [],
        occurredAt: STARTED_AT,
        committedAt: STARTED_AT,
      });
      await ctx.db.insert("trialProjections", {
        projectionId: `projection:${trialId}`,
        trialId,
        ownerId: OWNER_ID,
        graphId: GRAPH_ID,
        stateVersion: 1,
        lastSequence: 1,
        stateJson: JSON.stringify({ schemaVersion: "trial-state.v2", legacy: true }),
        stateSchemaVersion: "trial-state.v2",
        eventSchemaVersion: "trial-event.v2",
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      });
    });

    const reload = await reloadOwned(backend, { trialId });
    expect(reload).toMatchObject({
      validated: false,
      requiresMigration: true,
      stateSchemaVersion: "trial-state.v2",
      eventSchemaVersion: "trial-event.v2",
      snapshot: null,
      events: [{
        eventId: "event:legacy-v2:start",
        sequence: 1,
        eventSchemaVersion: "trial-event.v2",
      }],
    });
    const after = await backend.run(async (ctx) => ({
      eventCount: (await ctx.db.query("trialEvents").collect()).length,
      projectionCount: (await ctx.db.query("trialProjections").collect()).length,
      eventVersion: (await ctx.db.query("trialEvents").first())?.eventSchemaVersion,
      stateVersion: (await ctx.db.query("trialProjections").first())?.stateSchemaVersion,
    }));
    expect(after).toEqual({
      eventCount: 1,
      projectionCount: 1,
      eventVersion: "trial-event.v2",
      stateVersion: "trial-state.v2",
    });
  });
});

describe("atomic generated judge-response append", () => {
  it.each(["granted", "denied"] as const)(
    "commits and exactly replays a %s strike ruling with its terminal trace",
    async (ruling) => {
      const fixture = await setupPendingJudgeStrikeMotion(ruling);
      const generation = judgeStrikeGeneration({
        trialId: fixture.trialId,
        motionEventId: fixture.motionEventId,
        ruling,
      });
      const trialAction = generatedJudgeStrikeAction(generation);

      const first = await appendJudgeResponse(
        fixture.backend,
        trialAction,
        generation,
      );
      expect(first).toMatchObject({
        trialId: fixture.trialId,
        actionId: trialAction.actionId,
        committedStateVersion: 9,
        firstSequence: 9,
        lastSequence: 9,
        replayed: false,
      });
      const replay = await appendJudgeResponse(
        fixture.backend,
        trialAction,
        generation,
      );
      expect(replay).toEqual({ ...first, replayed: true });

      const persisted = await fixture.backend.run(async (ctx) => ({
        events: await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", fixture.trialId),
          )
          .collect(),
        receipts: await ctx.db
          .query("actionReceipts")
          .withIndex("by_trial_version", (index) =>
            index.eq("trialId", fixture.trialId),
          )
          .collect(),
        projection: await ctx.db
          .query("trialProjections")
          .withIndex("by_trial", (index) =>
            index.eq("trialId", fixture.trialId),
          )
          .unique(),
        calls: await ctx.db
          .query("courtroomModelCalls")
          .withIndex("by_call_id", (index) =>
            index.eq("callId", generation.callId),
          )
          .collect(),
        attempts: await ctx.db
          .query("courtroomModelCallAttempts")
          .withIndex("by_call_attempt", (index) =>
            index.eq("callId", generation.callId),
          )
          .collect(),
        performances: await ctx.db
          .query("courtroomCommittedPerformances")
          .withIndex("by_performance_id", (index) =>
            index.eq("performanceId", first.eventIds[0] ?? "missing"),
          )
          .collect(),
        snapshots: await ctx.db
          .query("trialSnapshots")
          .withIndex("by_trial_version", (index) =>
            index.eq("trialId", fixture.trialId),
          )
          .collect(),
      }));
      expect(persisted.events).toHaveLength(9);
      expect(persisted.receipts).toHaveLength(9);
      expect(persisted.calls).toHaveLength(1);
      expect(persisted.attempts).toHaveLength(1);
      expect(persisted.performances).toHaveLength(1);
      expect(persisted.snapshots.at(-1)).toMatchObject({ stateVersion: 9 });
      expect(persisted.projection).toMatchObject({
        ownerId: OWNER_ID,
        stateVersion: 9,
        lastSequence: 9,
      });
      const state = TrialStateV3Schema.parse(
        JSON.parse(persisted.projection?.stateJson ?? "null"),
      );
      expect(state.strikeMotions[fixture.motionId]).toMatchObject({
        status: ruling,
        rulingEventId: first.eventIds[0],
      });
      expect(state.testimony[JUDGE_STRIKE_TESTIMONY_ID]?.status).toBe(
        ruling === "granted" ? "stricken" : "active",
      );
      const rulingEvents = persisted.events.filter(
        (event) => event.actionId === trialAction.actionId,
      );
      expect(rulingEvents).toHaveLength(1);
      expect(rulingEvents[0]).toMatchObject({
        eventId: first.eventIds[0],
        eventType:
          ruling === "granted"
            ? "STRIKE_TESTIMONY"
            : "DENY_STRIKE_MOTION",
        actorId: ACTORS.judge.actorId,
        source: "ai",
      });
      expect(JSON.parse(rulingEvents[0]?.payloadJson ?? "null")).toMatchObject({
        motionId: fixture.motionId,
        speech: {
          turnId: expect.stringContaining("turn:judge-strike-ruling:"),
          text: generation.output.speechSegments[0]?.text,
          citations: {
            testimonyIds: [JUDGE_STRIKE_TESTIMONY_ID],
          },
        },
      });
      expect(
        CourtroomModelCallTraceSchema.parse(
          JSON.parse(persisted.calls[0]?.traceJson ?? "null"),
        ),
      ).toMatchObject({
        callId: generation.callId,
        status: "accepted",
        committedActionId: trialAction.actionId,
        committedEventId: first.eventIds[0],
      });
      expect(
        HearingCommittedPerformanceSchema.parse(
          JSON.parse(persisted.performances[0]?.performanceJson ?? "null"),
        ),
      ).toMatchObject({
        kind: "judge_response",
        head: {
          trialId: fixture.trialId,
          stateVersion: 9,
          lastEventId: first.eventIds[0],
        },
        source: {
          callId: generation.callId,
          actionId: trialAction.actionId,
          eventId: first.eventIds[0],
          turnId: expect.stringContaining("turn:judge-strike-ruling:"),
        },
        actor: ACTORS.judge,
        semantic: generation.output.performance,
      });
    },
  );

  it.each([
    ["fact", "factIds", JUDGE_STRIKE_FACT_ID],
    ["evidence", "evidenceIds", "evidence_unrelated"],
    ["testimony", "testimonyIds", "testimony:unrelated"],
    ["source", "sourceSegmentIds", "source_segment_unrelated"],
    ["prior statement", "priorStatementIds", "prior_statement_unrelated"],
  ] as const)(
    "rejects a strike ruling with an extra %s citation",
    async (_label, citationField, citationId) => {
      const fixture = await setupPendingJudgeStrikeMotion("granted");
      const baseOutput = judgeStrikeOutput("granted");
      const speechSegment = baseOutput.speechSegments[0];
      if (speechSegment === undefined) {
        throw new Error("Judge strike fixture requires one speech segment");
      }
      const output = JudgeRoleResponseModelOutputSchema.parse({
        ...baseOutput,
        speechSegments: [
          {
            ...speechSegment,
            citations: {
              ...speechSegment.citations,
              [citationField]: [
                ...speechSegment.citations[citationField],
                citationId,
              ],
            },
          },
        ],
      });
      const generation = judgeStrikeGeneration({
        trialId: fixture.trialId,
        motionEventId: fixture.motionEventId,
        ruling: "granted",
        output,
      });
      const trialAction = generatedJudgeStrikeAction(generation);

      await expect(
        appendJudgeResponse(fixture.backend, trialAction, generation),
      ).rejects.toThrow("JUDGE_GENERATION_INVALID");

      const persisted = await fixture.backend.run(async (ctx) => ({
        events: await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", fixture.trialId),
          )
          .collect(),
        calls: await ctx.db.query("courtroomModelCalls").collect(),
        attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
      }));
      expect(persisted.events).toHaveLength(8);
      expect(persisted.calls).toHaveLength(0);
      expect(persisted.attempts).toHaveLength(0);
    },
  );

  it("rejects a ruling replay when its terminal trace row is absent", async () => {
    const fixture = await setupPendingJudgeStrikeMotion("granted");
    const generation = judgeStrikeGeneration({
      trialId: fixture.trialId,
      motionEventId: fixture.motionEventId,
      ruling: "granted",
    });
    const trialAction = generatedJudgeStrikeAction(generation);
    await appendJudgeResponse(fixture.backend, trialAction, generation);

    await fixture.backend.run(async (ctx) => {
      const call = await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", generation.callId),
        )
        .unique();
      if (call === null) throw new Error("Expected persisted judge trace");
      const attempts = await ctx.db
        .query("courtroomModelCallAttempts")
        .withIndex("by_call_attempt", (index) =>
          index.eq("callId", generation.callId),
        )
        .collect();
      for (const attempt of attempts) await ctx.db.delete(attempt._id);
      await ctx.db.delete(call._id);
    });

    await expect(
      appendJudgeResponse(fixture.backend, trialAction, generation),
    ).rejects.toThrow("JUDGE_GENERATION_INVALID");

    const persisted = await fixture.backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", fixture.trialId),
        )
        .collect(),
      receipts: await ctx.db
        .query("actionReceipts")
        .withIndex("by_trial_version", (index) =>
          index.eq("trialId", fixture.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
    }));
    expect(persisted.events).toHaveLength(9);
    expect(persisted.receipts).toHaveLength(9);
    expect(persisted.calls).toHaveLength(0);
    expect(persisted.attempts).toHaveLength(0);
  });

  it("rejects a ruling replay when its terminal trace differs", async () => {
    const fixture = await setupPendingJudgeStrikeMotion("granted");
    const generation = judgeStrikeGeneration({
      trialId: fixture.trialId,
      motionEventId: fixture.motionEventId,
      ruling: "granted",
    });
    const trialAction = generatedJudgeStrikeAction(generation);
    await appendJudgeResponse(fixture.backend, trialAction, generation);

    const tamperedTraceJson = await fixture.backend.run(async (ctx) => {
      const call = await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", generation.callId),
        )
        .unique();
      if (call === null) throw new Error("Expected persisted judge trace");
      const trace = CourtroomModelCallTraceSchema.parse(
        JSON.parse(call.traceJson),
      );
      const tamperedTrace = CourtroomModelCallTraceSchema.parse({
        ...trace,
        knowledgeScope: {
          ...trace.knowledgeScope,
          knowledgeViewHash: "e".repeat(64),
        },
      });
      const traceJson = JSON.stringify(tamperedTrace);
      await ctx.db.patch(call._id, { traceJson });
      return traceJson;
    });

    await expect(
      appendJudgeResponse(fixture.backend, trialAction, generation),
    ).rejects.toThrow("JUDGE_GENERATION_INVALID");

    const persisted = await fixture.backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", fixture.trialId),
        )
        .collect(),
      calls: await ctx.db
        .query("courtroomModelCalls")
        .withIndex("by_call_id", (index) =>
          index.eq("callId", generation.callId),
        )
        .collect(),
      attempts: await ctx.db
        .query("courtroomModelCallAttempts")
        .withIndex("by_call_attempt", (index) =>
          index.eq("callId", generation.callId),
        )
        .collect(),
    }));
    expect(persisted.events).toHaveLength(9);
    expect(persisted.calls).toHaveLength(1);
    expect(persisted.calls[0]?.traceJson).toBe(tamperedTraceJson);
    expect(persisted.attempts).toHaveLength(1);
  });

  it("rejects a stale generated head without appending a ruling or trace", async () => {
    const fixture = await setupPendingJudgeStrikeMotion("granted");
    const generation = judgeStrikeGeneration({
      trialId: fixture.trialId,
      motionEventId: fixture.motionEventId,
      ruling: "granted",
    });
    const trialAction = generatedJudgeStrikeAction(generation);
    const staleLastEventId = `event:${fixture.trialId}:stale-head`;
    const staleGeneration = HearingJudgeResponsePrecommitSchema.parse({
      ...generation,
      expectedLastEventId: staleLastEventId,
      trace: {
        ...generation.trace,
        inputEventIds: [staleLastEventId],
        expectedLastEventId: staleLastEventId,
      },
    });

    await expect(
      appendJudgeResponse(
        fixture.backend,
        trialAction,
        staleGeneration,
      ),
    ).rejects.toThrow("JUDGE_GENERATION_STALE");

    const persisted = await fixture.backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", fixture.trialId),
        )
        .collect(),
      receipts: await ctx.db
        .query("actionReceipts")
        .withIndex("by_trial_version", (index) =>
          index.eq("trialId", fixture.trialId),
        )
        .collect(),
      projection: await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", fixture.trialId),
        )
        .unique(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
      snapshots: await ctx.db
        .query("trialSnapshots")
        .withIndex("by_trial_version", (index) =>
          index.eq("trialId", fixture.trialId),
        )
        .collect(),
    }));
    expect(persisted.events).toHaveLength(8);
    expect(persisted.receipts).toHaveLength(8);
    expect(
      persisted.events.some((event) => event.actionId === trialAction.actionId),
    ).toBe(false);
    expect(persisted.calls).toHaveLength(0);
    expect(persisted.attempts).toHaveLength(0);
    expect(persisted.snapshots).toHaveLength(1);
    expect(persisted.projection).toMatchObject({
      stateVersion: 8,
      lastSequence: 8,
    });
  });
});
