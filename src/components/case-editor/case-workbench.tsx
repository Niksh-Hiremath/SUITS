"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  CaseApiErrorResponseSchema,
  CaseCompileResponseSchema,
  CasePublishResponseSchema,
  CaseSessionResponseSchema,
  type CaseCompileResponse,
  type CasePublishResponse,
} from "@/domain/case-api";
import type { CaseGraph } from "@/domain/case-graph";
import { ownedHearingUrl } from "@/domain/hearing-journey";

import { CaseGraphReviewEditor } from "./case-graph-review-editor";
import { CaseSourceReview } from "./case-source-review";
import { publicationTargetIsCurrent } from "./case-workbench-lifecycle";
import styles from "./case-workbench.module.css";

type WorkbenchStage = "select" | "loading" | "compiling" | "review" | "publishing" | "published" | "error";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_ID_PATTERN = /^upload:[a-f0-9]{48}$/u;

type Props = Readonly<{ initialDraftUploadId?: string | null }>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const parsed = CaseApiErrorResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.message : `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

function replaceDraftLocation(uploadId: string | null): void {
  const url = new URL(window.location.href);
  if (uploadId === null) url.searchParams.delete("draft");
  else url.searchParams.set("draft", uploadId);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function CaseWorkbench({ initialDraftUploadId = null }: Props) {
  const [stage, setStage] = useState<WorkbenchStage>(
    initialDraftUploadId === null ? "select" : "loading",
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [compiled, setCompiled] = useState<CaseCompileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<CasePublishResponse | null>(null);
  const compileRequestId = useRef<string | null>(null);
  const workGeneration = useRef(0);
  const publishController = useRef<AbortController | null>(null);

  useEffect(() => () => {
    workGeneration.current += 1;
    publishController.current?.abort();
  }, []);

  useEffect(() => {
    workGeneration.current += 1;
    publishController.current?.abort();
    publishController.current = null;
    if (initialDraftUploadId === null || !UPLOAD_ID_PATTERN.test(initialDraftUploadId)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/cases/draft?uploadId=${encodeURIComponent(initialDraftUploadId)}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = CaseCompileResponseSchema.safeParse(await response.json());
        if (!result.success) throw new Error("The server returned an invalid case draft.");
        setCompiled(result.data);
        if (result.data.caseGraph.status === "published") {
          setPublished({
            caseId: result.data.caseGraph.caseId,
            version: 2,
            published: true,
            replayed: true,
            caseGraph: result.data.caseGraph,
          });
          setStage("published");
        } else {
          setStage("review");
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Draft restoration failed.");
        setStage("error");
      }
    })();
    return () => controller.abort();
  }, [initialDraftUploadId]);

  const sourceCoveragePercent = useMemo(() => {
    if (!compiled || compiled.report.provenance.factualFields === 0) return null;
    return Math.round(
      (compiled.report.provenance.sourceLinked / compiled.report.provenance.factualFields) * 100,
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

    workGeneration.current += 1;
    publishController.current?.abort();
    publishController.current = null;
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
      const sessionPayload = CaseSessionResponseSchema.safeParse(await sessionResponse.json());
      if (!sessionPayload.success) throw new Error("The server returned an invalid case session response.");
      const response = await fetch("/api/cases/compile", {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = CaseCompileResponseSchema.safeParse(await response.json());
      if (!result.success) throw new Error("The server returned an invalid compiled case.");
      setCompiled(result.data);
      replaceDraftLocation(result.data.upload.uploadId);
      if (result.data.caseGraph.status === "published") {
        setPublished({
          caseId: result.data.caseGraph.caseId,
          version: 2,
          published: true,
          replayed: true,
          caseGraph: result.data.caseGraph,
        });
        setStage("published");
      } else {
        setStage("review");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Case compilation failed.");
      setStage("error");
    }
  }

  function updateGraph(update: (graph: CaseGraph) => CaseGraph) {
    if (stage === "publishing") return;
    setCompiled((current) => current ? { ...current, caseGraph: update(current.caseGraph) } : current);
  }

  async function publishCase() {
    if (!compiled) return;
    const target = {
      generation: workGeneration.current,
      uploadId: compiled.upload.uploadId,
      caseId: compiled.caseGraph.caseId,
    };
    publishController.current?.abort();
    const controller = new AbortController();
    publishController.current = controller;
    setError(null);
    setStage("publishing");
    try {
      const response = await fetch("/api/cases/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: target.uploadId,
          caseGraph: { ...compiled.caseGraph, status: "published" },
        }),
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = CasePublishResponseSchema.safeParse(await response.json());
      if (!result.success) throw new Error("The server returned an invalid publication result.");
      if (!publicationTargetIsCurrent(target, workGeneration.current, compiled)) return;
      setPublished(result.data);
      setCompiled((current) => publicationTargetIsCurrent(target, workGeneration.current, current)
        ? { ...current, caseGraph: result.data.caseGraph }
        : current);
      replaceDraftLocation(target.uploadId);
      setStage("published");
    } catch (caught) {
      if (controller.signal.aborted || target.generation !== workGeneration.current) return;
      setError(caught instanceof Error ? caught.message : "Publishing failed.");
      setStage("error");
    } finally {
      if (publishController.current === controller) publishController.current = null;
    }
  }

  function reset() {
    workGeneration.current += 1;
    publishController.current?.abort();
    publishController.current = null;
    setStage("select");
    setSelectedFile(null);
    setCompiled(null);
    setPublished(null);
    setError(null);
    compileRequestId.current = null;
    replaceDraftLocation(null);
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
              : stage === "loading"
                ? 2
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
              It is a fictional educational simulation, not legal advice, and does not predict real-case outcomes.
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

      {(stage === "compiling" || stage === "loading") && (
        <section className={styles.processingPanel} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.kicker}>{stage === "loading" ? "Secure case storage" : "Terra case compiler"}</p>
          <h2>{stage === "loading" ? "Restoring the grounded draft…" : "Indexing the record and checking provenance…"}</h2>
          <p>{stage === "loading" ? "Only the signed owner session can reopen this review." : "This may take a moment. The original packet stays outside the public case catalog."}</p>
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

            <fieldset className={styles.reviewControls} disabled={stage === "publishing"}>
              <legend className={styles.srOnly}>Editable case content</legend>
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
                onChange={(caseGraph) => {
                  if (stage !== "publishing") {
                    setCompiled((current) => current ? { ...current, caseGraph } : current);
                  }
                }}
              />
            </fieldset>

            <CaseSourceReview caseGraph={compiled.caseGraph} />

            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
              <button className={styles.primaryButton} disabled={stage === "publishing"} onClick={publishCase} type="button">
                {stage === "publishing" ? "Publishing…" : "Approve & publish case"}
              </button>
              {stage === "publishing" ? (
                <span aria-disabled="true" className={`${styles.secondaryButton} ${styles.disabledAction}`}>
                  Save & close review
                </span>
              ) : (
                <Link className={styles.secondaryButton} href="/cases">Save & close review</Link>
              )}
              <span>The owner-bound workspace lists this case for the lifetime of the anonymous session.</span>
            </div>
          </div>

          <aside className={styles.reportPanel} aria-label="Compilation report">
            <p className={styles.kicker}>Compilation report</p>
            <div className={styles.coverageScore}>
              <strong>{sourceCoveragePercent === null ? "—" : `${sourceCoveragePercent}%`}</strong>
              <span>compiler fields directly source-linked</span>
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

      {stage === "published" && published && compiled && (
        <section className={styles.publishedPanel}>
          <span aria-hidden="true">✓</span>
          <p className={styles.kicker}>Case published</p>
          <h2>{compiled?.caseGraph.title}</h2>
          <p>Version {published.version} is ready for a fictional educational hearing.</p>
          <div className={styles.actions}>
            <Link
              className={styles.primaryButton}
              href={ownedHearingUrl(compiled.upload.uploadId)}
            >
              Begin hearing
            </Link>
            <Link className={styles.secondaryButton} href="/cases">View case library</Link>
            <button className={styles.secondaryButton} onClick={reset} type="button">Compile another case</button>
          </div>
          <CaseSourceReview caseGraph={published.caseGraph} />
        </section>
      )}
    </div>
  );
}
