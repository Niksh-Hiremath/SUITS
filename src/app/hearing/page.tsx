"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";

const sampleQuestion =
  "Ms. Sen, the Gate B log records Northstar at 7:31 PM before the lights failed at 7:42, correct?";

export default function HearingPage() {
  const startHearing = useAction(api.participatory.start);
  const askWitness = useAction(api.participatory.askWitness);
  const finishHearing = useAction(api.participatory.finish);
  const trackEvent = useMutation(api.events.track);
  const [trialId, setTrialId] = useState<string>();
  const [question, setQuestion] = useState("");
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useQuery(api.trials.get, trialId ? { trialId } : "skip");

  const phase = run?.trial.phase;
  const canClose = useMemo(
    () => (run?.turns.filter((turn) => turn.actor === "Witness").length ?? 0) > 0,
    [run],
  );

  async function execute(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The court could not complete that action.");
    } finally {
      setBusy(false);
    }
  }

  function downloadDebrief() {
    if (!run?.debrief) return;
    void trackEvent({
      trialId: run.trial.trialId,
      name: "debrief_downloaded",
      metadataJson: JSON.stringify({ format: "txt" }),
    });
    const text = [
      "SUITS — CASE DEBRIEF",
      run.debrief.overallAssessment,
      "",
      "STRENGTHS",
      ...run.debrief.strengths.map((item) => `- ${item.finding} [${item.turnCitations.join(", ")}]`),
      "",
      "MISSED OPPORTUNITIES",
      ...run.debrief.missedOpportunities.map((item) => `- ${item.finding}\n  Try: ${item.recommendedQuestion}`),
      "",
      "REVISED CLOSING",
      run.debrief.revisedClosing.text,
      "",
      ...run.debrief.limitations,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `suits-debrief-${run.trial.trialId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="hearing-shell">
      <header className="hearing-header">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span><span>SUITS</span>
        </Link>
        <div className="phase-chip">{phase?.replaceAll("_", " ") ?? "ready"}</div>
        <Link className="text-link" href="/records/">Court Records</Link>
      </header>

      {!trialId ? (
        <section className="briefing-panel">
          <div className="eyebrow">Harbor Lantern Events v. Northstar Rentals</div>
          <h1>Your cross-examination begins now.</h1>
          <p>
            You represent Northstar. Challenge the claim that its generator arrived only after
            the 7:42 PM lighting failure. Ask focused, leading questions and then deliver a closing.
          </p>
          <div className="evidence-strip">
            <span>E-001 · Delivery due 6:00 PM</span>
            <span>E-002 · Lights failed 7:42 PM</span>
            <span>E-003 · Gate B log available on cross</span>
          </div>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => execute(async () => setTrialId(await startHearing({})))}
          >
            {busy ? "Calling court to order…" : "Begin hearing"}
          </button>
        </section>
      ) : (
        <div className="hearing-grid">
          <section className="transcript-panel">
            <div className="panel-heading">
              <div><span>Live record</span><h1>Hearing transcript</h1></div>
              <span>{run?.turns.length ?? 0} turns</span>
            </div>
            <div className="transcript-list" aria-live="polite">
              {run?.turns.map((turn) => (
                <article className={`turn turn-${turn.speaker}`} key={turn.turnId}>
                  <div className="turn-meta">
                    <strong>{turn.actor}</strong>
                    <span>{turn.phase.replaceAll("_", " ")} · T-{String(turn.sequence).padStart(3, "0")}</span>
                  </div>
                  <p>{turn.text}</p>
                  {turn.evidenceIds.length > 0 && (
                    <div className="turn-evidence">{turn.evidenceIds.join(" · ")}</div>
                  )}
                </article>
              ))}
              {busy && <div className="thinking-line">The court is processing the record…</div>}
            </div>

            {phase === "cross_examination" && (
              <div className="advocacy-box">
                <label htmlFor="question">Question the witness</label>
                <textarea
                  id="question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask one focused, leading question…"
                  rows={3}
                />
                <div className="input-actions">
                  <button className="quiet-button" onClick={() => setQuestion(sampleQuestion)}>
                    Load decisive question
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy || question.trim().length < 8}
                    onClick={() => execute(async () => {
                      await askWitness({ trialId, question: question.trim() });
                      setQuestion("");
                    })}
                  >
                    Ask witness
                  </button>
                </div>
              </div>
            )}

            {phase === "cross_examination" && canClose && (
              <div className="advocacy-box closing-box">
                <label htmlFor="closing">Deliver your closing</label>
                <textarea
                  id="closing"
                  value={closing}
                  onChange={(event) => setClosing(event.target.value)}
                  placeholder="Explain why the transcript supports Northstar…"
                  rows={4}
                />
                <button
                  className="primary-button"
                  disabled={busy || closing.trim().length < 20}
                  onClick={() => execute(async () => {
                    await finishHearing({ trialId, closing: closing.trim() });
                  })}
                >
                  Rest and request verdict
                </button>
              </div>
            )}
            {error && <div className="error-banner">{error}</div>}
          </section>

          <aside className="case-rail">
            <div className="rail-card"><span>Case posture</span><strong>You represent Northstar</strong><p>Respondent · fictional commercial hearing</p></div>
            <div className="rail-card"><span>Your objective</span><p>Separate missing the contractual schedule from arriving before the lighting failure.</p></div>
            <div className="rail-card"><span>System proof</span><p>{run?.traces.length ?? 0} observable agent operations recorded.</p></div>
          </aside>
        </div>
      )}

      {phase === "complete" && run?.debrief && (
        <section className="debrief-panel">
          <div className="panel-heading">
            <div><span>Case Debrief</span><h1>What moved the jury</h1></div>
            <button className="quiet-button" onClick={downloadDebrief}>Download .txt</button>
          </div>
          <p className="assessment">{run.debrief.overallAssessment}</p>
          <div className="debrief-grid">
            <article><span>Strength</span><h2>{run.debrief.strengths[0]?.finding}</h2><code>{run.debrief.strengths[0]?.turnCitations.join(" · ")}</code></article>
            <article><span>Missed opportunity</span><h2>{run.debrief.missedOpportunities[0]?.finding}</h2><p>{run.debrief.missedOpportunities[0]?.recommendedQuestion}</p></article>
            <article><span>Revised closing</span><h2>{run.debrief.revisedClosing.text}</h2></article>
          </div>
          <Link className="primary-button" href={`/records/?trial=${trialId}`}>Inspect the agent trace</Link>
        </section>
      )}
    </main>
  );
}
