// Mints a short-lived Gemini Live ephemeral auth token server-side so the
// browser can open a WebSocket to Google WITHOUT ever seeing GEMINI_API_KEY.
//
// Flow: client POSTs here → we call the v1alpha auth-token service via
// @google/genai → return { token }. The browser then connects with
//   wss://…/v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=<token>
//
// Unlike the xAI/OpenAI mint routes (plain fetch), Google documents no raw REST
// endpoint for token creation — only the SDK — so this route uses @google/genai.
// The token is UNCONSTRAINED (no liveConnectConstraints): persona config stays
// client-side in lib/realtime/gemini-agent.ts, mirroring the xAI engine.
//
// Dev only: GEMINI_API_KEY is provided via fnox (`fnox exec -- bun run dev`).

import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
// Never cache a freshly-minted token.
export const dynamic = "force-dynamic";

// Single-use token: one CALL press = one mint = one Live session.
const TOKEN_TTL_MINUTES = 30;
const NEW_SESSION_WINDOW_MINUTES = 1;

export async function POST(): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Do not echo any key material; just say it's unset.
    return Response.json(
      { error: "GEMINI_API_KEY is not set on the server (provide it via fnox)." },
      { status: 500 },
    );
  }

  // Ephemeral tokens are v1alpha-only (SDK: "Support in v1alpha only").
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const now = Date.now();

  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + TOKEN_TTL_MINUTES * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MINUTES * 60_000).toISOString(),
      },
    });
    if (!token.name) {
      return Response.json({ error: "Gemini returned a token without a name." }, { status: 502 });
    }
    return Response.json({ token: token.name }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      {
        error: `Gemini auth-token mint failed: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 502 },
    );
  }
}
