import { describe, expect, it } from "vitest";

import {
  NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
  NegotiationAgentModelOutputSchema,
  type NegotiationAgentModelOutput,
} from "../courtroom-ai/call-contracts";
import {
  COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
  COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
} from "../courtroom-ai/model-call-trace";
import {
  HEARING_NEGOTIATION_AGENT_PROMPT_VERSION,
  HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION,
  HEARING_NEGOTIATION_PROVIDER_PROTOCOL_VERSION,
  HearingNegotiationPrecommitSchema,
  hashNegotiationAgentModelOutput,
  negotiationAgentOutputCitations,
  negotiationAgentProposedCitationCount,
  type HearingNegotiationPrecommit,
} from "./settlement-boundary";
import {
  HearingNegotiationPrecommitSchema as ExportedHearingNegotiationPrecommitSchema,
} from ".";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function negotiationOutput(): NegotiationAgentModelOutput {
  return NegotiationAgentModelOutputSchema.parse({
    schemaVersion: NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
    recommendation: "counter",
    utilityBand: "within_authority",
    terms: {
      amount: 24_000,
      currency: "USD",
      nonMonetaryTerms: ["Mutual non-disparagement"],
      summary: "Resolve the fictional dispute for $24,000.",
    },
    decisionSummary: "The counter remains within the represented party's authority.",
    citations: {
      factIds: ["fact_private_side"],
      evidenceIds: ["evidence_public"],
      testimonyIds: ["testimony_public"],
      transcriptTurnIds: [],
      sourceSegmentIds: ["segment_public_fact"],
      priorStatementIds: [],
      issueIds: [],
      instructionIds: [],
      ruleIds: [],
      settlementOfferIds: ["offer_incoming"],
    },
    performance: {
      activity: "thinking",
      emotion: "neutral",
      intensity: 0.25,
      gazeTarget: "none",
      gesture: "none",
      speakingStyle: "deliberative",
    },
  });
}

function validPrecommit(): HearingNegotiationPrecommit {
  const output = negotiationOutput();
  const outputHash = hashNegotiationAgentModelOutput(output);
  const citations = negotiationAgentOutputCitations(output);
  const usage = {
    inputTokens: 900,
    outputTokens: 180,
    totalTokens: 1_080,
    cachedInputTokens: 300,
    cacheWriteTokens: 0,
    reasoningTokens: 30,
  };
  const latencyMs = 640;
  const estimatedCostUsd = 0.0031;

  return HearingNegotiationPrecommitSchema.parse({
    schemaVersion: HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION,
    trialId: "trial_negotiation",
    callId: "call:negotiation:001",
    decisionId: "decision:negotiation:001",
    expectedStateVersion: 18,
    expectedLastEventId: "event_negotiation_head",
    output,
    modelMetadata: {
      model: "gpt-5.6-luna",
      requestId: "request:openai:negotiation:001",
      promptVersion: HEARING_NEGOTIATION_AGENT_PROMPT_VERSION,
      schemaVersion: NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd,
      retryCount: 0,
      validationFailureCount: 0,
    },
    trace: {
      schemaVersion: COURTROOM_MODEL_CALL_TRACE_SCHEMA_VERSION,
      callId: "call:negotiation:001",
      trialId: "trial_negotiation",
      responseId: null,
      actorId: "actor_opposing_counsel",
      actorRole: "counsel",
      callClass: "negotiation_agent",
      task: "evaluate_settlement",
      inputEventIds: ["event_negotiation_head"],
      expectedStateVersion: 18,
      expectedLastEventId: "event_negotiation_head",
      provider: "openai-responses",
      model: "gpt-5.6-luna",
      providerProtocolVersion: HEARING_NEGOTIATION_PROVIDER_PROTOCOL_VERSION,
      promptVersion: HEARING_NEGOTIATION_AGENT_PROMPT_VERSION,
      outputSchemaVersion: NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.v2",
        knowledgeViewHash: HASH_A,
        stateVersion: 18,
        factCount: 2,
        evidenceCount: 1,
        testimonyCount: 1,
        priorStatementCount: 0,
        sourceSegmentCount: 1,
        publicRecordEventCount: 1,
        currentExchangeCount: 0,
      },
      promptAudit: {
        stablePrefixHash: HASH_A,
        trustedContextHash: HASH_B,
        untrustedInputHash: HASH_C,
        inputCharacterCount: 3_200,
      },
      status: "accepted",
      startedAt: "2026-07-19T07:00:00.000Z",
      completedAt: "2026-07-19T07:00:00.640Z",
      latencyMs,
      firstStructuredDeltaMs: 125,
      firstAcceptedSegmentMs: null,
      retryCount: 0,
      validationFailureCount: 0,
      estimatedCostUsd,
      usage,
      acceptedAttempt: 1,
      acceptedCitations: citations,
      acceptedCitationCount: Object.values(citations).reduce(
        (total, identifiers) => total + identifiers.length,
        0,
      ),
      outputHash,
      outputCharacterCount: JSON.stringify(output).length,
      committedActionId: null,
      committedEventId: null,
      safeFailureCode: null,
      attempts: [
        {
          schemaVersion: COURTROOM_MODEL_CALL_ATTEMPT_TRACE_SCHEMA_VERSION,
          attempt: 1,
          mode: "initial",
          status: "accepted",
          providerRequestId: "request:openai:negotiation:001",
          providerResponseId: "response:openai:negotiation:001",
          startedAt: "2026-07-19T07:00:00.000Z",
          completedAt: "2026-07-19T07:00:00.640Z",
          latencyMs,
          firstStructuredDeltaMs: 125,
          streamEventCount: 14,
          structuredDeltaCount: 5,
          streamedCharacterCount: JSON.stringify(output).length,
          outputHash,
          proposedCitationCount:
            negotiationAgentProposedCitationCount(output),
          usage,
          validationIssueCodes: [],
          safeErrorCode: null,
        },
      ],
    },
  });
}

describe("hearing negotiation precommit boundary", () => {
  it("accepts and exports an exact private Luna negotiation handoff", () => {
    const envelope = validPrecommit();

    expect(HearingNegotiationPrecommitSchema.parse(envelope)).toEqual(envelope);
    expect(ExportedHearingNegotiationPrecommitSchema).toBe(
      HearingNegotiationPrecommitSchema,
    );
  });

  it("rejects altered identity, head, model, call class, and prompt bindings", () => {
    const envelope = validPrecommit();
    const invalid: unknown[] = [
      {
        ...envelope,
        trace: { ...envelope.trace, callId: "call:negotiation:other" },
      },
      {
        ...envelope,
        trace: { ...envelope.trace, expectedStateVersion: 19 },
      },
      {
        ...envelope,
        trace: { ...envelope.trace, inputEventIds: ["event_other_head"] },
      },
      {
        ...envelope,
        trace: {
          ...envelope.trace,
          knowledgeScope: {
            ...envelope.trace.knowledgeScope,
            stateVersion: 19,
          },
        },
      },
      {
        ...envelope,
        trace: { ...envelope.trace, callClass: "role_responder" },
      },
      {
        ...envelope,
        modelMetadata: { ...envelope.modelMetadata, model: "gpt-5.6-terra" },
        trace: { ...envelope.trace, model: "gpt-5.6-terra" },
      },
      {
        ...envelope,
        modelMetadata: {
          ...envelope.modelMetadata,
          promptVersion: "negotiation-agent.prompt.other",
        },
        trace: {
          ...envelope.trace,
          promptVersion: "negotiation-agent.prompt.other",
        },
      },
    ];

    invalid.forEach((candidate) => {
      expect(HearingNegotiationPrecommitSchema.safeParse(candidate).success).toBe(
        false,
      );
    });
  });

  it("rejects tampered output identity, citations, usage, and provider IDs", () => {
    const envelope = validPrecommit();
    const attempt = envelope.trace.attempts[0];
    expect(attempt).toBeDefined();
    if (attempt === undefined) throw new Error("Missing accepted attempt fixture");
    const emptyCitations = {
      factIds: [],
      evidenceIds: [],
      testimonyIds: [],
      eventIds: [],
      sourceSegmentIds: [],
      priorStatementIds: [],
    };
    const invalid: unknown[] = [
      {
        ...envelope,
        trace: {
          ...envelope.trace,
          outputHash: HASH_B,
          attempts: [{ ...attempt, outputHash: HASH_B }],
        },
      },
      {
        ...envelope,
        trace: {
          ...envelope.trace,
          outputCharacterCount: envelope.trace.outputCharacterCount + 1,
        },
      },
      {
        ...envelope,
        trace: {
          ...envelope.trace,
          acceptedCitations: emptyCitations,
          acceptedCitationCount: 0,
        },
      },
      {
        ...envelope,
        trace: {
          ...envelope.trace,
          attempts: [
            {
              ...attempt,
              proposedCitationCount: attempt.proposedCitationCount - 1,
            },
          ],
        },
      },
      {
        ...envelope,
        modelMetadata: {
          ...envelope.modelMetadata,
          inputTokens: (envelope.modelMetadata.inputTokens ?? 0) + 1,
        },
      },
      {
        ...envelope,
        modelMetadata: { ...envelope.modelMetadata, requestId: null },
        trace: {
          ...envelope.trace,
          attempts: [{ ...attempt, providerRequestId: null }],
        },
      },
      {
        ...envelope,
        trace: {
          ...envelope.trace,
          attempts: [{ ...attempt, providerResponseId: null }],
        },
      },
      {
        ...envelope,
        trace: {
          ...envelope.trace,
          usage: null,
          attempts: [{ ...attempt, usage: null }],
        },
        modelMetadata: {
          ...envelope.modelMetadata,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null,
        },
      },
    ];

    invalid.forEach((candidate) => {
      expect(HearingNegotiationPrecommitSchema.safeParse(candidate).success).toBe(
        false,
      );
    });
  });

  it("requires the decision identity and rejects every caller-owned commit ID", () => {
    const envelope = validPrecommit();
    const withoutDecision: Partial<HearingNegotiationPrecommit> = {
      ...envelope,
    };
    delete withoutDecision.decisionId;

    expect(
      HearingNegotiationPrecommitSchema.safeParse(withoutDecision).success,
    ).toBe(false);
    expect(
      HearingNegotiationPrecommitSchema.safeParse({
        ...envelope,
        actionId: "action_caller_owned",
      }).success,
    ).toBe(false);
    expect(
      HearingNegotiationPrecommitSchema.safeParse({
        ...envelope,
        trace: {
          ...envelope.trace,
          committedActionId: "action_already_committed",
        },
      }).success,
    ).toBe(false);
    expect(
      HearingNegotiationPrecommitSchema.safeParse({
        ...envelope,
        trace: {
          ...envelope.trace,
          committedEventId: "event_already_committed",
        },
      }).success,
    ).toBe(false);
  });
});
