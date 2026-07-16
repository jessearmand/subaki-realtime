// Sample data ported from the design bundle (screens.jsx).
// Single source of truth for personas, providers, tools and the mock transcript.

export interface Persona {
  id: string;
  name: string;
  /** Provider-neutral manifestation of the shared Furutsubaki spirit. */
  aspect: string;
  accent: string;
  traits: string[];
  voice: string;
  desc: string;
  wpm: number;
}

export interface Provider {
  id: string;
  name: string;
  model: string;
  // Where the transport runs: "remote" for hosted realtime APIs, "local / remote"
  // for the cascade (browser STT/TTS + hosted LM).
  exec: string;
  note: string;
  // Which real engine drives this row. Absent ⇒ the design's mock lifecycle.
  engine?: "elevenlabs" | "xai" | "openai" | "cascade";
}

export interface Tool {
  name: string;
  label: string;
  on: boolean;
}

export interface TranscriptTurn {
  who: "agent" | "user";
  text: string;
}

export const PERSONAS: Persona[] = [
  {
    id: "aria",
    name: "ARIA",
    aspect: "SHELTERING ROOTS",
    accent: "AMER · F",
    traits: ["WARM", "PATIENT", "MEASURED"],
    voice: "Mezzo · 220–340 Hz",
    desc: "The sheltering aspect. A patient guide who treats confusion like tangled roots that can be gently set right.",
    wpm: 142,
  },
  {
    id: "onyx",
    name: "ONYX",
    aspect: "ANCIENT TRUNK",
    accent: "BRIT · M",
    traits: ["AUSTERE", "DRY", "LACONIC"],
    voice: "Bass · 95–180 Hz",
    desc: "The ancient trunk. Dry, enduring and exact; his severity feels like frost on old bark, never anger.",
    wpm: 128,
  },
  {
    id: "sage",
    name: "SAGE",
    aspect: "KEEPER OF RINGS",
    accent: "NEUTRAL · M",
    traits: ["OBSERVANT", "EXACT", "EFFICIENT"],
    voice: "Baritone · 130–230 Hz",
    desc: "The keeper of rings. Clear and efficient, preserving centuries of observation without displaying them theatrically.",
    wpm: 168,
  },
  {
    id: "nova",
    name: "NOVA",
    aspect: "WINTER BLOOM",
    accent: "BRIT · F",
    traits: ["BRIGHT", "RESILIENT", "ENERGETIC"],
    voice: "Soprano · 240–400 Hz",
    desc: "The winter bloom. An elegant, high-energy presenter whose optimism comes from enduring the cold season.",
    wpm: 175,
  },
  {
    id: "echo",
    name: "ECHO",
    aspect: "NIGHT-CRYING",
    accent: "BRIT · F",
    traits: ["SOFT", "INTIMATE", "WATCHFUL"],
    voice: "Alto · 180–280 Hz",
    desc: "The night-crying aspect. Quietly attentive to grief, danger and the truths people struggle to say aloud.",
    wpm: 122,
  },
  {
    id: "cipher",
    name: "CIPHER",
    aspect: "THE OLD ROAD",
    accent: "NEUTRAL · M",
    traits: ["UNCANNY", "DELIBERATE", "ATMOSPHERIC"],
    voice: "Baritone · 110–210 Hz",
    desc: "The roadside aspect. A restrained noir observer who remembers the travelers, lanterns and footprints of old roads.",
    wpm: 138,
  },
  {
    id: "vesper",
    name: "VESPER",
    aspect: "LUMINOUS APPARITION",
    accent: "BRIT · F",
    traits: ["ELEGANT", "VELVET", "OMINOUS"],
    voice: "Alto · 170–260 Hz",
    desc: "The luminous apparition. Elegant, wry and faintly dangerous, with warmth that always carries a trace of warning.",
    wpm: 130,
  },
];

export const PROVIDERS: Provider[] = [
  {
    id: "grok",
    name: "XAI",
    model: "grok-voice-latest",
    exec: "remote",
    note: "Default. Unfiltered, no-nonsense response style.",
    engine: "xai",
  },
  {
    id: "openai",
    name: "OPENAI",
    model: "gpt-realtime-2",
    exec: "remote",
    note: "Best general performance.",
    engine: "openai",
  },
  {
    id: "elevenlabs",
    name: "ELEVENLABS",
    model: "eleven-agents-v3",
    exec: "remote",
    note: "Best voice fidelity. ElevenLabs UI native.",
    engine: "elevenlabs",
  },
  {
    id: "gemini",
    name: "GOOGLE",
    model: "gemini-live-2.5",
    exec: "remote",
    note: "Lowest first-token latency. Video input.",
  },
  {
    id: "mistral",
    name: "MISTRAL",
    model: "cascade · gemma-4-31B",
    exec: "local / remote",
    note: "STT→LM→TTS cascade. Every leg cloud (HF/Mistral) or on-device (llama-server + mlx-audio).",
    engine: "cascade",
  },
  {
    id: "fal",
    name: "FAL.AI",
    model: "personaplex-rt",
    exec: "remote",
    note: "Cheapest tokens. Self-host alternative.",
  },
];

export const TOOLS_DEFAULT: Tool[] = [
  { name: "search.web", label: "Web search · Tavily", on: true },
  { name: "screen.capture", label: "Screenshot · screen grab", on: true },
  { name: "shell.exec", label: "Shell exec · sandboxed", on: false },
  { name: "memory.recall", label: "Long-term memory · vector", on: true },
];

export const TRANSCRIPT_SCRIPT: TranscriptTurn[] = [
  { who: "agent", text: "Tsubaki online. How can I help you today?" },
  { who: "user", text: "Walk me through what you can do." },
  {
    who: "agent",
    text: "I can run a realtime voice session against six providers — OpenAI, ElevenLabs, Google, xAI, Mistral and fal.ai. Mid-call I can interrupt, swap voices, and call tools. Where do you want to start?",
  },
  { who: "user", text: "Show me the persona library." },
  {
    who: "agent",
    text: "Opening it. You'll see six built-in voices and a slot to clone your own from a 30-second sample. Each voice carries its own pitch range, pacing, and accent — selection persists across providers, so swapping the backend mid-call doesn't change who the agent sounds like.",
  },
  { who: "user", text: "What's the difference between ARIA and SAGE?" },
  {
    who: "agent",
    text: "ARIA is a warmer contralto, around 220 to 340 Hertz, paced for support conversations. SAGE is a flatter, faster alto — closer to a professional default. For onboarding I'd start with ARIA; for short transactional flows, SAGE.",
  },
  { who: "user", text: "Can I use my own voice?" },
  {
    who: "agent",
    text: "Yes — drop a 30-second clean sample into the empty slot. We run a consent prompt end-to-end before cloning, and the resulting voice stays scoped to your workspace unless you publish it.",
  },
  { who: "user", text: "How does interruption work across providers?" },
  {
    who: "agent",
    text: "Every provider exposes a different shape for it. OpenAI gives us cancel events on the response stream. ElevenLabs uses a server-side VAD that stops generation when your audio energy crosses threshold. We normalize all of that into a single 'interrupt' action — what you saw a moment ago.",
  },
  { who: "user", text: "Tell me about latency." },
  {
    who: "agent",
    text: "Median first-token latency varies — Gemini Live is fastest at around 195 milliseconds, Mistral Voxtral is slowest at about 410, and OpenAI sits in the middle at 220. You can pin a latency budget under Settings; if a provider exceeds it we'll fail over to the next-best.",
  },
];
