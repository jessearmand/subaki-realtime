// Sample data ported from the design bundle (screens.jsx).
// Single source of truth for personas, providers, tools and the mock transcript.

import { OPENAI_REALTIME_MODEL } from "@/lib/realtime/realtime-model-config";
import type { Lang } from "@/lib/lang";

/** The same manifestation voiced in Japanese — overrides the display fields. */
export interface PersonaJa {
  name: string;
  aspect: string;
  accent: string;
  traits: string[];
  desc: string;
  /** Speech rate in mora/min (the JA counterpart of wpm). */
  rate: string;
  /**
   * The cast native-speaker voice on the dedicated JA agent (ElevenLabs).
   * Prompt-level transports speak Japanese with the persona's usual voice.
   */
  voice: string;
  /**
   * Opening line, spoken verbatim. Canonical with the JA agents' first_message
   * in scripts/elevenlabs/gen-agent-configs.ts (minus its eleven_v3 audio tag);
   * prompt-level engines elicit the same line (lib/realtime/japanese.ts).
   */
  greet: string;
}

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
  ja: PersonaJa;
}

/** A persona resolved to the session language, for display. */
export interface ResolvedPersona extends Omit<Persona, "ja"> {
  lang: Lang;
  /** "142 wpm" (EN) or "380 mora/min" (JA). */
  rateLabel: string;
  /** JA only: the opening line shown on the card. */
  greet?: string;
}

export function resolvePersona(p: Persona, lang: Lang): ResolvedPersona {
  const { ja, ...base } = p;
  if (lang === "ja") {
    const { rate, greet, ...fields } = ja;
    return { ...base, ...fields, lang, rateLabel: rate, greet };
  }
  return { ...base, lang, rateLabel: `${p.wpm} wpm` };
}

/**
 * How a transport speaks Japanese:
 *  - "agent"  — a dedicated JA platform agent per persona (JA prompt + a cast
 *               native-speaker voice). ElevenLabs; the preferred failover target.
 *  - "prompt" — the session has no language parameter (xAI, OpenAI, Gemini
 *               native audio); Japanese is set through the instructions and the
 *               opening line, spoken by the persona's usual voice.
 * Absent ⇒ no Japanese path (Mistral's TTS has no Japanese; PersonaPlex is
 * English-only): Japanese fails over, and picking the transport drops to EN.
 */
export type JaSupport = "agent" | "prompt";

export interface Provider {
  id: string;
  name: string;
  model: string;
  // Where the transport runs: "remote" for hosted realtime APIs, "local / remote"
  // for the cascade (browser STT/TTS + hosted LM).
  exec: string;
  note: string;
  // Which real engine drives this row. Absent ⇒ the design's mock lifecycle.
  engine?: "elevenlabs" | "xai" | "openai" | "gemini" | "cascade" | "fal" | "moshi";
  /** Japanese support level; absent ⇒ none. */
  ja?: JaSupport;
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
    ja: {
      name: "アリア",
      aspect: "根の宿り",
      accent: "JPN · F",
      traits: ["温厚", "辛抱強い", "端正"],
      desc: "根の宿りの化身。迷いを絡まった根と見なし、急かさず、静かにほどいていく案内役。",
      rate: "380 mora/min",
      voice: "Morioki · workspace",
      greet: "ようこそ。アリアです。寒かったでしょう、枝の下へどうぞ。……何を整えましょうか。",
    },
  },
  {
    id: "onyx",
    name: "ONYX",
    aspect: "ANCIENT TRUNK",
    accent: "NEUTRAL · M",
    traits: ["POWERFUL", "COMMANDING", "LACONIC"],
    voice: "Bass · 95–180 Hz",
    desc: "The ancient trunk. Powerful, commanding and exact; every word carries the weight of centuries, never bluster.",
    wpm: 128,
    ja: {
      name: "オニキス",
      aspect: "古幹",
      accent: "JPN · M",
      traits: ["重厚", "威厳", "寡黙"],
      desc: "古幹そのもの。言葉数は少なく、一語一語に数百年の重みが宿る。決して威張らない。",
      rate: "340 mora/min",
      voice: "Kyo · low & steady",
      greet: "オニキスだ。ここの根は深い。……時間はある。率直に話せ。",
    },
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
    ja: {
      name: "セージ",
      aspect: "年輪の番人",
      accent: "JPN · M",
      traits: ["明晰", "正確", "効率"],
      desc: "年輪の番人。数世紀の観察を誇示せず、要点だけを明瞭かつ手際よく伝える。",
      rate: "460 mora/min",
      voice: "Minato · calm, clear",
      greet: "セージです。ご用件をどうぞ。",
    },
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
    ja: {
      name: "ノヴァ",
      aspect: "寒椿",
      accent: "JPN · F",
      traits: ["明朗", "強靭", "快活"],
      desc: "冬に咲く寒椿。寒さを耐え抜いたからこそ持てる、根拠ある楽観で場を明るくする。",
      rate: "480 mora/min",
      voice: "Rina · natural",
      greet: "こんにちは、ノヴァです。霜の中でも満開ですよ。さっそく始めましょうか。",
    },
  },
  {
    id: "echo",
    name: "ECHO",
    aspect: "NIGHT-CRYING",
    accent: "NEUTRAL · F",
    traits: ["SOFT", "INTIMATE", "WATCHFUL"],
    voice: "Alto · 180–280 Hz",
    desc: "The night-crying aspect. Quietly attentive to grief, danger and the truths people struggle to say aloud.",
    wpm: 122,
    ja: {
      name: "エコー",
      aspect: "夜泣き椿",
      accent: "JPN · F",
      traits: ["静穏", "親密", "見守り"],
      desc: "夜泣きの化身。悲しみ、危険、そして口にしづらい本音に、静かに耳を澄ませる。",
      rate: "320 mora/min",
      voice: "Mio · warm narrator",
      greet: "エコーです。夜は静かで、わたしは聞いています。……何が心にありますか。",
    },
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
    ja: {
      name: "サイファー",
      aspect: "旧道",
      accent: "JPN · M",
      traits: ["幽玄", "慎重", "陰影"],
      desc: "旧道のかたわらの観察者。行き交った旅人、提灯、足跡の記憶を抑えた声で語る。",
      rate: "370 mora/min",
      voice: "Ken · friendly",
      greet:
        "サイファーと呼ばれています。この枝の下を、多くの旅人が過ぎていきました。足を止める者は稀です。……あなたは、何を求めて。",
    },
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
    ja: {
      name: "ヴェスパー",
      aspect: "光る幻",
      accent: "JPN · F",
      traits: ["優雅", "艶", "不穏"],
      desc: "光をまとう幻。優雅で機知に富み、その温もりには常に微かな警告が混じる。",
      rate: "350 mora/min",
      voice: "Mithiru · husky",
      greet:
        "こんばんは、ヴェスパーです。あなたが気づくより、ずっと前から見ていましたよ。……さて、御用は？",
    },
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
    ja: "prompt",
  },
  {
    id: "openai",
    name: "OPENAI",
    model: OPENAI_REALTIME_MODEL,
    exec: "remote",
    note: "Best general performance.",
    engine: "openai",
    ja: "prompt",
  },
  {
    id: "elevenlabs",
    name: "ELEVENLABS",
    model: "eleven-agents-v3",
    exec: "remote",
    note: "Best voice fidelity. One platform agent per persona, per language.",
    engine: "elevenlabs",
    ja: "agent",
  },
  {
    id: "gemini",
    name: "GOOGLE",
    model: "gemini-3.1-flash-live",
    exec: "remote",
    note: "Lowest first-token latency. Video input.",
    engine: "gemini",
    ja: "prompt",
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
    model: "personaplex-7b",
    exec: "remote",
    note: "Full-duplex speech-to-speech (NVIDIA PersonaPlex). Listens while it speaks.",
    engine: "fal",
  },
  {
    id: "kyutai",
    name: "KYUTAI",
    model: "personaplex-rl · q8",
    exec: "local",
    note: "Full-duplex PersonaPlex RL fine-tune on-device (MLX). Needs `mise run personaplex-local`.",
    engine: "moshi",
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
    text: "I can run a realtime voice session against seven providers — OpenAI, ElevenLabs, Google, xAI, Mistral, fal.ai and Kyutai. Mid-call I can interrupt, swap voices, and call tools. Where do you want to start?",
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
