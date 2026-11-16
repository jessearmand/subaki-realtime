// How recalled memories are handed to the persona, in the session's language.
//
// Sent as an ElevenLabs contextual update, which the agent reads as background,
// not as a user turn. The framing stays in-world: the spirit simply remembers
// the visitor. It must never talk about notes, records or a memory system, and
// it never recites the list. Memories may be written in either language (a
// Japanese call yields Japanese facts), so the rule says to speak the session's
// language regardless.

import type { Lang } from "@/lib/lang";

const FRAMING: Record<Lang, { head: string; rules: string[] }> = {
  en: {
    head: "What you remember about the person you are speaking with, from earlier conversations with you or with another of your aspects:",
    rules: [
      "Bring a memory in only when it fits the moment. Never list them or recite them back.",
      "Speak as someone who simply remembers. Never mention notes, records, or any system.",
      "If something seems out of date, let them correct you and go with what they say now.",
      "Some memories may be written in Japanese. Keep speaking English.",
    ],
  },
  ja: {
    head: "いま話している相手について、あなた自身、またはあなたの別の相との以前の会話から覚えていること：",
    rules: [
      "思い出は、その場に自然に合うときだけ持ち出すこと。一覧にしたり、読み上げたりしないこと。",
      "ただ覚えている者として話すこと。メモ、記録、仕組みのことには決して触れないこと。",
      "古くなっていそうなことは相手に正してもらい、いま相手が言うことに従うこと。",
      "英語で書かれた思い出もあるが、話すのは日本語のままにすること。",
    ],
  },
};

/** The contextual-update text for these memories, or null when there is nothing to send. */
export function formatMemoryUpdate(memories: string[], lang: Lang): string | null {
  if (memories.length === 0) return null;
  const { head, rules } = FRAMING[lang];
  return [head, ...memories.map((m) => `- ${m}`), "", ...rules].join("\n");
}
