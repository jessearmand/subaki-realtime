// Browser calls to the memory routes. Neither may ever break or delay a call:
// recall resolves to [] on any failure or timeout, and ingest is fire-and-forget.

import type { Lang } from "@/lib/lang";

const RECALL_TIMEOUT_MS = 5000;

export async function recallMemories(userId: string): Promise<string[]> {
  try {
    const res = await fetch("/api/memory/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(RECALL_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { memories?: unknown };
    return Array.isArray(data.memories)
      ? data.memories.filter((m): m is string => typeof m === "string" && m.length > 0)
      : [];
  } catch {
    return [];
  }
}

export interface IngestTarget {
  userId: string;
  conversationId: string;
  persona?: string;
  lang: Lang;
}

export function ingestConversation(target: IngestTarget): void {
  // keepalive lets the request outlive a tab close right after hangup.
  void fetch("/api/memory/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target),
    keepalive: true,
  }).catch(() => {
    // Memory is best-effort; a lost ingest only means one call isn't remembered.
  });
}
