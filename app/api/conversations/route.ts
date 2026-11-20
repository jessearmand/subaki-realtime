// Conversation history: the visitor's stored calls, newest first, from
// ElevenLabs and from OPENAI LIVE (Archil) merged into one list.
//
// POST { userId, cursor? } → { items, nextCursor }. POST rather than GET keeps
// the visitor id out of URLs and logs. Dev only: ELEVENLABS_API_KEY and
// ARCHIL_API_KEY from fnox; either one alone lists its own calls.

import { listHistory } from "@/lib/conversations/history";
import { fail, parseHistoryRequest, upstreamFailure } from "@/lib/conversations/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const parsed = await parseHistoryRequest(req);
  if (!parsed.ok) return parsed.response;
  const { cursor } = parsed.body;
  if (cursor !== undefined && typeof cursor !== "string") return fail("cursor is malformed.", 400);
  try {
    return Response.json(await listHistory(parsed.sources, parsed.userId, cursor));
  } catch (err) {
    return upstreamFailure(err);
  }
}
