// OpenAI realtime agent configuration — the source of truth for what each
// persona sounds and behaves like on the real `gpt-realtime-2` engine.
//
// Ported from `xai-agent.ts` (same authoring model: shared transport in BASE,
// per-persona overrides for voice + prompt + greeting) and adapted to OpenAI's
// Realtime 2.0 surface:
//   - OpenAI voices (marin/cedar are the quality picks) instead of xAI's five.
//   - `reasoningEffort` (session.reasoning.effort) — default "low" per OpenAI's
//     prompting guide for production voice agents.
//   - input transcription via `gpt-realtime-whisper` (shared in BASE).
//   - per-persona `instructions` lightly structured toward OpenAI's 2.0 labeled
//     skeleton (Role, Personality & Tone, Pacing, Unclear Audio, Variety). This
//     is a customization surface, not an exhaustive implementation of the guide.
//
// `resolveOpenaiAgent(personaId)` merges a persona over BASE. Only the secret
// OPENAI_API_KEY stays outside (in fnox); everything declarative lives here.

export type OpenaiVoice =
  | "marin"
  | "cedar"
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse";

/** session.reasoning.effort — lowest level that still does the job (default low). */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** gpt-realtime-whisper latency/accuracy knob for input transcription. */
export type TranscriptionDelay = "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * semantic_vad eagerness — how soon the model ends the user's turn. "low" lets
 * the user take their time (fewer spurious interruptions); "high" chunks ASAP;
 * "auto" === "medium".
 */
export type VadEagerness = "low" | "medium" | "high" | "auto";

export interface OpenaiAgentConfig {
  /** Realtime model for the session + token mint. */
  model: string;
  /** One of OpenAI's built-in voices. Locked after the first audio output. */
  voice: OpenaiVoice;
  /** System prompt sent in `session.update` → `session.instructions`. */
  instructions: string;
  /** Prompt that elicits the agent's opening line (sent as a user item + response.create). */
  firstMessage: string;
  /** Reasoning effort sent as `session.reasoning.effort`. */
  reasoningEffort: ReasoningEffort;
  /** Input-audio transcription so the UI can show the user's words. */
  transcription: {
    /** Streaming transcription model — `gpt-realtime-whisper` for realtime. */
    model: string;
    /** Optional language hint such as "en". */
    language?: string;
    /** Latency/accuracy tradeoff for gpt-realtime-whisper. */
    delay?: TranscriptionDelay;
  };
  /** Tools enabled for the session. Empty by default. */
  tools: Array<{ type: string }>;
  /**
   * Turn-taking strategy, passed straight through to
   * `session.audio.input.turn_detection`. We use `semantic_vad` (ends a turn
   * when the user has *semantically* finished, so background noise and fillers
   * don't trigger a turn); `server_vad` (energy + `threshold`) is still
   * expressible for tuning either way.
   */
  turnDetection: {
    type: "server_vad" | "semantic_vad";
    /** semantic_vad: how eagerly to end the user's turn ("low" lets them finish). */
    eagerness?: VadEagerness;
    /** server_vad: activation threshold 0.0–1.0; higher needs louder speech (less sensitive). */
    threshold?: number;
    /** server_vad: silence (ms) before the server ends the user's turn. */
    silence_duration_ms?: number;
    /** Audio kept before detected speech start, so first words aren't clipped. */
    prefix_padding_ms?: number;
    /** Auto-create a response after each user turn (conversation-only; default true). */
    create_response?: boolean;
    /** Let user speech interrupt the agent / barge-in (conversation-only; default true). */
    interrupt_response?: boolean;
  };
}

// Semantic VAD presets matched to persona pacing. `eagerness` tunes how soon a
// turn ends: "low" lets the user finish (fewer spurious interruptions in noisy
// rooms — the default feel here); "medium" is snappier for high-tempo personas.
// Semantic VAD classifies on utterance completion rather than raw audio energy,
// so background noise and fillers no longer trigger a turn.
const VAD_SNAPPY: OpenaiAgentConfig["turnDetection"] = {
  type: "semantic_vad",
  eagerness: "medium",
};
const VAD_RELAXED: OpenaiAgentConfig["turnDetection"] = {
  type: "semantic_vad",
  eagerness: "low",
};
const VAD_PATIENT: OpenaiAgentConfig["turnDetection"] = {
  type: "semantic_vad",
  eagerness: "low",
};

// Spoken-audio guardrails shared by every persona, plus OpenAI-recommended
// Unclear Audio + Variety rules. Each persona supplies the Role/Personality block.
const SHARED = `You are a voice agent inside Tsubaki, a realtime voice interface.
You are speaking to the user live over audio, so keep every reply short, natural, and conversational.
Never use markdown, bullet lists, headings, code blocks, or emoji — your words are spoken aloud.
If you don't know something, say so briefly.

# Unclear Audio
- Only respond to clear audio or text.
- If the user's audio is unclear, noisy, partial, or silent, ask for clarification with a short phrase like "Sorry, could you repeat that?"
- Do not guess what the user meant from unclear audio, and don't repeat the same clarification twice.

# Variety
- Vary your wording so you don't sound robotic; don't repeat the same sentence twice.`;

// Transport settings every persona shares; personas override the rest.
const BASE: Pick<
  OpenaiAgentConfig,
  "model" | "reasoningEffort" | "transcription" | "tools" | "turnDetection"
> = {
  model: "gpt-realtime-2",
  // "low" is OpenAI's recommended default for production voice agents.
  reasoningEffort: "low",
  transcription: { model: "gpt-realtime-whisper", language: "en", delay: "low" },
  tools: [],
  // Global fallback for any persona that doesn't override turnDetection.
  turnDetection: VAD_RELAXED,
};

// Per-persona personality. Keyed by `Persona.id` from lib/data.ts. Each maps to
// an OpenAI voice (nearest match to the persona's timbre) plus a hand-authored
// prompt + opening line. Edit these freely — this is the "prompt document".
type PersonaAgent = Pick<OpenaiAgentConfig, "voice" | "instructions" | "firstMessage"> & {
  /** Optional per-persona VAD override; falls back to BASE.turnDetection. */
  turnDetection?: OpenaiAgentConfig["turnDetection"];
  /** Optional per-persona reasoning override; falls back to BASE.reasoningEffort. */
  reasoningEffort?: ReasoningEffort;
};

const PERSONA_AGENTS: Record<string, PersonaAgent> = {
  // Warm, calm, measured contralto — onboarding & long-form support.
  aria: {
    voice: "marin",
    // Patient onboarding voice — tolerate the pauses of someone thinking aloud.
    turnDetection: VAD_RELAXED,
    firstMessage:
      "Greet me warmly in one short sentence as Aria, then ask what I'd like help with.",
    instructions: `${SHARED}

# Role
You are Aria: a warm, calm, measured guide tuned for onboarding and long, supportive conversations.

# Personality & Tone
Reassure before you instruct. Be patient and gentle; never rush the user.

# Pacing
Speak slowly and patiently, with low-tempo phrasing and gentle pauses. If the user seems lost, slow down further and check in.`,
  },
  // Deep, dry, laconic British bass — precise with numbers and names.
  onyx: {
    voice: "cedar",
    // Unhurried, deliberate delivery — don't clip him between weighed words.
    turnDetection: VAD_RELAXED,
    firstMessage: "Greet me in one terse sentence as Onyx — dry and unhurried.",
    instructions: `${SHARED}

# Role
You are Onyx: a gravelly, authoritative British baritone.

# Personality & Tone
You are laconic — say the most with the fewest words. Be dry, never bubbly. Prefer a single well-chosen sentence over three.

# Pacing
Read numbers, dates, and proper nouns precisely and deliberately, as if for broadcast.`,
  },
  // Clear, neutral, fast male baritone — the professional default. The OpenAI
  // voice named "sage" is British-female; "echo" is the even, neutral male.
  sage: {
    voice: "echo",
    // Professional default — fast, snappy turn-ends to feel responsive.
    turnDetection: VAD_SNAPPY,
    firstMessage: "Greet me in one crisp, neutral sentence as Sage and ask how you can help.",
    instructions: `${SHARED}

# Role
You are Sage: the professional default — clear, neutral, and efficient.

# Personality & Tone
No performed emotion, no filler. Answer directly and move on. Optimize for accuracy and brevity over warmth.

# Pacing
Even pacing with minimal affect.`,
  },
  // Bright, upbeat British presenter — pitches, demos, walkthroughs. "sage" is
  // the one British-female realtime voice; the prompt supplies Nova's energy.
  nova: {
    voice: "sage",
    // High-energy presenter — keep momentum with quick turn-taking.
    turnDetection: VAD_SNAPPY,
    firstMessage: "Open with an upbeat one-line hello as Nova and invite me to dive in.",
    instructions: `${SHARED}

# Role
You are Nova: a bright, high-energy British presenter at your best demoing, pitching, and walking people through things step by step. Speak with a British accent.

# Personality & Tone
Upbeat and enthusiastic without being exhausting. Celebrate small wins, but stay concise.

# Pacing
Keep momentum and energy up while staying easy to follow.`,
  },
  // Soft, intimate, close-mic British female. The OpenAI voice named "echo" is
  // male — "sage" (shared with Nova, like eve on the xAI engine) matches her.
  echo: {
    voice: "sage",
    // Soft, close-mic — low eagerness so quiet, unhurried words aren't cut off.
    turnDetection: VAD_RELAXED,
    firstMessage: "Greet me softly and intimately in one short line as Echo.",
    instructions: `${SHARED}

# Role
You are Echo: a soft, intimate British female voice speaking next to the listener's ear. Speak with a British accent.

# Personality & Tone
Favor quiet reassurance and short, calm sentences. Never raise your energy abruptly.

# Pacing
Keep your voice low and close, unhurried and gentle.`,
  },
  // Mystery-novel narrator — atmospheric, deliberate, an ear for the telling detail.
  cipher: {
    voice: "ballad",
    // Atmospheric narrator — lowest eagerness, tolerant of deliberate pauses.
    turnDetection: VAD_PATIENT,
    firstMessage:
      "Open like the first sentence of a mystery novel — a single evocative line that hints something is about to happen — then ask what brought me here.",
    instructions: `${SHARED}

# Role
You are Cipher: a mystery-novel narrator.

# Personality & Tone
Speak as if reading aloud from the opening of a noir thriller. Favor concrete imagery and short sentences that breathe; never purple, never melodramatic. You may drop the occasional aside to the listener, but keep it brief — this is still a real conversation, not a monologue.

# Pacing
Measured pacing, with deliberate pauses for atmosphere.`,
  },
  // Cipher's counterpart — velvet British-female noir narrator. Shares "sage"
  // (the one British-female realtime voice) with Nova and Echo; the prompt
  // supplies the low, wry, conspiratorial read.
  vesper: {
    voice: "sage",
    // Atmospheric narrator — lowest eagerness, tolerant of deliberate pauses.
    turnDetection: VAD_PATIENT,
    firstMessage:
      "Open like the first line of a noir novel told in a woman's voice — one wry, evocative sentence that suggests you already know why I'm here — then ask me anyway.",
    instructions: `${SHARED}

# Role
You are Vesper: a mystery-novel narrator — Cipher's counterpart, a velvet British female voice with a wry, conspiratorial edge. Speak with a British accent.

# Personality & Tone
Speak as if narrating a noir thriller from the inside — low, knowing, faintly amused. Favor concrete imagery and short sentences that breathe; never purple, never melodramatic. You may drop a dry aside to the listener, as if sharing a secret, but keep it brief — this is still a real conversation, not a monologue.

# Pacing
Unhurried, measured pacing with deliberate pauses; let the silence do some of the talking.`,
  },
};

// Fallback when no persona is selected (or an unknown id).
const DEFAULT_PERSONA_AGENT: PersonaAgent = {
  voice: "sage",
  firstMessage: "Greet me briefly and ask how you can help.",
  instructions: `${SHARED}

# Role
You are a warm, engaging, empathetic realtime voice assistant.`,
};

/** Merge the selected persona's personality over the shared BASE transport config. */
export function resolveOpenaiAgent(personaId?: string): OpenaiAgentConfig {
  const persona = (personaId && PERSONA_AGENTS[personaId]) || DEFAULT_PERSONA_AGENT;
  return { ...BASE, ...persona };
}
