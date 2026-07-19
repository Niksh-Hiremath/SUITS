import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import {
  WitnessKnowledgeViewV2Schema,
  type KnowledgeViewV2,
} from "../knowledge";
import type { TrialStateV3 } from "../trial-engine";

export const WITNESS_ANSWER_REQUEST_SCHEMA_VERSION =
  "role-responder.witness-answer.request.v1" as const;
export const WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION =
  "role-responder.witness-answer.output.v1" as const;
export const WITNESS_ANSWER_VALIDATION_SCHEMA_VERSION =
  "role-responder.witness-answer.validation.v1" as const;
export const WITNESS_ANSWER_STRUCTURED_OUTPUT_NAME =
  "suits_witness_answer_v1" as const;

const MAX_WITNESS_ANSWER_SEGMENTS = 8;
const MAX_WITNESS_ANSWER_CHARACTERS = 4_000;

const BoundedIdListSchema = (maximum: number) =>
  z.array(CaseGraphEntityIdSchema).max(maximum);

const WitnessQuestionSchema = z
  .object({
    questionId: CaseGraphEntityIdSchema,
    appearanceId: CaseGraphEntityIdSchema,
    turnId: CaseGraphEntityIdSchema,
    eventId: CaseGraphEntityIdSchema,
    examinationKind: z.enum(["direct", "cross", "redirect", "recross"]),
    text: z.string().trim().min(1).max(8_000),
    presentedEvidenceIds: BoundedIdListSchema(32),
  })
  .strict();

export const WitnessAnswerRequestSchema = z
  .object({
    schemaVersion: z.literal(WITNESS_ANSWER_REQUEST_SCHEMA_VERSION),
    callId: CaseGraphEntityIdSchema,
    trialId: CaseGraphEntityIdSchema,
    responseId: CaseGraphEntityIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    actorId: CaseGraphEntityIdSchema,
    witnessId: CaseGraphEntityIdSchema,
    question: WitnessQuestionSchema,
    knowledgeView: WitnessKnowledgeViewV2Schema,
  })
  .strict();

export const WitnessPerformanceSchema = z
  .object({
    emotion: z.enum([
      "neutral",
      "confident",
      "nervous",
      "angry",
      "confused",
      "defensive",
      "empathetic",
    ]),
    intensity: z.number().min(0).max(1),
    delivery: z.enum(["measured", "hesitant", "firm", "soft", "distressed"]),
    gesture: z.enum([
      "none",
      "small_nod",
      "head_shake",
      "look_away",
      "indicate_evidence",
    ]),
    gazeTarget: z.enum([
      "questioning_counsel",
      "judge",
      "jury",
      "evidence_display",
    ]),
  })
  .strict();

export const WitnessAnswerSegmentSchema = z
  .object({
    text: z.string().trim().min(1).max(600),
    factIds: BoundedIdListSchema(8),
    evidenceIds: BoundedIdListSchema(8),
    priorStatementIds: BoundedIdListSchema(4),
  })
  .strict();

export const WitnessAnswerModelOutputSchema = z
  .object({
    schemaVersion: z.literal(WITNESS_ANSWER_OUTPUT_SCHEMA_VERSION),
    disposition: z.enum([
      "substantive",
      "insufficient_knowledge",
      "outside_permitted_scope",
      "cannot_recall",
      "question_unclear",
    ]),
    performance: WitnessPerformanceSchema,
    segments: z
      .array(WitnessAnswerSegmentSchema)
      .max(MAX_WITNESS_ANSWER_SEGMENTS),
  })
  .strict();

export const WitnessAnswerValidationIssueCodeSchema = z.enum([
  "strict_schema_invalid",
  "trial_binding_mismatch",
  "state_binding_mismatch",
  "head_binding_mismatch",
  "actor_binding_mismatch",
  "witness_binding_mismatch",
  "response_binding_mismatch",
  "response_not_pending",
  "response_interrupted",
  "question_binding_mismatch",
  "exchange_binding_mismatch",
  "presented_evidence_binding_mismatch",
  "substantive_segments_required",
  "boundary_segments_forbidden",
  "ungrounded_segment",
  "duplicate_citation",
  "unknown_fact_citation",
  "unknown_evidence_citation",
  "unknown_prior_statement_citation",
  "unrelated_prior_statement_citation",
  "forbidden_topic_leakage",
  "performance_evidence_mismatch",
  "answer_too_large",
]);

export const WitnessAnswerValidationIssueSchema = z
  .object({
    code: WitnessAnswerValidationIssueCodeSchema,
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).max(16),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const WitnessAnswerValidationReportSchema = z
  .object({
    schemaVersion: z.literal(WITNESS_ANSWER_VALIDATION_SCHEMA_VERSION),
    status: z.enum(["accepted", "rejected"]),
    issues: z.array(WitnessAnswerValidationIssueSchema).max(100),
  })
  .strict();

export type WitnessKnowledgeView = Extract<
  KnowledgeViewV2,
  { actorRole: "witness" }
>;
export type WitnessAnswerRequest = z.infer<typeof WitnessAnswerRequestSchema>;
export type WitnessAnswerModelOutput = z.infer<
  typeof WitnessAnswerModelOutputSchema
>;
export type WitnessAnswerValidationIssue = z.infer<
  typeof WitnessAnswerValidationIssueSchema
>;
export type WitnessAnswerValidationReport = z.infer<
  typeof WitnessAnswerValidationReportSchema
>;

export type ValidatedWitnessAnswer = Readonly<{
  disposition: WitnessAnswerModelOutput["disposition"];
  text: string;
  factIds: string[];
  evidenceIds: string[];
  priorStatementIds: string[];
  performance: WitnessAnswerModelOutput["performance"];
}>;

export type WitnessAnswerOutputValidationResult =
  | Readonly<{
      accepted: true;
      output: WitnessAnswerModelOutput;
      answer: ValidatedWitnessAnswer;
      report: WitnessAnswerValidationReport;
    }>
  | Readonly<{
      accepted: false;
      report: WitnessAnswerValidationReport;
    }>;

function issue(
  code: WitnessAnswerValidationIssue["code"],
  path: WitnessAnswerValidationIssue["path"],
  message: string,
): WitnessAnswerValidationIssue {
  return WitnessAnswerValidationIssueSchema.parse({ code, path, message });
}

function rejected(
  issues: WitnessAnswerValidationIssue[],
): WitnessAnswerValidationReport {
  return WitnessAnswerValidationReportSchema.parse({
    schemaVersion: WITNESS_ANSWER_VALIDATION_SCHEMA_VERSION,
    status: "rejected",
    issues,
  });
}

function accepted(): WitnessAnswerValidationReport {
  return WitnessAnswerValidationReportSchema.parse({
    schemaVersion: WITNESS_ANSWER_VALIDATION_SCHEMA_VERSION,
    status: "accepted",
    issues: [],
  });
}

function sameOrderedIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((value) => right.includes(value))
  );
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function containsForbiddenTopic(text: string, topics: readonly string[]): boolean {
  const normalizedAnswer = ` ${normalizedText(text)} `;
  return topics.some((topic) => {
    const normalizedTopic = normalizedText(topic);
    return normalizedTopic.length >= 4 && normalizedAnswer.includes(` ${normalizedTopic} `);
  });
}

/**
 * Checks that a server-created request still describes the exact canonical
 * pending witness response. This runs both before the provider call and again
 * immediately before commit so late, cancelled, or superseded output cannot
 * become testimony.
 */
export function validateWitnessAnswerRequestBinding(
  request: WitnessAnswerRequest,
  state: TrialStateV3,
): WitnessAnswerValidationIssue[] {
  const issues: WitnessAnswerValidationIssue[] = [];
  const view = request.knowledgeView;
  const pending = state.pendingResponses[request.responseId];
  const question = state.questions[request.question.questionId];
  const questionTurn = state.transcriptTurns[request.question.turnId];
  const lastEventId = state.eventIds.at(-1);
  const resumedInterruption =
    pending?.interruptId !== null &&
    pending?.interruptId !== undefined &&
    state.activeInterruption?.interruptId === pending.interruptId &&
    state.activeInterruption.interruptedResponseId === request.responseId &&
    state.activeInterruption.status === "resumed";

  if (
    request.trialId !== state.trialId ||
    request.trialId !== view.trialId ||
    view.publicRecord.trialId !== request.trialId
  ) {
    issues.push(
      issue("trial_binding_mismatch", ["trialId"], "The request is not bound to this trial"),
    );
  }
  if (
    request.expectedStateVersion !== state.version ||
    view.stateVersion !== state.version ||
    view.publicRecord.stateVersion !== state.version
  ) {
    issues.push(
      issue(
        "state_binding_mismatch",
        ["expectedStateVersion"],
        "The request is not bound to the current state version",
      ),
    );
  }
  if (
    lastEventId === undefined ||
    request.expectedLastEventId !== lastEventId
  ) {
    issues.push(
      issue(
        "head_binding_mismatch",
        ["expectedLastEventId"],
        "The request is not bound to the current event head",
      ),
    );
  }
  if (
    request.actorId !== view.actorId ||
    pending?.actorId !== request.actorId ||
    state.actors[request.actorId]?.role !== "witness"
  ) {
    issues.push(
      issue("actor_binding_mismatch", ["actorId"], "The response actor binding is invalid"),
    );
  }
  if (
    request.witnessId !== view.witness.witnessId ||
    state.actors[request.actorId]?.witnessId !== request.witnessId ||
    pending?.witnessId !== request.witnessId ||
    question?.witnessId !== request.witnessId
  ) {
    issues.push(
      issue(
        "witness_binding_mismatch",
        ["witnessId"],
        "The response witness binding is invalid",
      ),
    );
  }
  if (
    !pending ||
    pending.responseId !== request.responseId ||
    pending.expectedStateVersion !== request.expectedStateVersion ||
    (!resumedInterruption &&
      pending.requestEventId !== request.expectedLastEventId) ||
    pending.lastEventId !== request.expectedLastEventId ||
    pending.questionId !== request.question.questionId ||
    pending.appearanceId !== request.question.appearanceId
  ) {
    issues.push(
      issue(
        "response_binding_mismatch",
        ["responseId"],
        "The pending response binding is invalid",
      ),
    );
  }
  if (!pending || (pending.status !== "pending" && pending.status !== "streaming")) {
    issues.push(
      issue(
        "response_not_pending",
        ["responseId"],
        "The response is no longer pending",
      ),
    );
  }
  if (
    (pending?.interruptId !== null && !resumedInterruption) ||
    (state.activeInterruption !== null &&
      state.activeInterruption.interruptedResponseId === request.responseId &&
      state.activeInterruption.status !== "resumed")
  ) {
    issues.push(
      issue(
        "response_interrupted",
        ["responseId"],
        "The response is currently interrupted",
      ),
    );
  }
  if (
    !question ||
    state.activeQuestionId !== request.question.questionId ||
    state.activeAppearanceId !== request.question.appearanceId ||
    question.appearanceId !== request.question.appearanceId ||
    question.questionTurnId !== request.question.turnId ||
    question.examinationKind !== request.question.examinationKind ||
    question.status !== "open" ||
    question.activeResponseId !== request.responseId ||
    !questionTurn ||
    questionTurn.sourceEventId !== request.question.eventId ||
    questionTurn.text !== request.question.text
  ) {
    issues.push(
      issue(
        "question_binding_mismatch",
        ["question"],
        "The active question binding is invalid",
      ),
    );
  }
  if (
    view.currentExchange === null ||
    view.currentExchange.exchangeId !== request.question.turnId ||
    view.currentExchange.speakerActorId !== questionTurn?.actor.actorId ||
    view.currentExchange.text !== request.question.text
  ) {
    issues.push(
      issue(
        "exchange_binding_mismatch",
        ["knowledgeView", "currentExchange"],
        "The current exchange is not the active question",
      ),
    );
  }
  if (
    !sameOrderedIds(
      request.question.presentedEvidenceIds,
      question?.presentedEvidenceIds ?? [],
    ) ||
    !sameIdSet(
      request.question.presentedEvidenceIds,
      view.presentedEvidence.map((evidence) => evidence.evidenceId),
    )
  ) {
    issues.push(
      issue(
        "presented_evidence_binding_mismatch",
        ["question", "presentedEvidenceIds"],
        "Presented evidence does not match the active question and witness view",
      ),
    );
  }

  return issues;
}

function zodIssues(error: z.ZodError): WitnessAnswerValidationIssue[] {
  return error.issues.slice(0, 100).map((entry) =>
    issue(
      "strict_schema_invalid",
      entry.path.filter(
        (component): component is string | number =>
          typeof component === "string" ||
          (typeof component === "number" && component >= 0),
      ),
      "The model output did not satisfy the strict witness-answer schema",
    ),
  );
}

function semanticOutputIssues(
  request: WitnessAnswerRequest,
  output: WitnessAnswerModelOutput,
): WitnessAnswerValidationIssue[] {
  const issues: WitnessAnswerValidationIssue[] = [];
  const allowedFacts = new Set(
    request.knowledgeView.witness.facts.map((fact) => fact.factId),
  );
  const allowedEvidence = new Set([
    ...request.knowledgeView.witness.admittedSeenEvidence.map(
      (evidence) => evidence.evidenceId,
    ),
    ...request.knowledgeView.presentedEvidence.map(
      (evidence) => evidence.evidenceId,
    ),
  ]);
  const priorStatements = new Map(
    request.knowledgeView.witness.priorStatements.map((statement) => [
      statement.priorStatementId,
      statement,
    ]),
  );

  if (output.disposition === "substantive" && output.segments.length === 0) {
    issues.push(
      issue(
        "substantive_segments_required",
        ["segments"],
        "A substantive answer requires at least one grounded segment",
      ),
    );
  }
  if (output.disposition !== "substantive" && output.segments.length > 0) {
    issues.push(
      issue(
        "boundary_segments_forbidden",
        ["segments"],
        "A boundary disposition must use the server-owned safe phrase",
      ),
    );
  }

  output.segments.forEach((segment, index) => {
    if (segment.factIds.length === 0 && segment.evidenceIds.length === 0) {
      issues.push(
        issue(
          "ungrounded_segment",
          ["segments", index],
          "Every substantive segment requires a fact or evidence citation",
        ),
      );
    }
    const citationLists = [
      ["factIds", segment.factIds],
      ["evidenceIds", segment.evidenceIds],
      ["priorStatementIds", segment.priorStatementIds],
    ] as const;
    for (const [field, values] of citationLists) {
      if (hasDuplicates(values)) {
        issues.push(
          issue(
            "duplicate_citation",
            ["segments", index, field],
            "Citation IDs must be unique within a segment",
          ),
        );
      }
    }
    for (const factId of segment.factIds) {
      if (!allowedFacts.has(factId)) {
        issues.push(
          issue(
            "unknown_fact_citation",
            ["segments", index, "factIds"],
            "A cited fact is outside this witness's KnowledgeView",
          ),
        );
      }
    }
    for (const evidenceId of segment.evidenceIds) {
      if (!allowedEvidence.has(evidenceId)) {
        issues.push(
          issue(
            "unknown_evidence_citation",
            ["segments", index, "evidenceIds"],
            "Cited evidence was neither admitted-and-seen nor presented",
          ),
        );
      }
    }
    for (const priorStatementId of segment.priorStatementIds) {
      const priorStatement = priorStatements.get(priorStatementId);
      if (!priorStatement) {
        issues.push(
          issue(
            "unknown_prior_statement_citation",
            ["segments", index, "priorStatementIds"],
            "A cited prior statement is outside this witness's KnowledgeView",
          ),
        );
        continue;
      }
      const related =
        segment.factIds.some((factId) =>
          priorStatement.relatedFactIds.includes(factId),
        ) ||
        segment.evidenceIds.some((evidenceId) =>
          priorStatement.relatedEvidenceIds.includes(evidenceId),
        );
      if (!related) {
        issues.push(
          issue(
            "unrelated_prior_statement_citation",
            ["segments", index, "priorStatementIds"],
            "A prior statement must support a fact or evidence citation in the same segment",
          ),
        );
      }
    }
    if (
      containsForbiddenTopic(
        segment.text,
        request.knowledgeView.witness.forbiddenTopics,
      )
    ) {
      issues.push(
        issue(
          "forbidden_topic_leakage",
          ["segments", index, "text"],
          "The answer repeats a forbidden topic from the witness policy",
        ),
      );
    }
  });

  const citedEvidenceCount = output.segments.reduce(
    (count, segment) => count + segment.evidenceIds.length,
    0,
  );
  if (
    citedEvidenceCount === 0 &&
    (output.performance.gesture === "indicate_evidence" ||
      output.performance.gazeTarget === "evidence_display")
  ) {
    issues.push(
      issue(
        "performance_evidence_mismatch",
        ["performance"],
        "Evidence-directed performance requires an evidence-grounded segment",
      ),
    );
  }

  const joinedText = output.segments.map((segment) => segment.text).join(" ");
  if (joinedText.length > MAX_WITNESS_ANSWER_CHARACTERS) {
    issues.push(
      issue(
        "answer_too_large",
        ["segments"],
        `The joined witness answer exceeds ${MAX_WITNESS_ANSWER_CHARACTERS} characters`,
      ),
    );
  }

  return issues;
}

const SAFE_DISPOSITION_TEXT: Readonly<
  Record<Exclude<WitnessAnswerModelOutput["disposition"], "substantive">, string>
> = Object.freeze({
  insufficient_knowledge: "I do not know that from my own knowledge.",
  outside_permitted_scope:
    "I cannot answer that from my permitted knowledge in this simulation.",
  cannot_recall: "I do not recall that.",
  question_unclear: "Could you please clarify the question?",
});

function materializeValidatedAnswer(
  output: WitnessAnswerModelOutput,
): ValidatedWitnessAnswer {
  const substantive = output.disposition === "substantive";
  let text: string;
  if (output.disposition === "substantive") {
    text = output.segments.map((segment) => segment.text).join(" ");
  } else {
    text = SAFE_DISPOSITION_TEXT[output.disposition];
  }
  return {
    disposition: output.disposition,
    text,
    factIds: substantive
      ? stableUnique(output.segments.flatMap((segment) => segment.factIds))
      : [],
    evidenceIds: substantive
      ? stableUnique(output.segments.flatMap((segment) => segment.evidenceIds))
      : [],
    priorStatementIds: substantive
      ? stableUnique(
          output.segments.flatMap((segment) => segment.priorStatementIds),
        )
      : [],
    performance: output.performance,
  };
}

/** Parse and semantically validate one model candidate against one immutable request. */
export function validateWitnessAnswerOutput(
  request: WitnessAnswerRequest,
  candidate: unknown,
): WitnessAnswerOutputValidationResult {
  const parsed = WitnessAnswerModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { accepted: false, report: rejected(zodIssues(parsed.error)) };
  }
  const issues = semanticOutputIssues(request, parsed.data);
  if (issues.length > 0) {
    return { accepted: false, report: rejected(issues) };
  }
  return {
    accepted: true,
    output: parsed.data,
    answer: materializeValidatedAnswer(parsed.data),
    report: accepted(),
  };
}
