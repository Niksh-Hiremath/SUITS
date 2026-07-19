import { v } from "convex/values";

import {
  CaseGraphV1Schema,
  sha256Utf8,
  type CaseGraphV1,
} from "../src/domain/case-graph";
import {
  CourtroomModelCallTraceSchema,
  DebriefGeneratorModelOutputSchema,
  JuryRoleResponseModelOutputSchema,
  type CounselRoleResponseModelOutput,
  type CourtroomModelCallTrace,
  type OpponentPlannerModelOutput,
  type WitnessAnswerModelOutput,
} from "../src/domain/courtroom-ai";
import {
  HearingCounselResponsePrecommitSchema,
  HearingDebriefGeneratorPrecommitSchema,
  HearingJuryResponsePrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
  HearingWitnessGenerationPrecommitSchema,
  counselResponseOutputCitations,
  hashDebriefGeneratorModelOutput,
  hashJuryResponseModelOutput,
  hashOpponentPlannerModelOutput,
  juryResponseOutputCitations,
  witnessAnswerOutputCitations,
  type HearingCounselResponsePrecommit,
  type HearingDebriefGeneratorPrecommit,
  type HearingJuryResponsePrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingWitnessGenerationPrecommit,
} from "../src/domain/hearing-runtime/model-boundary";
import {
  HearingObjectionRulingPrecommitSchema,
  type HearingObjectionRulingPrecommit,
} from "../src/domain/hearing-runtime/objection-boundary";
import {
  HearingNegotiationPrecommitSchema,
  type HearingNegotiationPrecommit,
} from "../src/domain/hearing-runtime/settlement-boundary";
import {
  parsePersistedOpponentDirective,
  type PersistedOpponentDirective,
} from "../src/domain/hearing-runtime/opponent-directive";
import { findOutstandingRephraseTarget } from "../src/domain/hearing-runtime/outstanding-rephrase";
import {
  deriveFinalBoundInterruptionPersistenceIds,
  HearingFinalBoundInterruptionLeaseCredentialSchema,
  type HearingFinalBoundInterruptionMetadata,
  type HearingFinalBoundInterruptionOutcome,
  type HearingFinalBoundInterruptionRecoveryMetadata,
} from "../src/domain/objections/final-bound-persistence";
import {
  FinalBoundInterruptionRequestSchema,
  type FinalBoundInterruptionRequest,
} from "../src/domain/objections/final-bound-contracts";
import {
  PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION,
  detectPartialObjectionCandidate,
  type PartialObjectionCandidate,
  type PartialObjectionDetectorInput,
} from "../src/domain/objections/partial-detector";
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
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { persistTerminalCourtroomModelCallForOwner } from "./courtroomModelCalls";
import { requireFinalBoundInterruptionLeaseForAppend } from "./finalBoundInterruptionClaims";

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

async function requireFinalBoundClaimForAppend(
  ctx: MutationCtx,
  input: Readonly<{
    ownerId: string;
    trialId: string;
    credentialJson?: string;
    now?: number;
    required: boolean;
    expectedPhase: "ruling_pending" | "witness_pending";
    expectedDecisionId?: string;
  }>,
): Promise<void> {
  if (input.credentialJson === undefined && input.now === undefined) {
    if (input.required) {
      throw new Error("FINAL_BOUND_INTERRUPTION_CLAIM_REQUIRED");
    }
    return;
  }
  if (
    input.credentialJson === undefined ||
    input.now === undefined ||
    !Number.isSafeInteger(input.now) ||
    input.now < 0
  ) {
    throw new Error("FINAL_BOUND_INTERRUPTION_CLAIM_INVALID");
  }
  const credential =
    HearingFinalBoundInterruptionLeaseCredentialSchema.safeParse(
      parseJsonObject(input.credentialJson, "claimCredentialJson"),
    );
  if (
    !credential.success ||
    (input.expectedDecisionId !== undefined &&
      credential.data.decisionId !== input.expectedDecisionId)
  ) {
    throw new Error("FINAL_BOUND_INTERRUPTION_CLAIM_INVALID");
  }
  await requireFinalBoundInterruptionLeaseForAppend(
    ctx,
    {
      ownerId: input.ownerId,
      trialId: input.trialId,
      interruptId: credential.data.interruptId,
      decisionId: credential.data.decisionId,
      leaseGeneration: credential.data.leaseGeneration,
      leaseTokenHash: sha256Utf8(credential.data.leaseToken),
      now: input.now,
    },
    input.expectedPhase,
  );
}

async function canonicalTargetRequiresFinalBoundClaim(
  ctx: MutationCtx,
  state: TrialStateV3,
  target: Readonly<{ interruptId: string; responseId: string }>,
): Promise<boolean> {
  const active = state.activeInterruption;
  if (
    active === null ||
    active.interruptId !== target.interruptId ||
    active.interruptedResponseId !== target.responseId
  ) {
    throw new Error("FINAL_BOUND_INTERRUPTION_CONFLICT");
  }
  const prefix = "interrupt:final-bound:";
  if (!active.interruptId.startsWith(prefix)) return false;
  const digest = active.interruptId.slice(prefix.length);
  const objectionId = `objection:final-bound:${digest}`;
  const questionId = `question:final-bound:${digest}`;
  const responseId = `response:final-bound:${digest}`;
  const actionId = `action:final-bound-interruption:${digest}`;
  const eventId = eventIdForGeneratedAction(actionId);
  const objection = state.objections[objectionId];
  const response = state.pendingResponses[responseId];
  const question = state.questions[questionId];
  const sourceRow = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) => index.eq("eventId", eventId))
    .unique();
  if (
    digest.length !== 64 ||
    active.objectionId !== objectionId ||
    target.responseId !== responseId ||
    active.sourceEventId !== eventId ||
    objection === undefined ||
    objection.questionId !== questionId ||
    objection.interruptedResponseId !== responseId ||
    response === undefined ||
    response.questionId !== questionId ||
    response.interruptId !== active.interruptId ||
    question === undefined ||
    question.questionTurnId !== `turn:final-bound-question:${digest}` ||
    sourceRow === null
  ) {
    throw new Error("FINAL_BOUND_INTERRUPTION_CONFLICT");
  }
  const source = storedEventToV3(sourceRow);
  if (
    source.actionId !== actionId ||
    source.eventId !== eventId ||
    source.eventId !== active.sourceEventId ||
    source.type !== "BEGIN_INTERRUPTION" ||
    source.source !== "system" ||
    source.interruptId !== active.interruptId ||
    source.payload.interruptId !== active.interruptId ||
    source.payload.interruptedResponseId !== responseId ||
    source.payload.objectionId !== objectionId
  ) {
    throw new Error("FINAL_BOUND_INTERRUPTION_CONFLICT");
  }
  return true;
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
    !sameIdentifierSet(event.factIds, input.trace.acceptedCitations.factIds) ||
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

function invalidJuryGeneration(): never {
  throw new Error("JURY_GENERATION_INVALID");
}

function staleJuryGeneration(): never {
  throw new Error("JURY_GENERATION_STALE");
}

function invalidDebriefGeneration(): never {
  throw new Error("DEBRIEF_GENERATION_INVALID");
}

function staleDebriefGeneration(): never {
  throw new Error("DEBRIEF_GENERATION_STALE");
}

function invalidObjectionRuling(): never {
  throw new Error("OBJECTION_RULING_GENERATION_INVALID");
}

function staleObjectionRuling(): never {
  throw new Error("OBJECTION_RULING_GENERATION_STALE");
}

function invalidNegotiationGeneration(): never {
  throw new Error("NEGOTIATION_GENERATION_INVALID");
}

function staleNegotiationGeneration(): never {
  throw new Error("NEGOTIATION_GENERATION_STALE");
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

function parseJuryGenerationJson(
  generationJson: string,
): HearingJuryResponsePrecommit {
  let input: unknown;
  try {
    input = parseJsonObject(generationJson, "generationJson");
  } catch {
    return invalidJuryGeneration();
  }
  const parsed = HearingJuryResponsePrecommitSchema.safeParse(input);
  return parsed.success ? parsed.data : invalidJuryGeneration();
}

function parseDebriefGenerationJson(
  generationJson: string,
): HearingDebriefGeneratorPrecommit {
  let input: unknown;
  try {
    input = parseJsonObject(generationJson, "generationJson");
  } catch {
    return invalidDebriefGeneration();
  }
  const parsed = HearingDebriefGeneratorPrecommitSchema.safeParse(input);
  return parsed.success ? parsed.data : invalidDebriefGeneration();
}

function parseObjectionRulingJson(
  generationJson: string,
): HearingObjectionRulingPrecommit {
  let input: unknown;
  try {
    input = parseJsonObject(generationJson, "generationJson");
  } catch {
    return invalidObjectionRuling();
  }
  const parsed = HearingObjectionRulingPrecommitSchema.safeParse(input);
  return parsed.success ? parsed.data : invalidObjectionRuling();
}

function parseNegotiationGenerationJson(
  generationJson: string,
): HearingNegotiationPrecommit {
  let input: unknown;
  try {
    input = parseJsonObject(generationJson, "generationJson");
  } catch {
    return invalidNegotiationGeneration();
  }
  const parsed = HearingNegotiationPrecommitSchema.safeParse(input);
  return parsed.success ? parsed.data : invalidNegotiationGeneration();
}

function finalRuntimeId(prefix: string, material: unknown): string {
  return `${prefix}:${sha256Utf8(canonicalJson(material))}`;
}

function juryGenerationIds(generation: HearingJuryResponsePrecommit) {
  const material = {
    trialId: generation.trialId,
    decisionId: generation.decisionId,
  };
  return {
    actionId: finalRuntimeId("action:jury-deliberation", material),
    verdictPhaseActionId: finalRuntimeId("action:phase-verdict", material),
    verdictActionId: finalRuntimeId("action:render-verdict", material),
    debriefPhaseActionId: finalRuntimeId("action:phase-debrief", material),
    verdictId: finalRuntimeId("verdict:jury", material),
    artifactId: finalRuntimeId("artifact:jury", material),
  };
}

function debriefGenerationIds(generation: HearingDebriefGeneratorPrecommit) {
  const material = {
    trialId: generation.trialId,
    sourceStateVersion: generation.expectedStateVersion,
    sourceLastEventId: generation.expectedLastEventId,
  };
  const debriefId = finalRuntimeId("debrief:final", material);
  return {
    actionId: finalRuntimeId("action:debrief-generation", material),
    completePhaseActionId: finalRuntimeId("action:phase-complete", {
      trialId: generation.trialId,
      debriefId,
    }),
    debriefId,
  };
}

function objectionRulingIds(generation: HearingObjectionRulingPrecommit) {
  const material = {
    trialId: generation.trialId,
    decisionId: generation.decisionId,
  };
  return {
    rulingActionId: finalRuntimeId("action:objection-ruling", material),
    resolveActionId: finalRuntimeId("action:resolve-objection", material),
    resumeActionId: finalRuntimeId("action:resume-objection-response", material),
  };
}

function negotiationActionId(generation: HearingNegotiationPrecommit): string {
  return finalRuntimeId("action:negotiation-decision", {
    trialId: generation.trialId,
    decisionId: generation.decisionId,
  });
}

function negotiationCounterOfferId(
  generation: HearingNegotiationPrecommit,
  targetOfferId: string,
): string {
  return finalRuntimeId("offer:negotiation-counter", {
    trialId: generation.trialId,
    decisionId: generation.decisionId,
    targetOfferId,
  });
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

  const appearance = directive.appearance;
  if (appearance === null) {
    if (directive.selectedMoveIndex === null) return invalidOpponentPlan();
    const selectedMove = output.proposedMoves[directive.selectedMoveIndex];
    if (
      selectedMove?.kind !== "give_closing" ||
      directive.directive.kind !== "give_closing" ||
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
    return;
  }

  if (directive.selectedMoveIndex === null) {
    if (
      directive.directive.kind !== "end_examination" ||
      output.proposedMoves.some(
        (move) =>
          (move.kind === "question_witness" &&
            move.witnessId === appearance.witnessId) ||
          (move.kind === "move_to_strike" && move.testimonyIds.length > 0),
      ) ||
      directive.directive.disposition !==
        (appearance.answeredQuestionCount === 0
          ? "waived"
          : "completed")
    ) {
      return invalidOpponentPlan();
    }
    return;
  }

  const selectedMove = output.proposedMoves[directive.selectedMoveIndex];
  if (selectedMove?.kind === "move_to_strike") {
    if (
      directive.directive.kind !== "move_to_strike" ||
      directive.directive.basis !== selectedMove.rationale ||
      directive.directive.permittedFactIds.length !== 0 ||
      directive.directive.permittedEvidenceIds.length !== 0 ||
      !sameOrderedIdentifiers(
        directive.directive.testimonyIds,
        selectedMove.testimonyIds,
      ) ||
      !sameOrderedIdentifiers(
        directive.directive.permittedTestimonyIds,
        selectedMove.testimonyIds,
      )
    ) {
      return invalidOpponentPlan();
    }
    return;
  }
  if (
    selectedMove?.kind !== "question_witness" ||
    directive.directive.kind !== "question_witness" ||
    selectedMove.witnessId !== appearance.witnessId ||
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
  if (
    state.version !== action.expectedStateVersion ||
    state.eventIds.at(-1) !== action.causationId ||
    !sameCanonicalJson(state.actors[action.actor.actorId], action.actor)
  ) {
    return staleOpponentPlan();
  }
  const binding = directive.appearance;
  if (binding === null) {
    if (
      state.phase !== "closing" ||
      state.activeAppearanceId !== null ||
      state.activeWitnessId !== null ||
      state.closingSides.includes("opposing")
    ) {
      return staleOpponentPlan();
    }
    return;
  }
  const appearance = state.activeAppearanceId
    ? state.appearances[state.activeAppearanceId]
    : undefined;
  const leg = appearance?.legs[binding.examinationKind];
  if (
    state.activeAppearanceId !== binding.appearanceId ||
    state.activeWitnessId !== binding.witnessId ||
    appearance?.witnessId !== binding.witnessId ||
    appearance?.stage !== binding.examinationKind ||
    leg?.answeredQuestionCount !== binding.answeredQuestionCount
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
  if (directive.directive.kind === "end_examination") {
    return output.speechSegments.every(
      (segment) =>
        segment.citations.factIds.length === 0 &&
        segment.citations.evidenceIds.length === 0 &&
        segment.citations.testimonyIds.length === 0,
    );
  }
  const allowedFacts = new Set(directive.directive.permittedFactIds);
  const allowedEvidence = new Set(directive.directive.permittedEvidenceIds);
  const allowedTestimony = new Set(directive.directive.permittedTestimonyIds);
  return output.speechSegments.every(
    (segment) =>
      segment.citations.factIds.every((id) => allowedFacts.has(id)) &&
      segment.citations.evidenceIds.every((id) => allowedEvidence.has(id)) &&
      segment.citations.testimonyIds.every((id) => allowedTestimony.has(id)) &&
      segment.citations.factIds.length +
        segment.citations.evidenceIds.length +
        segment.citations.testimonyIds.length >
        0,
  );
}

type GeneratedCounselAction = Extract<
  TrialActionV3,
  {
    type:
      | "ASK_QUESTION"
      | "MOVE_TO_STRIKE"
      | "END_EXAMINATION"
      | "GIVE_CLOSING";
  }
>;

function requireGeneratedCounselAction(
  action: TrialActionV3,
  generation: HearingCounselResponsePrecommit,
  directive: PersistedOpponentDirective,
): GeneratedCounselAction {
  if (
    (action.type !== "ASK_QUESTION" &&
      action.type !== "MOVE_TO_STRIKE" &&
      action.type !== "END_EXAMINATION" &&
      action.type !== "GIVE_CLOSING") ||
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
    const appearance = directive.appearance;
    if (
      appearance === null ||
      action.type !== "ASK_QUESTION" ||
      output.proposedAction.kind !== "ask_question" ||
      !text.includes("?") ||
      action.payload.witnessId !== appearance.witnessId ||
      action.payload.examinationKind !== appearance.examinationKind ||
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

  if (directive.directive.kind === "move_to_strike") {
    const speech =
      action.type === "MOVE_TO_STRIKE" ? action.payload.speech : undefined;
    if (
      directive.appearance === null ||
      action.type !== "MOVE_TO_STRIKE" ||
      output.proposedAction.kind !== "move_to_strike" ||
      !sameOrderedIdentifiers(
        output.proposedAction.testimonyIds,
        directive.directive.testimonyIds,
      ) ||
      !sameOrderedIdentifiers(
        action.payload.testimonyIds,
        directive.directive.testimonyIds,
      ) ||
      action.payload.reason !== output.proposedAction.reason ||
      speech === undefined ||
      speech.text !== text ||
      !sameIdentifierSet(speech.citations.factIds, citations.factIds) ||
      !sameIdentifierSet(speech.citations.evidenceIds, citations.evidenceIds) ||
      !sameIdentifierSet(
        speech.citations.testimonyIds,
        citations.testimonyIds,
      ) ||
      !sameIdentifierSet(speech.citations.eventIds, citations.eventIds) ||
      !sameIdentifierSet(
        speech.citations.sourceSegmentIds,
        citations.sourceSegmentIds,
      )
    ) {
      return invalidCounselResponse();
    }
    return action;
  }

  if (directive.directive.kind === "give_closing") {
    if (
      directive.appearance !== null ||
      action.type !== "GIVE_CLOSING" ||
      output.proposedAction.kind !== "give_closing" ||
      action.payload.side !== "opposing" ||
      action.payload.text !== text ||
      !sameIdentifierSet(action.payload.citations.factIds, citations.factIds) ||
      !sameIdentifierSet(
        action.payload.citations.evidenceIds,
        citations.evidenceIds,
      ) ||
      !sameIdentifierSet(
        action.payload.citations.testimonyIds,
        citations.testimonyIds,
      ) ||
      !sameIdentifierSet(action.payload.citations.eventIds, citations.eventIds) ||
      !sameIdentifierSet(
        action.payload.citations.sourceSegmentIds,
        citations.sourceSegmentIds,
      )
    ) {
      return invalidCounselResponse();
    }
    return action;
  }

  const appearance = directive.appearance;
  if (
    appearance === null ||
    action.type !== "END_EXAMINATION" ||
    output.proposedAction.kind !== "end_examination" ||
    output.proposedAction.disposition !== directive.directive.disposition ||
    action.payload.witnessId !== appearance.witnessId ||
    action.payload.examinationKind !== appearance.examinationKind ||
    action.payload.disposition !== directive.directive.disposition ||
    action.payload.turnId === undefined ||
    action.payload.text !== text ||
    action.payload.citations === undefined ||
    !sameIdentifierSet(action.payload.citations.factIds, citations.factIds) ||
    !sameIdentifierSet(
      action.payload.citations.evidenceIds,
      citations.evidenceIds,
    ) ||
    !sameIdentifierSet(
      action.payload.citations.testimonyIds,
      citations.testimonyIds,
    ) ||
    !sameIdentifierSet(action.payload.citations.eventIds, citations.eventIds) ||
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
      continuation.expectedStateVersion !== primary.expectedStateVersion + 1 ||
      continuation.causationId !==
        eventIdForGeneratedAction(primary.actionId) ||
      continuation.correlationId !== primary.trialId
    ) {
      return invalidCounselResponse();
    }
    return continuation;
  }

  if (primary.type === "GIVE_CLOSING" || primary.type === "MOVE_TO_STRIKE") {
    if (continuation !== null) return invalidCounselResponse();
    return null;
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

function terminalTimeWithOffset(value: string | null, offset: number): string {
  if (value === null) return invalidJuryGeneration();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    return invalidJuryGeneration();
  }
  return new Date(timestamp + offset).toISOString();
}

function sameActionActor(left: TrialActionV3, right: TrialActionV3): boolean {
  return sameCanonicalJson(left.actor, right.actor);
}

async function requireObjectionRulingActions(
  ctx: MutationCtx,
  actions: readonly TrialActionV3[],
  generation: HearingObjectionRulingPrecommit,
): Promise<readonly TrialActionV3[]> {
  const overruled =
    generation.output.ruling === "overruled" &&
    generation.output.remedy === "resume_response";
  const sustained =
    generation.output.ruling === "sustained" &&
    (generation.output.remedy === "cancel_response" ||
      generation.output.remedy === "rephrase");
  if ((!overruled && !sustained) || actions.length !== (overruled ? 3 : 2)) {
    return invalidObjectionRuling();
  }
  const [ruling, resolve, resume] = actions;
  if (!ruling || !resolve || (overruled && !resume)) {
    return invalidObjectionRuling();
  }
  const [questionRow, objectionRow, interruptionRow] = await Promise.all([
    ctx.db
      .query("trialEvents")
      .withIndex("by_event_id", (index) =>
        index.eq("eventId", generation.questionEventBinding.sourceEventId),
      )
      .unique(),
    ctx.db
      .query("trialEvents")
      .withIndex("by_event_id", (index) =>
        index.eq("eventId", generation.objectionEventId),
      )
      .unique(),
    ctx.db
      .query("trialEvents")
      .withIndex("by_event_id", (index) =>
        index.eq("eventId", generation.expectedLastEventId),
      )
      .unique(),
  ]);
  if (!questionRow || !objectionRow || !interruptionRow) {
    return staleObjectionRuling();
  }
  const questionEvent = storedEventToV3(questionRow);
  const objectionEvent = storedEventToV3(objectionRow);
  const interruptionEvent = storedEventToV3(interruptionRow);
  if (
    questionEvent.trialId !== generation.trialId ||
    questionEvent.type !== "ASK_QUESTION" ||
    questionEvent.payload.turnId !== generation.questionEventBinding.turnId ||
    objectionEvent.trialId !== generation.trialId ||
    objectionEvent.type !== "OBJECT" ||
    objectionEvent.payload.questionId !== questionEvent.payload.questionId ||
    objectionEvent.payload.interruptedResponseId !== generation.responseId ||
    interruptionEvent.trialId !== generation.trialId ||
    interruptionEvent.type !== "BEGIN_INTERRUPTION" ||
    interruptionEvent.stateVersion !== generation.expectedStateVersion ||
    interruptionEvent.payload.objectionId !== objectionEvent.payload.objectionId ||
    interruptionEvent.payload.interruptedResponseId !== generation.responseId
  ) {
    return staleObjectionRuling();
  }
  const ids = objectionRulingIds(generation);
  const completedAt = generation.trace.completedAt;
  if (completedAt === null) return invalidObjectionRuling();
  const at = (offset: number) => {
    const timestamp = Date.parse(completedAt);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      return invalidObjectionRuling();
    }
    return new Date(timestamp + offset).toISOString();
  };
  if (
    ruling.type !== "RULE_ON_OBJECTION" ||
    ruling.actionId !== ids.rulingActionId ||
    ruling.trialId !== generation.trialId ||
    ruling.expectedStateVersion !== generation.expectedStateVersion ||
    ruling.actor.role !== "judge" ||
    ruling.actor.side !== "neutral" ||
    ruling.actor.witnessId !== null ||
    ruling.actor.actorId !== generation.trace.actorId ||
    ruling.source !== "ai" ||
    ruling.requestedAt !== at(0) ||
    ruling.causationId !== generation.expectedLastEventId ||
    ruling.correlationId !== generation.trialId ||
    ruling.responseId !== generation.responseId ||
    ruling.interruptId !== interruptionEvent.payload.interruptId ||
    !sameCanonicalJson(ruling.modelMetadata, generation.modelMetadata) ||
    ruling.payload.objectionId !== objectionEvent.payload.objectionId ||
    ruling.payload.ruling !== generation.output.ruling ||
    ruling.payload.remedy !== generation.output.remedy ||
    ruling.payload.reason !== generation.output.reason
  ) {
    return invalidObjectionRuling();
  }
  if (
    resolve.type !== "RESOLVE_INTERRUPTION" ||
    resolve.actionId !== ids.resolveActionId ||
    resolve.trialId !== generation.trialId ||
    resolve.expectedStateVersion !== generation.expectedStateVersion + 1 ||
    resolve.actor.role !== "system" ||
    resolve.actor.side !== "neutral" ||
    resolve.actor.witnessId !== null ||
    resolve.source !== "deterministic" ||
    resolve.requestedAt !== at(1) ||
    resolve.causationId !== eventIdForGeneratedAction(ruling.actionId) ||
    resolve.correlationId !== generation.trialId ||
    resolve.responseId !== generation.responseId ||
    resolve.interruptId !== interruptionEvent.payload.interruptId ||
    resolve.modelMetadata !== null ||
    resolve.payload.interruptId !== interruptionEvent.payload.interruptId ||
    resolve.payload.outcome !== (overruled ? "resume" : "cancel")
  ) {
    return invalidObjectionRuling();
  }
  if (overruled) {
    if (
      !resume ||
      resume.type !== "RESUME_INTERRUPTED_SPEECH" ||
      resume.actionId !== ids.resumeActionId ||
      resume.trialId !== generation.trialId ||
      resume.expectedStateVersion !== generation.expectedStateVersion + 2 ||
      !sameActionActor(resume, resolve) ||
      resume.source !== "deterministic" ||
      resume.requestedAt !== at(2) ||
      resume.causationId !== eventIdForGeneratedAction(resolve.actionId) ||
      resume.correlationId !== generation.trialId ||
      resume.responseId !== generation.responseId ||
      resume.interruptId !== interruptionEvent.payload.interruptId ||
      resume.modelMetadata !== null ||
      resume.payload.interruptId !== interruptionEvent.payload.interruptId ||
      resume.payload.interruptedResponseId !== generation.responseId
    ) {
      return invalidObjectionRuling();
    }
  }
  return actions;
}

function requireNegotiationAction(
  action: TrialActionV3,
  generation: HearingNegotiationPrecommit,
): TrialActionV3 {
  const targetOfferIds = generation.output.citations.settlementOfferIds;
  if (targetOfferIds.length !== 1) return invalidNegotiationGeneration();
  const targetOfferId = targetOfferIds[0];
  if (!targetOfferId) return invalidNegotiationGeneration();
  const recommendation = generation.output.recommendation;
  const expectedType =
    recommendation === "counter"
      ? "COUNTER_SETTLEMENT"
      : recommendation === "accept"
        ? "ACCEPT_SETTLEMENT"
        : recommendation === "reject"
          ? "REJECT_SETTLEMENT"
          : null;
  if (expectedType === null || action.type !== expectedType) {
    return invalidNegotiationGeneration();
  }
  if (
    generation.trace.completedAt === null ||
    action.actionId !== negotiationActionId(generation) ||
    action.trialId !== generation.trialId ||
    action.expectedStateVersion !== generation.expectedStateVersion ||
    action.actor.role !== "opposing_counsel" ||
    action.actor.side !== "opposing" ||
    action.actor.witnessId !== null ||
    action.actor.actorId !== generation.trace.actorId ||
    action.source !== "ai" ||
    action.requestedAt !== generation.trace.completedAt ||
    action.causationId !== generation.expectedLastEventId ||
    action.correlationId !== generation.trialId ||
    action.responseId !== null ||
    action.interruptId !== null ||
    !sameCanonicalJson(action.modelMetadata, generation.modelMetadata)
  ) {
    return staleNegotiationGeneration();
  }
  if (action.type === "COUNTER_SETTLEMENT") {
    const terms = generation.output.terms;
    if (
      recommendation !== "counter" ||
      terms === null ||
      action.payload.offerId !==
        negotiationCounterOfferId(generation, targetOfferId) ||
      action.payload.parentOfferId !== targetOfferId ||
      action.payload.recipientPartyIds.length !== 1 ||
      action.payload.recipientPartyIds[0] === action.payload.proposedByPartyId ||
      action.payload.terms.amount !== terms.amount ||
      action.payload.terms.currency !== terms.currency ||
      !sameOrderedStrings(
        action.payload.terms.nonMonetaryTerms,
        terms.nonMonetaryTerms,
      ) ||
      action.payload.terms.summary !== terms.summary
    ) {
      return invalidNegotiationGeneration();
    }
  } else if (action.payload.offerId !== targetOfferId) {
    return invalidNegotiationGeneration();
  }
  return action;
}

function requireJuryGenerationActions(
  actions: readonly TrialActionV3[],
  generation: HearingJuryResponsePrecommit,
): readonly [TrialActionV3, TrialActionV3, TrialActionV3, TrialActionV3] {
  if (actions.length !== 4) return invalidJuryGeneration();
  const [deliberation, verdictPhase, verdict, debriefPhase] = actions;
  if (!deliberation || !verdictPhase || !verdict || !debriefPhase) {
    return invalidJuryGeneration();
  }
  const ids = juryGenerationIds(generation);
  const citations = juryResponseOutputCitations(generation.output);
  const baseTime = generation.trace.completedAt;
  if (
    deliberation.type !== "DELIBERATE" ||
    deliberation.actionId !== ids.actionId ||
    deliberation.trialId !== generation.trialId ||
    deliberation.expectedStateVersion !== generation.expectedStateVersion ||
    deliberation.causationId !== generation.expectedLastEventId ||
    deliberation.correlationId !== generation.trialId ||
    deliberation.source !== "ai" ||
    deliberation.actor.role !== "jury" ||
    deliberation.actor.side !== "neutral" ||
    deliberation.actor.witnessId !== null ||
    deliberation.actor.actorId !== generation.trace.actorId ||
    deliberation.responseId !== null ||
    deliberation.interruptId !== null ||
    !sameCanonicalJson(deliberation.modelMetadata, generation.modelMetadata) ||
    deliberation.requestedAt !== terminalTimeWithOffset(baseTime, 0) ||
    !sameCanonicalJson(deliberation.payload, {})
  ) {
    return staleJuryGeneration();
  }
  if (
    verdictPhase.type !== "BEGIN_PHASE" ||
    verdictPhase.actionId !== ids.verdictPhaseActionId ||
    verdictPhase.trialId !== generation.trialId ||
    verdictPhase.expectedStateVersion !== generation.expectedStateVersion + 1 ||
    verdictPhase.causationId !== eventIdForGeneratedAction(deliberation.actionId) ||
    verdictPhase.correlationId !== generation.trialId ||
    verdictPhase.source !== "deterministic" ||
    verdictPhase.actor.role !== "judge" ||
    verdictPhase.actor.side !== "neutral" ||
    verdictPhase.actor.witnessId !== null ||
    verdictPhase.responseId !== null ||
    verdictPhase.interruptId !== null ||
    verdictPhase.modelMetadata !== null ||
    verdictPhase.requestedAt !== terminalTimeWithOffset(baseTime, 1) ||
    verdictPhase.payload.phase !== "verdict"
  ) {
    return invalidJuryGeneration();
  }
  if (
    verdict.type !== "RENDER_VERDICT" ||
    verdict.actionId !== ids.verdictActionId ||
    verdict.trialId !== generation.trialId ||
    verdict.expectedStateVersion !== generation.expectedStateVersion + 2 ||
    verdict.causationId !== eventIdForGeneratedAction(verdictPhase.actionId) ||
    verdict.correlationId !== generation.trialId ||
    verdict.source !== "deterministic" ||
    !sameActionActor(verdict, verdictPhase) ||
    verdict.responseId !== null ||
    verdict.interruptId !== null ||
    verdict.modelMetadata !== null ||
    verdict.requestedAt !== terminalTimeWithOffset(baseTime, 2) ||
    verdict.payload.verdictId !== ids.verdictId ||
    verdict.payload.decision !== generation.output.recommendation.decision ||
    !sameIdentifierSet(verdict.payload.citations.factIds, citations.factIds) ||
    !sameIdentifierSet(
      verdict.payload.citations.evidenceIds,
      citations.evidenceIds,
    ) ||
    !sameIdentifierSet(
      verdict.payload.citations.testimonyIds,
      citations.testimonyIds,
    ) ||
    verdict.payload.citations.eventIds.length !== 0 ||
    verdict.payload.citations.sourceSegmentIds.length !== 0
  ) {
    return invalidJuryGeneration();
  }
  if (
    debriefPhase.type !== "BEGIN_PHASE" ||
    debriefPhase.actionId !== ids.debriefPhaseActionId ||
    debriefPhase.trialId !== generation.trialId ||
    debriefPhase.expectedStateVersion !== generation.expectedStateVersion + 3 ||
    debriefPhase.causationId !== eventIdForGeneratedAction(verdict.actionId) ||
    debriefPhase.correlationId !== generation.trialId ||
    debriefPhase.source !== "deterministic" ||
    !sameActionActor(debriefPhase, verdictPhase) ||
    debriefPhase.responseId !== null ||
    debriefPhase.interruptId !== null ||
    debriefPhase.modelMetadata !== null ||
    debriefPhase.requestedAt !== terminalTimeWithOffset(baseTime, 3) ||
    debriefPhase.payload.phase !== "debrief"
  ) {
    return invalidJuryGeneration();
  }
  return [deliberation, verdictPhase, verdict, debriefPhase];
}

function requireDebriefGenerationActions(
  actions: readonly TrialActionV3[],
  generation: HearingDebriefGeneratorPrecommit,
): readonly [TrialActionV3, TrialActionV3] {
  if (actions.length !== 2) return invalidDebriefGeneration();
  const [debrief, completePhase] = actions;
  if (!debrief || !completePhase) return invalidDebriefGeneration();
  const ids = debriefGenerationIds(generation);
  const completedAt = generation.trace.completedAt;
  if (completedAt === null) return invalidDebriefGeneration();
  const completedTimestamp = Date.parse(completedAt);
  if (!Number.isFinite(completedTimestamp) || completedTimestamp < 0) {
    return invalidDebriefGeneration();
  }
  const at = (offset: number) =>
    new Date(completedTimestamp + offset).toISOString();
  if (
    debrief.type !== "GENERATE_DEBRIEF" ||
    debrief.actionId !== ids.actionId ||
    debrief.trialId !== generation.trialId ||
    debrief.expectedStateVersion !== generation.expectedStateVersion ||
    debrief.causationId !== generation.expectedLastEventId ||
    debrief.correlationId !== generation.trialId ||
    debrief.source !== "ai" ||
    debrief.actor.role !== "debrief_coach" ||
    debrief.actor.side !== "neutral" ||
    debrief.actor.witnessId !== null ||
    debrief.actor.actorId !== generation.trace.actorId ||
    debrief.responseId !== null ||
    debrief.interruptId !== null ||
    !sameCanonicalJson(debrief.modelMetadata, generation.modelMetadata) ||
    debrief.requestedAt !== at(0) ||
    debrief.payload.debriefId !== ids.debriefId
  ) {
    return staleDebriefGeneration();
  }
  if (
    completePhase.type !== "BEGIN_PHASE" ||
    completePhase.actionId !== ids.completePhaseActionId ||
    completePhase.trialId !== generation.trialId ||
    completePhase.expectedStateVersion !== generation.expectedStateVersion + 1 ||
    completePhase.causationId !== eventIdForGeneratedAction(debrief.actionId) ||
    completePhase.correlationId !== generation.trialId ||
    completePhase.source !== "deterministic" ||
    completePhase.actor.role !== "judge" ||
    completePhase.actor.side !== "neutral" ||
    completePhase.actor.witnessId !== null ||
    completePhase.responseId !== null ||
    completePhase.interruptId !== null ||
    completePhase.modelMetadata !== null ||
    completePhase.requestedAt !== at(1) ||
    completePhase.payload.phase !== "complete"
  ) {
    return invalidDebriefGeneration();
  }
  return [debrief, completePhase];
}

type GeneratedArtifactRecord = Readonly<{
  artifactId: string;
  artifactKind: "jury_deliberation" | "final_debrief";
  ownerId: string;
  trialId: string;
  callId: string;
  decisionId: string | null;
  actionId: string;
  eventId: string;
  sourceStateVersion: number;
  sourceLastEventId: string;
  committedStateVersion: number;
  artifactJson: string;
  artifactHash: string;
  artifactSchemaVersion: string;
  promptVersion: string;
  model: HearingJuryResponsePrecommit["modelMetadata"]["model"];
  createdAt: number;
}>;

function comparableArtifact(row: Doc<"courtroomGeneratedArtifacts">) {
  return {
    artifactId: row.artifactId,
    artifactKind: row.artifactKind,
    ownerId: row.ownerId,
    trialId: row.trialId,
    callId: row.callId,
    decisionId: row.decisionId,
    actionId: row.actionId,
    eventId: row.eventId,
    sourceStateVersion: row.sourceStateVersion,
    sourceLastEventId: row.sourceLastEventId,
    committedStateVersion: row.committedStateVersion,
    artifactJson: row.artifactJson,
    artifactHash: row.artifactHash,
    artifactSchemaVersion: row.artifactSchemaVersion,
    promptVersion: row.promptVersion,
    model: row.model,
    createdAt: row.createdAt,
  };
}

async function persistGeneratedArtifact(
  ctx: MutationCtx,
  record: GeneratedArtifactRecord,
): Promise<void> {
  assertIdentifier(record.artifactId, "artifactId");
  if (
    record.artifactJson.length === 0 ||
    record.artifactJson.length > MAX_JSON_CHARACTERS
  ) {
    throw new Error("COURTROOM_GENERATED_ARTIFACT_INVALID");
  }
  const existing = await ctx.db
    .query("courtroomGeneratedArtifacts")
    .withIndex("by_artifact_id", (index) =>
      index.eq("artifactId", record.artifactId),
    )
    .unique();
  if (existing) {
    if (!sameCanonicalJson(comparableArtifact(existing), record)) {
      throw new Error("COURTROOM_GENERATED_ARTIFACT_CONFLICT");
    }
    return;
  }
  const callRows = await ctx.db
    .query("courtroomGeneratedArtifacts")
    .withIndex("by_call_id", (index) => index.eq("callId", record.callId))
    .collect();
  const eventRows = await ctx.db
    .query("courtroomGeneratedArtifacts")
    .withIndex("by_trial_event", (index) =>
      index.eq("trialId", record.trialId).eq("eventId", record.eventId),
    )
    .collect();
  if (callRows.length > 0 || eventRows.length > 0) {
    throw new Error("COURTROOM_GENERATED_ARTIFACT_CONFLICT");
  }
  await ctx.db.insert("courtroomGeneratedArtifacts", record);
}

async function persistJuryArtifact(
  ctx: MutationCtx,
  ownerId: string,
  generation: HearingJuryResponsePrecommit,
): Promise<void> {
  const output = JuryRoleResponseModelOutputSchema.parse(generation.output);
  const artifactJson = canonicalJson(output);
  const artifactHash = hashJuryResponseModelOutput(output);
  const ids = juryGenerationIds(generation);
  if (
    generation.trace.completedAt === null ||
    generation.trace.outputHash !== artifactHash
  ) {
    return invalidJuryGeneration();
  }
  await persistGeneratedArtifact(ctx, {
    artifactId: ids.artifactId,
    artifactKind: "jury_deliberation",
    ownerId,
    trialId: generation.trialId,
    callId: generation.callId,
    decisionId: generation.decisionId,
    actionId: ids.actionId,
    eventId: eventIdForGeneratedAction(ids.actionId),
    sourceStateVersion: generation.expectedStateVersion,
    sourceLastEventId: generation.expectedLastEventId,
    committedStateVersion: generation.expectedStateVersion + 1,
    artifactJson,
    artifactHash,
    artifactSchemaVersion: output.schemaVersion,
    promptVersion: generation.modelMetadata.promptVersion,
    model: generation.modelMetadata.model,
    createdAt: Date.parse(generation.trace.completedAt),
  });
}

async function persistDebriefArtifact(
  ctx: MutationCtx,
  ownerId: string,
  generation: HearingDebriefGeneratorPrecommit,
): Promise<void> {
  const output = DebriefGeneratorModelOutputSchema.parse(generation.output);
  const artifactJson = canonicalJson(output);
  const artifactHash = hashDebriefGeneratorModelOutput(output);
  const ids = debriefGenerationIds(generation);
  if (
    generation.trace.completedAt === null ||
    generation.trace.outputHash !== artifactHash
  ) {
    return invalidDebriefGeneration();
  }
  await persistGeneratedArtifact(ctx, {
    artifactId: ids.debriefId,
    artifactKind: "final_debrief",
    ownerId,
    trialId: generation.trialId,
    callId: generation.callId,
    decisionId: null,
    actionId: ids.actionId,
    eventId: eventIdForGeneratedAction(ids.actionId),
    sourceStateVersion: generation.expectedStateVersion,
    sourceLastEventId: generation.expectedLastEventId,
    committedStateVersion: generation.expectedStateVersion + 1,
    artifactJson,
    artifactHash,
    artifactSchemaVersion: output.schemaVersion,
    promptVersion: generation.modelMetadata.promptVersion,
    model: generation.modelMetadata.model,
    createdAt: Date.parse(generation.trace.completedAt),
  });
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
        index.eq("trialId", projection.trialId).gt("sequence", prefixSequence),
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
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
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
    testimonyIds: assertReferences(
      event.citations.testimonyIds,
      "testimonyIds",
    ),
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

function receiptResult(receipt: Doc<"actionReceipts">, replayed: boolean) {
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
        index.eq("trialId", action.trialId).eq("stateVersion", state.version),
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
    .withIndex("by_action_id", (index) => index.eq("actionId", action.actionId))
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
export const createTrial = internalMutation({
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
    .withIndex("by_action_id", (index) => index.eq("actionId", action.actionId))
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

type FinalBoundInterruptionCommitResult =
  | Readonly<{
      status: "candidate_withdrawn";
      sourceHead: FinalBoundInterruptionRequest["head"];
      triggerRevision: number;
      finalRevision: number;
    }>
  | Readonly<{
      status: "interruption";
      interrupt: HearingFinalBoundInterruptionMetadata;
      outcome: HearingFinalBoundInterruptionOutcome | null;
    }>;

type FinalBoundExaminationLeg = NonNullable<
  PartialObjectionDetectorInput["examinationLeg"]
>;

const FINAL_BOUND_EXAMINATION_LEGS = new Set<FinalBoundExaminationLeg>([
  "direct",
  "cross",
  "redirect",
  "recross",
]);

function isFinalBoundExaminationLeg(
  value: string,
): value is FinalBoundExaminationLeg {
  return FINAL_BOUND_EXAMINATION_LEGS.has(value as FinalBoundExaminationLeg);
}

function invalidFinalBoundInterruption(): never {
  throw new Error("FINAL_BOUND_INTERRUPTION_INVALID");
}

function staleFinalBoundInterruption(): never {
  throw new Error("FINAL_BOUND_INTERRUPTION_STALE");
}

function conflictingFinalBoundInterruption(): never {
  throw new Error("FINAL_BOUND_INTERRUPTION_CONFLICT");
}

function exactFinalBoundActor(
  state: TrialStateV3,
  input: Readonly<{
    role: ActorRef["role"];
    side: ActorRef["side"];
    witnessId?: string | null;
  }>,
): ActorRef {
  const matches = Object.values(state.actors).filter(
    (actor) =>
      actor.role === input.role &&
      actor.side === input.side &&
      (input.witnessId === undefined ||
        actor.witnessId === input.witnessId),
  );
  if (matches.length !== 1) return invalidFinalBoundInterruption();
  const actor = matches[0];
  return actor ?? invalidFinalBoundInterruption();
}

function finalBoundPlayerCounsel(state: TrialStateV3): ActorRef {
  return exactFinalBoundActor(state, {
    role:
      state.userSide === "user" ? "user_counsel" : "opposing_counsel",
    side: state.userSide,
    witnessId: null,
  });
}

function finalBoundObjector(state: TrialStateV3): ActorRef {
  const side = state.userSide === "user" ? "opposing" : "user";
  return exactFinalBoundActor(state, {
    role: side === "user" ? "user_counsel" : "opposing_counsel",
    side,
    witnessId: null,
  });
}

function finalBoundSystemActor(state: TrialStateV3): ActorRef {
  return exactFinalBoundActor(state, {
    role: "system",
    side: "neutral",
    witnessId: null,
  });
}

function finalBoundWitness(state: TrialStateV3, witnessId: string): ActorRef {
  const matches = Object.values(state.actors).filter(
    (actor) => actor.role === "witness" && actor.witnessId === witnessId,
  );
  if (matches.length !== 1) return invalidFinalBoundInterruption();
  const actor = matches[0];
  return actor ?? invalidFinalBoundInterruption();
}

function currentFinalBoundLastEventId(state: TrialStateV3): string {
  const eventId = state.eventIds.at(-1);
  return eventId ?? invalidFinalBoundInterruption();
}

function canonicalFinalBoundDetectorInput(
  input: Readonly<{
    state: TrialStateV3;
    partialText: string;
    confidence: number;
    appearanceId: string;
    examinationLeg: FinalBoundExaminationLeg;
    questioningActorId: string;
    excludeQuestionId?: string;
  }>,
): PartialObjectionDetectorInput {
  const transcriptOrder = new Map(
    input.state.transcriptTurnIds.map((turnId, index) => [turnId, index]),
  );
  const recentQuestionTexts = Object.values(input.state.questions)
    .filter(
      (question) =>
        question.questionId !== input.excludeQuestionId &&
        question.appearanceId === input.appearanceId &&
        question.examinationKind === input.examinationLeg &&
        question.askedByActorId === input.questioningActorId,
    )
    .map((question) => {
      const turn = input.state.transcriptTurns[question.questionTurnId];
      return turn === undefined
        ? null
        : {
            ordinal:
              transcriptOrder.get(question.questionTurnId) ??
              Number.MAX_SAFE_INTEGER,
            text: turn.text,
          };
    })
    .filter(
      (turn): turn is Readonly<{ ordinal: number; text: string }> =>
        turn !== null,
    )
    .sort((left, right) => left.ordinal - right.ordinal)
    .slice(-32)
    .map((turn) => turn.text);

  return {
    schemaVersion: PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION,
    partialText: input.partialText,
    sttConfidence: input.confidence,
    speechKind: "question",
    examinationLeg: input.examinationLeg,
    permittedGrounds: input.state.policySnapshot.permittedObjectionGrounds,
    recentQuestionTexts,
    // The final-bound speech contract carries no evidence identity. The
    // resulting canonical question therefore presents no exhibit, so an
    // explicit request to read exhibit contents has no established foundation.
    evidenceFoundationMissing: true,
    topicRelation: "unknown",
    privilegeContext: "unknown",
    thirdPartyStatementPurpose: "unknown",
    thirdPartyStatementException: "unknown",
    argumentativeContext: "unknown",
    personalKnowledgeContext: "unknown",
  };
}

function finalSupportsTrigger(
  trigger: PartialObjectionCandidate,
  final: PartialObjectionCandidate,
): boolean {
  if (trigger.ground !== final.ground || trigger.signal !== final.signal) {
    return false;
  }
  if (
    trigger.normalizedText.includes(final.normalizedText) ||
    final.normalizedText.includes(trigger.normalizedText)
  ) {
    return true;
  }
  const triggerTokens = new Set(trigger.normalizedText.split(" "));
  const finalTokens = new Set(final.normalizedText.split(" "));
  const smaller = Math.min(triggerTokens.size, finalTokens.size);
  if (smaller === 0) return false;
  const overlap = [...triggerTokens].filter((token) =>
    finalTokens.has(token),
  ).length;
  return overlap / smaller >= 0.8;
}

function evaluateFinalBoundCandidate(
  input: Readonly<{
    request: FinalBoundInterruptionRequest;
    state: TrialStateV3;
    appearanceId: string;
    examinationLeg: FinalBoundExaminationLeg;
    questioningActorId: string;
    excludeQuestionId?: string;
  }>,
): Readonly<{
  trigger: PartialObjectionCandidate;
  finalSupported: boolean;
}> {
  const shared = {
    state: input.state,
    confidence: input.request.trigger.confidence,
    appearanceId: input.appearanceId,
    examinationLeg: input.examinationLeg,
    questioningActorId: input.questioningActorId,
    excludeQuestionId: input.excludeQuestionId,
  } as const;
  const trigger = detectPartialObjectionCandidate(
    canonicalFinalBoundDetectorInput({
      ...shared,
      partialText: input.request.trigger.text,
    }),
  );
  const final = detectPartialObjectionCandidate(
    canonicalFinalBoundDetectorInput({
      ...shared,
      partialText: input.request.final.text,
    }),
  );
  if (trigger === null) {
    return invalidFinalBoundInterruption();
  }
  return {
    trigger,
    finalSupported:
      final !== null && finalSupportsTrigger(trigger, final),
  };
}

function finalBoundRequestedAt(value: string, offset: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    return invalidFinalBoundInterruption();
  }
  return new Date(timestamp + offset).toISOString();
}

function finalBoundAction(input: Readonly<{
  actionId: string;
  trialId: string;
  expectedStateVersion: number;
  actor: ActorRef;
  source: "speech" | "deterministic" | "system";
  requestedAt: string;
  causationId: string;
  responseId?: string;
  interruptId?: string;
  type: TrialActionV3["type"];
  payload: unknown;
}>): TrialActionV3 {
  return TrialActionV3Schema.parse({
    schemaVersion: TRIAL_ACTION_SCHEMA_VERSION_V3,
    actionId: input.actionId,
    trialId: input.trialId,
    expectedStateVersion: input.expectedStateVersion,
    actor: input.actor,
    source: input.source,
    requestedAt: input.requestedAt,
    causationId: input.causationId,
    correlationId: input.trialId,
    responseId: input.responseId ?? null,
    interruptId: input.interruptId ?? null,
    modelMetadata: null,
    type: input.type,
    payload: input.payload,
  });
}

async function finalBoundOutcome(
  ctx: Readonly<{ db: QueryCtx["db"] }>,
  state: TrialStateV3,
  metadata: Readonly<{
    objectionId: string;
    interruptId: string;
    responseId: string;
  }>,
): Promise<HearingFinalBoundInterruptionOutcome | null> {
  const objection = state.objections[metadata.objectionId];
  if (objection === undefined) return conflictingFinalBoundInterruption();
  if (objection.status === "pending") return null;
  if (
    (objection.status !== "sustained" &&
      objection.status !== "overruled") ||
    (objection.remedy !== "rephrase" &&
      objection.remedy !== "cancel_response" &&
      objection.remedy !== "resume_response")
  ) {
    return conflictingFinalBoundInterruption();
  }
  const validPair =
    objection.status === "overruled"
      ? objection.remedy === "resume_response"
      : objection.remedy === "rephrase" ||
        objection.remedy === "cancel_response";
  if (!validPair) return conflictingFinalBoundInterruption();
  if (objection.rulingEventId === null) {
    return conflictingFinalBoundInterruption();
  }
  const rulingRow = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) =>
      index.eq("eventId", objection.rulingEventId ?? ""),
    )
    .unique();
  if (rulingRow === null) return conflictingFinalBoundInterruption();
  const ruling = storedEventToV3(rulingRow);
  const resolutionRow = await ctx.db
    .query("trialEvents")
    .withIndex("by_trial_sequence", (index) =>
      index.eq("trialId", state.trialId).eq("sequence", ruling.sequence + 1),
    )
    .unique();
  if (resolutionRow === null) return conflictingFinalBoundInterruption();
  const resolution = storedEventToV3(resolutionRow);
  if (
    ruling.type !== "RULE_ON_OBJECTION" ||
    ruling.payload.objectionId !== metadata.objectionId ||
    ruling.payload.ruling !== objection.status ||
    ruling.payload.remedy !== objection.remedy ||
    ruling.responseId !== metadata.responseId ||
    ruling.interruptId !== metadata.interruptId ||
    resolution.type !== "RESOLVE_INTERRUPTION" ||
    resolution.causationId !== ruling.eventId ||
    resolution.payload.interruptId !== metadata.interruptId ||
    resolution.payload.outcome !==
      (objection.status === "overruled" ? "resume" : "cancel") ||
    resolution.responseId !== metadata.responseId ||
    resolution.interruptId !== metadata.interruptId
  ) {
    return conflictingFinalBoundInterruption();
  }
  if (objection.status === "overruled") {
    const resumeRow = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index
          .eq("trialId", state.trialId)
          .eq("sequence", resolution.sequence + 1),
      )
      .unique();
    if (resumeRow === null) return conflictingFinalBoundInterruption();
    const resume = storedEventToV3(resumeRow);
    if (
      resume.type !== "RESUME_INTERRUPTED_SPEECH" ||
      resume.causationId !== resolution.eventId ||
      resume.payload.interruptId !== metadata.interruptId ||
      resume.payload.interruptedResponseId !== metadata.responseId ||
      resume.responseId !== metadata.responseId ||
      resume.interruptId !== metadata.interruptId
    ) {
      return conflictingFinalBoundInterruption();
    }
  }
  return { ruling: objection.status, remedy: objection.remedy };
}

async function recoveredFinalBoundPerformance(
  ctx: Readonly<{ db: QueryCtx["db"] }>,
  state: TrialStateV3,
  input: Readonly<{
    responseId: string;
    questionId: string;
    objectionId: string;
    interruptionEventId: string;
    outcome: HearingFinalBoundInterruptionOutcome | null;
  }>,
): Promise<
  Readonly<{
    answerTurnId: string | null;
    targetCompletionHead: {
      trialId: string;
      stateVersion: number;
      lastEventId: string;
    };
  }>
> {
  const interruptionRow = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) =>
      index.eq("eventId", input.interruptionEventId),
    )
    .unique();
  if (interruptionRow === null) return conflictingFinalBoundInterruption();
  let target = storedEventToV3(interruptionRow);
  if (input.outcome !== null) {
    const objection = state.objections[input.objectionId];
    if (objection === undefined || objection.rulingEventId === null) {
      return conflictingFinalBoundInterruption();
    }
    const rulingEventId = objection.rulingEventId;
    const rulingRow = await ctx.db
      .query("trialEvents")
      .withIndex("by_event_id", (index) =>
        index.eq("eventId", rulingEventId),
      )
      .unique();
    if (rulingRow === null) return conflictingFinalBoundInterruption();
    const ruling = storedEventToV3(rulingRow);
    const resolutionRow = await ctx.db
      .query("trialEvents")
      .withIndex("by_trial_sequence", (index) =>
        index
          .eq("trialId", state.trialId)
          .eq("sequence", ruling.sequence + 1),
      )
      .unique();
    if (resolutionRow === null) return conflictingFinalBoundInterruption();
    target = storedEventToV3(resolutionRow);
    if (input.outcome.ruling === "overruled") {
      const resumeRow = await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index
            .eq("trialId", state.trialId)
            .eq("sequence", target.sequence + 1),
        )
        .unique();
      if (resumeRow === null) return conflictingFinalBoundInterruption();
      target = storedEventToV3(resumeRow);
    }
  }
  const response = state.pendingResponses[input.responseId];
  let answerTurnId: string | null = null;
  if (response?.status === "committed") {
    const answerActionId = `action:witness-answer:${sha256Utf8(
      JSON.stringify({ trialId: state.trialId, responseId: input.responseId }),
    )}`;
    const answerRow = await ctx.db
      .query("trialEvents")
      .withIndex("by_event_id", (index) =>
        index.eq("eventId", eventIdForGeneratedAction(answerActionId)),
      )
      .unique();
    if (answerRow === null) return conflictingFinalBoundInterruption();
    const answer = storedEventToV3(answerRow);
    if (
      answer.type !== "ANSWER_QUESTION" ||
      answer.payload.responseId !== input.responseId ||
      answer.payload.questionId !== input.questionId ||
      answer.causationId !== target.eventId
    ) {
      return conflictingFinalBoundInterruption();
    }
    answerTurnId = answer.payload.turnId;
    target = answer;
  }
  return {
    answerTurnId,
    targetCompletionHead: {
      trialId: state.trialId,
      stateVersion: target.stateVersion,
      lastEventId: target.eventId,
    },
  };
}

type FinalBoundInterruptionRecoveryResult = Readonly<{
  interrupt: HearingFinalBoundInterruptionRecoveryMetadata;
  outcome: HearingFinalBoundInterruptionOutcome | null;
}>;

function recoveredFinalBoundDigest(interruptId: string): string {
  const match = /^interrupt:final-bound:([0-9a-f]{64})$/u.exec(interruptId);
  const digest = match?.[1];
  if (digest === undefined) return invalidFinalBoundInterruption();
  return digest;
}

async function recoverFinalBoundInterruptionForOwnerHandler(
  ctx: QueryCtx,
  args: Readonly<{
    ownerId: string;
    trialId: string;
    interruptId?: string;
  }>,
): Promise<FinalBoundInterruptionRecoveryResult> {
  const projection = requireOwnedProjection(
    await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (query) => query.eq("trialId", args.trialId))
      .unique(),
    args.ownerId,
  );
  const state = TrialStateV3Schema.parse(
    parseJsonObject(projection.stateJson, "projection.stateJson"),
  );
  const active = state.activeInterruption;
  if (active === null) return invalidFinalBoundInterruption();
  if (
    args.interruptId !== undefined &&
    args.interruptId !== active.interruptId
  ) {
    return staleFinalBoundInterruption();
  }
  const digest = recoveredFinalBoundDigest(active.interruptId);
  const actionIds = {
    question: `action:final-bound-question:${digest}`,
    response: `action:final-bound-response:${digest}`,
    objection: `action:final-bound-objection:${digest}`,
    interruption: `action:final-bound-interruption:${digest}`,
  } as const;
  const eventIds = {
    question: eventIdForGeneratedAction(actionIds.question),
    response: eventIdForGeneratedAction(actionIds.response),
    objection: eventIdForGeneratedAction(actionIds.objection),
    interruption: eventIdForGeneratedAction(actionIds.interruption),
  } as const;
  const rows = await Promise.all(
    Object.values(eventIds).map(async (eventId) =>
      await ctx.db
        .query("trialEvents")
        .withIndex("by_event_id", (index) => index.eq("eventId", eventId))
        .unique(),
    ),
  );
  if (rows.some((row) => row === null)) {
    return conflictingFinalBoundInterruption();
  }
  const [questionRow, responseRow, objectionRow, interruptionRow] = rows;
  if (
    questionRow === null ||
    responseRow === null ||
    objectionRow === null ||
    interruptionRow === null
  ) {
    return conflictingFinalBoundInterruption();
  }
  const question = storedEventToV3(questionRow);
  const response = storedEventToV3(responseRow);
  const objection = storedEventToV3(objectionRow);
  const interruption = storedEventToV3(interruptionRow);
  const questioner = finalBoundPlayerCounsel(state);
  const objector = finalBoundObjector(state);
  const system = finalBoundSystemActor(state);
  const judge = exactFinalBoundActor(state, {
    role: "judge",
    side: "neutral",
    witnessId: null,
  });
  if (
    question.type !== "ASK_QUESTION" &&
    question.type !== "REPHRASE_QUESTION"
  ) {
    return conflictingFinalBoundInterruption();
  }
  const questionState = state.questions[question.payload.questionId];
  if (questionState === undefined) return conflictingFinalBoundInterruption();
  const witness = finalBoundWitness(state, questionState.witnessId);
  const questionEventBindingValid =
    question.type === "ASK_QUESTION"
      ? question.payload.witnessId === questionState.witnessId &&
        question.payload.examinationKind === questionState.examinationKind &&
        question.payload.presentedEvidenceIds.length === 0 &&
        questionState.rephrasesQuestionId === null
      : question.payload.originalQuestionId ===
          questionState.rephrasesQuestionId &&
        state.questions[question.payload.originalQuestionId]?.status ===
          "sustained" &&
        Object.values(state.objections).some(
          (candidate) =>
            candidate.questionId === question.payload.originalQuestionId &&
            candidate.status === "sustained" &&
            candidate.remedy === "rephrase",
        );
  if (
    question.trialId !== args.trialId ||
    question.actionId !== actionIds.question ||
    question.source !== "speech" ||
    question.actor.actorId !== questioner.actorId ||
    question.causationId === null ||
    question.payload.questionId !== `question:final-bound:${digest}` ||
    question.payload.turnId !== `turn:final-bound-question:${digest}` ||
    questionState.questionTurnId !== question.payload.turnId ||
    questionState.askedByActorId !== questioner.actorId ||
    !questionEventBindingValid ||
    response.trialId !== args.trialId ||
    response.type !== "REQUEST_RESPONSE" ||
    response.actionId !== actionIds.response ||
    response.source !== "system" ||
    response.actor.actorId !== system.actorId ||
    response.payload.responseId !== `response:final-bound:${digest}` ||
    response.payload.actorId !== witness.actorId ||
    response.responseId !== `response:final-bound:${digest}` ||
    objection.trialId !== args.trialId ||
    objection.type !== "OBJECT" ||
    objection.actionId !== actionIds.objection ||
    objection.source !== "deterministic" ||
    objection.actor.actorId !== objector.actorId ||
    objection.payload.objectionId !== `objection:final-bound:${digest}` ||
    objection.payload.questionId !== question.payload.questionId ||
    objection.payload.interruptedResponseId !== response.payload.responseId ||
    interruption.trialId !== args.trialId ||
    interruption.type !== "BEGIN_INTERRUPTION" ||
    interruption.actionId !== actionIds.interruption ||
    interruption.source !== "system" ||
    interruption.actor.actorId !== system.actorId ||
    interruption.payload.interruptId !== active.interruptId ||
    interruption.payload.objectionId !== objection.payload.objectionId ||
    interruption.payload.interruptedResponseId !== response.payload.responseId ||
    interruption.interruptId !== active.interruptId ||
    response.sequence !== question.sequence + 1 ||
    objection.sequence !== response.sequence + 1 ||
    interruption.sequence !== objection.sequence + 1 ||
    response.stateVersion !== question.stateVersion + 1 ||
    objection.stateVersion !== response.stateVersion + 1 ||
    interruption.stateVersion !== objection.stateVersion + 1 ||
    response.causationId !== question.eventId ||
    objection.causationId !== response.eventId ||
    interruption.causationId !== objection.eventId ||
    active.sourceEventId !== interruption.eventId ||
    active.objectionId !== objection.payload.objectionId ||
    active.interruptedResponseId !== response.payload.responseId
  ) {
    return conflictingFinalBoundInterruption();
  }
  const metadataBase = {
    interruptId: active.interruptId,
    objectionId: objection.payload.objectionId,
    questionId: question.payload.questionId,
    responseId: response.payload.responseId,
    questionEventId: question.eventId,
    objectionEventId: objection.eventId,
    interruptionEventId: interruption.eventId,
    decisionId: `decision:objection-ruling:${sha256Utf8(
      JSON.stringify({
        trialId: args.trialId,
        stateVersion: interruption.stateVersion,
        lastEventId: interruption.eventId,
        actorId: judge.actorId,
        objectionId: objection.payload.objectionId,
        objectionEventId: objection.eventId,
        interruptId: active.interruptId,
        responseId: response.payload.responseId,
        questionId: question.payload.questionId,
        questionEventId: question.eventId,
      }),
    )}`,
    ground: objection.payload.ground,
    sourceHead: {
      trialId: args.trialId,
      stateVersion: question.stateVersion - 1,
      lastEventId: question.causationId,
    },
    committedHead: {
      trialId: args.trialId,
      stateVersion: interruption.stateVersion,
      lastEventId: interruption.eventId,
    },
  };
  const outcome = await finalBoundOutcome(ctx, state, metadataBase);
  const performance = await recoveredFinalBoundPerformance(ctx, state, {
    responseId: metadataBase.responseId,
    questionId: metadataBase.questionId,
    objectionId: metadataBase.objectionId,
    interruptionEventId: metadataBase.interruptionEventId,
    outcome,
  });
  const metadata: HearingFinalBoundInterruptionRecoveryMetadata = {
    ...metadataBase,
    ...performance,
  };
  return {
    interrupt: metadata,
    outcome,
  };
}

function finalBoundMetadata(input: Readonly<{
  request: FinalBoundInterruptionRequest;
  ground: HearingFinalBoundInterruptionMetadata["ground"];
  prefixReplayed: boolean;
}>): HearingFinalBoundInterruptionMetadata {
  const ids = deriveFinalBoundInterruptionPersistenceIds(input.request);
  const interruptionEventId = eventIdForGeneratedAction(
    ids.beginInterruptionActionId,
  );
  return {
    interruptId: ids.interruptId,
    objectionId: ids.objectionId,
    questionId: ids.questionId,
    responseId: ids.responseId,
    questionEventId: eventIdForGeneratedAction(ids.questionActionId),
    objectionEventId: eventIdForGeneratedAction(ids.objectionActionId),
    interruptionEventId,
    ground: input.ground,
    triggerRevision: input.request.trigger.revision,
    finalRevision: input.request.final.revision,
    sourceHead: input.request.head,
    committedHead: {
      trialId: input.request.head.trialId,
      stateVersion: input.request.head.stateVersion + 4,
      lastEventId: interruptionEventId,
    },
    prefixReplayed: input.prefixReplayed,
  };
}

async function loadFinalBoundStoredEvent(
  ctx: MutationCtx,
  actionId: string,
): Promise<TrialEventV3> {
  const eventId = eventIdForGeneratedAction(actionId);
  const row = await ctx.db
    .query("trialEvents")
    .withIndex("by_event_id", (index) => index.eq("eventId", eventId))
    .unique();
  return row === null
    ? conflictingFinalBoundInterruption()
    : storedEventToV3(row);
}

async function replayFinalBoundInterruption(
  ctx: MutationCtx,
  input: Readonly<{
    request: FinalBoundInterruptionRequest;
    state: TrialStateV3;
    firstReceipt: Doc<"actionReceipts">;
  }>,
): Promise<FinalBoundInterruptionCommitResult> {
  const ids = deriveFinalBoundInterruptionPersistenceIds(input.request);
  const actionIds = [
    ids.questionActionId,
    ids.requestResponseActionId,
    ids.objectionActionId,
    ids.beginInterruptionActionId,
  ] as const;
  const receipts = [input.firstReceipt];
  for (const actionId of actionIds.slice(1)) {
    const receipt = await ctx.db
      .query("actionReceipts")
      .withIndex("by_action_id", (index) => index.eq("actionId", actionId))
      .unique();
    if (receipt === null) return conflictingFinalBoundInterruption();
    receipts.push(receipt);
  }
  const events: TrialEventV3[] = [];
  for (const actionId of actionIds) {
    events.push(await loadFinalBoundStoredEvent(ctx, actionId));
  }
  const sourceVersion = input.request.head.stateVersion;
  const firstSequence = events[0]?.sequence;
  if (firstSequence === undefined) return conflictingFinalBoundInterruption();
  for (const [index, actionId] of actionIds.entries()) {
    const receipt = receipts[index];
    const event = events[index];
    if (
      receipt === undefined ||
      event === undefined ||
      receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
      receipt.status !== "committed" ||
      receipt.trialId !== input.request.head.trialId ||
      receipt.actionId !== actionId ||
      receipt.expectedStateVersion !== sourceVersion + index ||
      receipt.committedStateVersion !== sourceVersion + index + 1 ||
      receipt.firstSequence !== firstSequence + index ||
      receipt.lastSequence !== firstSequence + index ||
      !sameOrderedIdentifiers(receipt.eventIds, [event.eventId]) ||
      event.trialId !== input.request.head.trialId ||
      event.actionId !== actionId ||
      event.stateVersion !== sourceVersion + index + 1 ||
      event.sequence !== firstSequence + index ||
      !input.state.eventIds.includes(event.eventId)
    ) {
      return conflictingFinalBoundInterruption();
    }
  }
  const [question, response, objection, interruption] = events;
  if (
    (question?.type !== "ASK_QUESTION" &&
      question?.type !== "REPHRASE_QUESTION") ||
    question.source !== "speech" ||
    question.causationId !== input.request.head.lastEventId ||
    question.payload.questionId !== ids.questionId ||
    question.payload.turnId !== ids.questionTurnId ||
    question.payload.text !== input.request.final.text ||
    (question.type === "ASK_QUESTION" &&
      question.payload.presentedEvidenceIds.length !== 0) ||
    response?.type !== "REQUEST_RESPONSE" ||
    response.source !== "system" ||
    response.causationId !== question.eventId ||
    response.payload.responseId !== ids.responseId ||
    response.payload.purpose !== "answer_question" ||
    objection?.type !== "OBJECT" ||
    objection.source !== "deterministic" ||
    objection.causationId !== response.eventId ||
    objection.payload.objectionId !== ids.objectionId ||
    objection.payload.questionId !== ids.questionId ||
    objection.payload.interruptedResponseId !== ids.responseId ||
    interruption?.type !== "BEGIN_INTERRUPTION" ||
    interruption.source !== "system" ||
    interruption.causationId !== objection.eventId ||
    interruption.payload.interruptId !== ids.interruptId ||
    interruption.payload.interruptedResponseId !== ids.responseId ||
    interruption.payload.objectionId !== ids.objectionId
  ) {
    return conflictingFinalBoundInterruption();
  }
  const questionState = input.state.questions[ids.questionId];
  const appearance =
    questionState === undefined
      ? undefined
      : input.state.appearances[questionState.appearanceId];
  const questioningActor = input.state.actors[question.actor.actorId];
  const responseActor = input.state.actors[response.payload.actorId];
  const objector = input.state.actors[objection.actor.actorId];
  const expectedQuestioner = finalBoundPlayerCounsel(input.state);
  const expectedObjector = finalBoundObjector(input.state);
  const questionEventBindingValid =
    question.type === "ASK_QUESTION"
      ? isFinalBoundExaminationLeg(question.payload.examinationKind) &&
        question.payload.witnessId === appearance?.witnessId &&
        questionState?.examinationKind === question.payload.examinationKind &&
        questionState?.rephrasesQuestionId === null
      : questionState?.rephrasesQuestionId ===
          question.payload.originalQuestionId &&
        input.state.questions[question.payload.originalQuestionId]?.status ===
          "sustained" &&
        Object.values(input.state.objections).some(
          (candidate) =>
            candidate.questionId === question.payload.originalQuestionId &&
            candidate.status === "sustained" &&
            candidate.remedy === "rephrase",
        );
  if (
    appearance === undefined ||
    questionState === undefined ||
    !questionEventBindingValid ||
    questionState.questionTurnId !== ids.questionTurnId ||
    question.actor.actorId !== expectedQuestioner.actorId ||
    questioningActor?.actorId !== expectedQuestioner.actorId ||
    responseActor?.role !== "witness" ||
    responseActor.witnessId !== questionState.witnessId ||
    objector?.actorId !== expectedObjector.actorId ||
    objection.actor.actorId !== expectedObjector.actorId
  ) {
    return conflictingFinalBoundInterruption();
  }
  const storedObjection = input.state.objections[ids.objectionId];
  if (
    storedObjection === undefined ||
    storedObjection.sourceEventId !== objection.eventId ||
    storedObjection.questionId !== ids.questionId ||
    storedObjection.interruptedResponseId !== ids.responseId ||
    storedObjection.objectorActorId !== expectedObjector.actorId ||
    storedObjection.ground !== objection.payload.ground ||
    !input.state.policySnapshot.permittedObjectionGrounds.includes(
      storedObjection.ground,
    )
  ) {
    return conflictingFinalBoundInterruption();
  }
  return {
    status: "interruption",
    interrupt: finalBoundMetadata({
      request: input.request,
      ground: storedObjection.ground,
      prefixReplayed: true,
    }),
    outcome: await finalBoundOutcome(ctx, input.state, {
      objectionId: ids.objectionId,
      interruptId: ids.interruptId,
      responseId: ids.responseId,
    }),
  };
}

async function prepareFinalBoundInterruptionForOwnerHandler(
  ctx: MutationCtx,
  args: Readonly<{
    ownerId: string;
    trialId: string;
    requestJson: string;
  }>,
): Promise<FinalBoundInterruptionCommitResult> {
  assertIdentifier(args.ownerId, "ownerId");
  assertIdentifier(args.trialId, "trialId");
  let requestInput: unknown;
  try {
    requestInput = parseJsonObject(args.requestJson, "requestJson");
  } catch {
    return invalidFinalBoundInterruption();
  }
  const parsed = FinalBoundInterruptionRequestSchema.safeParse(requestInput);
  if (!parsed.success || parsed.data.head.trialId !== args.trialId) {
    return invalidFinalBoundInterruption();
  }
  const request = parsed.data;
  const projection = requireOwnedProjection(
    await ctx.db
      .query("trialProjections")
      .withIndex("by_trial", (index) => index.eq("trialId", args.trialId))
      .unique(),
    args.ownerId,
  );
  const state = await loadActiveHead(ctx, projection);
  const ids = deriveFinalBoundInterruptionPersistenceIds(request);
  const firstReceipt = await ctx.db
    .query("actionReceipts")
    .withIndex("by_action_id", (index) =>
      index.eq("actionId", ids.questionActionId),
    )
    .unique();
  if (firstReceipt !== null) {
    return await replayFinalBoundInterruption(ctx, {
      request,
      state,
      firstReceipt,
    });
  }
  if (
    state.trialId !== request.head.trialId ||
    state.version !== request.head.stateVersion ||
    currentFinalBoundLastEventId(state) !== request.head.lastEventId
  ) {
    return staleFinalBoundInterruption();
  }
  if (
    state.phase !== "case_in_chief" ||
    state.activeQuestionId !== null ||
    state.activeInterruption?.status === "active" ||
    state.activeAppearanceId === null ||
    state.activeWitnessId === null
  ) {
    return invalidFinalBoundInterruption();
  }
  const appearance = state.appearances[state.activeAppearanceId];
  if (
    appearance === undefined ||
    appearance.witnessId !== state.activeWitnessId ||
    !isFinalBoundExaminationLeg(appearance.stage)
  ) {
    return invalidFinalBoundInterruption();
  }
  const examinationLeg = appearance.stage;
  const leg = appearance.legs[examinationLeg];
  if (
    leg.ownerSide !== state.userSide ||
    (leg.status !== "available" && leg.status !== "in_progress")
  ) {
    return invalidFinalBoundInterruption();
  }
  const questioner = finalBoundPlayerCounsel(state);
  const objector = finalBoundObjector(state);
  const system = finalBoundSystemActor(state);
  const witness = finalBoundWitness(state, appearance.witnessId);
  const rephraseTarget = findOutstandingRephraseTarget({
    state,
    examiningActorId: questioner.actorId,
    examiningSide: state.userSide,
  });
  const evaluation = evaluateFinalBoundCandidate({
    request,
    state,
    appearanceId: appearance.appearanceId,
    examinationLeg,
    questioningActorId: questioner.actorId,
    ...(rephraseTarget === null
      ? {}
      : { excludeQuestionId: rephraseTarget.originalQuestionId }),
  });
  if (!evaluation.finalSupported) {
    return {
      status: "candidate_withdrawn",
      sourceHead: request.head,
      triggerRevision: request.trigger.revision,
      finalRevision: request.final.revision,
    };
  }
  const candidate = evaluation.trigger;
  const baseVersion = request.head.stateVersion;
  const actions = [
    rephraseTarget === null
      ? finalBoundAction({
          actionId: ids.questionActionId,
          trialId: args.trialId,
          expectedStateVersion: baseVersion,
          actor: questioner,
          source: "speech",
          requestedAt: finalBoundRequestedAt(state.updatedAt, 1),
          causationId: request.head.lastEventId,
          type: "ASK_QUESTION",
          payload: {
            questionId: ids.questionId,
            witnessId: appearance.witnessId,
            examinationKind: examinationLeg,
            text: request.final.text,
            turnId: ids.questionTurnId,
            presentedEvidenceIds: [],
          },
        })
      : finalBoundAction({
          actionId: ids.questionActionId,
          trialId: args.trialId,
          expectedStateVersion: baseVersion,
          actor: questioner,
          source: "speech",
          requestedAt: finalBoundRequestedAt(state.updatedAt, 1),
          causationId: request.head.lastEventId,
          type: "REPHRASE_QUESTION",
          payload: {
            originalQuestionId: rephraseTarget.originalQuestionId,
            questionId: ids.questionId,
            text: request.final.text,
            turnId: ids.questionTurnId,
          },
        }),
    finalBoundAction({
      actionId: ids.requestResponseActionId,
      trialId: args.trialId,
      expectedStateVersion: baseVersion + 1,
      actor: system,
      source: "system",
      requestedAt: finalBoundRequestedAt(state.updatedAt, 2),
      causationId: eventIdForGeneratedAction(ids.questionActionId),
      responseId: ids.responseId,
      type: "REQUEST_RESPONSE",
      payload: {
        responseId: ids.responseId,
        actorId: witness.actorId,
        purpose: "answer_question",
      },
    }),
    finalBoundAction({
      actionId: ids.objectionActionId,
      trialId: args.trialId,
      expectedStateVersion: baseVersion + 2,
      actor: objector,
      source: "deterministic",
      requestedAt: finalBoundRequestedAt(state.updatedAt, 3),
      causationId: eventIdForGeneratedAction(ids.requestResponseActionId),
      type: "OBJECT",
      payload: {
        objectionId: ids.objectionId,
        questionId: ids.questionId,
        ground: candidate.ground,
        interruptedResponseId: ids.responseId,
      },
    }),
    finalBoundAction({
      actionId: ids.beginInterruptionActionId,
      trialId: args.trialId,
      expectedStateVersion: baseVersion + 3,
      actor: system,
      source: "system",
      requestedAt: finalBoundRequestedAt(state.updatedAt, 4),
      causationId: eventIdForGeneratedAction(ids.objectionActionId),
      interruptId: ids.interruptId,
      type: "BEGIN_INTERRUPTION",
      payload: {
        interruptId: ids.interruptId,
        interruptedResponseId: ids.responseId,
        objectionId: ids.objectionId,
      },
    }),
  ] as const;
  for (const [index, action] of actions.entries()) {
    const currentProjection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (query) =>
          query.eq("trialId", args.trialId),
        )
        .unique(),
      args.ownerId,
    );
    let receipt;
    try {
      receipt = await appendActiveAction(ctx, {
        action,
        ownerId: args.ownerId,
        projection: currentProjection,
        writeSnapshot: index === actions.length - 1,
        playerControlledOnly: index === 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("CONFLICT") || message.includes("DUPLICATE")) {
        return conflictingFinalBoundInterruption();
      }
      if (message.includes("STALE_STATE_VERSION")) {
        return staleFinalBoundInterruption();
      }
      throw error;
    }
    if (
      receipt.replayed ||
      receipt.actionId !== action.actionId ||
      receipt.committedStateVersion !== baseVersion + index + 1 ||
      !sameOrderedIdentifiers(receipt.eventIds, [
        eventIdForGeneratedAction(action.actionId),
      ])
    ) {
      return conflictingFinalBoundInterruption();
    }
  }
  return {
    status: "interruption",
    interrupt: finalBoundMetadata({
      request,
      ground: candidate.ground,
      prefixReplayed: false,
    }),
    outcome: null,
  };
}

/**
 * Trusted final-bound speech preparation. All four prefix events are committed
 * in this single mutation, so no witness generation can interleave between
 * the spoken question, response request, objection, and interruption.
 */
export const prepareFinalBoundInterruptionForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    requestJson: v.string(),
  },
  handler: prepareFinalBoundInterruptionForOwnerHandler,
});

/**
 * Owner-bound reload seam for the one canonical current final-bound
 * interruption. It reconstructs authority exclusively from durable events;
 * no partial transcript, utterance identity, actor, or ground is accepted.
 */
export const recoverFinalBoundInterruptionForOwner = internalQuery({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    interruptId: v.optional(v.string()),
  },
  handler: recoverFinalBoundInterruptionForOwnerHandler,
});

/** Commits one player-controlled active-v3 action for the authenticated owner. */
export const append = internalMutation({
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
        .withIndex("by_trial", (index) => index.eq("trialId", action.trialId))
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
        .withIndex("by_trial", (index) => index.eq("trialId", action.trialId))
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
        .withIndex("by_trial", (index) => index.eq("trialId", action.trialId))
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
    claimCredentialJson: v.optional(v.string()),
    claimNow: v.optional(v.number()),
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
        .withIndex("by_trial", (index) => index.eq("trialId", action.trialId))
        .unique(),
      args.ownerId,
    );
    const state = TrialStateV3Schema.parse(JSON.parse(projection.stateJson));
    const response = state.pendingResponses[action.payload.responseId];
    if (response === undefined) return invalidWitnessGeneration();
    const requiresClaim =
      response.interruptId === null
        ? false
        : await canonicalTargetRequiresFinalBoundClaim(ctx, state, {
            interruptId: response.interruptId,
            responseId: response.responseId,
          });
    await requireFinalBoundClaimForAppend(ctx, {
      ownerId: args.ownerId,
      trialId: action.trialId,
      credentialJson: args.claimCredentialJson,
      now: args.claimNow,
      required: requiresClaim,
      expectedPhase: "witness_pending",
    });
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
        .withIndex("by_trial", (index) => index.eq("trialId", action.trialId))
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

    const generation = parseCounselResponseGenerationJson(args.generationJson);
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
      writeSnapshot: continuation === null ? args.writeSnapshot : false,
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
          .withIndex("by_trial", (index) => index.eq("trialId", action.trialId))
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

/** Atomically commits a Luna judge ruling, interruption resolution, and audit. */
export const appendObjectionRulingForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJsons: v.array(v.string()),
    generationJson: v.string(),
    claimCredentialJson: v.optional(v.string()),
    claimNow: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    let actionInputs: unknown[];
    try {
      actionInputs = args.actionJsons.map((actionJson) =>
        parseJsonObject(actionJson, "actionJson"),
      );
    } catch {
      return invalidObjectionRuling();
    }
    const parsedActions = actionInputs.map((input) =>
      TrialActionV3Schema.safeParse(input),
    );
    if (parsedActions.some((parsed) => !parsed.success)) {
      return invalidObjectionRuling();
    }
    const generation = parseObjectionRulingJson(args.generationJson);
    const actions = await requireObjectionRulingActions(
      ctx,
      parsedActions.map((parsed) => {
        if (!parsed.success) return invalidObjectionRuling();
        return parsed.data;
      }),
      generation,
    );
    const rulingAction = actions[0];
    if (rulingAction === undefined) return invalidObjectionRuling();
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (query) =>
          query.eq("trialId", rulingAction.trialId),
        )
        .unique(),
      args.ownerId,
    );
    const state = TrialStateV3Schema.parse(JSON.parse(projection.stateJson));
    if (
      rulingAction.interruptId === null ||
      rulingAction.responseId === null
    ) {
      return invalidObjectionRuling();
    }
    const requiresClaim = await canonicalTargetRequiresFinalBoundClaim(
      ctx,
      state,
      {
        interruptId: rulingAction.interruptId,
        responseId: rulingAction.responseId,
      },
    );
    await requireFinalBoundClaimForAppend(ctx, {
      ownerId: args.ownerId,
      trialId: rulingAction.trialId,
      credentialJson: args.claimCredentialJson,
      now: args.claimNow,
      required: requiresClaim,
      expectedPhase: "ruling_pending",
      expectedDecisionId: generation.decisionId,
    });
    let primaryReceipt: Awaited<ReturnType<typeof appendActiveAction>> | null =
      null;
    for (const [index, action] of actions.entries()) {
      const projection = requireOwnedProjection(
        await ctx.db
          .query("trialProjections")
          .withIndex("by_trial", (query) =>
            query.eq("trialId", action.trialId),
          )
          .unique(),
        args.ownerId,
      );
      const receipt = await appendActiveAction(ctx, {
        action,
        ownerId: args.ownerId,
        projection,
        writeSnapshot: index === actions.length - 1,
        playerControlledOnly: false,
      });
      const eventId = receipt.eventIds[0];
      if (
        receipt.eventIds.length !== 1 ||
        eventId !== eventIdForGeneratedAction(action.actionId) ||
        receipt.actionId !== action.actionId ||
        receipt.trialId !== action.trialId
      ) {
        return invalidObjectionRuling();
      }
      await requireStoredGeneratedEvent(ctx, { action, eventId });
      if (index === 0) primaryReceipt = receipt;
    }
    if (primaryReceipt === null) return invalidObjectionRuling();
    const primaryAction = actions[0];
    if (!primaryAction) return invalidObjectionRuling();
    const committedTrace = CourtroomModelCallTraceSchema.parse({
      ...generation.trace,
      committedActionId: primaryAction.actionId,
      committedEventId: eventIdForGeneratedAction(primaryAction.actionId),
    });
    await persistTerminalCourtroomModelCallForOwner(ctx, {
      ownerId: args.ownerId,
      traceJson: canonicalJson(committedTrace),
    });
    return primaryReceipt;
  },
});

/** Atomically commits one private Luna negotiation decision and its audit. */
export const appendNegotiationDecisionForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJson: v.string(),
    generationJson: v.string(),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    let actionInput: unknown;
    try {
      actionInput = parseJsonObject(args.actionJson, "actionJson");
    } catch {
      return invalidNegotiationGeneration();
    }
    const parsedAction = TrialActionV3Schema.safeParse(actionInput);
    if (!parsedAction.success) return invalidNegotiationGeneration();
    const generation = parseNegotiationGenerationJson(args.generationJson);
    const action = requireNegotiationAction(parsedAction.data, generation);
    const projection = requireOwnedProjection(
      await ctx.db
        .query("trialProjections")
        .withIndex("by_trial", (query) =>
          query.eq("trialId", action.trialId),
        )
        .unique(),
      args.ownerId,
    );
    const receipt = await appendActiveAction(ctx, {
      action,
      ownerId: args.ownerId,
      projection,
      writeSnapshot: true,
      playerControlledOnly: false,
    });
    const eventId = receipt.eventIds[0];
    if (
      receipt.eventIds.length !== 1 ||
      eventId !== eventIdForGeneratedAction(action.actionId) ||
      receipt.actionId !== action.actionId ||
      receipt.trialId !== action.trialId
    ) {
      return invalidNegotiationGeneration();
    }
    await requireStoredGeneratedEvent(ctx, { action, eventId });
    const committedTrace = CourtroomModelCallTraceSchema.parse({
      ...generation.trace,
      committedActionId: action.actionId,
      committedEventId: eventId,
    });
    await persistTerminalCourtroomModelCallForOwner(ctx, {
      ownerId: args.ownerId,
      traceJson: canonicalJson(committedTrace),
    });
    return receipt;
  },
});

/**
 * Atomically commits one accepted Luna deliberation, its private artifact,
 * the deterministic verdict transition, and the redacted terminal call audit.
 */
export const appendJuryGenerationForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJsons: v.array(v.string()),
    generationJson: v.string(),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    let actionInputs: unknown[];
    try {
      actionInputs = args.actionJsons.map((actionJson) =>
        parseJsonObject(actionJson, "actionJson"),
      );
    } catch {
      return invalidJuryGeneration();
    }
    const parsedActions = actionInputs.map((actionInput) =>
      TrialActionV3Schema.safeParse(actionInput),
    );
    if (parsedActions.some((parsed) => !parsed.success)) {
      return invalidJuryGeneration();
    }
    const generation = parseJuryGenerationJson(args.generationJson);
    const actions = requireJuryGenerationActions(
      parsedActions.map((parsed) => {
        if (!parsed.success) return invalidJuryGeneration();
        return parsed.data;
      }),
      generation,
    );

    let primaryReceipt: Awaited<ReturnType<typeof appendActiveAction>> | null =
      null;
    for (const [index, action] of actions.entries()) {
      const projection = requireOwnedProjection(
        await ctx.db
          .query("trialProjections")
          .withIndex("by_trial", (query) =>
            query.eq("trialId", action.trialId),
          )
          .unique(),
        args.ownerId,
      );
      const receipt = await appendActiveAction(ctx, {
        action,
        ownerId: args.ownerId,
        projection,
        writeSnapshot: index === actions.length - 1,
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
        return invalidJuryGeneration();
      }
      await requireStoredGeneratedEvent(ctx, {
        action,
        eventId: committedEventId,
      });
      if (index === 0) primaryReceipt = receipt;
    }
    if (primaryReceipt === null) return invalidJuryGeneration();

    await persistJuryArtifact(ctx, args.ownerId, generation);
    const committedTrace = CourtroomModelCallTraceSchema.parse({
      ...generation.trace,
      committedActionId: actions[0].actionId,
      committedEventId: eventIdForGeneratedAction(actions[0].actionId),
    });
    await persistTerminalCourtroomModelCallForOwner(ctx, {
      ownerId: args.ownerId,
      traceJson: canonicalJson(committedTrace),
    });
    return primaryReceipt;
  },
});

/**
 * Atomically commits one accepted Terra coaching artifact, its stable event,
 * the complete transition, final snapshot, and redacted terminal call audit.
 */
export const appendDebriefGenerationForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    actionJsons: v.array(v.string()),
    generationJson: v.string(),
  },
  handler: async (ctx, args) => {
    assertIdentifier(args.ownerId, "ownerId");
    let actionInputs: unknown[];
    try {
      actionInputs = args.actionJsons.map((actionJson) =>
        parseJsonObject(actionJson, "actionJson"),
      );
    } catch {
      return invalidDebriefGeneration();
    }
    const parsedActions = actionInputs.map((actionInput) =>
      TrialActionV3Schema.safeParse(actionInput),
    );
    if (parsedActions.some((parsed) => !parsed.success)) {
      return invalidDebriefGeneration();
    }
    const generation = parseDebriefGenerationJson(args.generationJson);
    const actions = requireDebriefGenerationActions(
      parsedActions.map((parsed) => {
        if (!parsed.success) return invalidDebriefGeneration();
        return parsed.data;
      }),
      generation,
    );

    let primaryReceipt: Awaited<ReturnType<typeof appendActiveAction>> | null =
      null;
    for (const [index, action] of actions.entries()) {
      const projection = requireOwnedProjection(
        await ctx.db
          .query("trialProjections")
          .withIndex("by_trial", (query) =>
            query.eq("trialId", action.trialId),
          )
          .unique(),
        args.ownerId,
      );
      const receipt = await appendActiveAction(ctx, {
        action,
        ownerId: args.ownerId,
        projection,
        writeSnapshot: index === actions.length - 1,
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
        return invalidDebriefGeneration();
      }
      await requireStoredGeneratedEvent(ctx, {
        action,
        eventId: committedEventId,
      });
      if (index === 0) primaryReceipt = receipt;
    }
    if (primaryReceipt === null) return invalidDebriefGeneration();

    await persistDebriefArtifact(ctx, args.ownerId, generation);
    const committedTrace = CourtroomModelCallTraceSchema.parse({
      ...generation.trace,
      committedActionId: actions[0].actionId,
      committedEventId: eventIdForGeneratedAction(actions[0].actionId),
    });
    await persistTerminalCourtroomModelCallForOwner(ctx, {
      ownerId: args.ownerId,
      traceJson: canonicalJson(committedTrace),
    });
    return primaryReceipt;
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
      .withIndex("by_trial", (index) => index.eq("trialId", args.trialId))
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
    .withIndex("by_trial_version", (index) => index.eq("trialId", args.trialId))
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
