// Mistral text-to-speech for the cascade engine's TTS leg.
//
// POST { text, voice } → calls Mistral /v1/audio/speech (voxtral-mini-tts) and
// returns the decoded MP3 bytes so the browser can play the blob directly. The
// MISTRAL_API_KEY stays server-side (provided via fnox).
//
// Mistral returns `{ audio_data: <base64> }` (non-streaming); we decode it and
// hand back audio/mpeg. Per-clause calls keep each request short and let the
// engine pipeline playback while the LM streams the next clause.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SPEECH_URL = "https://api.mistral.ai/v1/audio/speech";
const MODEL = "voxtral-mini-tts-2603";
const DEFAULT_VOICE = "en_paul_neutral";

interface TtsRequest {
  text?: string;
  voice?: string;
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "MISTRAL_API_KEY is not set on the server (provide it via fnox)." },
      { status: 500 },
    );
  }

  let body: TtsRequest;
  try {
    body = (await req.json()) as TtsRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text) return Response.json({ error: "text is required." }, { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(SPEECH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        input: text,
        voice_id: body.voice || DEFAULT_VOICE,
        response_format: "mp3",
      }),
    });
  } catch (err) {
    return Response.json(
      { error: `Failed to reach Mistral: ${err instanceof Error ? err.message : "network error"}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: "Mistral speech request failed", status: upstream.status, detail },
      { status: 502 },
    );
  }

  const json = (await upstream.json()) as { audio_data?: string };
  if (!json.audio_data) {
    return Response.json({ error: "Mistral returned no audio_data." }, { status: 502 });
  }
  const bytes = Buffer.from(json.audio_data, "base64");
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
