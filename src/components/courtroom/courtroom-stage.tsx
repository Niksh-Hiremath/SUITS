"use client";

import dynamic from "next/dynamic";
import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type {
  CourtroomAudibleSemanticPerformance,
  CourtroomPresentationFrame,
  CourtroomPresentationRuntimeSnapshot,
  CourtroomPresentationRuntimeState,
  CourtroomQuality,
} from "@/domain/courtroom-presentation";
import { courtroomRuntimeAnnouncementText } from "@/domain/courtroom-presentation";

import {
  courtroomSemanticDelivery,
  courtroomSemanticIntensityBand,
} from "./courtroom-semantic-style";
import styles from "./courtroom-stage.module.css";

const CourtroomCanvas = dynamic(() => import("./courtroom-canvas"), {
  ssr: false,
  loading: () => (
    <div className={styles.fallback} role="status">
      Preparing the courtroom renderer…
    </div>
  ),
});

type RendererBoundaryProps = Readonly<{
  children: ReactNode;
  onError: () => void;
}>;

class RendererBoundary extends Component<
  RendererBoundaryProps,
  Readonly<{ failed: boolean }>
> {
  state = { failed: false };

  static getDerivedStateFromError(): Readonly<{ failed: boolean }> {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function CourtroomStage({
  audibleSemanticPerformance,
  frame,
  presentationRuntime,
  runtimeSnapshot,
  onQualityChange,
}: Readonly<{
  audibleSemanticPerformance: CourtroomAudibleSemanticPerformance | null;
  frame: CourtroomPresentationFrame;
  presentationRuntime: CourtroomPresentationRuntimeState;
  runtimeSnapshot: CourtroomPresentationRuntimeSnapshot;
  onQualityChange: (quality: CourtroomQuality) => void;
}>) {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [rendererError, setRendererError] = useState<string | null>(null);

  useEffect(() => {
    const checkHandle = window.requestAnimationFrame(() => {
      const probe = document.createElement("canvas");
      const supported = Boolean(
        probe.getContext("webgl2") ?? probe.getContext("webgl"),
      );
      setWebglSupported(supported);
      if (!supported) {
        setRendererError(
          "3D rendering is unavailable. The hearing controls remain fully usable.",
        );
      }
    });
    return () => window.cancelAnimationFrame(checkHandle);
  }, []);

  const handleReady = useCallback(() => {
    setReady(true);
    setRendererError(null);
  }, []);
  const handleContextLost = useCallback(() => {
    setReady(false);
    setRendererError(
      "The 3D context was interrupted. The hearing controls remain fully usable.",
    );
  }, []);
  const handleContextRestored = useCallback(() => {
    setReady(false);
    setRendererError(null);
  }, []);
  const handleRenderError = useCallback(() => {
    setReady(false);
    setRendererError(
      "The 3D scene could not render. The hearing controls remain fully usable.",
    );
  }, []);

  const rendererState =
    webglSupported === null
      ? "checking"
      : rendererError
        ? "unavailable"
        : ready
          ? "ready"
          : "loading";
  const cameraShot = presentationRuntime.camera.shot;
  const runtimeCameraIsBase =
    presentationRuntime.camera.targetPriority === 0 &&
    presentationRuntime.camera.targetOrder === 0;
  const cameraTransition =
    frame.reducedMotion || presentationRuntime.reducedMotion
      ? "cut"
      : runtimeCameraIsBase
        ? frame.camera.transition
        : presentationRuntime.camera.transition;
  const performancePurpose =
    runtimeSnapshot.playback?.identity.purpose ?? runtimeSnapshot.source;
  const mouthActor = runtimeMouthIsActive(runtimeSnapshot)
    ? runtimeSnapshot.sceneActor
    : null;
  const runtimeActorLabel = frame.characters.find(
    ({ slot }) => slot === runtimeSnapshot.sceneActor,
  )?.label;
  const announcementText = courtroomRuntimeAnnouncementText(
    runtimeSnapshot.announcement,
  );
  const display = runtimeSnapshot.display;
  const reducedMotion = frame.reducedMotion || presentationRuntime.reducedMotion;
  const screenReaderStatus =
    runtimeSnapshot.source !== "base" &&
    runtimeActorLabel &&
    runtimeSnapshot.animation
      ? `${runtimeActorLabel}: ${runtimeSnapshot.animation.replaceAll("_", " ")}`
      : frame.statusSummary;
  const liveStatus = announcementText ?? screenReaderStatus;
  const semanticIntensityBand = courtroomSemanticIntensityBand(
    audibleSemanticPerformance,
  );
  const semanticDelivery = courtroomSemanticDelivery(
    audibleSemanticPerformance,
  );

  return (
    <section
      aria-labelledby="courtroom-stage-heading"
      className={styles.stage}
      data-active-scene-actor={runtimeSnapshot.sceneActor ?? "none"}
      data-camera-shot={cameraShot}
      data-camera-target={presentationRuntime.camera.target ?? "none"}
      data-camera-transition={cameraTransition}
      data-announcement-change={
        runtimeSnapshot.announcement?.change ?? "none"
      }
      data-announcement-kind={runtimeSnapshot.announcement?.kind ?? "none"}
      data-display-mode={display.mode}
      data-display-phase={runtimeSnapshot.displayPhase}
      data-performance-purpose={performancePurpose}
      data-performance-source={runtimeSnapshot.source}
      data-quality={frame.quality}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-renderer-ready={ready ? "true" : "false"}
      data-renderer-state={rendererState}
      data-ruling-phase={runtimeSnapshot.rulingPhase}
      data-semantic-active={
        audibleSemanticPerformance === null ? "false" : "true"
      }
      data-semantic-delivery={semanticDelivery}
      data-semantic-emotion={audibleSemanticPerformance?.emotion ?? "none"}
      data-semantic-gaze={audibleSemanticPerformance?.gazeTarget ?? "none"}
      data-semantic-gesture={audibleSemanticPerformance?.gesture ?? "none"}
      data-semantic-intensity={semanticIntensityBand}
      data-semantic-kind={audibleSemanticPerformance?.kind ?? "none"}
      data-testid="courtroom-stage"
      data-transition-active={
        runtimeSnapshot.transitionActive ? "true" : "false"
      }
    >
      <div className={styles.canvas}>
        {webglSupported && (
          <RendererBoundary onError={handleRenderError}>
            <CourtroomCanvas
              audibleSemanticPerformance={audibleSemanticPerformance}
              cameraShot={cameraShot}
              cameraTransition={cameraTransition}
              frame={frame}
              onContextLost={handleContextLost}
              onContextRestored={handleContextRestored}
              onReady={handleReady}
              presentationRuntime={presentationRuntime}
              runtimeSnapshot={runtimeSnapshot}
            />
          </RendererBoundary>
        )}
        {(webglSupported === null || rendererError) && (
          <div className={styles.fallback} role="status">
            {rendererError ?? "Checking courtroom renderer support..."}
          </div>
        )}
      </div>
      <div className={styles.header}>
        <div>
          <span>Live courtroom</span>
          <h2 id="courtroom-stage-heading">Semantic performance stage</h2>
        </div>
        <div
          aria-label="Courtroom rendering quality"
          className={styles.qualityControls}
          role="group"
        >
          {(["high", "balanced", "reduced"] as const).map((quality) => (
            <button
              aria-pressed={frame.quality === quality}
              data-quality-option={quality}
              key={quality}
              onClick={() => onQualityChange(quality)}
              type="button"
            >
              {quality}
            </button>
          ))}
        </div>
      </div>
      <div
        className={styles.display}
        data-display-mode={display.mode}
        data-display-phase={runtimeSnapshot.displayPhase}
        data-private={display.mode === "settlement" ? "true" : "false"}
        data-transition-active={
          runtimeSnapshot.displayPhase === "steady" ? "false" : "true"
        }
      >
        <span>
          {display.mode === "settlement"
            ? "Private counsel channel"
            : display.mode === "idle"
              ? "Court display"
              : display.mode}
        </span>
        <strong>{display.label ?? "No exhibit presented"}</strong>
        {display.status && <small>{display.status}</small>}
      </div>
      <div className={styles.actors} aria-hidden="true">
        {frame.characters.map((character) => {
          const isRuntimeActor = runtimeSnapshot.sceneActor === character.slot;
          const isSemanticActor =
            isRuntimeActor && audibleSemanticPerformance !== null;
          const animation =
            isRuntimeActor && runtimeSnapshot.animation
              ? runtimeSnapshot.animation
              : character.animation;
          const posture =
            isRuntimeActor && runtimeSnapshot.posture
              ? runtimeSnapshot.posture
              : character.posture;
          return (
            <div
              className={styles.actor}
              data-actor-slot={character.slot}
              data-active={
                isRuntimeActor || character.emphasis > 0.6 ? "true" : "false"
              }
              data-animation={animation}
              data-mouth-active={mouthActor === character.slot ? "true" : "false"}
              data-posture={posture}
              data-scene-actor={character.slot}
              data-semantic-active={isSemanticActor ? "true" : "false"}
              data-semantic-emotion={
                isSemanticActor
                  ? audibleSemanticPerformance?.emotion
                  : undefined
              }
              data-gavel-state={
                character.slot === "judge"
                  ? runtimeSnapshot.rulingPhase
                  : undefined
              }
              key={character.slot}
            >
              <span>{character.label}</span>
              <strong>
                {character.present
                  ? animation.replaceAll("_", " ")
                  : "off stage"}
              </strong>
            </div>
          );
        })}
      </div>
      <p
        aria-atomic="true"
        aria-live="polite"
        className={styles.screenReaderStatus}
      >
        {liveStatus}
      </p>
    </section>
  );
}

function runtimeMouthIsActive(
  snapshot: CourtroomPresentationRuntimeSnapshot,
): boolean {
  if (snapshot.source === "user_speech") return true;
  return snapshot.playback !== null && snapshot.playback.phase !== "requested";
}
