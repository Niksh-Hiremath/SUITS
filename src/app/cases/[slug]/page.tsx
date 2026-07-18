import Link from "next/link";
import { notFound } from "next/navigation";

import { getSeededCaseBySlug, listSeededCases } from "@/domain/seeded-cases";

import styles from "../case-library.module.css";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return listSeededCases().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const caseGraph = getSeededCaseBySlug(slug);
  return caseGraph
    ? { title: `${caseGraph.title} — SUITS`, description: caseGraph.summary }
    : { title: "Case not found — SUITS" };
}

export default async function SeededCasePage({ params }: PageProps) {
  const { slug } = await params;
  const caseGraph = getSeededCaseBySlug(slug);
  if (!caseGraph) notFound();

  return (
    <main className={styles.page}>
      <nav className="topbar" aria-label="Case detail navigation">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <Link className="text-link" href="/cases/">← Case library</Link>
      </nav>

      <section className={styles.detailHero}>
        <div>
          <p className={styles.kicker}>{caseGraph.jurisdictionProfile.name}</p>
          <h1>{caseGraph.title}</h1>
          <p>{caseGraph.summary}</p>
        </div>
        <dl className={styles.caseFacts}>
          <div><dt>Parties</dt><dd>{caseGraph.parties.length}</dd></div>
          <div><dt>Witnesses</dt><dd>{caseGraph.witnesses.length}</dd></div>
          <div><dt>Exhibits</dt><dd>{caseGraph.evidence.length}</dd></div>
          <div><dt>Source segments</dt><dd>{caseGraph.sourceSegments.length}</dd></div>
        </dl>
      </section>

      <section className={styles.detailGrid}>
        <article className={styles.section}>
          <h2>Issues for trial</h2>
          <ul className={styles.list}>
            {caseGraph.issues.map((issue) => <li key={issue.issueId}><strong>{issue.title}</strong><span>{issue.question}</span></li>)}
          </ul>
        </article>
        <article className={styles.section}>
          <h2>Witness roster</h2>
          <ul className={styles.list}>
            {caseGraph.witnesses.map((witness) => <li key={witness.witnessId}><strong>{witness.name}</strong><span>{witness.role} · {witness.kind} witness</span></li>)}
          </ul>
        </article>
        <article className={styles.section}>
          <h2>Evidence index</h2>
          <ul className={styles.list}>
            {caseGraph.evidence.map((evidence) => <li key={evidence.evidenceId}><strong>{evidence.name}</strong><span>{evidence.description}</span></li>)}
          </ul>
        </article>
        <article className={styles.section}>
          <h2>Record integrity</h2>
          <ul className={styles.list}>
            <li><strong>{caseGraph.compilerMetadata.sourceSegmentCount} source segments</strong><span>Every authored proposition carries explicit provenance.</span></li>
            <li><strong>{caseGraph.contradictions.length} mapped contradictions</strong><span>Contradictions identify their source records and affected witnesses.</span></li>
            <li><strong>{caseGraph.compilerMetadata.uncertainties.length} unresolved uncertainties</strong><span>Uncertainty remains visible instead of becoming courtroom truth.</span></li>
          </ul>
        </article>
        <p className={styles.disclaimer}>{caseGraph.educationalDisclaimer}</p>
        <div className={styles.actions}>
          <Link className={styles.primary} href={`/courtroom/?caseId=${encodeURIComponent(caseGraph.caseId)}`}>Prepare this hearing</Link>
          <Link className={styles.secondary} href="/cases/new/">Compile another packet</Link>
        </div>
      </section>
    </main>
  );
}
