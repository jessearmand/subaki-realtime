// Conversation history: the visitor's finished ElevenLabs calls, newest first.
//
// POST { userId, cursor? } → { items, nextCursor }. POST rather than GET keeps
// the visitor id out of URLs and logs. Dev only: ELEVENLABS_API_KEY from fnox.

import { listConversations } from "@/lib/conversations/elevenlabs-history";
import { fail, parseHistoryRequest, upstreamFailure } from "@/lib/conversations/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ElevenLabs cursors are opaque tokens; bound them so nothing odd reaches the URL.
const CURSOR_RE = /^[A-Za-z0-9_\-=.]{1,512}$/;

export async function POST(req: Request): Promise<Response> {
  const parsed = await parseHistoryRequest(req);
  if (!parsed.ok) return parsed.response;
  const { cursor } = parsed.body;
  if (cursor !== undefined && (typeof cursor !== "string" || !CURSOR_RE.test(cursor))) {
    return fail("cursor is malformed.", 400);
  }
  try {
    return Response.json(await listConversations(parsed.apiKey, parsed.userId, cursor));
  } catch (err) {
    return upstreamFailure(err);
  }
}
