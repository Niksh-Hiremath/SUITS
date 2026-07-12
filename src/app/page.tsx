import Link from "next/link";

const agents = ["Court Director", "Opposing Counsel", "Witness", "Jury"];

export default function Home() {
  return (
    <main className="court-shell">
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="SUITS home">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </a>
        <div className="status-pill">
          <span className="status-dot" aria-hidden="true" />
          Court systems online
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow">AI-powered oral advocacy practice</div>
        <h1>
          Enter the courtroom.
          <span>Leave a stronger advocate.</span>
        </h1>
        <p className="hero-copy">
          Argue a fictional case, cross-examine a grounded AI witness, and
          receive a coaching debrief linked to every decisive moment in your
          transcript.
        </p>
        <div className="hero-actions">
          <Link className="primary-button" href="/hearing/">
            Review your case & start
          </Link>
          <Link className="text-link" href="/records/">
            View Court Records →
          </Link>
        </div>
      </section>

      <section className="proof-grid" aria-label="Product capabilities">
        <article className="case-card">
          <div className="card-kicker">Golden case</div>
          <h2>Asha Mehta v. Vertex Logistics</h2>
          <p>
            A focused retaliation hearing where a pre-complaint draft competes
            with a revealing post-complaint revision.
          </p>
          <dl>
            <div>
              <dt>Mode</dt>
              <dd>Participatory</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>Cross + closing</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>Case Debrief</dd>
            </div>
          </dl>
        </article>

        <article className="agent-card">
          <div className="card-kicker">Managed agent team</div>
          <ul>
            {agents.map((agent, index) => (
              <li key={agent}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {agent}
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