import { describe, expect, it } from "vitest";

import {
  OpponentPlannerModelOutputSchema,
  type OpponentPlannerModelOutput,
} from "@/domain/courtroom-ai";

import { ScriptedCourtroomModelProvider } from "./fake-provider";
import {
  createOpponentPlannerOutputFixture,
  createOpponentPlannerRequestFixture,
} from "./opponent-planner.test-fixtures";
import { generateOpponentPlan } from "./opponent-planner";

function invalidPlan(): OpponentPlannerModelOutput {
  const valid = createOpponentPlannerOutputFixture();
  return OpponentPlannerModelOutputSchema.parse({
    ...valid,
    witnessPriorityIds: ["witness_hidden"],
    proposedMoves: [
      {
        ...valid.proposedMoves[0],
        witnessId: "witness_hidden",
      },
    ],
  });
}

describe("generateOpponentPlan", () => {
  it("accepts a streamed, scoped Luna plan and emits only a redacted audit", async () => {
    const request = createOpponentPlannerRequestFixture();
    const output = createOpponentPlannerOutputFixture();
    const provider = new ScriptedCourtroomModelProvider([
      {
        type: "output",
        output,
        requestId: "req_opponent_plan_1",
        responseId: "resp_opponent_plan_1",
      },
    ]);

    const generated = await generateOpponentPlan({ provider, request });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "opponent_planner",
      task: "plan_opponent",
      mode: "initial",
      attempt: 1,
      schemaName: "suits_opponent_plan_v1",
    });
    expect(generated.output).toEqual(output);
    expect(generated.trace).toMatchObject({
      status: "accepted",
      actorRole: "counsel",
      callClass: "opponent_planner",
      task: "plan_opponent",
      model: "gpt-5.6-luna",
      retryCount: 0,
      validationFailureCount: 0,
      acceptedAttempt: 1,
      acceptedCitations: {
        factIds: ["fact_draft"],
        evidenceIds: ["evidence_draft"],
      },
      committedActionId: null,
      committedEventId: null,
    });
    expect(generated.trace.estimatedCostUsd).toBeGreaterThan(0);
    expect(generated.modelMetadata).toMatchObject({
      model: "gpt-5.6-luna",
      requestId: "req_opponent_plan_1",
      retryCount: 0,
    });
    const serializedTrace = JSON.stringify(generated.trace);
    expect(serializedTrace).not.toContain(output.privateNotes[0]);
    expect(serializedTrace).not.toContain(output.objectives[0]);
    expect(serializedTrace).not.toContain(
      request.knowledgeView.counsel.privateSettlement?.confidentialPriorities[0],
    );
  });

  it("uses one targeted repair after request-aware validation rejects a move", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      { type: "output", output: invalidPlan() },
      { type: "output", output: createOpponentPlannerOutputFixture() },
    ]);

    const generated = await generateOpponentPlan({
      provider,
      request: createOpponentPlannerRequestFixture(),
    });

    expect(provider.requests.map((request) => request.mode)).toEqual([
      "initial",
      "repair",
    ]);
    expect(provider.requests[1]?.prompt.developerContext).toContain(
      "unknown_witness_reference",
    );
    expect(generated.trace).toMatchObject({
      status: "accepted",
      acceptedAttempt: 2,
      retryCount: 1,
      validationFailureCount: 1,
    });
  });

  it("does not retry a provider failure or fabricate a strategy", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      {
        type: "error",
        code: "service_unavailable",
        message: "sensitive provider detail",
        retryable: true,
      },
    ]);

    await expect(
      generateOpponentPlan({
        provider,
        request: createOpponentPlannerRequestFixture(),
      }),
    ).rejects.toMatchObject({
      code: "opponent_plan_provider_failed",
      trace: {
        status: "failed",
        safeFailureCode: "service_unavailable",
        attempts: [{ status: "provider_failed" }],
      },
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("fails terminally when the one repair is still invalid", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      { type: "output", output: invalidPlan() },
      { type: "output", output: invalidPlan() },
    ]);

    await expect(
      generateOpponentPlan({
        provider,
        request: createOpponentPlannerRequestFixture(),
      }),
    ).rejects.toMatchObject({
      code: "opponent_plan_validation_failed",
      trace: {
        status: "failed",
        retryCount: 1,
        validationFailureCount: 2,
        safeFailureCode: "opponent_plan_validation_failed",
      },
    });
    expect(provider.requests).toHaveLength(2);
  });

  it("cancels during structured streaming without exposing partial JSON", async () => {
    const controller = new AbortController();
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createOpponentPlannerOutputFixture() }],
      { defaultChunkSize: 4, defaultChunkDelayMs: 5 },
    );
    const pending = generateOpponentPlan({
      provider,
      request: createOpponentPlannerRequestFixture(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort("browser disconnected"), 1);

    await expect(pending).rejects.toMatchObject({
      code: "opponent_plan_cancelled",
      trace: {
        status: "cancelled",
        safeFailureCode: "request_aborted",
        attempts: [{ status: "cancelled", outputHash: null }],
      },
    });
    expect(provider.requests).toHaveLength(1);
  });
});
