// Firecrawl OAuth redirect target: validates state, exchanges the code for
// tokens (PKCE), persists them server-side, and bounces back to the console.
// Errors render as plain text — this is a dev-only flow.

import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/firecrawl/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PENDING_COOKIE = "fc_oauth_pending";

function fail(message: string): Response {
  return new Response(`Firecrawl OAuth failed: ${message}`, {
    status: 400,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const oauthError = params.get("error");
  if (oauthError) {
    return fail(`${oauthError}: ${params.get("error_description") ?? "no description"}`);
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return fail("missing code or state in the callback URL");

  const raw = request.cookies.get(PENDING_COOKIE)?.value;
  if (!raw) return fail("no pending OAuth attempt (cookie expired?) — start over");
  let pending: { state?: string; verifier?: string; redirectUri?: string; clientId?: string };
  try {
    pending = JSON.parse(raw);
  } catch {
    return fail("corrupt pending-OAuth cookie — start over");
  }
  if (pending.state !== state) return fail("state mismatch — start over");
  if (!pending.verifier || !pending.redirectUri || !pending.clientId) {
    return fail("incomplete pending-OAuth cookie — start over");
  }

  try {
    await exchangeCode({
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
      clientId: pending.clientId,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "token exchange failed");
  }

  const res = NextResponse.redirect(new URL("/?firecrawl=connected", request.nextUrl.origin));
  res.cookies.delete(PENDING_COOKIE);
  return res;
}
