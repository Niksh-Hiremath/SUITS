import { v } from "convex/values";

import {
  CaseGraphV1Schema,
  type CaseGraphV1,
} from "../src/domain/case-graph";
import {
  CourtroomModelCallTraceSchema,
  type CounselRoleResponseModelOutput,
  type CourtroomModelCallTrace,
  type OpponentPlannerModelOutput,
  type WitnessAnswerModelOutput,
} from "../src/domain/courtroom-ai";
import {
  HearingCounselResponsePrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingWitnessGenerationPrecommitSchema,
  counselResponseOutputCitations,
  hashOpponentPlannerModelOutput,
  witnessAnswerOutputCitations,
  type HearingCounselResponsePrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime/model-boundary";
import {
  parsePersistedOpponentDirective,
  type PersistedOpponentDirective,
} from "../src/domain/hearing-runtime/opponent-directive";
import type { TrialPolicyActorBindingInput } from "../src/domain/trial-policy";
import {
  TRIAL_ACTION_SCHEMA_VERSION_V3,
  TRIAL_EVENT_SCHEMA_VERSION_V3,
  TRIAL_STATE_SCHEMA_VERSION_V3,
  TrialActionV3Schema,
  TrialEventV3Schema,
  TrialStateV3Schema,
  commitAction,
  createStartTrialAction,
  reduceTrial,
  type ActorRef,
  type CommitResult,
  type TrialActionV3,
  type TrialEventV3,
  type TrialStateV3,
} from "../src/domain/trial-engine";
import type { Doc } from "./_generated/dataModel";
import {
  internalQuery,
  internalMutation,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { persistTerminalCourtroomModelCallForOwner } from "./courtroomModelCalls";

const MAX_JSON_CHARACTERS = 750_000;
const MAX_REFERENCES_PER_EVENT = 128;
const MAX_REPLAY_EVENTS = 5_000;
const MAX_RELOAD_EVENTS = 500;
const DEFAULT_RELOAD_EVENTS = 100;
const SNAPSHOT_INTERVAL = 25;
const RECEIPT_SCHEMA_VERSION = "trial-action-receipt.v1";

const trialSide = v.union(
  v.literal("user"),
  v.literal("opposing"),
  v.literal("neutral"),
);

const actorRole = v.union(
  v.literal("user_counsel"),
  v.literal("opposing_counsel"),
  v.literal("judge"),
  v.literal("witness"),
  v.literal("clerk"),
  v.literal("jury"),
  v.literal("system"),
  v.literal("debrief_coach"),
);

const actor = v.object({
  actorId: v.string(),
  role: actorRole,
  side: trialSide,
  witnessId: v.union(v.string(), v.null()),
});

const actorBinding = v.object({
  actor,
  representedPartyIds: v.array(v.string()),
});

type DbContext = Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">;
type AuthContext = Pick<MutationCtx, "auth"> | Pick<QueryCtx, "auth">;

function assertIdentifier(value: string, label: string): void {
  if (!value.trim() || value.length > 256) {
    throw new Error(`${label} must contain 1-256 characters`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function parseJsonObject(value: string, label: string): unknown {
  if (!value.trim() || value.length > MAX_JSON_CHARACTERS) {
    throw new Error(
      `${label} must contain 1-${MAX_JSON_CHARACTERS} serialized JSON characters`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must be valid serialized JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must serialize a JSON object`);
  }
  return parsed;
}

function assertReferences(values: readonly string[], label: string): string[] {
  if (values.length > MAX_REFERENCES_PER_EVENT) {
    throw new Error(
      `${label} cannot contain more than ${MAX_REFERENCES_PER_EVENT} IDs`,
    );
  }
  const unique = [...new Set(values)];
  if (unique.length !== values.length) {
    throw new Error(`${label} cannot contain duplicate IDs`);
  }
  for (const value of unique) assertIdentifier(value, label);
  return unique;
}

async function requireOwnerId(ctx: AuthContext): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("AUTHENTICATION_REQUIRED");
  assertIdentifier(identity.tokenIdentifier, "identity.tokenIdentifier");
  return identity.tokenIdentifier;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function invalidWitnessGeneration(): never {
  throw new Error("WITNESS_GENERATION_INVALID");
}

function staleWitnessGeneration(): never {
  throw new Error("WITNESS_GENERATION_STALE");
}

function parseWitnessGenerationJson(
  generationJson: string,
): HearingWitnessGenerationPrecommit {
  let input: unknown;
  try {
    input = parseJsonObject(generationJson, "generationJson");
  } catch {
    return invalidWitnessGeneration();
  }
  const parsed = HearingWitnessGenerationPrecommitSchema.safeParse(input);
  return parsed.success ? parsed.data : invalidWitnessGeneration();
}

function sameIdentifierSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((identifier) => right.includes(identifier))
  );
}

const SAFE_WITNESS_DISPOSITION_TEXT: Readonly<
  Record<
    Exclude<WitnessAnswerModelOutput["disposition"], "substantive">,
    string
  >
> = Object.freeze({
  insufficient_knowledge: "I do not know that from my own knowledge.",
  outside_permitted_scope:
    "I cannot answer that from my permitted knowledge in this simulation.",
  cannot_recall: "I do not recall that.",
  question_unclear: "Could you please clarify the question?",
});

function materializedWitnessOutputText(
  output: WitnessAnswerModelOutput,
): string {
  if (output.disposition === "substantive") {
    if (output.segments.length === 0) return invalidWitnessGeneration();
    return output.segments.map((segment) => segment.text).join(" ");
  }
  if (output.segments.length !== 0) return invalidWitnessGeneration();
  return SAFE_WITNESS_DISPOSITION_TEXT[output.disposition];
}

type GeneratedWitnessAnswerAction = Extract<
  TrialActionV3,
  { type: "ANSWER_QUESTION" }
>;

function requireGeneratedWitnessAnswerAction(
  action: TrialActionV3,
  generation: HearingWitnessGenerationPrecommit,
): GeneratedWitnessAnswerAction {
  if (
    action.type !== "ANSWER_QUESTION" ||
    action.source !== "ai" ||
    action.actor.role !== "witness" ||
    action.actor.witnessId === null ||
    action.modelMetadata === null
  ) {
    return invalidWitnessGeneration();
  }

  const { trace } = generation;
  if (
    action.trialId !== generation.trialId ||
    action.trialId !== trace.trialId ||
    action.responseId !== generation.responseId ||
    action.payload.responseId !== generation.responseId ||
    action.actor.actorId !== trace.actorId ||
    action.actor.witnessId !== action.payload.witnessId ||
    !sameCanonicalJson(action.modelMetadata, generation.modelMetadata)
  ) {
    return invalidWitnessGeneration();
  }

  if (
    trace.expectedStateVersion === null ||
    trace.expectedLastEventId === null ||
    trace.knowledgeScope.stateVersion === null ||
    action.expectedStateVersion !== trace.expectedStateVersion ||
    trace.knowledgeScope.stateVersion !== trace.expectedStateVersion ||
    action.causationId !== trace.expectedLastEventId
  ) {
    return staleWitnessGeneration();
  }

  const outputCitations = witnessAnswerOutputCitations(generation.output);
  if (
    action.payload.text !== materializedWitnessOutputText(generation.output) ||
    !sameIdentifierSet(action.payload.factIds, outputCitations.factIds) ||
    !sameIdentifierSet(
      action.payload.evidenceIds,
      outputCitations.evidenceIds,
    ) ||
    !sameIdentifierSet(
      action.payload.factIds,
      trace.acceptedCitations.factIds,
    ) ||
    !sameIdentifierSet(
      action.payload.evidenceIds,
      trace.acceptedCitations.evidenceIds,
    )
  ) {
    return invalidWitnessGeneration();
  }

  return action;
}

async function requireStoredGeneratedWitnessEvent(
  ctx: MutationCtx,
  input: Readonly<{
    action: GeneratedWitnessAnswerAction;
    eventId: string;
    trace: CourtroomModelCallTrace;
  }>,
): Promise<void> {
  const event = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) => index.eq("eventId", input.eventId))
    .unique();
  if (
    !event ||
    event.actionId !== input.action.actionId ||
    event.trialId !== input.action.trialId ||
    event.eventType !== "ANSWER_QUESTION" ||
    event.source !== "ai" ||
    event.actorId !== input.action.actor.actorId ||
    event.responseId !== input.action.responseId ||
    !sameIdentifierSet(event.factIds, input.action.payload.factIds) ||
    !sameIdentifierSet(event.evidenceIds, input.action.payload.evidenceIds) ||
    !sameIdentifierSet(
      event.factIds,
      input.trace.acceptedCitations.factIds,
    ) ||
    !sameIdentifierSet(
      event.evidenceIds,
      input.trace.acceptedCitations.evidenceIds,
    )
  ) {
    return invalidWitnessGeneration();
  }
}

function invalidOpponentPlan(): never {
  throw new Error("OPPONENT_PLAN_GENERATION_INVALID");
}

function staleOpponentPlan(): never {
  throw new Error("OPPONENT_PLAN_GENERATION_STALE");
}

function invalidCounselResponse(): never {
  throw new Error("COUNSEL_GENERATION_INVALID");
}

function staleCounselResponse(): never {
  throw new Error("COUNSEL_GENERATION_STALE");
}

function parseOpponentPlanGenerationJson(
  generationJson: string,
): HearingOpponentPlanPrecommit {
  let input: unknown;
  try {
    input = parseJsonObject(generationJson, "generationJson");
  } catch {
    return invalidOpponentPlan();
  }
  const parsed = HearingOpponentPlanPrecommitSchema.safeParse(input);
  return parsed.success ? parsed.data : invalidOpponentPlan();
}

function parseCounselResponseGenerationJson(
  generationJson: string,
): HearingCounselResponsePrecommit {
  let input: unknown;
  try {
    input = parseJsonObject(generationJson, "generationJson");
  } catch {
    return invalidCounselResponse();
  }
  const parsed = HearingCounselResponsePrecommitSchema.safeParse(input);
  return parsed.success ? parsed.data : invalidCounselResponse();
}

function eventIdForGeneratedAction(actionId: string): string {
  return `event:${actionId}`;
}

function sameOrderedIdentifiers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identifier, index) => identifier === right[index])
  );
}

function sameOrderedStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function requireDirectiveMatchesPlannerOutput(
  directive: PersistedOpponentDirective,
  output: OpponentPlannerModelOutput,
): void {
  if (directive.plannerOutputHash !== hashOpponentPlannerModelOutput(output)) {
    return invalidOpponentPlan();
  }

  if (directive.selectedMoveIndex === null) {
    if (
      directive.directive.kind !== "end_examination" ||
      output.proposedMoves.some(
        (move) =>
          move.kind === "question_witness" &&
          move.witnessId === directive.appearance.witnessId,
      ) ||
      directive.directive.disposition !==
        (directive.appearance.answeredQuestionCount === 0
          ? "waived"
          : "completed")
    ) {
      return invalidOpponentPlan();
    }
    return;
  }

  const selectedMove = output.proposedMoves[directive.selectedMoveIndex];
  if (
    selectedMove?.kind !== "question_witness" ||
    directive.directive.kind !== "question_witness" ||
    selectedMove.witnessId !== directive.appearance.witnessId ||
    directive.directive.witnessId !== selectedMove.witnessId ||
    directive.directive.goal !== selectedMove.goal ||
    !sameOrderedIdentifiers(
      directive.directive.presentedEvidenceIds,
      selectedMove.presentedEvidenceIds,
    ) ||
    !sameOrderedIdentifiers(
      directive.directive.permittedFactIds,
      selectedMove.citations.factIds,
    ) ||
    !sameOrderedIdentifiers(
      directive.directive.permittedEvidenceIds,
      selectedMove.citations.evidenceIds,
    ) ||
    !sameOrderedIdentifiers(
      directive.directive.permittedTestimonyIds,
      selectedMove.citations.testimonyIds,
    )
  ) {
    return invalidOpponentPlan();
  }
}

type GeneratedOpponentPlanAction = Extract<
  TrialActionV3,
  { type: "UPDATE_OPPOSING_STRATEGY" }
>;

function requireGeneratedOpponentPlanAction(
  action: TrialActionV3,
  generation: HearingOpponentPlanPrecommit,
): GeneratedOpponentPlanAction {
  if (
    action.type !== "UPDATE_OPPOSING_STRATEGY" ||
    action.source !== "ai" ||
    action.actor.role !== "opposing_counsel" ||
    action.actor.side !== "opposing" ||
    action.actor.witnessId !== null ||
    action.modelMetadata === null ||
    action.responseId !== null ||
    action.interruptId !== null
  ) {
    return invalidOpponentPlan();
  }

  const { output, trace } = generation;
  if (
    trace.expectedStateVersion === null ||
    trace.expectedLastEventId === null ||
    action.trialId !== generation.trialId ||
    action.trialId !== trace.trialId ||
    action.actor.actorId !== trace.actorId ||
    action.expectedStateVersion !== trace.expectedStateVersion ||
    action.causationId !== trace.expectedLastEventId ||
    action.correlationId !== action.trialId ||
    !sameCanonicalJson(action.modelMetadata, generation.modelMetadata)
  ) {
    return staleOpponentPlan();
  }

  if (
    !sameOrderedStrings(action.payload.objectives, output.objectives) ||
    !sameOrderedIdentifiers(
      action.payload.witnessPriorityIds,
      output.witnessPriorityIds,
    ) ||
    !sameOrderedIdentifiers(
      action.payload.evidencePriorityIds,
      output.evidencePriorityIds,
    ) ||
    action.payload.settlementPosture !== output.settlementPosture ||
    !sameOrderedStrings(action.payload.privateNotes, output.privateNotes) ||
    typeof action.payload.pendingDirectiveJson !== "string"
  ) {
    return invalidOpponentPlan();
  }

  let directive: PersistedOpponentDirective;
  try {
    directive = parsePersistedOpponentDirective(
      action.payload.pendingDirectiveJson,
    );
  } catch {
    return invalidOpponentPlan();
  }
  if (
    directive.decisionId !== generation.decisionId ||
    directive.plannerCallId !== generation.callId ||
    directive.strategyId !== action.payload.strategyId ||
    directive.strategyRevision !== action.payload.revision ||
    directive.strategyEventId !== eventIdForGeneratedAction(action.actionId) ||
    directive.trialHead.trialId !== action.trialId ||
    directive.trialHead.stateVersion !== action.expectedStateVersion ||
    directive.trialHead.lastEventId !== action.causationId ||
    directive.actorId !== action.actor.actorId
  ) {
    return invalidOpponentPlan();
  }
  requireDirectiveMatchesPlannerOutput(directive, output);
  return action;
}

function requireOpponentDirectiveAtCurrentHead(
  state: TrialStateV3,
  action: GeneratedOpponentPlanAction,
): void {
  let directive: PersistedOpponentDirective;
  try {
    directive = parsePersistedOpponentDirective(
      action.payload.pendingDirectiveJson ?? "",
    );
  } catch {
    return invalidOpponentPlan();
  }
  const appearance = state.activeAppearanceId
    ? state.appearances[state.activeAppearanceId]
    : undefined;
  const leg = appearance?.legs[directive.appearance.examinationKind];
  if (
    state.version !== action.expectedStateVersion ||
    state.eventIds.at(-1) !== action.causationId ||
    state.activeAppearanceId !== directive.appearance.appearanceId ||
    state.activeWitnessId !== directive.appearance.witnessId ||
    appearance?.witnessId !== directive.appearance.witnessId ||
    appearance?.stage !== directive.appearance.examinationKind ||
    leg?.answeredQuestionCount !==
      directive.appearance.answeredQuestionCount ||
    !sameCanonicalJson(state.actors[action.actor.actorId], action.actor)
  ) {
    return staleOpponentPlan();
  }
}

async function requireStoredGeneratedEvent(
  ctx: MutationCtx,
  input: Readonly<{
    action: TrialActionV3;
    eventId: string;
  }>,
): Promise<TrialEventV3> {
  const row = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) => index.eq("eventId", input.eventId))
    .unique();
  if (!row) throw new Error("GENERATED_EVENT_NOT_FOUND");
  const event = storedEventToV3(row);
  if (
    event.actionId !== input.action.actionId ||
    event.trialId !== input.action.trialId ||
    event.type !== input.action.type ||
    !sameCanonicalJson(event.actor, input.action.actor) ||
    event.source !== input.action.source ||
    event.causationId !== input.action.causationId ||
    event.correlationId !== input.action.correlationId ||
    event.responseId !== input.action.responseId ||
    event.interruptId !== input.action.interruptId ||
    !sameCanonicalJson(event.modelMetadata, input.action.modelMetadata) ||
    !sameCanonicalJson(event.payload, input.action.payload)
  ) {
    throw new Error("GENERATED_EVENT_CONFLICT");
  }
  return event;
}

async function requireCounselDirectiveAtHead(
  ctx: MutationCtx,
  generation: HearingCounselResponsePrecommit,
): Promise<PersistedOpponentDirective> {
  const row = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) =>
      index.eq("eventId", generation.expectedLastEventId),
    )
    .unique();
  if (!row) return staleCounselResponse();

  const event = storedEventToV3(row);
  if (
    event.trialId !== generation.trialId ||
    event.stateVersion !== generation.expectedStateVersion ||
    event.type !== "UPDATE_OPPOSING_STRATEGY" ||
    event.actor.actorId !== generation.trace.actorId ||
    event.source !== "ai" ||
    typeof event.payload.pendingDirectiveJson !== "string"
  ) {
    return staleCounselResponse();
  }

  let directive: PersistedOpponentDirective;
  try {
    directive = parsePersistedOpponentDirective(
      event.payload.pendingDirectiveJson,
    );
  } catch {
    return invalidCounselResponse();
  }
  if (
    directive.decisionId !== generation.decisionId ||
    directive.plannerCallId !== generation.planBinding.plannerCallId ||
    directive.plannerOutputHash !== generation.planBinding.plannerOutputHash ||
    directive.strategyId !== generation.planBinding.strategyId ||
    directive.strategyRevision !== generation.planBinding.strategyRevision ||
    directive.strategyId !== event.payload.strategyId ||
    directive.strategyRevision !== event.payload.revision ||
    directive.strategyEventId !== event.eventId ||
    directive.trialHead.trialId !== event.trialId ||
    directive.trialHead.stateVersion + 1 !== event.stateVersion ||
    directive.trialHead.lastEventId !== event.causationId ||
    directive.actorId !== event.actor.actorId
  ) {
    return invalidCounselResponse();
  }
  return directive;
}

function materializedCounselText(
  output: CounselRoleResponseModelOutput,
): string {
  return output.speechSegments.map((segment) => segment.text).join(" ");
}

function citationsWithinDirective(
  output: CounselRoleResponseModelOutput,
  directive: PersistedOpponentDirective,
): boolean {
  if (directive.directive.kind !== "question_witness") {
    return output.speechSegments.every(
      (segment) =>
        segment.citations.factIds.length === 0 &&
        segment.citations.evidenceIds.length === 0 &&
        segment.citations.testimonyIds.length === 0,
    );
  }
  const allowedFacts = new Set(directive.directive.permittedFactIds);
  const allowedEvidence = new Set(
    directive.directive.permittedEvidenceIds,
  );
  const allowedTestimony = new Set(
    directive.directive.permittedTestimonyIds,
  );
  return output.speechSegments.every(
    (segment) =>
      segment.citations.factIds.every((id) => allowedFacts.has(id)) &&
      segment.citations.evidenceIds.every((id) => allowedEvidence.has(id)) &&
      segment.citations.testimonyIds.every((id) =>
        allowedTestimony.has(id),
      ) &&
      segment.citations.factIds.length +
        segment.citations.evidenceIds.length +
        segment.citations.testimonyIds.length >
        0,
  );
}

type GeneratedCounselAction = Extract<
  TrialActionV3,
  { type: "ASK_QUESTION" | "END_EXAMINATION" }
>;

function requireGeneratedCounselAction(
  action: TrialActionV3,
  generation: HearingCounselResponsePrecommit,
  directive: PersistedOpponentDirective,
): GeneratedCounselAction {
  if (
    (action.type !== "ASK_QUESTION" &&
      action.type !== "END_EXAMINATION") ||
    action.source !== "ai" ||
    action.actor.role !== "opposing_counsel" ||
    action.actor.side !== "opposing" ||
    action.actor.witnessId !== null ||
    action.modelMetadata === null ||
    action.responseId !== null ||
    action.interruptId !== null ||
    action.trialId !== generation.trialId ||
    action.actor.actorId !== generation.trace.actorId ||
    action.actor.actorId !== directive.actorId ||
    action.expectedStateVersion !== generation.expectedStateVersion ||
    action.causationId !== generation.expectedLastEventId ||
    action.correlationId !== action.trialId ||
    !sameCanonicalJson(action.modelMetadata, generation.modelMetadata) ||
    !citationsWithinDirective(generation.output, directive)
  ) {
    return invalidCounselResponse();
  }

  const output = generation.output;
  const citations = counselResponseOutputCitations(output);
  const text = materializedCounselText(output);
  if (directive.directive.kind === "question_witness") {
    if (
      action.type !== "ASK_QUESTION" ||
      output.proposedAction.kind !== "ask_question" ||
      !text.includes("?") ||
      action.payload.witnessId !== directive.appearance.witnessId ||
      action.payload.examinationKind !==
        directive.appearance.examinationKind ||
      action.payload.text !== text ||
      !sameOrderedIdentifiers(
        output.proposedAction.presentedEvidenceIds,
        directive.directive.presentedEvidenceIds,
      ) ||
      !sameOrderedIdentifiers(
        action.payload.presentedEvidenceIds,
        directive.directive.presentedEvidenceIds,
      ) ||
      !sameIdentifierSet(action.payload.factIds ?? [], citations.factIds) ||
      !sameIdentifierSet(
        action.payload.evidenceIds ?? [],
        citations.evidenceIds,
      ) ||
      !sameIdentifierSet(
        action.payload.testimonyIds ?? [],
        citations.testimonyIds,
      )
    ) {
      return invalidCounselResponse();
    }
    return action;
  }

  if (
    action.type !== "END_EXAMINATION" ||
    output.proposedAction.kind !== "end_examination" ||
    output.proposedAction.disposition !== directive.directive.disposition ||
    action.payload.witnessId !== directive.appearance.witnessId ||
    action.payload.examinationKind !== directive.appearance.examinationKind ||
    action.payload.disposition !== directive.directive.disposition ||
    action.payload.turnId === undefined ||
    action.payload.text !== text ||
    action.payload.citations === undefined ||
    !sameIdentifierSet(
      action.payload.citations.factIds,
      citations.factIds,
    ) ||
    !sameIdentifierSet(
      action.payload.citations.evidenceIds,
      citations.evidenceIds,
    ) ||
    !sameIdentifierSet(
      action.payload.citations.testimonyIds,
      citations.testimonyIds,
    ) ||
    !sameIdentifierSet(
      action.payload.citations.eventIds,
      citations.eventIds,
    ) ||
    !sameIdentifierSet(
      action.payload.citations.sourceSegmentIds,
      citations.sourceSegmentIds,
    )
  ) {
    return invalidCounselResponse();
  }
  return action;
}

function requireCounselContinuation(
  continuation: TrialActionV3 | null,
  primary: GeneratedCounselAction,
): TrialActionV3 | null {
  if (primary.type === "ASK_QUESTION") {
    if (
      continuation === null ||
      continuation.type !== "REQUEST_RESPONSE" ||
      continuation.source !== "system" ||
      continuation.actor.role !== "system" ||
      continuation.actor.side !== "neutral" ||
      continuation.actor.witnessId !== null ||
      continuation.modelMetadata !== null ||
      continuation.interruptId !== null ||
      continuation.responseId === null ||
      continuation.responseId !== continuation.payload.responseId ||
      continuation.payload.purpose !== "answer_question" ||
      continuation.trialId !== primary.trialId ||
      continuation.expectedStateVersion !==
        primary.expectedStateVersion + 1 ||
      continuation.causationId !==
        eventIdForGeneratedAction(primary.actionId) ||
      continuation.correlationId !== primary.trialId
    ) {
      return invalidCounselResponse();
    }
    return continuation;
  }

  if (continuation === null) return null;
  if (
    continuation.type !== "RELEASE_WITNESS" ||
    continuation.source !== "deterministic" ||
    (continuation.actor.role !== "user_counsel" &&
      continuation.actor.role !== "opposing_counsel") ||
    continuation.actor.side !==
      (continuation.actor.role === "user_counsel" ? "user" : "opposing") ||
    continuation.actor.witnessId !== null ||
    continuation.modelMetadata !== null ||
    continuation.responseId !== null ||
    continuation.interruptId !== null ||
    continuation.trialId !== primary.trialId ||
    continuation.expectedStateVersion !== primary.expectedStateVersion + 1 ||
    continuation.causationId !== eventIdForGeneratedAction(primary.actionId) ||
    continuation.correlationId !== primary.trialId ||
    continuation.payload.witnessId !== primary.payload.witnessId
  ) {
    return invalidCounselResponse();
  }
  return continuation;
}

async function requirePublishedGraph(
  ctx: DbContext,
  graphId: string,
  ownerId: string,
): Promise<{ record: Doc<"caseGraphs">; graph: CaseGraphV1 }> {
  assertIdentifier(graphId, "graphId");
  const record = await ctx.db
    .query("caseGraphs")
    .withIndex("by_graph_id", (index) => index.eq("graphId", graphId))
    .unique();
  if (!record || record.lifecycle !== "published") {
    throw new Error("CASE_GRAPH_NOT_FOUND");
  }
  const ownerCanRead =
    record.visibility === "seeded_public" ||
    (record.visibility === "private" && record.ownerId === ownerId);
  if (!ownerCanRead) throw new Error("CASE_GRAPH_NOT_FOUND");

  const graph = CaseGraphV1Schema.safeParse(
    parseJsonObject(record.graphJson, "caseGraph.graphJson"),
  );
  if (
    !graph.success ||
    graph.data.caseId !== record.caseId ||
    graph.data.status !== "published" ||
    graph.data.schemaVersion !== record.graphSchemaVersion ||
    graph.data.title !== record.title
  ) {
    throw new Error("CASE_GRAPH_CONFLICT");
  }
  return { record, graph: graph.data };
}

function requireOwnedProjection(
  projection: Doc<"trialProjections"> | null,
  ownerId: string,
): Doc<"trialProjections"> {
  if (!projection || projection.ownerId !== ownerId) {
    throw new Error("TRIAL_NOT_FOUND");
  }
  return projection;
}

function requireActiveProjectionMetadata(
  projection: Doc<"trialProjections">,
): asserts projection is Doc<"trialProjections"> & {
  ownerId: string;
  graphId: string;
  caseId: string;
  caseVersion: number;
} {
  if (
    !projection.ownerId ||
    !projection.graphId ||
    !projection.caseId ||
    projection.caseVersion === undefined ||
    projection.stateSchemaVersion !== TRIAL_STATE_SCHEMA_VERSION_V3 ||
    projection.eventSchemaVersion !== TRIAL_EVENT_SCHEMA_VERSION_V3
  ) {
    throw new Error("TRIAL_MIGRATION_REQUIRED");
  }
}

function modelMetadataForStoredEvent(record: Doc<"trialEvents">) {
  if (!record.model) return null;
  if (!record.promptVersion || !record.modelSchemaVersion) {
    throw new Error("TRIAL_EVENT_MODEL_METADATA_INVALID");
  }
  return {
    model: record.model,
    requestId: record.modelRequestId ?? null,
    promptVersion: record.promptVersion,
    schemaVersion: record.modelSchemaVersion,
    latencyMs: record.modelLatencyMs ?? null,
    inputTokens: record.inputTokens ?? null,
    outputTokens: record.outputTokens ?? null,
    estimatedCostUsd: record.estimatedCostUsd ?? null,
    retryCount: record.retryCount ?? 0,
    validationFailureCount: record.validationFailureCount ?? 0,
  };
}

function storedEventToV3(record: Doc<"trialEvents">): TrialEventV3 {
  if (
    record.eventSchemaVersion !== TRIAL_EVENT_SCHEMA_VERSION_V3 ||
    record.payloadSchemaVersion !== TRIAL_ACTION_SCHEMA_VERSION_V3
  ) {
    throw new Error("TRIAL_MIGRATION_REQUIRED");
  }
  return TrialEventV3Schema.parse({
    schemaVersion: record.eventSchemaVersion,
    eventId: record.eventId,
    trialId: record.trialId,
    sequence: record.sequence,
    stateVersion: record.stateVersion,
    actionId: record.actionId,
    actor: {
      actorId: record.actorId,
      role: record.actorRole,
      side: record.actorSide,
      witnessId: record.witnessId ?? null,
    },
    source: record.source,
    occurredAt:
      record.occurredAtIso ?? new Date(record.occurredAt).toISOString(),
    causationId: record.causationId ?? null,
    correlationId: record.correlationId ?? null,
    responseId: record.responseId ?? null,
    interruptId: record.interruptId ?? null,
    modelMetadata: modelMetadataForStoredEvent(record),
    citations: {
      factIds: record.factIds,
      evidenceIds: record.evidenceIds,
      testimonyIds: record.testimonyIds,
      eventIds: record.citationEventIds,
      sourceSegmentIds: record.sourceSegmentIds,
    },
    type: record.eventType,
    payload: parseJsonObject(record.payloadJson, "trialEvent.payloadJson"),
  });
}

function replayCommittedEvent(
  state: TrialStateV3,
  event: TrialEventV3,
): TrialStateV3 {
  const action = TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: event.actionId,
    trialId: event.trialId,
    expectedStateVersion: event.stateVersion - 1,
    actor: event.actor,
    source: event.source,
    requestedAt: event.occurredAt,
    causationId: event.causationId,
    correlationId: event.correlationId,
    responseId: event.responseId,
    interruptId: event.interruptId,
    modelMetadata: event.modelMetadata,
    type: event.type,
    payload: event.payload,
  });
  const committed = commitAction(state, action);
  if (!sameCanonicalJson(committed.event, event)) {
    throw new Error(`TRIAL_EVENT_ENVELOPE_MISMATCH:${event.eventId}`);
  }
  return TrialStateV3Schema.parse(committed.state);
}

function assertStateMatchesProjection(
  state: TrialStateV3,
  projection: Doc<"trialProjections">,
): void {
  if (
    state.trialId !== projection.trialId ||
    state.version !== projection.stateVersion ||
    state.lastSequence !== projection.lastSequence ||
    (projection.caseId !== undefined && state.caseId !== projection.caseId) ||
    (projection.caseVersion !== undefined &&
      state.caseVersion !== projection.caseVersion)
  ) {
    throw new Error("TRIAL_PROJECTION_METADATA_MISMATCH");
  }
}

async function loadActiveHead(
  ctx: DbContext,
  projection: Doc<"trialProjections">,
): Promise<TrialStateV3> {
  requireActiveProjectionMetadata(projection);
  const claimedState = TrialStateV3Schema.parse(
    parseJsonObject(projection.stateJson, "projection.stateJson"),
  );
  assertStateMatchesProjection(claimedState, projection);

  const snapshots = await ctx.db
    .query("trialSnapshots")
    .withIndex("by_trial_version", (index) =>
      index.eq("trialId", projection.trialId),
    )
    .order("desc")
    .collect();
  const activeSnapshot = snapshots.find(
    (snapshot) =>
      snapshot.stateSchemaVersion === TRIAL_STATE_SCHEMA_VERSION_V3 &&
      snapshot.lastSequence <= projection.lastSequence,
  );

  let replayed: TrialStateV3;
  let prefixSequence: number;
  if (activeSnapshot) {
    replayed = TrialStateV3Schema.parse(
      parseJsonObject(activeSnapshot.stateJson, "snapshot.stateJson"),
    );
    if (
      replayed.trialId !== projection.trialId ||
      replayed.version !== activeSnapshot.stateVersion ||
      replayed.lastSequence !== activeSnapshot.lastSequence
    ) {
      throw new Error("TRIAL_SNAPSHOT_METADATA_MISMATCH");
    }
    prefixSequence = activeSnapshot.lastSequence;
  } else {
    const firstRows = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index.eq("trialId", projection.trialId),
      )
      .order("asc")
      .take(MAX_REPLAY_EVENTS + 1);
    if (firstRows.length === 0 || firstRows.length > MAX_REPLAY_EVENTS) {
      throw new Error("TRIAL_REPLAY_LIMIT_EXCEEDED");
    }
    replayed = TrialStateV3Schema.parse(
      reduceTrial(firstRows.map(storedEventToV3)),
    );
    prefixSequence = projection.lastSequence;
  }

  if (activeSnapshot) {
    const suffix = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index
          .eq("trialId", projection.trialId)
          .gt("sequence", prefixSequence),
      )
      .order("asc")
      .take(MAX_REPLAY_EVENTS + 1);
    if (suffix.length > MAX_REPLAY_EVENTS) {
      throw new Error("TRIAL_REPLAY_LIMIT_EXCEEDED");
    }
    let expectedSequence = prefixSequence + 1;
    for (const row of suffix) {
      if (row.sequence !== expectedSequence) {
        throw new Error("TRIAL_EVENT_SEQUENCE_GAP");
      }
      replayed = replayCommittedEvent(replayed, storedEventToV3(row));
      expectedSequence += 1;
    }
  }

  if (
    replayed.lastSequence !== projection.lastSequence ||
    replayed.version !== projection.stateVersion ||
    !sameCanonicalJson(replayed, claimedState)
  ) {
    throw new Error("TRIAL_PROJECTION_MISMATCH");
  }
  return claimedState;
}

function referenceIdsFromPayload(
  payload: unknown,
  singular: string,
  plural: string,
): string[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const values: string[] = [];
  if (typeof record[singular] === "string") values.push(record[singular]);
  if (Array.isArray(record[plural])) {
    values.push(
      ...record[plural].filter(
        (value): value is string => typeof value === "string",
      ),
    );
  }
  return [...new Set(values)];
}

function eventStorageRecord(event: TrialEventV3, committedAt: number) {
  const payloadJson = canonicalJson(event.payload);
  if (payloadJson.length > MAX_JSON_CHARACTERS) {
    throw new Error("TRIAL_EVENT_PAYLOAD_TOO_LARGE");
  }
  const occurredAt = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurredAt) || occurredAt < 0) {
    throw new Error("TRIAL_EVENT_OCCURRED_AT_INVALID");
  }
  const model = event.modelMetadata;
  return {
    eventId: event.eventId,
    trialId: event.trialId,
    sequence: event.sequence,
    stateVersion: event.stateVersion,
    actionId: event.actionId,
    eventType: event.type,
    actorId: event.actor.actorId,
    actorRole: event.actor.role,
    actorSide: event.actor.side,
    witnessId: event.actor.witnessId ?? undefined,
    source: event.source,
    causationId: event.causationId ?? undefined,
    correlationId: event.correlationId ?? undefined,
    responseId: event.responseId ?? undefined,
    interruptId: event.interruptId ?? undefined,
    payloadJson,
    payloadSchemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    eventSchemaVersion: event.schemaVersion,
    promptVersion: model?.promptVersion,
    model: model?.model,
    modelRequestId: model?.requestId ?? undefined,
    modelSchemaVersion: model?.schemaVersion,
    modelLatencyMs: model?.latencyMs ?? undefined,
    inputTokens: model?.inputTokens ?? undefined,
    outputTokens: model?.outputTokens ?? undefined,
    estimatedCostUsd: model?.estimatedCostUsd ?? undefined,
    retryCount: model?.retryCount,
    validationFailureCount: model?.validationFailureCount,
    factIds: assertReferences(event.citations.factIds, "factIds"),
    evidenceIds: assertReferences(event.citations.evidenceIds, "evidenceIds"),
    testimonyIds: assertReferences(event.citations.testimonyIds, "testimonyIds"),
    citationEventIds: assertReferences(event.citations.eventIds, "eventIds"),
    sourceSegmentIds: assertReferences(
      event.citations.sourceSegmentIds,
      "sourceSegmentIds",
    ),
    turnIds: assertReferences(
      referenceIdsFromPayload(event.payload, "turnId", "turnIds"),
      "turnIds",
    ),
    occurredAt,
    occurredAtIso: event.occurredAt,
    committedAt,
  };
}

function receiptResult(
  receipt: Doc<"actionReceipts">,
  replayed: boolean,
) {
  return {
    receiptId: receipt.receiptId,
    trialId: receipt.trialId,
    actionId: receipt.actionId,
    committedStateVersion: receipt.committedStateVersion,
    firstSequence: receipt.firstSequence,
    lastSequence: receipt.lastSequence,
    eventIds: receipt.eventIds,
    replayed,
  };
}

function replayExistingReceipt(
  receipt: Doc<"actionReceipts">,
  action: TrialActionV3,
  requestHash: string,
) {
  if (
    receipt.trialId !== action.trialId ||
    receipt.expectedStateVersion !== action.expectedStateVersion ||
    receipt.requestHash !== requestHash ||
    receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION
  ) {
    throw new Error("ACTION_ID_CONFLICT");
  }
  return receiptResult(receipt, true);
}

async function persistCommit(
  ctx: MutationCtx,
  input: {
    ownerId: string;
    graphId: string;
    currentProjection: Doc<"trialProjections"> | null;
    action: TrialActionV3;
    requestHash: string;
    commit: CommitResult;
    writeSnapshot: boolean;
  },
) {
  const { action, commit, currentProjection } = input;
  const state = TrialStateV3Schema.parse(commit.state);
  const event = TrialEventV3Schema.parse(commit.event);
  const stateJson = canonicalJson(state);
  if (stateJson.length > MAX_JSON_CHARACTERS) {
    throw new Error("TRIAL_STATE_TOO_LARGE");
  }
  const existingEvent = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) => index.eq("eventId", event.eventId))
    .unique();
  if (existingEvent) throw new Error("DUPLICATE_EVENT_ID");

  const committedAt = Date.now();
  await ctx.db.insert("trialEvents", eventStorageRecord(event, committedAt));
  if (currentProjection) {
    await ctx.db.patch(currentProjection._id, {
      stateVersion: state.version,
      lastSequence: state.lastSequence,
      stateJson,
      stateSchemaVersion: state.schemaVersion,
      eventSchemaVersion: event.schemaVersion,
      updatedAt: committedAt,
    });
  } else {
    await ctx.db.insert("trialProjections", {
      projectionId: `projection:${action.trialId}`,
      trialId: action.trialId,
      ownerId: input.ownerId,
      graphId: input.graphId,
      caseId: state.caseId,
      caseVersion: state.caseVersion,
      stateVersion: state.version,
      lastSequence: state.lastSequence,
      stateJson,
      stateSchemaVersion: state.schemaVersion,
      eventSchemaVersion: event.schemaVersion,
      createdAt: committedAt,
      updatedAt: committedAt,
    });
  }

  if (input.writeSnapshot) {
    const existingSnapshot = await ctx.db
      .query("trialSnapshots")
      .withIndex("by_trial_version", (index) =>
        index
          .eq("trialId", action.trialId)
          .eq("stateVersion", state.version),
      )
      .unique();
    if (existingSnapshot) throw new Error("DUPLICATE_SNAPSHOT_VERSION");
    await ctx.db.insert("trialSnapshots", {
      snapshotId: `snapshot:${action.trialId}:${state.version}`,
      trialId: action.trialId,
      stateVersion: state.version,
      lastSequence: state.lastSequence,
      stateJson,
      stateSchemaVersion: state.schemaVersion,
      source: "event_commit",
      createdAt: committedAt,
    });
  }

  const receiptId = `receipt:${action.actionId}`;
  const resultJson = canonicalJson({
    eventId: event.eventId,
    stateVersion: state.version,
    sequence: state.lastSequence,
  });
  await ctx.db.insert("actionReceipts", {
    receiptId,
    actionId: action.actionId,
    trialId: action.trialId,
    status: "committed",
    expectedStateVersion: action.expectedStateVersion,
    committedStateVersion: state.version,
    firstSequence: event.sequence,
    lastSequence: event.sequence,
    eventIds: [event.eventId],
    requestHash: input.requestHash,
    resultJson,
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    createdAt: committedAt,
  });
  return {
    receiptId,
    trialId: action.trialId,
    actionId: action.actionId,
    committedStateVersion: state.version,
    firstSequence: event.sequence,
    lastSequence: event.sequence,
    eventIds: [event.eventId],
    replayed: false,
  };
}

const createTrialArgs = {
  trialId: v.string(),
  graphId: v.string(),
  actionId: v.string(),
  requestedAt: v.number(),
  actorBindings: v.array(actorBinding),
  userSide: v.optional(v.union(v.literal("user"), v.literal("opposing"))),
};

async function createTrialForOwner(
  ctx: MutationCtx,
  args: {
    trialId: string;
    graphId: string;
    actionId: string;
    requestedAt: number;
    actorBindings: TrialPolicyActorBindingInput[];
    userSide?: "user" | "opposing";
  },
  ownerId: string,
) {
    assertIdentifier(ownerId, "ownerId");
    assertIdentifier(args.trialId, "trialId");
    assertIdentifier(args.actionId, "actionId");
    if (!Number.isFinite(args.requestedAt) || args.requestedAt < 0) {
      throw new Error("requestedAt must be a non-negative timestamp");
    }
    const { graph } = await requirePublishedGraph(ctx, args.graphId, ownerId);
    const bindings = args.actorBindings;
    const action = TrialActionV3Schema.parse(
      createStartTrialAction({
        trialId: args.trialId,
        actionId: args.actionId,
        requestedAt: new Date(args.requestedAt).toISOString(),
        graph,
        actors: bindings.map((binding) => binding.actor) as ActorRef[],
        actorBindings: bindings,
        userSide: args.userSide,
      }),
    );
    const requestHash = await sha256Hex(canonicalJson(action));

    const projection = await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", args.trialId))
      .unique();
    if (projection) {
      requireOwnedProjection(projection, ownerId);
      const receipt = await ctx.db
        .query("actionReceipts")
        .withIndex("by_action_id", (index) =>
          index.eq("actionId", action.actionId),
        )
        .unique();
      if (receipt) return replayExistingReceipt(receipt, action, requestHash);
      throw new Error("TRIAL_ALREADY_EXISTS");
    }
    const conflictingReceipt = await ctx.db
      .query("actionReceipts")
      .withIndex("by_action_id", (index) =>
        index.eq("actionId", action.actionId),
      )
      .unique();
    if (conflictingReceipt) throw new Error("ACTION_ID_CONFLICT");

    const committed = commitAction(null, action);
    return await persistCommit(ctx, {
      ownerId,
      graphId: args.graphId,
      currentProjection: null,
      action,
      requestHash,
      commit: committed,
      writeSnapshot: true,
    });
}

/**
 * Starts an owner-bound event stream from an immutable published CaseGraph.
 * Owner identity is derived exclusively from Convex auth.
 */
export const createTrial = mutation({
  args: createTrialArgs,
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    return await createTrialForOwner(
      ctx,
      {
        ...args,
        actorBindings: args.actorBindings as TrialPolicyActorBindingInput[],
      },
      ownerId,
    );
  },
});

/** Trusted server facade for an owner session verified outside Convex auth. */
export const createForOwner = internalMutation({
  args: { ownerId: v.string(), ...createTrialArgs },
  handler: async (ctx, args) => {
    const { ownerId, ...createArgs } = args;
    return await createTrialForOwner(
      ctx,
      {
        ...createArgs,
        actorBindings:
          createArgs.actorBindings as TrialPolicyActorBindingInput[],
      },
      ownerId,
    );
  },
});

function assertPlayerControlledAction(
  state: TrialStateV3,
  action: TrialActionV3,
): void {
  const expectedRole =
    state.userSide === "user" ? "user_counsel" : "opposing_counsel";
  if (
    (action.source !== "user" && action.source !== "speech") ||
    action.actor.role !== expectedRole ||
    action.actor.side !== state.userSide
  ) {
    throw new Error("PLAYER_ACTION_NOT_PERMITTED");
  }
}

async function appendActiveAction(
  ctx: MutationCtx,
  input: {
    action: TrialActionV3;
    ownerId: string;
    projection: Doc<"trialProjections">;
    writeSnapshot?: boolean;
    playerControlledOnly: boolean;
  },
) {
  const { action, ownerId, projection } = input;
  const requestHash = await sha256Hex(canonicalJson(action));
  requireActiveProjectionMetadata(projection);
  const { graph } = await requirePublishedGraph(
    ctx,
    projection.graphId,
    ownerId,
  );
  if (
    graph.caseId !== projection.caseId ||
    graph.version !== projection.caseVersion
  ) {
    throw new Error("TRIAL_CASE_GRAPH_MISMATCH");
  }

  const claimedState = TrialStateV3Schema.parse(
    parseJsonObject(projection.stateJson, "projection.stateJson"),
  );
  assertStateMatchesProjection(claimedState, projection);
  if (input.playerControlledOnly) {
    assertPlayerControlledAction(claimedState, action);
  }

  const receipt = await ctx.db
    .query("actionReceipts")
    .withIndex("by_action_id", (index) =>
      index.eq("actionId", action.actionId),
    )
    .unique();
  if (receipt) return replayExistingReceipt(receipt, action, requestHash);
  if (action.expectedStateVersion !== projection.stateVersion) {
    throw new Error(
      `STALE_STATE_VERSION:${action.expectedStateVersion}:${projection.stateVersion}`,
    );
  }

  const state = await loadActiveHead(ctx, projection);
  const committed = commitAction(state, action);
  const writeSnapshot =
    input.writeSnapshot === true ||
    committed.event.sequence % SNAPSHOT_INTERVAL === 0;
  return await persistCommit(ctx, {
    ownerId,
    graphId: projection.graphId,
    currentProjection: projection,
    action,
    requestHash,
    commit: committed,
    writeSnapshot,
  });
}

/** Commits one player-controlled active-v3 action for the authenticated owner. */
export const append = mutation({
  args: {
    actionJson: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const action = TrialActionV3Schema.parse(
      parseJsonObject(args.actionJson, "actionJson"),
    );
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", action.trialId),
        )
        .unique(),
      ownerId,
    );
    return await appendActiveAction(ctx, {
      action,
      ownerId,
      projection,
      playerControlledOnly: true,
    });
  },
});

/**
 * Trusted service boundary for a player action whose owner session was verified
 * by the server facade. Actor/source restrictions remain identical to append.
 */
export const appendPlayerForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJson: v.string(),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    const action = TrialActionV3Schema.parse(
      parseJsonObject(args.actionJson, "actionJson"),
    );
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", action.trialId),
        )
        .unique(),
      args.ownerId,
    );
    return await appendActiveAction(ctx, {
      action,
      ownerId: args.ownerId,
      projection,
      playerControlledOnly: true,
    });
  },
});

/** Trusted server boundary for deterministic, AI, speech, and system actions. */
export const appendTrusted = internalMutation({
  args: {
    actionJson: v.string(),
    writeSnapshot: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const action = TrialActionV3Schema.parse(
      parseJsonObject(args.actionJson, "actionJson"),
    );
    const projection = await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", action.trialId))
      .unique();
    if (!projection) throw new Error("TRIAL_NOT_FOUND");
    requireActiveProjectionMetadata(projection);
    return await appendActiveAction(ctx, {
      action,
      ownerId: projection.ownerId,
      projection,
      writeSnapshot: args.writeSnapshot,
      playerControlledOnly: false,
    });
  },
});

/**
 * Trusted generated/system append with an explicit owner guard for HTTP/server
 * orchestration. This prevents a valid service request from crossing trials.
 */
export const appendTrustedForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJson: v.string(),
    writeSnapshot: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    const action = TrialActionV3Schema.parse(
      parseJsonObject(args.actionJson, "actionJson"),
    );
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", action.trialId),
        )
        .unique(),
      args.ownerId,
    );
    return await appendActiveAction(ctx, {
      action,
      ownerId: args.ownerId,
      projection,
      writeSnapshot: args.writeSnapshot,
      playerControlledOnly: false,
    });
  },
});

/**
 * Atomically commits one accepted AI witness answer and its redacted model
 * call audit. Any generation mismatch or trace conflict aborts the entire
 * mutation, including the event, projection, receipt, and optional snapshot.
 */
export const appendGeneratedForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJson: v.string(),
    generationJson: v.string(),
    writeSnapshot: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    let actionInput: unknown;
    try {
      actionInput = parseJsonObject(args.actionJson, "actionJson");
    } catch {
      return invalidWitnessGeneration();
    }
    const parsedAction = TrialActionV3Schema.safeParse(actionInput);
    if (!parsedAction.success) return invalidWitnessGeneration();
    const generation = parseWitnessGenerationJson(args.generationJson);
    const action = requireGeneratedWitnessAnswerAction(
      parsedAction.data,
      generation,
    );
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", action.trialId),
        )
        .unique(),
      args.ownerId,
    );
    const receipt = await appendActiveAction(ctx, {
      action,
      ownerId: args.ownerId,
      projection,
      writeSnapshot: args.writeSnapshot,
      playerControlledOnly: false,
    });
    const committedEventId = receipt.eventIds[0];
    if (
      receipt.eventIds.length !== 1 ||
      committedEventId === undefined ||
      receipt.actionId !== action.actionId ||
      receipt.trialId !== action.trialId
    ) {
      return invalidWitnessGeneration();
    }
    await requireStoredGeneratedWitnessEvent(ctx, {
      action,
      eventId: committedEventId,
      trace: generation.trace,
    });

    const committedTrace = CourtroomModelCallTraceSchema.parse({
      ...generation.trace,
      committedActionId: action.actionId,
      committedEventId,
    });
    await persistTerminalCourtroomModelCallForOwner(ctx, {
      ownerId: args.ownerId,
      traceJson: canonicalJson(committedTrace),
    });
    return receipt;
  },
});

/**
 * Atomically commits one accepted private opponent plan and its redacted
 * audit. The canonical pending directive is stored only in private strategy
 * state and is bound to the exact pre-plan head and resulting strategy event.
 */
export const appendOpponentPlanForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJson: v.string(),
    generationJson: v.string(),
    writeSnapshot: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    let actionInput: unknown;
    try {
      actionInput = parseJsonObject(args.actionJson, "actionJson");
    } catch {
      return invalidOpponentPlan();
    }
    const parsedAction = TrialActionV3Schema.safeParse(actionInput);
    if (!parsedAction.success) return invalidOpponentPlan();
    const generation = parseOpponentPlanGenerationJson(args.generationJson);
    const action = requireGeneratedOpponentPlanAction(
      parsedAction.data,
      generation,
    );
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", action.trialId),
        )
        .unique(),
      args.ownerId,
    );
    if (projection.stateVersion === action.expectedStateVersion) {
      requireOpponentDirectiveAtCurrentHead(
        await loadActiveHead(ctx, projection),
        action,
      );
    }

    const receipt = await appendActiveAction(ctx, {
      action,
      ownerId: args.ownerId,
      projection,
      writeSnapshot: args.writeSnapshot,
      playerControlledOnly: false,
    });
    const committedEventId = receipt.eventIds[0];
    if (
      receipt.eventIds.length !== 1 ||
      committedEventId === undefined ||
      committedEventId !== eventIdForGeneratedAction(action.actionId) ||
      receipt.actionId !== action.actionId ||
      receipt.trialId !== action.trialId
    ) {
      return invalidOpponentPlan();
    }
    await requireStoredGeneratedEvent(ctx, {
      action,
      eventId: committedEventId,
    });

    const committedTrace = CourtroomModelCallTraceSchema.parse({
      ...generation.trace,
      committedActionId: action.actionId,
      committedEventId,
    });
    await persistTerminalCourtroomModelCallForOwner(ctx, {
      ownerId: args.ownerId,
      traceJson: canonicalJson(committedTrace),
    });
    return receipt;
  },
});

/**
 * Atomically commits one accepted public counsel turn, its required optional
 * deterministic continuation, and the redacted model audit. The audit always
 * points to the primary AI action/event rather than the continuation.
 */
export const appendCounselTurnForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJson: v.string(),
    continuationActionJson: v.union(v.string(), v.null()),
    generationJson: v.string(),
    writeSnapshot: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    let actionInput: unknown;
    let continuationInput: unknown = null;
    try {
      actionInput = parseJsonObject(args.actionJson, "actionJson");
      if (args.continuationActionJson !== null) {
        continuationInput = parseJsonObject(
          args.continuationActionJson,
          "continuationActionJson",
        );
      }
    } catch {
      return invalidCounselResponse();
    }
    const parsedAction = TrialActionV3Schema.safeParse(actionInput);
    const parsedContinuation =
      continuationInput === null
        ? null
        : TrialActionV3Schema.safeParse(continuationInput);
    if (
      !parsedAction.success ||
      (parsedContinuation !== null && !parsedContinuation.success)
    ) {
      return invalidCounselResponse();
    }

    const generation = parseCounselResponseGenerationJson(
      args.generationJson,
    );
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", parsedAction.data.trialId),
        )
        .unique(),
      args.ownerId,
    );
    const directive = await requireCounselDirectiveAtHead(ctx, generation);
    const action = requireGeneratedCounselAction(
      parsedAction.data,
      generation,
      directive,
    );
    const continuation = requireCounselContinuation(
      parsedContinuation?.data ?? null,
      action,
    );

    const receipt = await appendActiveAction(ctx, {
      action,
      ownerId: args.ownerId,
      projection,
      writeSnapshot:
        continuation === null ? args.writeSnapshot : false,
      playerControlledOnly: false,
    });
    const committedEventId = receipt.eventIds[0];
    if (
      receipt.eventIds.length !== 1 ||
      committedEventId === undefined ||
      committedEventId !== eventIdForGeneratedAction(action.actionId) ||
      receipt.actionId !== action.actionId ||
      receipt.trialId !== action.trialId
    ) {
      return invalidCounselResponse();
    }
    await requireStoredGeneratedEvent(ctx, {
      action,
      eventId: committedEventId,
    });

    if (continuation !== null) {
      const continuedProjection = requireOwnedProjection(
        await ctx.db
          .query("trialProjections")
          .withIndex("by_trial", (index) =>
            index.eq("trialId", action.trialId),
          )
          .unique(),
        args.ownerId,
      );
      const continuationReceipt = await appendActiveAction(ctx, {
        action: continuation,
        ownerId: args.ownerId,
        projection: continuedProjection,
        writeSnapshot: args.writeSnapshot,
        playerControlledOnly: false,
      });
      const continuationEventId = continuationReceipt.eventIds[0];
      if (
        continuationReceipt.eventIds.length !== 1 ||
        continuationEventId === undefined ||
        continuationEventId !==
          eventIdForGeneratedAction(continuation.actionId) ||
        continuationReceipt.actionId !== continuation.actionId ||
        continuationReceipt.trialId !== continuation.trialId
      ) {
        return invalidCounselResponse();
      }
      await requireStoredGeneratedEvent(ctx, {
        action: continuation,
        eventId: continuationEventId,
      });
    }

    const committedTrace = CourtroomModelCallTraceSchema.parse({
      ...generation.trace,
      committedActionId: action.actionId,
      committedEventId,
    });
    await persistTerminalCourtroomModelCallForOwner(ctx, {
      ownerId: args.ownerId,
      traceJson: canonicalJson(committedTrace),
    });
    return receipt;
  },
});

function publicEvent(row: Doc<"trialEvents">) {
  return {
    eventId: row.eventId,
    trialId: row.trialId,
    sequence: row.sequence,
    stateVersion: row.stateVersion,
    actionId: row.actionId,
    eventType: row.eventType,
    actorId: row.actorId,
    actorRole: row.actorRole,
    actorSide: row.actorSide,
    witnessId: row.witnessId ?? null,
    source: row.source,
    causationId: row.causationId ?? null,
    correlationId: row.correlationId ?? null,
    responseId: row.responseId ?? null,
    interruptId: row.interruptId ?? null,
    utteranceId: row.utteranceId ?? null,
    utteranceRevision: row.utteranceRevision ?? null,
    payloadJson: row.payloadJson,
    payloadSchemaVersion: row.payloadSchemaVersion,
    eventSchemaVersion: row.eventSchemaVersion,
    promptVersion: row.promptVersion ?? null,
    model: row.model ?? null,
    modelRequestId: row.modelRequestId ?? null,
    modelSchemaVersion: row.modelSchemaVersion ?? null,
    modelLatencyMs: row.modelLatencyMs ?? null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    estimatedCostUsd: row.estimatedCostUsd ?? null,
    retryCount: row.retryCount ?? null,
    validationFailureCount: row.validationFailureCount ?? null,
    factIds: row.factIds,
    evidenceIds: row.evidenceIds,
    testimonyIds: row.testimonyIds,
    citationEventIds: row.citationEventIds,
    sourceSegmentIds: row.sourceSegmentIds,
    turnIds: row.turnIds,
    occurredAt: row.occurredAt,
    committedAt: row.committedAt,
  };
}

/**
 * Returns a snapshot plus a contiguous ordered suffix. Legacy schema rows are
 * returned verbatim for the explicit domain migrator; no historical row is
 * rewritten in place.
 */
const reloadArgs = {
  trialId: v.string(),
  afterSequence: v.optional(v.number()),
  limit: v.optional(v.number()),
};

async function reloadForOwner(
  ctx: QueryCtx,
  args: {
    trialId: string;
    afterSequence?: number;
    limit?: number;
  },
  ownerId: string,
) {
    assertIdentifier(ownerId, "ownerId");
    assertIdentifier(args.trialId, "trialId");
    const afterSequence = args.afterSequence ?? 0;
    assertNonNegativeInteger(afterSequence, "afterSequence");
    const limit = args.limit ?? DEFAULT_RELOAD_EVENTS;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RELOAD_EVENTS) {
      throw new Error(`limit must be between 1 and ${MAX_RELOAD_EVENTS}`);
    }
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (index) =>
          index.eq("trialId", args.trialId),
        )
        .unique(),
      ownerId,
    );
    if (afterSequence > projection.lastSequence) {
      throw new Error("AFTER_SEQUENCE_AHEAD_OF_HEAD");
    }

    let validated = false;
    let requiresMigration =
      projection.stateSchemaVersion !== TRIAL_STATE_SCHEMA_VERSION_V3 ||
      projection.eventSchemaVersion !== TRIAL_EVENT_SCHEMA_VERSION_V3;
    if (!requiresMigration) {
      try {
        await loadActiveHead(ctx, projection);
        validated = true;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("TRIAL_MIGRATION_REQUIRED")
        ) {
          requiresMigration = true;
        } else {
          throw error;
        }
      }
    }

    const snapshots = await ctx.db
      .query("trialSnapshots")
      .withIndex("by_trial_version", (index) =>
        index.eq("trialId", args.trialId),
      )
      .order("desc")
      .collect();
    const selectedSnapshot = snapshots.find(
      (snapshot) =>
        snapshot.stateSchemaVersion === projection.stateSchemaVersion &&
        snapshot.lastSequence > afterSequence &&
        snapshot.lastSequence <= projection.lastSequence,
    );
    const baseSequence = selectedSnapshot?.lastSequence ?? afterSequence;
    const rows = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index.eq("trialId", args.trialId).gt("sequence", baseSequence),
      )
      .order("asc")
      .take(limit + 1);
    const page = rows.slice(0, limit);
    let expectedSequence = baseSequence + 1;
    for (const row of page) {
      if (row.sequence !== expectedSequence) {
        throw new Error("TRIAL_EVENT_SEQUENCE_GAP");
      }
      expectedSequence += 1;
    }
    const hasMore = rows.length > limit;
    const lastReturnedSequence = page.at(-1)?.sequence ?? baseSequence;

    return {
      trialId: projection.trialId,
      graphId: projection.graphId ?? null,
      caseId: projection.caseId ?? null,
      caseVersion: projection.caseVersion ?? null,
      stateVersion: projection.stateVersion,
      lastSequence: projection.lastSequence,
      stateJson: projection.stateJson,
      stateSchemaVersion: projection.stateSchemaVersion,
      eventSchemaVersion: projection.eventSchemaVersion,
      validated,
      requiresMigration,
      snapshot: selectedSnapshot
        ? {
            snapshotId: selectedSnapshot.snapshotId,
            stateVersion: selectedSnapshot.stateVersion,
            lastSequence: selectedSnapshot.lastSequence,
            stateJson: selectedSnapshot.stateJson,
            stateSchemaVersion: selectedSnapshot.stateSchemaVersion,
            source: selectedSnapshot.source,
            createdAt: selectedSnapshot.createdAt,
          }
        : null,
      events: page.map(publicEvent),
      hasMore,
      nextAfterSequence: hasMore ? lastReturnedSequence : null,
    };
}

/** Trusted server read for an owner session verified outside Convex auth. */
export const reloadForOwnerSession = internalQuery({
  args: { ownerId: v.string(), ...reloadArgs },
  handler: async (ctx, args) => {
    const { ownerId, ...reloadInput } = args;
    return await reloadForOwner(ctx, reloadInput, ownerId);
  },
});
