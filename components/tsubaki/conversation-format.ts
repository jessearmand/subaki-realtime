// Display helpers shared by the conversation list and detail panes.

import { PERSONAS, resolvePersona } from "@/lib/data";
import type { HistorySource } from "@/lib/conversations/types";
import type { Lang } from "@/lib/lang";

/** Where a call is stored, by its transport's name (an identifier, never translated). */
export const SOURCE_LABEL: Record<HistorySource, string> = {
  elevenlabs: "ELEVENLABS",
  "openai-live": "OPENAI LIVE",
};

const LOCALE: Record<Lang, string> = { en: "en-GB", ja: "ja-JP" };

/** "16 Nov, 14:07" / "11月16日 14:07" in the UI language. */
export function formatStartedAt(unixSecs: number, lang: Lang): string {
  if (!unixSecs) return "—";
  return new Intl.DateTimeFormat(LOCALE[lang], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unixSecs * 1000));
}

/** "05:39", the same clock face the call view uses. */
export function formatDuration(secs: number): string {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(Math.floor(secs % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

/** The persona's display name in the UI language, or undefined for an unmapped agent. */
export function personaName(personaId: string | undefined, lang: Lang): string | undefined {
  const p = personaId ? PERSONAS.find((x) => x.id === personaId) : undefined;
  return p ? resolvePersona(p, lang).name : undefined;
}
