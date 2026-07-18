"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HearingCaseSelectorSchema,
  HearingRuntimeViewV1Schema,
  type HearingPlayerCommand,
  type HearingPlayerIntent,
  type HearingRuntimeViewV1,
  type StartHearingRequest,
} from "@/domain/hearing-runtime";
import { hearingUrl, trialIdFromSearch } from "@/domain/hearing-journey";

const DEFAULT_CASE_SLUG = "redwood-signal-retaliation";

function readable(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function phaseLabel(view: HearingRuntimeViewV1 | null): string {
  if (!view) return "Case briefing";
  if (view.trial.phase === "complete") return "Record complete";
  if (view.activeAppearance) {
    const witness = view.witnesses.find(
      (candidate) => candidate.witnessId === view.activeAppearance?.witnessId,
    );
    return `${readable(view.activeAppearance.stage)} · ${witness?.name ?? "witness"}`;
  }
  return readable(view.trial.phase);
}

function actorLabel(
  turn: HearingRuntimeViewV1["transcript"][number],
  view: HearingRuntimeViewV1,
): string {
  if (turn.actor.role === "witness" && turn.actor.witnessId) {
    return (
      view.witnesses.find(
        (witness) => witness.witnessId === turn.actor.witnessId,
      )?.name ?? "Witness"
    );
  }
  switch (turn.actor.role) {
    case "user_counsel":
    case "opposing_counsel":
      return turn.actor.side === view.trial.userSide
        ? "Your counsel"
        : "Opposing counsel";
    case "judge":
      return "Judge";
    case "jury":
      return "Jury";
    case "clerk":
      return "Court clerk";
    case "debrief_coach":
      return "Advocacy coach";
    case "system":
      return "Court system";
    case "witness":
      return "Witness";
  }
}

function turnClass(
  turn: HearingRuntimeViewV1["transcript"][number],
  view: HearingRuntimeViewV1,
): string {
  switch (turn.actor.role) {
    case "user_counsel":
    case "opposing_counsel":
      return turn.actor.side === view.trial.userSide
        ? "user_advocate"
        : "opposing_advocate";
    case "witness":
      return "witness";
    default:
      return "director";
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const value = (await response.json()) as {
      error?: { message?: unknown };
    };
    if (typeof value.error?.message === "string") return value.error.message;
  } catch {
    // The status fallback below is intentionally user-safe.
  }
  return `The courtroom service returned ${response.status}.`;
}

export default function HearingPage() {
  return (
    <Suspense
      fallback={
        <main className="hearing-shell">
          <section className="briefing-panel loading-panel" role="status">
            <div className="eyebrow">Restoring the record</div>
            <h1>Checking the event stream…</h1>
          </section>
        </main>
      }
    >
      <HearingPageContent />
    </Suspense>
  );
}

function HearingPageContent() {
  const searchParams = useSearchParams();
  const initialTrialId = trialIdFromSearch(searchParams.toString());
  const [createdTrialId, setCreatedTrialId] = useState<string>();
  const [view, setView] = useState<HearingRuntimeViewV1 | null>(null);
  const [loading, setLoading] = useState(Boolean(initialTrialId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [question, setQuestion] = useState("");
  const [closing, setClosing] = useState("");
  const [pendingStart, setPendingStart] = useState(false);
  const [pendingIntent, setPendingIntent] =
    useState<HearingPlayerIntent | null>(null);
  const pendingStartRequest = useRef<StartHearingRequest | undefined>(
    undefined,
  );
  const pendingCommand = useRef<HearingPlayerCommand | undefined>(undefined);
  const trialId = createdTrialId ?? initialTrialId;

  const caseSelector = useMemo(() => {
    const uploadId = searchParams.get("upload")?.trim();
    const candidate = uploadId
      ? { kind: "owned", uploadId }
      : {
          kind: "seeded",
          slug: searchParams.get("case")?.trim() || DEFAULT_CASE_SLUG,
        };
    return HearingCaseSelectorSchema.safeParse(candidate);
  }, [searchParams]);

  useEffect(() => {
    if (!initialTrialId) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(
          `/api/hearings/${encodeURIComponent(initialTrialId)}`,
          { credentials: "same-origin", cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(await responseError(response));
        const parsed = HearingRuntimeViewV1Schema.safeParse(await response.json());
        if (!parsed.success) throw new Error("The saved hearing response was invalid.");
        setView(parsed.data);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The hearing could not be reopened.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [initialTrialId]);

  async function execute(work: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The courtroom action could not be committed.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function beginHearing(): Promise<void> {
    await execute(async () => {
      if (!caseSelector.success) throw new Error("Choose a valid published case.");
      const request =
        pendingStartRequest.current ??
        ({
          schemaVersion: HEARING_START_SCHEMA_VERSION,
          requestId: crypto.randomUUID(),
          requestedAt: new Date().toISOString(),
          case: caseSelector.data,
          userSide: "user",
        } satisfies StartHearingRequest);
      pendingStartRequest.current = request;
      setPendingStart(true);
      const response = await fetch("/api/hearings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const parsed = HearingRuntimeViewV1Schema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The new hearing response was invalid.");
      pendingStartRequest.current = undefined;
      setPendingStart(false);
      setView(parsed.data);
      setCreatedTrialId(parsed.data.trial.trialId);
      window.history.replaceState(
        null,
        "",
        hearingUrl(parsed.data.trial.trialId),
      );
    });
  }

  async function commitIntent(intent: HearingPlayerIntent): Promise<boolean> {
    return execute(async () => {
      if (!view) throw new Error("The hearing is not ready.");
      const retained = pendingCommand.current;
      if (
        retained &&
        JSON.stringify(retained.intent) !== JSON.stringify(intent)
      ) {
        throw new Error(
          "A previous courtroom action is awaiting confirmation. Retry it before starting another.",
        );
      }
      const command =
        retained ??
        ({
          schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
          requestId: crypto.randomUUID(),
          requestedAt: new Date().toISOString(),
          expectedStateVersion: view.trial.version,
          expectedLastEventId: view.trial.lastEventId,
          intent,
        } satisfies HearingPlayerCommand);
      pendingCommand.current = command;
      setPendingIntent(command.intent);
      try {
        const response = await fetch(
          `/api/hearings/${encodeURIComponent(view.trial.trialId)}/commands`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(command),
          },
        );
        if (!response.ok) throw new Error(await responseError(response));
        const parsed = HearingRuntimeViewV1Schema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error("The updated hearing response was invalid.");
        }
        pendingCommand.current = undefined;
        setPendingIntent(null);
        setView(parsed.data);
      } catch (caught) {
        try {
          const recovery = await fetch(
            `/api/hearings/${encodeURIComponent(view.trial.trialId)}`,
            { credentials: "same-origin", cache: "no-store" },
          );
          if (!recovery.ok) throw new Error(await responseError(recovery));
          const refreshed = HearingRuntimeViewV1Schema.safeParse(
            await recovery.json(),
          );
          if (!refreshed.success) {
            throw new Error("The refreshed hearing response was invalid.");
          }
          setView(refreshed.data);
        } catch (recoveryError) {
          throw new Error(
            "The action is still pending and the durable record could not be refreshed. Retry when the service is available.",
            { cause: recoveryError },
          );
        }
        throw caught;
      }
    });
  }

  const activeWitness = view?.activeAppearance
    ? view.witnesses.find(
        (witness) => witness.witnessId === view.activeAppearance?.witnessId,
      )
    : undefined;
  const activeLeg = view?.activeAppearance?.examinationLeg;
  const playerOwnsFloor =
    Boolean(activeLeg) &&
    activeLeg?.ownerSide === view?.trial.userSide &&
    view?.capabilities.canAskQuestion;
  const witnessAnswerCount =
    view?.transcript.filter((turn) => turn.actor.role === "witness").length ?? 0;
  const canFinishTrial = Boolean(view?.capabilities.canFinishTrial);

  return (
    <main className="hearing-shell">
      <header className="hearing-header">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <div className="phase-chip">{phaseLabel(view)}</div>
        <Link className="text-link" href="/cases/">Case library</Link>
      </header>

      {loading ? (
        <section className="briefing-panel loading-panel" role="status">
          <div className="eyebrow">Saved V3 hearing found</div>
          <h1>Replaying the record…</h1>
          <p>The server is validating the projection against its append-only event stream.</p>
        </section>
      ) : !view ? (
        <section className="briefing-panel">
          <div className="eyebrow">Fictional educational courtroom</div>
          <h1>Open the trial record.</h1>
          <p>
            This hearing uses a deterministic event engine, isolated witness knowledge,
            and a durable owner-bound record. It is an educational simulation—not legal advice.
          </p>
          <div className="case-timeline">
            <strong>Selected record</strong>
            <span>
              {caseSelector.success
                ? caseSelector.data.kind === "seeded"
                  ? readable(caseSelector.data.slug)
                  : "your published case packet"
                : "invalid case selector"}
            </span>
            <span>Multiple witnesses · evidence lifecycle · exact refresh recovery</span>
          </div>
          {error && <div className="error-banner" role="alert">{error}</div>}
          {trialId && (
            <p>
              This URL points to an unavailable or differently owned hearing. You can return
              to the <Link href="/cases/">case library</Link> to start another.
            </p>
          )}
          {!trialId && (
            <button
              className="primary-button"
              disabled={busy || !caseSelector.success}
              onClick={() => void beginHearing()}
            >
              {busy
                ? "Creating the event stream…"
                : pendingStart
                  ? "Retry same hearing request"
                  : "Begin V3 hearing"}
            </button>
          )}
        </section>
      ) : view.trial.phase === "complete" ? (
        <section className="debrief-panel">
          <div className="eyebrow">Durable record complete</div>
          <h1>{view.case.title}</h1>
          <p className="assessment">
            The hearing completed at event {view.trial.sequence}. Its transcript was projected
            from the same validated V3 stream that will ground the coaching debrief.
          </p>
          <div className="evidence-strip">
            <span>{view.witnesses.filter((witness) => witness.callCount > 0).length} witnesses called</span>
            <span>{witnessAnswerCount} answers</span>
            <span>state v{view.trial.version}</span>
          </div>
          <Link className="primary-button" href="/cases/">Return to case library</Link>
          {error && <div className="error-banner" role="alert">{error}</div>}
        </section>
      ) : (
        <div className="hearing-grid">
          <section className="transcript-panel">
            <div className="panel-heading">
              <div>
                <span>Append-only live record</span>
                <h1>{view.case.title}</h1>
              </div>
              <span>{view.transcript.length} turns · E-{view.trial.sequence}</span>
            </div>

            <div className="transcript-list" aria-live="polite">
              {view.transcript.length === 0 && (
                <div className="thinking-line">
                  <b>No testimony yet.</b>
                  <span> Call any available witness from the roster.</span>
                </div>
              )}
              {view.transcript.map((turn) => (
                <article
                  className={`turn turn-${turnClass(turn, view)}`}
                  key={turn.turnId}
                >
                  <div className="turn-meta">
                    <strong>{actorLabel(turn, view)}</strong>
                    <span>T-{String(turn.ordinal).padStart(3, "0")} · {turn.status}</span>
                  </div>
                  <p>{turn.text}</p>
                  {turn.citations.evidenceIds.length > 0 && (
                    <div className="turn-evidence">
                      {turn.citations.evidenceIds.join(" · ")}
                    </div>
                  )}
                </article>
              ))}
              {busy && (
                <div className="thinking-line" role="status">
                  <b>Committing the next event…</b>
                  <span> Refresh is safe after the server confirms it.</span>
                </div>
              )}
            </div>

            {activeWitness && activeLeg && playerOwnsFloor && (
              <div className="advocacy-box">
                <label htmlFor="question">
                  {readable(activeLeg.kind)} examination · {activeWitness.name}
                </label>
                <p className="required-opening">
                  Ask only about this witness’s own perceptions, prior statements, or exhibits
                  they have seen. The server will reject knowledge leakage.
                </p>
                <textarea
                  disabled={Boolean(pendingIntent)}
                  id="question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask a focused, record-grounded question."
                  rows={3}
                />
                <div className="input-actions">
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      Boolean(pendingIntent) ||
                      !view.capabilities.canAskQuestion ||
                      question.trim().length < 3 ||
                      Boolean(view.activeQuestion)
                    }
                    onClick={() => void (async () => {
                      const committed = await commitIntent({
                        type: "ask_question",
                        witnessId: activeWitness.witnessId,
                        examinationKind: activeLeg.kind,
                        text: question.trim(),
                        presentedEvidenceIds: [],
                      });
                      if (committed) setQuestion("");
                    })()}
                  >
                    Ask witness
                  </button>
                  <button
                    className="quiet-button"
                    disabled={
                      busy ||
                      Boolean(pendingIntent) ||
                      Boolean(view.activeQuestion) ||
                      !view.capabilities.canFinishExamination
                    }
                    onClick={() =>
                      void commitIntent({
                        type: "finish_witness",
                        witnessId: activeWitness.witnessId,
                        examinationKind: activeLeg.kind,
                      })
                    }
                  >
                    End examination
                  </button>
                </div>
              </div>
            )}

            {canFinishTrial && (
              <div className="advocacy-box closing-box">
                <label htmlFor="closing">Closing argument</label>
                <textarea
                  disabled={Boolean(pendingIntent)}
                  id="closing"
                  value={closing}
                  onChange={(event) => setClosing(event.target.value)}
                  placeholder="Connect the testimony to the burden of proof."
                  rows={5}
                />
                <div className="input-actions">
                  <button
                    className="primary-button"
                    disabled={
                      busy || Boolean(pendingIntent) || closing.trim().length < 12
                    }
                    onClick={() =>
                      void commitIntent({
                        type: "finish_trial",
                        closingText: closing.trim(),
                      })
                    }
                  >
                    Rest and close
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                {pendingIntent && (
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => void commitIntent(pendingIntent)}
                  >
                    Retry pending action
                  </button>
                )}
              </div>
            )}
          </section>

          <aside className="case-rail" aria-label="Case and witness controls">
            <article className="rail-card">
              <span>Witness roster</span>
              {view.witnesses.map((witness) => {
                const canCall =
                  !view.activeAppearance &&
                  ((witness.status === "available" && witness.callableByPlayer) ||
                    (witness.status === "released" && witness.recallableByPlayer));
                return (
                  <div className="case-timeline" key={witness.witnessId}>
                    <strong>{witness.name}</strong>
                    <span>{witness.role}</span>
                    <span>
                      {witness.status} · called {witness.callCount} {witness.callCount === 1 ? "time" : "times"}
                    </span>
                    {canCall && (
                      <button
                        className="quiet-button"
                        disabled={busy || Boolean(pendingIntent)}
                        onClick={() =>
                          void commitIntent({
                            type: "call_witness",
                            witnessId: witness.witnessId,
                          })
                        }
                      >
                        {witness.status === "released" ? "Recall" : "Call witness"}
                      </button>
                    )}
                  </div>
                );
              })}
            </article>
            <article className="rail-card">
              <span>Visible case material</span>
              <strong>{view.player.facts.length} facts · {view.player.evidence.length} exhibits</strong>
              <p>Hidden authoring truth and other roles’ private knowledge are excluded from this view.</p>
              <div className="evidence-strip">
                {view.player.evidence.slice(0, 8).map((evidence) => (
                  <span key={evidence.evidenceId}>{evidence.evidenceId} · {evidence.status}</span>
                ))}
              </div>
            </article>
            <article className="rail-card">
              <span>Record integrity</span>
              <strong>State v{view.trial.version}</strong>
              <p>Last committed event: {view.trial.lastEventId}</p>
            </article>
            <article className="rail-card">
              <span>Educational use</span>
              <p>{view.case.educationalDisclaimer}</p>
            </article>
          </aside>
        </div>
      )}
    </main>
  );
}
