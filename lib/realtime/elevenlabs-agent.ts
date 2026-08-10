// ElevenLabs agent resolution — which platform agent answers for each persona.
//
// Unlike the other engines (xai-agent.ts, openai-agent.ts…) where prompts and
// voices resolve client-side, ElevenLabs keeps the whole persona server-side:
// one platform agent per persona, authored by scripts/elevenlabs/
// gen-agent-configs.ts and created with scripts/elevenlabs/create-agents.sh.
// This module only maps persona id → public agent id (agent IDs are
// widget-embeddable, not secret — see README).
//
// Any persona without an entry falls back to NEXT_PUBLIC_ELEVENLABS_AGENT_ID,
// preserving the original single-agent behavior. If an agent is recreated,
// refresh its ID here from `elevenlabs agents status`.

const PERSONA_AGENT_IDS: Record<string, string> = {
  aria: "agent_8701kzp5d9kde51b6waz8ae5nb6g",
  onyx: "agent_1201kzp5dbqee9a9pq7gndp22ev5",
  sage: "agent_9601kzp5ddn2em6s827hnn1xwswv",
  nova: "agent_6501kzp5dfhgeps9vj3tec0npxvm",
  echo: "agent_7501kzp5dh8necnvagqy7x42g8fw",
  cipher: "agent_5401kzp5dk2veh0anh8xgm0wa51k",
  vesper: "agent_5701kzp5dn4me4nt5vk1ya61kf48",
};

/** Agent ID for the selected persona, or the env fallback; undefined ⇒ unconfigured. */
export function resolveElevenLabsAgentId(personaId?: string): string | undefined {
  return (
    (personaId && PERSONA_AGENT_IDS[personaId]) ||
    process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ||
    undefined
  );
}
