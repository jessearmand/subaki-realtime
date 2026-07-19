// Isomorphic Firecrawl constants — importable from BOTH the client graph
// (openai-agent.ts, bundled into the browser) and server-only modules
// (lib/firecrawl/oauth.ts, which pulls in node:fs/node:crypto and must never
// reach a client bundle). Keep this file free of any imports.

/**
 * Firecrawl's keyless MCP endpoint. Single source of truth for two values that
 * MUST stay identical: the RFC 8707 `resource` the OAuth token is scoped to
 * (oauth.ts) and the `server_url` that token is presented to in the Realtime
 * MCP tool config (openai-agent.ts). If they drifted, the session would offer
 * a token whose audience doesn't match the server — a failure TypeScript
 * can't catch since both are plain strings.
 */
export const FIRECRAWL_MCP_URL = "https://mcp.firecrawl.dev/v2/mcp";
