// Catalog of TTS + STT backends for the cascade engine's voice legs.
//
// Mirrors lm-config.ts: the data lives in `config/voice-models.json`, read by
// both the server routes (`app/api/tts`, `app/api/stt` — which resolve a
// backend's URL + secret env key) and the client session (which picks the
// backend id and the STT capture mode). Only env var *names* and public URLs
// live here; secret values stay in fnox and are read server-side. An empty
// `envKey` marks a keyless local backend (mlx-audio server via
// `mise run audio-local`).
//
// The default backend per leg comes from the catalog, overridable per
// dev-session with NEXT_PUBLIC_TTS_BACKEND / NEXT_PUBLIC_STT_BACKEND — so
// flipping a leg cloud ↔ local is an env var, not a config edit.

import catalog from "@/config/voice-models.json";

export interface TtsBackendConfig {
  /** Speech endpoint (Mistral /v1/audio/speech or an OpenAI-style local one). */
  url: string;
  /** Secret env var name (server-side only). Empty = keyless local backend. */
  envKey: string;
  /** Upstream TTS model id. */
  model: string;
  /** How the upstream returns audio: `mistral-json` = {audio_data: base64};
   *  `audio-bytes` = raw audio body (OpenAI-style). */
  responseShape: "mistral-json" | "audio-bytes";
  /** Sampling temperature (local voxtral_tts: ~0.5 tightens pauses). */
  temperature?: number;
  /** Fallback voice when a slug has no `voiceMap` entry. */
  defaultVoice?: string;
  /** Mistral voice_id slug → this backend's preset name. Lets cascade-agent
   *  keep one `ttsVoice` string per persona across backends. */
  voiceMap?: Record<string, string>;
}

export interface SttBackendConfig {
  /** `realtime` = Mistral WS via the Bun proxy; `batch` = per-turn POST of the
   *  finished turn's WAV to /api/stt (Silero VAD still owns the boundaries). */
  mode: "realtime" | "batch";
  /** Batch transcription endpoint (unused for `realtime`). */
  url?: string;
  /** Secret env var name (server-side only). Empty/absent = keyless. */
  envKey?: string;
  /** Upstream STT model id (batch mode). */
  model?: string;
}

interface VoiceCatalog {
  tts: { default: string; backends: Record<string, TtsBackendConfig> };
  stt: { default: string; backends: Record<string, SttBackendConfig> };
}

const CONFIG = catalog as unknown as VoiceCatalog;

/** Look up a TTS backend by id, falling back to the catalog default. */
export function resolveTtsBackend(id?: string): TtsBackendConfig | undefined {
  return CONFIG.tts.backends[id || CONFIG.tts.default];
}

/** Look up an STT backend by id, falling back to the catalog default. */
export function resolveSttBackend(id?: string): SttBackendConfig | undefined {
  return CONFIG.stt.backends[id || CONFIG.stt.default];
}

/** Backend id each leg uses this session: env override > catalog default. */
export const DEFAULT_TTS_BACKEND_ID: string =
  process.env.NEXT_PUBLIC_TTS_BACKEND || CONFIG.tts.default;
export const DEFAULT_STT_BACKEND_ID: string =
  process.env.NEXT_PUBLIC_STT_BACKEND || CONFIG.stt.default;
