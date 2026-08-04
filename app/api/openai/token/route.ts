// Mints a short-lived OpenAI realtime ephemeral key (client secret) server-side
// so the browser can open a WebRTC session WITHOUT ever seeing OPENAI_API_KEY.
//
// Flow: client POSTs here → we call OpenAI with the secret key → return the
// ephemeral key JSON. The browser then negotiates WebRTC directly with OpenAI:
//   POST https://api.openai.com/v1/realtime/calls
//     Authorization: Bearer <ephemeral key>, Content-Type: application/sdp
// Full per-persona config is applied client-side via `session.update`, so the
// mint body stays minimal here. The model id comes from
// `config/realtime-models.json` (via realtime-model-config), the same source
// the client's `session.update` uses — so mint scope and session config can't
// silently disagree.
//
// Dev only: OPENAI_API_KEY is provided via fnox (`fnox exec -- bun run dev`).

import { OPENAI_REALTIME_MODEL } from "@/lib/realtime/realtime-model-config";

export const runtime = "nodejs";
// Never cache a freshly-minted secret.
export const dynamic = "force-dynamic";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

export async function POST(): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Do not echo any key material; just say it's unset.
    return Response.json(
      { error: "OPENAI_API_KEY is not set on the server (provide it via fnox)." },
      { status: 500 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session: { type: "realtime", model: OPENAI_REALTIME_MODEL } }),
    });
  } catch (err) {
    return Response.json(
      { error: `Failed to reach OpenAI: ${err instanceof Error ? err.message : "network error"}` },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    // Surface OpenAI's status + body (it doesn't contain our key) for debugging.
    return Response.json(
      { error: "OpenAI client_secrets request failed", status: upstream.status, detail: text },
      { status: 502 },
    );
  }

  // Pass the key JSON straight through; the client extracts the value defensively.
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
