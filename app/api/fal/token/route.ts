// Mints a short-lived fal.ai realtime JWT server-side so the browser can open
// a WebSocket to fal WITHOUT ever seeing FAL_API_KEY.
//
// Flow: client POSTs here → we call fal's token API with the secret key →
// return the JWT. The browser then connects with
//   new WebSocket("wss://fal.run/fal-ai/personaplex/realtime?fal_jwt_token=" + jwt)
//
// The current token API (fal.ai/docs/model-apis/real-time) takes a SINGULAR
// owner-prefixed `app` path + `duration` — not the legacy alpha endpoint's
// `allowed_apps` alias array. (The docs' own example shows `allowed_apps`, but
// the live endpoint 422s on it: "Field required: app".)
// Dev only: FAL_API_KEY is provided via fnox (`fnox exec -- bun run dev`).

export const runtime = "nodejs";
// Never cache a freshly-minted token.
export const dynamic = "force-dynamic";

const TOKENS_URL = "https://rest.fal.ai/tokens/realtime";
const TOKEN_TTL_SECONDS = 300;
const APP = "fal-ai/personaplex/realtime";

export async function POST(): Promise<Response> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    // Do not echo any key material; just say it's unset.
    return Response.json(
      { error: "FAL_API_KEY is not set on the server (provide it via fnox)." },
      { status: 500 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(TOKENS_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app: APP,
        duration: TOKEN_TTL_SECONDS,
      }),
    });
  } catch (err) {
    return Response.json(
      {
        error: `Failed to reach fal: ${err instanceof Error ? err.message : "network error"}`,
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    // Surface fal's status + body (it doesn't contain our key) for debugging.
    return Response.json(
      {
        error: "fal token request failed",
        status: upstream.status,
        detail: text,
      },
      { status: 502 },
    );
  }

  // The live endpoint returns the JWT as a bare JSON string ("ey…"), though the
  // docs show { token }; normalize either shape to { token }.
  let token = text.trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") token = parsed;
    else if (parsed && typeof parsed === "object") {
      const d = parsed as Record<string, unknown>;
      if (typeof d.token === "string") token = d.token;
      else if (typeof d.detail === "string") token = d.detail;
    }
  } catch {
    // Not JSON — treat the raw body as the token.
  }

  return Response.json({ token }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
