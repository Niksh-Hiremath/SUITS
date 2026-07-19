import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PreflightClient,
  deriveLocalPreflightPresentation,
  serverHttpFailure,
} from "./preflight-client";

const CLIENT_PATH = fileURLToPath(
  new URL("./preflight-client.tsx", import.meta.url),
);
const STYLES_PATH = fileURLToPath(
  new URL("./preflight.module.css", import.meta.url),
);

describe("preflight page", () => {
  it("renders explicit accessible checks and hearing navigation without a text composer", () => {
    const markup = renderToStaticMarkup(createElement(PreflightClient));

    expect(markup).toContain("Run server checks");
    expect(markup).toContain("Prepare local audio");
    expect(markup).toContain("Test speakers");
    expect(markup).toContain("gpt-5.6-luna");
    expect(markup).toContain("gpt-5.6-terra");
    expect(markup).toContain("two tiny fixed Responses API probes");
    expect(markup).toContain('href="/cases"');
    expect(markup).toContain('href="/hearing"');
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toMatch(/<input\b/iu);
  });

  it("uses strict safe boundaries for the server and local controller", async () => {
    const source = await readFile(CLIENT_PATH, "utf8");

    expect(source).toContain('fetch("/api/preflight"');
    expect(source).toContain('method: "POST"');
    expect(source).toContain("ServerPreflightRequestSchema.parse({})");
    expect(source).toContain("ServerPreflightResponseSchema.safeParse(");
    expect(source).toContain("new HearingController({");
    expect(source).toContain("getView: () => null");
    expect(source).toContain("commitFinal: async () => undefined");
    expect(source).toContain("await controller.prepare()");
    expect(source).toContain("await controller.speakerTest()");
    expect(source).toContain("void controller.close()");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("SUITS_CONVEX_SERVICE_SECRET");
    expect(source).not.toContain("<textarea");
  });

  it("revokes local readiness when a prepared companion disconnects", () => {
    const readySnapshot = {
      lifecycle: "ready",
      code: null,
      message: null,
      partialText: "",
      activeMode: null,
      capabilities: null,
      objectionMetrics: null,
      speechMetrics: null,
      captureStatus: "stopped",
      playbackStatus: "idle",
    } as const;

    expect(
      deriveLocalPreflightPresentation("complete", readySnapshot),
    ).toMatchObject({
      label: "Ready",
      operational: true,
      microphoneReady: true,
    });
    expect(
      deriveLocalPreflightPresentation("complete", {
        ...readySnapshot,
        lifecycle: "recoverable_error",
        code: "SPEECH_DISCONNECTED",
        message: "The local speech companion disconnected.",
      }),
    ).toEqual({
      label: "Needs attention",
      tone: "error",
      operational: false,
      microphoneReady: false,
    });
  });

  it("presents bounded quota and generic service recovery guidance", () => {
    expect(serverHttpFailure(429, "120")).toEqual({
      code: "PREFLIGHT_RATE_LIMITED",
      message: "The live model checks were run recently.",
      action: "Wait about 120 seconds, then retry.",
    });
    expect(serverHttpFailure(503, null)).toEqual({
      code: "PREFLIGHT_CHECK_UNAVAILABLE",
      message: "The server could not complete its protected preflight checks.",
      action:
        "Confirm the SUITS session, Convex, and server configuration, then retry.",
    });
    expect(serverHttpFailure(429, "999999").action).toBe(
      "Wait a few minutes, then retry.",
    );
  });

  it("never prepares the microphone on mount and keeps a narrow layout contract", async () => {
    const [source, styles] = await Promise.all([
      readFile(CLIENT_PATH, "utf8"),
      readFile(STYLES_PATH, "utf8"),
    ]);
    const mountStart = source.indexOf("useEffect(() => {");
    const mountEnd = source.indexOf("}, []);", mountStart);
    expect(mountStart).toBeGreaterThan(-1);
    expect(mountEnd).toBeGreaterThan(mountStart);
    const mountEffect = source.slice(mountStart, mountEnd);
    expect(mountEffect).not.toContain(".prepare(");
    expect(mountEffect).not.toContain(".speakerTest(");
    expect(mountEffect).not.toContain("getUserMedia");
    expect(styles).toContain("@media (max-width: 680px)");
    expect(styles).toContain("width: min(100% - 22px, 1180px)");
    expect(styles).toContain("grid-template-columns: 1fr");
  });
});
