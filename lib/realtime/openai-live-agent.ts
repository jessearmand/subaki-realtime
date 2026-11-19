// GPT-Live persona configuration for the OPENAI LIVE row.
//
// The persona prompts are the Realtime engine's (openai-agent.ts, localized by
// japanese.ts), so both OpenAI rows play the same characters. GPT-Live adds the
// three policy headings its prompting guide asks for, and the voice comes from
// the Live casting (openai-live-voices.ts) instead of the Realtime voices.
//
// Used on the server, which creates the session: the browser never supplies
// the prompt or the voice.

import type { Lang } from "@/lib/lang";
import { resolveOpenaiAgent } from "./openai-agent";
import { resolveLiveVoice, type LiveVoice } from "./openai-live-voices";
import { OPENAI_LIVE_MODEL } from "./realtime-model-config";

// No backend is connected (client delegation with nothing behind it), so the
// model must not hand work off. The browser still answers a stray delegation.
const LIVE_POLICIES = `# Live Conversation
Backchannel policy: Use light, occasional backchannels that suit your temperament. Never talk over the person to fill a pause.

Interruption policy: Stop speaking when the person interrupts. Listen to what they say, then answer that.

Delegation policy:
Backend tools:
- None. No backend, tools, or web access is connected to this conversation.

Generate <|SpawnThinking|> when:
- Never.

Do not generate <|SpawnThinking|> when:
- Any request. Answer from what you know and from this conversation, and say briefly when you don't know.`;

export interface LiveAgentConfig {
  model: string;
  voice: LiveVoice;
  /** session.instructions — persona prompt, Live policies, custom voice description. */
  instructions: string;
  /** Opening instruction, sent at startup and again once the session starts. */
  greeting: string;
}

function greetingInstruction(direction: string, resumed: boolean): string {
  const back = resumed
    ? " You are continuing an earlier conversation with them, so greet them as someone returning, not as a stranger."
    : "";
  return `Start the conversation now by greeting the caller. The caller asked for this opening: "${direction}"${back} Then pause and listen.`;
}

export function resolveLiveAgent(
  personaId: string | undefined,
  lang: Lang,
  { resumed }: { resumed: boolean },
): LiveAgentConfig {
  const base = resolveOpenaiAgent(personaId, lang);
  const voice = resolveLiveVoice(personaId, lang);
  const sections = [base.instructions, LIVE_POLICIES];
  if (voice.description) sections.push(`# Voice\n${voice.description}`);
  return {
    model: OPENAI_LIVE_MODEL,
    voice,
    instructions: sections.join("\n\n"),
    greeting: greetingInstruction(base.firstMessage, resumed),
  };
}
