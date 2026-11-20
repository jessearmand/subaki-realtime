// GPT-Live voice casting, per persona and session language.
//
// The casting itself is data in config/openai-live-voices.json. An entry names
// a built-in GPT-Live voice and may add a prompt-to-voice custom voice
// (created by scripts/openai-live/create-voices.ts, which writes its id back).
// A custom voice without an id falls back to the built-in one, so the app runs
// before the custom voices exist. Client-safe: voice names and ids only.

import catalog from "@/config/openai-live-voices.json";
import type { Lang } from "@/lib/lang";

/** Built-in GPT-Live voices (API reference, session.audio.output.voice). */
export const LIVE_BUILTIN_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "beacon",
  "bossa",
  "brise",
  "calandria",
  "cedar",
  "cinder",
  "compas",
  "coral",
  "delta",
  "destello",
  "echo",
  "flitz",
  "gleam",
  "halo",
  "harema",
  "hornero",
  "juni",
  "luciernaga",
  "marin",
  "meridian",
  "nira",
  "noeul",
  "nuri",
  "pearl",
  "quartz",
  "ripple",
  "sage",
  "shida",
  "shimmer",
  "sillage",
  "stone",
  "tempo",
  "verse",
  "vesper",
  "willow",
] as const;

export type LiveBuiltinVoice = (typeof LIVE_BUILTIN_VOICES)[number];

/** What session.audio.output.voice takes: a built-in name or a custom voice id. */
export type LiveVoiceParam = LiveBuiltinVoice | { id: string };

export interface LiveVoice {
  param: LiveVoiceParam;
  /** Display name: the built-in voice, or the custom voice's name. */
  label: string;
  /**
   * The custom voice's original description. OpenAI recommends repeating it in
   * the session instructions so the delivery matches the voice.
   */
  description?: string;
}

interface CustomVoiceEntry {
  name: string;
  prompt: string;
  id: string | null;
}

interface VoiceEntry {
  voice: string;
  custom?: CustomVoiceEntry;
}

// The JSON's inferred literal types (id: null) are narrower than the schema.
const CASTING = catalog.personas as unknown as Record<string, Partial<Record<Lang, VoiceEntry>>>;

// GPT-Live's own default voice.
const DEFAULT_VOICE: LiveBuiltinVoice = "marin";

function isBuiltin(name: string): name is LiveBuiltinVoice {
  return (LIVE_BUILTIN_VOICES as readonly string[]).includes(name);
}

/** The voice a persona speaks with on GPT-Live in this language. */
export function resolveLiveVoice(personaId: string | undefined, lang: Lang): LiveVoice {
  const entry = personaId ? CASTING[personaId]?.[lang] : undefined;
  const custom = entry?.custom;
  if (custom?.id)
    return { param: { id: custom.id }, label: custom.name, description: custom.prompt };
  // An unknown name would come back from OpenAI as a misleading 403, so a
  // typo in the casting file falls back to the default instead.
  const voice = entry && isBuiltin(entry.voice) ? entry.voice : DEFAULT_VOICE;
  return { param: voice, label: voice };
}
