// Japanese for the prompt-level engines (xAI Grok Voice, OpenAI Realtime,
// Gemini Live native audio).
//
// None of these sessions has a language parameter — the model follows the
// instructions and the opening turn. So a Japanese session is the same persona
// (same voice, same English persona prompt) with two changes:
//   1. a language rule appended to the instructions, and
//   2. the opening direction swapped for one that elicits the persona's
//      Japanese greeting.
// (OpenAI additionally takes a transcription language hint — see openai-agent.ts.)
//
// ElevenLabs does NOT go through here: it routes Japanese to a dedicated JA
// agent with its own JA prompt and cast voice (elevenlabs-agent.ts).

import { PERSONAS } from "@/lib/data";
import type { Lang } from "@/lib/lang";

/** The slice of an engine's agent config that carries language. */
interface Localizable {
  instructions: string;
  firstMessage: string;
}

function languageRule(jaName?: string): string {
  const name = jaName ? ` Say your own name in its Japanese form, ${jaName}.` : "";
  return (
    "Language: always converse in natural spoken Japanese (日本語), even though these " +
    "instructions are written in English. Keep replying in Japanese if the user speaks " +
    "another language, unless they explicitly ask you to switch. Match the user's level of " +
    "politeness." +
    name
  );
}

// The engines elicit their opening from a user-side direction (never a
// scripted assistant turn), so the greeting is requested, not injected.
function greetingDirection(greet?: string): string {
  return greet
    ? `Open in Japanese. Say this greeting word for word, then wait for my reply: 「${greet}」`
    : "Greet me briefly in Japanese as a calm aspect of the ancient camellia spirit and ask how you can help.";
}

/**
 * Apply the session language to a resolved agent config. English is the
 * identity; Japanese appends the language rule and swaps the opening direction.
 */
export function localizeAgent<T extends Localizable>(
  agent: T,
  personaId: string | undefined,
  lang: Lang,
): T {
  if (lang !== "ja") return agent;
  const ja = PERSONAS.find((p) => p.id === personaId)?.ja;
  return {
    ...agent,
    instructions: `${agent.instructions}\n\n${languageRule(ja?.name)}`,
    firstMessage: greetingDirection(ja?.greet),
  };
}
