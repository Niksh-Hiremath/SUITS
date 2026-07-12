import { describe, expect, it } from "vitest";

import { conciseSpeech, voiceFallbackMessage } from "./voice";

describe("voice presentation", () => {
  it("keeps spoken responses to at most 35 words without changing visible text", () => {
    const visible = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty thirty-one thirty-two thirty-three thirty-four thirty-five thirty-six thirty-seven.";

    expect(conciseSpeech(visible).split(/\s+/)).toHaveLength(35);
    expect(conciseSpeech(visible).endsWith("…")).toBe(true);
    expect(visible).toContain("thirty-seven");
  });

  it.each([
    ["permission_denied", "Microphone access was denied. Type your question instead."],
    ["empty_audio", "No speech was captured. Try again or type your question."],
    ["stt_failed", "Transcription failed. Your typed question still works."],
    ["tts_failed", "Audio is unavailable. The full response remains visible."],
    ["autoplay_blocked", "Press Play to hear this response, or continue with text."],
  ] as const)("provides a text-first fallback for %s", (reason, expected) => {
    expect(voiceFallbackMessage(reason)).toBe(expected);
  });

  it("names the closing when voice input falls back to typing", () => {
    expect(voiceFallbackMessage("permission_denied", "closing")).toBe(
      "Microphone access was denied. Type your closing instead.",
    );
    expect(voiceFallbackMessage("stt_failed", "closing")).toBe(
      "Transcription failed. Your typed closing still works.",
    );
  });
});
