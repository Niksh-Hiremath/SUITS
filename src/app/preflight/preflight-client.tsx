"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  ServerPreflightRequestSchema,
  ServerPreflightResponseSchema,
  type ServerPreflightResponse,
} from "@/domain/preflight";
import {
  HearingController,
  HearingControllerError,
  type HearingControllerSnapshot,
} from "@/lib/speech/hearing-controller";

import styles from "./preflight.module.css";

const DEFAULT_LOCAL_SPEECH_URL = "ws://127.0.0.1:8765/v1/speech";
const LOCAL_SPEECH_URL =
  process.env.NEXT_PUBLIC_SUITS_SPEECH_URL?.trim() || DEFAULT_LOCAL_SPEECH_URL;

type CheckTone = "neutral" | "working" | "ready" | "warning" | "error";
type ServerRunPhase = "idle" | "running" | "complete" | "error";
type LocalRunPhase = "idle" | "running" | "complete" | "error";
type SpeakerRunPhase = "idle" | "running" | "complete" | "error";

type SafeFailure = Readonly<{
  code: string;
  message: string;
  action: string;
}>;

function words(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function milliseconds(value: number | null | undefined): string {
  return value === null || value === undefined ? "Not measured" : `${value} ms`;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

export function serverHttpFailure(
  status: number,
  retryAfterHeader: string | null,
): SafeFailure {
  if (status === 403) {
    return {
      code: "ORIGIN_REJECTED",
      message: "The app rejected this preflight origin.",
      action: "Open this page from the same SUITS address and retry.",
    };
  }
  if (status === 503) {
    return {
      code: "PREFLIGHT_CHECK_UNAVAILABLE",
      message: "The server could not complete its protected preflight checks.",
      action:
        "Confirm the SUITS session, Convex, and server configuration, then retry.",
    };
  }
  if (status === 429) {
    const retryAfter = Number.parseInt(retryAfterHeader ?? "", 10);
    const boundedRetryAfter =
      Number.isSafeInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 600
        ? retryAfter
        : null;
    return {
      code: "PREFLIGHT_RATE_LIMITED",
      message: "The live model checks were run recently.",
      action: boundedRetryAfter
        ? `Wait about ${boundedRetryAfter} seconds, then retry.`
        : "Wait a few minutes, then retry.",
    };
  }
  return {
    code: `SERVER_CHECK_HTTP_${status}`,
    message: "The server checks could not be completed safely.",
    action: "Confirm the SUITS server is running, then retry.",
  };
}

function safeLocalFailure(cause: unknown): SafeFailure {
  const code =
    cause instanceof HearingControllerError
      ? cause.code
      : "LOCAL_PREFLIGHT_FAILED";
  const message =
    cause instanceof HearingControllerError
      ? cause.message
      : "Local courtroom audio could not be prepared.";

  if (code === "PERMISSION_DENIED") {
    return {
      code,
      message,
      action: "Allow microphone access for this localhost page, then retry.",
    };
  }
  if (code === "UNSUPPORTED_BROWSER") {
    return {
      code,
      message,
      action: "Use a current browser with AudioWorklet microphone support.",
    };
  }
  if (code === "CAPABILITIES_UNAVAILABLE") {
    return {
      code,
      message,
      action:
        "Start the local speech companion with streaming STT and TTS providers, then retry.",
    };
  }
  if (
    code.includes("SOCKET") ||
    code.includes("HANDSHAKE") ||
    code.includes("DISCONNECT") ||
    code.includes("SERVICE")
  ) {
    return {
      code,
      message,
      action:
        "Start the local speech companion on its configured loopback address, then retry.",
    };
  }
  if (code.includes("PLAYBACK")) {
    return {
      code,
      message,
      action: "Check the selected speaker and browser audio permission, then retry.",
    };
  }
  return {
    code,
    message,
    action:
      "Check the local speech service and browser device permissions, then retry.",
  };
}

function isFailedLocalLifecycle(
  lifecycle: HearingControllerSnapshot["lifecycle"] | undefined,
): boolean {
  return (
    lifecycle === "recoverable_error" ||
    lifecycle === "fatal_error" ||
    lifecycle === "closed"
  );
}

export function deriveLocalPreflightPresentation(
  localPhase: LocalRunPhase,
  snapshot: HearingControllerSnapshot | null,
): Readonly<{
  label: string;
  tone: CheckTone;
  operational: boolean;
  microphoneReady: boolean;
}> {
  const lifecycle = snapshot?.lifecycle;
  const connected = lifecycle === "ready" || lifecycle === "speaking";
  const operational = localPhase === "complete" && connected;
  const microphoneReady =
    operational && snapshot?.captureStatus === "stopped";

  if (localPhase === "running" || lifecycle === "preparing") {
    return {
      label: "Preparing",
      tone: "working",
      operational: false,
      microphoneReady: false,
    };
  }
  if (
    localPhase === "error" ||
    isFailedLocalLifecycle(lifecycle) ||
    (localPhase === "complete" && !connected)
  ) {
    return {
      label: "Needs attention",
      tone: "error",
      operational: false,
      microphoneReady: false,
    };
  }
  if (operational && lifecycle === "speaking") {
    return {
      label: "Playing audio",
      tone: "working",
      operational,
      microphoneReady,
    };
  }
  if (operational) {
    return {
      label: "Ready",
      tone: "ready",
      operational,
      microphoneReady,
    };
  }
  return {
    label: "Not checked",
    tone: "neutral",
    operational: false,
    microphoneReady: false,
  };
}

function statusTone(status: "ready" | "unavailable"): CheckTone {
  return status === "ready" ? "ready" : "error";
}

function StatusBadge({
  label,
  tone,
}: Readonly<{ label: string; tone: CheckTone }>) {
  return (
    <span className={styles.badge} data-tone={tone}>
      <span className={styles.badgeDot} aria-hidden="true" />
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className={styles.metric}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SafeError({ failure }: Readonly<{ failure: SafeFailure }>) {
  return (
    <div className={styles.errorBox} role="alert">
      <div>
        <strong>{failure.message}</strong>
        <span>{failure.code}</span>
      </div>
      <p>{failure.action}</p>
    </div>
  );
}

function ServerResults({ result }: Readonly<{ result: ServerPreflightResponse }>) {
  const [luna, terra] = result.openai.models;
  return (
    <div className={styles.results} aria-label="Server check results">
      <article className={styles.resultCard}>
        <div className={styles.resultHeading}>
          <div>
            <span>Identity</span>
            <h3>Private session</h3>
          </div>
          <StatusBadge label="Ready" tone="ready" />
        </div>
        <p>The signed, HTTP-only case-owner session is available.</p>
          <dl className={styles.metrics}>
            <Metric label="Latency" value="Not separately measured" />
            <Metric label="Exposure" value="Browser-safe status only" />
          </dl>
      </article>

      <article className={styles.resultCard}>
        <div className={styles.resultHeading}>
          <div>
            <span>Durable record</span>
            <h3>Convex</h3>
          </div>
          <StatusBadge
            label={result.convex.status === "ready" ? "Ready" : "Unavailable"}
            tone={statusTone(result.convex.status)}
          />
        </div>
        <p>
          {result.convex.status === "ready"
            ? "The canonical event store answered its protected health check."
            : "The canonical event store did not answer its protected health check."}
        </p>
        <dl className={styles.metrics}>
          <Metric label="Latency" value={milliseconds(result.convex.latencyMs)} />
          <Metric label="Code" value={result.convex.code ?? "None"} />
        </dl>
        {result.convex.status !== "ready" ? (
          <p className={styles.guidance}>
            Start or link the configured Convex deployment and run the checks again.
          </p>
        ) : null}
      </article>

      {[luna, terra].map((model) => (
        <article className={styles.resultCard} key={model.model}>
          <div className={styles.resultHeading}>
            <div>
              <span>{model.model === luna.model ? "Live courtroom" : "Case & coaching"}</span>
              <h3>{model.model}</h3>
            </div>
            <StatusBadge
              label={model.status === "ready" ? "Ready" : "Unavailable"}
              tone={statusTone(model.status)}
            />
          </div>
          <p>
            {model.status === "ready"
              ? "The server-only OpenAI client can access this pinned model."
              : "The server-only OpenAI client could not verify this pinned model."}
          </p>
          <dl className={styles.metrics}>
            <Metric label="Latency" value={milliseconds(model.latencyMs)} />
            <Metric label="Code" value={model.code ?? "None"} />
          </dl>
          {model.status !== "ready" ? (
            <p className={styles.guidance}>
              Confirm server-side OpenAI configuration and model access, then retry.
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function LocalResults({
  snapshot,
  presentation,
  speakerPhase,
}: Readonly<{
  snapshot: HearingControllerSnapshot | null;
  presentation: ReturnType<typeof deriveLocalPreflightPresentation>;
  speakerPhase: SpeakerRunPhase;
}>) {
  const capabilities = snapshot?.capabilities;
  return (
    <div className={styles.localResults} aria-label="Local audio check results">
      <article className={styles.localSummary}>
        <div className={styles.resultHeading}>
          <div>
            <span>Local runtime</span>
            <h3>Speech companion</h3>
          </div>
          <StatusBadge
            label={
              presentation.label === "Needs attention"
                ? "Attention"
                : presentation.label
            }
            tone={presentation.tone}
          />
        </div>
        <dl className={styles.summaryMetrics}>
          <Metric label="Mode" value={capabilities ? words(capabilities.serviceMode) : "Not checked"} />
          <Metric
            label="CUDA"
            value={
              capabilities
                ? capabilities.cuda.available
                  ? "Available"
                  : "Unavailable"
                : "Not checked"
            }
          />
          <Metric
            label="Device"
            value={capabilities?.cuda.deviceName ?? "Not reported"}
          />
          <Metric
            label="Warmup"
            value={milliseconds(capabilities?.warmupLatencyMs)}
          />
          <Metric
            label="Microphone"
            value={
              presentation.microphoneReady
                ? "Permission & capture ready"
                : "Not verified"
            }
          />
          <Metric
            label="Capture state"
            value={words(snapshot?.captureStatus ?? "idle")}
          />
          <Metric
            label="Playback state"
            value={words(snapshot?.playbackStatus ?? "idle")}
          />
          <Metric
            label="Speaker test"
            value={
              speakerPhase === "running"
                ? "Playing"
                : speakerPhase === "complete"
                  ? "Playback completed"
                  : speakerPhase === "error"
                    ? "Failed safely"
                    : "Not run"
            }
          />
        </dl>
      </article>

      <div className={styles.providerGrid}>
        {capabilities?.providers.length ? (
          capabilities.providers.map((provider) => (
            <article className={styles.providerCard} key={`${provider.kind}:${provider.providerId}`}>
              <div className={styles.providerTitle}>
                <span>{provider.kind.toUpperCase()}</span>
                <StatusBadge
                  label={
                    presentation.operational && provider.ready && provider.loaded
                      ? "Ready"
                      : "Unavailable"
                  }
                  tone={
                    presentation.operational && provider.ready && provider.loaded
                      ? "ready"
                      : "error"
                  }
                />
              </div>
              <h3>{provider.providerId}</h3>
              <dl className={styles.metrics}>
                <Metric label="Device" value={words(provider.device)} />
                <Metric label="Loaded" value={yesNo(provider.loaded)} />
                <Metric label="Streaming" value={yesNo(provider.supportsStreaming)} />
                <Metric label="Timing metadata" value={yesNo(provider.supportsTimings)} />
                <Metric label="Warmup" value={milliseconds(provider.warmupLatencyMs)} />
              </dl>
            </article>
          ))
        ) : (
          <div className={styles.emptyProviders}>
            Provider readiness will appear after local preparation.
          </div>
        )}
      </div>
    </div>
  );
}

export function PreflightClient() {
  const controllerRef = useRef<HearingController | null>(null);
  const serverAbortRef = useRef<AbortController | null>(null);
  const serverRunRef = useRef(0);
  const [serverPhase, setServerPhase] = useState<ServerRunPhase>("idle");
  const [serverResult, setServerResult] =
    useState<ServerPreflightResponse | null>(null);
  const [serverFailure, setServerFailure] = useState<SafeFailure | null>(null);
  const [localPhase, setLocalPhase] = useState<LocalRunPhase>("idle");
  const [localSnapshot, setLocalSnapshot] =
    useState<HearingControllerSnapshot | null>(null);
  const [localFailure, setLocalFailure] = useState<SafeFailure | null>(null);
  const [speakerPhase, setSpeakerPhase] =
    useState<SpeakerRunPhase>("idle");
  const [speakerFailure, setSpeakerFailure] = useState<SafeFailure | null>(null);

  useEffect(() => {
    let active = true;
    let controller: HearingController;
    try {
      controller = new HearingController({
        url: LOCAL_SPEECH_URL,
        getView: () => null,
        getActivity: () => ({ busy: false, pending: false }),
        commitFinal: async () => undefined,
      });
    } catch {
      queueMicrotask(() => {
        if (!active) return;
        setLocalPhase("error");
        setLocalFailure({
          code: "LOCAL_CONTROLLER_UNAVAILABLE",
          message: "The local audio controller could not be created.",
          action:
            "Check the public loopback speech URL, restart SUITS, and retry.",
        });
      });
      return () => {
        active = false;
      };
    }

    controllerRef.current = controller;
    queueMicrotask(() => {
      if (active) setLocalSnapshot(controller.snapshot);
    });
    const unsubscribe = controller.subscribe((snapshot) => {
      if (!active) return;
      setLocalSnapshot(snapshot);
      if (isFailedLocalLifecycle(snapshot.lifecycle)) {
        setLocalPhase("error");
        setLocalFailure(
          safeLocalFailure(
            new HearingControllerError(
              snapshot.code ?? "LOCAL_PREFLIGHT_FAILED",
              snapshot.message ?? "The local speech companion disconnected.",
            ),
          ),
        );
        setSpeakerPhase((phase) => (phase === "running" ? "error" : phase));
      }
    });
    return () => {
      active = false;
      unsubscribe();
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.close().catch(() => undefined);
    };
  }, []);

  useEffect(
    () => () => {
      serverRunRef.current += 1;
      serverAbortRef.current?.abort();
    },
    [],
  );

  async function runServerChecks(): Promise<void> {
    const run = ++serverRunRef.current;
    serverAbortRef.current?.abort();
    const abort = new AbortController();
    serverAbortRef.current = abort;
    setServerPhase("running");
    setServerResult(null);
    setServerFailure(null);

    try {
      const response = await fetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ServerPreflightRequestSchema.parse({})),
        cache: "no-store",
        signal: abort.signal,
      });
      if (run !== serverRunRef.current) return;
      if (!response.ok) {
        setServerPhase("error");
        setServerFailure(
          serverHttpFailure(response.status, response.headers.get("retry-after")),
        );
        return;
      }
      const parsed = ServerPreflightResponseSchema.safeParse(
        await response.json(),
      );
      if (run !== serverRunRef.current) return;
      if (!parsed.success) {
        setServerPhase("error");
        setServerFailure({
          code: "PREFLIGHT_RESPONSE_INVALID",
          message: "The server returned an invalid preflight response.",
          action: "Restart the SUITS server and run the checks again.",
        });
        return;
      }
      setServerResult(parsed.data);
      setServerPhase("complete");
    } catch (cause) {
      if (run !== serverRunRef.current || abort.signal.aborted) return;
      void cause;
      setServerPhase("error");
      setServerFailure({
        code: "PREFLIGHT_REQUEST_FAILED",
        message: "The browser could not reach the SUITS preflight endpoint.",
        action: "Confirm the SUITS server is running, then retry.",
      });
    } finally {
      if (serverAbortRef.current === abort) serverAbortRef.current = null;
    }
  }

  async function prepareLocalAudio(): Promise<void> {
    const controller = controllerRef.current;
    if (controller === null) {
      setLocalPhase("error");
      setLocalFailure({
        code: "LOCAL_CONTROLLER_UNAVAILABLE",
        message: "The local audio controller is unavailable.",
        action: "Reload this page and retry.",
      });
      return;
    }
    setLocalPhase("running");
    setLocalFailure(null);
    setSpeakerPhase("idle");
    setSpeakerFailure(null);
    try {
      const snapshot = await controller.prepare();
      setLocalSnapshot(snapshot);
      setLocalPhase("complete");
    } catch (cause) {
      setLocalPhase("error");
      setLocalFailure(safeLocalFailure(cause));
    }
  }

  async function testSpeaker(): Promise<void> {
    const controller = controllerRef.current;
    if (controller === null) return;
    setSpeakerPhase("running");
    setSpeakerFailure(null);
    try {
      await controller.speakerTest();
      setSpeakerPhase("complete");
    } catch (cause) {
      setSpeakerPhase("error");
      setSpeakerFailure(safeLocalFailure(cause));
    }
  }

  const serverTone: CheckTone =
    serverPhase === "running"
      ? "working"
      : serverPhase === "complete"
        ? serverResult?.overallStatus === "ready"
          ? "ready"
          : "warning"
        : serverPhase === "error"
          ? "error"
          : "neutral";
  const serverLabel =
    serverPhase === "running"
      ? "Checking"
      : serverPhase === "complete"
        ? serverResult?.overallStatus === "ready"
          ? "Ready"
          : "Needs attention"
        : serverPhase === "error"
          ? "Check failed"
          : "Not checked";
  const localBusy =
    localPhase === "running" ||
    localSnapshot?.lifecycle === "preparing" ||
    localSnapshot?.lifecycle === "speaking";
  const speakerReady =
    localPhase === "complete" && localSnapshot?.lifecycle === "ready";
  const localPresentation = deriveLocalPreflightPresentation(
    localPhase,
    localSnapshot,
  );

  return (
    <main className={styles.page}>
      <nav className="topbar" aria-label="Preflight navigation">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <span className="status-pill">
          <span className="status-dot" aria-hidden="true" />
          System readiness
        </span>
      </nav>

      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>Before court is called</p>
          <h1>Make sure every system can take the stand.</h1>
        </div>
        <p>
          Run private server checks, warm the local speech models, verify
          microphone capture, and play a fixed courtroom clip before beginning
          a fictional educational hearing.
        </p>
      </header>

      <div className={styles.privacyNote}>
        <strong>Audio stays on this machine.</strong>
        <span>
          Microphone PCM travels only between this browser and the configured
          local speech companion. The server check returns safe readiness codes,
          never credentials.
        </span>
      </div>

      <section className={styles.section} aria-labelledby="server-checks-title">
        <div className={styles.sectionHeading}>
          <div className={styles.stepNumber}>01</div>
          <div>
            <p>Private infrastructure</p>
            <h2 id="server-checks-title">Server checks</h2>
          </div>
          <StatusBadge label={serverLabel} tone={serverTone} />
        </div>
        <div className={styles.sectionIntro}>
          <div>
            <p>
              This explicit check verifies the signed session, protected Convex
              health boundary, and access to the two pinned GPT-5.6 models.
            </p>
            <p className={styles.probeCopy}>
              The model checks send two tiny fixed Responses API probes—never
              case, transcript, or microphone content. Ready results are reused
              for five minutes to limit API calls.
            </p>
          </div>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => void runServerChecks()}
            disabled={serverPhase === "running"}
          >
            {serverPhase === "running" ? "Running checks…" : "Run server checks"}
          </button>
        </div>
        <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
          {serverPhase === "running" ? "Server checks are running." : null}
          {serverPhase === "complete"
            ? `Server checks completed: ${serverResult?.overallStatus ?? "unknown"}.`
            : null}
        </div>
        {serverFailure ? <SafeError failure={serverFailure} /> : null}
        {serverResult ? <ServerResults result={serverResult} /> : (
          <div className={styles.emptyState}>
            <span>Session</span>
            <span>Convex</span>
            <span>gpt-5.6-luna</span>
            <span>gpt-5.6-terra</span>
            <p>Results appear here only after you run the server checks.</p>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="local-checks-title">
        <div className={styles.sectionHeading}>
          <div className={styles.stepNumber}>02</div>
          <div>
            <p>Loopback audio</p>
            <h2 id="local-checks-title">Local speech & devices</h2>
          </div>
          <StatusBadge
            label={localPresentation.label}
            tone={localPresentation.tone}
          />
        </div>
        <div className={styles.sectionIntro}>
          <div>
            <p>
              Preparation connects to the local companion, loads and warms its
              configured providers, and briefly opens then releases microphone
              capture. Your browser may ask for permission.
            </p>
            <p className={styles.permissionCopy}>
              Choose “Allow” only if you want to test this machine’s microphone.
            </p>
          </div>
          <div className={styles.buttonGroup}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => void prepareLocalAudio()}
              disabled={localBusy}
            >
              {localPhase === "running" ? "Warming local audio…" : "Prepare local audio"}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => void testSpeaker()}
              disabled={!speakerReady || speakerPhase === "running"}
            >
              {speakerPhase === "running" ? "Playing test…" : "Test speakers"}
            </button>
          </div>
        </div>
        <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
          {localSnapshot?.message ?? ""}
          {speakerPhase === "complete"
            ? "Speaker playback completed. Confirm that you heard the courtroom clip."
            : null}
        </div>
        {localFailure ? <SafeError failure={localFailure} /> : null}
        {speakerFailure ? <SafeError failure={speakerFailure} /> : null}
        <LocalResults
          snapshot={localSnapshot}
          presentation={localPresentation}
          speakerPhase={speakerPhase}
        />
      </section>

      <section className={styles.nextStep} aria-labelledby="next-step-title">
        <div>
          <p className={styles.kicker}>Ready for the record?</p>
          <h2 id="next-step-title">Choose a fictional matter, then enter court.</h2>
          <p>
            SUITS is an educational simulation. It does not provide legal advice
            or predict real-case outcomes.
          </p>
        </div>
        <div className={styles.nextActions}>
          <Link className={styles.primaryLink} href="/cases/">
            Choose a case
          </Link>
          <Link className={styles.secondaryLink} href="/hearing/">
            Open hearing
          </Link>
        </div>
      </section>
    </main>
  );
}
