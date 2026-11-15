// Post-call ingest: feed a finished ElevenLabs conversation into mem0.
//
// The browser posts the conversation id it captured at connect. The transcript
// itself comes from ElevenLabs (already stored there), not from the browser,
// and the call must belong to the posting visitor: the session is started with
// that `userId`, and ElevenLabs records it on the conversation.
//
// Ingest runs at most once per conversation in this server process; mem0 also
// merges facts it has already extracted, so a repeat after a restart is harmless.
//
// Dev only: MEM0_API_KEY and ELEVENLABS_API_KEY come from fnox.

import {
  ConversationError,
  fetchFinishedConversation,
  toMem0Messages,
} from "@/lib/memory/elevenlabs-conversation";
import { isConversationId, isMemoryUserId } from "@/lib/memory/ids";
import { Mem0Error, addMemories, mem0ApiKey } from "@/lib/memory/mem0-rest";
import { LANGS, type Lang } from "@/lib/lang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERSONA_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const ingested = new Set<string>();

interface IngestRequest {
  userId?: unknown;
  conversationId?: unknown;
  persona?: unknown;
  lang?: unknown;
}

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export async function POST(req: Request): Promise<Response> {
  const mem0Key = mem0ApiKey();
  if (!mem0Key) return fail("MEM0_API_KEY is not set on the server.", 503);
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey) return fail("ELEVENLABS_API_KEY is not set on the server.", 503);

  let body: IngestRequest;
  try {
    body = (await req.json()) as IngestRequest;
  } catch {
    return fail("Invalid JSON body.", 400);
  }
  const { userId, conversationId, persona, lang } = body;
  if (!isMemoryUserId(userId)) return fail("userId is missing or malformed.", 400);
  if (!isConversationId(conversationId)) return fail("conversationId is malformed.", 400);
  const personaId = typeof persona === "string" && PERSONA_ID_RE.test(persona) ? persona : "";
  const sessionLang: Lang = LANGS.includes(lang as Lang) ? (lang as Lang) : "en";

  if (ingested.has(conversationId)) return Response.json({ status: "duplicate" });
  ingested.add(conversationId);

  try {
    const conv = await fetchFinishedConversation(elevenKey, conversationId);
    if (conv.user_id !== userId) {
      return fail("conversation does not belong to this visitor.", 403);
    }
    const messages = toMem0Messages(conv);
    if (!messages.some((m) => m.role === "user")) {
      return Response.json({ status: "skipped", reason: "no user turns" });
    }
    const event = await addMemories(
      mem0Key,
      userId,
      messages,
      {
        source: "elevenlabs",
        conversation_id: conversationId,
        agent: conv.agent_name ?? "",
        persona: personaId,
        lang: sessionLang,
      },
      conv.metadata?.start_time_unix_secs,
    );
    return Response.json({ status: "queued", turns: messages.length, event_id: event.event_id });
  } catch (err) {
    // Let a later attempt retry a call that failed upstream.
    ingested.delete(conversationId);
    const status = err instanceof ConversationError || err instanceof Mem0Error ? err.status : 502;
    const message = err instanceof Error ? err.message : "network error";
    return fail(message, status >= 400 && status < 600 ? status : 502);
  }
}
