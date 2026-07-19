import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import {
  JudgeKnowledgeViewV2Schema,
  type KnowledgeViewV2,
} from "../knowledge";
import {
  ObjectionGroundSchema,
  ObjectionRulingModelOutputSchema,
  validateObjectionRulingSemantics,
  type CourtroomModelCitationSet,
  type ObjectionRulingModelOutput,
} from "./call-contracts";

export const OBJECTION_RULING_REQUEST_SCHEMA_VERSION =
  "objection-resolver.ruling.request.v1" as const;
export const OBJECTION_RULING_VALIDATION_SCHEMA_VERSION =
  "objection-resolver.ruling.validation.v1" as const;

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

export const ObjectionRulingOutcomeSchema = z
  .object({
    ruling: z.enum(["sustained", "overruled"]),
    remedy: z.enum([
      "none",
      "rephrase",
      "cancel_response",
      "resume_response",
    ]),
  })
  .strict();

const ObjectionQuestionBindingSchema = z
  .object({
    questionId: CaseGraphEntityIdSchema,
    turnId: CaseGraphEntityIdSchema,
    eventId: CaseGraphEntityIdSchema,
    speakerActorId: CaseGraphEntityIdSchema,
    text: z.string().trim().min(1).max(8_000),
    factIds: UniqueIdListSchema(64),
    evidenceIds: UniqueIdListSchema(64),
  })
  .strict();

const ObjectionBindingSchema = z
  .object({
    objectionId: CaseGraphEntityIdSchema,
    sourceEventId: CaseGraphEntityIdSchema,
    questionId: CaseGraphEntityIdSchema,
    objectorActorId: CaseGraphEntityIdSchema,
    ground: ObjectionGroundSchema,
    interruptedResponseId: CaseGraphEntityIdSchema.nullable(),
  })
  .strict();

const InterruptionBindingSchema = z
  .object({
    interruptId: CaseGraphEntityIdSchema,
    interruptedResponseId: CaseGraphEntityIdSchema,
    sourceEventId: CaseGraphEntityIdSchema,
  })
  .strict();

function sameOrderedIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identifier, index) => identifier === right[index])
  );
}

function validOutcomeForInterruption(
  outcome: z.infer<typeof ObjectionRulingOutcomeSchema>,
  interrupted: boolean,
): boolean {
  if (outcome.ruling === "overruled") {
    return outcome.remedy === (interrupted ? "resume_response" : "none");
  }
  return interrupted
    ? outcome.remedy === "cancel_response" || outcome.remedy === "rephrase"
    : outcome.remedy === "rephrase";
}

const ObjectionRulingRequestObjectSchema = z
  .object({
    schemaVersion: z.literal(OBJECTION_RULING_REQUEST_SCHEMA_VERSION),
    callId: CaseGraphEntityIdSchema,
    decisionId: CaseGraphEntityIdSchema,
    trialId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    objection: ObjectionBindingSchema,
    question: ObjectionQuestionBindingSchema,
    interruption: InterruptionBindingSchema.nullable(),
    permittedOutcomes: z
      .array(ObjectionRulingOutcomeSchema)
      .min(1)
      .max(4)
      .superRefine((outcomes, context) => {
        const seen = new Set<string>();
        outcomes.forEach((outcome, index) => {
          const key = `${outcome.ruling}:${outcome.remedy}`;
          if (seen.has(key)) {
            context.addIssue({
              code: "custom",
              path: [index],
              message: "Permitted ruling outcomes must be unique",
            });
          }
          seen.add(key);
        });
      }),
    knowledgeView: JudgeKnowledgeViewV2Schema,
  })
  .strict();

/**
 * A server-created, immutable ruling request. Cross-field refinements bind the
 * exact judge view, trial head, question, objection, and interruption before a
 * provider can be called.
 */
export const ObjectionRulingRequestSchema =
  ObjectionRulingRequestObjectSchema.superRefine((request, context) => {
    const view = request.knowledgeView;
    if (
      request.trialId !== view.trialId ||
      request.trialId !== view.publicRecord.trialId
    ) {
      context.addIssue({
        code: "custom",
        path: ["trialId"],
        message: "The ruling request must match the judge KnowledgeView trial",
      });
    }
    if (
      request.expectedStateVersion !== view.stateVersion ||
      request.expectedStateVersion !== view.publicRecord.stateVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedStateVersion"],
        message: "The ruling request must match the judge KnowledgeView state",
      });
    }
    if (request.actorId !== view.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "The ruling request must match the judge actor",
      });
    }
    const triggerEventId =
      request.interruption?.sourceEventId ?? request.objection.sourceEventId;
    if (request.expectedLastEventId !== triggerEventId) {
      context.addIssue({
        code: "custom",
        path: ["expectedLastEventId"],
        message: "The ruling request must match the objection trigger head",
      });
    }
    if (!view.rules.permittedObjectionGrounds.includes(request.objection.ground)) {
      context.addIssue({
        code: "custom",
        path: ["objection", "ground"],
        message: "The objection ground is not permitted by the pinned rules",
      });
    }
    if (request.objection.questionId !== request.question.questionId) {
      context.addIssue({
        code: "custom",
        path: ["objection", "questionId"],
        message: "The objection must target the exact bound question",
      });
    }
    if (
      request.objection.interruptedResponseId !==
      (request.interruption?.interruptedResponseId ?? null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["objection", "interruptedResponseId"],
        message: "The objection and interruption response bindings must match",
      });
    }
    const exchange = view.currentExchange;
    if (
      exchange === null ||
      exchange.exchangeId !== request.question.turnId ||
      exchange.speakerActorId !== request.question.speakerActorId ||
      exchange.text !== request.question.text ||
      !sameOrderedIds(exchange.factIds, request.question.factIds) ||
      !sameOrderedIds(exchange.evidenceIds, request.question.evidenceIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["question"],
        message: "The objection question must match the current exchange",
      });
    }
    request.permittedOutcomes.forEach((outcome, index) => {
      if (!validOutcomeForInterruption(outcome, request.interruption !== null)) {
        context.addIssue({
          code: "custom",
          path: ["permittedOutcomes", index],
          message: "The permitted outcome is invalid for this interruption state",
        });
      }
    });
  });

export const ObjectionRulingValidationIssueCodeSchema = z.enum([
  "strict_schema_invalid",
  "semantic_contract_invalid",
  "outcome_not_permitted",
  "unknown_fact_citation",
  "unknown_evidence_citation",
  "unknown_testimony_citation",
  "unknown_transcript_turn_citation",
  "unknown_source_segment_citation",
  "unsupported_citation",
  "question_not_cited",
]);

export const ObjectionRulingValidationIssueSchema = z
  .object({
    code: ObjectionRulingValidationIssueCodeSchema,
    path: z
      .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
      .max(16),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const ObjectionRulingValidationReportSchema = z
  .object({
    schemaVersion: z.literal(OBJECTION_RULING_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["accepted", "rejected"]),
    issues: z.array(ObjectionRulingValidationIssueSchema).max(200),
  })
  .strict();

export type JudgeKnowledgeView = Extract<
  KnowledgeViewV2,
  { actorRole: "judge" }
>;
export type ObjectionRulingRequest = z.infer<
  typeof ObjectionRulingRequestSchema
>;
export type ObjectionRulingValidationIssue = z.infer<
  typeof ObjectionRulingValidationIssueSchema
>;
export type ObjectionRulingValidationReport = z.infer<
  typeof ObjectionRulingValidationReportSchema
>;
export type ValidatedObjectionRuling = Readonly<{
  ruling: ObjectionRulingModelOutput["ruling"];
  remedy: ObjectionRulingModelOutput["remedy"];
  reason: string;
  factIds: string[];
  evidenceIds: string[];
  testimonyIds: string[];
  transcriptTurnIds: string[];
  sourceSegmentIds: string[];
  performance: ObjectionRulingModelOutput["performance"];
}>;
export type ObjectionRulingOutputValidationResult =
  | Readonly<{
      accepted: true;
      output: ObjectionRulingModelOutput;
      ruling: ValidatedObjectionRuling;
      report: ObjectionRulingValidationReport;
    }>
  | Readonly<{
      accepted: false;
      report: ObjectionRulingValidationReport;
    }>;

type IssuePath = ObjectionRulingValidationIssue["path"];
type CitationField = keyof CourtroomModelCitationSet;

function issue(
  code: ObjectionRulingValidationIssue["code"],
  path: IssuePath,
  message: string,
): ObjectionRulingValidationIssue {
  return ObjectionRulingValidationIssueSchema.parse({ code, path, message });
}

function report(
  issues: ObjectionRulingValidationIssue[],
): ObjectionRulingValidationReport {
  return ObjectionRulingValidationReportSchema.parse({
    schemaVersion: OBJECTION_RULING_VALIDATION_SCHEMA_VERSION,
    status: issues.length === 0 ? "accepted" : "rejected",
    issues,
  });
}

function stableUnique(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function zodIssues(error: z.ZodError): ObjectionRulingValidationIssue[] {
  return error.issues.slice(0, 100).map((entry) =>
    issue(
      "strict_schema_invalid",
      entry.path.filter(
        (component): component is string | number =>
          typeof component === "string" ||
          (typeof component === "number" && component >= 0),
      ),
      "The model output did not satisfy the strict objection-ruling schema",
    ),
  );
}

const CITATION_ISSUE_CODE: Readonly<
  Partial<
    Record<CitationField, ObjectionRulingValidationIssue["code"]>
  >
> = {
  factIds: "unknown_fact_citation",
  evidenceIds: "unknown_evidence_citation",
  testimonyIds: "unknown_testimony_citation",
  transcriptTurnIds: "unknown_transcript_turn_citation",
  sourceSegmentIds: "unknown_source_segment_citation",
};

function citationScope(
  request: ObjectionRulingRequest,
): Readonly<Record<CitationField, ReadonlySet<string>>> {
  const view = request.knowledgeView;
  return {
    factIds: new Set([
      ...view.publicRecord.facts.map((fact) => fact.factId),
      ...request.question.factIds,
    ]),
    evidenceIds: new Set([
      ...view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
      ...request.question.evidenceIds,
    ]),
    testimonyIds: new Set(
      view.publicRecord.testimony.map((testimony) => testimony.testimonyId),
    ),
    transcriptTurnIds: new Set([request.question.turnId]),
    sourceSegmentIds: new Set([
      ...view.publicRecord.facts.flatMap((fact) => fact.sourceSegmentIds),
      ...view.publicRecord.evidence.flatMap(
        (evidence) => evidence.sourceSegmentIds,
      ),
    ]),
    priorStatementIds: new Set(),
    issueIds: new Set(),
    instructionIds: new Set(),
    ruleIds: new Set(),
    settlementOfferIds: new Set(),
  };
}

function citationIssues(
  request: ObjectionRulingRequest,
  output: ObjectionRulingModelOutput,
): ObjectionRulingValidationIssue[] {
  const issues: ObjectionRulingValidationIssue[] = [];
  const scope = citationScope(request);
  (Object.keys(output.citations) as CitationField[]).forEach((field) => {
    const code = CITATION_ISSUE_CODE[field];
    output.citations[field].forEach((identifier, index) => {
      if (scope[field].has(identifier)) return;
      issues.push(
        issue(
          code ?? "unsupported_citation",
          ["citations", field, index],
          code === undefined
            ? "This citation class is unavailable to the objection resolver"
            : "A citation is outside the judge KnowledgeView and bound question",
        ),
      );
    });
  });
  if (!output.citations.transcriptTurnIds.includes(request.question.turnId)) {
    issues.push(
      issue(
        "question_not_cited",
        ["citations", "transcriptTurnIds"],
        "The objection ruling must cite the exact bound question turn",
      ),
    );
  }
  return issues;
}

function outcomeIssues(
  request: ObjectionRulingRequest,
  output: ObjectionRulingModelOutput,
): ObjectionRulingValidationIssue[] {
  const permitted = request.permittedOutcomes.some(
    (outcome) =>
      outcome.ruling === output.ruling && outcome.remedy === output.remedy,
  );
  return permitted
    ? []
    : [
        issue(
          "outcome_not_permitted",
          ["ruling"],
          "The ruling and remedy pair is not permitted by the server binding",
        ),
      ];
}

function materialize(
  output: ObjectionRulingModelOutput,
): ValidatedObjectionRuling {
  return {
    ruling: output.ruling,
    remedy: output.remedy,
    reason: output.reason,
    factIds: stableUnique(output.citations.factIds),
    evidenceIds: stableUnique(output.citations.evidenceIds),
    testimonyIds: stableUnique(output.citations.testimonyIds),
    transcriptTurnIds: stableUnique(output.citations.transcriptTurnIds),
    sourceSegmentIds: stableUnique(output.citations.sourceSegmentIds),
    performance: output.performance,
  };
}

/** Strict, request-aware validation for one immutable objection ruling. */
export function validateObjectionRulingOutput(
  requestInput: ObjectionRulingRequest,
  candidate: unknown,
): ObjectionRulingOutputValidationResult {
  const request = ObjectionRulingRequestSchema.parse(requestInput);
  const parsed = ObjectionRulingModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { accepted: false, report: report(zodIssues(parsed.error)) };
  }
  const semanticIssues = validateObjectionRulingSemantics(parsed.data, {
    interruptedResponse: request.interruption !== null,
  }).map((semanticIssue) =>
    issue(
      "semantic_contract_invalid",
      semanticIssue.path,
      "The objection ruling violates its internal semantic contract",
    ),
  );
  const issues = [
    ...semanticIssues,
    ...outcomeIssues(request, parsed.data),
    ...citationIssues(request, parsed.data),
  ];
  if (issues.length > 0) {
    return { accepted: false, report: report(issues) };
  }
  return {
    accepted: true,
    output: parsed.data,
    ruling: materialize(parsed.data),
    report: report([]),
  };
}
