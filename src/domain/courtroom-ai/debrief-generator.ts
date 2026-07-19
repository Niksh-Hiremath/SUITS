import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { DebriefKnowledgeViewV2Schema } from "../knowledge";
import {
  DebriefGeneratorModelOutputSchema,
  validateDebriefGeneratorSemantics,
  type DebriefCitationSet,
  type DebriefGeneratorModelOutput,
} from "./call-contracts";

export const DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION =
  "debrief-generator.request.v1" as const;
export const DEBRIEF_GENERATOR_VALIDATION_SCHEMA_VERSION =
  "debrief-generator.validation.v1" as const;

const UniqueIdListSchema = (maximum: number) =>
  z
    .array(CaseGraphEntityIdSchema)
    .max(maximum)
    .superRefine((identifiers, context) => {
      const seen = new Set<string>();
      identifiers.forEach((identifier, index) => {
        if (seen.has(identifier)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: "Identifiers must be unique",
          });
        }
        seen.add(identifier);
      });
    });

const AuditCitationSchema = z
  .object({
    factIds: UniqueIdListSchema(128),
    evidenceIds: UniqueIdListSchema(128),
    testimonyIds: UniqueIdListSchema(128),
    eventIds: UniqueIdListSchema(128),
    sourceSegmentIds: UniqueIdListSchema(128),
  })
  .strict();

export const DebriefTranscriptTurnSchema = z
  .object({
    turnId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    actorRole: z.enum([
      "user_counsel",
      "opposing_counsel",
      "witness",
      "judge",
      "jury",
      "clerk",
      "debrief_coach",
      "system",
    ]),
    text: z.string().trim().min(1).max(20_000),
    testimonyId: CaseGraphEntityIdSchema.nullable(),
    status: z.enum(["active", "stricken"]),
    sourceEventId: CaseGraphEntityIdSchema,
    citations: AuditCitationSchema,
  })
  .strict();

export const DebriefProceduralAuditSchema = z
  .object({
    objections: z
      .array(
        z
          .object({
            objectionId: CaseGraphEntityIdSchema,
            questionId: CaseGraphEntityIdSchema,
            objectorActorId: CaseGraphEntityIdSchema,
            ground: z.enum([
              "relevance",
              "hearsay",
              "leading",
              "speculation",
              "foundation",
              "asked_and_answered",
              "argumentative",
              "compound",
              "privilege",
            ]),
            status: z.enum([
              "pending",
              "sustained",
              "overruled",
              "withdrawn",
            ]),
            remedy: z
              .enum([
                "none",
                "rephrase",
                "strike",
                "cancel_response",
                "resume_response",
              ])
              .nullable(),
            rulingReason: z.string().trim().min(1).max(4_000).nullable(),
            sourceEventId: CaseGraphEntityIdSchema,
            rulingEventId: CaseGraphEntityIdSchema.nullable(),
          })
          .strict(),
      )
      .max(256),
    settlementOffers: z
      .array(
        z
          .object({
            offerId: CaseGraphEntityIdSchema,
            parentOfferId: CaseGraphEntityIdSchema.nullable(),
            proposedByPartyId: CaseGraphEntityIdSchema,
            recipientPartyIds: UniqueIdListSchema(16),
            amount: z.number().nonnegative().nullable(),
            currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
            nonMonetaryTerms: z.array(z.string().trim().min(1).max(1_000)).max(32),
            summary: z.string().trim().min(1).max(4_000),
            status: z.enum([
              "open",
              "countered",
              "accepted",
              "rejected",
              "withdrawn",
              "expired",
            ]),
            sourceEventId: CaseGraphEntityIdSchema,
            lastEventId: CaseGraphEntityIdSchema,
          })
          .strict(),
      )
      .max(256),
    closingTurnIds: UniqueIdListSchema(16),
    restedSides: z.array(z.enum(["user", "opposing"])).max(2),
    deliberated: z.boolean(),
    verdict: z
      .object({
        verdictId: CaseGraphEntityIdSchema,
        decision: z.string().trim().min(1).max(4_000),
        sourceEventId: CaseGraphEntityIdSchema,
        citations: AuditCitationSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const DebriefGeneratorRequestSchema = z
  .object({
    schemaVersion: z.literal(DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION),
    callId: CaseGraphEntityIdSchema,
    trialId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    knowledgeView: DebriefKnowledgeViewV2Schema,
    transcript: z.array(DebriefTranscriptTurnSchema).max(2_000),
    procedure: DebriefProceduralAuditSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.trialId !== request.knowledgeView.trialId ||
      request.expectedStateVersion !== request.knowledgeView.stateVersion ||
      request.actorId !== request.knowledgeView.actorId
    ) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeView"],
        message: "Debrief KnowledgeView must match the exact request binding",
      });
    }
    const turnIds = new Set<string>();
    request.transcript.forEach((turn, index) => {
      if (turnIds.has(turn.turnId)) {
        context.addIssue({
          code: "custom",
          path: ["transcript", index, "turnId"],
          message: "Transcript turn IDs must be unique",
        });
      }
      turnIds.add(turn.turnId);
    });
    request.procedure.closingTurnIds.forEach((turnId, index) => {
      if (!turnIds.has(turnId)) {
        context.addIssue({
          code: "custom",
          path: ["procedure", "closingTurnIds", index],
          message: "Closing audit references an unknown transcript turn",
        });
      }
    });
  });

export const DebriefGeneratorValidationIssueCodeSchema = z.enum([
  "strict_schema_invalid",
  "semantic_contract_invalid",
  "citation_outside_audit",
]);

export const DebriefGeneratorValidationIssueSchema = z
  .object({
    code: DebriefGeneratorValidationIssueCodeSchema,
    path: z
      .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
      .max(16),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const DebriefGeneratorValidationReportSchema = z
  .object({
    schemaVersion: z.literal(DEBRIEF_GENERATOR_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["accepted", "rejected"]),
    issues: z.array(DebriefGeneratorValidationIssueSchema).max(300),
  })
  .strict();

export type DebriefGeneratorRequest = z.infer<
  typeof DebriefGeneratorRequestSchema
>;
export type DebriefGeneratorValidationIssue = z.infer<
  typeof DebriefGeneratorValidationIssueSchema
>;
export type DebriefGeneratorValidationReport = z.infer<
  typeof DebriefGeneratorValidationReportSchema
>;

export type DebriefGeneratorValidationResult =
  | Readonly<{
      accepted: true;
      output: DebriefGeneratorModelOutput;
      report: DebriefGeneratorValidationReport;
    }>
  | Readonly<{
      accepted: false;
      report: DebriefGeneratorValidationReport;
    }>;

type CitationField = keyof DebriefCitationSet;

function issue(
  code: DebriefGeneratorValidationIssue["code"],
  path: DebriefGeneratorValidationIssue["path"],
  message: string,
): DebriefGeneratorValidationIssue {
  return DebriefGeneratorValidationIssueSchema.parse({ code, path, message });
}

function report(
  issues: DebriefGeneratorValidationIssue[],
): DebriefGeneratorValidationReport {
  return DebriefGeneratorValidationReportSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_VALIDATION_SCHEMA_VERSION,
    status: issues.length === 0 ? "accepted" : "rejected",
    issues,
  });
}

function citationSets(
  output: DebriefGeneratorModelOutput,
): Array<Readonly<{ path: Array<string | number>; citations: DebriefCitationSet }>> {
  const sets: Array<
    Readonly<{ path: Array<string | number>; citations: DebriefCitationSet }>
  > = [
    {
      path: ["overallAssessment", "citations"],
      citations: output.overallAssessment.citations,
    },
  ];
  for (const field of [
    "strengths",
    "weakQuestions",
    "missedEvidence",
    "contradictions",
    "objectionAccuracy",
    "witnessStrategy",
    "settlementChoices",
    "juryMovement",
  ] as const) {
    output[field].forEach((point, index) => {
      sets.push({
        path: [field, index, "citations"],
        citations: point.citations,
      });
    });
  }
  output.improvedClosing.segments.forEach((segment, index) => {
    sets.push({
      path: ["improvedClosing", "segments", index, "citations"],
      citations: segment.citations,
    });
  });
  return sets;
}

function citationScope(
  request: DebriefGeneratorRequest,
): Readonly<Record<CitationField, ReadonlySet<string>>> {
  const strata = request.knowledgeView.strata;
  return {
    admittedFactIds: new Set(
      strata.admittedRecord.record.facts.map((fact) => fact.factId),
    ),
    admittedEvidenceIds: new Set(
      strata.admittedRecord.record.evidence.map(
        (evidence) => evidence.evidenceId,
      ),
    ),
    activeTestimonyIds: new Set(
      strata.admittedRecord.record.testimony.map(
        (testimony) => testimony.testimonyId,
      ),
    ),
    transcriptTurnIds: new Set(request.transcript.map((turn) => turn.turnId)),
    unadmittedFactIds: new Set(
      strata.unadmittedRecord.facts.map((fact) => fact.factId),
    ),
    unadmittedEvidenceIds: new Set(
      strata.unadmittedRecord.evidence.map(
        (evidence) => evidence.evidenceId,
      ),
    ),
    excludedFactIds: new Set(
      strata.excludedOrStricken.facts.map((fact) => fact.factId),
    ),
    excludedEvidenceIds: new Set(
      strata.excludedOrStricken.evidence.map(
        (evidence) => evidence.evidenceId,
      ),
    ),
    strickenTestimonyIds: new Set(
      strata.excludedOrStricken.testimony.map(
        (testimony) => testimony.testimonyId,
      ),
    ),
    hiddenFactIds: new Set(
      strata.hiddenAuthoringTruth.facts.map((fact) => fact.factId),
    ),
    hiddenSourceSegmentIds: new Set(
      strata.hiddenAuthoringTruth.facts.flatMap(
        (fact) => fact.sourceSegmentIds,
      ),
    ),
    coachingInferenceIds: new Set(
      strata.coachingInference.items.map((item) => item.inferenceId),
    ),
  };
}

function scopedCitationIssues(
  request: DebriefGeneratorRequest,
  output: DebriefGeneratorModelOutput,
): DebriefGeneratorValidationIssue[] {
  const scope = citationScope(request);
  return citationSets(output).flatMap(({ path, citations }) =>
    (Object.keys(citations) as CitationField[]).flatMap((field) =>
      citations[field].flatMap((identifier, index) =>
        scope[field].has(identifier)
          ? []
          : [
              issue(
                "citation_outside_audit",
                [...path, field, index],
                "A debrief citation is outside its labeled audit stratum",
              ),
            ],
      ),
    ),
  );
}

function zodIssues(error: z.ZodError): DebriefGeneratorValidationIssue[] {
  return error.issues.slice(0, 150).map((entry) =>
    issue(
      "strict_schema_invalid",
      entry.path.filter(
        (component): component is string | number =>
          typeof component === "string" ||
          (typeof component === "number" && component >= 0),
      ),
      "The model output did not satisfy the strict debrief schema",
    ),
  );
}

/** Validate one Terra coaching artifact against the immutable audit request. */
export function validateDebriefGeneratorOutput(
  requestInput: DebriefGeneratorRequest,
  candidate: unknown,
): DebriefGeneratorValidationResult {
  const request = DebriefGeneratorRequestSchema.parse(requestInput);
  const parsed = DebriefGeneratorModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { accepted: false, report: report(zodIssues(parsed.error)) };
  }
  const issues = [
    ...validateDebriefGeneratorSemantics(parsed.data).map((semanticIssue) =>
      issue(
        "semantic_contract_invalid",
        semanticIssue.path,
        "The debrief violates its citation-stratum semantic contract",
      ),
    ),
    ...scopedCitationIssues(request, parsed.data),
  ];
  return issues.length === 0
    ? { accepted: true, output: parsed.data, report: report([]) }
    : { accepted: false, report: report(issues) };
}

/** Resolve cited transcript turns to canonical source-event IDs for call audit. */
export function debriefTranscriptEventIds(
  requestInput: DebriefGeneratorRequest,
  outputInput: DebriefGeneratorModelOutput,
): string[] {
  const request = DebriefGeneratorRequestSchema.parse(requestInput);
  const validation = validateDebriefGeneratorOutput(request, outputInput);
  if (!validation.accepted) {
    throw new Error("Cannot audit an invalid debrief candidate");
  }
  const eventIdByTurnId = new Map(
    request.transcript.map((turn) => [turn.turnId, turn.sourceEventId]),
  );
  return [
    ...new Set(
      citationSets(validation.output).flatMap(({ citations }) =>
        citations.transcriptTurnIds.map((turnId) => {
          const eventId = eventIdByTurnId.get(turnId);
          if (!eventId) throw new Error("Debrief transcript citation is stale");
          return eventId;
        }),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}
