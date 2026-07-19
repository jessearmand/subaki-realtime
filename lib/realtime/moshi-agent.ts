// Local PersonaPlex (MLX) agent configuration — transport for the on-device
// full-duplex engine served by personaplex-mlx's `local_web` at :8998
// (launch it with `mise run personaplex-local`; kyutai RL checkpoint by
// default). The persona conditioning (voice preset + role prompt) is SHARED
// with the fal.ai engine via personaplex-personas.ts, so an A/B between the
// two varies only the serving stack.
//
// Unlike the hosted engines there is no token route: the browser connects
// straight to the local server. Session config rides the connect URL as query
// params — `voice_prompt` (preset + ".pt"), `text_prompt`, and `format=pcm`
// (raw PCM16 @ 24kHz both ways, our fork's codec-free wire mode). Sampling
// temperatures/top-k are server launch flags, not per-session params.

import { resolvePersonaPlexPersona } from "./personaplex-personas";

/** Local server origin; override with NEXT_PUBLIC_PERSONAPLEX_WS_URL. */
const DEFAULT_WS_BASE = "ws://localhost:8998";

export interface MoshiAgentConfig {
  /** Full WebSocket URL including the session's query params. */
  url: string;
}

/** Build the local server WS URL carrying the selected persona's conditioning. */
export function resolveMoshiAgent(personaId?: string): MoshiAgentConfig {
  const persona = resolvePersonaPlexPersona(personaId);
  const base = process.env.NEXT_PUBLIC_PERSONAPLEX_WS_URL ?? DEFAULT_WS_BASE;
  const params = new URLSearchParams({
    voice_prompt: `${persona.voice}.pt`,
    text_prompt: persona.prompt,
    format: "pcm",
  });
  return { url: `${base}/api/chat?${params.toString()}` };
}
