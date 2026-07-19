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
import {
  HearingController,
  type HearingControllerSnapshot,
  type HearingFinalSubmission,
} from "@/lib/speech/hearing-controller";
import type { HearingSpeechViewSource } from "@/lib/speech/hearing-policy";

import { DeveloperTypedInput } from "./developer-typed-input";
import {
  hearingLifecycleBlocksCourtroomControls,
  shouldReloadHearingSession,
} from "./session-policy";

const DEFAULT_CASE_SLUG = "redwood-signal-retaliation";
const DEFAULT_LOCAL_SPEECH_URL = "ws://127.0.0.1:8765/v1/speech";
const LOCAL_SPEECH_URL =
  process.env.NEXT_PUBLIC_SUITS_SPEECH_URL?.trim() || DEFAULT_LOCAL_SPEECH_URL;
const DEV_TYPED_INPUT_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT === "1";

type PendingSpeechAdoption = Readonly<{
  previous: HearingRuntimeViewV1 | null;
  next: HearingRuntimeViewV1;
  source: HearingSpeechViewSource;
}>;

function speechStatusLabel(snapshot: HearingControllerSnapshot | null): string {
  if (snapshot === null) return "Local audio controller unavailable";
  switch (snapshot.lifecycle) {
    case "idle":
      return "Local audio needs preparation";
    case "preparing":
      return "Preparing microphone and local models";
    case "ready":
      return "Local courtroom audio ready";
    case "recording":
      return "Listening locally";
    case "processing":
      return "Finalizing the local transcript";
    case "speaking":
      return "Playing courtroom speech";
    case "recoverable_error":
      return "Local audio needs attention";
    case "fatal_error":
      return "Local audio stopped safely";
    case "closed":
      return "Local audio closed";
  }
}

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
  const [pendingStart, setPendingStart] = useState(false);
  const [pendingIntent, setPendingIntent] =
    useState<HearingPlayerIntent | null>(null);
  const viewRef = useRef<HearingRuntimeViewV1 | null>(null);
  const busyRef = useRef(false);
  const pendingIntentRef = useRef<HearingPlayerIntent | null>(null);
  const createdTrialIdRef = useRef<string | undefined>(undefined);
  const observedTrialSearchRef = useRef(initialTrialId);
  const pendingStartRequest = useRef<StartHearingRequest | undefined>(
    undefined,
  );
  const pendingCommand = useRef<HearingPlayerCommand | undefined>(undefined);
  const speechControllerRef = useRef<HearingController | null>(null);
  const speechQueueRef = useRef<PendingSpeechAdoption[]>([]);
  const speechDrainPromiseRef = useRef<Promise<void> | null>(null);
  const requestSpeechDrainRef = useRef<() => void>(() => undefined);
  const commitFinalRef = useRef<
    (submission: HearingFinalSubmission) => Promise<void>
  >(async () => {
    throw new Error("The hearing command bridge is not ready.");
  });
  const [speechController, setSpeechController] =
    useState<HearingController | null>(null);
  const [speechSnapshot, setSpeechSnapshot] =
    useState<HearingControllerSnapshot | null>(null);
  const [speechSetupError, setSpeechSetupError] = useState<string>();
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
    let disposed = false;
    let controller: HearingController;
    try {
      controller = new HearingController({
        url: LOCAL_SPEECH_URL,
        getView: () => viewRef.current,
        getActivity: () => ({
          busy: busyRef.current,
          pending: pendingIntentRef.current !== null,
        }),
        commitFinal: (submission) => commitFinalRef.current(submission),
      });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "The local audio controller could not be created.";
      queueMicrotask(() => {
        if (!disposed) setSpeechSetupError(message);
      });
      return () => {
        disposed = true;
      };
    }

    speechControllerRef.current = controller;
    const unsubscribe = controller.subscribe((snapshot) => {
      setSpeechSnapshot(snapshot);
      if (snapshot.lifecycle === "ready") requestSpeechDrainRef.current();
    });
    queueMicrotask(() => {
      if (disposed) return;
      setSpeechController(controller);
      setSpeechSnapshot(controller.snapshot);
    });
    return () => {
      disposed = true;
      unsubscribe();
      if (speechControllerRef.current === controller) {
        speechControllerRef.current = null;
      }
      void controller.close().catch(() => {
        // close() has already fenced capture/playback and retained its safe status.
      });
    };
  }, []);

  useEffect(() => {
    const previousTrialId = observedTrialSearchRef.current;
    observedTrialSearchRef.current = initialTrialId;
    const activeTrialId = viewRef.current?.trial.trialId;
    if (
      shouldReloadHearingSession({
        previousSearchTrialId: previousTrialId,
        currentSearchTrialId: initialTrialId,
        createdTrialId: createdTrialIdRef.current,
        activeTrialId,
      })
    ) {
      // A controller is scoped to one durable transcript baseline. A cross-trial
      // history navigation reloads that local-only state instead of mixing queues.
      window.location.reload();
    }
  }, [createdTrialId, initialTrialId]);

  useEffect(() => {
    if (!initialTrialId || initialTrialId === createdTrialIdRef.current) return;
    const activeTrialId = viewRef.current?.trial.trialId;
    if (activeTrialId !== undefined && activeTrialId !== initialTrialId) return;
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
        speechQueueRef.current.length = 0;
        viewRef.current = parsed.data;
        setView(parsed.data);
        speechControllerRef.current?.baselineView(parsed.data);
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
  }, [createdTrialId, initialTrialId]);

  function publishView(next: HearingRuntimeViewV1): void {
    viewRef.current = next;
    setView(next);
  }

  function queueSpeech(adoption: PendingSpeechAdoption): void {
    speechQueueRef.current.push(adoption);
    requestSpeechDrainRef.current();
  }

  function requestSpeechDrain(): void {
    if (
      speechDrainPromiseRef.current !== null ||
      busyRef.current ||
      pendingIntentRef.current !== null ||
      speechQueueRef.current.length === 0
    ) {
      return;
    }
    const controller = speechController;
    if (controller === null || controller.snapshot.lifecycle !== "ready") return;

    const drain = async (): Promise<void> => {
      while (
        !busyRef.current &&
        pendingIntentRef.current === null &&
        speechQueueRef.current.length > 0
      ) {
        const activeController = speechController;
        if (
          activeController === null ||
          activeController.snapshot.lifecycle !== "ready"
        ) {
          return;
        }
        const adoption = speechQueueRef.current.shift();
        if (adoption === undefined) return;
        try {
          await activeController.adoptView(
            adoption.previous,
            adoption.next,
            adoption.source,
          );
          setSpeechSetupError(undefined);
        } catch (cause) {
          setSpeechSetupError(
            cause instanceof Error
              ? cause.message
              : "The committed courtroom speech could not be played locally.",
          );
          return;
        }
      }
    };

    const pendingDrain = drain();
    speechDrainPromiseRef.current = pendingDrain;
    void pendingDrain.finally(() => {
      if (speechDrainPromiseRef.current === pendingDrain) {
        speechDrainPromiseRef.current = null;
      }
      requestSpeechDrainRef.current();
    });
  }
  useEffect(() => {
    requestSpeechDrainRef.current = requestSpeechDrain;
  });

  function setPendingIntentState(intent: HearingPlayerIntent | null): void {
    pendingIntentRef.current = intent;
    setPendingIntent(intent);
  }

  async function executeOrThrow(work: () => Promise<void>): Promise<void> {
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (caught) {
      const failure =
        caught instanceof Error
          ? caught
          : new Error("The courtroom action could not be committed.");
      setError(failure.message);
      throw failure;
    } finally {
      busyRef.current = false;
      setBusy(false);
      requestSpeechDrainRef.current();
    }
  }

  async function execute(work: () => Promise<void>): Promise<boolean> {
    try {
      await executeOrThrow(work);
      return true;
    } catch {
      return false;
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
      createdTrialIdRef.current = parsed.data.trial.trialId;
      publishView(parsed.data);
      queueSpeech({ previous: null, next: parsed.data, source: "new_hearing" });
      setCreatedTrialId(parsed.data.trial.trialId);
      window.history.replaceState(
        null,
        "",
        hearingUrl(parsed.data.trial.trialId),
      );
    });
  }

  async function commitIntentOrThrow(intent: HearingPlayerIntent): Promise<void> {
    await executeOrThrow(async () => {
      const previous = viewRef.current;
      if (previous === null) throw new Error("The hearing is not ready.");
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
          expectedStateVersion: previous.trial.version,
          expectedLastEventId: previous.trial.lastEventId,
          intent,
        } satisfies HearingPlayerCommand);
      pendingCommand.current = command;
      setPendingIntentState(command.intent);
      try {
        const response = await fetch(
          `/api/hearings/${encodeURIComponent(previous.trial.trialId)}/commands`,
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
        setPendingIntentState(null);
        publishView(parsed.data);
        queueSpeech({ previous, next: parsed.data, source: "command" });
      } catch (caught) {
        try {
          const recovery = await fetch(
            `/api/hearings/${encodeURIComponent(previous.trial.trialId)}`,
            { credentials: "same-origin", cache: "no-store" },
          );
          if (!recovery.ok) throw new Error(await responseError(recovery));
          const refreshed = HearingRuntimeViewV1Schema.safeParse(
            await recovery.json(),
          );
          if (!refreshed.success) {
            throw new Error("The refreshed hearing response was invalid.");
          }
          publishView(refreshed.data);
          queueSpeech({ previous, next: refreshed.data, source: "recovery" });
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

  async function commitIntent(intent: HearingPlayerIntent): Promise<boolean> {
    try {
      await commitIntentOrThrow(intent);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    commitFinalRef.current = async (submission) => {
      await commitIntentOrThrow(submission.intent);
    };
  });

  async function performSpeechAction(work: () => Promise<void>): Promise<void> {
    setSpeechSetupError(undefined);
    try {
      await work();
    } catch (cause) {
      setSpeechSetupError(
        cause instanceof Error
          ? cause.message
          : "The local courtroom audio action failed safely.",
      );
    }
  }

  function prepareSpeech(): void {
    const controller = speechController;
    if (controller === null) {
      setSpeechSetupError("The local audio controller is unavailable.");
      return;
    }
    void performSpeechAction(async () => {
      await controller.prepare();
    });
  }

  function testSpeaker(): void {
    const controller = speechController;
    if (controller === null) return;
    void performSpeechAction(async () => {
      await controller.speakerTest();
    });
  }

  function toggleRecording(mode: "question" | "closing"): void {
    const controller = speechController;
    if (controller === null) return;
    void performSpeechAction(async () => {
      if (
        controller.snapshot.lifecycle === "recording" &&
        controller.snapshot.activeMode === mode
      ) {
        await controller.stopRecording();
      } else {
        await controller.startRecording(mode);
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
  const speechLifecycle = speechSnapshot?.lifecycle;
  const speechIsRecording = speechLifecycle === "recording";
  const speechCanStartRecording =
    speechLifecycle === "ready" || speechLifecycle === "speaking";
  const speechBlocksCourtroomControls =
    hearingLifecycleBlocksCourtroomControls(speechLifecycle);
  const questionIsRecording =
    speechIsRecording && speechSnapshot?.activeMode === "question";
  const closingIsRecording =
    speechIsRecording && speechSnapshot?.activeMode === "closing";

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

            <div className="voice-primary" aria-live="polite">
              <span>Browser-to-local speech companion</span>
              <strong>{speechStatusLabel(speechSnapshot)}</strong>
              <small>
                Microphone frames stay on the direct local WebSocket path. Only a
                validated final transcript can become a courtroom command.
              </small>
              {speechSnapshot?.capabilities && (
                <small>
                  {speechSnapshot.capabilities.serviceMode} mode ·{" "}
                  {speechSnapshot.capabilities.providers
                    .filter((provider) => provider.ready)
                    .map((provider) => provider.kind)
                    .join(" + ") || "providers unavailable"}
                </small>
              )}
              <div className="input-actions voice-controls">
                {(speechLifecycle === "idle" ||
                  speechLifecycle === "recoverable_error") && (
                  <button
                    className="voice-primary-button"
                    disabled={busy || Boolean(pendingIntent)}
                    onClick={prepareSpeech}
                    type="button"
                  >
                    {speechLifecycle === "recoverable_error"
                      ? "Prepare local audio again"
                      : "Prepare local audio"}
                  </button>
                )}
                {speechLifecycle === "preparing" && (
                  <button className="voice-primary-button" disabled type="button">
                    Requesting local audio access…
                  </button>
                )}
                {speechLifecycle === "ready" && (
                  <button
                    className="quiet-button voice-button"
                    disabled={busy || Boolean(pendingIntent)}
                    onClick={testSpeaker}
                    type="button"
                  >
                    Test speaker
                  </button>
                )}
              </div>
              {(speechSnapshot?.message || speechSetupError) && (
                <div className="voice-status" role="alert">
                  <strong>{speechSetupError ?? speechSnapshot?.message}</strong>
                  {(speechSnapshot === null ||
                    speechLifecycle === "fatal_error") && (
                    <span>
                      Check the loopback speech service and configured URL, then
                      reload this hearing.
                    </span>
                  )}
                </div>
              )}
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
                <div className="advocacy-label">
                  {readable(activeLeg.kind)} examination · {activeWitness.name}
                </div>
                <p className="required-opening">
                  Ask only about this witness’s own perceptions, prior statements, or exhibits
                  they have seen. The server will reject knowledge leakage.
                </p>
                <div className="voice-primary">
                  <span>
                    {readable(activeLeg.kind)} examination · {activeWitness.name}
                  </span>
                  <button
                    className="voice-primary-button"
                    disabled={
                      busy ||
                      Boolean(pendingIntent) ||
                      Boolean(view.activeQuestion) ||
                      (speechIsRecording
                        ? !questionIsRecording
                        : !speechCanStartRecording)
                    }
                    onClick={() => toggleRecording("question")}
                    type="button"
                  >
                    {questionIsRecording
                      ? "Stop and submit question"
                      : speechLifecycle === "speaking"
                        ? "Interrupt and ask question"
                        : "Start spoken question"}
                  </button>
                  <small>
                    Speak one focused question. Final recognition is revalidated
                    against this exact witness and record head before submission.
                  </small>
                  {questionIsRecording && speechSnapshot.partialText && (
                    <div className="transcript-preview" role="status">
                      {speechSnapshot.partialText}
                    </div>
                  )}
                </div>
                {DEV_TYPED_INPUT_ENABLED && (
                  <DeveloperTypedInput
                    controller={speechController}
                    disabled={
                      busy ||
                      Boolean(pendingIntent) ||
                      speechBlocksCourtroomControls ||
                      speechLifecycle !== "ready"
                    }
                    label="Developer-only typed question"
                    minimumLength={3}
                    mode="question"
                    onFailure={setSpeechSetupError}
                    placeholder="Ask a focused, record-grounded question."
                  />
                )}
                <div className="input-actions">
                  <button
                    className="quiet-button"
                    disabled={
                      busy ||
                      Boolean(pendingIntent) ||
                      speechBlocksCourtroomControls ||
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
                <div className="voice-primary">
                  <span>Closing argument</span>
                  <button
                    className="voice-primary-button"
                    disabled={
                      busy ||
                      Boolean(pendingIntent) ||
                      (speechIsRecording
                        ? !closingIsRecording
                        : !speechCanStartRecording)
                    }
                    onClick={() => toggleRecording("closing")}
                    type="button"
                  >
                    {closingIsRecording
                      ? "Stop, rest, and close"
                      : speechLifecycle === "speaking"
                        ? "Interrupt for closing argument"
                        : "Start spoken closing argument"}
                  </button>
                  <small>
                    Connect admitted testimony and exhibits to the burden of proof.
                  </small>
                  {closingIsRecording && speechSnapshot.partialText && (
                    <div className="transcript-preview" role="status">
                      {speechSnapshot.partialText}
                    </div>
                  )}
                </div>
                {DEV_TYPED_INPUT_ENABLED && (
                  <DeveloperTypedInput
                    controller={speechController}
                    disabled={
                      busy ||
                      Boolean(pendingIntent) ||
                      speechBlocksCourtroomControls ||
                      speechLifecycle !== "ready"
                    }
                    label="Developer-only typed closing"
                    minimumLength={12}
                    mode="closing"
                    onFailure={setSpeechSetupError}
                    placeholder="Connect the testimony to the burden of proof."
                  />
                )}
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                {pendingIntent && (
                  <div className="input-actions">
                    <button
                      className="quiet-button"
                      disabled={busy}
                      onClick={() => void commitIntent(pendingIntent)}
                    >
                      Retry pending action
                    </button>
                    <button
                      className="quiet-button"
                      disabled={busy}
                      onClick={() => window.location.reload()}
                    >
                      Reload durable record
                    </button>
                  </div>
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
                        disabled={
                          busy ||
                          Boolean(pendingIntent) ||
                          speechBlocksCourtroomControls
                        }
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
