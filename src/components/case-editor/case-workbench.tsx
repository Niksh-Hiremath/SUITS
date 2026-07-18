"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";

import type { CaseGraph } from "@/domain/case-graph";

import { CaseGraphReviewEditor } from "./case-graph-review-editor";
import styles from "./case-workbench.module.css";

type ReviewIssue = {
  code: string;
  message: string;
  sourceSegmentIds: string[];
};

type CompilationReport = {
  schemaVersion: string;
  warnings: ReviewIssue[];
  uncertainties: ReviewIssue[];
  provenance: {
    factualFields: number;
    sourceLinked: number;
    explicitlyInferred: number;
  };
  injectionSignals: string[];
};

type CompiledUpload = {
  uploadId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceSegmentCount: number;
};

type CompileResponse = {
  caseGraph: CaseGraph;
  report: CompilationReport;
  upload: CompiledUpload;
};

type PublishResponse = {
  caseId: string;
  version: number;
  published: boolean;
};

type WorkbenchStage = "select" | "compiling" | "review" | "publishing" | "published" | "error";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export function CaseWorkbench() {
  const [stage, setStage] = useState<WorkbenchStage>("select");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishResponse | null>(null);
  const compileRequestId = useRef<string | null>(null);

  const provenancePercent = useMemo(() => {
    if (!compiled || compiled.report.provenance.factualFields === 0) return 100;
    return Math.round(
      ((compiled.report.provenance.sourceLinked + compiled.report.provenance.explicitlyInferred) /
        compiled.report.provenance.factualFields) *
        100,
    );
  }, [compiled]);

  async function compilePacket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setError("Choose a fictional case packet first.");
      setStage("error");
      return;
    }
    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      setError("The packet exceeds the 20 MB upload limit.");
      setStage("error");
      return;
    }

    setError(null);
    setStage("compiling");
    const requestId = compileRequestId.current ?? crypto.randomUUID();
    compileRequestId.current = requestId;
    const body = new FormData();
    body.set("packet", selectedFile);
    body.set("requestId", requestId);
    try {
      const sessionResponse = await fetch("/api/cases/session", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!sessionResponse.ok) throw new Error(await errorMessage(sessionResponse));
      const response = await fetch("/api/cases/compile", {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = (await response.json()) as CompileResponse;
      setCompiled(result);
      setStage("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Case compilation failed.");
      setStage("error");
    }
  }

  function updateGraph(update: (graph: CaseGraph) => CaseGraph) {
    setCompiled((current) => current ? { ...current, caseGraph: update(current.caseGraph) } : current);
  }

  async function publishCase() {
    if (!compiled) return;
    setError(null);
    setStage("publishing");
    try {
      const response = await fetch("/api/cases/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: compiled.upload.uploadId,
          caseGraph: { ...compiled.caseGraph, status: "published" },
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = (await response.json()) as PublishResponse;
      setPublished(result);
      setStage("published");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publishing failed.");
      setStage("error");
    }
  }

  function reset() {
    setStage("select");
    setSelectedFile(null);
    setCompiled(null);
    setPublished(null);
    setError(null);
    compileRequestId.current = null;
  }

  return (
    <div className={styles.workbench}>
      <ol className={styles.steps} aria-label="Case preparation steps">
        {[
          ["01", "Upload"],
          ["02", "Compile"],
          ["03", "Review"],
          ["04", "Publish"],
        ].map(([number, label], index) => {
          const activeIndex = stage === "select"
            ? 0
            : stage === "compiling"
              ? 1
              : stage === "review" || (stage === "error" && compiled)
                ? 2
                : stage === "error"
                  ? 0
                  : 3;
          return (
            <li className={index <= activeIndex ? styles.activeStep : undefined} key={label}>
              <span>{number}</span>
              {label}
            </li>
          );
        })}
      </ol>

      {(stage === "select" || (stage === "error" && !compiled)) && (
        <form className={styles.uploadPanel} onSubmit={compilePacket}>
          <div>
            <p className={styles.kicker}>New fictional matter</p>
            <h2>Upload a case packet</h2>
            <p>
              SUITS extracts source segments, compiles a structured case, and pauses for your review before anything is published.
            </p>
          </div>
          <label className={styles.dropZone}>
            <span className={styles.uploadGlyph} aria-hidden="true">↥</span>
            <strong>{selectedFile ? selectedFile.name : "Choose a packet"}</strong>
            <small>
              {selectedFile
                ? `${formatBytes(selectedFile.size)} · ${selectedFile.type || "unknown type"}`
                : "PDF, DOCX, TXT, Markdown, or JSON · up to 20 MB"}
            </small>
            <input
              accept=".pdf,.docx,.txt,.md,.markdown,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/json"
              name="packet"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                compileRequestId.current = null;
                setError(null);
              }}
              type="file"
            />
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <button className={styles.primaryButton} disabled={!selectedFile} type="submit">
              Compile case securely
            </button>
            <span>Packet text is treated as evidence, never as model instructions.</span>
          </div>
        </form>
      )}

      {stage === "compiling" && (
        <section className={styles.processingPanel} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.kicker}>Terra case compiler</p>
          <h2>Indexing the record and checking provenance…</h2>
          <p>This may take a moment. The original packet stays outside the public case catalog.</p>
        </section>
      )}

      {compiled && (stage === "review" || stage === "publishing" || stage === "error") && (
        <section className={styles.reviewLayout}>
          <div className={styles.editorPanel}>
            <header>
              <p className={styles.kicker}>Human review required</p>
              <h2>Review the compiled case</h2>
              <p>Correct the framing below. Hidden facts and witness boundaries remain structurally isolated.</p>
            </header>

            <label>
              Case title
              <input
                maxLength={300}
                onChange={(event) => updateGraph((graph) => ({ ...graph, title: event.target.value }))}
                value={compiled.caseGraph.title}
              />
            </label>
            <label>
              Neutral summary
              <textarea
                maxLength={5_000}
                onChange={(event) => updateGraph((graph) => ({ ...graph, summary: event.target.value }))}
                rows={5}
                value={compiled.caseGraph.summary}
              />
            </label>
            <label>
              Educational disclaimer · policy locked
              <textarea
                maxLength={1_000}
                readOnly
                rows={3}
                value={compiled.caseGraph.educationalDisclaimer}
              />
            </label>

            <CaseGraphReviewEditor
              graph={compiled.caseGraph}
              onChange={(caseGraph) => setCompiled((current) => current ? { ...current, caseGraph } : current)}
            />

            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
              <button className={styles.primaryButton} disabled={stage === "publishing"} onClick={publishCase} type="button">
                {stage === "publishing" ? "Publishing…" : "Approve & publish case"}
              </button>
              <button className={styles.secondaryButton} onClick={reset} type="button">Discard draft</button>
            </div>
          </div>

          <aside className={styles.reportPanel} aria-label="Compilation report">
            <p className={styles.kicker}>Compilation report</p>
            <div className={styles.coverageScore}>
              <strong>{provenancePercent}%</strong>
              <span>provenance accounted for</span>
            </div>
            <dl>
              <div><dt>Source segments</dt><dd>{compiled.upload.sourceSegmentCount}</dd></div>
              <div><dt>Source-linked</dt><dd>{compiled.report.provenance.sourceLinked}</dd></div>
              <div><dt>Explicitly inferred</dt><dd>{compiled.report.provenance.explicitlyInferred}</dd></div>
              <div><dt>Warnings</dt><dd>{compiled.report.warnings.length}</dd></div>
            </dl>

            <h3>Warnings & uncertainty</h3>
            {[...compiled.report.warnings, ...compiled.report.uncertainties].length === 0 ? (
              <p className={styles.clearReport}>No unresolved compiler warnings.</p>
            ) : (
              <ul className={styles.issueList}>
                {[...compiled.report.warnings, ...compiled.report.uncertainties].map((issue) => (
                  <li key={`${issue.code}:${issue.message}`}>
                    <strong>{issue.code}</strong>
                    <span>{issue.message}</span>
                    {issue.sourceSegmentIds.length > 0 && <code>{issue.sourceSegmentIds.join(", ")}</code>}
                  </li>
                ))}
              </ul>
            )}

            {compiled.report.injectionSignals.length > 0 && (
              <div className={styles.securityNotice}>
                <strong>Untrusted instruction-like text detected</strong>
                <p>It was retained as packet data and excluded from the compiler instruction channel.</p>
              </div>
            )}
          </aside>
        </section>
      )}

      {stage === "published" && published && (
        <section className={styles.publishedPanel}>
          <span aria-hidden="true">✓</span>
          <p className={styles.kicker}>Case published</p>
          <h2>{compiled?.caseGraph.title}</h2>
          <p>Version {published.version} is ready for a fictional educational hearing.</p>
          <div className={styles.actions}>
            <a className={styles.primaryButton} href={`/courtroom/?caseId=${encodeURIComponent(published.caseId)}`}>Prepare hearing</a>
            <button className={styles.secondaryButton} onClick={reset} type="button">Compile another case</button>
          </div>
        </section>
      )}
    </div>
  );
}
