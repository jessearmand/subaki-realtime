// Server-only mem0 Platform REST helpers (v3), used by app/api/memory/*.
//
// Plain fetch instead of the mem0ai SDK, matching the other provider routes.
// Memory is scoped by user_id only: mem0 stores entities separately, so an AND
// of user_id + agent_id returns nothing. Persona, language and source live in
// metadata instead, which also keeps one memory shared by all seven aspects.

const MEM0_BASE = "https://api.mem0.ai";

export interface Mem0Message {
  role: "user" | "assistant";
  content: string;
}

export interface Mem0Memory {
  id: string;
  memory: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export class Mem0Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function mem0ApiKey(): string | undefined {
  return process.env.MEM0_API_KEY || undefined;
}

async function mem0Post<T>(apiKey: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(MEM0_BASE + path, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Mem0Error(`mem0 ${path} failed: ${text.slice(0, 300)}`, res.status);
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Queue a conversation for fact extraction. mem0 processes it asynchronously.
 * `timestamp` (Unix seconds) dates the memories to when the call happened rather
 * than when ingest ran, which is when mem0 would otherwise anchor "this Friday".
 */
export async function addMemories(
  apiKey: string,
  userId: string,
  messages: Mem0Message[],
  metadata: Record<string, string>,
  timestamp?: number,
): Promise<{ event_id?: string; status?: string }> {
  return mem0Post(apiKey, "/v3/memories/add/", {
    user_id: userId,
    messages,
    metadata,
    ...(timestamp ? { timestamp } : {}),
  });
}

// mem0 doesn't document get-all ordering, so the newest memories can sit on any
// page. Read every page (while mem0 reports a `next`), then sort locally. The cap
// bounds recall latency for a very long-lived visitor at 1,000 memories.
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 10;

interface Mem0Page {
  results?: Mem0Memory[];
  next?: string | null;
}

/** The user's most recently updated memories, newest first. */
export async function listRecentMemories(
  apiKey: string,
  userId: string,
  limit: number,
): Promise<Mem0Memory[]> {
  const all: Mem0Memory[] = [];
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const res = await mem0Post<Mem0Page>(
      apiKey,
      `/v3/memories/?page=${page}&page_size=${LIST_PAGE_SIZE}`,
      { filters: { user_id: userId } },
    );
    all.push(...(res.results ?? []));
    if (!res.next || !res.results?.length) break;
  }
  const stamp = (m: Mem0Memory) => Date.parse(m.updated_at ?? m.created_at ?? "") || 0;
  return all.sort((a, b) => stamp(b) - stamp(a)).slice(0, limit);
}
