import { describe, expect, it, vi } from "vitest";

import { transcribeWithElevenLabs, synthesizeWithElevenLabs } from "./elevenlabs";

const config = { apiKey: "test-key", ttsModel: "eleven_flash_v2_5", sttModel: "scribe_v2" };

describe("ElevenLabs voice provider", () => {
  it("uses Flash v2.5 and returns MPEG audio", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const audio = await synthesizeWithElevenLabs("Concise response", "voice-1", config, fetcher);

    expect(Array.from(new Uint8Array(audio))).toEqual([1, 2, 3]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-1",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "xi-api-key": "test-key" }) }),
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model_id: "eleven_flash_v2_5" });
  });

  it("uses Scribe v2 and trims the reviewed transcript", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ text: "  Is that correct?  " }));

    const transcript = await transcribeWithElevenLabs(new Uint8Array([4, 5]).buffer, "audio/webm", config, fetcher);

    expect(transcript).toBe("Is that correct?");
    const body = fetcher.mock.calls[0][1]?.body as FormData;
    expect(body.get("model_id")).toBe("scribe_v2");
    expect(body.get("file")).toBeInstanceOf(Blob);
  });

  it("rejects empty transcripts and provider failures", async () => {
    await expect(transcribeWithElevenLabs(new ArrayBuffer(1), "audio/webm", config, async () => Response.json({ text: " " }))).rejects.toThrow("empty transcript");
    await expect(synthesizeWithElevenLabs("Hello", "voice-1", config, async () => new Response("quota", { status: 429 }))).rejects.toThrow("TTS request failed (429)");
  });
});
