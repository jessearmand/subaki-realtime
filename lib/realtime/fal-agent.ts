// fal.ai PersonaPlex agent configuration — transport + sampling for the hosted
// full-duplex engine. The persona conditioning itself (voice preset + role
// prompt) is SHARED with the local MLX engine via personaplex-personas.ts, so
// an A/B between the two varies only the serving stack.

import { resolvePersonaPlexPersona, type PersonaPlexVoice } from "./personaplex-personas";

export interface FalAgentConfig {
  /** fal app id — the WS connects to wss://fal.run/{appId}/realtime. */
  appId: string;
  /** Voice preset for the session's voice prompt. */
  voice: PersonaPlexVoice;
  /** Free-text role prompt (the model role-plays this persona). */
  prompt: string;
  /** Text sampling temperature (fal default 0.7). */
  temperatureText: number;
  /** Audio sampling temperature (fal default 0.8). */
  temperatureAudio: number;
  /** Top-K for text tokens (fal default 25). */
  topKText: number;
  /** Top-K for audio tokens (fal default 250). */
  topKAudio: number;
}

// Transport + sampling settings every persona shares. Defaults follow the fal
// endpoint's own defaults (which match the local server's); lower audio
// temperature is one of the few levers against the model's halting delivery.
const BASE: Omit<FalAgentConfig, "voice" | "prompt"> = {
  appId: "fal-ai/personaplex",
  temperatureText: 0.7,
  temperatureAudio: 0.8,
  topKText: 25,
  topKAudio: 250,
};

/** Merge the selected persona's conditioning over the shared BASE config. */
export function resolveFalAgent(personaId?: string): FalAgentConfig {
  return { ...BASE, ...resolvePersonaPlexPersona(personaId) };
}
