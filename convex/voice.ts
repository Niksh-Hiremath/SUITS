"use node";

import { v } from "convex/values";

import { conciseSpeech } from "../src/domain/voice";
import { synthesizeWithElevenLabs, transcribeWithElevenLabs } from "../src/server/elevenlabs";
import { api } from "./_generated/api";
import { action } from "./_generated/server";

function config() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured in Convex");
  return {
    apiKey,
    ttsModel: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5",
    sttModel: process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2",
  };
}

export const transcribe = action({
  args: { trialId: v.string(), audio: v.bytes(), mimeType: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const trace = await ctx.runMutation(api.traces.start, { trialId: args.trialId, actor: "Advocate", action: "transcribe_push_to_talk", phase: "cross_examination", provider: "elevenlabs", model: process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2", promptVersion: "voice.v1" });
    try {
      const transcript = await transcribeWithElevenLabs(args.audio, args.mimeType, config());
      await ctx.runMutation(api.traces.finish, { traceId: trace, status: "succeeded" });
      return transcript;
    } catch (error) {
      await ctx.runMutation(api.traces.finish, { traceId: trace, status: "fallback", fallbackUsed: true, errorCode: "STT_FAILED", errorSummary: error instanceof Error ? error.message : "Transcription failed" });
      throw error;
    }
  },
});

export const synthesize = action({
  args: { trialId: v.string(), text: v.string(), voice: v.optional(v.string()) },
  handler: async (ctx, args): Promise<ArrayBuffer> => {
    const model = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5";
    const voiceId = args.voice ?? process.env.ELEVENLABS_VOICE_WITNESS;
    if (!voiceId) throw new Error("ELEVENLABS_VOICE_WITNESS is not configured in Convex");
    const trace = await ctx.runMutation(api.traces.start, { trialId: args.trialId, actor: "Witness", action: "synthesize_response", phase: "cross_examination", provider: "elevenlabs", model, promptVersion: "voice.v1" });
    try {
      const audio = await synthesizeWithElevenLabs(conciseSpeech(args.text), voiceId, config());
      await ctx.runMutation(api.traces.finish, { traceId: trace, status: "succeeded" });
      return audio;
    } catch (error) {
      await ctx.runMutation(api.traces.finish, { traceId: trace, status: "fallback", fallbackUsed: true, errorCode: "TTS_FAILED", errorSummary: error instanceof Error ? error.message : "Speech generation failed" });
      throw error;
    }
  },
});
