// Shared request handling for the /api/conversations routes: which stores are
// configured, body parsing and error mapping. Server-only.

import { ConversationError } from "@/lib/memory/elevenlabs-conversation";
import { isMemoryUserId } from "@/lib/memory/ids";
import { archilConfigured } from "@/lib/storage/archil";
import { CursorError, type HistorySources } from "./history";

export function fail(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export type ParsedRequest =
  | { ok: true; sources: HistorySources; userId: string; body: Record<string, unknown> }
  | { ok: false; response: Response };

/** Check that some store is configured, and validate the visitor id every history request carries. */
export async function parseHistoryRequest(req: Request): Promise<ParsedRequest> {
  const sources: HistorySources = {
    elevenLabsKey: process.env.ELEVENLABS_API_KEY || undefined,
    liveStore: archilConfigured(),
  };
  if (!sources.elevenLabsKey && !sources.liveStore) {
    return {
      ok: false,
      response: fail("History needs ELEVENLABS_API_KEY or ARCHIL_API_KEY on the server.", 503),
    };
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, response: fail("Invalid JSON body.", 400) };
  }
  if (!isMemoryUserId(body.userId)) {
    return { ok: false, response: fail("userId is missing or malformed.", 400) };
  }
  return { ok: true, sources, userId: body.userId, body };
}

/** Map an upstream failure to a response, keeping 4xx/5xx statuses and defaulting to 502. */
export function upstreamFailure(err: unknown): Response {
  if (err instanceof CursorError) return fail(err.message, 400);
  const status = err instanceof ConversationError ? err.status : 502;
  const message = err instanceof Error ? err.message : "network error";
  return fail(message, status >= 400 && status < 600 ? status : 502);
}
