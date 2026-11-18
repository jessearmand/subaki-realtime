// Browser calls to the conversation history routes. Unlike memory recall these
// are user-initiated reads, so failures surface (as HistoryError) instead of
// being swallowed.

import type { ConversationDetail, ConversationPage } from "./types";

export class HistoryError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 for a network failure. 503 means the server has no ElevenLabs key. */
    readonly status: number,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new HistoryError("network error", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new HistoryError(data.error ?? `HTTP ${res.status}`, res.status);
  return data as T;
}

export function fetchConversationPage(
  userId: string,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<ConversationPage> {
  return post("/api/conversations", { userId, ...(cursor ? { cursor } : {}) }, signal);
}

export function fetchConversationDetail(
  userId: string,
  id: string,
  signal?: AbortSignal,
): Promise<ConversationDetail> {
  return post(`/api/conversations/${encodeURIComponent(id)}`, { userId }, signal);
}
