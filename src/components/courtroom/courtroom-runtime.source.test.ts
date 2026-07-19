import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STAGE_PATH = fileURLToPath(
  new URL("./courtroom-stage.tsx", import.meta.url),
);
const CANVAS_PATH = fileURLToPath(
  new URL("./courtroom-canvas.tsx", import.meta.url),
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
      "data-actor-slot",
      "data-animation",
      "data-posture",
      "data-mouth-active",
    ]) {
      expect(stage).toContain(selector);
    }
    expect(stage).toContain("screenReaderStatus");
    expect(stage).toContain("runtimeSnapshot.animation.replaceAll");
    expect(stage).not.toContain("transcript[");

    expect(canvas).toContain(
      'canvas.setAttribute("data-mouth-actor", actor)',
    );
    expect(canvas).toContain(
      'canvas.setAttribute("data-mouth-shape", shape)',
    );
    expect(canvas).not.toMatch(/setAttribute\("data-[^"]*(?:time|start|end)/u);
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
    expect(canvas).toContain("if (!reducedMotion && hasFutureMouthCue) invalidate()");
    expect(canvas).not.toContain("useState");
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
    expect(canvas).toContain("reducedMotion ? 0 : nowMs");
  });
});
