// Conversation history shapes shared by the /api/conversations routes and the
// browser. Two transports store calls: ElevenLabs (on its platform) and OPENAI
// LIVE (on our Archil disk, lib/conversations/live-store.ts). Both map to these
// shapes, already resolved to our personas and languages.

import type { Lang } from "@/lib/lang";

/** Where a stored call lives, which is also the transport that can continue it. */
export type HistorySource = "elevenlabs" | "openai-live";

export interface ConversationSummary {
  id: string;
  source: HistorySource;
  /** Our persona id, or undefined when the agent isn't one of the mapped personas. */
  personaId?: string;
  lang: Lang;
  /** Generated title; an OPENAI LIVE call not yet titled shows its opening line. May be empty. */
  title: string;
  /** Generated summary: ElevenLabs' (either language) or ours in the call's language. May be empty. */
  summary: string;
  /** Unix seconds. */
  startedAt: number;
  durationSecs: number;
  /** Spoken turns from both sides. */
  messageCount: number;
}

export interface ConversationTurn {
  who: "user" | "agent";
  text: string;
}

export interface ConversationDetail extends ConversationSummary {
  transcript: ConversationTurn[];
}

export interface ConversationPage {
  items: ConversationSummary[];
  /** Pass back to load the next page; null on the last page. */
  nextCursor: string | null;
}
