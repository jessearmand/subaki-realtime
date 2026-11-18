// Server-only: read a finished ElevenLabs conversation and turn it into mem0 input.
//
// ElevenLabs already stores every call. After hangup the conversation sits in
// "processing" for a while before its status becomes "done", so the ingest
// route polls until the call is final rather than trusting the browser's copy
// of the transcript.

import type { Mem0Message } from "./mem0-rest";

const CONVERSATIONS_URL = "https://api.elevenlabs.io/v1/convai/conversations";
const FINAL_STATUSES = new Set(["done", "failed"]);
const POLL_INTERVAL_MS = 3000;
const POLL_DEADLINE_MS = 90_000;

export interface TranscriptTurn {
  role?: string;
  message?: string | null;
}

export interface StoredConversation {
  conversation_id: string;
  agent_id?: string;
  agent_name?: string;
  status?: string;
  user_id?: string | null;
  transcript?: TranscriptTurn[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    main_language?: string | null;
  } | null;
  analysis?: { transcript_summary?: string | null; call_summary_title?: string | null } | null;
}

export class ConversationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The stored conversation, or null while ElevenLabs hasn't created the record yet. */
export async function fetchConversation(
  apiKey: string,
  id: string,
): Promise<StoredConversation | null> {
  const res = await fetch(`${CONVERSATIONS_URL}/${id}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new ConversationError(`ElevenLabs conversation ${id}: ${detail}`, res.status);
  }
  return (await res.json()) as StoredConversation;
}

/** Poll until the conversation reaches a final status, or give up at the deadline. */
export async function fetchFinishedConversation(
  apiKey: string,
  id: string,
): Promise<StoredConversation> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  for (;;) {
    const conv = await fetchConversation(apiKey, id);
    if (conv && FINAL_STATUSES.has(conv.status ?? "")) return conv;
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      const state = conv ? `still "${conv.status}"` : "not found";
      throw new ConversationError(`conversation ${id} ${state} after polling`, 504);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/** Spoken turns only, in mem0's role vocabulary. Tool and system turns are dropped. */
export function toMem0Messages(conv: StoredConversation): Mem0Message[] {
  const out: Mem0Message[] = [];
  for (const turn of conv.transcript ?? []) {
    const content = turn.message?.trim();
    if (!content) continue;
    if (turn.role === "user") out.push({ role: "user", content });
    else if (turn.role === "agent") out.push({ role: "assistant", content });
  }
  return out;
}
