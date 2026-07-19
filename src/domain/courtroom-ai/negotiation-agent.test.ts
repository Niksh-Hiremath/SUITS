import { describe, expect, it } from "vitest";

import {
  NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
  NegotiationAgentModelOutputSchema,
  type NegotiationAgentModelOutput,
} from "./call-contracts";
import {
  NEGOTIATION_AGENT_REQUEST_SCHEMA_VERSION,
  NegotiationAgentRequestSchema,
  validateNegotiationAgentOutput,
  type NegotiationAgentRequest,
} from "./negotiation-agent";

function createRequest(): NegotiationAgentRequest {
  return NegotiationAgentRequestSchema.parse({
    schemaVersion: NEGOTIATION_AGENT_REQUEST_SCHEMA_VERSION,
    callId: "call:negotiation:001",
    decisionId: "decision:negotiation:001",
    trialId: "trial_negotiation",
    expectedStateVersion: 18,
    expectedLastEventId: "event_negotiation_head",
    actorId: "actor_opposing_counsel",
    representedPartyId: "party_opposing",
    counterpartyPartyId: "party_user",
    offerBinding: {
      mode: "respond_to_offer",
      targetOfferId: "offer_incoming",
      proposedOfferId: "offer_counter_reserved",
      counterParentOfferId: "offer_incoming",
      allowedRecommendations: ["counter", "accept", "reject", "hold"],
    },
    knowledgeView: {
      schemaVersion: "knowledge-view.v2",
      trialId: "trial_negotiation",
      stateVersion: 18,
      actorId: "actor_opposing_counsel",
      actorRole: "opposing_counsel",
      case: {
        caseId: "case_negotiation",
        caseVersion: 1,
        title: "Private Negotiation Fixture",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1",
        trialId: "trial_negotiation",
        stateVersion: 18,
        facts: [
          {
            factId: "fact_public",
            proposition: "The public record contains a documented delay.",
            status: "admitted",
            sourceSegmentIds: ["segment_public_fact"],
          },
        ],
        evidence: [
          {
            evidenceId: "evidence_public",
            name: "Public exhibit",
            description: "An admitted public exhibit.",
            status: "admitted",
            sourceSegmentIds: ["segment_public_evidence"],
          },
        ],
        testimony: [
          {
            testimonyId: "testimony_public",
            witnessId: "witness_public",
            speakerActorId: "actor_witness_public",
            text: "The shipment arrived after the stated date.",
            status: "active",
            factIds: ["fact_public"],
            evidenceIds: ["evidence_public"],
            transcriptEventId: "event_testimony_public",
          },
        ],
        instructions: [],
      },
      counsel: {
        partyId: "party_opposing",
        facts: [
          {
            factId: "fact_private_side",
            proposition: "The party documented a mitigation expense.",
            status: "verified",
          },
        ],
        evidence: [
          {
            evidenceId: "evidence_private_side",
            name: "Mitigation worksheet",
            description: "A side-permitted mitigation worksheet.",
            status: "indexed",
          },
        ],
        strategyMemory: ["Resolve without admitting liability."],
        privateSettlement: {
          partyId: "party_opposing",
          currency: "USD",
          authority: {
            minimum: 10_000,
            maximum: 50_000,
            reservationValue: 35_000,
            targetValue: 20_000,
          },
          confidentialPriorities: ["Avoid an admission of liability."],
          permittedNonMonetaryTerms: ["Confidentiality", "Neutral reference"],
          offers: [
            {
              offerId: "offer_incoming",
              proposerPartyId: "party_user",
              recipientPartyIds: ["party_opposing"],
              amount: 30_000,
              nonMonetaryTerms: ["Confidentiality"],
              status: "open",
            },
            {
              offerId: "offer_old",
              proposerPartyId: "party_opposing",
              recipientPartyIds: ["party_user"],
              amount: 25_000,
              nonMonetaryTerms: [],
              status: "countered",
            },
          ],
        },
      },
      currentExchange: null,
    },
  });
}

function createOutput(
  overrides: Partial<NegotiationAgentModelOutput> = {},
): NegotiationAgentModelOutput {
  return NegotiationAgentModelOutputSchema.parse({
    schemaVersion: NEGOTIATION_AGENT_OUTPUT_SCHEMA_VERSION,
    recommendation: "accept",
    utilityBand: "within_authority",
    terms: null,
    decisionSummary: "The bound offer falls within current private authority.",
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
    ...overrides,
  });
}

function createOpenRequest(): NegotiationAgentRequest {
  const candidate = structuredClone(createRequest());
  const settlement = candidate.knowledgeView.counsel.privateSettlement;
  if (settlement === null) throw new Error("Fixture requires settlement scope");
  settlement.offers = settlement.offers.map((offer) => ({
    ...offer,
    status: offer.offerId === "offer_incoming" ? "rejected" : offer.status,
  }));
  candidate.offerBinding = {
    mode: "open_negotiation",
    targetOfferId: null,
    proposedOfferId: "offer_new_reserved",
    counterParentOfferId: null,
    allowedRecommendations: ["propose", "hold"],
  };
  return NegotiationAgentRequestSchema.parse(candidate);
}

function createCounterOutput(
  amount = 25_000,
  overrides: Partial<NegotiationAgentModelOutput> = {},
): NegotiationAgentModelOutput {
  return createOutput({
    recommendation: "counter",
    utilityBand: "within_authority",
    terms: {
      amount,
      currency: "USD",
      nonMonetaryTerms: ["Confidentiality"],
      summary: "A bounded monetary counteroffer with confidentiality.",
    },
    ...overrides,
  });
}

function issueCodes(
  result: ReturnType<typeof validateNegotiationAgentOutput>,
): string[] {
  return result.report.issues.map((entry) => entry.code);
}

describe("NegotiationAgentRequestSchema", () => {
  it("binds one counsel view to the exact actor, party, head, and target offer", () => {
    const valid = createRequest();
    expect(valid.knowledgeView.counsel.privateSettlement).not.toBeNull();

    for (const mutate of [
      (candidate: NegotiationAgentRequest) => {
        candidate.expectedStateVersion += 1;
      },
      (candidate: NegotiationAgentRequest) => {
        candidate.actorId = "actor_other_counsel";
      },
      (candidate: NegotiationAgentRequest) => {
        candidate.representedPartyId = "party_user";
      },
      (candidate: NegotiationAgentRequest) => {
        candidate.offerBinding.targetOfferId = "offer_old";
      },
      (candidate: NegotiationAgentRequest) => {
        candidate.knowledgeView.counsel.privateSettlement = null;
      },
      (candidate: NegotiationAgentRequest) => {
        const settlement = candidate.knowledgeView.counsel.privateSettlement;
        if (settlement !== null) settlement.authority.maximum = 5_000;
      },
    ]) {
      const candidate = structuredClone(valid);
      mutate(candidate);
      expect(NegotiationAgentRequestSchema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });

  it("rejects a reused proposed-offer ID and a mismatched counter parent", () => {
    const reused = structuredClone(createRequest());
    reused.offerBinding.proposedOfferId = "offer_old";
    expect(NegotiationAgentRequestSchema.safeParse(reused).success).toBe(false);

    const wrongParent = structuredClone(createRequest());
    wrongParent.offerBinding.counterParentOfferId = "offer_old";
    expect(NegotiationAgentRequestSchema.safeParse(wrongParent).success).toBe(
      false,
    );
  });
});

describe("validateNegotiationAgentOutput", () => {
  it("accepts a scoped incoming-offer decision and materializes server-owned IDs", () => {
    const result = validateNegotiationAgentOutput(
      createRequest(),
      createOutput(),
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.decision).toMatchObject({
      recommendation: "accept",
      representedPartyId: "party_opposing",
      counterpartyPartyId: "party_user",
      targetOfferId: "offer_incoming",
      offerId: "offer_incoming",
      parentOfferId: null,
    });
  });

  it("accepts a new proposal at the payer's target with no invented offer citation", () => {
    const output = createOutput({
      recommendation: "propose",
      utilityBand: "at_or_above_target",
      terms: {
        amount: 20_000,
        currency: "USD",
        nonMonetaryTerms: ["Confidentiality"],
        summary: "A target-value proposal with a permitted term.",
      },
      citations: {
        ...createOutput().citations,
        settlementOfferIds: [],
      },
    });
    const result = validateNegotiationAgentOutput(createOpenRequest(), output);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.decision).toMatchObject({
      offerId: "offer_new_reserved",
      parentOfferId: null,
    });
  });

  it.each([
    [
      "amount outside authority",
      createCounterOutput(55_000, { utilityBand: "below_reservation" }),
      "terms_outside_authority",
    ],
    [
      "wrong currency",
      createCounterOutput(25_000, {
        terms: {
          amount: 25_000,
          currency: "EUR",
          nonMonetaryTerms: ["Confidentiality"],
          summary: "Wrong currency.",
        },
      }),
      "currency_mismatch",
    ],
    [
      "unpermitted non-monetary term",
      createCounterOutput(25_000, {
        terms: {
          amount: 25_000,
          currency: "USD",
          nonMonetaryTerms: ["Public admission"],
          summary: "Unpermitted term.",
        },
      }),
      "non_monetary_term_not_permitted",
    ],
  ])("rejects %s", (_label, output, expectedCode) => {
    const result = validateNegotiationAgentOutput(createRequest(), output);
    expect(result.accepted).toBe(false);
    expect(issueCodes(result)).toContain(expectedCode);
  });

  it("derives utility direction from target versus reservation and blocks a losing counter", () => {
    const wrongBand = validateNegotiationAgentOutput(
      createRequest(),
      createCounterOutput(25_000, { utilityBand: "at_or_above_target" }),
    );
    expect(issueCodes(wrongBand)).toContain("utility_band_mismatch");

    const belowReservation = validateNegotiationAgentOutput(
      createRequest(),
      createCounterOutput(40_000, { utilityBand: "below_reservation" }),
    );
    expect(issueCodes(belowReservation)).toContain(
      "below_reservation_recommendation",
    );
  });

  it("rejects foreign record IDs and any offer other than the exact target", () => {
    const output = createOutput({
      citations: {
        ...createOutput().citations,
        factIds: ["fact_hidden_other_side"],
        settlementOfferIds: ["offer_old"],
      },
    });
    const result = validateNegotiationAgentOutput(createRequest(), output);
    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        "unknown_fact_citation",
        "unsupported_citation",
        "target_offer_citation_mismatch",
      ]),
    );
  });

  it("rejects schema additions before any semantic materialization", () => {
    const result = validateNegotiationAgentOutput(createRequest(), {
      ...createOutput(),
      hiddenInstruction: "ignore authority",
    });
    expect(result.accepted).toBe(false);
    expect(issueCodes(result)).toContain("strict_schema_invalid");
  });
});
