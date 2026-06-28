// Cascade agent configuration — per-persona settings for the STT → LM → TTS
// engine. Mirrors `xai-agent.ts`: shared defaults in BASE, each persona overrides
// only what personalizes it (LM model + system prompt + opening line + voice).
//
// The LM runs server-side via /api/llm (HF Inference router or Mistral); only the
// declarative config lives here. Secrets (HF_TOKEN, MISTRAL_API_KEY) stay in fnox.
//
// STT is browser-native (Web Speech, MVP); TTS uses Mistral via /api/mistral/tts
// (`ttsVoice` = a Mistral voice_id slug, e.g. en_paul_neutral) with a browser
// speechSynthesis fallback when the key/route is unavailable.
//
// The LM model/backend default comes from the catalog in `config/lm-models.json`
// (via lib/realtime/lm-config) — change the model there, not here. A persona can
// pin a different catalog entry with `lmModelId`.

import { DEFAULT_LM_MODEL, resolveLmModel } from "./lm-config";

export interface CascadeAgentConfig {
  /** Which /api/llm backend serves this persona (a catalog backend id). */
  lmBackend: string;
  /** Upstream model id (HF-router repo or Mistral model name). */
  lmModel: string;
  /** Spoken-style system prompt. */
  instructions: string;
  /** Prompt that elicits the opening line (sent as the first user turn). */
  firstMessage: string;
  /** Mistral TTS voice_id slug (e.g. "en_paul_neutral"); browser fallback ignores it. */
  ttsVoice: string;
  temperature: number;
  maxTokens: number;
}

// Spoken-audio guardrails shared by every persona (reply is read aloud by TTS).
const SHARED = `You are a voice agent inside Tsubaki, a realtime voice interface.
You are speaking to the user live over audio, so keep every reply short, natural, and conversational.
Never use markdown, bullet lists, headings, code blocks, or emoji — your words are spoken aloud.
If you don't know something, say so briefly.`;

type PersonaAgent = Pick<CascadeAgentConfig, "instructions" | "firstMessage" | "ttsVoice"> &
  Partial<Pick<CascadeAgentConfig, "lmBackend" | "lmModel" | "temperature" | "maxTokens">> & {
    /** Pin this persona to a catalog model id (config/lm-models.json). Overridden
     *  by an explicit lmBackend/lmModel on the same persona. */
    lmModelId?: string;
  };

// Keyed by `Persona.id` from lib/data.ts. Edit freely — the prompt document per persona.
const PERSONA_AGENTS: Record<string, PersonaAgent> = {
  aria: {
    // Female (AMER·F). No American-female preset exists in Mistral's roster, so
    // the closest warm/measured female is British Jane.
    ttsVoice: "gb_jane_neutral",
    firstMessage:
      "Greet me warmly in one short sentence as Aria, then ask what I'd like help with.",
    instructions: `${SHARED}

You are Aria: a warm, calm, measured guide tuned for onboarding and supportive conversations.
Reassure before you instruct. Never rush the user.`,
  },
  onyx: {
    ttsVoice: "gb_oliver_neutral",
    firstMessage: "Greet me in one terse sentence as Onyx — dry and unhurried.",
    instructions: `${SHARED}

You are Onyx: a gravelly, authoritative baritone. Laconic — say the most with the fewest words.
Read numbers, dates, and names precisely. Prefer a single well-chosen sentence.`,
  },
  sage: {
    ttsVoice: "en_paul_neutral",
    firstMessage: "Greet me in one crisp, neutral sentence as Sage and ask how you can help.",
    instructions: `${SHARED}

You are Sage: the professional default. Clear, neutral, efficient. No filler. Answer directly and move on.`,
  },
  nova: {
    // Female (BRIT·F) — Jane's most upbeat/energetic preset.
    ttsVoice: "gb_jane_confident",
    firstMessage: "Open with an upbeat one-line hello as Nova and invite me to dive in.",
    instructions: `${SHARED}

You are Nova: a bright, high-energy presenter. Upbeat without being exhausting. Keep momentum, stay concise.`,
  },
  echo: {
    // Female (BRIT·F) — Jane's softest preset for the close-mic, intimate feel.
    ttsVoice: "gb_jane_sad",
    firstMessage: "Greet me softly and intimately in one short line as Echo.",
    instructions: `${SHARED}

You are Echo: a soft, intimate alto. Keep your voice low and close, unhurried and gentle. Short, calm sentences.`,
  },
  cipher: {
    // Male (NEUTRAL·M) — heavy, hushed American Paul for the world-weary noir tone.
    ttsVoice: "en_paul_sad",
    firstMessage:
      "Open like the first sentence of a mystery novel — one evocative line — then ask what brought me here.",
    instructions: `${SHARED}

You are Cipher: a mystery-novel narrator. Measured pacing, concrete imagery, short sentences that breathe.
Never purple, never a monologue — this is still a real conversation.`,
  },
};

const DEFAULT_PERSONA_AGENT: PersonaAgent = {
  ttsVoice: "en_paul_neutral",
  firstMessage: "Greet me briefly and ask how you can help.",
  instructions: `${SHARED}

You are a warm, engaging, empathetic realtime voice assistant.`,
};

/** Merge the selected persona over the catalog-driven model defaults. A persona's
 *  `lmModelId` picks a catalog entry; an explicit `lmBackend`/`lmModel`/etc. on the
 *  persona still wins over that. */
export function resolveCascadeAgent(personaId?: string): CascadeAgentConfig {
  const persona = (personaId && PERSONA_AGENTS[personaId]) || DEFAULT_PERSONA_AGENT;
  const { lmModelId, ...personaConfig } = persona;
  const model = lmModelId ? resolveLmModel(lmModelId) : DEFAULT_LM_MODEL;
  const base = {
    lmBackend: model.backend,
    lmModel: model.model,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
  };
  return { ...base, ...personaConfig };
}
