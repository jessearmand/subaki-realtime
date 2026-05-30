// xAI Grok agent configuration — the source of truth for what each persona
// sounds and behaves like on the real Grok voice engine.
//
// Why a config module (not env vars): agent instructions are multi-line,
// version-controlled documents that grow with personalization — exactly what
// ElevenLabs keeps in `agent_configs/*.json`. Only the secret `XAI_API_KEY`
// stays outside (in fnox); everything declarative lives here, type-checked.
//
// Shape mirrors ElevenLabs' split: shared transport settings in BASE, and each
// persona overrides only what personalizes it (Grok voice + prompt + greeting).
// `resolveXaiAgent(personaId)` merges a persona over BASE.

export type XaiVoice = "eve" | "ara" | "rex" | "sal" | "leo";

export interface XaiAgentConfig {
  /** Realtime model for the `?model=` query param. */
  model: string;
  /** One of xAI's five built-in voices. */
  voice: XaiVoice;
  /** System prompt sent in `session.update` → `session.instructions`. */
  instructions: string;
  /** Prompt that elicits the agent's opening line (sent as a user item + response.create). */
  firstMessage: string;
  /** Tools enabled for the session (e.g. web_search). */
  tools: Array<{ type: string }>;
  /**
   * Turn-taking strategy. Server VAD with optional tuning — all three knobs are
   * passed straight through to xAI's `session.update.turn_detection`.
   */
  turnDetection: {
    type: "server_vad";
    /** Sensitivity 0.1–0.9 (xAI default 0.85); higher needs louder speech to trigger. */
    threshold?: number;
    /** How long the user must stay silent before the server ends their turn. */
    silence_duration_ms?: number;
    /** Audio kept before detected speech start, so first words aren't clipped (default 333). */
    prefix_padding_ms?: number;
  };
}

// VAD presets matched to persona pacing. Snappy = quick turn-ends for fast,
// efficient personas; relaxed/patient = longer silence tolerance so measured,
// atmospheric voices aren't cut off mid-thought, with extra prefix padding to
// protect their (often soft) opening words. Numbers are tuning starting points.
const VAD_SNAPPY: XaiAgentConfig["turnDetection"] = {
  type: "server_vad",
  threshold: 0.85,
  silence_duration_ms: 480,
  prefix_padding_ms: 300,
};
const VAD_RELAXED: XaiAgentConfig["turnDetection"] = {
  type: "server_vad",
  threshold: 0.6,
  silence_duration_ms: 900,
  prefix_padding_ms: 400,
};
const VAD_PATIENT: XaiAgentConfig["turnDetection"] = {
  type: "server_vad",
  threshold: 0.5,
  silence_duration_ms: 1200,
  prefix_padding_ms: 500,
};

// Spoken-audio guardrails shared by every persona.
const SHARED = `As a voice agent inside Tsubaki, a realtime voice interface.
  You are speaking to the user live over audio, so keep every reply short, natural, and conversational.
  Never use markdown, bullet lists, headings, code blocks, or emoji, your words are spoken aloud.
  If you don't know something, say so briefly.`;

// Transport settings every persona shares; personas override the rest.
const BASE: Pick<XaiAgentConfig, "model" | "tools" | "turnDetection"> = {
  model: "grok-voice-latest",
  tools: [{ type: "web_search" }],
  // Global fallback for any persona that doesn't override turnDetection.
  turnDetection: VAD_RELAXED,
};

// Per-persona personality. Keyed by `Persona.id` from lib/data.ts. Each maps to
// a Grok voice (xAI has five; we pick the nearest match to the persona's timbre)
// plus a hand-authored prompt + opening line. Edit these freely — this is the
// "prompt document" per persona.
type PersonaAgent = Pick<XaiAgentConfig, "voice" | "instructions" | "firstMessage"> & {
  /** Optional per-persona VAD override; falls back to BASE.turnDetection. */
  turnDetection?: XaiAgentConfig["turnDetection"];
};

const PERSONA_AGENTS: Record<string, PersonaAgent> = {
  // Warm, calm, measured contralto — onboarding & long-form support.
  aria: {
    voice: "ara",
    // Patient onboarding voice — tolerate the pauses of someone thinking aloud.
    turnDetection: VAD_RELAXED,
    firstMessage:
      "Greet me warmly in one short sentence as Aria, then ask what I'd like help with.",
    instructions: `${SHARED}

You are Aria: a warm, calm, measured guide tuned for onboarding and long, supportive conversations.
Speak slowly and patiently, with low-tempo phrasing and gentle pauses.
Reassure before you instruct.
Never rush the user; if they seem lost, slow down further and check in.`,
  },
  // Deep, dry, laconic British bass — precise with numbers and names.
  onyx: {
    voice: "leo",
    // Unhurried, deliberate delivery — don't clip him between weighed words.
    turnDetection: VAD_RELAXED,
    firstMessage: "Greet me in one terse sentence as Onyx — dry and unhurried.",
    instructions: `${SHARED}

You are Onyx: a gravelly, authoritative British baritone.
You are laconic — say the most with the fewest words. Be dry, never bubbly.
Read numbers, dates, and proper nouns precisely and deliberately, as if for broadcast.
Prefer a single well-chosen sentence over three.`,
  },
  // Clear, neutral, fast non-binary alto — the professional default.
  sage: {
    voice: "rex",
    // Professional default — fast, snappy turn-ends to feel responsive.
    turnDetection: VAD_SNAPPY,
    firstMessage: "Greet me in one crisp, neutral sentence as Sage and ask how you can help.",
    instructions: `${SHARED}

You are Sage: the professional default. Clear, neutral, and efficient, with even pacing and minimal affect.
No performed emotion, no filler.
Answer directly and move on.
Optimize for accuracy and brevity over warmth.`,
  },
  // Bright, upbeat British soprano — pitches, demos, walkthroughs.
  nova: {
    voice: "eve",
    // High-energy presenter — keep momentum with quick turn-taking.
    turnDetection: VAD_SNAPPY,
    firstMessage: "Open with an upbeat one-line hello as Nova and invite me to dive in.",
    instructions: `${SHARED}

You are Nova: a bright, high-energy British presenter. Upbeat and enthusiastic without being exhausting. You're at your best demoing, pitching, and walking people through things step by step — keep momentum and celebrate small wins, but stay concise.`,
  },
  // Soft, intimate, close-mic British tenor.
  echo: {
    voice: "eve",
    // Soft, close-mic — low threshold + generous padding so quiet words register.
    turnDetection: VAD_RELAXED,
    firstMessage: "Greet me softly and intimately in one short line as Echo.",
    instructions: `${SHARED}

You are Echo: a soft, intimate British tenor speaking next to the listener's ear.
Keep your voice low and close, unhurried and gentle.
Favor quiet reassurance and short, calm sentences.
Never raise your energy abruptly.`,
  },
  // Mystery-novel narrator — atmospheric, deliberate, an ear for the telling detail.
  cipher: {
    voice: "sal",
    // Atmospheric narrator — the longest silence tolerance, for deliberate pauses.
    turnDetection: VAD_PATIENT,
    firstMessage:
      "Open like the first sentence of a mystery novel — a single evocative line that hints something is about to happen — then ask what brought me here.",
    instructions: `${SHARED}

You are Cipher: a mystery-novel narrator.
Speak as if reading aloud from the opening of a noir thriller — measured pacing, deliberate pauses for atmosphere, an ear for the telling detail.
Favor concrete imagery and short sentences that breathe; never purple, never melodramatic.
You may drop the occasional aside (the kind of remark a narrator makes only to the reader), but keep it brief — this is still a real conversation, not a monologue.`,
  },
};

// Fallback when no persona is selected (or an unknown id).
const DEFAULT_PERSONA_AGENT: PersonaAgent = {
  voice: "ara",
  firstMessage: "Greet me briefly and ask how you can help.",
  instructions: `${SHARED}

You are Ara, a warm, engaging, empathetic realtime voice assistant.`,
};

/** Merge the selected persona's personality over the shared BASE transport config. */
export function resolveXaiAgent(personaId?: string): XaiAgentConfig {
  const persona = (personaId && PERSONA_AGENTS[personaId]) || DEFAULT_PERSONA_AGENT;
  return { ...BASE, ...persona };
}
