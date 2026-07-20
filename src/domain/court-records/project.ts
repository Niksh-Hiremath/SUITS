import {
  DebriefGeneratorRequestSchema,
  DebriefGeneratorModelOutputSchema,
  validateDebriefGeneratorOutput,
  type DebriefCitationSet,
  type DebriefGeneratorRequest,
  type DebriefGeneratorModelOutput,
} from "../courtroom-ai";
import { computeCaseGraphContentHash, sha256Utf8 } from "../case-graph";
import {
  buildKnowledgeView,
  buildOpponentCounselPublicKnowledgeView,
  buildOpponentPlannerKnowledgeView,
} from "../knowledge";
import type { HearingAudioAuditRecord } from "../../lib/speech/hearing-audio-audit";
import {
  HEARING_COURTROOM_DIRECTOR_ACTOR_ID,
  HEARING_JUDGE_ACTOR_ID,
  HEARING_OBJECTION_ACTOR_ID,
  hearingPerformanceActorAlias,
  isHearingPerformanceSpeakableActor,
} from "../../lib/speech/hearing-performance";
import {
  debriefGeneratorCitedTranscriptTurnIds,
  debriefGeneratorOutputCitations,
} from "../hearing-runtime/model-boundary";
import {
  applyTrialEvent,
  initializeTrialFromEvent,
  reduceTrial,
  type CitationSet,
  type TrialEvent,
  type TrialStateV3,
} from "../trial-engine";
import {
  COURT_RECORDS_SUMMARY_SCHEMA_VERSION,
  COURT_RECORDS_VIEW_SCHEMA_VERSION,
  CourtRecordsAudioAuditInputSchema,
  CourtRecordsCitationResourceSchema,
  CourtRecordsIdentifierSchema,
  CourtRecordsProjectorInputSchema,
  CourtRecordsTrialSummarySchema,
  CourtRecordsTrialSummaryRowInputSchema,
  CourtRecordsViewSchema,
  type CourtRecordsProjectorInput,
  type CourtRecordsTrialSummary,
  type CourtRecordsTrialSummaryRowInput,
  type CourtRecordsView,
  type DeepReadonly,
} from "./schemas";

type ResourceInput = CourtRecordsProjectorInput["citationResources"][number];
type ResourceKind = ResourceInput["kind"];
type OwnerRecordScope = Readonly<{
  factIds: ReadonlySet<string>;
  evidenceIds: ReadonlySet<string>;
}>;
type ResourceIndex = Readonly<{
  byKey: ReadonlyMap<string, ResourceInput>;
  byId: ReadonlyMap<string, readonly ResourceInput[]>;
}>;

const RESOURCE_LABELS: Readonly<
  Record<ResourceKind, Readonly<{ stratum: string; label: string }>>
> = Object.freeze({
  admitted_fact: { stratum: "admitted_record", label: "Admitted fact" },
  admitted_evidence: {
    stratum: "admitted_record",
    label: "Admitted evidence",
  },
  active_testimony: {
    stratum: "admitted_record",
    label: "Active testimony",
  },
  unadmitted_fact: {
    stratum: "unadmitted_record",
    label: "Unadmitted fact",
  },
  unadmitted_evidence: {
    stratum: "unadmitted_record",
    label: "Unadmitted evidence",
  },
  excluded_fact: {
    stratum: "excluded_or_stricken",
    label: "Excluded or stricken fact",
  },
  excluded_evidence: {
    stratum: "excluded_or_stricken",
    label: "Excluded evidence",
  },
  stricken_testimony: {
    stratum: "excluded_or_stricken",
    label: "Stricken testimony",
  },
  hidden_fact: {
    stratum: "hidden_authoring_truth",
    label: "Hidden authoring truth",
  },
  source_segment: {
    stratum: "hidden_authoring_truth",
    label: "Source segment",
  },
  coaching_inference: {
    stratum: "coaching_inference",
    label: "Coaching inference",
  },
  transcript_turn: {
    stratum: "procedural_record",
    label: "Transcript turn",
  },
  event: { stratum: "procedural_record", label: "Trial event" },
  prior_statement: {
    stratum: "procedural_record",
    label: "Prior statement",
  },
});

function fail(code: string): never {
  throw new Error(`COURT_RECORDS_${code}`);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  // The recursive walk above freezes every reachable JSON value produced by
  // strict Zod parsing. This local cast only reflects that runtime guarantee.
  return value as DeepReadonly<T>;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUniqueIds(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers)].sort(compareIds);
}

function uniqueRows<T>(rows: readonly T[], id: (row: T) => string, code: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const identifier = id(row);
    if (seen.has(identifier)) fail(code);
    seen.add(identifier);
  }
}

export function projectCourtRecordsTrialSummaries(
  ownerIdInput: string,
  rowInputs: readonly CourtRecordsTrialSummaryRowInput[],
): readonly CourtRecordsTrialSummary[] {
  const ownerId = CourtRecordsIdentifierSchema.parse(ownerIdInput);
  const rows = rowInputs.map((row) =>
    CourtRecordsTrialSummaryRowInputSchema.parse(row),
  );
  uniqueRows(rows, (row) => row.trialId, "DUPLICATE_TRIAL_SUMMARY");
  for (const row of rows) {
    if (row.ownerId !== ownerId) fail("FOREIGN_TRIAL_SUMMARY");
    if (row.stateVersion !== row.lastSequence || row.stateVersion < 1) {
      fail("TRIAL_SUMMARY_HEAD_MISMATCH");
    }
  }
  const projected = rows
    .map((row) =>
      CourtRecordsTrialSummarySchema.parse({
        schemaVersion: COURT_RECORDS_SUMMARY_SCHEMA_VERSION,
        trialId: row.trialId,
        caseId: row.caseId,
        caseTitle: row.caseTitle,
        phase: row.phase,
        status: row.status,
        stateVersion: row.stateVersion,
        lastSequence: row.lastSequence,
        lastEventId: row.lastEventId,
        startedAt: row.startedAt,
        updatedAt: row.updatedAt,
        transcriptTurnCount: row.transcriptTurnCount,
        modelCallCount: row.modelCallCount,
        hasFinalDebrief: row.hasFinalDebrief,
      }),
    )
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        compareIds(left.trialId, right.trialId),
    );
  return deepFreeze(projected);
}

function validateOwnerBindings(input: CourtRecordsProjectorInput): void {
  const trialId = input.trialState.trialId;
  for (const row of input.modelCalls) {
    if (row.ownerId !== input.ownerId || row.trace.trialId !== trialId) {
      fail("FOREIGN_MODEL_CALL");
    }
  }
  for (const resource of input.citationResources) {
    if (resource.ownerId !== input.ownerId || resource.trialId !== trialId) {
      fail("FOREIGN_CITATION_RESOURCE");
    }
  }
  for (const audit of input.audioAudits) {
    if (audit.ownerId !== input.ownerId || audit.trialId !== trialId) {
      fail("FOREIGN_AUDIO_AUDIT");
    }
  }
  const artifact = input.finalDebriefArtifact;
  if (
    artifact !== null &&
    (artifact.ownerId !== input.ownerId || artifact.trialId !== trialId)
  ) {
    fail("FOREIGN_DEBRIEF_ARTIFACT");
  }
}

function validateReplay(
  state: TrialStateV3,
  events: readonly TrialEvent[],
): TrialStateV3 {
  if (events.some((event) => event.trialId !== state.trialId)) {
    fail("FOREIGN_EVENT");
  }
  let replayed: TrialStateV3;
  try {
    replayed = reduceTrial(events) as TrialStateV3;
  } catch {
    fail("EVENT_STREAM_INVALID");
  }
  if (stableJson(replayed) !== stableJson(state)) {
    fail("REPLAY_STATE_MISMATCH");
  }
  const lastEvent = events.at(-1);
  if (
    lastEvent === undefined ||
    state.version !== events.length ||
    state.lastSequence !== events.length ||
    lastEvent.eventId !== state.eventIds.at(-1) ||
    lastEvent.stateVersion !== state.version
  ) {
    fail("TRIAL_HEAD_MISMATCH");
  }
  return replayed;
}

function resourceKey(resource: Pick<ResourceInput, "resourceId" | "kind">): string {
  return `${resource.kind}\u0000${resource.resourceId}`;
}

function resourceMap(resources: readonly ResourceInput[]): ResourceIndex {
  uniqueRows(resources, resourceKey, "DUPLICATE_CITATION_RESOURCE");
  const byKey = new Map(
    resources.map((resource) => [resourceKey(resource), resource]),
  );
  const byId = new Map<string, ResourceInput[]>();
  for (const resource of resources) {
    byId.set(resource.resourceId, [
      ...(byId.get(resource.resourceId) ?? []),
      resource,
    ]);
  }
  return { byKey, byId };
}

function matchingResource(
  resources: ResourceIndex,
  identifier: string,
  kinds: ReadonlySet<ResourceKind>,
): ResourceInput | undefined {
  const matches = (resources.byId.get(identifier) ?? []).filter((resource) =>
    kinds.has(resource.kind),
  );
  if (matches.length > 1) fail("AMBIGUOUS_CITATION_RESOURCE");
  return matches[0];
}

function exactResource(
  resources: ResourceIndex,
  identifier: string,
  kind: ResourceKind,
): ResourceInput | undefined {
  return resources.byKey.get(resourceKey({ resourceId: identifier, kind }));
}

function ownerRecordScope(input: CourtRecordsProjectorInput): OwnerRecordScope {
  const playerActors = Object.values(input.trialState.actors).filter(
    (actor) =>
      (actor.role === "user_counsel" ||
        actor.role === "opposing_counsel") &&
      actor.side === input.trialState.userSide,
  );
  const playerActor = playerActors[0];
  if (playerActors.length !== 1 || playerActor === undefined) {
    fail("OWNER_KNOWLEDGE_INVALID");
  }
  let view: ReturnType<typeof buildKnowledgeView>;
  try {
    view = buildKnowledgeView(
      { caseGraph: input.caseGraph, trial: input.trialState },
      playerActor.actorId,
    );
  } catch {
    fail("OWNER_KNOWLEDGE_INVALID");
  }
  if (
    view.actorRole !== "user_counsel" &&
    view.actorRole !== "opposing_counsel"
  ) {
    fail("OWNER_KNOWLEDGE_INVALID");
  }
  return {
    factIds: idSet([
      ...view.counsel.facts.map((fact) => fact.factId),
      ...view.publicRecord.facts.map((fact) => fact.factId),
      ...Object.values(input.trialState.transcriptTurns).flatMap(
        (turn) => turn.citations.factIds,
      ),
    ]),
    evidenceIds: idSet([
      ...view.counsel.evidence.map((evidence) => evidence.evidenceId),
      ...view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
      ...Object.values(input.trialState.evidence).flatMap((evidence) =>
        evidence.offeredBySide === null ? [] : [evidence.evidenceId],
      ),
      ...Object.values(input.trialState.questions).flatMap(
        (question) => question.presentedEvidenceIds,
      ),
      ...Object.values(input.trialState.transcriptTurns).flatMap(
        (turn) => turn.citations.evidenceIds,
      ),
    ]),
  };
}

function validateResourceBindings(
  input: CourtRecordsProjectorInput,
  events: readonly TrialEvent[],
  resources: ResourceIndex,
  ownerScope: OwnerRecordScope,
): void {
  const eventIds = new Set(events.map((event) => event.eventId));
  const sourceSegmentIds = new Set(
    input.caseGraph.sourceSegments.map((segment) => segment.sourceSegmentId),
  );
  const priorStatementIds = new Set(
    input.caseGraph.witnesses.flatMap((witness) =>
      witness.priorStatements.map((statement) => statement.priorStatementId),
    ),
  );
  const unadmittedFactStatuses = new Set(["proposed", "disputed", "verified"]);
  const excludedFactStatuses = new Set(["excluded", "stricken"]);
  const unadmittedEvidenceStatuses = new Set([
    "uploaded",
    "indexed",
    "offered",
    "withdrawn",
  ]);
  for (const resource of resources.byKey.values()) {
    const fact = input.trialState.facts[resource.resourceId];
    const evidence = input.trialState.evidence[resource.resourceId];
    const testimony = input.trialState.testimony[resource.resourceId];
    const transcriptTurn = input.trialState.transcriptTurns[resource.resourceId];
    const valid = (() => {
      switch (resource.kind) {
        case "admitted_fact":
          return fact?.status === "admitted";
        case "unadmitted_fact":
          return fact !== undefined && unadmittedFactStatuses.has(fact.status);
        case "excluded_fact":
          return fact !== undefined && excludedFactStatuses.has(fact.status);
        case "hidden_fact":
          return fact?.status === "hidden" && resource.scope === "debrief_only";
        case "admitted_evidence":
          return evidence?.status === "admitted";
        case "unadmitted_evidence":
          return (
            evidence !== undefined &&
            unadmittedEvidenceStatuses.has(evidence.status)
          );
        case "excluded_evidence":
          return evidence?.status === "excluded";
        case "active_testimony":
          return testimony?.status === "active";
        case "stricken_testimony":
          return testimony?.status === "stricken";
        case "transcript_turn":
          return transcriptTurn?.status === "active";
        case "event":
          return eventIds.has(resource.resourceId);
        case "source_segment":
          return (
            resource.scope === "debrief_only" &&
            sourceSegmentIds.has(resource.resourceId) &&
            input.trialState.sourceSegmentIds.includes(resource.resourceId)
          );
        case "coaching_inference":
          return resource.scope === "debrief_only";
        case "prior_statement":
          return (
            resource.scope === "debrief_only" &&
            priorStatementIds.has(resource.resourceId)
          );
      }
    })();
    if (!valid) fail("CITATION_RESOURCE_BINDING_INVALID");
    if (
      resource.scope === "owner_record" &&
      ((FACT_KINDS.has(resource.kind) &&
        !ownerScope.factIds.has(resource.resourceId)) ||
        (EVIDENCE_KINDS.has(resource.kind) &&
          !ownerScope.evidenceIds.has(resource.resourceId)))
    ) {
      fail("CITATION_RESOURCE_SCOPE_INVALID");
    }
  }
}

const FACT_KINDS = new Set<ResourceKind>([
  "admitted_fact",
  "unadmitted_fact",
  "excluded_fact",
  "hidden_fact",
]);
const EVIDENCE_KINDS = new Set<ResourceKind>([
  "admitted_evidence",
  "unadmitted_evidence",
  "excluded_evidence",
]);
const TESTIMONY_KINDS = new Set<ResourceKind>([
  "active_testimony",
  "stricken_testimony",
]);

function permitted(
  resources: ResourceIndex,
  identifier: string,
  kinds: ReadonlySet<ResourceKind>,
  ownerOnly: boolean,
): boolean {
  const resource = matchingResource(resources, identifier, kinds);
  return (
    resource !== undefined &&
    (!ownerOnly || resource.scope === "owner_record")
  );
}

function filteredCitations(
  citations: CitationSet,
  resources: ResourceIndex,
): CitationSet {
  const keep = (ids: readonly string[], kinds: ReadonlySet<ResourceKind>) => {
    if (new Set(ids).size !== ids.length) {
      fail("DUPLICATE_CITATION_IDENTIFIER");
    }
    return ids.filter((identifier) => {
      const resource = matchingResource(resources, identifier, kinds);
      if (resource === undefined) fail("CITATION_RESOURCE_MISSING");
      return resource.scope === "owner_record";
    });
  };
  return {
    factIds: keep(citations.factIds, FACT_KINDS),
    evidenceIds: keep(citations.evidenceIds, EVIDENCE_KINDS),
    testimonyIds: keep(citations.testimonyIds, TESTIMONY_KINDS),
    eventIds: keep(citations.eventIds, new Set<ResourceKind>(["event"])),
    sourceSegmentIds: keep(
      citations.sourceSegmentIds,
      new Set<ResourceKind>(["source_segment"]),
    ),
  };
}

function derivedResourceTitle(
  input: CourtRecordsProjectorInput,
  resource: ResourceInput,
): string {
  switch (resource.kind) {
    case "admitted_fact":
    case "unadmitted_fact":
    case "excluded_fact":
    case "hidden_fact":
      return (
        input.trialState.facts[resource.resourceId]?.proposition ??
        fail("FACT_RESOURCE_MISSING")
      );
    case "admitted_evidence":
    case "unadmitted_evidence":
    case "excluded_evidence":
      return (
        input.trialState.evidence[resource.resourceId]?.name ??
        fail("EVIDENCE_RESOURCE_MISSING")
      );
    case "active_testimony":
    case "stricken_testimony":
      return "Testimony record";
    case "transcript_turn":
      return "Transcript turn";
    case "event":
      return "Trial event";
    case "source_segment":
      return "Source segment";
    case "prior_statement":
      return "Prior statement";
    case "coaching_inference":
      return "Coaching inference";
  }
}

function projectResource(
  input: CourtRecordsProjectorInput,
  resource: ResourceInput,
) {
  const label = RESOURCE_LABELS[resource.kind];
  return CourtRecordsCitationResourceSchema.parse({
    resourceId: resource.resourceId,
    kind: resource.kind,
    scope: resource.scope,
    title: derivedResourceTitle(input, resource),
    stratum: label.stratum,
    stratumLabel: label.label,
  });
}

function eventTree(
  events: readonly TrialEvent[],
  resources: ResourceIndex,
) {
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const eventByActionId = new Map(events.map((event) => [event.actionId, event]));
  const parentByEventId = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  for (const event of events) {
    const cause = event.causationId;
    const parent =
      cause === null ? undefined : eventById.get(cause) ?? eventByActionId.get(cause);
    if (parent !== undefined && parent.sequence >= event.sequence) {
      fail("EVENT_CAUSATION_ORDER_INVALID");
    }
    parentByEventId.set(event.eventId, parent?.eventId ?? null);
    if (parent !== undefined) {
      children.set(parent.eventId, [
        ...(children.get(parent.eventId) ?? []),
        event.eventId,
      ]);
    }
  }
  return {
    rootEventIds: events
      .filter((event) => parentByEventId.get(event.eventId) === null)
      .map((event) => event.eventId),
    nodes: events.map((event) => ({
      eventId: event.eventId,
      sequence: event.sequence,
      stateVersion: event.stateVersion,
      type: event.type,
      actor: event.actor,
      source: event.source,
      occurredAt: event.occurredAt,
      parentEventId: parentByEventId.get(event.eventId) ?? null,
      childEventIds: children.get(event.eventId) ?? [],
      responseId: event.responseId,
      interruptId: event.interruptId,
      citations: filteredCitations(event.citations, resources),
    })),
  };
}

function lifecycleProjection(
  events: readonly TrialEvent[],
  finalState: TrialStateV3,
  ownerScope: OwnerRecordScope,
) {
  const includedFactIds = ownerScope.factIds;
  const includedEvidenceIds = ownerScope.evidenceIds;
  const factTransitions = new Map<
    string,
    Array<{ eventId: string; sequence: number; status: string }>
  >();
  const evidenceTransitions = new Map<
    string,
    Array<{ eventId: string; sequence: number; status: string }>
  >();
  let prior: TrialStateV3 | null = null;
  for (const event of events) {
    const current = (prior === null
      ? initializeTrialFromEvent(event)
      : applyTrialEvent(prior, event)) as TrialStateV3;
    for (const [factId, fact] of Object.entries(current.facts)) {
      if (!includedFactIds.has(factId)) continue;
      if (prior?.facts[factId]?.status !== fact.status) {
        factTransitions.set(factId, [
          ...(factTransitions.get(factId) ?? []),
          { eventId: event.eventId, sequence: event.sequence, status: fact.status },
        ]);
      }
    }
    for (const [evidenceId, evidence] of Object.entries(current.evidence)) {
      if (!includedEvidenceIds.has(evidenceId)) continue;
      if (prior?.evidence[evidenceId]?.status !== evidence.status) {
        evidenceTransitions.set(evidenceId, [
          ...(evidenceTransitions.get(evidenceId) ?? []),
          {
            eventId: event.eventId,
            sequence: event.sequence,
            status: evidence.status,
          },
        ]);
      }
    }
    prior = current;
  }
  const facts = Object.values(finalState.facts)
    .filter((fact) => includedFactIds.has(fact.factId))
    .map((fact) => ({
      factId: fact.factId,
      title: fact.proposition,
      status: fact.status,
      visibility: fact.visibility,
      transitions: factTransitions.get(fact.factId) ?? [],
    }))
    .sort((left, right) => compareIds(left.factId, right.factId));
  const evidence = Object.values(finalState.evidence)
    .filter((item) => includedEvidenceIds.has(item.evidenceId))
    .map((item) => ({
      evidenceId: item.evidenceId,
      title: item.name,
      status: item.status,
      transitions: evidenceTransitions.get(item.evidenceId) ?? [],
    }))
    .sort((left, right) => compareIds(left.evidenceId, right.evidenceId));
  return { facts, evidence };
}

function interruptionProjection(events: readonly TrialEvent[]) {
  const interruptions = new Map<
    string,
    {
      interruptId: string;
      interruptedResponseId: string;
      objectionId: string | null;
      status: "active" | "cancelled" | "resolved" | "resumed";
      sourceEventId: string;
      lastEventId: string;
    }
  >();
  for (const event of events) {
    if (event.type === "BEGIN_INTERRUPTION") {
      interruptions.set(event.payload.interruptId, {
        interruptId: event.payload.interruptId,
        interruptedResponseId: event.payload.interruptedResponseId,
        objectionId: event.payload.objectionId,
        status: "active",
        sourceEventId: event.eventId,
        lastEventId: event.eventId,
      });
    } else if (event.type === "RESOLVE_INTERRUPTION") {
      const existing = interruptions.get(event.payload.interruptId);
      if (existing === undefined) fail("INTERRUPTION_HISTORY_INVALID");
      interruptions.set(event.payload.interruptId, {
        ...existing,
        status: event.payload.outcome === "cancel" ? "cancelled" : "resolved",
        lastEventId: event.eventId,
      });
    } else if (event.type === "RESUME_INTERRUPTED_SPEECH") {
      const existing = interruptions.get(event.payload.interruptId);
      if (
        existing === undefined ||
        existing.interruptedResponseId !== event.payload.interruptedResponseId
      ) {
        fail("INTERRUPTION_HISTORY_INVALID");
      }
      interruptions.set(event.payload.interruptId, {
        ...existing,
        status: "resumed",
        lastEventId: event.eventId,
      });
    }
  }
  return [...interruptions.values()];
}

type ModelTrace = CourtRecordsProjectorInput["modelCalls"][number]["trace"];
type TraceCitationField = keyof ModelTrace["acceptedCitations"];
type AllowedTraceCitations = Readonly<Record<TraceCitationField, ReadonlySet<string>>>;

const TRACE_CITATION_KINDS: Readonly<Record<TraceCitationField, ReadonlySet<ResourceKind>>> = {
  factIds: FACT_KINDS,
  evidenceIds: EVIDENCE_KINDS,
  testimonyIds: TESTIMONY_KINDS,
  eventIds: new Set<ResourceKind>(["event"]),
  sourceSegmentIds: new Set<ResourceKind>(["source_segment"]),
  priorStatementIds: new Set<ResourceKind>(["prior_statement"]),
};

function idSet(identifiers: readonly string[]): ReadonlySet<string> {
  return new Set(identifiers);
}

function emptyAllowedCitations(): AllowedTraceCitations {
  return {
    factIds: new Set(),
    evidenceIds: new Set(),
    testimonyIds: new Set(),
    eventIds: new Set(),
    sourceSegmentIds: new Set(),
    priorStatementIds: new Set(),
  };
}

function publicSourceSegmentIds(record: Readonly<{
  facts: readonly Readonly<{ sourceSegmentIds: readonly string[] }>[];
  evidence: readonly Readonly<{ sourceSegmentIds: readonly string[] }>[];
}>): string[] {
  return [
    ...record.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...record.evidence.flatMap((evidence) => evidence.sourceSegmentIds),
  ];
}

function publicEventIds(record: Readonly<{
  testimony: readonly Readonly<{ transcriptEventId: string }>[];
}>): string[] {
  return record.testimony.map((testimony) => testimony.transcriptEventId);
}

function expectedDebriefProceduralEventIds(
  state: TrialStateV3,
  events: readonly TrialEvent[],
): string[] {
  return [
    ...state.transcriptTurnIds.map(
      (turnId) =>
        state.transcriptTurns[turnId]?.sourceEventId ??
        fail("TRANSCRIPT_TURN_MISSING"),
    ),
    ...Object.values(state.objections).flatMap((objection) => [
      objection.sourceEventId,
      ...(objection.rulingEventId === null ? [] : [objection.rulingEventId]),
    ]),
    ...Object.values(state.settlementOffers).flatMap((offer) => [
      offer.sourceEventId,
      offer.lastEventId,
    ]),
    ...events.flatMap((event) =>
      event.type === "RENDER_VERDICT" ? [event.eventId] : [],
    ),
  ];
}

function reconstructedKnowledgeAudit(
  input: CourtRecordsProjectorInput,
  state: TrialStateV3,
  sourceEvents: readonly TrialEvent[],
  trace: ModelTrace,
): Readonly<{
  schemaVersion: string;
  viewHash: string;
  stateVersion: number;
  factCount: number;
  evidenceCount: number;
  testimonyCount: number;
  priorStatementCount: number;
  sourceSegmentCount: number;
  publicRecordEventCount: number;
  currentExchangeCount: number;
  allowedCitations: AllowedTraceCitations;
}> {
  if (trace.actorId === null) fail("MODEL_CALL_ACTOR_INVALID");
  const base = { caseGraph: input.caseGraph, trial: state };
  const uniqueCount = (...lists: readonly string[][]) =>
    new Set(lists.flat()).size;
  const finish = (
    view: Readonly<{ schemaVersion: string; stateVersion: number }>,
    counts: Readonly<{
      factCount: number;
      evidenceCount: number;
      testimonyCount: number;
      priorStatementCount: number;
      sourceSegmentCount: number;
      publicRecordEventCount: number;
      currentExchangeCount: number;
    }>,
    allowedCitations: AllowedTraceCitations,
  ) => ({
    schemaVersion: view.schemaVersion,
    viewHash: sha256Utf8(JSON.stringify(view)),
    stateVersion: view.stateVersion,
    ...counts,
    allowedCitations,
  });

  if (trace.task === "plan_opponent" || trace.task === "counsel_response") {
    const view =
      trace.task === "plan_opponent"
        ? buildOpponentPlannerKnowledgeView(base, trace.actorId)
        : buildOpponentCounselPublicKnowledgeView(base, trace.actorId);
    const sourceSegmentIds = publicSourceSegmentIds(view.publicRecord);
    return finish(
      view,
      {
        factCount: uniqueCount(
          view.counsel.facts.map((fact) => fact.factId),
          view.publicRecord.facts.map((fact) => fact.factId),
        ),
        evidenceCount: uniqueCount(
          view.counsel.evidence.map((evidence) => evidence.evidenceId),
          view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
        ),
        testimonyCount: view.publicRecord.testimony.length,
        priorStatementCount: 0,
        sourceSegmentCount: new Set(sourceSegmentIds).size,
        publicRecordEventCount: new Set(publicEventIds(view.publicRecord)).size,
        currentExchangeCount: view.currentExchange === null ? 0 : 1,
      },
      {
        factIds: idSet([
          ...view.counsel.facts.map((fact) => fact.factId),
          ...view.publicRecord.facts.map((fact) => fact.factId),
        ]),
        evidenceIds: idSet([
          ...view.counsel.evidence.map((evidence) => evidence.evidenceId),
          ...view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
        ]),
        testimonyIds: idSet(
          view.publicRecord.testimony.map((testimony) => testimony.testimonyId),
        ),
        eventIds: new Set(),
        sourceSegmentIds:
          trace.task === "plan_opponent" ? idSet(sourceSegmentIds) : new Set(),
        priorStatementIds: new Set(),
      },
    );
  }

  const view = buildKnowledgeView(base, trace.actorId);
  if (trace.task === "witness_answer") {
    if (view.actorRole !== "witness") fail("MODEL_CALL_ACTOR_INVALID");
    const evidenceIds = [
      ...view.witness.admittedSeenEvidence.map((evidence) => evidence.evidenceId),
      ...view.presentedEvidence.map((evidence) => evidence.evidenceId),
    ];
    const sourceSegmentIds = publicSourceSegmentIds(view.publicRecord);
    return finish(
      view,
      {
        factCount: view.witness.facts.length,
        evidenceCount: new Set(evidenceIds).size,
        testimonyCount: view.publicRecord.testimony.length,
        priorStatementCount: view.witness.priorStatements.length,
        sourceSegmentCount: new Set(sourceSegmentIds).size,
        publicRecordEventCount: new Set(publicEventIds(view.publicRecord)).size,
        currentExchangeCount: view.currentExchange === null ? 0 : 1,
      },
      {
        ...emptyAllowedCitations(),
        factIds: idSet(view.witness.facts.map((fact) => fact.factId)),
        evidenceIds: idSet(evidenceIds),
        priorStatementIds: idSet(
          view.witness.priorStatements.map(
            (statement) => statement.priorStatementId,
          ),
        ),
      },
    );
  }

  if (trace.task === "judge_response" || trace.task === "resolve_objection") {
    if (view.actorRole !== "judge") fail("MODEL_CALL_ACTOR_INVALID");
    const requestView =
      trace.task === "judge_response"
        ? {
            ...view,
            publicRecord: {
              ...view.publicRecord,
              facts: view.publicRecord.facts.map((fact) => ({
                ...fact,
                sourceSegmentIds: [],
              })),
              evidence: view.publicRecord.evidence.map((evidence) => ({
                ...evidence,
                sourceSegmentIds: [],
              })),
            },
          }
        : view;
    const sourceSegmentIds = publicSourceSegmentIds(requestView.publicRecord);
    const responseQuestionId =
      trace.responseId === null
        ? null
        : state.pendingResponses[trace.responseId]?.questionId ?? null;
    const questionEventIds =
      trace.task === "resolve_objection"
        ? sourceEvents.flatMap((event) =>
            event.type === "ASK_QUESTION" &&
            event.payload.questionId === responseQuestionId
              ? [event.eventId]
              : [],
          )
        : [];
    return finish(
      requestView,
      {
        factCount: requestView.publicRecord.facts.length,
        evidenceCount: requestView.publicRecord.evidence.length,
        testimonyCount: requestView.publicRecord.testimony.length,
        priorStatementCount: 0,
        sourceSegmentCount: new Set(sourceSegmentIds).size,
        publicRecordEventCount: new Set(
          publicEventIds(requestView.publicRecord),
        ).size,
        currentExchangeCount: requestView.currentExchange === null ? 0 : 1,
      },
      {
        factIds: idSet(
          requestView.publicRecord.facts.map((fact) => fact.factId),
        ),
        evidenceIds: idSet(
          requestView.publicRecord.evidence.map(
            (evidence) => evidence.evidenceId,
          ),
        ),
        testimonyIds: idSet(
          requestView.publicRecord.testimony.map(
            (testimony) => testimony.testimonyId,
          ),
        ),
        eventIds: idSet(questionEventIds),
        sourceSegmentIds: idSet(sourceSegmentIds),
        priorStatementIds: new Set(),
      },
    );
  }

  if (trace.task === "jury_deliberation") {
    if (view.actorRole !== "jury") fail("MODEL_CALL_ACTOR_INVALID");
    const sourceSegmentIds = publicSourceSegmentIds(view.publicRecord);
    return finish(
      view,
      {
        factCount: view.publicRecord.facts.length,
        evidenceCount: view.publicRecord.evidence.length,
        testimonyCount: view.publicRecord.testimony.length,
        priorStatementCount: 0,
        sourceSegmentCount: new Set(sourceSegmentIds).size,
        publicRecordEventCount: new Set(publicEventIds(view.publicRecord)).size,
        currentExchangeCount: 0,
      },
      {
        ...emptyAllowedCitations(),
        factIds: idSet(view.publicRecord.facts.map((fact) => fact.factId)),
        evidenceIds: idSet(
          view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
        ),
        testimonyIds: idSet(
          view.publicRecord.testimony.map((testimony) => testimony.testimonyId),
        ),
      },
    );
  }

  if (trace.task === "evaluate_settlement") {
    if (view.actorRole !== "opposing_counsel") {
      fail("MODEL_CALL_ACTOR_INVALID");
    }
    const sourceSegmentIds = publicSourceSegmentIds(view.publicRecord);
    return finish(
      view,
      {
        factCount: uniqueCount(
          view.counsel.facts.map((fact) => fact.factId),
          view.publicRecord.facts.map((fact) => fact.factId),
          view.currentExchange?.factIds ?? [],
        ),
        evidenceCount: uniqueCount(
          view.counsel.evidence.map((evidence) => evidence.evidenceId),
          view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
          view.currentExchange?.evidenceIds ?? [],
        ),
        testimonyCount: view.publicRecord.testimony.length,
        priorStatementCount: 0,
        sourceSegmentCount: new Set(sourceSegmentIds).size,
        publicRecordEventCount: new Set(publicEventIds(view.publicRecord)).size,
        currentExchangeCount: view.currentExchange === null ? 0 : 1,
      },
      {
        factIds: idSet([
          ...view.counsel.facts.map((fact) => fact.factId),
          ...view.publicRecord.facts.map((fact) => fact.factId),
          ...(view.currentExchange?.factIds ?? []),
        ]),
        evidenceIds: idSet([
          ...view.counsel.evidence.map((evidence) => evidence.evidenceId),
          ...view.publicRecord.evidence.map((evidence) => evidence.evidenceId),
          ...(view.currentExchange?.evidenceIds ?? []),
        ]),
        testimonyIds: idSet(
          view.publicRecord.testimony.map((testimony) => testimony.testimonyId),
        ),
        eventIds: new Set(),
        sourceSegmentIds: idSet(sourceSegmentIds),
        priorStatementIds: new Set(),
      },
    );
  }

  if (trace.task === "generate_debrief") {
    if (view.actorRole !== "debrief") fail("MODEL_CALL_ACTOR_INVALID");
    const { strata } = view;
    const admitted = strata.admittedRecord.record;
    const sourceSegmentIds = [
      ...admitted.facts.flatMap((fact) => fact.sourceSegmentIds),
      ...admitted.evidence.flatMap((evidence) => evidence.sourceSegmentIds),
      ...strata.hiddenAuthoringTruth.facts.flatMap(
        (fact) => fact.sourceSegmentIds,
      ),
    ];
    return finish(
      view,
      {
        factCount: uniqueCount(
          admitted.facts.map((fact) => fact.factId),
          strata.unadmittedRecord.facts.map((fact) => fact.factId),
          strata.excludedOrStricken.facts.map((fact) => fact.factId),
          strata.hiddenAuthoringTruth.facts.map((fact) => fact.factId),
        ),
        evidenceCount: uniqueCount(
          admitted.evidence.map((evidence) => evidence.evidenceId),
          strata.unadmittedRecord.evidence.map(
            (evidence) => evidence.evidenceId,
          ),
          strata.excludedOrStricken.evidence.map(
            (evidence) => evidence.evidenceId,
          ),
        ),
        testimonyCount: uniqueCount(
          admitted.testimony.map((testimony) => testimony.testimonyId),
          strata.excludedOrStricken.testimony.map(
            (testimony) => testimony.testimonyId,
          ),
        ),
        priorStatementCount: 0,
        sourceSegmentCount: new Set(sourceSegmentIds).size,
        publicRecordEventCount: new Set(
          expectedDebriefProceduralEventIds(state, sourceEvents),
        ).size,
        currentExchangeCount: 0,
      },
      {
        factIds: idSet([
          ...admitted.facts.map((fact) => fact.factId),
          ...strata.unadmittedRecord.facts.map((fact) => fact.factId),
          ...strata.excludedOrStricken.facts.map((fact) => fact.factId),
          ...strata.hiddenAuthoringTruth.facts.map((fact) => fact.factId),
        ]),
        evidenceIds: idSet([
          ...admitted.evidence.map((evidence) => evidence.evidenceId),
          ...strata.unadmittedRecord.evidence.map(
            (evidence) => evidence.evidenceId,
          ),
          ...strata.excludedOrStricken.evidence.map(
            (evidence) => evidence.evidenceId,
          ),
        ]),
        testimonyIds: idSet([
          ...admitted.testimony.map((testimony) => testimony.testimonyId),
          ...strata.excludedOrStricken.testimony.map(
            (testimony) => testimony.testimonyId,
          ),
        ]),
        eventIds: idSet(
          state.transcriptTurnIds.flatMap((turnId) => {
            const turn = state.transcriptTurns[turnId];
            return turn?.status === "active" ? [turn.sourceEventId] : [];
          }),
        ),
        sourceSegmentIds: idSet(sourceSegmentIds),
        priorStatementIds: new Set(),
      },
    );
  }

  fail("MODEL_CALL_TASK_INVALID");
}

function expectedTraceRole(task: ModelTrace["task"]): ModelTrace["actorRole"] {
  switch (task) {
    case "plan_opponent":
    case "counsel_response":
    case "evaluate_settlement":
      return "counsel";
    case "witness_answer":
      return "witness";
    case "judge_response":
    case "resolve_objection":
      return "judge";
    case "jury_deliberation":
      return "jury";
    case "generate_debrief":
      return "debrief";
    case "compile_case":
      return null;
  }
}

function taskAcceptsEvent(task: ModelTrace["task"], event: TrialEvent): boolean {
  switch (task) {
    case "plan_opponent":
      return event.type === "UPDATE_OPPOSING_STRATEGY";
    case "witness_answer":
      return event.type === "ANSWER_QUESTION";
    case "counsel_response":
      return ["ASK_QUESTION", "MOVE_TO_STRIKE", "END_EXAMINATION", "GIVE_CLOSING"].includes(
        event.type,
      );
    case "judge_response":
      return event.type === "STRIKE_TESTIMONY" || event.type === "DENY_STRIKE_MOTION";
    case "jury_deliberation":
      return event.type === "DELIBERATE";
    case "resolve_objection":
      return event.type === "RULE_ON_OBJECTION";
    case "evaluate_settlement":
      return (
        event.type === "COUNTER_SETTLEMENT" ||
        event.type === "ACCEPT_SETTLEMENT" ||
        event.type === "REJECT_SETTLEMENT"
      );
    case "generate_debrief":
      return event.type === "GENERATE_DEBRIEF";
    case "compile_case":
      return false;
  }
}

function expectedInputEventIds(
  trace: ModelTrace,
  state: TrialStateV3,
  sourceEvents: readonly TrialEvent[],
): string[] {
  const head = trace.expectedLastEventId ?? fail("MODEL_CALL_HEAD_INVALID");
  if (trace.task === "witness_answer") {
    const responseId = trace.responseId ?? fail("MODEL_CALL_RESPONSE_INVALID");
    const response = state.pendingResponses[responseId];
    if (
      response === undefined ||
      response.actorId !== trace.actorId ||
      response.questionId === null
    ) {
      fail("MODEL_CALL_RESPONSE_INVALID");
    }
    const questionEvent = sourceEvents.find(
      (event) =>
        event.type === "ASK_QUESTION" &&
        event.payload.questionId === response.questionId,
    );
    if (questionEvent === undefined) fail("MODEL_CALL_INPUT_EVENT_INVALID");
    return sortedUniqueIds([questionEvent.eventId, head]);
  }
  if (trace.task === "resolve_objection") {
    const responseId = trace.responseId ?? fail("MODEL_CALL_RESPONSE_INVALID");
    const objection = Object.values(state.objections).find(
      (candidate) =>
        candidate.interruptedResponseId === responseId &&
        candidate.status === "pending",
    );
    const interruption = state.activeInterruption;
    if (
      objection === undefined ||
      interruption === null ||
      interruption.interruptedResponseId !== responseId ||
      interruption.objectionId !== objection.objectionId
    ) {
      fail("MODEL_CALL_RESPONSE_INVALID");
    }
    const questionEvent = sourceEvents.find(
      (event) =>
        event.type === "ASK_QUESTION" &&
        event.payload.questionId === objection.questionId,
    );
    if (questionEvent === undefined) fail("MODEL_CALL_INPUT_EVENT_INVALID");
    return sortedUniqueIds([
      head,
      objection.sourceEventId,
      questionEvent.eventId,
      interruption.sourceEventId,
    ]);
  }
  if (trace.responseId !== null) fail("MODEL_CALL_RESPONSE_INVALID");
  return [head];
}

function actorMatchesTask(
  trace: ModelTrace,
  state: TrialStateV3,
): boolean {
  const actor = trace.actorId === null ? undefined : state.actors[trace.actorId];
  if (actor === undefined || trace.actorRole !== expectedTraceRole(trace.task)) {
    return false;
  }
  switch (trace.task) {
    case "plan_opponent":
    case "counsel_response":
    case "evaluate_settlement":
      return actor.role === "opposing_counsel" && actor.side === "opposing";
    case "witness_answer":
      return actor.role === "witness";
    case "judge_response":
    case "resolve_objection":
      return actor.role === "judge";
    case "jury_deliberation":
      return actor.role === "jury";
    case "generate_debrief":
      return actor.role === "debrief_coach";
    case "compile_case":
      return false;
  }
}

function sameCitationCore(left: ModelTrace["acceptedCitations"], right: CitationSet): boolean {
  return (
    stableJson(left.factIds) === stableJson(right.factIds) &&
    stableJson(left.evidenceIds) === stableJson(right.evidenceIds) &&
    stableJson(left.testimonyIds) === stableJson(right.testimonyIds) &&
    stableJson(left.eventIds) === stableJson(right.eventIds) &&
    stableJson(left.sourceSegmentIds) === stableJson(right.sourceSegmentIds)
  );
}

function validateAcceptedTraceBinding(
  trace: ModelTrace,
  event: TrialEvent,
  events: readonly TrialEvent[],
): void {
  const metadata = event.modelMetadata;
  const attempt = trace.attempts.find(
    (candidate) => candidate.attempt === trace.acceptedAttempt,
  );
  const usageMatches =
    trace.usage === null
      ? metadata?.inputTokens === null && metadata.outputTokens === null
      : metadata?.inputTokens === trace.usage.inputTokens &&
        metadata.outputTokens === trace.usage.outputTokens;
  if (
    trace.status !== "accepted" ||
    trace.outputHash === null ||
    attempt?.status !== "accepted" ||
    attempt.outputHash !== trace.outputHash ||
    event.actionId !== trace.committedActionId ||
    event.source !== "ai" ||
    !taskAcceptsEvent(trace.task, event) ||
    event.actor.actorId !== trace.actorId ||
    event.responseId !== trace.responseId ||
    metadata === null ||
    metadata.model !== trace.model ||
    metadata.requestId !== attempt.providerRequestId ||
    metadata.promptVersion !== trace.promptVersion ||
    metadata.schemaVersion !== trace.outputSchemaVersion ||
    metadata.latencyMs !== trace.latencyMs ||
    metadata.retryCount !== trace.retryCount ||
    metadata.validationFailureCount !== trace.validationFailureCount ||
    metadata.estimatedCostUsd !== trace.estimatedCostUsd ||
    !usageMatches
  ) {
    fail("MODEL_CALL_COMMIT_BINDING_INVALID");
  }
  if (
    trace.task === "witness_answer" &&
    !sameCitationCore(trace.acceptedCitations, event.citations)
  ) {
    fail("MODEL_CALL_CITATION_BINDING_INVALID");
  }
  if (trace.task === "jury_deliberation") {
    const verdicts = events.filter(
      (
        candidate,
      ): candidate is Extract<TrialEvent, { type: "RENDER_VERDICT" }> =>
        candidate.type === "RENDER_VERDICT" && candidate.sequence > event.sequence,
    );
    if (
      verdicts.length !== 1 ||
      !sameCitationCore(trace.acceptedCitations, verdicts[0].payload.citations)
    ) {
      fail("MODEL_CALL_CITATION_BINDING_INVALID");
    }
  }
}

function validateTraceCitations(
  trace: ModelTrace,
  allowed: AllowedTraceCitations,
  resources: ResourceIndex,
): void {
  for (const field of Object.keys(TRACE_CITATION_KINDS) as TraceCitationField[]) {
    for (const identifier of trace.acceptedCitations[field]) {
      if (
        !allowed[field].has(identifier) ||
        !permitted(resources, identifier, TRACE_CITATION_KINDS[field], false)
      ) {
        fail("MODEL_CALL_CITATION_RESOURCE_INVALID");
      }
    }
  }
}

function projectTraceCitations(
  trace: ModelTrace,
  resources: ResourceIndex,
) {
  const keep = (ids: readonly string[], kinds: ReadonlySet<ResourceKind>) =>
    ids.filter((identifier) => permitted(resources, identifier, kinds, true));
  return {
    factIds: keep(trace.acceptedCitations.factIds, FACT_KINDS),
    evidenceIds: keep(trace.acceptedCitations.evidenceIds, EVIDENCE_KINDS),
    testimonyIds: keep(trace.acceptedCitations.testimonyIds, TESTIMONY_KINDS),
    eventIds: keep(trace.acceptedCitations.eventIds, TRACE_CITATION_KINDS.eventIds),
    sourceSegmentIds: keep(
      trace.acceptedCitations.sourceSegmentIds,
      TRACE_CITATION_KINDS.sourceSegmentIds,
    ),
    priorStatementIds: keep(
      trace.acceptedCitations.priorStatementIds,
      TRACE_CITATION_KINDS.priorStatementIds,
    ),
  };
}

function projectModelCalls(
  input: CourtRecordsProjectorInput,
  events: readonly TrialEvent[],
  resources: ResourceIndex,
) {
  uniqueRows(input.modelCalls, (row) => row.trace.callId, "DUPLICATE_MODEL_CALL");
  if (
    events.some(
      (event) =>
        (event.source === "ai") !== (event.modelMetadata !== null),
    )
  ) {
    fail("MODEL_CALL_COVERAGE_INVALID");
  }
  const generatedEvents = events.filter((event) => event.source === "ai");
  if (generatedEvents.some((event) => event.modelMetadata === null)) {
    fail("MODEL_CALL_COVERAGE_INVALID");
  }
  const acceptedTraces = input.modelCalls.filter(
    ({ trace }) => trace.status === "accepted",
  );
  const acceptedEventIds = acceptedTraces.map(({ trace }) => {
    if (trace.committedEventId === null) {
      fail("MODEL_CALL_COVERAGE_INVALID");
    }
    return trace.committedEventId;
  });
  if (
    new Set(acceptedEventIds).size !== acceptedEventIds.length ||
    acceptedEventIds.length !== generatedEvents.length ||
    generatedEvents.some((event) => !acceptedEventIds.includes(event.eventId))
  ) {
    fail("MODEL_CALL_COVERAGE_INVALID");
  }
  const eventsById = new Map(events.map((event) => [event.eventId, event]));
  return input.modelCalls
    .map(({ trace }) => {
      if (
        trace.task === "compile_case" ||
        trace.status === "in_progress" ||
        trace.expectedStateVersion === null ||
        trace.expectedStateVersion < 1 ||
        trace.expectedStateVersion > events.length ||
        trace.expectedStateVersion !== trace.knowledgeScope.stateVersion
      ) {
        fail("MODEL_CALL_HEAD_INVALID");
      }
      const sourceEvents = events.slice(0, trace.expectedStateVersion);
      const expectedHead = sourceEvents.at(-1)?.eventId ?? null;
      if (expectedHead !== trace.expectedLastEventId) {
        fail("MODEL_CALL_HEAD_INVALID");
      }
      let sourceState: TrialStateV3;
      try {
        sourceState = reduceTrial(sourceEvents) as TrialStateV3;
      } catch {
        fail("MODEL_CALL_HEAD_INVALID");
      }
      if (!actorMatchesTask(trace, sourceState)) {
        fail("MODEL_CALL_ACTOR_INVALID");
      }
      if (
        stableJson(trace.inputEventIds) !==
        stableJson(expectedInputEventIds(trace, sourceState, sourceEvents))
      ) {
        fail("MODEL_CALL_INPUT_EVENT_INVALID");
      }
      const audit = reconstructedKnowledgeAudit(
        input,
        sourceState,
        sourceEvents,
        trace,
      );
      const expectedKnowledge = {
        knowledgeSchemaVersion: audit.schemaVersion,
        knowledgeViewHash: audit.viewHash,
        stateVersion: audit.stateVersion,
        factCount: audit.factCount,
        evidenceCount: audit.evidenceCount,
        testimonyCount: audit.testimonyCount,
        priorStatementCount: audit.priorStatementCount,
        sourceSegmentCount: audit.sourceSegmentCount,
        publicRecordEventCount: audit.publicRecordEventCount,
        currentExchangeCount: audit.currentExchangeCount,
      };
      if (stableJson(trace.knowledgeScope) !== stableJson(expectedKnowledge)) {
        fail("MODEL_CALL_KNOWLEDGE_INVALID");
      }
      validateTraceCitations(trace, audit.allowedCitations, resources);

      if (trace.status === "accepted") {
        if (trace.committedActionId === null || trace.committedEventId === null) {
          fail("MODEL_CALL_COMMIT_BINDING_INVALID");
        }
        const event = eventsById.get(trace.committedEventId);
        if (
          event === undefined ||
          event.stateVersion !== trace.expectedStateVersion + 1 ||
          event.actionId !== trace.committedActionId
        ) {
          fail("MODEL_CALL_COMMIT_BINDING_INVALID");
        }
        validateAcceptedTraceBinding(trace, event, events);
      } else if (
        trace.committedActionId !== null ||
        trace.committedEventId !== null ||
        trace.outputHash !== null ||
        trace.acceptedCitationCount !== 0
      ) {
        fail("MODEL_CALL_TERMINAL_BINDING_INVALID");
      }
      const projectedCitations = projectTraceCitations(trace, resources);
      const projectedCitationCount = Object.values(projectedCitations).reduce(
        (total, identifiers) => total + identifiers.length,
        0,
      );
      return {
        callId: trace.callId,
        actorId: trace.actorId,
        actorRole: trace.actorRole,
        callClass: trace.callClass,
        task: trace.task,
        status: trace.status,
        provider: trace.provider,
        providerProtocolVersion: trace.providerProtocolVersion,
        model: trace.model,
        promptVersion: trace.promptVersion,
        outputSchemaVersion: trace.outputSchemaVersion,
        expectedStateVersion: trace.expectedStateVersion,
        expectedLastEventId: trace.expectedLastEventId,
        knowledgeScope: {
          integrity: "verified" as const,
          schemaVersion: trace.knowledgeScope.knowledgeSchemaVersion,
          stateVersion: trace.knowledgeScope.stateVersion,
          factCount: trace.knowledgeScope.factCount,
          evidenceCount: trace.knowledgeScope.evidenceCount,
          testimonyCount: trace.knowledgeScope.testimonyCount,
          priorStatementCount: trace.knowledgeScope.priorStatementCount,
          sourceSegmentCount: trace.knowledgeScope.sourceSegmentCount,
          publicRecordEventCount: trace.knowledgeScope.publicRecordEventCount,
          currentExchangeCount: trace.knowledgeScope.currentExchangeCount,
        },
        startedAt: trace.startedAt,
        completedAt: trace.completedAt,
        latencyMs: trace.latencyMs,
        retryCount: trace.retryCount,
        validationFailureCount: trace.validationFailureCount,
        estimatedCostUsd: trace.estimatedCostUsd,
        usage: trace.usage,
        acceptedCitationCount: trace.acceptedCitationCount,
        visibleCitationCount: projectedCitationCount,
        restrictedCitationCount:
          trace.acceptedCitationCount - projectedCitationCount,
        acceptedCitations: projectedCitations,
        safeFailureCode: trace.safeFailureCode,
        attempts: trace.attempts.map((attempt) => ({
          attempt: attempt.attempt,
          mode: attempt.mode,
          status: attempt.status,
          latencyMs: attempt.latencyMs,
          firstStructuredDeltaMs: attempt.firstStructuredDeltaMs,
          usage: attempt.usage,
          validationIssueCodes: attempt.validationIssueCodes,
          safeErrorCode: attempt.safeErrorCode,
        })),
      };
    })
    .sort(
      (left, right) =>
        Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
        compareIds(left.callId, right.callId),
    );
}

function debriefCitationSets(
  output: DebriefGeneratorModelOutput,
): DebriefCitationSet[] {
  const sets = [output.overallAssessment.citations];
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
    sets.push(...output[field].map((point) => point.citations));
  }
  sets.push(
    ...output.improvedClosing.segments.map((segment) => segment.citations),
  );
  return sets;
}

function uniqueIdentifierCount(...lists: readonly string[][]): number {
  return new Set(lists.flat()).size;
}

function debriefProceduralEventIds(request: DebriefGeneratorRequest): string[] {
  return [
    ...request.transcript.map(({ sourceEventId }) => sourceEventId),
    ...request.procedure.objections.flatMap((objection) => [
      objection.sourceEventId,
      ...(objection.rulingEventId === null ? [] : [objection.rulingEventId]),
    ]),
    ...request.procedure.settlementOffers.flatMap((offer) => [
      offer.sourceEventId,
      offer.lastEventId,
    ]),
    ...(request.procedure.verdict === null
      ? []
      : [request.procedure.verdict.sourceEventId]),
  ];
}

function buildDebriefValidationRequest(
  input: CourtRecordsProjectorInput,
  events: readonly TrialEvent[],
  artifact: NonNullable<CourtRecordsProjectorInput["finalDebriefArtifact"]>,
): DebriefGeneratorRequest {
  let sourceState: TrialStateV3;
  try {
    sourceState = reduceTrial(
      events.slice(0, artifact.sourceStateVersion),
    ) as TrialStateV3;
  } catch {
    fail("DEBRIEF_SOURCE_STATE_INVALID");
  }
  const coaches = Object.values(sourceState.actors).filter(
    (actor) => actor.role === "debrief_coach" && actor.side === "neutral",
  );
  const coach = coaches[0];
  if (
    coaches.length !== 1 ||
    coach === undefined ||
    sourceState.phase !== "debrief" ||
    sourceState.debriefId !== null ||
    (sourceState.status !== "settled" && sourceState.verdictId === null)
  ) {
    fail("DEBRIEF_SOURCE_STATE_INVALID");
  }
  let knowledgeView: ReturnType<typeof buildKnowledgeView>;
  try {
    knowledgeView = buildKnowledgeView(
      { caseGraph: input.caseGraph, trial: sourceState },
      coach.actorId,
    );
  } catch {
    fail("DEBRIEF_KNOWLEDGE_INVALID");
  }
  if (knowledgeView.actorRole !== "debrief") {
    fail("DEBRIEF_KNOWLEDGE_INVALID");
  }
  const sourceEvents = events.slice(0, artifact.sourceStateVersion);
  const closingTurnIds = sourceEvents.flatMap((event) =>
    event.type === "GIVE_CLOSING" ? [event.payload.turnId] : [],
  );
  if (
    closingTurnIds.length !== sourceState.closingSides.length ||
    closingTurnIds.some(
      (turnId) => sourceState.transcriptTurns[turnId] === undefined,
    )
  ) {
    fail("DEBRIEF_PROCEDURE_INVALID");
  }
  const verdictEvents = sourceEvents.filter(
    (event): event is Extract<TrialEvent, { type: "RENDER_VERDICT" }> =>
      event.type === "RENDER_VERDICT",
  );
  const verdictEvent = verdictEvents[0];
  if (
    (sourceState.verdictId === null && verdictEvents.length !== 0) ||
    (sourceState.verdictId !== null &&
      (verdictEvents.length !== 1 ||
        verdictEvent?.payload.verdictId !== sourceState.verdictId))
  ) {
    fail("DEBRIEF_PROCEDURE_INVALID");
  }
  return DebriefGeneratorRequestSchema.parse({
    schemaVersion: "debrief-generator.request.v1",
    callId: artifact.callId,
    trialId: sourceState.trialId,
    expectedStateVersion: artifact.sourceStateVersion,
    expectedLastEventId: artifact.sourceLastEventId,
    actorId: coach.actorId,
    knowledgeView,
    transcript: sourceState.transcriptTurnIds.map((turnId) => {
      const turn =
        sourceState.transcriptTurns[turnId] ?? fail("TRANSCRIPT_TURN_MISSING");
      return {
        turnId: turn.turnId,
        actorId: turn.actor.actorId,
        actorRole: turn.actor.role,
        text: turn.text,
        testimonyId: turn.testimonyId,
        status: turn.status,
        sourceEventId: turn.sourceEventId,
        citations: turn.citations,
      };
    }),
    procedure: {
      objections: Object.values(sourceState.objections)
        .sort(
          (left, right) =>
            compareIds(left.sourceEventId, right.sourceEventId) ||
            compareIds(left.objectionId, right.objectionId),
        )
        .map((objection) => ({
          objectionId: objection.objectionId,
          questionId: objection.questionId,
          objectorActorId: objection.objectorActorId,
          ground: objection.ground,
          status: objection.status,
          remedy: objection.remedy,
          rulingReason: objection.rulingReason,
          sourceEventId: objection.sourceEventId,
          rulingEventId: objection.rulingEventId,
        })),
      settlementOffers: Object.values(sourceState.settlementOffers)
        .sort(
          (left, right) =>
            compareIds(left.sourceEventId, right.sourceEventId) ||
            compareIds(left.offerId, right.offerId),
        )
        .map((offer) => ({
          offerId: offer.offerId,
          parentOfferId: offer.parentOfferId,
          proposedByPartyId: offer.proposedByPartyId,
          recipientPartyIds: offer.recipientPartyIds,
          amount: offer.terms.amount,
          currency: offer.terms.currency,
          nonMonetaryTerms: offer.terms.nonMonetaryTerms,
          summary: offer.terms.summary,
          status: offer.status,
          sourceEventId: offer.sourceEventId,
          lastEventId: offer.lastEventId,
        })),
      closingTurnIds,
      restedSides: sourceState.restedSides,
      deliberated: sourceState.deliberated,
      verdict:
        verdictEvent === undefined
          ? null
          : {
              verdictId: verdictEvent.payload.verdictId,
              decision: verdictEvent.payload.decision,
              sourceEventId: verdictEvent.eventId,
              citations: verdictEvent.payload.citations,
            },
    },
  });
}

function debriefTraceScopeMatches(
  trace: CourtRecordsProjectorInput["modelCalls"][number]["trace"],
  request: DebriefGeneratorRequest,
): boolean {
  const { strata } = request.knowledgeView;
  const admitted = strata.admittedRecord.record;
  const sourceSegmentIds = [
    ...admitted.facts.flatMap((fact) => fact.sourceSegmentIds),
    ...admitted.evidence.flatMap((evidence) => evidence.sourceSegmentIds),
    ...strata.hiddenAuthoringTruth.facts.flatMap(
      (fact) => fact.sourceSegmentIds,
    ),
  ];
  return (
    trace.inputEventIds.length === 1 &&
    trace.inputEventIds[0] === request.expectedLastEventId &&
    trace.actorId === request.actorId &&
    trace.actorRole === "debrief" &&
    trace.knowledgeScope.knowledgeSchemaVersion ===
      request.knowledgeView.schemaVersion &&
    trace.knowledgeScope.knowledgeViewHash ===
      sha256Utf8(JSON.stringify(request.knowledgeView)) &&
    trace.knowledgeScope.stateVersion === request.knowledgeView.stateVersion &&
    trace.knowledgeScope.factCount ===
      uniqueIdentifierCount(
        admitted.facts.map(({ factId }) => factId),
        strata.unadmittedRecord.facts.map(({ factId }) => factId),
        strata.excludedOrStricken.facts.map(({ factId }) => factId),
        strata.hiddenAuthoringTruth.facts.map(({ factId }) => factId),
      ) &&
    trace.knowledgeScope.evidenceCount ===
      uniqueIdentifierCount(
        admitted.evidence.map(({ evidenceId }) => evidenceId),
        strata.unadmittedRecord.evidence.map(({ evidenceId }) => evidenceId),
        strata.excludedOrStricken.evidence.map(
          ({ evidenceId }) => evidenceId,
        ),
      ) &&
    trace.knowledgeScope.testimonyCount ===
      uniqueIdentifierCount(
        admitted.testimony.map(({ testimonyId }) => testimonyId),
        strata.excludedOrStricken.testimony.map(
          ({ testimonyId }) => testimonyId,
        ),
      ) &&
    trace.knowledgeScope.priorStatementCount === 0 &&
    trace.knowledgeScope.sourceSegmentCount ===
      new Set(sourceSegmentIds).size &&
    trace.knowledgeScope.publicRecordEventCount ===
      new Set(debriefProceduralEventIds(request)).size &&
    trace.knowledgeScope.currentExchangeCount === 0
  );
}

const DEBRIEF_KIND: Readonly<Record<keyof DebriefCitationSet, ResourceKind>> = {
  admittedFactIds: "admitted_fact",
  admittedEvidenceIds: "admitted_evidence",
  activeTestimonyIds: "active_testimony",
  transcriptTurnIds: "transcript_turn",
  unadmittedFactIds: "unadmitted_fact",
  unadmittedEvidenceIds: "unadmitted_evidence",
  excludedFactIds: "excluded_fact",
  excludedEvidenceIds: "excluded_evidence",
  strickenTestimonyIds: "stricken_testimony",
  hiddenFactIds: "hidden_fact",
  hiddenSourceSegmentIds: "source_segment",
  coachingInferenceIds: "coaching_inference",
};

function projectFinalDebrief(
  input: CourtRecordsProjectorInput,
  events: readonly TrialEvent[],
  resources: ResourceIndex,
) {
  const artifact = input.finalDebriefArtifact;
  if (artifact === null) {
    if (input.trialState.debriefId !== null) fail("DEBRIEF_ARTIFACT_MISSING");
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(artifact.artifactJson) as unknown;
  } catch {
    fail("DEBRIEF_JSON_INVALID");
  }
  const parsedOutput = DebriefGeneratorModelOutputSchema.safeParse(parsedJson);
  if (!parsedOutput.success) fail("DEBRIEF_SCHEMA_INVALID");
  const output = parsedOutput.data;
  if (
    artifact.artifactJson !== JSON.stringify(output) ||
    artifact.artifactHash !== sha256Utf8(JSON.stringify(output)) ||
    artifact.artifactSchemaVersion !== output.schemaVersion
  ) {
    fail("DEBRIEF_HASH_INVALID");
  }
  const request = buildDebriefValidationRequest(input, events, artifact);
  const validation = validateDebriefGeneratorOutput(request, output);
  if (!validation.accepted) fail("DEBRIEF_OUTPUT_INVALID");
  const sourceEventIdByTurnId = new Map(
    request.transcript.map(({ turnId, sourceEventId }) => [
      turnId,
      sourceEventId,
    ]),
  );
  let expectedTraceCitations: ReturnType<
    typeof debriefGeneratorOutputCitations
  >;
  try {
    expectedTraceCitations = debriefGeneratorOutputCitations(
      output,
      debriefGeneratorCitedTranscriptTurnIds(output).map((turnId) => {
        const sourceEventId = sourceEventIdByTurnId.get(turnId);
        if (sourceEventId === undefined) {
          fail("DEBRIEF_TRACE_CITATIONS_INVALID");
        }
        return { turnId, sourceEventId };
      }),
    );
  } catch {
    fail("DEBRIEF_TRACE_CITATIONS_INVALID");
  }
  const event = events[artifact.committedStateVersion - 1];
  const sourceEvent = events[artifact.sourceStateVersion - 1];
  if (
    input.trialState.debriefId !== artifact.artifactId ||
    artifact.committedStateVersion !== artifact.sourceStateVersion + 1 ||
    sourceEvent?.eventId !== artifact.sourceLastEventId ||
    event?.eventId !== artifact.eventId ||
    event.actionId !== artifact.actionId ||
    event.type !== "GENERATE_DEBRIEF" ||
    event.payload.debriefId !== artifact.artifactId ||
    event.modelMetadata?.model !== artifact.model ||
    event.modelMetadata.promptVersion !== artifact.promptVersion ||
    event.modelMetadata.schemaVersion !== artifact.artifactSchemaVersion
  ) {
    fail("DEBRIEF_EVENT_BINDING_INVALID");
  }
  const trace = input.modelCalls.find(
    (row) => row.trace.callId === artifact.callId,
  )?.trace;
  if (
    trace === undefined ||
    trace.task !== "generate_debrief" ||
    trace.status !== "accepted" ||
    trace.outputHash !== artifact.artifactHash ||
    trace.committedActionId !== artifact.actionId ||
    trace.committedEventId !== artifact.eventId ||
    trace.expectedStateVersion !== artifact.sourceStateVersion ||
    trace.expectedLastEventId !== artifact.sourceLastEventId ||
    trace.model !== artifact.model ||
    trace.promptVersion !== artifact.promptVersion ||
    trace.outputSchemaVersion !== artifact.artifactSchemaVersion ||
    trace.completedAt === null ||
    Date.parse(trace.completedAt) !== artifact.createdAt ||
    stableJson(trace.acceptedCitations) !==
      stableJson(expectedTraceCitations) ||
    !debriefTraceScopeMatches(trace, request)
  ) {
    fail("DEBRIEF_TRACE_BINDING_INVALID");
  }
  const citedResources = new Map<string, ResourceInput>();
  for (const citations of debriefCitationSets(output)) {
    for (const field of Object.keys(DEBRIEF_KIND) as Array<
      keyof DebriefCitationSet
    >) {
      for (const identifier of citations[field]) {
        const resource = exactResource(
          resources,
          identifier,
          DEBRIEF_KIND[field],
        );
        if (resource === undefined) {
          fail("DEBRIEF_CITATION_RESOURCE_INVALID");
        }
        citedResources.set(resourceKey(resource), resource);
      }
    }
  }
  return {
    artifactId: artifact.artifactId,
    eventId: artifact.eventId,
    createdAt: artifact.createdAt,
    model: artifact.model,
    artifact: output,
    citationResources: [...citedResources.values()]
      .sort(
        (left, right) =>
          compareIds(left.resourceId, right.resourceId) ||
          compareIds(left.kind, right.kind),
      )
      .map((resource) => projectResource(input, resource)),
  };
}

/** Wrap exact durable audio records with the owner/trial binding used by this projector. */
export function adaptCourtRecordsAudioAudits(
  ownerId: string,
  trialId: string,
  records: readonly HearingAudioAuditRecord[],
) {
  return records.map((record) =>
    CourtRecordsAudioAuditInputSchema.parse({ ownerId, trialId, record }),
  );
}

function sceneActorForTurn(
  turn: TrialStateV3["transcriptTurns"][string],
  userSide: TrialStateV3["userSide"],
): string {
  switch (turn.actor.role) {
    case "judge":
      return "judge";
    case "user_counsel":
    case "opposing_counsel":
      return turn.actor.side === userSide
        ? "user_counsel"
        : "opposing_counsel";
    case "witness":
      return "witness";
    case "jury":
      return "jury";
    case "clerk":
    case "debrief_coach":
    case "system":
      return "clerk";
  }
}

function projectAudioAudits(input: CourtRecordsProjectorInput) {
  const eventById = new Map(input.events.map((event) => [event.eventId, event]));
  const interruptionHistory = interruptionProjection(input.events);
  const interruptionById = new Map(
    interruptionHistory.map((entry) => [entry.interruptId, entry]),
  );
  const resolutionByInterruptId = new Map(
    input.events
      .filter((event) => event.type === "RESOLVE_INTERRUPTION")
      .map((event) => [event.payload.interruptId, event]),
  );
  const resumeByInterruptId = new Map(
    input.events
      .filter((event) => event.type === "RESUME_INTERRUPTED_SPEECH")
      .map((event) => [event.payload.interruptId, event]),
  );

  const validRulingChain = (interruptId: string): boolean => {
    const interruption = interruptionById.get(interruptId);
    const resolution = resolutionByInterruptId.get(interruptId);
    if (
      interruption === undefined ||
      interruption.objectionId === null ||
      resolution === undefined
    ) {
      return false;
    }
    const ruling = input.events.find(
      (event) =>
        event.type === "RULE_ON_OBJECTION" &&
        event.payload.objectionId === interruption.objectionId,
    );
    const begin = eventById.get(interruption.sourceEventId);
    if (
      ruling?.type !== "RULE_ON_OBJECTION" ||
      begin?.type !== "BEGIN_INTERRUPTION" ||
      ruling.causationId !== begin.eventId ||
      resolution.causationId !== ruling.eventId ||
      resolution.sequence <= ruling.sequence
    ) {
      return false;
    }
    const expectedOutcome =
      ruling.payload.ruling === "overruled" ? "resume" : "cancel";
    if (resolution.payload.outcome !== expectedOutcome) return false;
    const resume = resumeByInterruptId.get(interruptId);
    return expectedOutcome === "resume"
      ? resume !== undefined &&
          resume.payload.interruptedResponseId ===
            interruption.interruptedResponseId &&
          resume.causationId === resolution.eventId
      : resume === undefined;
  };

  const validResumedTurn = (interruptId: string, turnId: string): boolean => {
    if (!validRulingChain(interruptId)) return false;
    const interruption = interruptionById.get(interruptId);
    const resolution = resolutionByInterruptId.get(interruptId);
    const resume = resumeByInterruptId.get(interruptId);
    const turn = input.trialState.transcriptTurns[turnId];
    const answer = turn === undefined ? undefined : eventById.get(turn.sourceEventId);
    return (
      interruption !== undefined &&
      resolution?.payload.outcome === "resume" &&
      resume?.type === "RESUME_INTERRUPTED_SPEECH" &&
      answer?.type === "ANSWER_QUESTION" &&
      answer.payload.turnId === turnId &&
      answer.payload.responseId === interruption.interruptedResponseId &&
      answer.causationId === resume.eventId &&
      answer.sequence > resume.sequence
    );
  };

  return input.audioAudits
    .map(({ record }) => {
      let status:
        | "local_observation"
        | "transcript_turn_verified"
        | "interruption_verified" = "local_observation";
      let turnId: string | null = null;
      let interruptId: string | null = null;
      if (record.kind === "playback") {
        const identity = record.identity;
        let turnIsVerified = false;
        if (identity.turnId !== null) {
          const turn = input.trialState.transcriptTurns[identity.turnId];
          const expectedPurpose =
            turn?.actor.role === "witness" ? "testimony" : "transcript";
          if (
            turn === undefined ||
            !isHearingPerformanceSpeakableActor(
              turn.actor,
              input.trialState.userSide,
            ) ||
            identity.actor !== hearingPerformanceActorAlias(turn.actor) ||
            sceneActorForTurn(turn, input.trialState.userSide) !==
              record.sceneActor ||
            record.purpose !== expectedPurpose
          ) {
            fail("AUDIO_TURN_BINDING_INVALID");
          }
          status = "transcript_turn_verified";
          turnId = identity.turnId;
          turnIsVerified = true;
        } else if (
          record.purpose === "transcript" ||
          record.purpose === "testimony"
        ) {
          fail("AUDIO_TURN_BINDING_INVALID");
        }
        if (
          identity.interruptId !== null &&
          turnIsVerified
        ) {
          if (
            record.purpose !== "testimony" ||
            record.sceneActor !== "witness" ||
            turnId === null ||
            !validResumedTurn(identity.interruptId, turnId)
          ) {
            fail("AUDIO_INTERRUPTION_BINDING_INVALID");
          }
          status = "interruption_verified";
          interruptId = identity.interruptId;
        } else if (identity.turnId === null) {
          const fixedLocalTupleIsValid =
            (record.purpose === "objection" &&
              record.sceneActor === "opposing_counsel" &&
              identity.actor === HEARING_OBJECTION_ACTOR_ID &&
              identity.interruptId !== null) ||
            (record.purpose === "correction" &&
              record.sceneActor === "clerk" &&
              identity.actor === HEARING_COURTROOM_DIRECTOR_ACTOR_ID &&
              identity.interruptId !== null) ||
            (record.purpose === "speaker_test" &&
              record.sceneActor === "judge" &&
              identity.actor === HEARING_JUDGE_ACTOR_ID &&
              identity.interruptId === null);
          if (record.purpose === "ruling") {
            if (
              identity.actor !== HEARING_JUDGE_ACTOR_ID ||
              record.sceneActor !== "judge" ||
              identity.interruptId === null ||
              !validRulingChain(identity.interruptId)
            ) {
              fail("AUDIO_INTERRUPTION_BINDING_INVALID");
            }
            status = "interruption_verified";
            interruptId = identity.interruptId;
          } else if (!fixedLocalTupleIsValid) {
            fail("AUDIO_PLAYBACK_SEMANTICS_INVALID");
          }
        }
      }
      return {
        record,
        canonicalBinding: { status, turnId, interruptId },
        rawAudioRetained: false as const,
      };
    })
    .sort(
      (left, right) =>
        left.record.observedAtEpochMs - right.record.observedAtEpochMs ||
        compareIds(left.record.recordId, right.record.recordId),
    );
}

function addMatchingResourceKeys(
  target: Set<string>,
  resources: ResourceIndex,
  identifiers: readonly string[],
  kinds: ReadonlySet<ResourceKind>,
): void {
  for (const identifier of identifiers) {
    const resource = matchingResource(resources, identifier, kinds);
    if (resource?.scope === "owner_record") {
      target.add(resourceKey(resource));
    }
  }
}

function addCoreCitationResourceKeys(
  target: Set<string>,
  resources: ResourceIndex,
  citations: CitationSet,
): void {
  addMatchingResourceKeys(target, resources, citations.factIds, FACT_KINDS);
  addMatchingResourceKeys(
    target,
    resources,
    citations.evidenceIds,
    EVIDENCE_KINDS,
  );
  addMatchingResourceKeys(
    target,
    resources,
    citations.testimonyIds,
    TESTIMONY_KINDS,
  );
  addMatchingResourceKeys(
    target,
    resources,
    citations.eventIds,
    new Set<ResourceKind>(["event"]),
  );
  addMatchingResourceKeys(
    target,
    resources,
    citations.sourceSegmentIds,
    new Set<ResourceKind>(["source_segment"]),
  );
}

/**
 * Project already owner-authorized canonical rows into the only browser-safe
 * Court Records DTO. Raw event payloads, prompts, private strategy, raw jury
 * artifacts, hidden reasoning, and audio bytes have no output fields.
 */
export function projectCourtRecords(
  inputValue: CourtRecordsProjectorInput,
): CourtRecordsView {
  const input = CourtRecordsProjectorInputSchema.parse(inputValue);
  validateOwnerBindings(input);
  if (
    input.caseGraph.caseId !== input.trialState.caseId ||
    input.caseGraph.version !== input.trialState.caseVersion ||
    input.caseGraph.compilerMetadata.sourceContentHash !==
      input.trialState.caseGraphHash ||
    computeCaseGraphContentHash(input.caseGraph) !==
      input.trialState.caseGraphContentHash
  ) {
    fail("CASE_GRAPH_BINDING_INVALID");
  }
  uniqueRows(
    input.audioAudits,
    (audit) => audit.record.recordId,
    "DUPLICATE_AUDIO_AUDIT",
  );
  const replayed = validateReplay(input.trialState, input.events);
  const ownerScope = ownerRecordScope(input);
  const resources = resourceMap(input.citationResources);
  validateResourceBindings(input, input.events, resources, ownerScope);
  const modelCalls = projectModelCalls(input, input.events, resources);
  const finalDebrief = projectFinalDebrief(input, input.events, resources);
  const projectedEventTree = eventTree(input.events, resources);
  const projectedTranscript = input.trialState.transcriptTurnIds.map(
    (turnId, index) => {
      const turn =
        input.trialState.transcriptTurns[turnId] ??
        fail("TRANSCRIPT_TURN_MISSING");
      if (!input.trialState.eventIds.includes(turn.sourceEventId)) {
        fail("TRANSCRIPT_EVENT_INVALID");
      }
      return {
        ordinal: index + 1,
        turnId: turn.turnId,
        actor: turn.actor,
        text: turn.text,
        testimonyId: turn.testimonyId,
        status: turn.status,
        sourceEventId: turn.sourceEventId,
        citations: filteredCitations(turn.citations, resources),
      };
    },
  );
  const citedOwnerResourceKeys = new Set<string>();
  for (const node of projectedEventTree.nodes) {
    addCoreCitationResourceKeys(
      citedOwnerResourceKeys,
      resources,
      node.citations,
    );
  }
  for (const turn of projectedTranscript) {
    addCoreCitationResourceKeys(
      citedOwnerResourceKeys,
      resources,
      turn.citations,
    );
  }
  for (const call of modelCalls) {
    for (const field of Object.keys(TRACE_CITATION_KINDS) as TraceCitationField[]) {
      addMatchingResourceKeys(
        citedOwnerResourceKeys,
        resources,
        call.acceptedCitations[field],
        TRACE_CITATION_KINDS[field],
      );
    }
  }
  for (const resource of finalDebrief?.citationResources ?? []) {
    if (resource.scope === "owner_record") {
      citedOwnerResourceKeys.add(resourceKey(resource));
    }
  }
  const ownerResources = input.citationResources
    .filter(
      (resource) =>
        resource.scope === "owner_record" &&
        citedOwnerResourceKeys.has(resourceKey(resource)),
    )
    .sort(
      (left, right) =>
        compareIds(left.resourceId, right.resourceId) ||
        compareIds(left.kind, right.kind),
    )
    .map((resource) => projectResource(input, resource));
  const lastEvent = input.events.at(-1) ?? fail("TRIAL_HEAD_MISMATCH");
  const audioEntries = projectAudioAudits(input);
  const privacySafeProjection = {
    schemaVersion: COURT_RECORDS_VIEW_SCHEMA_VERSION,
    summary: {
      schemaVersion: COURT_RECORDS_SUMMARY_SCHEMA_VERSION,
      trialId: input.trialState.trialId,
      caseId: input.trialState.caseId,
      caseTitle: input.caseGraph.title,
      phase: input.trialState.phase,
      status: input.trialState.status,
      stateVersion: input.trialState.version,
      lastSequence: input.trialState.lastSequence,
      lastEventId: lastEvent.eventId,
      startedAt: input.trialState.startedAt,
      updatedAt: input.trialState.updatedAt,
      transcriptTurnCount: input.trialState.transcriptTurnIds.length,
      modelCallCount: modelCalls.length,
      hasFinalDebrief: finalDebrief !== null,
    },
    eventTree: projectedEventTree,
    transcript: projectedTranscript,
    procedure: {
      objections: Object.values(input.trialState.objections).sort(
        (left, right) => compareIds(left.sourceEventId, right.sourceEventId),
      ),
      interruptions: interruptionProjection(input.events),
    },
    lifecycles: lifecycleProjection(
      input.events,
      input.trialState,
      ownerScope,
    ),
    modelCalls,
    finalDebrief,
    citationResources: ownerResources,
    audio: {
      availability:
        input.audioAudits.length === 0 ? "not_recorded" : "metadata_available",
      retentionPolicy: "metadata_only_raw_audio_not_stored",
      entries: audioEntries,
    },
  } as const;
  const projected = CourtRecordsViewSchema.parse({
    ...privacySafeProjection,
    replayIntegrity: {
      status: "verified",
      eventCount: input.events.length,
      firstSequence: 1,
      lastSequence: lastEvent.sequence,
      stateVersion: replayed.version,
      lastEventId: lastEvent.eventId,
      privacySafeProjectionHash: sha256Utf8(
        stableJson(privacySafeProjection),
      ),
    },
  });
  return deepFreeze(projected);
}
