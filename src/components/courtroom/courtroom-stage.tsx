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
  CourtroomPresentationFrame,
  CourtroomQuality,
} from "@/domain/courtroom-presentation";

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
  frame,
  onQualityChange,
}: Readonly<{
  frame: CourtroomPresentationFrame;
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

  return (
    <section
      aria-labelledby="courtroom-stage-heading"
      className={styles.stage}
      data-camera-shot={frame.camera.shot}
      data-quality={frame.quality}
      data-renderer-ready={ready ? "true" : "false"}
      data-renderer-state={rendererState}
      data-testid="courtroom-stage"
    >
      <div className={styles.canvas}>
        {webglSupported && (
          <RendererBoundary onError={handleRenderError}>
            <CourtroomCanvas
              frame={frame}
              onContextLost={handleContextLost}
              onContextRestored={handleContextRestored}
              onReady={handleReady}
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
        data-display-mode={frame.display.mode}
        data-private={frame.display.mode === "settlement" ? "true" : "false"}
      >
        <span>
          {frame.display.mode === "settlement"
            ? "Private counsel channel"
            : frame.display.mode === "idle"
              ? "Court display"
              : frame.display.mode}
        </span>
        <strong>{frame.display.label ?? "No exhibit presented"}</strong>
        {frame.display.status && <small>{frame.display.status}</small>}
      </div>
      <div className={styles.actors} aria-hidden="true">
        {frame.characters.map((character) => (
          <div
            className={styles.actor}
            data-active={character.emphasis > 0.6 ? "true" : "false"}
            data-animation={character.animation}
            key={character.slot}
          >
            <span>{character.label}</span>
            <strong>{character.present ? character.animation.replaceAll("_", " ") : "off stage"}</strong>
          </div>
        ))}
      </div>
      <p aria-live="polite" className={styles.screenReaderStatus}>
        {frame.statusSummary}
      </p>
    </section>
  );
}
