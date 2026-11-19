// GPT-Live startup `input`: what the persona knows before its first word.
// Pure (no I/O), so the budget rules can be checked directly.
//
// GPT-Live caps startup input at 128 messages and 8,192 tokens combined, and an
// oversized request fails the call. So everything here is budgeted with a
// conservative estimate (Japanese costs far more tokens per character than
// English): recalled memories first, then as much of a continued conversation
// as still fits, newest turns kept. The greeting instruction always goes last.

import type { Lang } from "@/lib/lang";
import { formatMemoryUpdate } from "@/lib/memory/framing";
import { RESUME_MAX_CHARS_PER_TURN, formatResumePreamble } from "./resume";
import type { ConversationTurn } from "./types";

/** Under the documented 8,192, to absorb estimation error. */
export const INPUT_TOKEN_BUDGET = 7000;
/** Under the documented 128. */
export const INPUT_MAX_MESSAGES = 120;
/** Memories may take at most this much of the budget. */
export const MEMORY_TOKEN_CAP = 1500;

export type LiveInputItem = {
  type: "message";
  role: "developer" | "user" | "assistant";
  content: [{ type: "input_text" | "output_text"; text: string }];
};

// Kana, CJK ideographs, compatibility ideographs and full-width forms.
const CJK_RE = /[\u{3000}-\u{30ff}\u{3400}-\u{9fff}\u{f900}-\u{faff}\u{ff00}-\u{ffef}]/u;
const MESSAGE_OVERHEAD = 4;

/** Rough upper estimate: one token per CJK character, one per three others. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 3) + MESSAGE_OVERHEAD;
}

function message(role: LiveInputItem["role"], text: string): LiveInputItem {
  return {
    type: "message",
    role,
    content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
  };
}

function clip(text: string): string {
  return text.length > RESUME_MAX_CHARS_PER_TURN
    ? `${text.slice(0, RESUME_MAX_CHARS_PER_TURN)}…`
    : text;
}

/** The memory update, dropping the oldest memories until it fits its cap. */
function memoryText(memories: string[], lang: Lang): string | null {
  for (let n = memories.length; n > 0; n--) {
    const text = formatMemoryUpdate(memories.slice(0, n), lang);
    if (text && estimateTokens(text) <= MEMORY_TOKEN_CAP) return text;
  }
  return null;
}

export interface SeedSource {
  /** Recalled memories, newest first. */
  memories: string[];
  /** An earlier conversation to continue, in its own language. */
  resume: { lang: Lang; transcript: ConversationTurn[] } | null;
  /** The greeting instruction (resolveLiveAgent). */
  greeting: string;
  /** Session language. */
  lang: Lang;
}

export function buildLiveInput({ memories, resume, greeting, lang }: SeedSource): LiveInputItem[] {
  const head: LiveInputItem[] = [];
  let tokens = estimateTokens(greeting);

  const mem = memoryText(memories, lang);
  if (mem) {
    head.push(message("developer", mem));
    tokens += estimateTokens(mem);
  }

  const history: LiveInputItem[] = [];
  if (resume && resume.transcript.length > 0) {
    const preamble = formatResumePreamble(resume.lang, lang);
    let used = tokens + estimateTokens(preamble);
    // Newest turns first, until the token budget or the message cap runs out
    // (counting the preamble and the greeting still to come).
    for (let i = resume.transcript.length - 1; i >= 0; i--) {
      const text = clip(resume.transcript[i].text.trim());
      if (!text) continue;
      const cost = estimateTokens(text);
      if (used + cost > INPUT_TOKEN_BUDGET) break;
      if (head.length + history.length + 3 > INPUT_MAX_MESSAGES) break;
      history.unshift(message(resume.transcript[i].who === "agent" ? "assistant" : "user", text));
      used += cost;
    }
    if (history.length > 0) history.unshift(message("developer", preamble));
  }
  return [...head, ...history, message("developer", greeting)];
}
