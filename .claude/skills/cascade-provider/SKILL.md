---
name: cascade-provider
description: Set up, configure, or debug Tsubaki's cascade (MISTRAL) voice provider — the turn-based STT → LM → TTS engine. Use when working on Mistral realtime STT / the bun WS proxy, Silero VAD turn-taking, push-to-talk, the /api/llm, /api/tts, /api/stt routes, the LM catalog (config/lm-models.json, incl. Tinker/Inkling backends), the voice-legs catalog (config/voice-models.json), or the fully-local cascade stack.
---

# Cascade provider (STT → LM → TTS)

The **MISTRAL** provider row runs a turn-based cascade instead of a single
realtime model: **Mistral realtime STT** (via a bun WS proxy) → **`/api/llm`**
(catalog-driven streaming chat completion) → **`/api/tts`** (per-clause audio).
Turn boundaries are always client-side (Silero VAD or the Send button) — neither
Mistral nor the local servers detect turns.

## Quick start

```bash
mise run dev        # dev server + STT proxy, all fnox secrets loaded
```

Secrets live in **fnox** (`fnox.toml`), never in `.env` files:

| Secret | Used by |
| --- | --- |
| `MISTRAL_API_KEY` | realtime STT (proxy), TTS, and the `mistral` LM backend |
| `HF_TOKEN` | LM backend `hf` (HF Inference router) |
| `TINKER_API_KEY` | LM backend `tinker` (Thinking Machines Inkling) |

All keys are read server-side only (routes/proxy); the browser never sees them.

## Key files

- `lib/realtime/use-cascade-session.ts` — the engine hook (state machine, STT
  reconnect, Web Speech fallback, LM/TTS orchestration)
- `lib/realtime/mistral-stt.ts` — 16 kHz mic capture + realtime-STT client +
  batch turn recorder + the tuned VAD constants
- `lib/realtime/silero-vad.ts` — Silero VAD via onnxruntime-web (WASM)
- `lib/realtime/cascade-agent.ts` — per-persona prompt / opening line / Mistral
  `ttsVoice` slug (+ optional `lmModelId` pin)
- `lib/realtime/lm-config.ts` / `config/lm-models.json` — LM catalog
- `lib/realtime/voice-config.ts` / `config/voice-models.json` — TTS/STT catalog
- `app/api/llm/route.ts` · `app/api/tts/route.ts` · `app/api/stt/route.ts`
- `scripts/mistral-stt-proxy.ts` — standalone bun WS proxy (:3001)

## Realtime STT and the WS proxy

Mistral's realtime-transcription WebSocket
(`voxtral-mini-transcribe-realtime-2602`) authenticates with an
`Authorization: Bearer` header on the handshake — a browser `WebSocket` cannot
set request headers. `scripts/mistral-stt-proxy.ts` is a dumb bun pipe: browser
connects header-lessly, the proxy opens the authenticated upstream socket and
forwards frames verbatim both ways. `MISTRAL_API_KEY` never reaches the client.

- `mise run dev` starts the proxy automatically (and stops it with the server).
  Standalone: `mise run stt-proxy` / `mise run stop-stt-proxy`
  (port `STT_PROXY_PORT`, default 3001; `/health` endpoint for checks).
- Browser-side URL: `NEXT_PUBLIC_MISTRAL_STT_WS` (default `ws://localhost:3001`).
- **Reconnect**: if the STT socket dies mid-call, `use-cascade-session.ts`
  retries up to `MAX_STT_RECONNECTS` (2) with a 500 ms delay, then falls back
  **loudly** (console warning) to browser **Web Speech** (Chrome-only) for the
  rest of the call. A successful reconnect resets the budget.
- **Zombie-stream watchdog** (`EMPTY_TURN_MIN_SPEECH_MS` in `mistral-stt.ts`):
  the upstream WS can stop delivering deltas *without* closing — no
  onclose/onerror, so the reconnect above never triggers, and every turn ends
  empty (VAD fires, nothing transcribed → the call feels frozen while
  "listening"). If the VAD attests ≥ 1 s of real speech but the flush yields
  zero text, the session reports an error and the reconnect path takes over;
  the caption asks the user to repeat.
- If the proxy simply isn't running at CALL, the browser logs a harmless
  `ERR_CONNECTION_REFUSED` and STT starts on the Web Speech fallback.

## Turn-taking

Three mechanisms, all client-side:

1. **Auto (Silero VAD).** `lib/realtime/silero-vad.ts` runs Silero VAD in the
   browser via onnxruntime-web WASM — per-frame speech probability (512-sample
   / 32 ms frames + 64-sample rolling context @ 16 kHz) drives a hysteresis
   state machine; `onSpeechEnd` ends the turn. Model (`snakers4/silero-vad`,
   pinned `SILERO_TAG = "v6.2.1"`) and ORT WASM (`ORT_VERSION = "1.27.0"`,
   keep in sync with package.json) load from jsDelivr at call start — no model
   binary in the repo. If the CDN load fails, transcription still works; use
   Send.
2. **Send button** — `endTurnNow()` ends the turn instantly, bypassing the
   silence gate (enabled only while listening).
3. **Push-to-talk** (Settings → BEHAVIOUR, `pushToTalk` tweak) — disables
   Silero's end-of-speech action entirely (`setAutoEndTurns(false)`, applies
   live mid-call, both realtime and batch STT legs); only Send ends a turn.
   Web Speech endpoints on its own, so in PTT its finals are buffered until
   Send flushes them.

Tuned constants (in `lib/realtime/mistral-stt.ts`, tuned from real traces):

| Constant | Value | Meaning |
| --- | --- | --- |
| `VAD_REDEMPTION_MS` | 1400 | silence after speech that ends the turn ("let me finish" window) |
| `VAD_POSITIVE` | 0.3 | speech-probability onset threshold |
| `VAD_NEGATIVE` | 0.15 | release threshold (below the soft-speech band) |
| `VAD_MIN_SPEECH_MS` | 160 | shortest run that counts as a real turn |
| `FLUSH_GRACE_MS` | 1000 | wait for trailing transcript deltas after flush — must cover the session's `target_streaming_delay_ms` (1000), or turns lose their last words |

**Debug tracing**: set `localStorage["tsubaki.vad-debug"] = "1"` — the VAD keeps
a rolling per-frame probability trace and logs it on every state transition.

**Dead-air continuation** (`onUserTurn` in `use-cascade-session.ts`): the mic is
NOT paused when a turn ends — it stays live while the LM streams and is gated
(`gateMic`) only when the first reply clause starts TTS synthesis, just ahead of
playback so speaker bleed never reaches it. Speech completed in that window
arrives as a fresh `onFinal` → a continuation turn: the in-flight reply is
aborted and dropped from transcript + LM history (the user never heard it), and
the new text is merged into the pending user message (one message — some chat
APIs reject consecutive `user` roles) before re-querying. This matters most for
slow backends (serverless cold starts): without it, anything said while the
model thinks lands on a paused mic and vanishes. Once audio is playing, user
speech is barge-in territory (not implemented), no longer continuation.

## LM leg — `config/lm-models.json`

`/api/llm` streams an OpenAI-compatible chat completion from a catalog-chosen
backend. The catalog is read by both the route (`app/api/llm/route.ts`) and the
client (`cascade-agent.ts`) via `lib/realtime/lm-config.ts` — no live model
list is fetched.

- **`default`** — the model id every persona uses (currently `gemma-4-31b`).
- **`backends`** — `hf` (HF router; models can pin a provider with a
  `:provider` suffix like `:fastest`, `:cerebras`), `mistral`, `local`
  (keyless — empty `envKey` means no Authorization header), and `tinker`.
- **`envKey`** names the fnox secret read server-side; only the env-var *name*
  and public URL live in the file.
- **`supportsThinking`** sends `chat_template_kwargs.enable_thinking:false`
  (reasoning models answer immediately). Leave `false` for APIs that reject
  unknown fields — Mistral 422s on it, the HF router rejects it with
  `wrong_api_format`.
- **`extraBody`** merges backend-specific fields verbatim into the upstream
  request. The `tinker` backend (Thinking Machines' OpenAI-compatible endpoint,
  `TINKER_API_KEY`) uses it to send `reasoning_effort: "none"` — Inkling is a
  hybrid reasoning model that would otherwise think at effort 0.9 before the
  first spoken token. Its reasoning streams on a separate `reasoning_content`
  field the client ignores, so chain-of-thought can never reach TTS.
- The catalog carries **all six Inkling variants**: `Inkling` and
  `Inkling-Small`, each as base, 256K (`:peft:262144`), and serverless
  (`:peft:262144:sampling-nvfp4`, beta tier).

Model precedence at runtime: the Providers **LM MODEL** picker (persisted in
localStorage `tsubaki.lm-model`, via `hooks/use-lm-model.ts`) > a persona's
`lmModelId` in `cascade-agent.ts` > the catalog `default`.

Without the chosen backend's key, the agent turn shows "— LM error —".

## Voice legs — `config/voice-models.json`

TTS and STT each have a `mistral` (cloud) and a `local` backend
(`lib/realtime/voice-config.ts`); `default` picks per leg, overridable per
dev-session without editing config:

```bash
NEXT_PUBLIC_TTS_BACKEND=local NEXT_PUBLIC_STT_BACKEND=local mise run dev
```

- **TTS** — `POST /api/tts` (note: the route is `/api/tts`, not
  `/api/mistral/tts`) resolves the backend server-side: Mistral
  (`voxtral-mini-tts-2603`, responseShape `mistral-json` = `{audio_data}`
  base64) or the local mlx-audio server (`Voxtral-4B-TTS-2603` 6-bit,
  responseShape `audio-bytes` = raw bytes). Called **per clause** so playback
  pipelines with the LM stream. The backend's `voiceMap` translates each
  persona's Mistral `voice_id` slug (`gb_jane_neutral`, …) to a local preset
  (`casual_female`, …) — recast persona voices there, not in code. Without
  `MISTRAL_API_KEY`, TTS falls back to browser `speechSynthesis`.
- **STT** — two capture modes. `mistral` = realtime WS via the proxy (live
  partial captions). `local` = **batch**: Silero VAD still owns turn
  boundaries; the finished turn's PCM is encoded as one WAV
  (`lib/realtime/wav.ts`) and POSTed to `/api/stt?backend=local`, which
  forwards multipart to the local mlx-audio `/v1/audio/transcriptions`
  (`Voxtral-Mini-4B-Realtime` 4-bit). No live captions in batch mode.

## Fully-local stack

```bash
mise run lm-local          # llama-server :8001 — gemma-4-12B QAT GGUF + MTP
                           #   speculative decoding; weights under
                           #   ~/Develop/voice-cascade/models/gemma-4-12B/
                           #   (LM_LOCAL_MODEL_DIR / LM_LOCAL_PORT overrides);
                           #   --alias must match the catalog entry's `model`
mise run audio-local       # mlx-audio :8002 — both voice legs; lazy model load
                           #   (~5 s cold, ~7 GB resident); MLX_AUDIO_DIR /
                           #   AUDIO_LOCAL_PORT overrides
mise run local-stack       # both in one terminal; Ctrl-C tears both down
mise run stop-lm-local | stop-audio-local | stop-local-stack
```

Then pick **Gemma 4 12B QAT · local** in the Providers LM picker and set both
`NEXT_PUBLIC_*_BACKEND=local`. Voxtral TTS weights are **CC-BY-NC** (dev/eval
only). Background/roadmap: [docs/voxtral-local-inference.md](../../../docs/voxtral-local-inference.md).

## Gotchas

- Turn boundaries are always client-side; push-to-talk only disables the VAD's
  end-of-speech *action* — the VAD still runs (speech-start cancels a pending
  flush so a resumed thought keeps building the same turn).
- `FLUSH_GRACE_MS` must stay ≥ the session's `target_streaming_delay_ms`
  (both 1000) or emitted turns lose their trailing words.
- StrictMode: `setTurns` updaters in the hook must stay pure (no ref mutation
  inside) or transcript turns get dropped.
- A denied mic permission does not trigger the Web Speech fallback (it needs
  the mic too) — the user is asked again instead.
