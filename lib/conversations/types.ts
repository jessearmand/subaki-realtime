// Conversation history shapes shared by the /api/conversations routes and the
// browser. Only ElevenLabs stores calls today, so these mirror what its
// conversation API can tell us, already mapped to our personas and languages.

import type { Lang } from "@/lib/lang";

export interface ConversationSummary {
  id: string;
  /** Our persona id, or undefined when the agent isn't one of the mapped personas. */
  personaId?: string;
  lang: Lang;
  /** ElevenLabs' generated title; may be empty for very short calls. */
  title: string;
  /** ElevenLabs' generated summary; may be in either language. */
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
