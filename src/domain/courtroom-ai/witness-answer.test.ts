import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";

import { createThreeWitnessCaseGraphV1Fixture } from "../case-graph";
import { deriveTrialActorBindings } from "../hearing-runtime";
import { buildKnowledgeView } from "../knowledge";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionV3Schema,
  commitAction,
  createStartTrialAction,
  type ActorRef,
  type EventSource,
  type TrialActionType,
  type TrialStateV3,
} from "../trial-engine";
import {
  WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
  WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
  WitnessAnswerModelOutputSchema,
  WitnessAnswerRequestSchema,
  validateWitnessAnswerOutput,
  validateWitnessAnswerRequestBinding,
  type WitnessAnswerModelOutput,
  type WitnessAnswerRequest,
} from "./witness-answer";

const BASE_TIME = Date.parse("2026-07-19T05:00:00.000Z");

function defaultPerformance(): WitnessAnswerModelOutput["performance"] {
  return {
    emotion: "confident",
    intensity: 0.45,
    delivery: "measured",
    gesture: "small_nod",
    gazeTarget: "questioning_counsel",
  };
}

function createPendingWitnessRequest(): {
  request: WitnessAnswerRequest;
  state: TrialStateV3;
  otherWitnessFactId: string;
} {
  const graph = createThreeWitnessCaseGraphV1Fixture();
  const bindings = deriveTrialActorBindings(graph);
  const actor = (
    role: ActorRef["role"],
    witnessId?: string,
  ): ActorRef => {
    const match = bindings.find(
      (binding) =>
        binding.actor.role === role &&
        (witnessId === undefined || binding.actor.witnessId === witnessId),
    )?.actor;
    if (!match) throw new Error(`Missing ${role} actor`);
    return match;
  };
  const witnessId = "witness_rina_shah";
  const witness = actor("witness", witnessId);
  const userCounsel = actor("user_counsel");
  const judge = actor("judge");
  const clerk = actor("clerk");
  const system = actor("system");
  const trialId = "trial:witness-answer-contract";
  let state = commitAction(
    null,
    createStartTrialAction({
      trialId,
      actionId: "action:witness-answer:start",
      requestedAt: new Date(BASE_TIME).toISOString(),
      graph,
      actors: bindings.map((binding) => binding.actor),
      actorBindings: bindings,
    }),
  ).state as TrialStateV3;
  let ordinal = 0;
  const commit = (
    type: TrialActionType,
    payload: unknown,
    actionActor: ActorRef,
    source: EventSource,
  ) => {
    ordinal += 1;
    const actionId = `action:witness-answer:${ordinal}:${type.toLowerCase()}`;
    const payloadRecord = payload as Record<string, unknown>;
    const action = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId,
      trialId,
      expectedStateVersion: state.version,
      actor: actionActor,
      source,
      requestedAt: new Date(BASE_TIME + ordinal * 1_000).toISOString(),
      causationId: state.eventIds.at(-1) ?? null,
      correlationId: trialId,
      responseId:
        typeof payloadRecord.responseId === "string"
          ? payloadRecord.responseId
          : null,
      interruptId: null,
      modelMetadata: null,
      type,
      payload,
    });
    const result = commitAction(state, action);
    state = result.state;
    return result.event;
  };

  commit("BEGIN_PHASE", { phase: "opening" }, judge, "deterministic");
  commit(
    "BEGIN_PHASE",
    { phase: "case_in_chief" },
    judge,
    "deterministic",
  );
  commit(
    "CALL_WITNESS",
    { witnessId, calledBySide: "user" },
    userCounsel,
    "user",
  );
  commit("SWEAR_WITNESS", { witnessId }, clerk, "deterministic");

  const witnessProfile = graph.witnesses.find(
    (candidate) => candidate.witnessId === witnessId,
  );
  if (!witnessProfile) throw new Error("Missing witness profile");
  const presentedEvidenceIds = witnessProfile.knowledgeBoundary.seenEvidenceIds.slice(0, 1);
  const questionId = "question:witness-answer:1";
  const questionTurnId = "turn:witness-answer:question:1";
  const questionText = "What did you personally observe, and do you recognize this record?";
  const appearanceId = state.activeAppearanceId;
  if (!appearanceId) throw new Error("Missing active appearance");
  const questionEvent = commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId,
      examinationKind: "direct",
      text: questionText,
      turnId: questionTurnId,
      presentedEvidenceIds,
    },
    userCounsel,
    "user",
  );
  const responseId = "response:witness-answer:1";
  const requestEvent = commit(
    "REQUEST_RESPONSE",
    { responseId, actorId: witness.actorId, purpose: "answer_question" },
    system,
    "system",
  );
  const view = buildKnowledgeView(
    { trial: state, caseGraph: graph },
    witness.actorId,
  );
  if (view.actorRole !== "witness") throw new Error("Expected witness view");
  const request = WitnessAnswerRequestSchema.parse({
    schemaVersion: WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
    callId: `model-call:${responseId}`,
    trialId,
    responseId,
    expectedStateVersion: state.version,
    expectedLastEventId: requestEvent.eventId,
    actorId: witness.actorId,
    witnessId,
    question: {
      questionId,
      appearanceId,
      turnId: questionTurnId,
      eventId: questionEvent.eventId,
      examinationKind: "direct",
      text: questionText,
      presentedEvidenceIds,
    },
    knowledgeView: view,
  });
  const otherWitness = graph.witnesses.find(
    (candidate) => candidate.witnessId !== witnessId,
  );
  const otherWitnessFactId = otherWitness?.knowledgeBoundary.knownFactIds.find(
    (factId) => !view.witness.facts.some((fact) => fact.factId === factId),
  );
  if (!otherWitnessFactId) throw new Error("Fixture requires an isolated witness fact");
  return { request, state, otherWitnessFactId };
}

function substantiveOutput(
  request: WitnessAnswerRequest,
): WitnessAnswerModelOutput {
  const factId = request.knowledgeView.witness.facts[0]?.factId;
  if (!factId) throw new Error("Fixture requires a witness fact");
  const evidenceId = request.knowledgeView.presentedEvidence[0]?.evidenceId;
  return WitnessAnswerModelOutputSchema.parse({
    schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
    disposition: "substantive",
    performance: defaultPerformance(),
    segments: [
      {
        text: "I personally observed the condition described in my account.",
        factIds: [factId],
        evidenceIds: evidenceId ? [evidenceId] : [],
        priorStatementIds: [],
      },
    ],
  });
}

describe("witness answer contracts", () => {
  it("converts to an OpenAI strict Structured Output with an object root", () => {
    const format = zodTextFormat(
      WitnessAnswerModelOutputSchema,
      WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
    );
    expect(format).toMatchObject({
      type: "json_schema",
      name: WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME,
      strict: true,
      schema: { type: "object", additionalProperties: false },
    });
  });

  it("strictly parses request/output envelopes and rejects unknown keys", () => {
    const { request } = createPendingWitnessRequest();
    expect(WitnessAnswerRequestSchema.safeParse({ ...request, ownerId: "leak" }).success).toBe(false);
    const output = substantiveOutput(request);
    expect(WitnessAnswerModelOutputSchema.safeParse({ ...output, actorId: request.actorId }).success).toBe(false);
    expect(
      WitnessAnswerModelOutputSchema.safeParse({
        ...output,
        segments: [{ ...output.segments[0], hiddenReasoning: "secret" }],
      }).success,
    ).toBe(false);
  });

  it("accepts only a request bound to the exact pending response and current head", () => {
    const { request, state } = createPendingWitnessRequest();
    expect(validateWitnessAnswerRequestBinding(request, state)).toEqual([]);

    const staleState = structuredClone(state);
    staleState.version += 1;
    expect(
      validateWitnessAnswerRequestBinding(request, staleState).map(
        (entry) => entry.code,
      ),
    ).toContain("state_binding_mismatch");

    const cancelledState = structuredClone(state);
    cancelledState.pendingResponses[request.responseId]!.status = "cancelled";
    expect(
      validateWitnessAnswerRequestBinding(request, cancelledState).map(
        (entry) => entry.code,
      ),
    ).toContain("response_not_pending");
  });

  it("reports every material request-to-view binding mismatch before generation", () => {
    const { request, state } = createPendingWitnessRequest();
    const mutations: Array<{
      code: ReturnType<typeof validateWitnessAnswerRequestBinding>[number]["code"];
      mutate: (candidate: WitnessAnswerRequest) => void;
    }> = [
      {
        code: "trial_binding_mismatch",
        mutate: (candidate) => {
          candidate.knowledgeView.trialId = "trial:wrong-binding";
        },
      },
      {
        code: "head_binding_mismatch",
        mutate: (candidate) => {
          candidate.expectedLastEventId = "event:wrong-head";
        },
      },
      {
        code: "actor_binding_mismatch",
        mutate: (candidate) => {
          candidate.actorId = "actor:wrong-witness";
        },
      },
      {
        code: "witness_binding_mismatch",
        mutate: (candidate) => {
          candidate.witnessId = "witness:wrong";
        },
      },
      {
        code: "response_binding_mismatch",
        mutate: (candidate) => {
          candidate.responseId = "response:wrong";
        },
      },
      {
        code: "question_binding_mismatch",
        mutate: (candidate) => {
          candidate.question.text = "A different question";
        },
      },
      {
        code: "exchange_binding_mismatch",
        mutate: (candidate) => {
          candidate.knowledgeView.currentExchange = null;
        },
      },
      {
        code: "presented_evidence_binding_mismatch",
        mutate: (candidate) => {
          candidate.question.presentedEvidenceIds = [];
        },
      },
    ];

    for (const scenario of mutations) {
      const candidate = structuredClone(request);
      scenario.mutate(candidate);
      expect(
        validateWitnessAnswerRequestBinding(candidate, state).map(
          (entry) => entry.code,
        ),
      ).toContain(scenario.code);
    }
  });

  it("accepts grounded segments and materializes stable action-safe fields", () => {
    const { request } = createPendingWitnessRequest();
    const output = substantiveOutput(request);
    output.segments.push({
      text: "That is the record I was shown here.",
      factIds: [output.segments[0]!.factIds[0]!],
      evidenceIds: [...output.segments[0]!.evidenceIds],
      priorStatementIds: [],
    });
    const result = validateWitnessAnswerOutput(request, output);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected accepted output");
    expect(result.answer.text).toContain("That is the record");
    expect(result.answer.factIds).toEqual(output.segments[0]!.factIds);
    expect(result.answer.evidenceIds).toEqual(output.segments[0]!.evidenceIds);
    expect(result.report).toMatchObject({ status: "accepted", issues: [] });
  });

  it("rejects cross-witness facts, unscoped evidence, and foreign statements", () => {
    const { request, otherWitnessFactId } = createPendingWitnessRequest();
    const output = substantiveOutput(request);
    output.segments[0]!.factIds.push(otherWitnessFactId);
    output.segments[0]!.evidenceIds.push("evidence:not-in-view");
    output.segments[0]!.priorStatementIds.push("statement:not-in-view");
    const result = validateWitnessAnswerOutput(request, output);
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected rejected output");
    expect(result.report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "unknown_fact_citation",
        "unknown_evidence_citation",
        "unknown_prior_statement_citation",
      ]),
    );
  });

  it("rejects ungrounded, duplicate, oversized, and evidence-mismatched output", () => {
    const { request } = createPendingWitnessRequest();
    const factId = request.knowledgeView.witness.facts[0]!.factId;
    const result = validateWitnessAnswerOutput(request, {
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      disposition: "substantive",
      performance: {
        ...defaultPerformance(),
        gesture: "indicate_evidence",
        gazeTarget: "evidence_display",
      },
      segments: [
        {
          text: "x".repeat(550),
          factIds: [],
          evidenceIds: [],
          priorStatementIds: [],
        },
        ...Array.from({ length: 7 }, () => ({
          text: "y".repeat(550),
          factIds: [factId, factId],
          evidenceIds: [],
          priorStatementIds: [],
        })),
      ],
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected rejected output");
    expect(result.report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "ungrounded_segment",
        "duplicate_citation",
        "performance_evidence_mismatch",
        "answer_too_large",
      ]),
    );
  });

  it("uses server-owned boundary phrases and rejects model-authored boundary text", () => {
    const { request } = createPendingWitnessRequest();
    const safe = validateWitnessAnswerOutput(request, {
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      disposition: "insufficient_knowledge",
      performance: defaultPerformance(),
      segments: [],
    });
    expect(safe.accepted).toBe(true);
    if (!safe.accepted) throw new Error("Expected accepted boundary output");
    expect(safe.answer).toMatchObject({
      text: "I do not know that from my own knowledge.",
      factIds: [],
      evidenceIds: [],
    });

    const authored = validateWitnessAnswerOutput(request, {
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      disposition: "outside_permitted_scope",
      performance: defaultPerformance(),
      segments: [
        {
          text: "A model-authored refusal that could leak hidden context.",
          factIds: [],
          evidenceIds: [],
          priorStatementIds: [],
        },
      ],
    });
    expect(authored.accepted).toBe(false);
    if (authored.accepted) throw new Error("Expected rejected boundary output");
    expect(authored.report.issues.map((entry) => entry.code)).toContain(
      "boundary_segments_forbidden",
    );
  });

  it("returns bounded schema issues instead of accepting malformed output", () => {
    const { request } = createPendingWitnessRequest();
    const result = validateWitnessAnswerOutput(request, {
      schemaVersion: WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION,
      disposition: "substantive",
      performance: defaultPerformance(),
      segments: [{ text: "Missing citation fields" }],
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected rejected malformed output");
    expect(result.report.issues.every((entry) => entry.code === "strict_schema_invalid")).toBe(true);
  });
});
