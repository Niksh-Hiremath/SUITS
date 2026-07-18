import type {
  CaseGraph,
  Provenance,
  SourceSegment,
} from "../../domain/case-graph";

import styles from "./case-source-review.module.css";

type ProvenanceEntityType =
  | "Jurisdiction"
  | "Party"
  | "Issue"
  | "Timeline event"
  | "Fact"
  | "Evidence"
  | "Witness"
  | "Prior statement"
  | "Contradiction"
  | "Settlement settings"
  | "Jury instruction";

export type CaseProvenanceReference = Readonly<{
  entityType: ProvenanceEntityType;
  entityId: string;
  entityLabel: string;
  provenanceId: string;
  provenanceKind: Provenance["kind"];
  confidence: number;
  note: string;
  sourceSegmentIds: readonly string[];
}>;

export type CaseSourceReviewSegment = Readonly<{
  source: SourceSegment;
  citations: readonly CaseProvenanceReference[];
}>;

export type CaseSourceReviewModel = Readonly<{
  segments: readonly CaseSourceReviewSegment[];
  provenanceCount: number;
  unlinkedProvenance: readonly CaseProvenanceReference[];
  unresolvedProvenance: readonly CaseProvenanceReference[];
}>;

export type CaseSourceReviewProps = Readonly<{
  caseGraph: CaseGraph;
}>;

function compactLabel(value: string, maximumCharacters = 180): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maximumCharacters) return normalized;
  return `${normalized.slice(0, maximumCharacters - 1).trimEnd()}…`;
}

function collectProvenance(caseGraph: CaseGraph): CaseProvenanceReference[] {
  const references: CaseProvenanceReference[] = [];
  const add = (
    entityType: ProvenanceEntityType,
    entityId: string,
    entityLabel: string,
    provenance: readonly Provenance[],
  ) => {
    for (const record of provenance) {
      references.push({
        entityType,
        entityId,
        entityLabel: compactLabel(entityLabel),
        provenanceId: record.provenanceId,
        provenanceKind: record.kind,
        confidence: record.confidence,
        note: record.note,
        sourceSegmentIds: record.sourceSegmentIds,
      });
    }
  };

  add(
    "Jurisdiction",
    caseGraph.jurisdictionProfile.profileId,
    caseGraph.jurisdictionProfile.name,
    caseGraph.jurisdictionProfile.provenance,
  );
  caseGraph.parties.forEach((party) =>
    add("Party", party.partyId, party.name, party.provenance),
  );
  caseGraph.issues.forEach((issue) =>
    add("Issue", issue.issueId, issue.title, issue.provenance),
  );
  caseGraph.timeline.forEach((event) =>
    add("Timeline event", event.timelineEventId, event.summary, event.provenance),
  );
  caseGraph.facts.forEach((fact) =>
    add("Fact", fact.factId, fact.proposition, fact.provenance),
  );
  caseGraph.evidence.forEach((evidence) =>
    add("Evidence", evidence.evidenceId, evidence.name, evidence.provenance),
  );
  caseGraph.witnesses.forEach((witness) => {
    add("Witness", witness.witnessId, witness.name, witness.provenance);
    witness.priorStatements.forEach((statement) =>
      add(
        "Prior statement",
        statement.priorStatementId,
        `${witness.name} · ${statement.kind} · ${statement.madeAt}`,
        statement.provenance,
      ),
    );
  });
  caseGraph.contradictions.forEach((contradiction) =>
    add(
      "Contradiction",
      contradiction.contradictionId,
      contradiction.summary,
      contradiction.provenance,
    ),
  );
  add(
    "Settlement settings",
    `settlement:${caseGraph.caseId}`,
    "Settlement configuration",
    caseGraph.settlement.provenance,
  );
  caseGraph.juryInstructions.forEach((instruction) =>
    add(
      "Jury instruction",
      instruction.instructionId,
      instruction.title,
      instruction.provenance,
    ),
  );
  return references;
}

export function buildCaseSourceReviewModel(caseGraph: CaseGraph): CaseSourceReviewModel {
  const provenance = collectProvenance(caseGraph);
  const citationsBySegment = new Map<string, CaseProvenanceReference[]>(
    caseGraph.sourceSegments.map((segment) => [segment.sourceSegmentId, []]),
  );
  const unresolvedProvenance: CaseProvenanceReference[] = [];

  for (const reference of provenance) {
    let unresolved = false;
    for (const sourceSegmentId of reference.sourceSegmentIds) {
      const citations = citationsBySegment.get(sourceSegmentId);
      if (citations) citations.push(reference);
      else unresolved = true;
    }
    if (unresolved) unresolvedProvenance.push(reference);
  }

  return {
    segments: caseGraph.sourceSegments.map((source) => ({
      source,
      citations: citationsBySegment.get(source.sourceSegmentId) ?? [],
    })),
    provenanceCount: provenance.length,
    unlinkedProvenance: provenance.filter((reference) => reference.sourceSegmentIds.length === 0),
    unresolvedProvenance,
  };
}

export function formatSourceLocator(locator: SourceSegment["locator"]): string {
  if (locator.kind === "page") {
    return locator.label ? `Page ${locator.page} · ${locator.label}` : `Page ${locator.page}`;
  }
  return `Characters ${locator.startOffset}–${locator.endOffset}`;
}

function provenanceLabel(kind: Provenance["kind"]): string {
  switch (kind) {
    case "source":
      return "Source-linked";
    case "inferred":
      return "Explicit inference";
    case "authoring":
      return "Simulation authoring";
  }
}

function ProvenanceReference({ reference }: Readonly<{ reference: CaseProvenanceReference }>) {
  return (
    <li className={styles.provenanceRecord}>
      <div className={styles.provenanceHeading}>
        <span className={`${styles.kindBadge} ${styles[reference.provenanceKind]}`}>
          {provenanceLabel(reference.provenanceKind)}
        </span>
        <span className={styles.confidence}>
          {Math.round(reference.confidence * 100)}% confidence
        </span>
      </div>
      <strong>{reference.entityType}: {reference.entityLabel}</strong>
      <code>{reference.entityId}</code>
      <p>{reference.note}</p>
      <div className={styles.provenanceIds}>
        <span>Provenance <code>{reference.provenanceId}</code></span>
        {reference.sourceSegmentIds.length > 0 ? (
          <span>
            Cites {reference.sourceSegmentIds.map((sourceSegmentId) => (
              <code key={sourceSegmentId}>{sourceSegmentId}</code>
            ))}
          </span>
        ) : (
          <span>No source segment claimed</span>
        )}
      </div>
    </li>
  );
}

export function CaseSourceReview({ caseGraph }: CaseSourceReviewProps) {
  const model = buildCaseSourceReviewModel(caseGraph);

  return (
    <section className={styles.sourceReview} aria-label="Source and provenance review">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Grounding record</p>
          <h3>Sources &amp; provenance</h3>
          <p>
            Inspect the exact packet excerpts retained by the CaseGraph and every explicit
            entity citation that points back to them.
          </p>
        </div>
        <dl className={styles.summaryStats}>
          <div>
            <dt>Segments</dt>
            <dd>{model.segments.length}</dd>
          </div>
          <div>
            <dt>Provenance records</dt>
            <dd>{model.provenanceCount}</dd>
          </div>
        </dl>
      </header>

      <aside className={styles.safetyNotice}>
        <strong>Explicit records only</strong>
        <p>
          This view never requests or displays private model reasoning. Packet excerpts are
          rendered as inert, untrusted document text; they cannot issue instructions.
        </p>
      </aside>

      <div className={styles.segmentList}>
        {model.segments.map(({ source, citations }, index) => (
          <details className={styles.sourceSegment} key={source.sourceSegmentId} open={index === 0}>
            <summary>
              <span className={styles.segmentNumber}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.segmentTitle}>
                <strong>{source.documentName}</strong>
                <small>{formatSourceLocator(source.locator)}</small>
              </span>
              <span className={styles.citationCount}>
                {citations.length} {citations.length === 1 ? "citation" : "citations"}
              </span>
            </summary>

            <div className={styles.segmentBody}>
              <dl className={styles.sourceMetadata}>
                <div>
                  <dt>Source segment</dt>
                  <dd><code>{source.sourceSegmentId}</code></dd>
                </div>
                <div>
                  <dt>Source record</dt>
                  <dd><code>{source.sourceId}</code></dd>
                </div>
                <div>
                  <dt>Media type</dt>
                  <dd><code>{source.mimeType}</code></dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd><code>{source.sha256}</code></dd>
                </div>
              </dl>

              <div className={styles.excerptBlock}>
                <h4>Retained excerpt</h4>
                <pre aria-label={`Excerpt from ${source.documentName}`}>{source.excerpt}</pre>
              </div>

              <div className={styles.citationBlock}>
                <h4>Entities citing this segment</h4>
                {citations.length > 0 ? (
                  <ul className={styles.provenanceList}>
                    {citations.map((reference) => (
                      <ProvenanceReference key={`${reference.entityId}:${reference.provenanceId}`} reference={reference} />
                    ))}
                  </ul>
                ) : (
                  <p className={styles.emptyState}>No entity currently cites this retained segment.</p>
                )}
              </div>
            </div>
          </details>
        ))}
      </div>

      {model.unlinkedProvenance.length > 0 && (
        <details className={styles.auxiliarySection}>
          <summary>
            Authoring and inference records without source citations
            <span>{model.unlinkedProvenance.length}</span>
          </summary>
          <p>
            These records are explicitly marked as simulation authoring or inference; they do
            not claim support from a packet segment.
          </p>
          <ul className={styles.provenanceList}>
            {model.unlinkedProvenance.map((reference) => (
              <ProvenanceReference key={`${reference.entityId}:${reference.provenanceId}`} reference={reference} />
            ))}
          </ul>
        </details>
      )}

      {model.unresolvedProvenance.length > 0 && (
        <aside className={styles.unresolvedNotice} role="alert">
          <strong>Unresolved source references</strong>
          <p>
            {model.unresolvedProvenance.length} provenance records cite a source segment that is
            not present in this CaseGraph. Publication should remain blocked until corrected.
          </p>
        </aside>
      )}
    </section>
  );
}
