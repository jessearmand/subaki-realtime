// Server-only: feed a finished OPENAI LIVE call into mem0.
//
// The turns come from the server's own sideband capture (live-capture.ts), not
// from the browser, and the record was created for this visitor when the
// session was. Same metadata shape as the ElevenLabs ingest route.

import type { LiveCallRecord } from "@/lib/conversations/live-store";
import { addMemories, mem0ApiKey, type Mem0Message } from "./mem0-rest";

export async function ingestLiveCall(record: LiveCallRecord): Promise<void> {
  const apiKey = mem0ApiKey();
  if (!apiKey || !record.memory) return;
  const messages: Mem0Message[] = record.turns.map((t) => ({
    role: t.who === "user" ? "user" : "assistant",
    content: t.text,
  }));
  if (!messages.some((m) => m.role === "user")) return;
  await addMemories(
    apiKey,
    record.userId,
    messages,
    {
      source: "openai-live",
      conversation_id: record.id,
      persona: record.personaId,
      lang: record.lang,
    },
    record.startedAt,
  );
}
