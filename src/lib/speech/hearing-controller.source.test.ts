import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./hearing-controller.ts", import.meta.url),
  "utf8",
);

describe("hearing speech controller privacy boundary", () => {
  it("has no remote, persistence, recording, analytics, or logging sink", () => {
    for (const forbidden of [
      /\bfetch\s*\(/u,
      /\bXMLHttpRequest\b/u,
      /\bMediaRecorder\b/u,
      /\bsendBeacon\b/u,
      /\bstorage\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/iu,
      /\bconsole\s*\./u,
      /\bconvex\b/iu,
      /\bopenai\b/iu,
      /\banalytics\b/iu,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it("keeps microphone PCM on the capture callback to local-client send path", () => {
    expect(source).toContain(
      "onFrame: (frame) => this.handleCaptureFrame(frame)",
    );
    expect(source.match(/\.sendPcmFrame\s*\(/gu)).toHaveLength(1);

    const handlerStart = source.indexOf(
      "private handleCaptureFrame(frame: AudioCaptureFrame): void",
    );
    const handlerEnd = source.indexOf(
      "private handleCaptureState",
      handlerStart,
    );
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    expect(handler).toContain("this.client.sendPcmFrame(");
    expect(handler).toContain("new Int16Array(frame.pcm)");
    expect(handler).not.toMatch(/JSON\.stringify|Blob|FileReader|FormData/iu);

    const outsideHandler = `${source.slice(0, handlerStart)}${source.slice(handlerEnd)}`;
    expect(outsideHandler).not.toMatch(/\.sendPcmFrame\s*\(/u);
  });

  it("keeps the final-bound interruption transport injected and actorless", () => {
    expect(source).toContain("interruptFinal?: HearingFinalBoundInterruptionPort");
    expect(source).toContain("FinalBoundInterruptionRequestSchema.parse({");
    expect(source).toContain("FinalBoundInterruptionResponseSchema.parse(");

    const requestStart = source.indexOf(
      "private async requestFinalBoundInterruption(",
    );
    const requestEnd = source.indexOf(
      "private async deliverFinalBoundInterruption(",
      requestStart,
    );
    expect(requestStart).toBeGreaterThan(-1);
    expect(requestEnd).toBeGreaterThan(requestStart);
    const requestBoundary = source.slice(requestStart, requestEnd);
    expect(requestBoundary).toContain("trigger:");
    expect(requestBoundary).toContain("final:");
    expect(requestBoundary).not.toMatch(
      /ownerId|speakerActorId|objectorActorId|modelMetadata|frame\.pcm/u,
    );
    expect(requestBoundary).not.toMatch(/\bfetch\s*\(/u);

    const partialStart = source.indexOf("private handlePartial(");
    const partialEnd = source.indexOf("private handleFinal(", partialStart);
    const partialHandler = source.slice(partialStart, partialEnd);
    expect(partialHandler).not.toContain("interruptFinal(");
  });
});
