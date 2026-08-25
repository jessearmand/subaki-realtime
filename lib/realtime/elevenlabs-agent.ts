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
//
// Language is routing, not configuration: each persona has a dedicated agent
// per language (tsubaki-<id> / tsubaki-<id>-ja, created by create-agents.sh /
// create-agents-ja.sh), so arming Japanese means connecting to the JA agent ID
// rather than overriding the EN agent's language per session.

const PERSONA_AGENT_IDS: Record<string, string> = {
  aria: "agent_8701kzp5d9kde51b6waz8ae5nb6g",
  onyx: "agent_1201kzp5dbqee9a9pq7gndp22ev5",
  sage: "agent_9601kzp5ddn2em6s827hnn1xwswv",
  nova: "agent_6501kzp5dfhgeps9vj3tec0npxvm",
  echo: "agent_7501kzp5dh8necnvagqy7x42g8fw",
  cipher: "agent_5401kzp5dk2veh0anh8xgm0wa51k",
  vesper: "agent_5701kzp5dn4me4nt5vk1ya61kf48",
};

const PERSONA_AGENT_IDS_JA: Record<string, string> = {
  aria: "agent_9701m0ws4yp6fn89s25cm1rq0xr4",
  onyx: "agent_0101m0ws50k8f5yvq13w1vnfewmj",
  sage: "agent_5901m0ws5299ed18ay20rdz97zwa",
  nova: "agent_8601m0ws53vqevptfz83rhfzj9wj",
  echo: "agent_8701m0ws55jzfff8stqz47gb4rj4",
  cipher: "agent_7101m0ws5795fqa8fq1zk7bjew9t",
  vesper: "agent_0001m0ws5960ehtr2fxpnrgwvfhx",
};

/**
 * Agent ID for the selected persona and language, or the env fallback;
 * undefined ⇒ unconfigured. A JA request for an uncast persona falls back to
 * the persona's EN agent rather than the generic env agent.
 */
export function resolveElevenLabsAgentId(
  personaId?: string,
  lang: "en" | "ja" = "en",
): string | undefined {
  return (
    (personaId && lang === "ja" && PERSONA_AGENT_IDS_JA[personaId]) ||
    (personaId && PERSONA_AGENT_IDS[personaId]) ||
    process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ||
    undefined
  );
}
