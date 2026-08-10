// ElevenLabs agent resolution — which platform agent answers for each persona.
//
// Unlike the other engines (xai-agent.ts, openai-agent.ts…) where prompts and
// voices resolve client-side, ElevenLabs keeps the whole persona server-side:
// one platform agent per persona, authored by scripts/elevenlabs/
// gen-agent-configs.ts and created with scripts/elevenlabs/create-agents.sh.
// This module only maps persona id → public agent id (agent IDs are
// widget-embeddable, not secret — see README).
//
// Fill PERSONA_AGENT_IDS from `elevenlabs agents status` (or the create
// script's summary) after the agents exist. Any persona without an entry
// falls back to NEXT_PUBLIC_ELEVENLABS_AGENT_ID, preserving the original
// single-agent behavior.

const PERSONA_AGENT_IDS: Record<string, string> = {
  // aria: "agent_…",
  // onyx: "agent_…",
  // sage: "agent_…",
  // nova: "agent_…",
  // echo: "agent_…",
  // cipher: "agent_…",
  // vesper: "agent_…",
};

/** Agent ID for the selected persona, or the env fallback; undefined ⇒ unconfigured. */
export function resolveElevenLabsAgentId(personaId?: string): string | undefined {
  return (
    (personaId && PERSONA_AGENT_IDS[personaId]) ||
    process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ||
    undefined
  );
}
