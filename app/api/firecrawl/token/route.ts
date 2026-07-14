// Hands the browser a currently-valid Firecrawl MCP access token (refreshing
// server-side if needed) for use as the `authorization` field of the OpenAI
// Realtime `mcp` tool config.
//
// Exposing this token to the client is the intended OAuth trade: it is
// short-lived (~1h), scoped, and revocable — unlike the raw fc- API key,
// which never leaves the server (and in this setup never exists at all).
// 409 means the one-time browser consent flow hasn't been completed yet.

import { getValidAccessToken } from "@/lib/firecrawl/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const token = await getValidAccessToken();
  if (!token) {
    return Response.json(
      {
        error: "Firecrawl is not connected — open /api/firecrawl/oauth/start to authorize.",
        connectUrl: "/api/firecrawl/oauth/start",
      },
      { status: 409 },
    );
  }
  return Response.json({ authorization: token }, { headers: { "Cache-Control": "no-store" } });
}
