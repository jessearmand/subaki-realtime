// Server-only: a visitor's stored ElevenLabs calls, mapped to history shapes.
//
// Every ElevenLabs session starts with the visitor's opaque memory id as its
// `userId`, and ElevenLabs records it on the conversation. The list filters on
// it upstream; the detail fetch checks it before returning a transcript.

import type { Lang } from "@/lib/lang";
import { agentPersona } from "@/lib/realtime/elevenlabs-agent";
import {
  ConversationError,
  fetchConversation,
  type StoredConversation,
  type TranscriptTurn,
} from "@/lib/memory/elevenlabs-conversation";
import type {
  ConversationDetail,
  ConversationPage,
  ConversationSummary,
  ConversationTurn,
} from "./types";

const CONVERSATIONS_URL = "https://api.elevenlabs.io/v1/convai/conversations";
const PAGE_SIZE = 30;
// Calls where the visitor never spoke are filtered out after fetching. A page
// made only of those would read as "no calls" with nothing to load more from,
// so keep paging until a page yields something, up to this bound.
const MAX_PAGES_PER_REQUEST = 5;
// Still running or not yet analysed: nothing worth reading back or resuming.
const UNFINISHED = ["initiated", "in-progress", "processing"];

/** One row of GET /v1/convai/conversations (summary_mode=include). */
interface ListedConversation {
  conversation_id: string;
  agent_id?: string;
  start_time_unix_secs?: number;
  call_duration_secs?: number;
  message_count?: number;
  user_message_count?: number;
  status?: string;
  transcript_summary?: string | null;
  call_summary_title?: string | null;
  main_language?: string | null;
}

interface ListResponse {
  conversations?: ListedConversation[];
  next_cursor?: string | null;
  has_more?: boolean;
}

function toLang(agentLang: Lang | undefined, mainLanguage?: string | null): Lang {
  if (agentLang) return agentLang;
  return mainLanguage === "ja" ? "ja" : "en";
}

// Expressive TTS directions such as "[softly]" open many agent lines. They are
// stage directions for the voice, not words, so history drops them.
const TTS_TAG_RE = /\[[^\]\n]{1,40}\]\s*/g;

function toTurns(transcript: TranscriptTurn[] | undefined): ConversationTurn[] {
  const out: ConversationTurn[] = [];
  for (const turn of transcript ?? []) {
    if (turn.role !== "user" && turn.role !== "agent") continue;
    const raw = turn.message?.trim() ?? "";
    const text = turn.role === "agent" ? raw.replace(TTS_TAG_RE, "").trim() : raw;
    if (text) out.push({ who: turn.role, text });
  }
  return out;
}

function summarize(row: ListedConversation): ConversationSummary {
  const mapped = row.agent_id ? agentPersona(row.agent_id) : undefined;
  return {
    id: row.conversation_id,
    source: "elevenlabs",
    personaId: mapped?.personaId,
    lang: toLang(mapped?.lang, row.main_language),
    title: row.call_summary_title?.trim() ?? "",
    summary: row.transcript_summary?.trim() ?? "",
    startedAt: row.start_time_unix_secs ?? 0,
    durationSecs: row.call_duration_secs ?? 0,
    messageCount: row.message_count ?? 0,
  };
}

async function fetchPage(apiKey: string, userId: string, cursor?: string): Promise<ListResponse> {
  const url = new URL(CONVERSATIONS_URL);
  url.searchParams.set("user_id", userId);
  url.searchParams.set("summary_mode", "include");
  url.searchParams.set("page_size", String(PAGE_SIZE));
  for (const s of UNFINISHED) url.searchParams.append("exclude_statuses", s);
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, { headers: { "xi-api-key": apiKey }, cache: "no-store" });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new ConversationError(`ElevenLabs conversation list: ${detail}`, res.status);
  }
  return (await res.json()) as ListResponse;
}

/** The visitor's finished calls, newest first. Calls where they never spoke are left out. */
export async function listConversations(
  apiKey: string,
  userId: string,
  cursor?: string,
): Promise<ConversationPage> {
  const items: ConversationSummary[] = [];
  let next: string | null = cursor ?? null;
  for (let page = 0; page < MAX_PAGES_PER_REQUEST; page++) {
    const data = await fetchPage(apiKey, userId, next ?? undefined);
    for (const c of data.conversations ?? []) {
      if ((c.user_message_count ?? 0) > 0) items.push(summarize(c));
    }
    next = data.has_more ? (data.next_cursor ?? null) : null;
    if (items.length > 0 || !next) break;
  }
  return { items, nextCursor: next };
}

function detailOf(conv: StoredConversation): ConversationDetail {
  const transcript = toTurns(conv.transcript);
  return {
    ...summarize({
      conversation_id: conv.conversation_id,
      agent_id: conv.agent_id,
      start_time_unix_secs: conv.metadata?.start_time_unix_secs,
      call_duration_secs: conv.metadata?.call_duration_secs,
      message_count: transcript.length,
      transcript_summary: conv.analysis?.transcript_summary,
      call_summary_title: conv.analysis?.call_summary_title,
      main_language: conv.metadata?.main_language,
    }),
    transcript,
  };
}

/** One call with its transcript. Throws 404 for a missing call or one that isn't the visitor's. */
export async function getConversation(
  apiKey: string,
  userId: string,
  id: string,
): Promise<ConversationDetail> {
  const conv = await fetchConversation(apiKey, id);
  // Someone else's call answers exactly like a missing one, so ids can't be probed.
  if (!conv || conv.user_id !== userId) {
    throw new ConversationError(`conversation ${id} not found`, 404);
  }
  return detailOf(conv);
}
