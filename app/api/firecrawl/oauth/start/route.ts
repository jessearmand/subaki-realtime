// Kicks off the Firecrawl MCP OAuth flow (visit this URL in the browser once).
//
// Registers a public client for this dev origin (RFC 7591, cached), stashes
// the PKCE verifier + state in a short-lived httpOnly cookie, and redirects
// to Firecrawl's consent page. The browser comes back to ../callback.

import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizeUrl, createPkce, createState, ensureClient } from "@/lib/firecrawl/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Must match the callback route (route files can't export shared constants).
const PENDING_COOKIE = "fc_oauth_pending";

export async function GET(request: NextRequest): Promise<Response> {
  const redirectUri = new URL("/api/firecrawl/oauth/callback", request.nextUrl.origin).toString();

  let clientId: string;
  try {
    clientId = await ensureClient(redirectUri);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Firecrawl client registration failed" },
      { status: 502 },
    );
  }

  const { verifier, challenge } = createPkce();
  const state = createState();

  const res = NextResponse.redirect(buildAuthorizeUrl({ clientId, redirectUri, state, challenge }));
  // Lax so the cookie rides the top-level redirect back from firecrawl.dev.
  res.cookies.set(PENDING_COOKIE, JSON.stringify({ state, verifier, redirectUri, clientId }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/firecrawl/oauth",
    maxAge: 600,
  });
  return res;
}
