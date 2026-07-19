import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { CourtroomAnimationSchema } from "../../src/domain/courtroom-presentation";
import {
  COURTROOM_VISUAL_ATLAS_STATE_IDS,
  createCourtroomVisualFixture,
} from "../../src/components/courtroom/courtroom-visual-fixtures";

const CAPTURE_EVIDENCE = process.env.SUITS_CAPTURE_M7_VISUALS === "1";
const EVIDENCE_DIRECTORY = path.resolve(
  process.cwd(),
  "docs",
  "build-week",
  "artifacts",
  "m7",
);

test.use({
  deviceScaleFactor: 1,
  video: "on",
  viewport: { width: 1_280, height: 800 },
});

test("captures every deterministic courtroom visual state", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  const hearingRequests: string[] = [];
  const speechSockets: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/hearings")) hearingRequests.push(pathname);
  });
  page.on("websocket", (socket) => {
    const socketUrl = new URL(socket.url());
    if (socketUrl.pathname.startsWith("/v1/speech")) {
      speechSockets.push(socket.url());
    }
  });
  await page.addInitScript(() => {
    const scope = window as typeof window & {
      __suitsAtlasGetUserMediaCalls: number;
    };
    Object.defineProperty(scope, "__suitsAtlasGetUserMediaCalls", {
      configurable: false,
      enumerable: false,
      value: 0,
      writable: true,
    });
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices === undefined) return;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: (...arguments_: Parameters<MediaDevices["getUserMedia"]>) => {
        scope.__suitsAtlasGetUserMediaCalls += 1;
        return original(...arguments_);
      },
    });
  });

  const response = await page.goto("/test-support/courtroom-atlas/");
  expect(response?.ok()).toBe(true);
  const atlas = page.getByTestId("courtroom-visual-atlas");
  const stage = page.getByTestId("courtroom-stage");
  const canvas = stage.locator("canvas");
  await expect(atlas).toBeVisible();
  await expect(stage).toHaveAttribute("data-renderer-ready", "true", {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    for (const portal of document.querySelectorAll("nextjs-portal")) {
      portal.remove();
    }
  });
  await page.getByRole("button", { name: "reduced", exact: true }).click();
  await expect(stage).toHaveAttribute("data-quality", "reduced");
  if (CAPTURE_EVIDENCE) {
    await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  }

  const observedAnimations = new Set<string>();
  const observedDisplayPhases = new Set<string>();
  const observedRulingPhases = new Set<string>();
  for (const stateId of COURTROOM_VISUAL_ATLAS_STATE_IDS) {
    const expected = createCourtroomVisualFixture(stateId).runtimeSnapshot;
    await page.locator(`[data-atlas-state-option="${stateId}"]`).click();
    await expect(atlas).toHaveAttribute("data-atlas-state", stateId);
    await expect(stage).toHaveAttribute("data-renderer-ready", "true");
    await expect(canvas).toHaveAttribute(
      "data-display-mode",
      expected.display.mode,
    );
    await expect(canvas).toHaveAttribute(
      "data-display-phase",
      expected.displayPhase,
    );
    await expect(canvas).toHaveAttribute(
      "data-ruling-phase",
      expected.rulingPhase,
    );
    await expect(canvas).toHaveAttribute(
      "data-transition-active",
      String(expected.transitionActive),
    );
    await page.waitForTimeout(220);
    await page.evaluate(() => {
      for (const portal of document.querySelectorAll("nextjs-portal")) {
        portal.remove();
      }
    });

    const animation = await atlas.getAttribute("data-atlas-animation");
    const displayPhase = await atlas.getAttribute("data-atlas-display-phase");
    const rulingPhase = await atlas.getAttribute("data-atlas-ruling-phase");
    if (animation !== null) observedAnimations.add(animation);
    if (displayPhase !== null) observedDisplayPhases.add(displayPhase);
    if (rulingPhase !== null) observedRulingPhases.add(rulingPhase);

    await expect(stage).toHaveScreenshot(`courtroom-${stateId}.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.005,
      threshold: 0.2,
    });
    const image = await stage.screenshot({
      animations: "disabled",
      caret: "hide",
    });
    await testInfo.attach(`courtroom-${stateId}`, {
      body: image,
      contentType: "image/png",
    });
    if (CAPTURE_EVIDENCE) {
      await writeFile(
        path.join(EVIDENCE_DIRECTORY, `courtroom-${stateId}.png`),
        image,
      );
    }
  }

  expect([...observedAnimations].sort()).toEqual(
    [...CourtroomAnimationSchema.options].sort(),
  );
  expect(observedDisplayPhases).toEqual(
    new Set(["entering", "exiting", "steady", "switching", "updating"]),
  );
  expect(observedRulingPhases).toEqual(
    new Set(["gavel", "holding", "idle", "ready"]),
  );
  expect(browserErrors).toEqual([]);
  expect(hearingRequests).toEqual([]);
  expect(speechSockets).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __suitsAtlasGetUserMediaCalls: number;
          }
        ).__suitsAtlasGetUserMediaCalls,
    ),
  ).toBe(0);

  const video = page.video();
  await page.close();
  if (video !== null) {
    const outputPath = testInfo.outputPath("courtroom-visual-atlas.webm");
    await video.saveAs(outputPath);
    await testInfo.attach("courtroom-visual-atlas-video", {
      path: outputPath,
      contentType: "video/webm",
    });
    if (CAPTURE_EVIDENCE) {
      await video.saveAs(
        path.join(EVIDENCE_DIRECTORY, "courtroom-visual-atlas.webm"),
      );
    }
  }
});
