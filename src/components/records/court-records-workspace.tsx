"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { CourtRecordDetail } from "./court-record-detail";
import {
  CourtRecordsClientError,
  downloadCourtRecord,
  isCourtRecordsRequestAbort,
  listCourtRecords,
  readCourtRecord,
} from "./court-records-client";
import { paginateCourtRecords } from "./court-records-pagination";
import styles from "./court-records-workspace.module.css";
import {
  courtRecordsUrl,
  type CourtRecordsInitialSelection,
  type CourtRecordsListResponse,
  type CourtRecordsView,
} from "../../domain/court-records";

const RECORD_LIST_PAGE_SIZE = 12;
const UNKNOWN_RECORDS_ERROR = "Court Records are temporarily unavailable.";

type CourtRecordsWorkspaceProps = Readonly<{
  initialSelection: CourtRecordsInitialSelection;
}>;

type ListState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; records: CourtRecordsListResponse }>
  | Readonly<{ status: "error"; message: string }>;

type DetailState =
  | Readonly<{ status: "unselected" }>
  | Readonly<{ status: "loading"; trialId: string }>
  | Readonly<{ status: "ready"; view: CourtRecordsView }>
  | Readonly<{ status: "error"; trialId: string; message: string }>;

type DownloadState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "working"; trialId: string }>
  | Readonly<{ status: "success"; trialId: string; message: string }>
  | Readonly<{ status: "error"; trialId: string; message: string }>;

function safeErrorMessage(error: unknown): string {
  return error instanceof CourtRecordsClientError
    ? error.message
    : UNKNOWN_RECORDS_ERROR;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function downloadExactJson(fileName: string, json: string): void {
  const objectUrl = URL.createObjectURL(
    new Blob([json], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  try {
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

function RecordsRail({
  listState,
  selectedTrialId,
  page,
  onPageChange,
  onRetry,
}: Readonly<{
  listState: ListState;
  selectedTrialId: string | null;
  page: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}>) {
  const records = listState.status === "ready" ? listState.records : [];
  const recordsPage = paginateCourtRecords(records, page, RECORD_LIST_PAGE_SIZE);

  return (
    <aside className={styles.rail} aria-label="Your Court Records">
      <div className={styles.railHeader}>
        <div>
          <p className={styles.railKicker}>Private archive</p>
          <strong>Your hearings</strong>
        </div>
        <span className={styles.railCount}>
          {listState.status === "ready" ? records.length : "-"} records
        </span>
      </div>

      {listState.status === "loading" ? (
        <div className={styles.railFooter} role="status">
          <span className={styles.muted}>Loading your records...</span>
        </div>
      ) : null}

      {listState.status === "error" ? (
        <div className={styles.railFooter} role="alert">
          <strong>Archive unavailable</strong>
          <p className={styles.muted}>{listState.message}</p>
          <button className={styles.secondaryButton} onClick={onRetry} type="button">
            Retry archive
          </button>
        </div>
      ) : null}

      {listState.status === "ready" && records.length === 0 ? (
        <div className={styles.railFooter}>
          <p className={styles.emptyCopy}>
            Start a hearing to create its owner-bound record.
          </p>
        </div>
      ) : null}

      {recordsPage.items.length > 0 ? (
        <ul className={styles.recordList}>
          {recordsPage.items.map((record) => {
            const isActive = record.trialId === selectedTrialId;
            return (
              <li key={record.trialId}>
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`${styles.recordLink} ${isActive ? styles.activeRecord : ""}`}
                  href={courtRecordsUrl(record.trialId)}
                >
                  <strong>{record.caseTitle}</strong>
                  <span className={styles.recordMeta}>
                    <span>{formatDate(record.updatedAt)}</span>
                    <span>{record.phase.replaceAll("_", " ")}</span>
                    <span>{record.status}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {recordsPage.pageCount > 1 ? (
        <div className={styles.railFooter}>
          <nav className={styles.pagination} aria-label="Record list pagination">
            <span>
              {recordsPage.start}-{recordsPage.end} of {recordsPage.total}
            </span>
            <div className={styles.pageActions}>
              <button
                className={styles.pageButton}
                disabled={recordsPage.page === 1}
                onClick={() => onPageChange(recordsPage.page - 1)}
                type="button"
              >
                Previous
              </button>
              <button
                className={styles.pageButton}
                disabled={recordsPage.page === recordsPage.pageCount}
                onClick={() => onPageChange(recordsPage.page + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </nav>
        </div>
      ) : null}
    </aside>
  );
}

export function CourtRecordsWorkspace({
  initialSelection,
}: CourtRecordsWorkspaceProps) {
  const selectedTrialId =
    initialSelection.kind === "valid" ? initialSelection.trialId : null;
  const [listState, setListState] = useState<ListState>({ status: "loading" });
  const [listPage, setListPage] = useState(1);
  const [listRequestGeneration, setListRequestGeneration] = useState(0);
  const [detailRequestGeneration, setDetailRequestGeneration] = useState(0);
  const [detailState, setDetailState] = useState<DetailState>(() =>
    selectedTrialId === null
      ? { status: "unselected" }
      : { status: "loading", trialId: selectedTrialId },
  );
  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: "idle",
  });
  const selectedTrialRef = useRef(selectedTrialId);
  const downloadGenerationRef = useRef(0);
  const downloadRequestRef = useRef<
    Readonly<{
      controller: AbortController;
      generation: number;
      trialId: string;
    }> | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void listCourtRecords({ signal: controller.signal }).then(
      (records) => {
        if (active) setListState({ status: "ready", records });
      },
      (error: unknown) => {
        if (
          !active ||
          controller.signal.aborted ||
          isCourtRecordsRequestAbort(error)
        ) {
          return;
        }
        setListState({ status: "error", message: safeErrorMessage(error) });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [listRequestGeneration]);

  useEffect(() => {
    if (selectedTrialId === null) return;

    const controller = new AbortController();
    let active = true;
    void readCourtRecord(selectedTrialId, { signal: controller.signal }).then(
      (view) => {
        if (active) setDetailState({ status: "ready", view });
      },
      (error: unknown) => {
        if (
          !active ||
          controller.signal.aborted ||
          isCourtRecordsRequestAbort(error)
        ) {
          return;
        }
        setDetailState({
          status: "error",
          trialId: selectedTrialId,
          message: safeErrorMessage(error),
        });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [detailRequestGeneration, selectedTrialId]);

  useLayoutEffect(() => {
    selectedTrialRef.current = selectedTrialId;
    return () => {
      downloadRequestRef.current?.controller.abort();
      downloadRequestRef.current = null;
    };
  }, [selectedTrialId]);

  const visibleDetailState: DetailState =
    selectedTrialId === null
      ? { status: "unselected" }
      : (detailState.status === "ready" &&
            detailState.view.summary.trialId === selectedTrialId) ||
          ((detailState.status === "loading" || detailState.status === "error") &&
            detailState.trialId === selectedTrialId)
        ? detailState
        : { status: "loading", trialId: selectedTrialId };

  const visibleDownloadState: DownloadState =
    downloadState.status !== "idle" &&
    downloadState.trialId === selectedTrialId
      ? downloadState
      : { status: "idle" };

  function retryList(): void {
    setListState({ status: "loading" });
    setListRequestGeneration((current) => current + 1);
  }

  function retryDetail(): void {
    if (selectedTrialId === null) return;
    setDetailState({ status: "loading", trialId: selectedTrialId });
    setDetailRequestGeneration((current) => current + 1);
  }

  async function handleDownload(): Promise<void> {
    if (
      visibleDetailState.status !== "ready" ||
      visibleDownloadState.status === "working"
    ) {
      return;
    }
    const trialId = visibleDetailState.view.summary.trialId;
    downloadRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const generation = downloadGenerationRef.current + 1;
    downloadGenerationRef.current = generation;
    downloadRequestRef.current = { controller, generation, trialId };
    setDownloadState({ status: "working", trialId });
    try {
      const record = await downloadCourtRecord(trialId, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        downloadRequestRef.current?.generation !== generation ||
        selectedTrialRef.current !== trialId
      ) {
        return;
      }
      downloadExactJson(record.fileName, record.json);
      setDownloadState({
        status: "success",
        trialId,
        message: "The exact validated Court Record JSON was downloaded.",
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        isCourtRecordsRequestAbort(error) ||
        downloadRequestRef.current?.generation !== generation ||
        selectedTrialRef.current !== trialId
      ) {
        return;
      }
      setDownloadState({
        status: "error",
        trialId,
        message: safeErrorMessage(error),
      });
    } finally {
      if (downloadRequestRef.current?.generation === generation) {
        downloadRequestRef.current = null;
      }
    }
  }

  return (
    <section
      className={styles.workspace}
      data-records-state={visibleDetailState.status}
      data-testid="court-records-workspace"
    >
      <div className={styles.intro}>
        <div>
          <p className={styles.kicker}>Evidence-grounded review</p>
          <h1>The record, with its boundaries intact.</h1>
          <p className={styles.introCopy}>
            Review the append-only hearing history, active and stricken testimony,
            procedural rulings, model-call audit, speech-runtime metadata, and grounded
            coaching for hearings owned by this browser session.
          </p>
        </div>
        <div className={styles.trustCard}>
          <strong>Educational simulation - not legal advice</strong>
          <span>
            Raw microphone audio is not retained. Hidden authoring truth and
            coaching-only material remain distinctly labeled from the admitted
            courtroom record.
          </span>
        </div>
      </div>

      <div className={styles.layout}>
        <RecordsRail
          listState={listState}
          onPageChange={setListPage}
          onRetry={retryList}
          page={listPage}
          selectedTrialId={selectedTrialId}
        />

        <div className={styles.detail}>
          {initialSelection.kind === "invalid" ? (
            <div className={styles.errorBox} role="alert">
              <strong>Invalid Court Record link</strong>
              <span>Choose a hearing from your private archive.</span>
            </div>
          ) : null}

          {visibleDetailState.status === "unselected" ? (
            <div className={styles.emptyState}>
              <p className={styles.sectionKicker}>No record selected</p>
              <h2>Choose a hearing to inspect.</h2>
              <p className={styles.emptyCopy}>
                The browser requests only the selected owner-bound projection.
              </p>
            </div>
          ) : null}

          {visibleDetailState.status === "loading" ? (
            <div className={styles.statePanel} role="status">
              <span className={styles.loadingMark} aria-hidden="true" />
              <h2>Opening the validated record...</h2>
              <p className={styles.emptyCopy}>Replaying its privacy-safe projection.</p>
            </div>
          ) : null}

          {visibleDetailState.status === "error" ? (
            <div className={styles.statePanel} role="alert">
              <p className={styles.sectionKicker}>Record unavailable</p>
              <h2>This hearing could not be opened.</h2>
              <p className={styles.emptyCopy}>{visibleDetailState.message}</p>
              <button
                className={styles.secondaryButton}
                onClick={retryDetail}
                type="button"
              >
                Retry record
              </button>
            </div>
          ) : null}

          {visibleDetailState.status === "ready" ? (
            <CourtRecordDetail
              downloadMessage={
                visibleDownloadState.status === "success" ||
                visibleDownloadState.status === "error"
                  ? visibleDownloadState.message
                  : null
              }
              downloadStatus={visibleDownloadState.status}
              onDownload={() => void handleDownload()}
              view={visibleDetailState.view}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
