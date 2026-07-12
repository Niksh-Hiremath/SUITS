"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { formatCostUsd, totalKnownCostUsd, usageLabel } from "../../domain/cost-observability";

export default function RecordsPage() {
  const trials = useQuery(api.trials.list);
  const productAnalytics = useQuery(api.events.summary);
  const evalRuns = useQuery(api.evals.list);
  const promptComparison = useQuery(api.evals.comparison);
  const [selected, setSelected] = useState<string | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : (new URLSearchParams(window.location.search).get("trial") ?? undefined),
  );
  const effectiveSelected = selected ?? trials?.[0]?.trialId;
  const run = useQuery(api.trials.get, effectiveSelected ? { trialId: effectiveSelected } : "skip");
  const metrics = useMemo(() => {
    const traces = run?.traces ?? [];
    return {
      latency: traces.find((trace) => !trace.parentId)?.latencyMs ?? 0,
      inputTokens: traces.reduce((sum, trace) => sum + (trace.inputTokens ?? 0), 0),
      outputTokens: traces.reduce((sum, trace) => sum + (trace.outputTokens ?? 0), 0),
      costUsd: totalKnownCostUsd(traces),
      fallbacks: traces.filter((trace) => trace.fallbackUsed).length,
      retries: traces.reduce((sum, trace) => sum + trace.retryCount, 0),
    };
  }, [run]);
  const selectedEval = evalRuns?.find((evaluation) => evaluation.trialId === effectiveSelected);

  return (
    <main className="records-shell">
      <header className="hearing-header">
        <Link className="brand" href="/"><span className="brand-mark">S</span><span>SUITS</span></Link>
        <div><span className="eyebrow">Observability</span><strong className="records-title">Court Records</strong></div>
        <Link className="primary-button" href="/hearing/">New hearing</Link>
      </header>

      <div className="records-grid">
        <aside className="run-list">
          <div className="panel-heading"><div><span>Runs</span><h1>Trial history</h1></div><span>{trials?.length ?? 0}</span></div>
          {trials?.map((trial) => (
            <button className={`run-item ${effectiveSelected === trial.trialId ? "active" : ""}`} key={trial.trialId} onClick={() => setSelected(trial.trialId)}>
              <span><i className={`run-dot ${trial.status}`} />{trial.mode}</span>
              <strong>{trial.phase.replaceAll("_", " ")}</strong>
              <small>{new Date(trial.createdAt).toLocaleTimeString()} · {trial.trialId.slice(-8)}</small>
            </button>
          ))}
        </aside>

        <section className="record-detail">
          <section className="product-analytics">
            <div className="panel-heading"><div><span>Product analytics</span><h1>Observed interactions</h1></div><span>Convex · live</span></div>
            <div className="metric-row analytics-row">
              <div><span>Hearings started</span><strong>{productAnalytics?.counts.hearing_started ?? 0}</strong></div>
              <div><span>Questions asked</span><strong>{productAnalytics?.counts.question_submitted ?? 0}</strong></div>
              <div><span>Contradictions</span><strong>{productAnalytics?.counts.contradiction_exposed ?? 0}</strong></div>
              <div><span>Completed</span><strong>{productAnalytics?.counts.hearing_completed ?? 0}</strong></div>
              <div><span>Debriefs downloaded</span><strong>{productAnalytics?.counts.debrief_downloaded ?? 0}</strong></div>
            </div>
          </section>
          {!run ? <div className="thinking-line">Loading court record…</div> : (
            <>
              <div className="record-hero">
                <div><span className="eyebrow">{run.trial.mode} run</span><h1>{run.trial.status === "complete" ? "Hearing completed" : "Hearing in progress"}</h1><code>{run.trial.trialId}</code></div>
                <div className="record-verdict"><span>Verdict</span><strong>{run.votes[0]?.vote ?? "pending"}</strong></div>
              </div>

              <div className="metric-row">
                <div><span>Duration</span><strong>{(metrics.latency / 1000).toFixed(2)}s</strong></div>
                <div><span>Input tokens</span><strong>{metrics.inputTokens}</strong></div>
                <div><span>Output tokens</span><strong>{metrics.outputTokens}</strong></div>
                <div><span>Total task cost</span><strong>{formatCostUsd(metrics.costUsd)}</strong></div>
                <div><span>Retries</span><strong>{metrics.retries}</strong></div>
                <div><span>Fallbacks</span><strong>{metrics.fallbacks}</strong></div>
              </div>

              <section className="trace-section">
                <div className="panel-heading"><div><span>Agent execution</span><h1>Trace tree</h1></div><span>{run.traces.length} spans</span></div>
                <div className="trace-tree">
                  {run.traces.map((trace) => (
                    <article className={`trace-node ${trace.parentId ? "child" : "root"}`} key={trace.traceId}>
                      <i className={`run-dot ${trace.status}`} />
                      <div><strong>{trace.actor}</strong><span>{trace.action.replaceAll("_", " ")}</span></div>
                      <dl><div><dt>model</dt><dd>{trace.model ?? trace.provider ?? "code"}</dd></div><div><dt>latency</dt><dd>{trace.latencyMs === undefined ? "Unavailable" : `${trace.latencyMs}ms`}</dd></div><div><dt>usage</dt><dd>{usageLabel(trace)}</dd></div><div><dt>cost</dt><dd>{formatCostUsd(trace.estimatedCostUsd ?? 0)}</dd></div><div><dt>retries</dt><dd>{trace.retryCount}</dd></div><div><dt>fallback</dt><dd>{trace.fallbackUsed ? "yes" : "no"}</dd></div></dl>
                      {trace.errorSummary ? <small className="trace-error">{trace.errorCode ?? "error"}: {trace.errorSummary}</small> : null}
                      <code>{trace.traceId.slice(-12)}</code>
                    </article>
                  ))}
                </div>
              </section>

              <section className="assertion-section">
                <div className="panel-heading"><div><span>Persisted evaluation</span><h1>Golden-run assertions</h1></div><span>{selectedEval ? `${selectedEval.passedCount}/${selectedEval.totalCount}` : "not evaluated"}</span></div>
                <div className="assertion-grid">
                  {selectedEval?.assertions.map((item) => <div className="assertion" key={item.name} title={item.evidenceJson}><span>{item.passed ? "✓" : "×"}</span><strong>{item.name.replaceAll("_", " ")}</strong><small>{item.passed ? "passed" : "failed"}</small></div>) ?? <p>Run the formal evaluator to persist reliability evidence.</p>}
                </div>
              </section>

              <section className="assertion-section">
                <div className="panel-heading"><div><span>Same case · same inputs</span><h1>Prompt version comparison</h1></div></div>
                <div className="metric-row">
                  {promptComparison?.map((version) => <div key={version.promptVersion}><span>{version.promptVersion}</span><strong>{version.passed}/{version.total}</strong><small>{Math.round(version.passRate * 100)}% pass</small></div>)}
                </div>
              </section>

              <section className="record-transcript">
                <div className="panel-heading"><div><span>Evidence</span><h1>Transcript and citations</h1></div></div>
                {run.turns.map((turn) => <article className="record-turn" id={turn.turnId} key={turn.turnId}><code>T-{String(turn.sequence).padStart(3, "0")}</code><div><strong>{turn.actor}</strong><p>{turn.text}</p></div><span>{turn.evidenceIds.join(" · ")}</span></article>)}
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
