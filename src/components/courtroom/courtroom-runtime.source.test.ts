import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STAGE_PATH = fileURLToPath(
  new URL("./courtroom-stage.tsx", import.meta.url),
);
const CANVAS_PATH = fileURLToPath(
  new URL("./courtroom-canvas.tsx", import.meta.url),
);
const STYLE_PATH = fileURLToPath(
  new URL("./courtroom-stage.module.css", import.meta.url),
);

describe("courtroom runtime renderer boundary", () => {
  it("exposes stable semantic selectors without transcript or timing values", async () => {
    const stage = await readFile(STAGE_PATH, "utf8");
    const canvas = await readFile(CANVAS_PATH, "utf8");

    for (const selector of [
      "data-active-scene-actor",
      "data-performance-purpose",
      "data-performance-source",
      "data-camera-shot",
      "data-camera-target",
      "data-camera-transition",
      "data-capture-clock",
      "data-announcement-change",
      "data-announcement-kind",
      "data-display-mode",
      "data-display-phase",
      "data-actor-slot",
      "data-animation",
      "data-posture",
      "data-mouth-active",
      "data-ruling-phase",
      "data-semantic-active",
      "data-semantic-delivery",
      "data-semantic-emotion",
      "data-semantic-gaze",
      "data-semantic-gesture",
      "data-semantic-intensity",
      "data-semantic-kind",
      "data-transition-active",
    ]) {
      expect(stage).toContain(selector);
    }
    expect(stage).toContain("courtroomRuntimeAnnouncementText");
    expect(stage.match(/aria-live="polite"/gu)).toHaveLength(1);
    expect(stage).toContain("announcementText ?? screenReaderStatus");
    expect(stage).toContain("const display = runtimeSnapshot.display");
    expect(stage).toContain('data-gavel-state={');
    expect(stage).toContain("screenReaderStatus");
    expect(stage).toContain("runtimeSnapshot.animation.replaceAll");
    expect(stage).not.toContain("transcript[");
    expect(stage).not.toContain("frame.display.mode");
    expect(stage).not.toContain("semanticCue");
    expect(canvas).not.toContain("semanticCue");
    expect(stage).not.toContain("outputHash");
    expect(canvas).not.toContain("outputHash");
    expect(stage).not.toContain("activity");
    expect(canvas).not.toContain("activity");

    expect(canvas).toContain(
      'canvas.setAttribute("data-mouth-actor", actor)',
    );
    expect(canvas).toContain(
      'canvas.setAttribute("data-mouth-shape", shape)',
    );
    expect(canvas).toContain(
      'canvas.setAttribute("data-display-mode", snapshot.display.mode)',
    );
    expect(canvas).toContain(
      'canvas.setAttribute("data-display-phase", snapshot.displayPhase)',
    );
    expect(canvas).toContain(
      'canvas.setAttribute("data-ruling-phase", snapshot.rulingPhase)',
    );
    expect(canvas).toContain(
      'canvas.setAttribute("data-transition-active", transitionActive)',
    );
    expect(canvas).not.toMatch(/setAttribute\("data-[^"]*(?:time|start|end)/u);

    for (const privateSelector of [
      "data-item-id",
      "data-offer",
      "data-terms",
      "data-output-hash",
      "data-timestamp",
      "data-transition-start",
      "data-transition-end",
      "data-call-id",
      "data-action-id",
      "data-event-id",
      "data-evidence-id",
    ]) {
      expect(stage).not.toContain(privateSelector);
      expect(canvas).not.toContain(privateSelector);
    }
  });

  it("samples one validated runtime snapshot per demand frame", async () => {
    const canvas = await readFile(CANVAS_PATH, "utf8");

    expect(canvas).toContain("function sampleRuntimeFrame(");
    expect(canvas).toContain("clock.elapsedTime");
    expect(canvas).toContain("sampler.current.frameTimeSeconds");
    expect(canvas).toContain("captureAtMs ?? performance.now()");
    expect(canvas).toContain("captureAtMs === undefined &&");
    expect(canvas).toContain(
      "sampler.current.presentationRuntime === presentationRuntime",
    );
    expect(
      canvas.match(/selectCourtroomPresentationRuntime\(/gu),
    ).toHaveLength(1);
  });

  it("applies audited affect only to the exact audible runtime actor", async () => {
    const canvas = await readFile(CANVAS_PATH, "utf8");

    expect(canvas).toContain("deriveCourtroomSemanticStyle(");
    expect(canvas).toContain("sampledRuntimeOwnsActor &&");
    expect(canvas).toContain('sampledRuntime.source === "playback"');
    expect(canvas).toContain(
      'sampledRuntime.playback?.phase !== "requested"',
    );
    expect(canvas).toContain(
      'runtimeSnapshot.sceneActor === "witness"',
    );
    expect(canvas).toContain("semanticStyle.headYaw");
  });

  it("animates every allowlisted semantic pose inside the demand loop", async () => {
    const canvas = await readFile(CANVAS_PATH, "utf8");

    for (const animation of [
      "idle",
      "listening",
      "thinking",
      "speaking",
      "objecting",
      "standing",
      "sitting",
      "presenting_evidence",
      "reacting",
      "ruling",
      "gavel",
    ]) {
      expect(canvas).toContain(`case "${animation}":`);
    }
    expect(canvas).toContain('frameloop="demand"');
    expect(canvas).toContain("MathUtils.damp");
    expect(canvas).toContain("performance.now()");
    expect(canvas).toContain(
      "hasFutureMouthCue || snapshot.transitionActive",
    );
    expect(canvas).not.toContain("useState");
  });

  it("renders bounded evidence, settlement, and ruling transitions", async () => {
    const canvas = await readFile(CANVAS_PATH, "utf8");
    const stage = await readFile(STAGE_PATH, "utf8");
    const styles = await readFile(STYLE_PATH, "utf8");

    expect(canvas).toContain("function CourtroomDisplaySurface");
    expect(canvas).toContain("displayPalette[snapshot.display.mode]");
    expect(canvas).toContain("snapshot.displayPhase !== \"steady\"");
    expect(canvas).toContain("function JudgeGavel");
    expect(canvas).toContain("snapshot.rulingPhase === \"gavel\"");
    expect(canvas).toContain("rulingTransitionProgress(snapshot, nowMs)");
    expect(stage).toContain("runtimeSnapshot.displayPhase");
    expect(stage).toContain("runtimeSnapshot.rulingPhase");

    for (const phase of ["entering", "updating", "switching", "exiting"]) {
      expect(styles).toContain(`[data-display-phase=\"${phase}\"]`);
    }
    expect(styles).toContain('[data-ruling-phase="gavel"]');
    expect(styles).toContain('[data-reduced-motion="true"] .display');
    expect(styles.match(/240ms/gu)).toHaveLength(1);
    expect(styles).toContain("var(--courtroom-display-transition-duration)");
  });

  it("preserves base camera composition and cuts reduced motion", async () => {
    const stage = await readFile(STAGE_PATH, "utf8");
    const canvas = await readFile(CANVAS_PATH, "utf8");

    expect(stage).toContain("presentationRuntime.camera.targetPriority === 0");
    expect(stage).toContain("presentationRuntime.camera.targetOrder === 0");
    expect(stage).toContain("presentationRuntime.camera.shot");
    expect(stage).toContain("? frame.camera.transition");
    expect(canvas).toContain('const transition = reducedMotion ? "cut" : cameraTransition');
    expect(canvas).toContain('reducedMotion ? "narrow"');
    expect(canvas).toContain(
      "reducedMotion ? 0 : (captureAtMs ?? nowMs)",
    );
  });
});
