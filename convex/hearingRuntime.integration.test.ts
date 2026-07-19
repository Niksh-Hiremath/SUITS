import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
  sha256Utf8,
} from "../src/domain/case-graph";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
  CourtroomModelCallTraceSchema,
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WitnessAnswerModelOutputSchema,
} from "../src/domain/courtroom-ai";
import {
  HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingRuntimeViewV1Schema,
  HearingWitnessGenerationPrecommitSchema,
  hashWitnessAnswerModelOutput,
  isHearingWitnessModelRequiredPreparation,
  witnessAnswerOutputCitations,
  type HearingCommandPreparation,
  type HearingPlayerIntent,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionV3Schema,
  TrialStateV3Schema,
} from "../src/domain/trial-engine";
import { derivePublishedGraphId } from "./caseServiceBoundary";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./hearingRuntime.ts": () => import("./hearingRuntime"),
  "./courtroomModelCalls.ts": () => import("./courtroomModelCalls"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

type TestBackend = TestConvex<typeof schema>;

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";
const START_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const startReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; requestJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:start");
const commandReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; commandJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:command");
const prepareCommandReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; commandJson: string }>,
  HearingCommandPreparation
>("hearingRuntime:prepareCommand");
const commitWitnessGenerationReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; generationJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:commitWitnessGeneration");
const readReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:read");
const appendPlayerForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{ ownerId: string; actionJson: string }>,
  Readonly<{ committedStateVersion: number; replayed: boolean }>
>("trialEvents:appendPlayerForOwner");
const appendTrustedForOwnerReference = makeFunctionReference<
  "mutation",
  Readonly<{
    ownerId: string;
    actionJson: string;
    writeSnapshot?: boolean;
  }>,
  Readonly<{ committedStateVersion: number; replayed: boolean }>
>("trialEvents:appendTrustedForOwner");

function startRequest() {
  return {
    schemaVersion: HEARING_START_SCHEMA_VERSION,
    requestId: START_REQUEST_ID,
    requestedAt: "2026-07-19T03:00:00.000Z",
    case: { kind: "seeded", slug: "redwood-signal-retaliation" },
    userSide: "user",
  } as const;
}

function playerCommand(
  view: HearingRuntimeViewV1,
  requestId: string,
  requestedAt: string,
  intent: HearingPlayerIntent,
) {
  return {
    schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
    requestId,
    requestedAt,
    expectedStateVersion: view.trial.version,
    expectedLastEventId: view.trial.lastEventId,
    intent,
  } as const;
}

async function start(backend: TestBackend) {
  return HearingRuntimeViewV1Schema.parse(
    await backend.action(startReference, {
      ownerId: OWNER_ID,
      requestJson: JSON.stringify(startRequest()),
    }),
  );
}

async function command(
  backend: TestBackend,
  view: HearingRuntimeViewV1,
  requestId: string,
  requestedAt: string,
  intent: HearingPlayerIntent,
) {
  const request = playerCommand(view, requestId, requestedAt, intent);
  const preparation = HearingCommandPreparationSchema.parse(
    await backend.action(prepareCommandReference, {
      ownerId: OWNER_ID,
      trialId: view.trial.trialId,
      commandJson: JSON.stringify(request),
    }),
  );
  let committedView: HearingRuntimeViewV1;
  if (preparation.status === "completed") {
    committedView = preparation.view;
  } else {
    const generation = await fakeWitnessGeneration(
      preparation,
      new Date(Date.parse(requestedAt) + 2_000).toISOString(),
    );
    committedView = HearingRuntimeViewV1Schema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
  }
  return {
    request,
    view: committedView,
  };
}

async function prepare(
  backend: TestBackend,
  view: HearingRuntimeViewV1,
  requestId: string,
  requestedAt: string,
  intent: HearingPlayerIntent,
) {
  const request = playerCommand(view, requestId, requestedAt, intent);
  return {
    request,
    preparation: HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(request),
      }),
    ),
  };
}

async function fakeWitnessGeneration(
  preparation: HearingCommandPreparation,
  startedAt: string,
): Promise<HearingWitnessGenerationPrecommit> {
  if (!isHearingWitnessModelRequiredPreparation(preparation)) {
    throw new Error("Expected witness model preparation");
  }
  const fact = preparation.request.knowledgeView.witness.facts[0];
  if (!fact) throw new Error("Fixture witness requires at least one known fact");
  const output = WitnessAnswerModelOutputSchema.parse({
    schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    disposition: "substantive",
    performance: {
      emotion: "confident",
      intensity: 0.55,
      delivery: "measured",
      gesture: "small_nod",
      gazeTarget: "questioning_counsel",
    },
    segments: [
      {
        text: "I personally observed the event described in my statement.",
        factIds: [fact.factId],
        evidenceIds: [],
        priorStatementIds: [],
      },
    ],
  });
  const request = preparation.request;
  const completedAt = new Date(Date.parse(startedAt) + 250).toISOString();
  const outputHash = hashWitnessAnswerModelOutput(output);
  const acceptedCitations = witnessAnswerOutputCitations(output);
  const outputCharacterCount = JSON.stringify(output).length;
  const proposedCitationCount = output.segments.reduce(
    (total, segment) =>
      total +
      segment.factIds.length +
      segment.evidenceIds.length +
      segment.priorStatementIds.length,
    0,
  );
  const sourceSegmentCount = new Set([
    ...request.knowledgeView.publicRecord.facts.flatMap(
      (entry) => entry.sourceSegmentIds,
    ),
    ...request.knowledgeView.publicRecord.evidence.flatMap(
      (entry) => entry.sourceSegmentIds,
    ),
  ]).size;
  const usage = {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    cachedInputTokens: 40,
    cacheWriteTokens: 0,
    reasoningTokens: 5,
  };
  const trace = CourtroomModelCallTraceSchema.parse({
    schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
    callId: request.callId,
    trialId: request.trialId,
    responseId: request.responseId,
    actorId: request.actorId,
    actorRole: "witness",
    callClass: "role_responder",
    task: "witness_answer",
    inputEventIds: [
      ...new Set([
        request.question.eventId,
        request.expectedLastEventId,
      ]),
    ].sort((left, right) => left.localeCompare(right)),
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    provider: "scripted-courtroom-model",
    model: "gpt-5.6-luna",
    providerProtocolVersion: "courtroom-model-provider.v1",
    promptVersion: "role-responder.witness-answer.prompt.v1",
    outputSchemaVersion: output.schemaVersion,
    knowledgeScope: {
      knowledgeSchemaVersion: request.knowledgeView.schemaVersion,
      knowledgeViewHash: sha256Utf8(
        JSON.stringify(request.knowledgeView),
      ),
      stateVersion: request.knowledgeView.stateVersion,
      factCount: request.knowledgeView.witness.facts.length,
      evidenceCount: new Set([
        ...request.knowledgeView.witness.admittedSeenEvidence.map(
          (evidence) => evidence.evidenceId,
        ),
        ...request.knowledgeView.presentedEvidence.map(
          (evidence) => evidence.evidenceId,
        ),
      ]).size,
      testimonyCount: request.knowledgeView.publicRecord.testimony.length,
      priorStatementCount:
        request.knowledgeView.witness.priorStatements.length,
      sourceSegmentCount,
      publicRecordEventCount: new Set(
        request.knowledgeView.publicRecord.testimony.map(
          (testimony) => testimony.transcriptEventId,
        ),
      ).size,
      currentExchangeCount:
        request.knowledgeView.currentExchange === null ? 0 : 1,
    },
    promptAudit: {
      stablePrefixHash: sha256Utf8("fake-stable-prefix"),
      trustedContextHash: sha256Utf8("fake-trusted-context"),
      untrustedInputHash: sha256Utf8("fake-untrusted-input"),
      inputCharacterCount: 60,
    },
    status: "accepted",
    startedAt,
    completedAt,
    latencyMs: 250,
    firstStructuredDeltaMs: 25,
    firstAcceptedSegmentMs: 50,
    retryCount: 0,
    validationFailureCount: 0,
    estimatedCostUsd: null,
    usage,
    acceptedAttempt: 1,
    acceptedCitations,
    acceptedCitationCount: Object.values(acceptedCitations).reduce(
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
        schemaVersion:
          COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
        attempt: 1,
        mode: "initial",
        status: "accepted",
        providerRequestId: "request:convex-witness:001",
        providerResponseId: "response:convex-witness:001",
        startedAt,
        completedAt,
        latencyMs: 250,
        firstStructuredDeltaMs: 25,
        streamEventCount: 3,
        structuredDeltaCount: 1,
        streamedCharacterCount: outputCharacterCount,
        outputHash,
        proposedCitationCount,
        usage,
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  });
  return HearingWitnessGenerationPrecommitSchema.parse({
    schemaVersion: HEARING_WITNESS_GENERATION_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    responseId: request.responseId,
    output,
    modelMetadata: {
      model: trace.model,
      requestId: "request:convex-witness:001",
      promptVersion: trace.promptVersion,
      schemaVersion: trace.outputSchemaVersion,
      latencyMs: trace.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: null,
      retryCount: trace.retryCount,
      validationFailureCount: trace.validationFailureCount,
    },
    trace,
  });
}

describe("V3 hearing runtime facade", () => {
  it("idempotently starts a seeded case without writing any legacy trial rows", async () => {
    const backend = convexTest({ schema, modules });
    const first = await start(backend);
    const second = await start(backend);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: "hearing-runtime-view.v1",
      case: { caseId: "case_redwood_signal_v1" },
      trial: {
        phase: "case_in_chief",
        status: "active",
        version: 3,
        sequence: 3,
        userSide: "user",
      },
    });
    expect(first.witnesses).toHaveLength(3);
    expect(JSON.stringify(first.player.facts)).not.toContain('"hidden"');

    const stored = await backend.run(async (ctx) => ({
      graphs: await ctx.db.query("caseGraphs").collect(),
      projections: await ctx.db.query("trialProjections").collect(),
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", first.trial.trialId),
        )
        .collect(),
      legacyTrials: await ctx.db.query("trials").collect(),
      legacyTurns: await ctx.db.query("turns").collect(),
    }));
    expect(stored.graphs).toHaveLength(1);
    expect(stored.graphs[0]).toMatchObject({
      lifecycle: "published",
      visibility: "seeded_public",
      createdBy: "system",
    });
    expect(stored.projections).toHaveLength(1);
    expect(stored.events.map((event) => event.eventType)).toEqual([
      "START_TRIAL",
      "BEGIN_PHASE",
      "BEGIN_PHASE",
    ]);
    expect(stored.legacyTrials).toEqual([]);
    expect(stored.legacyTurns).toEqual([]);
  });

  it("starts only the caller's immutable published private case", async () => {
    const backend = convexTest({ schema, modules });
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const uploadId = `upload:${"a".repeat(48)}`;
    const graphId = await derivePublishedGraphId(OWNER_ID, uploadId);
    await backend.run(async (ctx) => {
      await ctx.db.insert("caseGraphs", {
        graphId,
        caseId: graph.caseId,
        version: 2,
        lifecycle: "published",
        visibility: "private",
        ownerId: OWNER_ID,
        uploadId,
        title: graph.title,
        graphJson: JSON.stringify(graph),
        graphSchemaVersion: graph.schemaVersion,
        compilerMetadataJson: JSON.stringify(graph.compilerMetadata),
        sourceDigest: graph.compilerMetadata.sourceContentHash,
        createdBy: "user",
        createdAt: Date.parse("2026-07-19T03:00:00.000Z"),
      });
    });
    const request = {
      schemaVersion: HEARING_START_SCHEMA_VERSION,
      requestId: "19191919-1919-4919-8919-191919191919",
      requestedAt: "2026-07-19T03:00:00.000Z",
      case: { kind: "owned", uploadId },
      userSide: "user",
    } as const;

    const view = HearingRuntimeViewV1Schema.parse(
      await backend.action(startReference, {
        ownerId: OWNER_ID,
        requestJson: JSON.stringify(request),
      }),
    );
    expect(view.case).toMatchObject({
      caseId: graph.caseId,
      title: graph.title,
    });
    await expect(
      backend.action(startReference, {
        ownerId: OTHER_OWNER_ID,
        requestJson: JSON.stringify({
          ...request,
          requestId: "18181818-1818-4818-8818-181818181818",
        }),
      }),
    ).rejects.toThrow("HEARING_CASE_NOT_FOUND");
  });

  it("continues a partially appended command when the exact request is retried", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const request = playerCommand(
      started,
      "21212121-2121-4121-8121-212121212121",
      "2026-07-19T03:00:30.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const actionId = `action:${started.trial.trialId}:${request.requestId}:call-witness`;
    const partialAction = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId,
      trialId: started.trial.trialId,
      expectedStateVersion: request.expectedStateVersion,
      actor: {
        actorId: started.player.actorId,
        role: started.player.actorRole,
        side: started.player.side,
        witnessId: null,
      },
      source: "user",
      requestedAt: request.requestedAt,
      causationId: request.expectedLastEventId,
      correlationId: started.trial.trialId,
      responseId: null,
      interruptId: null,
      modelMetadata: null,
      type: "CALL_WITNESS",
      payload: {
        witnessId: "witness_rina_shah",
        calledBySide: started.trial.userSide,
      },
    });
    await expect(
      backend.mutation(appendPlayerForOwnerReference, {
        ownerId: OWNER_ID,
        actionJson: JSON.stringify(partialAction),
      }),
    ).resolves.toMatchObject({ committedStateVersion: 4, replayed: false });

    const partialView = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: started.trial.trialId,
      }),
    );
    expect(partialView.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "awaiting_oath",
    });

    const recovered = HearingRuntimeViewV1Schema.parse(
      await backend.action(commandReference, {
        ownerId: OWNER_ID,
        trialId: started.trial.trialId,
        commandJson: JSON.stringify(request),
      }),
    );
    expect(recovered.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "direct",
    });
    expect(recovered.trial.version).toBe(5);

    const events = await backend.run(async (ctx) =>
      ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", started.trial.trialId),
        )
        .collect(),
    );
    expect(events.filter((event) => event.eventType === "CALL_WITNESS")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "SWEAR_WITNESS")).toHaveLength(1);
  });

  it("prepares only a fresh witness-scoped model request and never fabricates testimony", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const called = await command(
      backend,
      started,
      "23232323-2323-4232-8232-232323232323",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const question = await prepare(
      backend,
      called.view,
      "24242424-2424-4242-8242-242424242424",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "When did you send the battery safety complaint?",
        presentedEvidenceIds: [],
      },
    );
    expect(question.preparation.status).toBe("model_required");
    if (!isHearingWitnessModelRequiredPreparation(question.preparation)) {
      throw new Error("Expected witness model preparation");
    }
    const preparedRequest = question.preparation.request;
    expect(preparedRequest).toMatchObject({
      trialId: called.view.trial.trialId,
      actorId: "actor:witness:witness_rina_shah",
      witnessId: "witness_rina_shah",
      expectedStateVersion: called.view.trial.version + 2,
      question: {
        text: "When did you send the battery safety complaint?",
        presentedEvidenceIds: [],
      },
      knowledgeView: {
        actorRole: "witness",
        witness: { witnessId: "witness_rina_shah" },
      },
    });
    expect(preparedRequest.callId).toMatch(
      /^call:trial_[a-f0-9]{32}:response:[0-9a-f-]{36}:[a-f0-9-]{36}$/,
    );

    const serialized = JSON.stringify(question.preparation);
    const seededGraph = await backend.run(async (ctx) => {
      const record = await ctx.db.query("caseGraphs").first();
      if (!record) throw new Error("Expected seeded graph");
      return CaseGraphV1Schema.parse(JSON.parse(record.graphJson));
    });
    const otherWitnessHiddenFact = seededGraph.facts.find(
      (fact) =>
        fact.initialStatus === "hidden" &&
        !fact.witnessIds.includes("witness_rina_shah"),
    );
    if (!otherWitnessHiddenFact) {
      throw new Error("Fixture requires another witness's hidden fact");
    }
    expect(serialized).not.toContain(OWNER_ID);
    expect(serialized).not.toContain("stateJson");
    expect(serialized).not.toContain("graphJson");
    expect(serialized).not.toContain("policySnapshot");
    expect(serialized).not.toContain(otherWitnessHiddenFact.factId);
    expect(serialized).not.toContain(otherWitnessHiddenFact.proposition);
    for (const witness of called.view.witnesses) {
      if (witness.witnessId !== "witness_rina_shah") {
        expect(serialized).not.toContain(witness.witnessId);
      }
    }

    const retry = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        commandJson: JSON.stringify(question.request),
      }),
    );
    expect(retry.status).toBe("model_required");
    if (!isHearingWitnessModelRequiredPreparation(retry)) {
      throw new Error("Expected retry model preparation");
    }
    expect(retry.request.responseId).toBe(preparedRequest.responseId);
    expect(retry.request.callId).not.toBe(preparedRequest.callId);

    await expect(
      backend.action(commandReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        commandJson: JSON.stringify(question.request),
      }),
    ).rejects.toThrow("MODEL_REQUIRED");
    const stored = await backend.run(async (ctx) => ({
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", called.view.trial.trialId),
        )
        .collect(),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
    }));
    expect(stored.events.filter((event) => event.eventType === "ASK_QUESTION")).toHaveLength(1);
    expect(stored.events.filter((event) => event.eventType === "REQUEST_RESPONSE")).toHaveLength(1);
    expect(stored.events.filter((event) => event.eventType === "ANSWER_QUESTION")).toEqual([]);
    expect(stored.events.some((event) => event.source === "ai")).toBe(false);
    expect(stored.calls).toEqual([]);
  });

  it("atomically commits and exactly replays one validated AI answer and model audit", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const called = await command(
      backend,
      started,
      "25252525-2525-4252-8252-252525252525",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const question = await prepare(
      backend,
      called.view,
      "26262626-2626-4262-8262-262626262626",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did you personally observe?",
        presentedEvidenceIds: [],
      },
    );
    if (!isHearingWitnessModelRequiredPreparation(question.preparation)) {
      throw new Error("Expected witness model preparation");
    }
    const generation = await fakeWitnessGeneration(
      question.preparation,
      "2026-07-19T03:02:02.000Z",
    );
    const committed = HearingRuntimeViewV1Schema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    expect(committed.trial.version).toBe(called.view.trial.version + 3);
    expect(committed.activeQuestion).toBeNull();
    expect(committed.transcript.map((turn) => turn.actor.role)).toEqual([
      "user_counsel",
      "witness",
    ]);

    const exactCommitReplay = HearingRuntimeViewV1Schema.parse(
      await backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    );
    expect(exactCommitReplay).toEqual(committed);
    const exactPrepareReplay = HearingCommandPreparationSchema.parse(
      await backend.action(prepareCommandReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        commandJson: JSON.stringify(question.request),
      }),
    );
    expect(exactPrepareReplay).toEqual({
      schemaVersion: "hearing-command-preparation.v1",
      status: "completed",
      view: committed,
    });

    const stored = await backend.run(async (ctx) => ({
      answerEvents: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", called.view.trial.trialId),
          )
          .collect()
      ).filter((event) => event.eventType === "ANSWER_QUESTION"),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
    }));
    expect(stored.answerEvents).toHaveLength(1);
    expect(stored.answerEvents[0]).toMatchObject({
      source: "ai",
      model: "gpt-5.6-luna",
      responseId: generation.responseId,
      promptVersion: generation.modelMetadata.promptVersion,
    });
    expect(stored.calls).toHaveLength(1);
    expect(stored.calls[0]).toMatchObject({
      ownerId: OWNER_ID,
      trialId: called.view.trial.trialId,
      callId: generation.callId,
      status: "accepted",
      attemptCount: 1,
    });
    expect(stored.attempts).toHaveLength(1);
    expect(stored.attempts[0]).toMatchObject({
      ownerId: OWNER_ID,
      callId: generation.callId,
      attempt: 1,
      status: "accepted",
    });
    expect(JSON.parse(stored.calls[0]!.traceJson)).toMatchObject({
      committedActionId: stored.answerEvents[0]!.actionId,
      committedEventId: stored.answerEvents[0]!.eventId,
    });
  });

  it("rejects foreign, cross-owner, and stale witness generations without an answer or trace", async () => {
    const backend = convexTest({ schema, modules });
    const started = await start(backend);
    const called = await command(
      backend,
      started,
      "27272727-2727-4272-8272-272727272727",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    );
    const question = await prepare(
      backend,
      called.view,
      "28282828-2828-4282-8282-282828282828",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did you personally observe?",
        presentedEvidenceIds: [],
      },
    );
    if (!isHearingWitnessModelRequiredPreparation(question.preparation)) {
      throw new Error("Expected witness model preparation");
    }
    const generation = await fakeWitnessGeneration(
      question.preparation,
      "2026-07-19T03:02:02.000Z",
    );

    const graph = await backend.run(async (ctx) => {
      const record = await ctx.db.query("caseGraphs").first();
      if (!record) throw new Error("Expected seeded graph");
      return CaseGraphV1Schema.parse(JSON.parse(record.graphJson));
    });
    const allowedFactIds = new Set(
      question.preparation.request.knowledgeView.witness.facts.map(
        (fact) => fact.factId,
      ),
    );
    const foreignFact = graph.facts.find(
      (fact) => !allowedFactIds.has(fact.factId),
    );
    if (!foreignFact) throw new Error("Fixture requires a foreign witness fact");
    const foreignOutput = WitnessAnswerModelOutputSchema.parse({
      ...generation.output,
      segments: generation.output.segments.map((segment, index) =>
        index === 0 ? { ...segment, factIds: [foreignFact.factId] } : segment,
      ),
    });
    const foreignHash = hashWitnessAnswerModelOutput(foreignOutput);
    const foreignCitations = witnessAnswerOutputCitations(foreignOutput);
    const foreignGeneration = HearingWitnessGenerationPrecommitSchema.parse({
      ...generation,
      output: foreignOutput,
      trace: {
        ...generation.trace,
        acceptedCitations: foreignCitations,
        acceptedCitationCount: Object.values(foreignCitations).reduce(
          (count, identifiers) => count + identifiers.length,
          0,
        ),
        outputHash: foreignHash,
        outputCharacterCount: JSON.stringify(foreignOutput).length,
        attempts: generation.trace.attempts.map((attempt) => ({
          ...attempt,
          outputHash: foreignHash,
          proposedCitationCount: 1,
        })),
      },
    });
    await expect(
      backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(foreignGeneration),
      }),
    ).rejects.toThrow("WITNESS_GENERATION_INVALID");

    await expect(
      backend.action(commitWitnessGenerationReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");

    const pendingState = await backend.run(async (ctx) => {
      const projection = await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", called.view.trial.trialId),
        )
        .unique();
      if (!projection) throw new Error("Expected trial projection");
      return TrialStateV3Schema.parse(JSON.parse(projection.stateJson));
    });
    const systemActor = Object.values(pendingState.actors).find(
      (actor) => actor.role === "system",
    );
    const lastEventId = pendingState.eventIds.at(-1);
    if (!systemActor || !lastEventId) {
      throw new Error("Expected system actor and pending head");
    }
    const cancel = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId: `action:${called.view.trial.trialId}:cancel-stale-witness-response`,
      trialId: called.view.trial.trialId,
      expectedStateVersion: pendingState.version,
      actor: systemActor,
      source: "system",
      requestedAt: "2026-07-19T03:02:03.000Z",
      causationId: lastEventId,
      correlationId: called.view.trial.trialId,
      responseId: generation.responseId,
      interruptId: null,
      modelMetadata: null,
      type: "CANCEL_RESPONSE",
      payload: { responseId: generation.responseId },
    });
    await backend.mutation(appendTrustedForOwnerReference, {
      ownerId: OWNER_ID,
      actionJson: JSON.stringify(cancel),
    });
    await expect(
      backend.action(commitWitnessGenerationReference, {
        ownerId: OWNER_ID,
        trialId: called.view.trial.trialId,
        generationJson: JSON.stringify(generation),
      }),
    ).rejects.toThrow("WITNESS_GENERATION_STALE");

    const rejectedWrites = await backend.run(async (ctx) => ({
      answers: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", called.view.trial.trialId),
          )
          .collect()
      ).filter((event) => event.eventType === "ANSWER_QUESTION"),
      calls: await ctx.db.query("courtroomModelCalls").collect(),
      attempts: await ctx.db.query("courtroomModelCallAttempts").collect(),
    }));
    expect(rejectedWrites.answers).toEqual([]);
    expect(rejectedWrites.calls).toEqual([]);
    expect(rejectedWrites.attempts).toEqual([]);
  });

  it("calls, questions, releases, switches witnesses, completes, and resumes only from V3 events", async () => {
    const backend = convexTest({ schema, modules });
    let view = await start(backend);

    ({ view } = await command(
      backend,
      view,
      "22222222-2222-4222-8222-222222222222",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    ));
    expect(view.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "direct",
    });
    expect(view.trial.version).toBe(5);

    const asked = await command(
      backend,
      view,
      "33333333-3333-4333-8333-333333333333",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "When did you send the battery safety complaint?",
        presentedEvidenceIds: [],
      },
    );
    view = asked.view;
    expect(view.trial.version).toBe(8);
    expect(view.activeQuestion).toBeNull();
    expect(view.transcript).toHaveLength(2);
    expect(view.transcript.map((turn) => turn.actor.role)).toEqual([
      "user_counsel",
      "witness",
    ]);
    const replayedQuestion = HearingRuntimeViewV1Schema.parse(
      await backend.action(commandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(asked.request),
      }),
    );
    expect(replayedQuestion).toEqual(view);

    ({ view } = await command(
      backend,
      view,
      "44444444-4444-4444-8444-444444444444",
      "2026-07-19T03:03:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
      },
    ));
    expect(view.activeAppearance).toBeNull();
    expect(
      view.witnesses.find((witness) => witness.witnessId === "witness_rina_shah"),
    ).toMatchObject({ status: "released", callCount: 1 });

    ({ view } = await command(
      backend,
      view,
      "55555555-5555-4555-8555-555555555555",
      "2026-07-19T03:04:00.000Z",
      { type: "call_witness", witnessId: "witness_theo_morgan" },
    ));
    ({ view } = await command(
      backend,
      view,
      "66666666-6666-4666-8666-666666666666",
      "2026-07-19T03:05:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_theo_morgan",
        examinationKind: "direct",
        text: "When was the termination draft created?",
        presentedEvidenceIds: [],
      },
    ));
    ({ view } = await command(
      backend,
      view,
      "77777777-7777-4777-8777-777777777777",
      "2026-07-19T03:06:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_theo_morgan",
        examinationKind: "direct",
      },
    ));
    expect(view.transcript).toHaveLength(4);
    expect(
      new Set(
        view.transcript
          .filter((turn) => turn.actor.role === "witness")
          .map((turn) => turn.actor.witnessId),
      ),
    ).toEqual(new Set(["witness_rina_shah", "witness_theo_morgan"]));

    ({ view } = await command(
      backend,
      view,
      "88888888-8888-4888-8888-888888888888",
      "2026-07-19T03:07:00.000Z",
      {
        type: "finish_trial",
        closingText: "The testimony shows why the admitted record warrants relief.",
      },
    ));
    expect(view.trial).toMatchObject({ phase: "complete", status: "complete" });
    expect(view.transcript).toHaveLength(6);

    const resumed = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
      }),
    );
    expect(resumed).toEqual(view);
    await expect(
      backend.action(readReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: view.trial.trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");

    const stored = await backend.run(async (ctx) => ({
      eventCount: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", view.trial.trialId),
          )
          .collect()
      ).length,
      legacyTrials: await ctx.db.query("trials").collect(),
      legacyTurns: await ctx.db.query("turns").collect(),
    }));
    expect(stored.eventCount).toBe(view.trial.sequence);
    expect(stored.legacyTrials).toEqual([]);
    expect(stored.legacyTurns).toEqual([]);
  });
});
