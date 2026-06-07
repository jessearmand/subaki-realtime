// Sample data ported from the design bundle (screens.jsx).
// Single source of truth for personas, providers, tools and the mock transcript.

export interface Persona {
  id: string;
  name: string;
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
  latency: number;
  status: "ready" | "beta";
  region: string;
  note: string;
  // Which real engine drives this row. Absent ⇒ the design's mock lifecycle.
  engine?: "elevenlabs" | "xai" | "openai";
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
    accent: "AMER · F",
    traits: ["WARM", "CALM", "MEASURED"],
    voice: "Mezzo · 220–340 Hz",
    desc: "A patient, low-tempo contralto. Tuned for long form support conversations and onboarding.",
    wpm: 142,
  },
  {
    id: "onyx",
    name: "ONYX",
    accent: "BRIT · M",
    traits: ["DEEP", "DRY", "LACONIC"],
    voice: "Bass · 95–180 Hz",
    desc: "A gravelly broadcast baritone. Reads numbers and proper nouns like he means it.",
    wpm: 128,
  },
  {
    id: "sage",
    name: "SAGE",
    accent: "NEUTRAL · M",
    traits: ["CLEAR", "NEUTRAL", "FAST"],
    voice: "Baritone · 130–230 Hz",
    desc: "Professional-default. Even pacing, minimal affect, near-zero hallucinated emotion.",
    wpm: 168,
  },
  {
    id: "nova",
    name: "NOVA",
    accent: "BRIT · F",
    traits: ["BRIGHT", "UPBEAT", "ENERGETIC"],
    voice: "Soprano · 240–400 Hz",
    desc: "High-energy British presenter. Best for pitches, demos and walkthroughs.",
    wpm: 175,
  },
  {
    id: "echo",
    name: "ECHO",
    accent: "BRIT · F",
    traits: ["SOFT", "INTIMATE", "CLOSE-MIC"],
    voice: "Alto · 180–280 Hz",
    desc: "A soft, close-mic alto. Recorded as if speaking six inches from the listener.",
    wpm: 122,
  },
  {
    id: "cipher",
    name: "CIPHER",
    accent: "NEUTRAL · M",
    traits: ["NOIR", "DELIBERATE", "ATMOSPHERIC"],
    voice: "Baritone · 110–210 Hz",
    desc: "A mystery-novel narrator — atmospheric, deliberate, with an ear for the telling detail.",
    wpm: 138,
  },
];

export const PROVIDERS: Provider[] = [
  {
    id: "openai",
    name: "OPENAI",
    model: "gpt-realtime-2",
    latency: 220,
    status: "ready",
    region: "US-EAST",
    note: "Default. Best general performance.",
    engine: "openai",
  },
  {
    id: "elevenlabs",
    name: "ELEVENLABS",
    model: "eleven-agents-v3",
    latency: 310,
    status: "ready",
    region: "EU-WEST",
    note: "Best voice fidelity. ElevenLabs UI native.",
    engine: "elevenlabs",
  },
  {
    id: "gemini",
    name: "GOOGLE",
    model: "gemini-live-2.5",
    latency: 195,
    status: "ready",
    region: "US-CENTRAL",
    note: "Lowest first-token latency. Video input.",
  },
  {
    id: "grok",
    name: "XAI",
    model: "grok-voice-latest",
    latency: 280,
    status: "beta",
    region: "US-WEST",
    note: "Unfiltered. No-nonsense response style.",
    engine: "xai",
  },
  {
    id: "mistral",
    name: "MISTRAL",
    model: "voxtral-mini",
    latency: 410,
    status: "ready",
    region: "EU-FR",
    note: "EU-resident. Best multilingual coverage.",
  },
  {
    id: "fal",
    name: "FAL.AI",
    model: "personaplex-rt",
    latency: 240,
    status: "ready",
    region: "US-WEST",
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
