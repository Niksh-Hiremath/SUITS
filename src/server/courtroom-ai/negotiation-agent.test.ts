import { describe, expect, it } from "vitest";

import {
  NegotiationAgentModelOutputSchema,
  type NegotiationAgentModelOutput,
} from "@/domain/courtroom-ai/call-contracts";

import { ScriptedCourtroomModelProvider } from "./fake-provider";
import {
  createNegotiationAgentOutputFixture,
  createNegotiationAgentRequestFixture,
} from "./negotiation-agent.test-fixtures";
import { generateNegotiationDecision } from "./negotiation-agent";

function invalidDecision(): NegotiationAgentModelOutput {
  const valid = createNegotiationAgentOutputFixture();
  return NegotiationAgentModelOutputSchema.parse({
    ...valid,
    citations: {
      ...valid.citations,
      factIds: ["fact_hidden_other_side"],
    },
  });
}

describe("generateNegotiationDecision", () => {
  it("accepts a streamed private Luna recommendation with cost and redacted trace", async () => {
    const request = createNegotiationAgentRequestFixture();
    const output = createNegotiationAgentOutputFixture();
    const provider = new ScriptedCourtroomModelProvider([
      {
        type: "output",
        output,
        requestId: "req_negotiation_1",
        responseId: "resp_negotiation_1",
      },
    ]);

    const generated = await generateNegotiationDecision({ provider, request });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      callClass: "negotiation_agent",
      task: "evaluate_settlement",
      mode: "initial",
      attempt: 1,
      schemaName: "suits_negotiation_decision_v1",
    });
    expect(generated.output).toEqual(output);
    expect(generated.decision).toMatchObject({
      recommendation: "accept",
      representedPartyId: "party_opposing",
      counterpartyPartyId: "party_user",
      targetOfferId: "offer_incoming",
      offerId: "offer_incoming",
    });
    expect(generated.trace).toMatchObject({
      status: "accepted",
      actorRole: "counsel",
      callClass: "negotiation_agent",
      task: "evaluate_settlement",
      model: "gpt-5.6-luna",
      retryCount: 0,
      validationFailureCount: 0,
      acceptedAttempt: 1,
      acceptedCitations: {
        factIds: ["fact_private_side"],
        evidenceIds: ["evidence_public"],
        testimonyIds: ["testimony_public"],
        sourceSegmentIds: ["segment_public_fact"],
      },
      committedActionId: null,
      committedEventId: null,
    });
    expect(generated.trace.estimatedCostUsd).toBeGreaterThan(0);
    expect(generated.modelMetadata).toMatchObject({
      model: "gpt-5.6-luna",
      requestId: "req_negotiation_1",
      retryCount: 0,
    });
    const serializedTrace = JSON.stringify(generated.trace);
    expect(serializedTrace).not.toContain(output.decisionSummary);
    expect(serializedTrace).not.toContain("Avoid an admission of liability.");
    expect(serializedTrace).not.toContain("35000");
  });

  it("uses exactly one targeted repair after request-aware citation rejection", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      { type: "output", output: invalidDecision() },
      { type: "output", output: createNegotiationAgentOutputFixture() },
    ]);

    const generated = await generateNegotiationDecision({
      provider,
      request: createNegotiationAgentRequestFixture(),
    });

    expect(provider.requests.map((request) => request.mode)).toEqual([
      "initial",
      "repair",
    ]);
    expect(provider.requests[1]?.prompt.developerContext).toContain(
      "unknown_fact_citation",
    );
    expect(generated.trace).toMatchObject({
      status: "accepted",
      acceptedAttempt: 2,
      retryCount: 1,
      validationFailureCount: 1,
    });
  });

  it("fails after the single repair remains invalid", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      { type: "output", output: invalidDecision() },
      { type: "output", output: invalidDecision() },
    ]);

    await expect(
      generateNegotiationDecision({
        provider,
        request: createNegotiationAgentRequestFixture(),
      }),
    ).rejects.toMatchObject({
      code: "negotiation_decision_validation_failed",
      trace: {
        status: "failed",
        retryCount: 1,
        validationFailureCount: 2,
        safeFailureCode: "negotiation_decision_validation_failed",
      },
    });
    expect(provider.requests).toHaveLength(2);
  });

  it("does not retry a provider failure or fabricate a recommendation", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      {
        type: "error",
        code: "service_unavailable",
        message: "sensitive provider detail",
        retryable: true,
      },
    ]);

    await expect(
      generateNegotiationDecision({
        provider,
        request: createNegotiationAgentRequestFixture(),
      }),
    ).rejects.toMatchObject({
      code: "negotiation_decision_provider_failed",
      trace: {
        status: "failed",
        safeFailureCode: "service_unavailable",
        attempts: [{ status: "provider_failed" }],
      },
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("cancels during structured streaming without exposing partial JSON", async () => {
    const controller = new AbortController();
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: createNegotiationAgentOutputFixture() }],
      { defaultChunkSize: 4, defaultChunkDelayMs: 5 },
    );
    const pending = generateNegotiationDecision({
      provider,
      request: createNegotiationAgentRequestFixture(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort("browser disconnected"), 1);

    await expect(pending).rejects.toMatchObject({
      code: "negotiation_decision_cancelled",
      trace: {
        status: "cancelled",
        safeFailureCode: "request_aborted",
        attempts: [{ status: "cancelled", outputHash: null }],
      },
    });
    expect(provider.requests).toHaveLength(1);
  });
});
