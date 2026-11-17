// One stored call with its transcript, for reading back or resuming.
//
// POST { userId } → ConversationDetail. A call that isn't the visitor's answers
// 404, the same as a missing one.

import { getConversation } from "@/lib/conversations/elevenlabs-history";
import { fail, parseHistoryRequest, upstreamFailure } from "@/lib/conversations/route-helpers";
import { isConversationId } from "@/lib/memory/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isConversationId(id)) return fail("conversation id is malformed.", 400);
  const parsed = await parseHistoryRequest(req);
  if (!parsed.ok) return parsed.response;
  try {
    return Response.json(await getConversation(parsed.apiKey, parsed.userId, id));
  } catch (err) {
    return upstreamFailure(err);
  }
}
