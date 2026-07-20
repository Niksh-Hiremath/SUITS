"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import styles from "./court-records-workspace.module.css";
import {
  COURT_RECORDS_ACTOR_ROLE_LABELS,
  COURT_RECORDS_ATTEMPT_MODE_LABELS,
  COURT_RECORDS_ATTEMPT_STATUS_LABELS,
  COURT_RECORDS_AUDIO_BINDING_LABELS,
  COURT_RECORDS_AUDIO_KIND_LABELS,
  COURT_RECORDS_CITATION_KIND_LABELS,
  COURT_RECORDS_CITATION_STRATUM_LABELS,
  COURT_RECORDS_DEBRIEF_SECTION_LABELS,
  COURT_RECORDS_EVIDENCE_STATUS_LABELS,
  COURT_RECORDS_EVENT_SOURCE_LABELS,
  COURT_RECORDS_EVENT_TYPE_LABELS,
  COURT_RECORDS_FACT_STATUS_LABELS,
  COURT_RECORDS_FACT_VISIBILITY_LABELS,
  COURT_RECORDS_HONEST_COPY,
  COURT_RECORDS_INTERRUPTION_STATUS_LABELS,
  COURT_RECORDS_MODEL_CALL_CLASS_LABELS,
  COURT_RECORDS_MODEL_STATUS_LABELS,
  COURT_RECORDS_MODEL_TASK_LABELS,
  COURT_RECORDS_OBJECTION_GROUND_LABELS,
  COURT_RECORDS_OBJECTION_REMEDY_LABELS,
  COURT_RECORDS_OBJECTION_STATUS_LABELS,
  COURT_RECORDS_PHASE_LABELS,
  COURT_RECORDS_RECOVERY_STATUS_LABELS,
  COURT_RECORDS_RULING_DISPOSITION_LABELS,
  COURT_RECORDS_RULING_KIND_LABELS,
  COURT_RECORDS_SIDE_LABELS,
  COURT_RECORDS_TRANSCRIPT_STATUS_LABELS,
  COURT_RECORDS_TRIAL_STATUS_LABELS,
  createCourtRecordsWorkspaceViewModel,
  paginateCourtRecordsPanel,
  type CourtRecordsCitationResolution,
  type CourtRecordsPanelKey,
  type CourtRecordsWorkspaceViewModel,
} from "./court-records-view-model";
import type { CourtRecordsPage } from "./court-records-pagination";
import type { CourtRecordsView } from "../../domain/court-records";

type RecordSection =
  | "overview"
  | "transcript"
  | "procedure"
  | "lifecycles"
  | "modelCalls"
  | "audio"
  | "citations"
  | "debrief"
  | "eventTree";

const SECTION_LABELS: Readonly<Record<RecordSection, string>> = Object.freeze({
  overview: "Overview",
  transcript: "Transcript",
  procedure: "Procedure",
  lifecycles: "Facts & evidence",
  modelCalls: "Model calls",
  audio: "Audio audit",
  citations: "Citations",
  debrief: "Debrief",
  eventTree: "Event ledger",
});

const INITIAL_PAGES: Readonly<Record<CourtRecordsPanelKey, number>> =
  Object.freeze({
    eventTree: 1,
    transcript: 1,
    objections: 1,
    rulings: 1,
    recoveries: 1,
    interruptions: 1,
    facts: 1,
    evidence: 1,
    modelCalls: 1,
    audio: 1,
    citations: 1,
    debrief: 1,
  });

const INLINE_CITATION_LIMIT = 12;
const INLINE_HISTORY_LIMIT = 8;

type CourtRecordDetailProps = Readonly<{
  view: CourtRecordsView;
  downloadStatus: "idle" | "working" | "success" | "error";
  downloadMessage: string | null;
  onDownload: () => void;
}>;

type PageSetter = (key: CourtRecordsPanelKey, page: number) => void;

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string | number | null): string {
  if (value === null) return "Unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatMilliseconds(value: number | null): string {
  return value === null ? COURT_RECORDS_HONEST_COPY.unavailableMetric : `${value} ms`;
}

function formatCost(value: number | null): string {
  return value === null
    ? COURT_RECORDS_HONEST_COPY.unavailableMetric
    : new Intl.NumberFormat("en", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      }).format(value);
}

function badgeClass(value: string): string {
  if (["verified", "accepted", "admitted", "complete", "completed", "recovered"].includes(value)) {
    return `${styles.badge} ${styles.goodBadge}`;
  }
  if (["failed", "stricken", "excluded", "cancelled"].includes(value)) {
    return `${styles.badge} ${styles.failedBadge}`;
  }
  return `${styles.badge} ${styles.warnBadge}`;
}

function Meta({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{children}</span>
    </div>
  );
}

function EmptyPanel({ children }: Readonly<{ children: ReactNode }>) {
  return <p className={styles.emptyCopy}>{children}</p>;
}

function Pager<Item>({
  label,
  page,
  onPageChange,
}: Readonly<{
  label: string;
  page: CourtRecordsPage<Item>;
  onPageChange: (page: number) => void;
}>) {
  if (page.pageCount <= 1) return null;
  return (
    <nav className={styles.pagination} aria-label={`${label} pagination`}>
      <span>
        {page.start}-{page.end} of {page.total}
      </span>
      <div className={styles.pageActions}>
        <button
          className={styles.pageButton}
          disabled={page.page === 1}
          onClick={() => onPageChange(page.page - 1)}
          type="button"
        >
          Previous
        </button>
        <button
          className={styles.pageButton}
          disabled={page.page === page.pageCount}
          onClick={() => onPageChange(page.page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

function CitationBadges({
  resolutions,
}: Readonly<{ resolutions: readonly CourtRecordsCitationResolution[] }>) {
  if (resolutions.length === 0) return null;
  const visible = resolutions.slice(0, INLINE_CITATION_LIMIT);
  return (
    <div className={styles.citationGroup} aria-label="Record citations">
      {visible.map((resolution, index) => {
        const key = `${resolution.reference.namespace}:${resolution.reference.resourceId}:${index}`;
        return resolution.status === "resolved" ? (
          <span
            className={styles.citationChip}
            key={key}
            title={`${COURT_RECORDS_CITATION_STRATUM_LABELS[resolution.resource.stratum]} - ${resolution.resource.resourceId}`}
          >
            {COURT_RECORDS_CITATION_KIND_LABELS[resolution.resource.kind]}: {resolution.resource.title}
          </span>
        ) : (
          <span className={styles.citationChip} key={key}>
            Citation unavailable in this projection
          </span>
        );
      })}
      {resolutions.length > visible.length ? (
        <span className={styles.inlineMeta}>
          {resolutions.length - visible.length} additional citations are available in the JSON export.
        </span>
      ) : null}
    </div>
  );
}

function PanelHeader({
  kicker,
  title,
  count,
}: Readonly<{ kicker: string; title: string; count?: number }>) {
  return (
    <header className={styles.panelHeader}>
      <div>
        <p className={styles.sectionKicker}>{kicker}</p>
        <h3>{title}</h3>
      </div>
      {count === undefined ? null : <span className={styles.badge}>{count} items</span>}
    </header>
  );
}

function OverviewPanel({ model }: Readonly<{ model: CourtRecordsWorkspaceViewModel }>) {
  const { view, metrics } = model;
  const knownCost = metrics.models.estimatedCostUsd.knownSum;
  const knownLatency = metrics.models.latencyMs.knownAverage;
  return (
    <section className={styles.panel} data-records-section="overview" id="record-panel-overview">
      <PanelHeader kicker="Integrity first" title="Record overview" />
      <p className={styles.boundaryNote}>
        {COURT_RECORDS_HONEST_COPY.projectionHash} A valid projection preserves excluded,
        stricken, hidden, and coaching-only strata without presenting them as admitted proof.
      </p>
      <div className={styles.overviewGrid}>
        <article className={styles.overviewCard}>
          <span className={badgeClass(view.replayIntegrity.status)}>Replay verified</span>
          <strong className={styles.metaValue}>Append-only head</strong>
          <p className={styles.muted}>
            {view.replayIntegrity.eventCount} events through sequence {view.replayIntegrity.lastSequence}.
          </p>
        </article>
        <article className={styles.overviewCard}>
          <span className={styles.metricLabel}>Projection SHA-256</span>
          <strong className={`${styles.metaValue} ${styles.mono}`}>
            {view.replayIntegrity.privacySafeProjectionHash}
          </strong>
          <p className={styles.muted}>{COURT_RECORDS_HONEST_COPY.projectionHash}</p>
        </article>
        <article className={styles.overviewCard}>
          <span className={styles.metricLabel}>Current disposition</span>
          <strong className={styles.metaValue}>
            {COURT_RECORDS_PHASE_LABELS[view.summary.phase]} - {COURT_RECORDS_TRIAL_STATUS_LABELS[view.summary.status]}
          </strong>
          <p className={styles.muted}>State version {view.summary.stateVersion}.</p>
        </article>
        <article className={styles.overviewCard}>
          <span className={styles.metricLabel}>Model observability</span>
          <strong className={styles.metaValue}>
            {knownLatency === null
              ? COURT_RECORDS_HONEST_COPY.unavailableMetric
              : `${Math.round(knownLatency)} ms average across ${metrics.models.latencyMs.knownCount} reported calls`}
          </strong>
          <p className={styles.muted}>
            Known reported cost ({metrics.models.estimatedCostUsd.knownCount}/{metrics.models.total} calls): {knownCost === null ? COURT_RECORDS_HONEST_COPY.unavailableMetric : formatCost(knownCost)}
          </p>
        </article>
        <article className={styles.overviewCard}>
          <span className={styles.metricLabel}>Fallback policy</span>
          <strong className={styles.metaValue}>Validated model or fail</strong>
          <p className={styles.muted}>{COURT_RECORDS_HONEST_COPY.fallback}</p>
        </article>
        <article className={styles.overviewCard}>
          <span className={styles.metricLabel}>Audio retention</span>
          <strong className={styles.metaValue}>{metrics.audio.total} metadata records</strong>
          <p className={styles.muted}>{COURT_RECORDS_HONEST_COPY.rawAudio}</p>
        </article>
      </div>
      <div className={styles.metaGrid}>
        <Meta label="Trial started">{formatDateTime(view.summary.startedAt)}</Meta>
        <Meta label="Last updated">{formatDateTime(view.summary.updatedAt)}</Meta>
        <Meta label="Last event"><span className={styles.mono}>{view.summary.lastEventId}</span></Meta>
        <Meta label="Debrief">{view.finalDebrief === null ? "Not generated" : "Terra coaching artifact available"}</Meta>
      </div>
    </section>
  );
}

function TranscriptPanel({ model, pageNumber, setPage }: Readonly<{ model: CourtRecordsWorkspaceViewModel; pageNumber: number; setPage: PageSetter }>) {
  const page = paginateCourtRecordsPanel(model, "transcript", pageNumber);
  return (
    <section className={styles.panel} data-records-section="transcript" id="record-panel-transcript">
      <PanelHeader kicker="Historical speech" title="Transcript" count={page.total} />
      <p className={styles.boundaryNote}>
        Active transcript is unstricken historical speech, not automatically admitted proof.
        Stricken testimony remains visible for audit and is excluded from jury consideration.
      </p>
      {page.items.length === 0 ? <EmptyPanel>No transcript turns were recorded.</EmptyPanel> : (
        <ol className={styles.list}>
          {page.items.map((turn) => (
            <li className={`${styles.transcriptTurn} ${turn.status === "stricken" ? styles.strickenTurn : ""}`} key={turn.turnId}>
              <span className={styles.turnOrdinal}>#{turn.ordinal}</span>
              <div>
                <div className={styles.cardHeader}>
                  <strong>{COURT_RECORDS_ACTOR_ROLE_LABELS[turn.actor.role]}</strong>
                  <span className={turn.status === "stricken" ? `${styles.badge} ${styles.strickenBadge}` : `${styles.badge} ${styles.goodBadge}`}>
                    {COURT_RECORDS_TRANSCRIPT_STATUS_LABELS[turn.status]}
                  </span>
                </div>
                <p className={styles.turnText}>{turn.text}</p>
                <span className={styles.inlineMeta}>
                  <span>{COURT_RECORDS_SIDE_LABELS[turn.actor.side]}</span>
                  <span className={styles.mono}>turn {turn.turnId}</span>
                </span>
                <CitationBadges resolutions={model.citationIndex.resolveTrialSet(turn.citations)} />
              </div>
            </li>
          ))}
        </ol>
      )}
      <Pager label="Transcript" page={page} onPageChange={(next) => setPage("transcript", next)} />
    </section>
  );
}

function ProcedurePanel({ model, pages, setPage }: Readonly<{ model: CourtRecordsWorkspaceViewModel; pages: Readonly<Record<CourtRecordsPanelKey, number>>; setPage: PageSetter }>) {
  const objections = paginateCourtRecordsPanel(model, "objections", pages.objections);
  const rulings = paginateCourtRecordsPanel(model, "rulings", pages.rulings);
  const recoveries = paginateCourtRecordsPanel(model, "recoveries", pages.recoveries);
  const interruptions = paginateCourtRecordsPanel(model, "interruptions", pages.interruptions);
  return (
    <section className={styles.panel} data-records-section="procedure" id="record-panel-procedure">
      <PanelHeader kicker="Deterministic procedure" title="Objections, rulings & recovery" />
      <p className={styles.boundaryNote}>
        Normalized rulings are authoritative. Historical strike rulings with no recorded
        reason stay explicitly unavailable; judicial speech is never used to invent one.
        Failure codes and step text remain redacted.
      </p>

      <h4>Objections</h4>
      {objections.items.length === 0 ? <EmptyPanel>No objections were recorded.</EmptyPanel> : (
        <ul className={styles.list}>
          {objections.items.map((objection) => (
            <li className={styles.card} key={objection.objectionId}>
              <div className={styles.cardHeader}>
                <strong>{COURT_RECORDS_OBJECTION_GROUND_LABELS[objection.ground]}</strong>
                <span className={badgeClass(objection.status)}>{COURT_RECORDS_OBJECTION_STATUS_LABELS[objection.status]}</span>
              </div>
              <p>{objection.rulingReason ?? "No ruling reason is recorded."}</p>
              <div className={styles.metaGrid}>
                <Meta label="Remedy">{objection.remedy === null ? "Pending" : COURT_RECORDS_OBJECTION_REMEDY_LABELS[objection.remedy]}</Meta>
                <Meta label="Question"><span className={styles.mono}>{objection.questionId}</span></Meta>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager label="Objections" page={objections} onPageChange={(next) => setPage("objections", next)} />

      <h4>Normalized rulings</h4>
      {rulings.items.length === 0 ? <EmptyPanel>No rulings were recorded.</EmptyPanel> : (
        <ul className={styles.list}>
          {rulings.items.map((ruling) => {
            const reason = ruling.reason ?? "Reason not recorded in this historical event.";
            return (
              <li className={styles.card} key={ruling.rulingEventId}>
                <div className={styles.cardHeader}>
                  <strong>{COURT_RECORDS_RULING_KIND_LABELS[ruling.kind]}</strong>
                  <span className={badgeClass(ruling.disposition)}>{COURT_RECORDS_RULING_DISPOSITION_LABELS[ruling.disposition]}</span>
                </div>
                <p>{reason}</p>
                {ruling.kind === "strike" ? <p className={styles.muted}>Motion basis: {ruling.motionReason}</p> : null}
                <span className={styles.inlineMeta}>
                  <span>Ruling sequence {ruling.rulingSequence}</span>
                  <span className={styles.mono}>source {ruling.sourceEventId}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Pager label="Rulings" page={rulings} onPageChange={(next) => setPage("rulings", next)} />

      <h4>Recoveries</h4>
      {recoveries.items.length === 0 ? <EmptyPanel>No deterministic recovery was required.</EmptyPanel> : (
        <ul className={styles.list}>
          {recoveries.items.map((recovery) => (
            <li className={styles.card} key={recovery.failureEventId}>
              <div className={styles.cardHeader}>
                <strong>Failure at sequence {recovery.failureSequence}</strong>
                <span className={badgeClass(recovery.status)}>{COURT_RECORDS_RECOVERY_STATUS_LABELS[recovery.status]}</span>
              </div>
              <p>Diagnostic code, step, and user message are redacted from this owner-facing projection.</p>
              <span className={styles.inlineMeta}>
                <span>{recovery.retryable ? "Retryable" : "Not retryable"}</span>
                <span>{recovery.recoveredAt === null ? "Not recovered" : `Recovered ${formatDateTime(recovery.recoveredAt)}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Pager label="Recoveries" page={recoveries} onPageChange={(next) => setPage("recoveries", next)} />

      <h4>Speech interruptions</h4>
      {interruptions.items.length === 0 ? <EmptyPanel>No speech interruptions were recorded.</EmptyPanel> : (
        <ul className={styles.list}>
          {interruptions.items.map((interruption) => (
            <li className={styles.card} key={interruption.interruptId}>
              <div className={styles.cardHeader}>
                <strong className={styles.mono}>{interruption.interruptId}</strong>
                <span className={badgeClass(interruption.status)}>{COURT_RECORDS_INTERRUPTION_STATUS_LABELS[interruption.status]}</span>
              </div>
              <span className={styles.inlineMeta}>
                <span className={styles.mono}>response {interruption.interruptedResponseId}</span>
                <span>{interruption.objectionId === null ? "No objection binding" : `Objection ${interruption.objectionId}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Pager label="Interruptions" page={interruptions} onPageChange={(next) => setPage("interruptions", next)} />
    </section>
  );
}

function LifecyclesPanel({ model, pages, setPage }: Readonly<{ model: CourtRecordsWorkspaceViewModel; pages: Readonly<Record<CourtRecordsPanelKey, number>>; setPage: PageSetter }>) {
  const facts = paginateCourtRecordsPanel(model, "facts", pages.facts);
  const evidence = paginateCourtRecordsPanel(model, "evidence", pages.evidence);
  return (
    <section className={styles.panel} data-records-section="lifecycles" id="record-panel-lifecycles">
      <PanelHeader kicker="Status over assertion" title="Facts & evidence" />
      <p className={styles.boundaryNote}>
        A generated assertion is not automatically a fact. Restricted facts are visible
        to this record owner but are not public courtroom proof. Every lifecycle remains append-only.
      </p>
      <h4>Facts</h4>
      {facts.items.length === 0 ? <EmptyPanel>No fact lifecycles are visible.</EmptyPanel> : (
        <div className={styles.gridTwo}>
          {facts.items.map((fact) => (
            <article className={styles.card} key={fact.factId}>
              <div className={styles.cardHeader}>
                <strong>{fact.title}</strong>
                <span className={badgeClass(fact.status)}>{COURT_RECORDS_FACT_STATUS_LABELS[fact.status]}</span>
              </div>
              <p className={styles.muted}>{COURT_RECORDS_FACT_VISIBILITY_LABELS[fact.visibility]}</p>
              <ul className={styles.transitionList}>
                {fact.transitions.slice(0, INLINE_HISTORY_LIMIT).map((transition) => (
                  <li key={transition.eventId}>Sequence {transition.sequence}: {humanize(transition.status)}</li>
                ))}
                {fact.transitions.length > INLINE_HISTORY_LIMIT ? (
                  <li>{fact.transitions.length - INLINE_HISTORY_LIMIT} additional lifecycle entries remain in the JSON export.</li>
                ) : null}
              </ul>
            </article>
          ))}
        </div>
      )}
      <Pager label="Facts" page={facts} onPageChange={(next) => setPage("facts", next)} />

      <h4>Evidence</h4>
      {evidence.items.length === 0 ? <EmptyPanel>No evidence lifecycles are visible.</EmptyPanel> : (
        <div className={styles.gridTwo}>
          {evidence.items.map((item) => (
            <article className={styles.card} key={item.evidenceId}>
              <div className={styles.cardHeader}>
                <strong>{item.title}</strong>
                <span className={badgeClass(item.status)}>{COURT_RECORDS_EVIDENCE_STATUS_LABELS[item.status]}</span>
              </div>
              <ul className={styles.transitionList}>
                {item.transitions.slice(0, INLINE_HISTORY_LIMIT).map((transition) => (
                  <li key={transition.eventId}>Sequence {transition.sequence}: {humanize(transition.status)}</li>
                ))}
                {item.transitions.length > INLINE_HISTORY_LIMIT ? (
                  <li>{item.transitions.length - INLINE_HISTORY_LIMIT} additional lifecycle entries remain in the JSON export.</li>
                ) : null}
              </ul>
            </article>
          ))}
        </div>
      )}
      <Pager label="Evidence" page={evidence} onPageChange={(next) => setPage("evidence", next)} />
    </section>
  );
}

function ModelCallsPanel({ model, pageNumber, setPage }: Readonly<{ model: CourtRecordsWorkspaceViewModel; pageNumber: number; setPage: PageSetter }>) {
  const page = paginateCourtRecordsPanel(model, "modelCalls", pageNumber);
  return (
    <section className={styles.panel} data-records-section="modelCalls" id="record-panel-modelCalls">
      <PanelHeader kicker="Validated proposals" title="Model-call audit" count={page.total} />
      <p className={styles.boundaryNote}>
        {COURT_RECORDS_HONEST_COPY.fallback} Repair and retry attempts are validation work,
        not fallback answers. {COURT_RECORDS_HONEST_COPY.knowledgeScope}
      </p>
      {page.items.length === 0 ? <EmptyPanel>No model calls are available.</EmptyPanel> : (
        <ul className={styles.list}>
          {page.items.map((call) => (
            <li className={styles.card} key={call.callId}>
              <div className={styles.cardHeader}>
                <div>
                  <strong>{COURT_RECORDS_MODEL_TASK_LABELS[call.task]}</strong>
                  <span className={styles.cardMeta}>
                    <span>{COURT_RECORDS_MODEL_CALL_CLASS_LABELS[call.callClass]}</span>
                    <span>{call.model}</span>
                    <span>{call.provider}</span>
                  </span>
                </div>
                <span className={badgeClass(call.status)}>{COURT_RECORDS_MODEL_STATUS_LABELS[call.status]}</span>
              </div>
              <div className={styles.metaGrid}>
                <Meta label="Latency">{formatMilliseconds(call.latencyMs)}</Meta>
                <Meta label="Estimated cost">{formatCost(call.estimatedCostUsd)}</Meta>
                <Meta label="Usage">{call.usage === null ? COURT_RECORDS_HONEST_COPY.unavailableMetric : `${call.usage.totalTokens} total tokens`}</Meta>
                <Meta label="Citations">{call.acceptedCitationCount} accepted; {call.restrictedCitationCount} restricted</Meta>
                <Meta label="Retries">{call.retryCount}</Meta>
                <Meta label="Validation failures">{call.validationFailureCount}</Meta>
              </div>
              <p className={styles.muted}>
                Knowledge scope verified: {call.knowledgeScope.factCount} facts, {call.knowledgeScope.evidenceCount} evidence items,
                {" "}{call.knowledgeScope.testimonyCount} testimony items, {call.knowledgeScope.priorStatementCount} prior statements,
                {" "}{call.knowledgeScope.sourceSegmentCount} source segments, {call.knowledgeScope.publicRecordEventCount} public events,
                {" "}{call.knowledgeScope.currentExchangeCount} current exchanges. Scoped content is not disclosed.
              </p>
              <p className={styles.muted}>Fallback: unavailable and unused. Repairs are not fallbacks.</p>
              <ul className={styles.attemptList}>
                {call.attempts.slice(0, INLINE_HISTORY_LIMIT).map((attempt) => (
                  <li key={attempt.attempt}>
                    {COURT_RECORDS_ATTEMPT_MODE_LABELS[attempt.mode]} - {COURT_RECORDS_ATTEMPT_STATUS_LABELS[attempt.status]}; {attempt.latencyMs} ms; usage {attempt.usage === null ? "unavailable, not zero" : `${attempt.usage.totalTokens} tokens`}; {attempt.validationIssueCodes.length} validation issues
                  </li>
                ))}
                {call.attempts.length > INLINE_HISTORY_LIMIT ? (
                  <li>{call.attempts.length - INLINE_HISTORY_LIMIT} additional attempts remain in the JSON export.</li>
                ) : null}
              </ul>
              <CitationBadges resolutions={model.citationIndex.resolveModelSet(call.acceptedCitations)} />
            </li>
          ))}
        </ul>
      )}
      <Pager label="Model calls" page={page} onPageChange={(next) => setPage("modelCalls", next)} />
    </section>
  );
}

function AudioPanel({ model, pageNumber, setPage }: Readonly<{ model: CourtRecordsWorkspaceViewModel; pageNumber: number; setPage: PageSetter }>) {
  const page = paginateCourtRecordsPanel(model, "audio", pageNumber);
  return (
    <section className={styles.panel} data-records-section="audio" id="record-panel-audio">
      <PanelHeader kicker="Metadata, not media" title="Local audio audit" count={page.total} />
      <p className={styles.boundaryNote}>
        {COURT_RECORDS_HONEST_COPY.rawAudio} A verified identity binding connects metadata
        to a canonical turn or interruption; it does not verify audio content.
      </p>
      {page.items.length === 0 ? <EmptyPanel>No durable audio metadata was recorded for this hearing.</EmptyPanel> : (
        <ul className={styles.list}>
          {page.items.map((entry) => {
            const record = entry.record;
            return (
              <li className={styles.card} key={record.recordId}>
                <div className={styles.cardHeader}>
                  <strong>{COURT_RECORDS_AUDIO_KIND_LABELS[record.kind]}</strong>
                  <span className={badgeClass(record.terminalStatus)}>{humanize(record.terminalStatus)}</span>
                </div>
                <p>{COURT_RECORDS_AUDIO_BINDING_LABELS[entry.canonicalBinding.status]}</p>
                <div className={styles.metaGrid}>
                  <Meta label="Observed">{formatDateTime(record.observedAtEpochMs)}</Meta>
                  <Meta label="Duration">{record.aggregateDurationMs} ms</Meta>
                  <Meta label="Scene actor">{humanize(record.sceneActor)}</Meta>
                  <Meta label="Purpose">{record.kind === "playback" ? humanize(record.purpose) : humanize(record.mode)}</Meta>
                  <Meta label="Terminal reason">{humanize(record.terminalReason)}</Meta>
                  <Meta label="Raw audio retained">No</Meta>
                </div>
                <span className={styles.inlineMeta}>
                  <span>{record.observationSource}; {record.authority}</span>
                  <span>{entry.canonicalBinding.turnId === null ? "No transcript-turn binding" : `Turn ${entry.canonicalBinding.turnId}`}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Pager label="Audio audit" page={page} onPageChange={(next) => setPage("audio", next)} />
    </section>
  );
}

function CitationsPanel({ model, pageNumber, setPage }: Readonly<{ model: CourtRecordsWorkspaceViewModel; pageNumber: number; setPage: PageSetter }>) {
  const page = paginateCourtRecordsPanel(model, "citations", pageNumber);
  return (
    <section className={styles.panel} data-records-section="citations" id="record-panel-citations">
      <PanelHeader kicker="Exact namespace bindings" title="Citation resources" count={page.total} />
      <p className={styles.boundaryNote}>
        Citation lookup uses the exact resource kind and identifier. Owner-record and
        debrief-only scopes remain labeled separately to prevent namespace collisions or evidence inflation.
      </p>
      {page.items.length === 0 ? <EmptyPanel>No projected citation resources are available.</EmptyPanel> : (
        <div className={styles.gridTwo}>
          {page.items.map((resource) => (
            <article className={styles.card} key={`${resource.kind}:${resource.resourceId}`}>
              <div className={styles.cardHeader}>
                <strong>{resource.title}</strong>
                <span className={styles.badge}>{COURT_RECORDS_CITATION_KIND_LABELS[resource.kind]}</span>
              </div>
              <p>{COURT_RECORDS_CITATION_STRATUM_LABELS[resource.stratum]}</p>
              <span className={styles.inlineMeta}>
                <span>{resource.scope === "owner_record" ? "Owner record" : "Debrief only"}</span>
                <span className={styles.mono}>{resource.resourceId}</span>
              </span>
            </article>
          ))}
        </div>
      )}
      <Pager label="Citations" page={page} onPageChange={(next) => setPage("citations", next)} />
    </section>
  );
}

function DebriefPanel({ model, pageNumber, setPage }: Readonly<{ model: CourtRecordsWorkspaceViewModel; pageNumber: number; setPage: PageSetter }>) {
  const page = paginateCourtRecordsPanel(model, "debrief", pageNumber);
  return (
    <section className={styles.panel} data-records-section="debrief" id="record-panel-debrief">
      <PanelHeader kicker="Transcript-grounded coaching" title="Final debrief" count={page.total} />
      <p className={styles.boundaryNote}>
        Coaching may inspect the full audit record, but each point retains its basis and
        exact citation stratum. Coaching inference is not admitted courtroom proof.
      </p>
      {model.view.finalDebrief === null ? <EmptyPanel>A final coaching debrief has not been generated.</EmptyPanel> : null}
      {page.items.length > 0 ? (
        <div className={styles.gridTwo}>
          {page.items.map((point) => (
            <article className={styles.debriefCard} key={point.key}>
              <span className={styles.badge}>{COURT_RECORDS_DEBRIEF_SECTION_LABELS[point.section]}</span>
              <h4>{point.title}</h4>
              <p>{point.assessment}</p>
              {point.recommendation === null ? null : <p className={styles.recommendation}><strong>Recommendation:</strong> {point.recommendation}</p>}
              {point.basis === null ? null : <span className={styles.cardMeta}>Basis: {humanize(point.basis)}</span>}
              {point.citations === null ? null : <CitationBadges resolutions={model.citationIndex.resolveDebriefSet(point.citations)} />}
            </article>
          ))}
        </div>
      ) : null}
      <Pager label="Debrief" page={page} onPageChange={(next) => setPage("debrief", next)} />
    </section>
  );
}

type EventRowStyle = CSSProperties & Readonly<{ "--event-depth": number }>;

function EventLedgerPanel({ model, pageNumber, setPage }: Readonly<{ model: CourtRecordsWorkspaceViewModel; pageNumber: number; setPage: PageSetter }>) {
  const page = paginateCourtRecordsPanel(model, "eventTree", pageNumber);
  return (
    <section className={styles.panel} data-records-section="eventTree" id="record-panel-eventTree">
      <PanelHeader kicker="Append-only causality" title="Chronological event ledger" count={page.total} />
      <p className={styles.boundaryNote}>
        The event graph is rendered as a bounded flat ledger. Indentation reflects validated
        parentage without recursively mounting an attacker-sized document tree.
      </p>
      {page.items.map((row) => {
        const rowStyle: EventRowStyle = { "--event-depth": Math.min(row.depth, 6) };
        return (
          <article className={styles.eventRow} data-record-event-row key={row.node.eventId} style={rowStyle}>
            <span className={styles.eventSequence}>#{row.node.sequence}</span>
            <div>
              <strong>{COURT_RECORDS_EVENT_TYPE_LABELS[row.node.type]}</strong>
              <span className={styles.cardMeta}>
                <span>{COURT_RECORDS_ACTOR_ROLE_LABELS[row.node.actor.role]}</span>
                <span>{COURT_RECORDS_EVENT_SOURCE_LABELS[row.node.source]}</span>
                <span>{formatDateTime(row.node.occurredAt)}</span>
              </span>
              <CitationBadges resolutions={model.citationIndex.resolveTrialSet(row.node.citations)} />
            </div>
            <span className={styles.eventLinks}>
              <span>{row.isRoot ? "Root event" : `Parent sequence ${row.parentSequence}`}</span>
              <span>{row.node.childEventIds.length} child events</span>
              <span className={styles.mono}>{row.node.eventId}</span>
            </span>
          </article>
        );
      })}
      <Pager label="Event ledger" page={page} onPageChange={(next) => setPage("eventTree", next)} />
    </section>
  );
}

function ActivePanel({
  active,
  model,
  pages,
  setPage,
}: Readonly<{
  active: RecordSection;
  model: CourtRecordsWorkspaceViewModel;
  pages: Readonly<Record<CourtRecordsPanelKey, number>>;
  setPage: PageSetter;
}>) {
  switch (active) {
    case "overview":
      return <OverviewPanel model={model} />;
    case "transcript":
      return <TranscriptPanel model={model} pageNumber={pages.transcript} setPage={setPage} />;
    case "procedure":
      return <ProcedurePanel model={model} pages={pages} setPage={setPage} />;
    case "lifecycles":
      return <LifecyclesPanel model={model} pages={pages} setPage={setPage} />;
    case "modelCalls":
      return <ModelCallsPanel model={model} pageNumber={pages.modelCalls} setPage={setPage} />;
    case "audio":
      return <AudioPanel model={model} pageNumber={pages.audio} setPage={setPage} />;
    case "citations":
      return <CitationsPanel model={model} pageNumber={pages.citations} setPage={setPage} />;
    case "debrief":
      return <DebriefPanel model={model} pageNumber={pages.debrief} setPage={setPage} />;
    case "eventTree":
      return <EventLedgerPanel model={model} pageNumber={pages.eventTree} setPage={setPage} />;
  }
}

export function CourtRecordDetail({
  view,
  downloadStatus,
  downloadMessage,
  onDownload,
}: CourtRecordDetailProps) {
  const model = useMemo(() => {
    try {
      return createCourtRecordsWorkspaceViewModel(view);
    } catch {
      return null;
    }
  }, [view]);
  const [active, setActive] = useState<RecordSection>("overview");
  const [pages, setPages] = useState(INITIAL_PAGES);

  if (model === null) {
    return (
      <div className={styles.statePanel} role="alert">
        <p className={styles.sectionKicker}>Projection rejected</p>
        <h2>This record failed its integrity bindings.</h2>
        <p className={styles.emptyCopy}>Court Records are temporarily unavailable.</p>
      </div>
    );
  }

  const setPage: PageSetter = (key, page) => {
    setPages((current) => ({ ...current, [key]: page }));
  };

  return (
    <article>
      <header className={styles.detailHeader}>
        <div>
          <p className={styles.sectionKicker}>Validated owner projection</p>
          <h2>{model.view.summary.caseTitle}</h2>
          <span className={styles.trialId}>{model.view.summary.trialId}</span>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.primaryButton}
            disabled={downloadStatus === "working"}
            onClick={onDownload}
            type="button"
          >
            {downloadStatus === "working" ? "Preparing JSON..." : "Download JSON"}
          </button>
        </div>
      </header>

      {downloadMessage === null ? null : (
        <p
          className={downloadStatus === "error" ? styles.errorBox : styles.boundaryNote}
          role={downloadStatus === "error" ? "alert" : "status"}
        >
          {downloadMessage}
        </p>
      )}

      <div className={styles.metrics}>
        <div className={styles.metric}><span className={styles.metricLabel}>Events</span><strong>{model.metrics.events}</strong></div>
        <div className={styles.metric}><span className={styles.metricLabel}>Transcript</span><strong>{model.metrics.transcript.total}</strong></div>
        <div className={styles.metric}><span className={styles.metricLabel}>Rulings</span><strong>{model.view.procedure.rulings.length}</strong></div>
        <div className={styles.metric}><span className={styles.metricLabel}>Model calls</span><strong>{model.metrics.models.total}</strong></div>
        <div className={styles.metric}><span className={styles.metricLabel}>Audio metadata</span><strong>{model.metrics.audio.total}</strong></div>
        <div className={styles.metric}><span className={styles.metricLabel}>Debrief points</span><strong>{model.metrics.debriefPoints}</strong></div>
      </div>

      <nav className={styles.tabs} aria-label="Record sections">
        {(Object.keys(SECTION_LABELS) as RecordSection[]).map((section) => (
          <button
            aria-controls={`record-panel-${section}`}
            aria-pressed={active === section}
            className={`${styles.tab} ${active === section ? styles.activeTab : ""}`}
            key={section}
            onClick={() => setActive(section)}
            type="button"
          >
            {SECTION_LABELS[section]}
          </button>
        ))}
      </nav>

      <ActivePanel active={active} model={model} pages={pages} setPage={setPage} />
    </article>
  );
}
