export type ElevenLabsConfig = {
  apiKey: string;
  ttsModel: string;
  sttModel: string;
};

type Fetcher = typeof fetch;

export async function synthesizeWithElevenLabs(
  text: string,
  voiceId: string,
  config: ElevenLabsConfig,
  fetcher: Fetcher = fetch,
): Promise<ArrayBuffer> {
  const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg", "xi-api-key": config.apiKey },
    body: JSON.stringify({ text, model_id: config.ttsModel, output_format: "mp3_44100_128" }),
  });
  if (!response.ok) throw new Error(`TTS request failed (${response.status})`);
  return response.arrayBuffer();
}

export async function transcribeWithElevenLabs(
  audio: ArrayBuffer,
  mimeType: string,
  config: ElevenLabsConfig,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const form = new FormData();
  form.set("model_id", config.sttModel);
  form.set("file", new Blob([audio], { type: mimeType || "audio/webm" }), "question.webm");
  const response = await fetcher("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": config.apiKey },
    body: form,
  });
  if (!response.ok) throw new Error(`STT request failed (${response.status})`);
  const payload = (await response.json()) as { text?: string };
  const transcript = payload.text?.trim() ?? "";
  if (!transcript) throw new Error("ElevenLabs returned an empty transcript");
  return transcript;
}
