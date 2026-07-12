export type VoiceFallbackReason =
  | "permission_denied"
  | "empty_audio"
  | "stt_failed"
  | "tts_failed"
  | "autoplay_blocked";

const fallbackMessages: Record<VoiceFallbackReason, string> = {
  permission_denied: "Microphone access was denied. Type your question instead.",
  empty_audio: "No speech was captured. Try again or type your question.",
  stt_failed: "Transcription failed. Your typed question still works.",
  tts_failed: "Audio is unavailable. The full response remains visible.",
  autoplay_blocked: "Press Play to hear this response, or continue with text.",
};

export function conciseSpeech(text: string, maximumWords = 35): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maximumWords) return words.join(" ");
  return `${words.slice(0, maximumWords).join(" ").replace(/[.,;:!?]$/, "")}…`;
}

export function voiceFallbackMessage(reason: VoiceFallbackReason): string {
  return fallbackMessages[reason];
}
