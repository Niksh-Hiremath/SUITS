import Link from "next/link";

export default function RecordsPage() {
  return (
    <main className="records-shell">
      <header className="hearing-header">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <div>
          <span className="eyebrow">Observability</span>
          <strong className="records-title">Court Records</strong>
        </div>
        <Link className="primary-button" href="/cases/">
          Choose a case
        </Link>
      </header>

      <section className="briefing-panel" aria-labelledby="records-migration-title">
        <span className="eyebrow">Migration in progress</span>
        <h1 id="records-migration-title">Owner-bound Court Records are coming next.</h1>
        <p>
          The legacy records viewer is unavailable while SUITS migrates to the
          private, event-sourced hearing record. Historical Hermes trial data is
          preserved, but this page no longer reads the unauthenticated legacy
          trial tables.
        </p>
        <div className="evidence-strip" aria-label="Migration safeguards">
          <span>Legacy data preserved</span>
          <span>No unauthenticated trial reads</span>
          <span>V3 records in progress</span>
        </div>
        <div className="hero-actions">
          <Link className="primary-button" href="/cases/">
            Choose a case
          </Link>
          <Link className="text-link" href="/">
            Return home →
          </Link>
        </div>
      </section>
    </main>
  );
}
