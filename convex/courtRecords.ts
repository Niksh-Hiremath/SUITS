import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
  CaseGraphV1Schema,
  computeCaseGraphContentHash,
  sha256Utf8,
  type CaseGraphV1,
} from "../src/domain/case-graph";
import {
  DebriefGeneratorModelOutputSchema,
  type CourtroomModelCallTrace,
  type DebriefCitationSet,
  type DebriefGeneratorModelOutput,
} from "../src/domain/courtroom-ai";
import {
  COURT_RECORDS_INPUT_SCHEMA_VERSION,
  CourtRecordsIdentifierSchema,
  CourtRecordsViewSchema,
  projectCourtRecords,
  type CourtRecordsProjectorInput,
  type CourtRecordsView,
} from "../src/domain/court-records";
import { buildKnowledgeView } from "../src/domain/knowledge";
import {
  TrialEventSchema,
  TrialStateV3Schema,
  type TrialEvent,
  type TrialStateV3,
} from "../src/domain/trial-engine";
import type { HearingAudioAuditRecord } from "../src/lib/speech/hearing-audio-audit";
import type { InternalCourtroomGeneratedArtifactList } from "./courtroomGeneratedArtifacts";
import type { CanonicalTrialAudit } from "./trialEvents";
import { internalAction } from "./_generated/server";
import { CaseServiceOwnerIdSchema } from "./caseServiceBoundary";

type ResolvedGraph = Readonly<{ graphId: string; graphJson: string }>;
type CitationResource = CourtRecordsProjectorInput["citationResources"][number];
type CitationKind = CitationResource["kind"];

const readCanonicalAuditForOwnerReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  CanonicalTrialAudit
>("trialEvents:readCanonicalAuditForOwner");

const loadGraphForOwnerReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; graphId: string }>,
  ResolvedGraph
>("hearingRuntime:loadGraphForOwner");

const listModelCallsForOwnerTrialReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  CourtroomModelCallTrace[]
>("courtroomModelCalls:listForOwnerTrial");

const listGeneratedArtifactsForOwnerTrialReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  InternalCourtroomGeneratedArtifactList
>("courtroomGeneratedArtifacts:listForOwnerTrial");

const listAudioAuditsForOwnerTrialReference = makeFunctionReference<
  "query",
  Readonly<{ ownerId: string; trialId: string }>,
  HearingAudioAuditRecord[]
>("hearingAudioAudits:listForOwnerTrial");

function invalidRecords(): never {
  throw new Error("COURT_RECORDS_AUDIT_INVALID");
}

function parseAuditRows(audit: CanonicalTrialAudit): Readonly<{
  state: TrialStateV3;
  events: TrialEvent[];
}> {
  if (
    sha256Utf8(audit.stateJson) !== audit.stateSha256 ||
    sha256Utf8(`[${audit.eventJsons.join(",")}]`) !==
      audit.eventStreamSha256
  ) {
    return invalidRecords();
  }
  let stateInput: unknown;
  let eventInputs: unknown[];
  try {
    stateInput = JSON.parse(audit.stateJson) as unknown;
    eventInputs = audit.eventJsons.map(
      (eventJson) => JSON.parse(eventJson) as unknown,
    );
  } catch {
    return invalidRecords();
  }
  const state = TrialStateV3Schema.safeParse(stateInput);
  const events = eventInputs.map((eventInput) =>
    TrialEventSchema.safeParse(eventInput),
  );
  if (!state.success || events.some((event) => !event.success)) {
    return invalidRecords();
  }
  const parsedEvents = events.map((event) => {
    if (!event.success) return invalidRecords();
    return event.data;
  });
  const lastEvent = parsedEvents.at(-1);
  if (
    state.data.trialId !== audit.trialId ||
    state.data.caseId !== audit.caseId ||
    state.data.caseVersion !== audit.caseVersion ||
    state.data.version !== audit.stateVersion ||
    state.data.lastSequence !== audit.lastSequence ||
    state.data.eventIds.length !== parsedEvents.length ||
    parsedEvents.length !== audit.lastSequence ||
    lastEvent?.eventId !== audit.lastEventId ||
    lastEvent.stateVersion !== audit.stateVersion ||
    lastEvent.sequence !== audit.lastSequence ||
    parsedEvents.some(
      (event, index) =>
        event.trialId !== audit.trialId ||
        event.sequence !== index + 1 ||
        event.stateVersion !== index + 1 ||
        state.data.eventIds[index] !== event.eventId ||
        state.data.committedActionIds[index] !== event.actionId,
    )
  ) {
    return invalidRecords();
  }
  return { state: state.data, events: parsedEvents };
}

function sameCanonicalHead(
  left: CanonicalTrialAudit,
  right: CanonicalTrialAudit,
): boolean {
  return (
    left.trialId === right.trialId &&
    left.graphId === right.graphId &&
    left.caseId === right.caseId &&
    left.caseVersion === right.caseVersion &&
    left.stateVersion === right.stateVersion &&
    left.lastSequence === right.lastSequence &&
    left.lastEventId === right.lastEventId &&
    left.stateSha256 === right.stateSha256 &&
    left.eventStreamSha256 === right.eventStreamSha256
  );
}

function ownerRecordScope(graph: CaseGraphV1, state: TrialStateV3) {
  const playerActors = Object.values(state.actors).filter(
    (actor) =>
      (actor.role === "user_counsel" ||
        actor.role === "opposing_counsel") &&
      actor.side === state.userSide,
  );
  const player = playerActors[0];
  if (playerActors.length !== 1 || player === undefined) {
    return invalidRecords();
  }
  let view: ReturnType<typeof buildKnowledgeView>;
  try {
    view = buildKnowledgeView({ caseGraph: graph, trial: state }, player.actorId);
  } catch {
    return invalidRecords();
  }
  if (
    view.actorRole !== "user_counsel" &&
    view.actorRole !== "opposing_counsel"
  ) {
    return invalidRecords();
  }
  return {
    factIds: new Set([
      ...view.counsel.facts.map(({ factId }) => factId),
      ...view.publicRecord.facts.map(({ factId }) => factId),
      ...Object.values(state.transcriptTurns).flatMap(
        (turn) => turn.citations.factIds,
      ),
    ]),
    evidenceIds: new Set([
      ...view.counsel.evidence.map(({ evidenceId }) => evidenceId),
      ...view.publicRecord.evidence.map(({ evidenceId }) => evidenceId),
      ...Object.values(state.evidence).flatMap((evidence) =>
        evidence.offeredBySide === null ? [] : [evidence.evidenceId],
      ),
      ...Object.values(state.questions).flatMap(
        (question) => question.presentedEvidenceIds,
      ),
      ...Object.values(state.transcriptTurns).flatMap(
        (turn) => turn.citations.evidenceIds,
      ),
    ]),
  };
}

function factKind(status: TrialStateV3["facts"][string]["status"]): CitationKind {
  switch (status) {
    case "hidden":
      return "hidden_fact";
    case "proposed":
    case "disputed":
    case "verified":
      return "unadmitted_fact";
    case "admitted":
      return "admitted_fact";
    case "excluded":
    case "stricken":
      return "excluded_fact";
  }
}

function evidenceKind(
  status: TrialStateV3["evidence"][string]["status"],
): CitationKind {
  switch (status) {
    case "uploaded":
    case "indexed":
    case "offered":
    case "withdrawn":
      return "unadmitted_evidence";
    case "admitted":
      return "admitted_evidence";
    case "excluded":
      return "excluded_evidence";
  }
}

function debriefCitationSets(
  output: DebriefGeneratorModelOutput,
): DebriefCitationSet[] {
  return [
    output.overallAssessment.citations,
    ...output.strengths.map(({ citations }) => citations),
    ...output.weakQuestions.map(({ citations }) => citations),
    ...output.missedEvidence.map(({ citations }) => citations),
    ...output.contradictions.map(({ citations }) => citations),
    ...output.objectionAccuracy.map(({ citations }) => citations),
    ...output.witnessStrategy.map(({ citations }) => citations),
    ...output.settlementChoices.map(({ citations }) => citations),
    ...output.juryMovement.map(({ citations }) => citations),
    ...output.improvedClosing.segments.map(({ citations }) => citations),
  ];
}

export function deriveCourtRecordsCitationResources(input: Readonly<{
  ownerId: string;
  graph: CaseGraphV1;
  state: TrialStateV3;
  events: readonly TrialEvent[];
  traces: readonly Pick<CourtroomModelCallTrace, "acceptedCitations">[];
  finalDebrief: DebriefGeneratorModelOutput | null;
}>): CitationResource[] {
  const scope = ownerRecordScope(input.graph, input.state);
  const resources = new Map<string, CitationResource>();
  const cited = {
    factIds: new Set<string>(),
    evidenceIds: new Set<string>(),
    testimonyIds: new Set<string>(),
    eventIds: new Set<string>(),
    sourceSegmentIds: new Set<string>(),
    priorStatementIds: new Set<string>(),
    transcriptTurnIds: new Set<string>(),
    coachingInferenceIds: new Set<string>(),
  };
  const collectUnique = (target: Set<string>, identifiers: readonly string[]) => {
    if (new Set(identifiers).size !== identifiers.length) {
      return invalidRecords();
    }
    identifiers.forEach((identifier) => target.add(identifier));
  };
  const collectCore = (citations: Readonly<{
    factIds: readonly string[];
    evidenceIds: readonly string[];
    testimonyIds: readonly string[];
    eventIds: readonly string[];
    sourceSegmentIds: readonly string[];
  }>) => {
    collectUnique(cited.factIds, citations.factIds);
    collectUnique(cited.evidenceIds, citations.evidenceIds);
    collectUnique(cited.testimonyIds, citations.testimonyIds);
    collectUnique(cited.eventIds, citations.eventIds);
    collectUnique(cited.sourceSegmentIds, citations.sourceSegmentIds);
  };
  input.events.forEach((event) => collectCore(event.citations));
  Object.values(input.state.transcriptTurns).forEach((turn) =>
    collectCore(turn.citations),
  );
  for (const trace of input.traces) {
    collectCore(trace.acceptedCitations);
    collectUnique(
      cited.priorStatementIds,
      trace.acceptedCitations.priorStatementIds,
    );
  }
  for (const citations of input.finalDebrief === null
    ? []
    : debriefCitationSets(input.finalDebrief)) {
    collectUnique(cited.factIds, [
      ...citations.admittedFactIds,
      ...citations.unadmittedFactIds,
      ...citations.excludedFactIds,
      ...citations.hiddenFactIds,
    ]);
    collectUnique(cited.evidenceIds, [
      ...citations.admittedEvidenceIds,
      ...citations.unadmittedEvidenceIds,
      ...citations.excludedEvidenceIds,
    ]);
    collectUnique(cited.testimonyIds, [
      ...citations.activeTestimonyIds,
      ...citations.strickenTestimonyIds,
    ]);
    collectUnique(
      cited.transcriptTurnIds,
      citations.transcriptTurnIds,
    );
    collectUnique(
      cited.sourceSegmentIds,
      citations.hiddenSourceSegmentIds,
    );
    collectUnique(
      cited.coachingInferenceIds,
      citations.coachingInferenceIds,
    );
  }
  const eventIds = new Set(input.events.map(({ eventId }) => eventId));
  const sourceSegmentIds = new Set(
    input.graph.sourceSegments.map(({ sourceSegmentId }) => sourceSegmentId),
  );
  const stateSourceSegmentIds = new Set(input.state.sourceSegmentIds);
  const priorStatementIds = new Set(
    input.graph.witnesses.flatMap((witness) =>
      witness.priorStatements.map(({ priorStatementId }) => priorStatementId),
    ),
  );
  if (
    [...cited.factIds].some(
      (identifier) => input.state.facts[identifier] === undefined,
    ) ||
    [...cited.evidenceIds].some(
      (identifier) => input.state.evidence[identifier] === undefined,
    ) ||
    [...cited.testimonyIds].some(
      (identifier) => input.state.testimony[identifier] === undefined,
    ) ||
    [...cited.eventIds].some((identifier) => !eventIds.has(identifier)) ||
    [...cited.sourceSegmentIds].some(
      (identifier) =>
        !sourceSegmentIds.has(identifier) ||
        !stateSourceSegmentIds.has(identifier),
    ) ||
    [...cited.priorStatementIds].some(
      (identifier) => !priorStatementIds.has(identifier),
    ) ||
    [...cited.transcriptTurnIds].some(
      (identifier) =>
        input.state.transcriptTurns[identifier]?.status !== "active",
    ) ||
    cited.coachingInferenceIds.size !== 0
  ) {
    return invalidRecords();
  }
  const add = (
    resourceId: string,
    kind: CitationKind,
    resourceScope: CitationResource["scope"],
  ) => {
    const resource = {
      ownerId: input.ownerId,
      trialId: input.state.trialId,
      resourceId,
      kind,
      scope: resourceScope,
    } satisfies CitationResource;
    const key = `${kind}\u0000${resourceId}`;
    const existing = resources.get(key);
    if (existing !== undefined && existing.scope !== resource.scope) {
      return invalidRecords();
    }
    resources.set(key, resource);
  };

  for (const fact of Object.values(input.state.facts)) {
    if (!cited.factIds.has(fact.factId)) continue;
    const kind = factKind(fact.status);
    add(
      fact.factId,
      kind,
      kind !== "hidden_fact" && scope.factIds.has(fact.factId)
        ? "owner_record"
        : "debrief_only",
    );
  }
  for (const evidence of Object.values(input.state.evidence)) {
    if (!cited.evidenceIds.has(evidence.evidenceId)) continue;
    add(
      evidence.evidenceId,
      evidenceKind(evidence.status),
      scope.evidenceIds.has(evidence.evidenceId)
        ? "owner_record"
        : "debrief_only",
    );
  }
  for (const testimony of Object.values(input.state.testimony)) {
    if (!cited.testimonyIds.has(testimony.testimonyId)) continue;
    add(
      testimony.testimonyId,
      testimony.status === "active"
        ? "active_testimony"
        : "stricken_testimony",
      "owner_record",
    );
  }
  for (const turn of Object.values(input.state.transcriptTurns)) {
    if (turn.status === "active" && cited.transcriptTurnIds.has(turn.turnId)) {
      add(turn.turnId, "transcript_turn", "owner_record");
    }
  }
  for (const event of input.events) {
    if (cited.eventIds.has(event.eventId)) {
      add(event.eventId, "event", "owner_record");
    }
  }
  for (const segment of input.graph.sourceSegments) {
    if (
      stateSourceSegmentIds.has(segment.sourceSegmentId) &&
      cited.sourceSegmentIds.has(segment.sourceSegmentId)
    ) {
      add(segment.sourceSegmentId, "source_segment", "debrief_only");
    }
  }
  for (const statement of input.graph.witnesses.flatMap(
    (witness) => witness.priorStatements,
  )) {
    if (cited.priorStatementIds.has(statement.priorStatementId)) {
      add(statement.priorStatementId, "prior_statement", "debrief_only");
    }
  }
  for (const inferenceId of cited.coachingInferenceIds) {
    add(inferenceId, "coaching_inference", "debrief_only");
  }
  return [...resources.values()].sort(
    (left, right) =>
      left.resourceId.localeCompare(right.resourceId) ||
      left.kind.localeCompare(right.kind),
  );
}

function finalDebriefArtifact(
  ownerId: string,
  trialId: string,
  artifacts: InternalCourtroomGeneratedArtifactList,
): Readonly<{
  input: CourtRecordsProjectorInput["finalDebriefArtifact"];
  output: DebriefGeneratorModelOutput | null;
}> {
  const finalArtifacts = artifacts.filter(
    (artifact) => artifact.artifactKind === "final_debrief",
  );
  if (finalArtifacts.length > 1) return invalidRecords();
  const finalArtifact = finalArtifacts[0];
  if (finalArtifact === undefined) return { input: null, output: null };
  if (finalArtifact.metadata.model !== "gpt-5.6-terra") {
    return invalidRecords();
  }
  const output = DebriefGeneratorModelOutputSchema.parse(
    finalArtifact.artifact,
  );
  return {
    output,
    input: {
      ...finalArtifact.metadata,
      artifactKind: "final_debrief",
      ownerId,
      trialId,
      decisionId: null,
      artifactJson: JSON.stringify(output),
      model: "gpt-5.6-terra",
    },
  };
}

/**
 * Assemble strict owner-scoped internal audits and return only the redacted
 * Court Records view. No canonical event JSON or raw generated artifact crosses
 * this action boundary.
 */
export const readForOwner = internalAction({
  args: { ownerId: v.string(), trialId: v.string() },
  handler: async (ctx, args): Promise<CourtRecordsView> => {
    const ownerId = CaseServiceOwnerIdSchema.parse(args.ownerId);
    const trialId = CourtRecordsIdentifierSchema.parse(args.trialId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const audit = await ctx.runQuery(readCanonicalAuditForOwnerReference, {
        ownerId,
        trialId,
      });
      const { state, events } = parseAuditRows(audit);
      const [graphRecord, traces, artifacts, audioAudits] = await Promise.all([
        ctx.runQuery(loadGraphForOwnerReference, {
          ownerId,
          graphId: audit.graphId,
        }),
        ctx.runQuery(listModelCallsForOwnerTrialReference, {
          ownerId,
          trialId,
        }),
        ctx.runQuery(listGeneratedArtifactsForOwnerTrialReference, {
          ownerId,
          trialId,
        }),
        ctx.runQuery(listAudioAuditsForOwnerTrialReference, {
          ownerId,
          trialId,
        }),
      ]);
      const closingAudit = await ctx.runQuery(
        readCanonicalAuditForOwnerReference,
        { ownerId, trialId },
      );
      parseAuditRows(closingAudit);
      if (!sameCanonicalHead(audit, closingAudit)) continue;

      let graphInput: unknown;
      try {
        graphInput = JSON.parse(graphRecord.graphJson) as unknown;
      } catch {
        return invalidRecords();
      }
      const graph = CaseGraphV1Schema.safeParse(graphInput);
      if (
        !graph.success ||
        graphRecord.graphId !== audit.graphId ||
        graph.data.caseId !== audit.caseId ||
        graph.data.version !== audit.caseVersion ||
        graph.data.compilerMetadata.sourceContentHash !== state.caseGraphHash ||
        computeCaseGraphContentHash(graph.data) !== state.caseGraphContentHash ||
        traces.some((trace) => trace.trialId !== trialId) ||
        artifacts.some(
          (artifact) =>
            artifact.privacyProjectionRequired !== true ||
            artifact.metadata.trialId !== trialId,
        )
      ) {
        return invalidRecords();
      }
      const debrief = finalDebriefArtifact(ownerId, trialId, artifacts);
      const view = projectCourtRecords({
        schemaVersion: COURT_RECORDS_INPUT_SCHEMA_VERSION,
        ownerId,
        caseGraph: graph.data,
        trialState: state,
        events,
        modelCalls: traces.map((trace) => ({ ownerId, trace })),
        citationResources: deriveCourtRecordsCitationResources({
          ownerId,
          graph: graph.data,
          state,
          events,
          traces,
          finalDebrief: debrief.output,
        }),
        finalDebriefArtifact: debrief.input,
        audioAudits: audioAudits.map((record) => ({
          ownerId,
          trialId,
          record,
        })),
      });
      return CourtRecordsViewSchema.parse(view);
    }
    throw new Error("COURT_RECORDS_HEAD_UNSTABLE");
  },
});
