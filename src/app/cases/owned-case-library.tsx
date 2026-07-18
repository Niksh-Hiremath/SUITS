"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  OwnedCaseListResponseSchema,
  type OwnedCaseSummary,
} from "@/domain/case-api";
import { ownedCaseWorkspaceUrl } from "@/domain/hearing-journey";

import styles from "./case-library.module.css";

export function OwnedCaseLibrary() {
  const [cases, setCases] = useState<OwnedCaseSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/cases/owned", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (response.status === 401) {
          setCases([]);
          return;
        }
        if (!response.ok) throw new Error(`Private case request failed with ${response.status}`);
        const parsed = OwnedCaseListResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Invalid private case response");
        setCases(parsed.data.cases);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, []);

  if (cases === null && !failed) return null;
  if (failed) {
    return (
      <p className={styles.privateLibraryError} role="status">
        Your private case workspace could not be loaded. The seeded records remain available.
      </p>
    );
  }
  if (!cases || cases.length === 0) return null;

  return (
    <section className={styles.privateCatalog} aria-labelledby="private-case-heading">
      <div className={styles.catalogHeader}>
        <h2 id="private-case-heading">Your case workspace</h2>
        <span>{cases.length} private case {cases.length === 1 ? "file" : "files"}</span>
      </div>
      <div className={styles.grid} aria-label="Private case workspace">
        {cases.map((item) => (
          <Link
            className={styles.card}
            href={ownedCaseWorkspaceUrl(item.status, item.uploadId)}
            key={item.caseId}
          >
            <div className={styles.cardMeta}><span>private upload</span><span>{item.status}</span></div>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            <dl>
              <div><dt>Witnesses</dt><dd>{item.witnessCount}</dd></div>
              <div><dt>Exhibits</dt><dd>{item.evidenceCount}</dd></div>
              <div><dt>Version</dt><dd>{item.recordVersion}</dd></div>
            </dl>
          </Link>
        ))}
      </div>
    </section>
  );
}
