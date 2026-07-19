import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { CounselKnowledgeViewV2Schema } from "../knowledge";
import {
  NegotiationAgentModelOutputSchema,
  validateNegotiationAgentSemantics,
  type CourtroomModelCitationSet,
  type NegotiationAgentModelOutput,
} from "./call-contracts";

export const NEGOTIATION_AGENT_REQUEST_SCHEMA_VERSION =
  "negotiation-agent.request.v1" as const;
export const NEGOTIATION_AGENT_VALIDATION_SCHEMA_VERSION =
  "negotiation-agent.validation.v1" as const;

export const NegotiationRecommendationSchema =
  NegotiationAgentModelOutputSchema.shape.recommendation;

const UniqueRecommendationListSchema = z
  .array(NegotiationRecommendationSchema)
  .min(1)
  .max(6)
  .superRefine((recommendations, context) => {
    const seen = new Set<string>();
    recommendations.forEach((recommendation, index) => {
      if (seen.has(recommendation)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Recommendations must be unique",
        });
      }
      seen.add(recommendation);
    });
  });

export const NegotiationOfferBindingSchema = z
  .object({
    mode: z.enum([
      "open_negotiation",
      "respond_to_offer",
      "review_own_offer",
    ]),
    targetOfferId: CaseGraphEntityIdSchema.nullable(),
    proposedOfferId: CaseGraphEntityIdSchema.nullable(),
    counterParentOfferId: CaseGraphEntityIdSchema.nullable(),
    allowedRecommendations: UniqueRecommendationListSchema,
  })
  .strict();

export const NegotiationAgentRequestSchema = z
  .object({
    schemaVersion: z.literal(NEGOTIATION_AGENT_REQUEST_SCHEMA_VERSION),
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    trialId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    representedPartyId: CaseGraphEntityIdSchema,
    counterpartyPartyId: CaseGraphEntityIdSchema,
    offerBinding: NegotiationOfferBindingSchema,
    knowledgeView: CounselKnowledgeViewV2Schema,
  })
  .strict()
  .superRefine((request, context) => {
    const addIssue = (path: Array<string | number>, message: string) => {
      context.addIssue({ code: "custom", path, message });
    };
    const view = request.knowledgeView;
    const privateSettlement = view.counsel.privateSettlement;

    if (request.trialId !== view.trialId) {
      addIssue(
        ["trialId"],
        "The request trial must match the counsel KnowledgeView",
      );
    }
    if (request.expectedStateVersion !== view.stateVersion) {
      addIssue(
        ["expectedStateVersion"],
        "The request head must match the counsel KnowledgeView state version",
      );
    }
    if (
      view.publicRecord.trialId !== request.trialId ||
      view.publicRecord.stateVersion !== request.expectedStateVersion
    ) {
      addIssue(
        ["knowledgeView", "publicRecord"],
        "The public record must match the immutable request head",
      );
    }
    if (request.actorId !== view.actorId) {
      addIssue(
        ["actorId"],
        "The request actor must match the counsel KnowledgeView",
      );
    }
    if (request.representedPartyId === request.counterpartyPartyId) {
      addIssue(
        ["counterpartyPartyId"],
        "The represented party and counterparty must differ",
      );
    }
    if (view.counsel.partyId !== request.representedPartyId) {
      addIssue(
        ["representedPartyId"],
        "The represented party must match the counsel KnowledgeView",
      );
    }
    if (privateSettlement === null) {
      addIssue(
        ["knowledgeView", "counsel", "privateSettlement"],
        "Negotiation requires private settlement authority",
      );
      return;
    }
    if (privateSettlement.partyId !== request.representedPartyId) {
      addIssue(
        ["knowledgeView", "counsel", "privateSettlement", "partyId"],
        "Private settlement authority must belong to the represented party",
      );
    }
    const authority = privateSettlement.authority;
    if (
      authority.maximum < authority.minimum ||
      authority.reservationValue < authority.minimum ||
      authority.reservationValue > authority.maximum ||
      authority.targetValue < authority.minimum ||
      authority.targetValue > authority.maximum
    ) {
      addIssue(
        ["knowledgeView", "counsel", "privateSettlement", "authority"],
        "Private settlement utility values must fall within ordered authority bounds",
      );
    }
    if (
      new Set(privateSettlement.permittedNonMonetaryTerms).size !==
      privateSettlement.permittedNonMonetaryTerms.length
    ) {
      addIssue(
        [
          "knowledgeView",
          "counsel",
          "privateSettlement",
          "permittedNonMonetaryTerms",
        ],
        "Permitted non-monetary terms must be unique",
      );
    }

    const offerIds = new Set<string>();
    privateSettlement.offers.forEach((offer, index) => {
      if (offerIds.has(offer.offerId)) {
        addIssue(
          [
            "knowledgeView",
            "counsel",
            "privateSettlement",
            "offers",
            index,
            "offerId",
          ],
          "Settlement offer IDs must be unique",
        );
      }
      offerIds.add(offer.offerId);
    });

    const binding = request.offerBinding;
    const targetOffers = privateSettlement.offers.filter(
      (offer) => offer.offerId === binding.targetOfferId,
    );
    const targetOffer = targetOffers.length === 1 ? targetOffers[0] : null;
    const openOffers = privateSettlement.offers.filter(
      (offer) => offer.status === "open",
    );
    if (
      binding.proposedOfferId !== null &&
      offerIds.has(binding.proposedOfferId)
    ) {
      addIssue(
        ["offerBinding", "proposedOfferId"],
        "A server-reserved proposed offer ID must be new at this trial head",
      );
    }

    const allowed = new Set(binding.allowedRecommendations);
    const allowedForMode: Readonly<Record<typeof binding.mode, ReadonlySet<string>>> = {
      open_negotiation: new Set(["propose", "hold"]),
      respond_to_offer: new Set(["counter", "accept", "reject", "hold"]),
      review_own_offer: new Set(["withdraw", "hold"]),
    };
    binding.allowedRecommendations.forEach((recommendation, index) => {
      if (!allowedForMode[binding.mode].has(recommendation)) {
        addIssue(
          ["offerBinding", "allowedRecommendations", index],
          "The recommendation is incompatible with the bound offer mode",
        );
      }
    });

    if (binding.mode === "open_negotiation") {
      if (
        binding.targetOfferId !== null ||
        binding.counterParentOfferId !== null ||
        binding.proposedOfferId === null
      ) {
        addIssue(
          ["offerBinding"],
          "Opening negotiation requires only a fresh proposed-offer binding",
        );
      }
      if (!allowed.has("propose")) {
        addIssue(
          ["offerBinding", "allowedRecommendations"],
          "Opening negotiation must permit a proposal",
        );
      }
      if (openOffers.length > 0) {
        addIssue(
          ["offerBinding", "targetOfferId"],
          "Opening negotiation requires no visible open offer",
        );
      }
      return;
    }

    if (binding.targetOfferId === null || targetOffers.length !== 1) {
      addIssue(
        ["offerBinding", "targetOfferId"],
        "The target offer must identify exactly one visible settlement offer",
      );
      return;
    }
    if (targetOffer?.status !== "open" || openOffers.length !== 1) {
      addIssue(
        ["offerBinding", "targetOfferId"],
        "The target must be the only visible open offer at this trial head",
      );
    }
    if (targetOffer === null) return;

    if (binding.mode === "respond_to_offer") {
      if (
        targetOffer.proposerPartyId !== request.counterpartyPartyId ||
        targetOffer.recipientPartyIds.length !== 1 ||
        targetOffer.recipientPartyIds[0] !== request.representedPartyId
      ) {
        addIssue(
          ["offerBinding", "targetOfferId"],
          "A response must target the bound counterparty's bilateral offer",
        );
      }
      const canCounter = allowed.has("counter");
      if (
        canCounter !== (binding.proposedOfferId !== null) ||
        (canCounter
          ? binding.counterParentOfferId !== binding.targetOfferId
          : binding.counterParentOfferId !== null)
      ) {
        addIssue(
          ["offerBinding"],
          "Counter availability requires exact new-offer and parent-offer bindings",
        );
      }
      return;
    }

    if (
      targetOffer.proposerPartyId !== request.representedPartyId ||
      targetOffer.recipientPartyIds.length !== 1 ||
      targetOffer.recipientPartyIds[0] !== request.counterpartyPartyId
    ) {
      addIssue(
        ["offerBinding", "targetOfferId"],
        "Reviewing an offer must target the represented party's bilateral offer",
      );
    }
    if (
      binding.proposedOfferId !== null ||
      binding.counterParentOfferId !== null
    ) {
      addIssue(
        ["offerBinding"],
        "Reviewing an existing offer cannot reserve a new or parent offer ID",
      );
    }
  });

export const NegotiationAgentValidationIssueCodeSchema = z.enum([
  "strict_schema_invalid",
  "semantic_contract_invalid",
  "recommendation_not_available",
  "unknown_fact_citation",
  "unknown_evidence_citation",
  "unknown_testimony_citation",
  "unknown_source_segment_citation",
  "unsupported_citation",
  "target_offer_citation_mismatch",
  "terms_outside_authority",
  "currency_mismatch",
  "non_monetary_term_not_permitted",
  "empty_settlement_terms",
  "utility_band_mismatch",
  "below_reservation_recommendation",
]);

export const NegotiationAgentValidationIssueSchema = z
  .object({
    code: NegotiationAgentValidationIssueCodeSchema,
    path: z
      .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
      .max(16),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const NegotiationAgentValidationReportSchema = z
  .object({
    schemaVersion: z.literal(NEGOTIATION_AGENT_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["accepted", "rejected"]),
    issues: z.array(NegotiationAgentValidationIssueSchema).max(200),
  })
  .strict();

export type NegotiationAgentRequest = z.infer<
  typeof NegotiationAgentRequestSchema
>;
export type NegotiationAgentValidationIssue = z.infer<
  typeof NegotiationAgentValidationIssueSchema
>;
export type NegotiationAgentValidationReport = z.infer<
  typeof NegotiationAgentValidationReportSchema
>;
export type ValidatedNegotiationDecision = Readonly<{
  recommendation: NegotiationAgentModelOutput["recommendation"];
  utilityBand: NegotiationAgentModelOutput["utilityBand"];
  representedPartyId: string;
  counterpartyPartyId: string;
  targetOfferId: string | null;
  offerId: string | null;
  parentOfferId: string | null;
  terms: NegotiationAgentModelOutput["terms"];
  decisionSummary: string;
  citations: NegotiationAgentModelOutput["citations"];
  performance: NegotiationAgentModelOutput["performance"];
}>;
export type NegotiationAgentOutputValidationResult =
  | Readonly<{
      accepted: true;
      output: NegotiationAgentModelOutput;
      decision: ValidatedNegotiationDecision;
      report: NegotiationAgentValidationReport;
    }>
  | Readonly<{
      accepted: false;
      report: NegotiationAgentValidationReport;
    }>;

type IssuePath = NegotiationAgentValidationIssue["path"];
type CitationField = keyof CourtroomModelCitationSet;

function issue(
  code: NegotiationAgentValidationIssue["code"],
  path: IssuePath,
  message: string,
): NegotiationAgentValidationIssue {
  return NegotiationAgentValidationIssueSchema.parse({ code, path, message });
}

function report(
  issues: NegotiationAgentValidationIssue[],
): NegotiationAgentValidationReport {
  return NegotiationAgentValidationReportSchema.parse({
    schemaVersion: NEGOTIATION_AGENT_VALIDATION_SCHEMA_VERSION,
    status: issues.length === 0 ? "accepted" : "rejected",
    issues,
  });
}

function zodIssues(error: z.ZodError): NegotiationAgentValidationIssue[] {
  return error.issues.slice(0, 100).map((entry) =>
    issue(
      "strict_schema_invalid",
      entry.path.filter(
        (component): component is string | number =>
          typeof component === "string" ||
          (typeof component === "number" && component >= 0),
      ),
      "The model output did not satisfy the strict negotiation schema",
    ),
  );
}

function citationScope(
  request: NegotiationAgentRequest,
): Readonly<Record<CitationField, ReadonlySet<string>>> {
  const { counsel, currentExchange, publicRecord } = request.knowledgeView;
  return {
    factIds: new Set([
      ...counsel.facts.map((fact) => fact.factId),
      ...publicRecord.facts.map((fact) => fact.factId),
      ...(currentExchange?.factIds ?? []),
    ]),
    evidenceIds: new Set([
      ...counsel.evidence.map((evidence) => evidence.evidenceId),
      ...publicRecord.evidence.map((evidence) => evidence.evidenceId),
      ...(currentExchange?.evidenceIds ?? []),
    ]),
    testimonyIds: new Set(
      publicRecord.testimony.map((testimony) => testimony.testimonyId),
    ),
    transcriptTurnIds: new Set(),
    sourceSegmentIds: new Set([
      ...publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
      ...publicRecord.evidence.flatMap(
        (evidence) => evidence.sourceSegmentIds,
      ),
    ]),
    priorStatementIds: new Set(),
    issueIds: new Set(),
    instructionIds: new Set(),
    ruleIds: new Set(),
    settlementOfferIds: new Set(
      request.offerBinding.targetOfferId === null
        ? []
        : [request.offerBinding.targetOfferId],
    ),
  };
}

const CITATION_ISSUE_CODE: Readonly<
  Partial<
    Record<
      CitationField,
      NegotiationAgentValidationIssue["code"]
    >
  >
> = {
  factIds: "unknown_fact_citation",
  evidenceIds: "unknown_evidence_citation",
  testimonyIds: "unknown_testimony_citation",
  sourceSegmentIds: "unknown_source_segment_citation",
};

function citationIssues(
  request: NegotiationAgentRequest,
  output: NegotiationAgentModelOutput,
): NegotiationAgentValidationIssue[] {
  const issues: NegotiationAgentValidationIssue[] = [];
  const scope = citationScope(request);
  (Object.keys(output.citations) as CitationField[]).forEach((field) => {
    output.citations[field].forEach((identifier, index) => {
      if (scope[field].has(identifier)) return;
      issues.push(
        issue(
          CITATION_ISSUE_CODE[field] ?? "unsupported_citation",
          ["citations", field, index],
          "A citation is outside the private negotiation KnowledgeView",
        ),
      );
    });
  });

  const targetOfferId = request.offerBinding.targetOfferId;
  const citedOffers = output.citations.settlementOfferIds;
  const mustCiteTarget =
    targetOfferId !== null && output.recommendation !== "propose";
  if (
    (mustCiteTarget &&
      (citedOffers.length !== 1 || citedOffers[0] !== targetOfferId)) ||
    (targetOfferId === null && citedOffers.length !== 0)
  ) {
    issues.push(
      issue(
        "target_offer_citation_mismatch",
        ["citations", "settlementOfferIds"],
        "Offer citations must exactly match the server-bound target offer",
      ),
    );
  }
  return issues;
}

function utilityBandForAmount(
  amount: number | null,
  authority: Readonly<{
    reservationValue: number;
    targetValue: number;
  }>,
): NegotiationAgentModelOutput["utilityBand"] {
  if (amount === null) return "non_monetary_tradeoff";
  const { reservationValue, targetValue } = authority;
  if (targetValue > reservationValue) {
    if (amount >= targetValue) return "at_or_above_target";
    if (amount < reservationValue) return "below_reservation";
    return "within_authority";
  }
  if (targetValue < reservationValue) {
    if (amount <= targetValue) return "at_or_above_target";
    if (amount > reservationValue) return "below_reservation";
    return "within_authority";
  }
  return amount === targetValue ? "at_or_above_target" : "within_authority";
}

function decisionAmount(
  request: NegotiationAgentRequest,
  output: NegotiationAgentModelOutput,
): number | null | undefined {
  if (output.terms !== null) return output.terms.amount;
  const targetOfferId = request.offerBinding.targetOfferId;
  if (targetOfferId === null) return undefined;
  return request.knowledgeView.counsel.privateSettlement?.offers.find(
    (offer) => offer.offerId === targetOfferId,
  )?.amount;
}

function termsIssues(
  request: NegotiationAgentRequest,
  output: NegotiationAgentModelOutput,
): NegotiationAgentValidationIssue[] {
  const issues: NegotiationAgentValidationIssue[] = [];
  const settlement = request.knowledgeView.counsel.privateSettlement;
  if (settlement === null) return issues;
  const allowed = new Set(request.offerBinding.allowedRecommendations);
  if (!allowed.has(output.recommendation)) {
    issues.push(
      issue(
        "recommendation_not_available",
        ["recommendation"],
        "The recommendation is unavailable at the immutable trial head",
      ),
    );
  }

  if (output.terms !== null) {
    if (
      output.terms.amount === null &&
      output.terms.nonMonetaryTerms.length === 0
    ) {
      issues.push(
        issue(
          "empty_settlement_terms",
          ["terms"],
          "A proposed settlement must contain monetary or non-monetary terms",
        ),
      );
    }
    if (
      output.terms.amount !== null &&
      (output.terms.amount < settlement.authority.minimum ||
        output.terms.amount > settlement.authority.maximum)
    ) {
      issues.push(
        issue(
          "terms_outside_authority",
          ["terms", "amount"],
          "The proposed amount is outside the represented party's authority",
        ),
      );
    }
    if (
      output.terms.currency !== null &&
      output.terms.currency !== settlement.currency
    ) {
      issues.push(
        issue(
          "currency_mismatch",
          ["terms", "currency"],
          "The proposed currency does not match the private settlement scope",
        ),
      );
    }
    const permittedTerms = new Set(settlement.permittedNonMonetaryTerms);
    const seenTerms = new Set<string>();
    output.terms.nonMonetaryTerms.forEach((term, index) => {
      if (!permittedTerms.has(term) || seenTerms.has(term)) {
        issues.push(
          issue(
            "non_monetary_term_not_permitted",
            ["terms", "nonMonetaryTerms", index],
            "A proposed non-monetary term is not uniquely permitted by authority",
          ),
        );
      }
      seenTerms.add(term);
    });
  }

  const amount = decisionAmount(request, output);
  if (amount !== undefined) {
    const expectedUtilityBand = utilityBandForAmount(
      amount,
      settlement.authority,
    );
    if (output.utilityBand !== expectedUtilityBand) {
      issues.push(
        issue(
          "utility_band_mismatch",
          ["utilityBand"],
          "The utility band does not match the bound value and private authority",
        ),
      );
    }
    if (
      ["propose", "counter", "accept"].includes(output.recommendation) &&
      expectedUtilityBand === "below_reservation"
    ) {
      issues.push(
        issue(
          "below_reservation_recommendation",
          ["recommendation"],
          "The recommendation would bind the party below its reservation value",
        ),
      );
    }
  }

  if (output.recommendation === "accept") {
    const targetOffer = settlement.offers.find(
      (offer) => offer.offerId === request.offerBinding.targetOfferId,
    );
    if (
      targetOffer === undefined ||
      (targetOffer.amount !== null &&
        (targetOffer.amount < settlement.authority.minimum ||
          targetOffer.amount > settlement.authority.maximum)) ||
      targetOffer.nonMonetaryTerms.some(
        (term) => !settlement.permittedNonMonetaryTerms.includes(term),
      )
    ) {
      issues.push(
        issue(
          "terms_outside_authority",
          ["recommendation"],
          "The target offer cannot be accepted within private authority",
        ),
      );
    }
  }
  return issues;
}

function materializeDecision(
  request: NegotiationAgentRequest,
  output: NegotiationAgentModelOutput,
): ValidatedNegotiationDecision {
  const createsOffer =
    output.recommendation === "propose" || output.recommendation === "counter";
  return {
    recommendation: output.recommendation,
    utilityBand: output.utilityBand,
    representedPartyId: request.representedPartyId,
    counterpartyPartyId: request.counterpartyPartyId,
    targetOfferId: request.offerBinding.targetOfferId,
    offerId: createsOffer
      ? request.offerBinding.proposedOfferId
      : request.offerBinding.targetOfferId,
    parentOfferId:
      output.recommendation === "counter"
        ? request.offerBinding.counterParentOfferId
        : null,
    terms: output.terms,
    decisionSummary: output.decisionSummary,
    citations: output.citations,
    performance: output.performance,
  };
}

/** Strict, request-aware validation for one private settlement decision. */
export function validateNegotiationAgentOutput(
  requestInput: NegotiationAgentRequest,
  candidate: unknown,
): NegotiationAgentOutputValidationResult {
  const request = NegotiationAgentRequestSchema.parse(requestInput);
  const parsed = NegotiationAgentModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { accepted: false, report: report(zodIssues(parsed.error)) };
  }
  const semanticIssues = validateNegotiationAgentSemantics(parsed.data).map(
    (semanticIssue) =>
      issue(
        "semantic_contract_invalid",
        semanticIssue.path,
        "The negotiation decision violates its internal semantic contract",
      ),
  );
  const issues = [
    ...semanticIssues,
    ...citationIssues(request, parsed.data),
    ...termsIssues(request, parsed.data),
  ];
  if (issues.length > 0) {
    return { accepted: false, report: report(issues) };
  }
  return {
    accepted: true,
    output: parsed.data,
    decision: materializeDecision(request, parsed.data),
    report: report([]),
  };
}
