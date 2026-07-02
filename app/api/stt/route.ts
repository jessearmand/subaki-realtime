// Batch speech-to-text for the cascade engine's local STT leg.
//
// POST (body = a finished turn's WAV bytes, `?backend=` a catalog id) →
// forwards the audio as multipart form-data to the backend's transcription
// endpoint (the local mlx-audio server's OpenAI-compatible
// /v1/audio/transcriptions) and returns `{ text }`.
//
// This is the batch alternative to the Mistral realtime WS (which streams
// partial captions): Silero VAD already owns turn boundaries client-side, so
// the client simply records each turn's PCM and posts it here on turn end.
// See docs/voxtral-local-inference.md (STT leg, option b).

import { DEFAULT_STT_BACKEND_ID, resolveSttBackend } from "@/lib/realtime/voice-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const backendId = new URL(req.url).searchParams.get("backend") || DEFAULT_STT_BACKEND_ID;
  const backend = resolveSttBackend(backendId);
  if (!backend || backend.mode !== "batch" || !backend.url || !backend.model) {
    return Response.json(
      { error: `"${backendId}" is not a batch STT backend (see config/voice-models.json).` },
      { status: 400 },
    );
  }
  const apiKey = backend.envKey ? process.env[backend.envKey] : undefined;
  if (backend.envKey && !apiKey) {
    return Response.json(
      { error: `${backend.envKey} is not set on the server (provide it via fnox).` },
      { status: 500 },
    );
  }

  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) {
    return Response.json({ error: "empty audio body." }, { status: 400 });
  }

  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "turn.wav");
  form.append("model", backend.model);
  form.append("response_format", "json");

  let upstream: Response;
  try {
    upstream = await fetch(backend.url, {
      method: "POST",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      body: form,
    });
  } catch (err) {
    return Response.json(
      {
        error: `Failed to reach ${backendId}: ${err instanceof Error ? err.message : "network error"}`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: `${backendId} transcription failed`, status: upstream.status, detail },
      { status: 502 },
    );
  }

  const json = (await upstream.json().catch(() => null)) as { text?: string } | null;
  if (!json || typeof json.text !== "string") {
    return Response.json({ error: `${backendId} returned no text.` }, { status: 502 });
  }
  return Response.json({ text: json.text.trim() });
}
