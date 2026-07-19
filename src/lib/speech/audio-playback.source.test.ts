import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PLAYBACK_PATH = fileURLToPath(
  new URL("./audio-playback.ts", import.meta.url),
);

describe("browser PCM playback boundary", () => {
  it("does not create encoded media, object URLs, persistence, or network paths", async () => {
    const source = await readFile(PLAYBACK_PATH, "utf8");
    expect(source).toContain("context.createBuffer(1, sampleCount");
    expect(source).toContain("context.createBufferSource()");
    expect(source).toContain("pcm.getInt16");
    expect(source).toContain("this.maxQueuedBytes");
    for (const forbidden of [
      "Blob(",
      "MediaSource",
      "MediaRecorder",
      "createObjectURL",
      "HTMLAudioElement",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "fetch(",
      "WebSocket",
      "btoa(",
      "console.",
    ]) {
      expect(source, `forbidden playback capability: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});
