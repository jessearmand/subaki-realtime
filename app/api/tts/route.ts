// Text-to-speech for the cascade engine's TTS leg, catalog-driven like /api/llm.
//
// POST { text, voice, backend? } → resolves a backend from
// config/voice-models.json (Mistral cloud or the local mlx-audio server) and
// returns audio/mpeg bytes the browser can play as a blob. Secrets stay
// server-side (fnox); a backend with an empty envKey is keyless (local).
//
// `voice` is always a Mistral voice_id slug (cascade-agent's ttsVoice); a
// backend with a `voiceMap` translates it to its own preset names, so persona
// voices are cast per backend in the catalog, not in code.
//
// Response shapes: Mistral answers `{ audio_data: <base64> }` (mistral-json);
// an OpenAI-style server streams raw audio bytes (audio-bytes). Per-clause
// calls keep each request short so playback pipelines with the LM stream.

import { DEFAULT_TTS_BACKEND_ID, resolveTtsBackend } from "@/lib/realtime/voice-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TtsRequest {
  text?: string;
  voice?: string;
  /** Backend id from config/voice-models.json (defaults to the catalog default). */
  backend?: string;
}

const DEFAULT_VOICE = "en_paul_neutral";

export async function POST(req: Request): Promise<Response> {
  let body: TtsRequest;
  try {
    body = (await req.json()) as TtsRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text) return Response.json({ error: "text is required." }, { status: 400 });

  const backendId = body.backend || DEFAULT_TTS_BACKEND_ID;
  const backend = resolveTtsBackend(backendId);
  if (!backend) {
    return Response.json(
      { error: `Unknown TTS backend "${backendId}" (define it in config/voice-models.json).` },
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

  // Translate the Mistral voice_id slug into this backend's voice name.
  const slug = body.voice || DEFAULT_VOICE;
  const voice = backend.voiceMap ? (backend.voiceMap[slug] ?? backend.defaultVoice ?? slug) : slug;

  const upstreamBody: Record<string, unknown> = {
    model: backend.model,
    input: text,
    response_format: "mp3",
  };
  if (backend.responseShape === "mistral-json") {
    upstreamBody.voice_id = voice;
  } else {
    upstreamBody.voice = voice;
    if (backend.temperature != null) upstreamBody.temperature = backend.temperature;
  }

  let upstream: Response;
  try {
    upstream = await fetch(backend.url, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upstreamBody),
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
      { error: `${backendId} speech request failed`, status: upstream.status, detail },
      { status: 502 },
    );
  }

  const headers = { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" };

  // OpenAI-style backends stream the audio body directly — pipe it through.
  if (backend.responseShape === "audio-bytes") {
    return new Response(upstream.body, { status: 200, headers });
  }

  const json = (await upstream.json()) as { audio_data?: string };
  if (!json.audio_data) {
    return Response.json({ error: `${backendId} returned no audio_data.` }, { status: 502 });
  }
  return new Response(Buffer.from(json.audio_data, "base64"), { status: 200, headers });
}
