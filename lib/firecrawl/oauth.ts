// Firecrawl MCP OAuth client — server-side only (imported by API routes).
//
// Implements the app side of Firecrawl's keyless MCP endpoint
// (https://mcp.firecrawl.dev/v2/mcp): OAuth 2.0 Authorization Code + PKCE
// (S256) with RFC 7591 Dynamic Client Registration and RFC 8707 resource
// indicators, per docs.firecrawl.dev/developer-guides/mcp-setup-guides/oauth.
//
// Why this lives on our server: the OpenAI Realtime API is the MCP *client*
// that executes tool calls — it only needs a bearer token in the session's
// tool config. This module owns obtaining and refreshing that token. The
// browser only ever sees the short-lived scoped access token, never a raw
// `fc-` API key — which is the point of the OAuth path.
//
// The registered client id and tokens persist in `.firecrawl/oauth.json`
// (gitignored). Access tokens expire after ~1h; refresh tokens rotate on
// every use, so the store is rewritten on each refresh. Dev only — no
// production yet, same as the rest of the secrets story.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

const AUTHORIZATION_ENDPOINT = "https://www.firecrawl.dev/api/oauth/authorize";
const TOKEN_ENDPOINT = "https://www.firecrawl.dev/api/oauth/token";
const REGISTRATION_ENDPOINT = "https://www.firecrawl.dev/api/oauth/register";
const SCOPE = "firecrawl:global";

/** Keyless MCP endpoint — both the RFC 8707 resource and the Realtime tool's server_url. */
export const FIRECRAWL_MCP_URL = "https://mcp.firecrawl.dev/v2/mcp";

const STORE_PATH = join(process.cwd(), ".firecrawl", "oauth.json");
/** Refresh this many ms before the recorded expiry to absorb clock skew. */
const EXPIRY_SLACK_MS = 60_000;

interface StoredClient {
  client_id: string;
  redirect_uri: string;
}

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  /** Absolute epoch ms when access_token expires. */
  expires_at: number;
}

interface OauthStore {
  client?: StoredClient;
  tokens?: StoredTokens;
}

function loadStore(): OauthStore {
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as OauthStore;
  } catch {
    return {};
  }
}

function saveStore(store: OauthStore): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** RFC 7636 PKCE pair; Firecrawl supports S256 only. */
export function createPkce(): Pkce {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createState(): string {
  return base64url(randomBytes(16));
}

/**
 * Dynamic Client Registration (RFC 7591). Firecrawl issues public clients
 * (`token_endpoint_auth_method: "none"`), so there is no secret to keep.
 * The client_id is cached in the store and reused while the redirect_uri
 * (derived from the dev server origin) stays the same.
 */
export async function ensureClient(redirectUri: string): Promise<string> {
  const store = loadStore();
  if (store.client && store.client.redirect_uri === redirectUri) {
    return store.client.client_id;
  }
  const res = await fetch(REGISTRATION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Tsubaki realtime voice console (dev)",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`Firecrawl client registration failed (${res.status})`);
  }
  const data = (await res.json()) as { client_id?: string };
  if (!data.client_id) throw new Error("Firecrawl registration returned no client_id");
  saveStore({ ...store, client: { client_id: data.client_id, redirect_uri: redirectUri } });
  return data.client_id;
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // RFC 8707: bind the token to the MCP endpoint specifically.
  url.searchParams.set("resource", FIRECRAWL_MCP_URL);
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function requestTokens(body: URLSearchParams): Promise<StoredTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Firecrawl token request failed (${res.status})`);
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error("Firecrawl token response had no access_token");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

/** Authorization-code exchange; persists the resulting tokens. */
export async function exchangeCode(params: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<void> {
  const tokens = await requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.verifier,
      resource: FIRECRAWL_MCP_URL,
    }),
  );
  saveStore({ ...loadStore(), tokens });
}

/**
 * Returns a currently-valid access token, refreshing (and persisting the
 * rotated refresh token) when the stored one is expired or about to expire.
 * Returns null when the user hasn't completed the OAuth flow yet.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const store = loadStore();
  const tokens = store.tokens;
  if (!tokens) return null;
  if (tokens.expires_at - EXPIRY_SLACK_MS > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token || !store.client) return null;
  try {
    const next = await requestTokens(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: store.client.client_id,
        resource: FIRECRAWL_MCP_URL,
      }),
    );
    // Rotating refresh tokens: keep the old one only if none was returned.
    saveStore({
      ...store,
      tokens: { ...next, refresh_token: next.refresh_token ?? tokens.refresh_token },
    });
    return next.access_token;
  } catch {
    return null;
  }
}
