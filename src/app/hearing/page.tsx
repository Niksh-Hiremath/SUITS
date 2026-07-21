"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CourtroomStage } from "@/components/courtroom/courtroom-stage";
import { courtRecordsUrl } from "@/domain/court-records/navigation";
import {
  advanceCourtroomPresentationRuntime,
  createCourtroomPresentationRuntime,
  deriveCourtroomPresentation,
  nextCourtroomPresentationWakeAt,
  rebaseCourtroomPresentationRuntime,
  reduceCourtroomPresentationRuntime,
  resetCourtroomPresentationRuntime,
  selectAudibleCourtroomSemanticPerformance,
  selectCourtroomPresentationRuntime,
  type CourtroomQuality,
} from "@/domain/courtroom-presentation";
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
  FinalBoundInterruptionResolutionSchema,
  FinalBoundInterruptionResponseSchema,
} from "@/domain/objections/final-bound-contracts";
import {
  HearingController,
  HearingControllerError,
  type HearingControllerSnapshot,
  type HearingFinalSubmission,
} from "@/lib/speech/hearing-controller";
import {
  createHearingAudioAuditSink,
  type HearingAudioAuditSink,
} from "@/lib/speech/hearing-audio-audit-sink";
import { DeveloperTypedInput } from "./developer-typed-input";
import {
  hearingLifecycleBlocksCourtroomControls,
  shouldReloadHearingSession,
} from "./session-policy";
import {
  adoptRecoveredInterruptionResponse,
  enqueuePendingSpeechAdoption,
  type PendingSpeechAdoption,
} from "./speech-queue";
import {
  buildContinueResponseIntent,
  buildObjectIntent,
  deriveOpponentResponseWindow,
  type OpponentResponseGround,
  type OpponentResponseWindow,
} from "./response-window";

const DEFAULT_CASE_SLUG = "redwood-signal-retaliation";
const DEFAULT_LOCAL_SPEECH_URL = "ws://127.0.0.1:8765/v1/speech";
const LOCAL_SPEECH_URL =
  process.env.NEXT_PUBLIC_SUITS_SPEECH_URL?.trim() || DEFAULT_LOCAL_SPEECH_URL;
const DEV_TYPED_INPUT_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT === "1";

function waitForInterruptionRetry(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Recovery cancelled"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Recovery cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function speechStatusLabel(snapshot: HearingControllerSnapshot | null): string {
  if (snapshot === null) return "Speech controller unavailable";
  switch (snapshot.lifecycle) {
    case "idle":
      return "Speech runtime needs preparation";
    case "preparing":
      return "Preparing microphone and speech models";
    case "ready":
      return "Courtroom speech ready";
    case "recording":
      return "Listening for your voice";
    case "processing":
      return "Finalizing the transcript";
    case "speaking":
      return "Playing courtroom speech";
    case "recoverable_error":
      return "Speech runtime needs attention";
    case "fatal_error":
      return "Speech runtime stopped safely";
    case "closed":
      return "Speech runtime closed";
  }
}

function readable(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = (): void => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  return reducedMotion;
}

function sameHearingHead(
  left: HearingRuntimeViewV1 | null,
  right: HearingRuntimeViewV1,
): boolean {
  return (
    left?.trial.trialId === right.trial.trialId &&
    left.trial.version === right.trial.version &&
    left.trial.lastEventId === right.trial.lastEventId
  );
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
  const reducedMotion = usePrefersReducedMotion();
  const [courtroomQuality, setCourtroomQuality] =
    useState<CourtroomQuality>("balanced");
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
  const [recoveringInterruption, setRecoveringInterruption] = useState(false);
  const [interruptionRecoveryError, setInterruptionRecoveryError] =
    useState<string>();
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
  const bindAudioAuditTrialRef = useRef<
    ((trialId: string) => void) | null
  >(null);
  const speechQueueRef = useRef<PendingSpeechAdoption[]>([]);
  const speechDrainPromiseRef = useRef<Promise<void> | null>(null);
  const interruptionRecoveryPromiseRef = useRef<Promise<void> | null>(null);
  const interruptionRecoveryAbortRef = useRef<AbortController | null>(null);
  const interruptionRecoveryRunRef = useRef<symbol | null>(null);
  const requestSpeechDrainRef = useRef<() => void>(() => undefined);
  const recoverDurableInterruptionRef = useRef<
    (
      previous: HearingRuntimeViewV1,
      signal?: AbortSignal,
    ) => Promise<void>
  >(async () => undefined);
  const recoverDurableContinuationRef = useRef<
    (
      previous: HearingRuntimeViewV1,
      signal?: AbortSignal,
    ) => Promise<void>
  >(async () => undefined);
  const commitFinalRef = useRef<
    (submission: HearingFinalSubmission) => Promise<void>
  >(async () => {
    throw new Error("The hearing command bridge is not ready.");
  });
  const [speechController, setSpeechController] =
    useState<HearingController | null>(null);
  const [speechSnapshot, setSpeechSnapshot] =
    useState<HearingControllerSnapshot | null>(null);
  const [presentationRuntime, setPresentationRuntime] = useState(() =>
    createCourtroomPresentationRuntime(),
  );
  const presentationTrialIdRef = useRef<string | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const [speechSetupError, setSpeechSetupError] = useState<string>();
  const trialId = createdTrialId ?? initialTrialId;

  const publishView = useCallback((next: HearingRuntimeViewV1): void => {
    bindAudioAuditTrialRef.current?.(next.trial.trialId);
    if (presentationTrialIdRef.current !== next.trial.trialId) {
      presentationTrialIdRef.current = next.trial.trialId;
      setPresentationRuntime(
        resetCourtroomPresentationRuntime({
          reducedMotion: reducedMotionRef.current,
          observedAtMs: window.performance.now(),
        }),
      );
    }
    viewRef.current = next;
    setView(next);
  }, []);

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
    let audioAuditSink: HearingAudioAuditSink | null = null;
    let audioAuditTrialId: string | null = null;
    const bindAudioAuditTrial = (nextTrialId: string): void => {
      if (audioAuditTrialId !== null && audioAuditTrialId !== nextTrialId) {
        window.location.reload();
        throw new Error(
          "The durable hearing changed before audio auditing could continue.",
        );
      }
      if (audioAuditSink !== null || audioAuditTrialId !== null) return;
      audioAuditTrialId = nextTrialId;
      try {
        audioAuditSink = createHearingAudioAuditSink({ trialId: nextTrialId });
      } catch {
        // Metadata auditing is isolated from microphone and playback behavior.
        audioAuditSink = null;
      }
    };
    try {
      controller = new HearingController({
        url: LOCAL_SPEECH_URL,
        getView: () => viewRef.current,
        getActivity: () => ({
          busy:
            busyRef.current ||
            interruptionRecoveryPromiseRef.current !== null,
          pending: pendingIntentRef.current !== null,
        }),
        commitFinal: (submission) => commitFinalRef.current(submission),
        onInterruptionPending: (response) => {
          void recoverDurableInterruptionRef.current(response.view);
        },
        interruptFinal: async (interruption, signal) => {
          const current = viewRef.current;
          if (
            disposed ||
            signal.aborted ||
            current === null ||
            current.trial.trialId !== interruption.head.trialId ||
            current.trial.version !== interruption.head.stateVersion ||
            current.trial.lastEventId !== interruption.head.lastEventId
          ) {
            throw new Error(
              "The courtroom changed before that interruption could be committed.",
            );
          }
          const response = await fetch(
            `/api/hearings/${encodeURIComponent(interruption.head.trialId)}/interruptions`,
            {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(interruption),
              signal,
            },
          );
          if (!response.ok) throw new Error(await responseError(response));
          const parsed = FinalBoundInterruptionResolutionSchema.safeParse(
            await response.json(),
          );
          if (!parsed.success) {
            throw new Error("The courtroom interruption response was invalid.");
          }
          const latest = viewRef.current;
          const sourceStillCurrent =
            !disposed &&
            !signal.aborted &&
            latest !== null &&
            latest.trial.trialId === interruption.head.trialId &&
            latest.trial.version === interruption.head.stateVersion &&
            latest.trial.lastEventId === interruption.head.lastEventId;
          if (!sourceStillCurrent) {
            throw new Error(
              "The courtroom changed while that interruption was resolving.",
            );
          }
          if (parsed.data.disposition === "candidate_withdrawn") {
            if (
              parsed.data.head.trialId !== interruption.head.trialId ||
              parsed.data.head.stateVersion !== interruption.head.stateVersion ||
              parsed.data.head.lastEventId !== interruption.head.lastEventId
            ) {
              throw new Error(
                "The withdrawn interruption did not match the current record.",
              );
            }
            return parsed.data;
          }
          if (
            parsed.data.targetCompletionHead.trialId !==
              interruption.head.trialId ||
            parsed.data.targetCompletionHead.stateVersion <=
              interruption.head.stateVersion ||
            parsed.data.targetCompletionHead.lastEventId ===
              interruption.head.lastEventId ||
            parsed.data.view.trial.trialId !== interruption.head.trialId ||
            parsed.data.view.trial.version <= interruption.head.stateVersion ||
            parsed.data.view.trial.lastEventId === interruption.head.lastEventId
          ) {
            throw new Error(
              "The courtroom changed while that interruption was resolving.",
            );
          }
          publishView(parsed.data.view);
          return parsed.data;
        },
      });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "The speech controller could not be created.";
      queueMicrotask(() => {
        if (!disposed) setSpeechSetupError(message);
      });
      return () => {
        disposed = true;
      };
    }

    bindAudioAuditTrialRef.current = bindAudioAuditTrial;
    const currentTrialId = viewRef.current?.trial.trialId;
    if (currentTrialId !== undefined) bindAudioAuditTrial(currentTrialId);
    speechControllerRef.current = controller;
    const unsubscribe = controller.subscribe((snapshot) => {
      setSpeechSnapshot(snapshot);
      if (snapshot.lifecycle === "ready") requestSpeechDrainRef.current();
    });
    const unsubscribeAudioAuditPerformance = controller.subscribePerformance(
      (event) => {
        audioAuditSink?.observe(event);
      },
    );
    const unsubscribePresentationPerformance =
      controller.subscribePerformance((event) => {
        if (disposed) return;
        const observedAtMs = window.performance.now();
        setPresentationRuntime((current) =>
          reduceCourtroomPresentationRuntime(current, event, observedAtMs),
        );
      });
    const expediteAudioAudits = (): void => audioAuditSink?.expedite();
    const expediteHiddenAudioAudits = (): void => {
      if (document.visibilityState === "hidden") expediteAudioAudits();
    };
    window.addEventListener("pagehide", expediteAudioAudits);
    document.addEventListener("visibilitychange", expediteHiddenAudioAudits);
    queueMicrotask(() => {
      if (disposed) return;
      setSpeechController(controller);
      setSpeechSnapshot(controller.snapshot);
    });
    return () => {
      disposed = true;
      interruptionRecoveryAbortRef.current?.abort();
      if (bindAudioAuditTrialRef.current === bindAudioAuditTrial) {
        bindAudioAuditTrialRef.current = null;
      }
      window.removeEventListener("pagehide", expediteAudioAudits);
      document.removeEventListener(
        "visibilitychange",
        expediteHiddenAudioAudits,
      );
      unsubscribePresentationPerformance();
      unsubscribe();
      if (speechControllerRef.current === controller) {
        speechControllerRef.current = null;
      }
      void (async () => {
        try {
          await controller.close();
        } catch {
          // close() has fenced capture/playback and retained its safe status.
        } finally {
          unsubscribeAudioAuditPerformance();
          try {
            await audioAuditSink?.close();
          } catch {
            // Audit delivery remains isolated from courtroom teardown.
          }
        }
      })();
    };
  }, [publishView]);

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
        publishView(parsed.data);
        speechControllerRef.current?.baselineView(parsed.data);
        await recoverDurableInterruptionRef.current(
          parsed.data,
          controller.signal,
        );
        const recoveredHead = viewRef.current;
        if (
          controller.signal.aborted ||
          recoveredHead === null ||
          recoveredHead.trial.trialId !== parsed.data.trial.trialId
        ) {
          return;
        }
        await recoverDurableContinuationRef.current(
          recoveredHead,
          controller.signal,
        );
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
  }, [createdTrialId, initialTrialId, publishView]);

  function recoverDurableInterruption(
    previous: HearingRuntimeViewV1,
    signal?: AbortSignal,
  ): Promise<void> {
    const existing = interruptionRecoveryPromiseRef.current;
    if (existing !== null) return existing;
    const activeLifecycle = speechControllerRef.current?.snapshot.lifecycle;
    if (
      busyRef.current ||
      pendingIntentRef.current !== null ||
      speechDrainPromiseRef.current !== null ||
      activeLifecycle === "preparing" ||
      activeLifecycle === "recording" ||
      activeLifecycle === "processing" ||
      activeLifecycle === "speaking"
    ) {
      setInterruptionRecoveryError(
        "Finish the current courtroom activity before retrying the interrupted response.",
      );
      return Promise.resolve();
    }
    const ownedAbort = signal === undefined ? new AbortController() : null;
    const activeSignal = signal ?? ownedAbort?.signal;
    const runToken = Symbol("interruption-recovery");
    interruptionRecoveryRunRef.current = runToken;
    interruptionRecoveryAbortRef.current = ownedAbort;
    const work = (async (): Promise<void> => {
      setRecoveringInterruption(true);
      setInterruptionRecoveryError(undefined);
      let expected = previous;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(
            `/api/hearings/${encodeURIComponent(
              expected.trial.trialId,
            )}/interruptions/recover`,
            {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              ...(activeSignal === undefined
                ? {}
                : { signal: activeSignal }),
            },
          );
          if (response.status === 204) {
            setInterruptionRecoveryError(undefined);
            return;
          }
          if (!response.ok) throw new Error(await responseError(response));
          const parsed = FinalBoundInterruptionResponseSchema.safeParse(
            await response.json(),
          );
          if (!parsed.success) {
            throw new Error(
              "The recovered courtroom interruption was invalid.",
            );
          }
          const next = adoptRecoveredInterruptionResponse({
            previous: expected,
            response: parsed.data,
            ...(activeSignal === undefined ? {} : { signal: activeSignal }),
            isCurrent: () =>
              interruptionRecoveryRunRef.current === runToken,
            currentView: () => viewRef.current,
            publishView,
            queueSpeech,
          });
          expected = next;
          if (parsed.data.continuation === "complete") {
            setInterruptionRecoveryError(undefined);
            return;
          }
          setInterruptionRecoveryError(
            "The ruling is safe in the record, but the resumed witness answer is still pending.",
          );
          if (attempt === 0) {
            await waitForInterruptionRetry(750, activeSignal);
          }
        }
      } catch (caught) {
        if (!activeSignal?.aborted) {
          setInterruptionRecoveryError(
            caught instanceof Error
              ? caught.message
              : "The interrupted courtroom response could not be recovered.",
          );
        }
      }
    })();
    interruptionRecoveryPromiseRef.current = work;
    void work.finally(() => {
      if (interruptionRecoveryPromiseRef.current === work) {
        interruptionRecoveryPromiseRef.current = null;
      }
      if (interruptionRecoveryAbortRef.current === ownedAbort) {
        interruptionRecoveryAbortRef.current = null;
      }
      if (interruptionRecoveryRunRef.current === runToken) {
        interruptionRecoveryRunRef.current = null;
      }
      if (!activeSignal?.aborted) {
        setRecoveringInterruption(false);
        requestSpeechDrainRef.current();
      }
    });
    return work;
  }

  function queueSpeech(adoption: PendingSpeechAdoption): void {
    speechQueueRef.current = enqueuePendingSpeechAdoption(
      speechQueueRef.current,
      adoption,
    );
    requestSpeechDrainRef.current();
  }

  function requestSpeechDrain(): void {
    if (
      speechDrainPromiseRef.current !== null ||
      busyRef.current ||
      interruptionRecoveryPromiseRef.current !== null ||
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
        interruptionRecoveryPromiseRef.current === null &&
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
          if (adoption.kind === "interruption") {
            await activeController.adoptRecoveredInterruption(
              adoption.previous,
              adoption.response,
            );
          } else {
            await activeController.adoptView(
              adoption.previous,
              adoption.next,
              adoption.source,
            );
          }
          setSpeechSetupError(undefined);
        } catch (cause) {
          if (
            cause instanceof HearingControllerError &&
            cause.code === "BARGED_IN"
          ) {
            setSpeechSetupError(undefined);
            return;
          }
          setSpeechSetupError(
            cause instanceof Error
              ? cause.message
              : "The committed courtroom speech could not be played.",
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
    recoverDurableInterruptionRef.current = recoverDurableInterruption;
    recoverDurableContinuationRef.current = recoverDurableContinuation;
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

  async function recoverDurableContinuation(
    previous: HearingRuntimeViewV1,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted || !sameHearingHead(viewRef.current, previous)) return;
    await executeOrThrow(async () => {
      if (signal?.aborted || !sameHearingHead(viewRef.current, previous)) return;
      try {
        const response = await fetch(
          `/api/hearings/${encodeURIComponent(
            previous.trial.trialId,
          )}/continuation/recover`,
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            ...(signal === undefined ? {} : { signal }),
          },
        );
        if (!response.ok) throw new Error(await responseError(response));
        const parsed = HearingRuntimeViewV1Schema.safeParse(
          await response.json(),
        );
        if (!parsed.success) {
          throw new Error("The recovered courtroom response was invalid.");
        }
        if (signal?.aborted || !sameHearingHead(viewRef.current, previous)) {
          return;
        }
        const next = parsed.data;
        if (
          next.trial.trialId !== previous.trial.trialId ||
          next.trial.version < previous.trial.version ||
          (next.trial.version === previous.trial.version &&
            next.trial.lastEventId !== previous.trial.lastEventId)
        ) {
          throw new Error(
            "The recovered courtroom record moved behind the current head.",
          );
        }
        if (sameHearingHead(next, previous)) return;
        publishView(next);
        queueSpeech({
          kind: "view",
          previous,
          next,
          source: "recovery",
        });
      } catch (caught) {
        if (signal?.aborted) return;
        throw caught;
      }
    });
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
      queueSpeech({
        kind: "view",
        previous: null,
        next: parsed.data,
        source: "new_hearing",
      });
      setCreatedTrialId(parsed.data.trial.trialId);
      window.history.replaceState(
        null,
        "",
        hearingUrl(parsed.data.trial.trialId),
      );
    });
  }

  async function commitIntentOrThrow(intent: HearingPlayerIntent): Promise<void> {
    if (interruptionRecoveryPromiseRef.current !== null) {
      throw new Error(
        "The court is finishing an interrupted ruling. Retry this action afterward.",
      );
    }
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
        queueSpeech({
          kind: "view",
          previous,
          next: parsed.data,
          source: "command",
        });
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
          queueSpeech({
            kind: "view",
            previous,
            next: refreshed.data,
            source: "recovery",
          });
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
          : "The courtroom speech action failed safely.",
      );
    }
  }

  function prepareSpeech(): void {
    const controller = speechController;
    if (controller === null) {
      setSpeechSetupError("The speech controller is unavailable.");
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

  async function objectToOpponentQuestion(
    expectedWindow: OpponentResponseWindow,
    ground: OpponentResponseGround,
  ): Promise<void> {
    const current = viewRef.current;
    if (current === null) return;
    const intent = buildObjectIntent(current, expectedWindow, ground);
    if (intent === null) {
      setError(
        "That objection window changed before the action could be submitted.",
      );
      return;
    }

    const controller = speechControllerRef.current;
    if (controller?.snapshot.lifecycle === "speaking") {
      try {
        controller.interruptForCourtroomAction();
      } catch (cause) {
        setSpeechSetupError(
          cause instanceof Error
            ? cause.message
            : "Courtroom playback could not be interrupted safely.",
        );
        return;
      }
    }
    await commitIntent(intent);
  }

  async function continueOpponentResponse(
    expectedWindow: OpponentResponseWindow,
  ): Promise<void> {
    const current = viewRef.current;
    if (current === null) return;
    const intent = buildContinueResponseIntent(current, expectedWindow);
    if (intent === null) {
      setError(
        "That response window changed before the witness could continue.",
      );
      return;
    }
    await commitIntent(intent);
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
  const opponentResponseWindow =
    view === null ? null : deriveOpponentResponseWindow(view);
  const witnessAnswerCount =
    view?.transcript.filter((turn) => turn.actor.role === "witness").length ?? 0;
  const canFinishTrial = Boolean(view?.capabilities.canFinishTrial);
  const speechLifecycle = speechSnapshot?.lifecycle;
  const courtroomBusy = busy || recoveringInterruption;
  const speechIsRecording = speechLifecycle === "recording";
  const speechCanStartRecording =
    speechLifecycle === "ready" || speechLifecycle === "speaking";
  const speechBlocksCourtroomControls =
    hearingLifecycleBlocksCourtroomControls(speechLifecycle);
  const responseWindowControlsBlocked =
    courtroomBusy ||
    Boolean(pendingIntent) ||
    speechLifecycle === "preparing" ||
    speechLifecycle === "recording" ||
    speechLifecycle === "processing";
  const questionIsRecording =
    speechIsRecording && speechSnapshot?.activeMode === "question";
  const closingIsRecording =
    speechIsRecording && speechSnapshot?.activeMode === "closing";
  const speechActiveMode = speechSnapshot?.activeMode ?? null;
  const courtroomPresentation = useMemo(
    () =>
      view
        ? deriveCourtroomPresentation({
            view,
            speech: speechLifecycle
              ? {
                  lifecycle: speechLifecycle,
                  activeMode: speechActiveMode,
                }
              : null,
            busy: courtroomBusy,
            quality: courtroomQuality,
            reducedMotion,
          })
        : null,
    [
      courtroomBusy,
      courtroomQuality,
      reducedMotion,
      speechActiveMode,
      speechLifecycle,
      view,
    ],
  );
  const presentationBaseFocus = courtroomPresentation?.camera.target ?? null;
  const presentationBaseCameraShot =
    courtroomPresentation?.camera.shot ?? "courtroom_wide";
  const presentationDisplay = courtroomPresentation?.display ?? null;
  const presentationHead = courtroomPresentation?.head ?? null;
  const presentationWakeAtMs = nextCourtroomPresentationWakeAt(
    presentationRuntime,
  );
  const presentationRuntimeSnapshot = useMemo(
    () => selectCourtroomPresentationRuntime(presentationRuntime),
    [presentationRuntime],
  );
  const audibleSemanticPerformance = useMemo(
    () =>
      view === null
        ? null
        : selectAudibleCourtroomSemanticPerformance(
            view,
            presentationRuntimeSnapshot,
          ),
    [presentationRuntimeSnapshot, view],
  );

  useEffect(() => {
    const observedAtMs = window.performance.now();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPresentationRuntime((current) => {
        const baseRebase = {
          baseFocus: presentationBaseFocus,
          baseCameraShot: presentationBaseCameraShot,
          reducedMotion,
          observedAtMs,
        };
        return rebaseCourtroomPresentationRuntime(
          current,
          presentationDisplay === null || presentationHead === null
            ? baseRebase
            : {
                ...baseRebase,
                baseDisplay: presentationDisplay,
                displayHead: {
                  trialId: presentationHead.trialId,
                  stateVersion: presentationHead.stateVersion,
                  lastEventId: presentationHead.lastEventId,
                },
              },
        );
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    presentationBaseCameraShot,
    presentationBaseFocus,
    presentationDisplay,
    presentationHead,
    reducedMotion,
  ]);

  useEffect(() => {
    if (presentationWakeAtMs === null) return;
    const timeout = window.setTimeout(() => {
      const observedAtMs = Math.max(
        window.performance.now(),
        presentationWakeAtMs,
      );
      setPresentationRuntime((current) =>
        advanceCourtroomPresentationRuntime(current, observedAtMs),
      );
    }, Math.max(0, presentationWakeAtMs - window.performance.now()));
    return () => window.clearTimeout(timeout);
  }, [presentationWakeAtMs]);

  return (
    <main className="hearing-shell">
      <header className="hearing-header">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <div className="phase-chip">{phaseLabel(view)}</div>
        <div className="hearing-header-links">
          {view && (
            <Link
              className="text-link"
              href={courtRecordsUrl(view.trial.trialId)}
            >
              Open Court Records
            </Link>
          )}
          <Link className="text-link" href="/preflight/">System preflight</Link>
          <Link className="text-link" href="/cases/">Case library</Link>
        </div>
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
              disabled={courtroomBusy || !caseSelector.success}
              onClick={() => void beginHearing()}
            >
              {courtroomBusy
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
          {courtroomPresentation && (
            <CourtroomStage
              audibleSemanticPerformance={audibleSemanticPerformance}
              frame={courtroomPresentation}
              onQualityChange={setCourtroomQuality}
              presentationRuntime={presentationRuntime}
              runtimeSnapshot={presentationRuntimeSnapshot}
            />
          )}
          <section className="transcript-panel">
            <div className="panel-heading">
              <div>
                <span>Append-only live record</span>
                <h1>{view.case.title}</h1>
              </div>
              <span>{view.transcript.length} turns · E-{view.trial.sequence}</span>
            </div>

            <div className="voice-primary" aria-live="polite">
              <span>Browser-to-SUITS speech runtime</span>
              <strong>{speechStatusLabel(speechSnapshot)}</strong>
              <small>
                Microphone frames travel only to the configured SUITS speech
                runtime and never to OpenAI or Convex. Only a validated final
                transcript can become a courtroom command.
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
              {speechSnapshot?.objectionMetrics &&
                speechSnapshot.objectionMetrics.candidatesDetected > 0 && (
                  <small>
                    Objection telemetry ·{" "}
                    {speechSnapshot.objectionMetrics.candidatesDetected} candidate
                    {speechSnapshot.objectionMetrics.candidatesDetected === 1
                      ? ""
                      : "s"}
                    {speechSnapshot.objectionMetrics.lastReactionDispatchLatencyMs ===
                    null
                      ? ""
                      : ` · reaction ${speechSnapshot.objectionMetrics.lastReactionDispatchLatencyMs} ms`}
                    {speechSnapshot.objectionMetrics.lastModelLatencyMs === null
                      ? ""
                      : ` · ruling ${speechSnapshot.objectionMetrics.lastModelLatencyMs} ms`}
                  </small>
                )}
              {speechSnapshot?.speechMetrics && (
                <small>
                  Speech telemetry · {speechSnapshot.speechMetrics.metrics.length}{" "}
                  bounded metric
                  {speechSnapshot.speechMetrics.metrics.length === 1 ? "" : "s"}
                </small>
              )}
              <div className="input-actions voice-controls">
                {(speechLifecycle === "idle" ||
                  speechLifecycle === "recoverable_error") && (
                  <button
                    className="voice-primary-button"
                    disabled={courtroomBusy || Boolean(pendingIntent)}
                    onClick={prepareSpeech}
                    type="button"
                  >
                    {speechLifecycle === "recoverable_error"
                      ? "Prepare speech runtime again"
                      : "Prepare speech runtime"}
                  </button>
                )}
                {speechLifecycle === "preparing" && (
                  <button className="voice-primary-button" disabled type="button">
                    Preparing speech access…
                  </button>
                )}
                {speechLifecycle === "ready" && (
                  <button
                    className="quiet-button voice-button"
                    disabled={courtroomBusy || Boolean(pendingIntent)}
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
                      Check the configured speech service and endpoint, then reload
                      this hearing.
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
              {courtroomBusy && (
                <div className="thinking-line" role="status">
                  <b>Committing the next event…</b>
                  <span> Refresh is safe after the server confirms it.</span>
                </div>
              )}
            </div>

            {opponentResponseWindow && (
              <section
                aria-labelledby="opponent-response-heading"
                className="advocacy-box response-window"
              >
                <div className="advocacy-label" id="opponent-response-heading">
                  Opposing counsel response window
                </div>
                <p className="required-opening">
                  Object now to interrupt courtroom playback, or let the
                  exact pending witness response continue.
                </p>
                <div
                  aria-label="Available objection grounds"
                  className="response-window-actions"
                  role="group"
                >
                  {opponentResponseWindow.canObject &&
                    opponentResponseWindow.permittedObjectionGrounds.map(
                      (ground) => (
                        <button
                          className="objection-button"
                          disabled={responseWindowControlsBlocked}
                          key={ground}
                          onClick={() =>
                            void objectToOpponentQuestion(
                              opponentResponseWindow,
                              ground,
                            )
                          }
                          type="button"
                        >
                          Object: {readable(ground)}
                        </button>
                      ),
                    )}
                  {opponentResponseWindow.canContinueResponse && (
                    <button
                      className="quiet-button continue-response-button"
                      disabled={responseWindowControlsBlocked}
                      onClick={() =>
                        void continueOpponentResponse(opponentResponseWindow)
                      }
                      type="button"
                    >
                      Let the witness answer
                    </button>
                  )}
                </div>
              </section>
            )}

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
                      courtroomBusy ||
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
                      courtroomBusy ||
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
                      courtroomBusy ||
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
                      courtroomBusy ||
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
                      courtroomBusy ||
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
            {interruptionRecoveryError && (
              <div className="error-banner" role="status">
                <span>{interruptionRecoveryError}</span>
                <div className="input-actions">
                  <button
                    className="quiet-button"
                    disabled={
                      recoveringInterruption ||
                      courtroomBusy ||
                      Boolean(pendingIntent) ||
                      speechBlocksCourtroomControls
                    }
                    onClick={() => {
                      const current = viewRef.current;
                      if (current !== null) {
                        void recoverDurableInterruption(current);
                      }
                    }}
                    type="button"
                  >
                    {recoveringInterruption
                      ? "Recovering interrupted responseâ€¦"
                      : "Retry interrupted response"}
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                {pendingIntent && (
                  <div className="input-actions">
                    <button
                      className="quiet-button"
                      disabled={courtroomBusy}
                      onClick={() => void commitIntent(pendingIntent)}
                    >
                      Retry pending action
                    </button>
                    <button
                      className="quiet-button"
                      disabled={courtroomBusy}
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
                          courtroomBusy ||
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
