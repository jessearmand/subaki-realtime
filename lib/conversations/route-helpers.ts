// Shared request handling for the /api/conversations routes: key check, body
// parsing and error mapping. Server-only.

import { ConversationError } from "@/lib/memory/elevenlabs-conversation";
import { isMemoryUserId } from "@/lib/memory/ids";

export function fail(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export type ParsedRequest =
  | { ok: true; apiKey: string; userId: string; body: Record<string, unknown> }
  | { ok: false; response: Response };

/** Validate the ElevenLabs key and the visitor id every history request carries. */
export async function parseHistoryRequest(req: Request): Promise<ParsedRequest> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { ok: false, response: fail("ELEVENLABS_API_KEY is not set on the server.", 503) };
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
  return { ok: true, apiKey, userId: body.userId, body };
}

/** Map an upstream failure to a response, keeping 4xx/5xx statuses and defaulting to 502. */
export function upstreamFailure(err: unknown): Response {
  const status = err instanceof ConversationError ? err.status : 502;
  const message = err instanceof Error ? err.message : "network error";
  return fail(message, status >= 400 && status < 600 ? status : 502);
}
