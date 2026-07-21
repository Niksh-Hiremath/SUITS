import type {
  CourtRecordsListResponse,
  CourtRecordsTrialSummary,
  CourtRecordsView,
} from "../../domain/court-records";
import {
  paginateCourtRecords,
  type CourtRecordsPage,
} from "./court-records-pagination";

type EventNode = CourtRecordsView["eventTree"]["nodes"][number];
type TranscriptTurn = CourtRecordsView["transcript"][number];
type Objection = CourtRecordsView["procedure"]["objections"][number];
type Ruling = CourtRecordsView["procedure"]["rulings"][number];
type Recovery = CourtRecordsView["procedure"]["recoveries"][number];
type Interruption = CourtRecordsView["procedure"]["interruptions"][number];
type FactLifecycle = CourtRecordsView["lifecycles"]["facts"][number];
type EvidenceLifecycle = CourtRecordsView["lifecycles"]["evidence"][number];
type ModelCall = CourtRecordsView["modelCalls"][number];
type AudioEntry = CourtRecordsView["audio"]["entries"][number];
type CitationResource = CourtRecordsView["citationResources"][number];
type CitationKind = CitationResource["kind"];
type FinalDebrief = NonNullable<CourtRecordsView["finalDebrief"]>;
type DebriefCitationSet = FinalDebrief["artifact"]["overallAssessment"]["citations"];

export type CourtRecordsViewModelErrorCode =
  | "VIEW_HEAD_MISMATCH"
  | "VIEW_COUNT_MISMATCH"
  | "EVENT_TREE_INVALID"
  | "CITATION_INDEX_INVALID";

export class CourtRecordsViewModelError extends Error {
  readonly code: CourtRecordsViewModelErrorCode;

  constructor(code: CourtRecordsViewModelErrorCode) {
    super(`Court Records view-model invariant failed: ${code}`);
    this.name = "CourtRecordsViewModelError";
    this.code = code;
  }
}

function fail(code: CourtRecordsViewModelErrorCode): never {
  throw new CourtRecordsViewModelError(code);
}

export const COURT_RECORDS_PHASE_LABELS = Object.freeze({
  pretrial: "Pretrial",
  opening: "Opening statements",
  case_in_chief: "Case in chief",
  recess: "Recess",
  pre_closing: "Pre-closing",
  closing: "Closing arguments",
  jury_instructions: "Jury instructions",
  deliberation: "Deliberation",
  verdict: "Verdict",
  debrief: "Coaching debrief",
  complete: "Complete",
} satisfies Record<CourtRecordsView["summary"]["phase"], string>);

export const COURT_RECORDS_TRIAL_STATUS_LABELS = Object.freeze({
  pending: "Pending",
  active: "Active",
  paused: "Paused",
  settled: "Settled",
  complete: "Complete",
  failed: "Failed",
} satisfies Record<CourtRecordsView["summary"]["status"], string>);

export const COURT_RECORDS_EVENT_TYPE_LABELS = Object.freeze({
  START_TRIAL: "Start trial",
  BEGIN_PHASE: "Begin phase",
  CALL_WITNESS: "Call witness",
  SWEAR_WITNESS: "Swear witness",
  ASK_QUESTION: "Ask question",
  ANSWER_QUESTION: "Answer question",
  END_EXAMINATION: "End examination",
  RECALL_WITNESS: "Recall witness",
  RELEASE_WITNESS: "Release witness",
  OBJECT: "Object",
  RULE_ON_OBJECTION: "Rule on objection",
  REPHRASE_QUESTION: "Rephrase question",
  MOVE_TO_STRIKE: "Move to strike",
  STRIKE_TESTIMONY: "Strike testimony",
  OFFER_EVIDENCE: "Offer evidence",
  RULE_ON_EVIDENCE: "Rule on evidence",
  WITHDRAW_EVIDENCE: "Withdraw evidence",
  REVEAL_HIDDEN_FACT: "Reveal hidden fact",
  PROPOSE_ASSERTION: "Propose assertion",
  VERIFY_ASSERTION: "Verify assertion",
  DISPUTE_ASSERTION: "Dispute assertion",
  RULE_ON_ASSERTION: "Rule on assertion",
  REQUEST_RESPONSE: "Request response",
  CANCEL_RESPONSE: "Cancel response",
  COMPLETE_RESPONSE: "Complete response",
  BEGIN_INTERRUPTION: "Begin interruption",
  RESOLVE_INTERRUPTION: "Resolve interruption",
  RESUME_INTERRUPTED_SPEECH: "Resume interrupted speech",
  PAUSE_TRIAL: "Pause trial",
  REQUEST_RECESS: "Request recess",
  RESUME_TRIAL: "Resume trial",
  PROPOSE_SETTLEMENT: "Propose settlement",
  COUNTER_SETTLEMENT: "Counter settlement",
  ACCEPT_SETTLEMENT: "Accept settlement",
  REJECT_SETTLEMENT: "Reject settlement",
  WITHDRAW_SETTLEMENT: "Withdraw settlement",
  EXPIRE_SETTLEMENT: "Expire settlement",
  REST_CASE: "Rest case",
  GIVE_CLOSING: "Give closing",
  INSTRUCT_JURY: "Instruct jury",
  DELIBERATE: "Deliberate",
  RENDER_VERDICT: "Render verdict",
  GENERATE_DEBRIEF: "Generate debrief",
  FAIL_STEP: "Record failed step",
  RECOVER_STEP: "Recover failed step",
  UPDATE_OPPOSING_STRATEGY: "Update opposing strategy",
  DENY_STRIKE_MOTION: "Deny strike motion",
  WITHDRAW_STRIKE_MOTION: "Withdraw strike motion",
} satisfies Record<EventNode["type"], string>);

export const COURT_RECORDS_ACTOR_ROLE_LABELS = Object.freeze({
  user_counsel: "Your counsel",
  opposing_counsel: "Opposing counsel",
  judge: "Judge",
  witness: "Witness",
  clerk: "Clerk",
  jury: "Jury",
  system: "Court system",
  debrief_coach: "Debrief coach",
} satisfies Record<EventNode["actor"]["role"], string>);

export const COURT_RECORDS_SIDE_LABELS = Object.freeze({
  user: "Your side",
  opposing: "Opposing side",
  neutral: "Neutral",
} satisfies Record<EventNode["actor"]["side"], string>);

export const COURT_RECORDS_EVENT_SOURCE_LABELS = Object.freeze({
  user: "User",
  ai: "Validated AI proposal",
  deterministic: "Deterministic engine",
  speech: "SUITS speech runtime",
  system: "System",
} satisfies Record<EventNode["source"], string>);

export const COURT_RECORDS_TRANSCRIPT_STATUS_LABELS = Object.freeze({
  active: "Active historical transcript — not automatically admitted proof",
  stricken: "Stricken — retained for audit and excluded from jury consideration",
} satisfies Record<TranscriptTurn["status"], string>);

export const COURT_RECORDS_FACT_STATUS_LABELS = Object.freeze({
  hidden: "Hidden authoring truth",
  proposed: "Proposed",
  disputed: "Disputed",
  verified: "Verified",
  admitted: "Admitted",
  excluded: "Excluded",
  stricken: "Stricken",
} satisfies Record<FactLifecycle["status"], string>);

export const COURT_RECORDS_FACT_VISIBILITY_LABELS = Object.freeze({
  public: "Public record",
  restricted: "Owner-visible restricted record",
} satisfies Record<FactLifecycle["visibility"], string>);

export const COURT_RECORDS_EVIDENCE_STATUS_LABELS = Object.freeze({
  uploaded: "Uploaded",
  indexed: "Indexed",
  offered: "Offered",
  admitted: "Admitted",
  excluded: "Excluded",
  withdrawn: "Withdrawn",
} satisfies Record<EvidenceLifecycle["status"], string>);

export const COURT_RECORDS_OBJECTION_GROUND_LABELS = Object.freeze({
  relevance: "Relevance",
  hearsay: "Hearsay",
  leading: "Leading",
  speculation: "Speculation",
  foundation: "Foundation",
  asked_and_answered: "Asked and answered",
  argumentative: "Argumentative",
  compound: "Compound",
  privilege: "Privilege",
} satisfies Record<Objection["ground"], string>);

export const COURT_RECORDS_OBJECTION_STATUS_LABELS = Object.freeze({
  pending: "Pending",
  sustained: "Sustained",
  overruled: "Overruled",
  withdrawn: "Withdrawn",
} satisfies Record<Objection["status"], string>);

export const COURT_RECORDS_OBJECTION_REMEDY_LABELS = Object.freeze({
  none: "No further remedy",
  rephrase: "Rephrase question",
  strike: "Strike testimony",
  cancel_response: "Cancel response",
  resume_response: "Resume response",
} satisfies Record<NonNullable<Objection["remedy"]>, string>);

export const COURT_RECORDS_RULING_KIND_LABELS = Object.freeze({
  objection: "Objection ruling",
  evidence: "Evidence ruling",
  assertion: "Assertion ruling",
  strike: "Strike ruling",
} satisfies Record<Ruling["kind"], string>);

export const COURT_RECORDS_RULING_DISPOSITION_LABELS = Object.freeze({
  sustained: "Sustained",
  overruled: "Overruled",
  admitted: "Admitted",
  excluded: "Excluded",
  granted: "Granted",
  denied: "Denied",
} satisfies Record<Ruling["disposition"], string>);

export const COURT_RECORDS_RECOVERY_STATUS_LABELS = Object.freeze({
  awaiting_recovery: "Awaiting recovery",
  recovered: "Recovered",
} satisfies Record<Recovery["status"], string>);

export const COURT_RECORDS_INTERRUPTION_STATUS_LABELS = Object.freeze({
  active: "Active",
  cancelled: "Cancelled",
  resolved: "Resolved",
  resumed: "Speech resumed",
} satisfies Record<Interruption["status"], string>);

export const COURT_RECORDS_MODEL_STATUS_LABELS = Object.freeze({
  in_progress: "In progress",
  accepted: "Accepted",
  failed: "Failed",
  cancelled: "Cancelled",
  stale: "Stale",
} satisfies Record<ModelCall["status"], string>);

export const COURT_RECORDS_MODEL_TASK_LABELS = Object.freeze({
  compile_case: "Compile case",
  plan_opponent: "Plan opposing strategy",
  witness_answer: "Witness answer",
  counsel_response: "Counsel response",
  judge_response: "Judge response",
  jury_deliberation: "Jury deliberation",
  resolve_objection: "Resolve objection",
  evaluate_settlement: "Evaluate settlement",
  generate_debrief: "Generate coaching debrief",
} satisfies Record<ModelCall["task"], string>);

export const COURT_RECORDS_MODEL_CALL_CLASS_LABELS = Object.freeze({
  case_compiler: "Case compiler",
  opponent_planner: "Opponent planner",
  role_responder: "Role responder",
  objection_resolver: "Objection resolver",
  negotiation_agent: "Negotiation agent",
  debrief_generator: "Debrief generator",
} satisfies Record<ModelCall["callClass"], string>);

export const COURT_RECORDS_ATTEMPT_MODE_LABELS = Object.freeze({
  initial: "Initial attempt",
  repair: "Targeted repair — not a fallback",
} satisfies Record<ModelCall["attempts"][number]["mode"], string>);

export const COURT_RECORDS_ATTEMPT_STATUS_LABELS = Object.freeze({
  accepted: "Accepted",
  validation_failed: "Validation failed",
  provider_failed: "Provider failed",
  cancelled: "Cancelled",
  stale: "Stale",
} satisfies Record<ModelCall["attempts"][number]["status"], string>);

export const COURT_RECORDS_CITATION_KIND_LABELS = Object.freeze({
  admitted_fact: "Admitted fact",
  unadmitted_fact: "Unadmitted fact",
  excluded_fact: "Excluded fact",
  hidden_fact: "Hidden authoring fact",
  admitted_evidence: "Admitted evidence",
  unadmitted_evidence: "Unadmitted evidence",
  excluded_evidence: "Excluded evidence",
  active_testimony: "Active testimony",
  stricken_testimony: "Stricken testimony",
  transcript_turn: "Transcript turn",
  event: "Procedural event",
  source_segment: "Source segment",
  prior_statement: "Prior statement",
  coaching_inference: "Coaching inference",
} satisfies Record<CitationKind, string>);

export const COURT_RECORDS_CITATION_STRATUM_LABELS = Object.freeze({
  admitted_record: "Admitted record",
  unadmitted_record: "Unadmitted record",
  excluded_or_stricken: "Excluded or stricken material",
  hidden_authoring_truth: "Hidden authoring truth",
  procedural_record: "Procedural record",
  coaching_inference: "Coaching inference",
} satisfies Record<CitationResource["stratum"], string>);

export const COURT_RECORDS_AUDIO_BINDING_LABELS = Object.freeze({
  local_observation: "Client-observed metadata — no canonical content binding",
  transcript_turn_verified: "Canonical transcript-turn binding verified — audio content not verified",
  interruption_verified: "Canonical interruption binding verified — audio content not verified",
} satisfies Record<AudioEntry["canonicalBinding"]["status"], string>);

export const COURT_RECORDS_AUDIO_KIND_LABELS = Object.freeze({
  user_speech: "User speech lifecycle metadata",
  playback: "Playback lifecycle metadata",
} satisfies Record<AudioEntry["record"]["kind"], string>);

export const COURT_RECORDS_HONEST_COPY = Object.freeze({
  knowledgeScope: "Scope item counts only; scoped content is not disclosed.",
  projectionHash: "SHA-256 of the privacy-safe projection, not the raw event stream.",
  rawAudio: "Client-observed metadata only; raw audio and transcript fragments are not retained.",
  unavailableMetric: "Unavailable — not zero.",
  fallback: "Validated model or fail; no alternate-provider or deterministic fallback is available.",
});

/**
 * Validate redundant owner-facing bindings before deriving display data. The
 * messages are deliberately content-free so a malformed view cannot echo data.
 */
export function assertCourtRecordsViewBindings(view: CourtRecordsView): void {
  const { summary, replayIntegrity } = view;
  if (
    summary.stateVersion !== replayIntegrity.stateVersion ||
    summary.lastSequence !== replayIntegrity.lastSequence ||
    summary.lastEventId !== replayIntegrity.lastEventId
  ) {
    fail("VIEW_HEAD_MISMATCH");
  }
  if (
    view.eventTree.nodes.length !== replayIntegrity.eventCount ||
    replayIntegrity.lastSequence !== replayIntegrity.eventCount ||
    summary.transcriptTurnCount !== view.transcript.length ||
    summary.modelCallCount !== view.modelCalls.length ||
    summary.hasFinalDebrief !== (view.finalDebrief !== null) ||
    (view.audio.availability === "not_recorded") !==
      (view.audio.entries.length === 0)
  ) {
    fail("VIEW_COUNT_MISMATCH");
  }
  const head = view.eventTree.nodes.filter(
    (node) => node.sequence === replayIntegrity.lastSequence,
  );
  if (
    head.length !== 1 ||
    head[0]?.eventId !== replayIntegrity.lastEventId ||
    head[0]?.stateVersion !== replayIntegrity.stateVersion
  ) {
    fail("VIEW_HEAD_MISMATCH");
  }
}

export type CourtRecordsEventTreeRow = Readonly<{
  node: EventNode;
  depth: number;
  ordinal: number;
  parentSequence: number | null;
  isRoot: boolean;
}>;

/** Validate the complete graph iteratively, then return chronological rows. */
export function flattenCourtRecordsEventTree(
  eventTree: CourtRecordsView["eventTree"],
): readonly CourtRecordsEventTreeRow[] {
  const byId = new Map<string, EventNode>();
  const bySequence = new Map<number, EventNode>();
  for (const node of eventTree.nodes) {
    if (byId.has(node.eventId) || bySequence.has(node.sequence)) {
      fail("EVENT_TREE_INVALID");
    }
    byId.set(node.eventId, node);
    bySequence.set(node.sequence, node);
  }

  const rootIds = new Set(eventTree.rootEventIds);
  if (rootIds.size !== eventTree.rootEventIds.length) {
    fail("EVENT_TREE_INVALID");
  }

  for (const node of eventTree.nodes) {
    const shouldBeRoot = node.parentEventId === null;
    if (rootIds.has(node.eventId) !== shouldBeRoot) {
      fail("EVENT_TREE_INVALID");
    }
    const childIds = new Set(node.childEventIds);
    if (childIds.size !== node.childEventIds.length) {
      fail("EVENT_TREE_INVALID");
    }
    if (node.parentEventId !== null) {
      const parent = byId.get(node.parentEventId);
      if (
        parent === undefined ||
        parent.sequence >= node.sequence ||
        parent.childEventIds.filter((childId) => childId === node.eventId)
          .length !== 1
      ) {
        fail("EVENT_TREE_INVALID");
      }
    }
    for (const childId of node.childEventIds) {
      const child = byId.get(childId);
      if (
        child === undefined ||
        child.parentEventId !== node.eventId ||
        child.sequence <= node.sequence
      ) {
        fail("EVENT_TREE_INVALID");
      }
    }
  }

  const depths = new Map<string, number>();
  const roots = eventTree.rootEventIds
    .map((eventId) => byId.get(eventId) ?? fail("EVENT_TREE_INVALID"))
    .sort((left, right) => right.sequence - left.sequence);
  const stack = roots.map((node) => ({ node, depth: 0 }));
  while (stack.length > 0) {
    const current = stack.pop() ?? fail("EVENT_TREE_INVALID");
    if (depths.has(current.node.eventId)) {
      fail("EVENT_TREE_INVALID");
    }
    depths.set(current.node.eventId, current.depth);
    const children = current.node.childEventIds
      .map((eventId) => byId.get(eventId) ?? fail("EVENT_TREE_INVALID"))
      .sort((left, right) => right.sequence - left.sequence);
    for (const child of children) {
      stack.push({ node: child, depth: current.depth + 1 });
    }
  }
  if (depths.size !== eventTree.nodes.length) {
    fail("EVENT_TREE_INVALID");
  }

  const ordered = [...eventTree.nodes].sort(
    (left, right) => left.sequence - right.sequence,
  );
  return Object.freeze(
    ordered.map((node, index) => {
      const parent =
        node.parentEventId === null ? null : byId.get(node.parentEventId);
      return Object.freeze({
        node,
        depth: depths.get(node.eventId) ?? fail("EVENT_TREE_INVALID"),
        ordinal: index + 1,
        parentSequence: parent?.sequence ?? null,
        isRoot: node.parentEventId === null,
      });
    }),
  );
}

export type CourtRecordsCitationNamespace =
  | "fact"
  | "evidence"
  | "testimony"
  | "transcript_turn"
  | "event"
  | "source_segment"
  | "prior_statement"
  | "coaching_inference";

export type CourtRecordsCitationReference = Readonly<{
  namespace: CourtRecordsCitationNamespace;
  resourceId: string;
  requestedKind: CitationKind | null;
}>;

export type CourtRecordsCitationResolution =
  | Readonly<{
      status: "resolved";
      reference: CourtRecordsCitationReference;
      resource: CitationResource;
    }>
  | Readonly<{
      status: "unavailable";
      reference: CourtRecordsCitationReference;
    }>;

type TrialCitationSet = EventNode["citations"];
type ModelCitationSet = ModelCall["acceptedCitations"];

export type CourtRecordsCitationIndex = Readonly<{
  resources: readonly CitationResource[];
  resolveExact: (
    kind: CitationKind,
    resourceId: string,
  ) => CourtRecordsCitationResolution;
  resolveNamespace: (
    namespace: CourtRecordsCitationNamespace,
    resourceId: string,
  ) => CourtRecordsCitationResolution;
  resolveTrialSet: (
    citations: TrialCitationSet,
  ) => readonly CourtRecordsCitationResolution[];
  resolveModelSet: (
    citations: ModelCitationSet,
  ) => readonly CourtRecordsCitationResolution[];
  resolveDebriefSet: (
    citations: DebriefCitationSet,
  ) => readonly CourtRecordsCitationResolution[];
}>;

function namespaceForKind(kind: CitationKind): CourtRecordsCitationNamespace {
  switch (kind) {
    case "admitted_fact":
    case "unadmitted_fact":
    case "excluded_fact":
    case "hidden_fact":
      return "fact";
    case "admitted_evidence":
    case "unadmitted_evidence":
    case "excluded_evidence":
      return "evidence";
    case "active_testimony":
    case "stricken_testimony":
      return "testimony";
    case "transcript_turn":
      return "transcript_turn";
    case "event":
      return "event";
    case "source_segment":
      return "source_segment";
    case "prior_statement":
      return "prior_statement";
    case "coaching_inference":
      return "coaching_inference";
  }
}

function citationKey(kind: CitationKind, resourceId: string): string {
  return JSON.stringify([kind, resourceId]);
}

function namespaceKey(
  namespace: CourtRecordsCitationNamespace,
  resourceId: string,
): string {
  return JSON.stringify([namespace, resourceId]);
}

function sameCitationResource(
  left: CitationResource,
  right: CitationResource,
): boolean {
  return (
    left.resourceId === right.resourceId &&
    left.kind === right.kind &&
    left.scope === right.scope &&
    left.title === right.title &&
    left.stratum === right.stratum &&
    left.stratumLabel === right.stratumLabel
  );
}

function frozenReference(
  namespace: CourtRecordsCitationNamespace,
  resourceId: string,
  requestedKind: CitationKind | null,
): CourtRecordsCitationReference {
  return Object.freeze({ namespace, resourceId, requestedKind });
}

/** Build a private exact-key index; no mutable Map is exposed to React code. */
export function createCourtRecordsCitationIndex(
  view: CourtRecordsView,
): CourtRecordsCitationIndex {
  const exact = new Map<string, CitationResource>();
  const byNamespace = new Map<string, CitationResource>();
  const combined = [
    ...view.citationResources,
    ...(view.finalDebrief?.citationResources ?? []),
  ];
  for (const resource of combined) {
    const exactKey = citationKey(resource.kind, resource.resourceId);
    const previousExact = exact.get(exactKey);
    if (
      previousExact !== undefined &&
      !sameCitationResource(previousExact, resource)
    ) {
      fail("CITATION_INDEX_INVALID");
    }
    exact.set(exactKey, previousExact ?? resource);

    const familyKey = namespaceKey(
      namespaceForKind(resource.kind),
      resource.resourceId,
    );
    const previousFamily = byNamespace.get(familyKey);
    if (
      previousFamily !== undefined &&
      previousFamily.kind !== resource.kind
    ) {
      fail("CITATION_INDEX_INVALID");
    }
    byNamespace.set(familyKey, previousFamily ?? resource);
  }

  const resources = Object.freeze(
    [...exact.values()].sort(
      (left, right) =>
        left.resourceId.localeCompare(right.resourceId) ||
        left.kind.localeCompare(right.kind),
    ),
  );

  const resolve = (
    namespace: CourtRecordsCitationNamespace,
    resourceId: string,
    requestedKind: CitationKind | null,
    resource: CitationResource | undefined,
  ): CourtRecordsCitationResolution => {
    const reference = frozenReference(namespace, resourceId, requestedKind);
    return resource === undefined
      ? Object.freeze({ status: "unavailable", reference })
      : Object.freeze({ status: "resolved", reference, resource });
  };

  const resolveExact = (
    kind: CitationKind,
    resourceId: string,
  ): CourtRecordsCitationResolution =>
    resolve(
      namespaceForKind(kind),
      resourceId,
      kind,
      exact.get(citationKey(kind, resourceId)),
    );
  const resolveNamespace = (
    namespace: CourtRecordsCitationNamespace,
    resourceId: string,
  ): CourtRecordsCitationResolution =>
    resolve(
      namespace,
      resourceId,
      null,
      byNamespace.get(namespaceKey(namespace, resourceId)),
    );

  const resolveTrialSet = (
    citations: TrialCitationSet,
  ): readonly CourtRecordsCitationResolution[] =>
    Object.freeze([
      ...citations.factIds.map((id) => resolveNamespace("fact", id)),
      ...citations.evidenceIds.map((id) => resolveNamespace("evidence", id)),
      ...citations.testimonyIds.map((id) =>
        resolveNamespace("testimony", id),
      ),
      ...citations.eventIds.map((id) => resolveNamespace("event", id)),
      ...citations.sourceSegmentIds.map((id) =>
        resolveNamespace("source_segment", id),
      ),
    ]);
  const resolveModelSet = (
    citations: ModelCitationSet,
  ): readonly CourtRecordsCitationResolution[] =>
    Object.freeze([
      ...resolveTrialSet(citations),
      ...citations.priorStatementIds.map((id) =>
        resolveNamespace("prior_statement", id),
      ),
    ]);
  const resolveDebriefSet = (
    citations: DebriefCitationSet,
  ): readonly CourtRecordsCitationResolution[] =>
    Object.freeze([
      ...citations.admittedFactIds.map((id) =>
        resolveExact("admitted_fact", id),
      ),
      ...citations.admittedEvidenceIds.map((id) =>
        resolveExact("admitted_evidence", id),
      ),
      ...citations.activeTestimonyIds.map((id) =>
        resolveExact("active_testimony", id),
      ),
      ...citations.transcriptTurnIds.map((id) =>
        resolveExact("transcript_turn", id),
      ),
      ...citations.unadmittedFactIds.map((id) =>
        resolveExact("unadmitted_fact", id),
      ),
      ...citations.unadmittedEvidenceIds.map((id) =>
        resolveExact("unadmitted_evidence", id),
      ),
      ...citations.excludedFactIds.map((id) =>
        resolveExact("excluded_fact", id),
      ),
      ...citations.excludedEvidenceIds.map((id) =>
        resolveExact("excluded_evidence", id),
      ),
      ...citations.strickenTestimonyIds.map((id) =>
        resolveExact("stricken_testimony", id),
      ),
      ...citations.hiddenFactIds.map((id) =>
        resolveExact("hidden_fact", id),
      ),
      ...citations.hiddenSourceSegmentIds.map((id) =>
        resolveExact("source_segment", id),
      ),
      ...citations.coachingInferenceIds.map((id) =>
        resolveExact("coaching_inference", id),
      ),
    ]);

  return Object.freeze({
    resources,
    resolveExact,
    resolveNamespace,
    resolveTrialSet,
    resolveModelSet,
    resolveDebriefSet,
  });
}

export type CourtRecordsDebriefSection =
  | "overallAssessment"
  | "strengths"
  | "weakQuestions"
  | "missedEvidence"
  | "contradictions"
  | "objectionAccuracy"
  | "witnessStrategy"
  | "settlementChoices"
  | "juryMovement"
  | "improvedClosing"
  | "limitations";

export const COURT_RECORDS_DEBRIEF_SECTION_LABELS = Object.freeze({
  overallAssessment: "Overall assessment",
  strengths: "Strengths",
  weakQuestions: "Weak questions",
  missedEvidence: "Missed evidence",
  contradictions: "Contradictions",
  objectionAccuracy: "Objection accuracy",
  witnessStrategy: "Witness strategy",
  settlementChoices: "Settlement choices",
  juryMovement: "Jury movement",
  improvedClosing: "Improved closing",
  limitations: "Limitations",
} satisfies Record<CourtRecordsDebriefSection, string>);

export type CourtRecordsDebriefPoint = Readonly<{
  key: string;
  kind: "assessment" | "coaching_point" | "closing_segment" | "limitation";
  section: CourtRecordsDebriefSection;
  ordinal: number;
  sectionOrdinal: number;
  title: string;
  assessment: string;
  recommendation: string | null;
  basis: FinalDebrief["artifact"]["overallAssessment"]["basis"] | null;
  citations: DebriefCitationSet | null;
}>;

export function flattenCourtRecordsDebrief(
  finalDebrief: CourtRecordsView["finalDebrief"],
): readonly CourtRecordsDebriefPoint[] {
  if (finalDebrief === null) return Object.freeze([]);
  const points: CourtRecordsDebriefPoint[] = [];
  const append = (
    point: Omit<CourtRecordsDebriefPoint, "ordinal" | "key">,
  ): void => {
    points.push(
      Object.freeze({
        ...point,
        ordinal: points.length + 1,
        key: `${point.section}:${point.sectionOrdinal}`,
      }),
    );
  };
  const artifact = finalDebrief.artifact;
  append({
    kind: "assessment",
    section: "overallAssessment",
    sectionOrdinal: 1,
    title: "Overall assessment",
    assessment: artifact.overallAssessment.text,
    recommendation: null,
    basis: artifact.overallAssessment.basis,
    citations: artifact.overallAssessment.citations,
  });
  const coachingSections = [
    "strengths",
    "weakQuestions",
    "missedEvidence",
    "contradictions",
    "objectionAccuracy",
    "witnessStrategy",
    "settlementChoices",
    "juryMovement",
  ] as const;
  for (const section of coachingSections) {
    artifact[section].forEach((point, index) => {
      append({
        kind: "coaching_point",
        section,
        sectionOrdinal: index + 1,
        title: point.title,
        assessment: point.assessment,
        recommendation: point.recommendation,
        basis: point.basis,
        citations: point.citations,
      });
    });
  }
  artifact.improvedClosing.segments.forEach((segment, index) => {
    append({
      kind: "closing_segment",
      section: "improvedClosing",
      sectionOrdinal: index + 1,
      title: `Closing segment ${index + 1}`,
      assessment: segment.text,
      recommendation: null,
      basis: "admitted_record",
      citations: segment.citations,
    });
  });
  artifact.limitations.forEach((limitation, index) => {
    append({
      kind: "limitation",
      section: "limitations",
      sectionOrdinal: index + 1,
      title: `Limitation ${index + 1}`,
      assessment: limitation,
      recommendation: null,
      basis: null,
      citations: null,
    });
  });
  return Object.freeze(points);
}

export type CourtRecordsKnownNumberSummary = Readonly<{
  knownCount: number;
  unavailableCount: number;
  knownSum: number | null;
  knownAverage: number | null;
  knownP95: number | null;
  knownMaximum: number | null;
}>;

function summarizeKnownNumbers(
  values: readonly (number | null)[],
): CourtRecordsKnownNumberSummary {
  const known = values
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (known.length === 0) {
    return Object.freeze({
      knownCount: 0,
      unavailableCount: values.length,
      knownSum: null,
      knownAverage: null,
      knownP95: null,
      knownMaximum: null,
    });
  }
  const knownSum = known.reduce((total, value) => total + value, 0);
  return Object.freeze({
    knownCount: known.length,
    unavailableCount: values.length - known.length,
    knownSum,
    knownAverage: knownSum / known.length,
    knownP95: known[Math.ceil(known.length * 0.95) - 1] ?? null,
    knownMaximum: known.at(-1) ?? null,
  });
}

export type CourtRecordsTokenSummary = Readonly<{
  knownCallCount: number;
  unavailableCallCount: number;
  knownTotals: Readonly<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
  }> | null;
}>;

export type CourtRecordsMetrics = Readonly<{
  events: number;
  transcript: Readonly<{ total: number; active: number; stricken: number }>;
  procedure: Readonly<{
    objections: Readonly<Record<Objection["status"], number>>;
    rulings: Readonly<Record<Ruling["kind"], number>>;
    recoveries: Readonly<Record<Recovery["status"], number>>;
    interruptions: Readonly<Record<Interruption["status"], number>>;
  }>;
  facts: Readonly<{
    total: number;
    restricted: number;
    byStatus: Readonly<Record<FactLifecycle["status"], number>>;
  }>;
  evidence: Readonly<{
    total: number;
    byStatus: Readonly<Record<EvidenceLifecycle["status"], number>>;
  }>;
  models: Readonly<{
    total: number;
    byStatus: Readonly<Record<ModelCall["status"], number>>;
    retryCount: number;
    repairAttemptCount: number;
    validationFailureCount: number;
    fallbackUsedCount: number;
    latencyMs: CourtRecordsKnownNumberSummary;
    estimatedCostUsd: CourtRecordsKnownNumberSummary;
    usage: CourtRecordsTokenSummary;
  }>;
  audio: Readonly<{
    total: number;
    byKind: Readonly<Record<AudioEntry["record"]["kind"], number>>;
    byBinding: Readonly<Record<AudioEntry["canonicalBinding"]["status"], number>>;
    rawAudioRetainedCount: number;
  }>;
  citations: number;
  debriefPoints: number;
}>;

function summarizeCourtRecordsMetricsWithDebrief(
  view: CourtRecordsView,
  debriefPointCount: number,
): CourtRecordsMetrics {
  const transcript = { active: 0, stricken: 0 } satisfies Record<
    TranscriptTurn["status"],
    number
  >;
  for (const turn of view.transcript) transcript[turn.status] += 1;
  const objections = {
    pending: 0,
    sustained: 0,
    overruled: 0,
    withdrawn: 0,
  } satisfies Record<Objection["status"], number>;
  for (const objection of view.procedure.objections) {
    objections[objection.status] += 1;
  }
  const rulings = {
    objection: 0,
    evidence: 0,
    assertion: 0,
    strike: 0,
  } satisfies Record<Ruling["kind"], number>;
  for (const ruling of view.procedure.rulings) rulings[ruling.kind] += 1;
  const recoveries = {
    awaiting_recovery: 0,
    recovered: 0,
  } satisfies Record<Recovery["status"], number>;
  for (const recovery of view.procedure.recoveries) {
    recoveries[recovery.status] += 1;
  }
  const interruptions = {
    active: 0,
    cancelled: 0,
    resolved: 0,
    resumed: 0,
  } satisfies Record<Interruption["status"], number>;
  for (const interruption of view.procedure.interruptions) {
    interruptions[interruption.status] += 1;
  }
  const facts = {
    hidden: 0,
    proposed: 0,
    disputed: 0,
    verified: 0,
    admitted: 0,
    excluded: 0,
    stricken: 0,
  } satisfies Record<FactLifecycle["status"], number>;
  let restrictedFacts = 0;
  for (const fact of view.lifecycles.facts) {
    facts[fact.status] += 1;
    if (fact.visibility === "restricted") restrictedFacts += 1;
  }
  const evidence = {
    uploaded: 0,
    indexed: 0,
    offered: 0,
    admitted: 0,
    excluded: 0,
    withdrawn: 0,
  } satisfies Record<EvidenceLifecycle["status"], number>;
  for (const item of view.lifecycles.evidence) evidence[item.status] += 1;
  const modelStatuses = {
    in_progress: 0,
    accepted: 0,
    failed: 0,
    cancelled: 0,
    stale: 0,
  } satisfies Record<ModelCall["status"], number>;
  let retryCount = 0;
  let repairAttemptCount = 0;
  let validationFailureCount = 0;
  let fallbackUsedCount = 0;
  const knownUsages: NonNullable<ModelCall["usage"]>[] = [];
  for (const call of view.modelCalls) {
    modelStatuses[call.status] += 1;
    retryCount += call.retryCount;
    repairAttemptCount += call.attempts.filter(
      (attempt) => attempt.mode === "repair",
    ).length;
    validationFailureCount += call.validationFailureCount;
    if (call.fallback.used) fallbackUsedCount += 1;
    if (call.usage !== null) knownUsages.push(call.usage);
  }
  const tokenTotals =
    knownUsages.length === 0
      ? null
      : Object.freeze(
          knownUsages.reduce(
            (totals, usage) => ({
              inputTokens: totals.inputTokens + usage.inputTokens,
              outputTokens: totals.outputTokens + usage.outputTokens,
              totalTokens: totals.totalTokens + usage.totalTokens,
              cachedInputTokens:
                totals.cachedInputTokens + usage.cachedInputTokens,
              cacheWriteTokens:
                totals.cacheWriteTokens + usage.cacheWriteTokens,
              reasoningTokens: totals.reasoningTokens + usage.reasoningTokens,
            }),
            {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
            },
          ),
        );
  const audioKinds = { user_speech: 0, playback: 0 } satisfies Record<
    AudioEntry["record"]["kind"],
    number
  >;
  const audioBindings = {
    local_observation: 0,
    transcript_turn_verified: 0,
    interruption_verified: 0,
  } satisfies Record<AudioEntry["canonicalBinding"]["status"], number>;
  for (const entry of view.audio.entries) {
    audioKinds[entry.record.kind] += 1;
    audioBindings[entry.canonicalBinding.status] += 1;
  }
  const citationCount = new Set(
    [
      ...view.citationResources,
      ...(view.finalDebrief?.citationResources ?? []),
    ].map((resource) => citationKey(resource.kind, resource.resourceId)),
  ).size;

  return Object.freeze({
    events: view.replayIntegrity.eventCount,
    transcript: Object.freeze({ total: view.transcript.length, ...transcript }),
    procedure: Object.freeze({
      objections: Object.freeze(objections),
      rulings: Object.freeze(rulings),
      recoveries: Object.freeze(recoveries),
      interruptions: Object.freeze(interruptions),
    }),
    facts: Object.freeze({
      total: view.lifecycles.facts.length,
      restricted: restrictedFacts,
      byStatus: Object.freeze(facts),
    }),
    evidence: Object.freeze({
      total: view.lifecycles.evidence.length,
      byStatus: Object.freeze(evidence),
    }),
    models: Object.freeze({
      total: view.modelCalls.length,
      byStatus: Object.freeze(modelStatuses),
      retryCount,
      repairAttemptCount,
      validationFailureCount,
      fallbackUsedCount,
      latencyMs: summarizeKnownNumbers(
        view.modelCalls.map((call) => call.latencyMs),
      ),
      estimatedCostUsd: summarizeKnownNumbers(
        view.modelCalls.map((call) => call.estimatedCostUsd),
      ),
      usage: Object.freeze({
        knownCallCount: knownUsages.length,
        unavailableCallCount: view.modelCalls.length - knownUsages.length,
        knownTotals: tokenTotals,
      }),
    }),
    audio: Object.freeze({
      total: view.audio.entries.length,
      byKind: Object.freeze(audioKinds),
      byBinding: Object.freeze(audioBindings),
      rawAudioRetainedCount: view.audio.entries.filter(
        (entry) => entry.rawAudioRetained,
      ).length,
    }),
    citations: citationCount,
    debriefPoints: debriefPointCount,
  });
}

export function summarizeCourtRecordsMetrics(
  view: CourtRecordsView,
): CourtRecordsMetrics {
  assertCourtRecordsViewBindings(view);
  return summarizeCourtRecordsMetricsWithDebrief(
    view,
    flattenCourtRecordsDebrief(view.finalDebrief).length,
  );
}

export type CourtRecordsPanelItemMap = {
  eventTree: CourtRecordsEventTreeRow;
  transcript: TranscriptTurn;
  objections: Objection;
  rulings: Ruling;
  recoveries: Recovery;
  interruptions: Interruption;
  facts: FactLifecycle;
  evidence: EvidenceLifecycle;
  modelCalls: ModelCall;
  audio: AudioEntry;
  citations: CitationResource;
  debrief: CourtRecordsDebriefPoint;
};

export type CourtRecordsPanelKey = keyof CourtRecordsPanelItemMap;

export const COURT_RECORDS_PANEL_PAGE_SIZES = Object.freeze({
  eventTree: 50,
  transcript: 25,
  objections: 20,
  rulings: 20,
  recoveries: 20,
  interruptions: 20,
  facts: 20,
  evidence: 20,
  modelCalls: 15,
  audio: 20,
  citations: 25,
  debrief: 4,
} satisfies Record<CourtRecordsPanelKey, number>);

export const COURT_RECORDS_LIST_PAGE_SIZE = 12;

type CourtRecordsPanelItems = Readonly<{
  [Key in CourtRecordsPanelKey]: readonly CourtRecordsPanelItemMap[Key][];
}>;

export type CourtRecordsWorkspaceViewModel = Readonly<{
  view: CourtRecordsView;
  eventRows: readonly CourtRecordsEventTreeRow[];
  citationIndex: CourtRecordsCitationIndex;
  debriefPoints: readonly CourtRecordsDebriefPoint[];
  metrics: CourtRecordsMetrics;
  panels: CourtRecordsPanelItems;
}>;

export function createCourtRecordsWorkspaceViewModel(
  view: CourtRecordsView,
): CourtRecordsWorkspaceViewModel {
  assertCourtRecordsViewBindings(view);
  const eventRows = flattenCourtRecordsEventTree(view.eventTree);
  const citationIndex = createCourtRecordsCitationIndex(view);
  const debriefPoints = flattenCourtRecordsDebrief(view.finalDebrief);
  const metrics = summarizeCourtRecordsMetricsWithDebrief(
    view,
    debriefPoints.length,
  );
  const panels: CourtRecordsPanelItems = Object.freeze({
    eventTree: eventRows,
    transcript: view.transcript,
    objections: view.procedure.objections,
    rulings: view.procedure.rulings,
    recoveries: view.procedure.recoveries,
    interruptions: view.procedure.interruptions,
    facts: view.lifecycles.facts,
    evidence: view.lifecycles.evidence,
    modelCalls: view.modelCalls,
    audio: view.audio.entries,
    citations: citationIndex.resources,
    debrief: debriefPoints,
  });
  return Object.freeze({
    view,
    eventRows,
    citationIndex,
    debriefPoints,
    metrics,
    panels,
  });
}

export function paginateCourtRecordsPanel<Key extends CourtRecordsPanelKey>(
  model: CourtRecordsWorkspaceViewModel,
  key: Key,
  requestedPage: number,
): CourtRecordsPage<CourtRecordsPanelItemMap[Key]> {
  return paginateCourtRecords(
    model.panels[key],
    requestedPage,
    COURT_RECORDS_PANEL_PAGE_SIZES[key],
  );
}

export function paginateCourtRecordsList(
  summaries: CourtRecordsListResponse | readonly CourtRecordsTrialSummary[],
  requestedPage: number,
): CourtRecordsPage<CourtRecordsTrialSummary> {
  return paginateCourtRecords(
    summaries,
    requestedPage,
    COURT_RECORDS_LIST_PAGE_SIZE,
  );
}
