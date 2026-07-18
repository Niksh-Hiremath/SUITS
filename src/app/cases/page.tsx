import Link from "next/link";

import { listSeededCases } from "@/domain/seeded-cases";

import styles from "./case-library.module.css";

export const metadata = {
  title: "Fictional case library — SUITS",
  description: "Choose a provenance-grounded fictional case or compile your own educational packet.",
};

export default function CasesPage() {
  const cases = listSeededCases();

  return (
    <main className={styles.page}>
      <nav className="topbar" aria-label="Case library navigation">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <span className="status-pill"><span className="status-dot" aria-hidden="true" />Fictional records</span>
      </nav>

      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>Court file room</p>
          <h1>Choose the record you’ll argue.</h1>
          <p>Every seeded matter has multiple witnesses, isolated knowledge, source-linked facts, disputed evidence, and private settlement positions.</p>
        </div>
        <Link className={styles.newCaseCard} href="/cases/new/">
          <span>Have your own fictional packet?</span>
          <strong>Compile a new case</strong>
          <i aria-hidden="true">Upload & review →</i>
        </Link>
      </section>

      <div className={styles.catalogHeader}>
        <h2>Seeded matters</h2>
        <span>{cases.length} complete case files</span>
      </div>

      <section className={styles.grid} aria-label="Seeded fictional cases">
        {cases.map((item) => (
          <Link className={styles.card} href={`/cases/${item.slug}/`} key={item.catalogId}>
            <div className={styles.cardMeta}><span>{item.category}</span><span>{item.difficulty}</span></div>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            <dl>
              <div><dt>Witnesses</dt><dd>{item.witnessCount}</dd></div>
              <div><dt>Exhibits</dt><dd>{item.evidenceCount}</dd></div>
              <div><dt>Minutes</dt><dd>{item.estimatedHearingMinutes}</dd></div>
            </dl>
          </Link>
        ))}
      </section>
    </main>
  );
}
