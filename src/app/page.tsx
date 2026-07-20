import Link from "next/link";

const courtroomRoles = [
  "Deterministic trial engine",
  "Opposing counsel",
  "Witness bench",
  "Judge and jury",
];

export default function Home() {
  return (
    <main className="court-shell">
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="SUITS home">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </a>
        <Link className="status-pill" href="/preflight/">
          <span className="status-dot" aria-hidden="true" />
          Run system preflight
        </Link>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow">AI-powered oral advocacy practice</div>
        <h1>
          Enter the courtroom.
          <span>Leave a stronger advocate.</span>
        </h1>
        <p className="hero-copy">
          Argue a fictional case, examine multiple knowledge-isolated witnesses,
          handle objections and evidence, and receive coaching linked to the
          admitted record.
        </p>
        <div className="hero-actions">
          <Link className="primary-button" href="/cases/">
            Choose a case & start
          </Link>
          <Link className="text-link" href="/cases/new/">
            Upload a case →
          </Link>
          <Link className="text-link" href="/preflight/">
            Check systems →
          </Link>
        </div>
      </section>

      <section className="proof-grid" aria-label="Product capabilities">
        <article className="case-card">
          <div className="card-kicker">Three seeded cases</div>
          <h2>Rina Shah v. Redwood Signal Systems</h2>
          <p>
            Start with a multi-witness retaliation hearing, choose another
            grounded fictional matter, or compile and review your own packet.
          </p>
          <dl>
            <div>
              <dt>Mode</dt>
              <dd>Voice-first</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>Full hearing</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>Records + debrief</dd>
            </div>
          </dl>
        </article>

        <article className="agent-card">
          <div className="card-kicker">Validated courtroom roles</div>
          <ul>
            {courtroomRoles.map((role, index) => (
              <li key={role}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {role}
                <i aria-hidden="true">→</i>
              </li>
            ))}
          </ul>
        </article>

        <article className="debrief-card">
          <div className="card-kicker">The real output</div>
          <h2>Transcript-grounded Case Debrief</h2>
          <p>
            Strengths, missed evidence, contradictions, juror movement, and a
            revised closing—with citations to what was actually said.
          </p>
          <div className="citation-preview">
            <span>T-004</span>
            Decisive contradiction exposed
          </div>
        </article>
      </section>

      <footer>
        Fictional cases for educational coaching only. SUITS does not provide
        legal advice.
      </footer>
    </main>
  );
}
