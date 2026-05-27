// Mints a short-lived xAI realtime client-secret (ephemeral token) server-side
// so the browser can open a WebSocket to xAI WITHOUT ever seeing XAI_API_KEY.
//
// Flow: client POSTs here → we call xAI with the secret key → return the
// ephemeral token JSON. The browser then connects with
//   new WebSocket(".../v1/realtime?model=…", ["xai-client-secret." + token]).
//
// Dev only: XAI_API_KEY is provided via fnox (`fnox exec -- bun run dev`).

export const runtime = "nodejs";
// Never cache a freshly-minted secret.
export const dynamic = "force-dynamic";

const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";
const TOKEN_TTL_SECONDS = 300;

export async function POST(): Promise<Response> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    // Do not echo any key material; just say it's unset.
    return Response.json(
      { error: "XAI_API_KEY is not set on the server (provide it via fnox)." },
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
      body: JSON.stringify({ expires_after: { seconds: TOKEN_TTL_SECONDS } }),
    });
  } catch (err) {
    return Response.json(
      { error: `Failed to reach xAI: ${err instanceof Error ? err.message : "network error"}` },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    // Surface xAI's status + body (it doesn't contain our key) for debugging.
    return Response.json(
      { error: "xAI client_secrets request failed", status: upstream.status, detail: text },
      { status: 502 },
    );
  }

  // Pass the token JSON straight through; the client extracts the value defensively.
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
