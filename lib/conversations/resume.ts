// How an earlier call is handed back to the persona when the visitor continues it.
//
// Sent as an ElevenLabs contextual update at connect, like recalled memories.
// It stays in-world: the spirit picks the conversation back up. It never says
// "transcript" or "log", and it never reads the old lines back.

import type { Lang } from "@/lib/lang";
import type { ConversationTurn } from "./types";

/** What a resume needs: the earlier turns, and their language (it may differ from the session's). */
export interface ResumeSource {
  lang: Lang;
  transcript: ConversationTurn[];
}

// The tail of a long call carries the thread; the beginning is mostly greetings.
// The bound keeps the update well inside the agent's context on a long call.
export const RESUME_MAX_TURNS = 40;
const RESUME_MAX_CHARS_PER_TURN = 600;

const FRAMING: Record<
  Lang,
  { head: string; you: string; them: string; rules: string[]; otherLang: string }
> = {
  en: {
    head: "You are picking up an earlier conversation with the person you are speaking with. This is how it went, oldest first:",
    you: "You",
    them: "Them",
    rules: [
      "Carry on from where it stopped, as someone returning to an unfinished conversation, not meeting them for the first time.",
      "Never read the earlier lines back, and never mention a transcript, a log, or any system.",
    ],
    otherLang: "The earlier conversation was in Japanese. Keep speaking English.",
  },
  ja: {
    head: "いま話している相手との、以前の会話の続きをするところです。そのときのやり取りは次のとおり（古い順）：",
    you: "あなた",
    them: "相手",
    rules: [
      "初対面としてではなく、途中だった会話に戻ってきた者として、止まったところから続けること。",
      "以前のやり取りを読み上げないこと。記録、ログ、仕組みのことには決して触れないこと。",
    ],
    otherLang: "以前の会話は英語だったが、話すのは日本語のままにすること。",
  },
};

function clip(text: string): string {
  return text.length > RESUME_MAX_CHARS_PER_TURN
    ? `${text.slice(0, RESUME_MAX_CHARS_PER_TURN)}…`
    : text;
}

/** The contextual-update text that resumes `source` in a `lang` session, or null if it has no turns. */
export function formatResumeUpdate(source: ResumeSource, lang: Lang): string | null {
  const turns = source.transcript.slice(-RESUME_MAX_TURNS);
  if (turns.length === 0) return null;
  const f = FRAMING[lang];
  const lines = turns.map((t) => `${t.who === "agent" ? f.you : f.them}: ${clip(t.text)}`);
  const rules = source.lang === lang ? f.rules : [...f.rules, f.otherLang];
  return [f.head, ...lines, "", ...rules].join("\n");
}
