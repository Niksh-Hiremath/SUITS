"use node";

import { v } from "convex/values";

import { conciseSpeech } from "../src/domain/voice";
import { synthesizeWithElevenLabs, transcribeWithElevenLabs } from "../src/server/elevenlabs";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

function config() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured in Convex");
  return {
    apiKey,
    ttsModel: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5",
    sttModel: process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2",
  };
}

export const transcribe = internalAction({
  args: { trialId: v.string(), audio: v.bytes(), mimeType: v.string(), durationSeconds: v.number() },
  handler: async (ctx, args): Promise<string> => {
    const trace = await ctx.runMutation(internal.traces.start, { trialId: args.trialId, actor: "Advocate", action: "transcribe_push_to_talk", phase: "cross_examination", provider: "elevenlabs", model: process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2", promptVersion: "voice.v1" });
    try {
      const transcript = await transcribeWithElevenLabs(args.audio, args.mimeType, config());
      await ctx.runMutation(internal.traces.finish, { traceId: trace, status: "succeeded", outputCharacters: transcript.length, audioDurationSeconds: args.durationSeconds });
      return transcript;
    } catch (error) {
      await ctx.runMutation(internal.traces.finish, { traceId: trace, status: "fallback", fallbackUsed: true, errorCode: "STT_FAILED", errorSummary: error instanceof Error ? error.message : "Transcription failed" });
      throw error;
    }
  },
});

export const synthesize = internalAction({
  args: { trialId: v.string(), text: v.string(), role: v.optional(v.union(v.literal("judge"), v.literal("advocate"), v.literal("witness"), v.literal("juror_1"), v.literal("juror_2"), v.literal("juror_3"))) },
  handler: async (ctx, args): Promise<ArrayBuffer> => {
    const model = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5";
    const role = args.role ?? "witness";
    const voiceKeys = { judge: "ELEVENLABS_VOICE_DIRECTOR", advocate: "ELEVENLABS_VOICE_ADVOCATE", witness: "ELEVENLABS_VOICE_WITNESS", juror_1: "ELEVENLABS_VOICE_JUROR_1", juror_2: "ELEVENLABS_VOICE_JUROR_2", juror_3: "ELEVENLABS_VOICE_JUROR_3" } as const;
    const voiceId = process.env[voiceKeys[role]];
    if (!voiceId) throw new Error(`${voiceKeys[role]} is not configured in Convex`);
    const actors = { judge: "Judge", advocate: "Vertex Advocate", witness: "Witness", juror_1: "Juror 1", juror_2: "Juror 2", juror_3: "Juror 3" } as const;
    const trace = await ctx.runMutation(internal.traces.start, { trialId: args.trialId, actor: actors[role], action: "synthesize_response", phase: role.startsWith("juror") ? "deliberation" : role === "judge" ? "briefing" : role === "advocate" ? "opening" : "cross_examination", provider: "elevenlabs", model, promptVersion: "voice.v2" });
    try {
      const spokenText = role === "judge" || role === "advocate" || role.startsWith("juror") ? args.text : conciseSpeech(args.text);
      const audio = await synthesizeWithElevenLabs(spokenText, voiceId, config());
      await ctx.runMutation(internal.traces.finish, { traceId: trace, status: "succeeded", inputCharacters: spokenText.length, outputCharacters: spokenText.length });
      return audio;
    } catch (error) {
      await ctx.runMutation(internal.traces.finish, { traceId: trace, status: "fallback", fallbackUsed: true, errorCode: "TTS_FAILED", errorSummary: error instanceof Error ? error.message : "Speech generation failed" });
      throw error;
    }
  },
});
