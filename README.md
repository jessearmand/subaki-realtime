# TSUBAKI — realtime voice console

[![Oxc](https://github.com/jessearmand/subaki-realtime/actions/workflows/oxc.yml/badge.svg)](https://github.com/jessearmand/subaki-realtime/actions/workflows/oxc.yml)
[![Build](https://github.com/jessearmand/subaki-realtime/actions/workflows/build.yml/badge.svg)](https://github.com/jessearmand/subaki-realtime/actions/workflows/build.yml)
[![CodeQL](https://github.com/jessearmand/subaki-realtime/actions/workflows/codeql.yml/badge.svg)](https://github.com/jessearmand/subaki-realtime/actions/workflows/codeql.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A brutalist/editorial realtime voice console, recreated from a Claude Design
handoff and built on **ElevenLabs UI** primitives. Four screens — Sessions
(call), Personas, Providers, Settings — with a full call lifecycle
(idle → connecting → listening → speaking → interrupted → ended).

Multi-provider by design: the UI binds to a provider-agnostic session adapter.
Every provider row runs the mocked lifecycle except **ElevenLabs**, which is
wired to a real agent via `@elevenlabs/react`.

## Stack

- **Next.js** (App Router) · **React 19** · **Tailwind v4**
- **bun** package manager · **oxlint** + **oxfmt** (lint/format)
- **ElevenLabs UI** (shadcn-style, copied into `components/ui/`): `Orb` (WebGL,
  gradient style), `BarVisualizer` (soundbars), `MicSelector` (device picker)
- Hybrid orb: ElevenLabs WebGL orb for `gradient`; ported CSS/SVG orb for
  `mono` / `particles`

## Getting started

```bash
bun install
bun run dev        # http://localhost:3000
```

Or via **mise** tasks (load fnox secrets and give you a clean stop):

```bash
mise run dev       # dev server + Mistral STT proxy (all fnox keys loaded)
mise run stop      # stop the server on PORT (default 3000)
```

`mise run dev` also starts the realtime-STT proxy in the background (and stops it
with the server) so the cascade engine works out of the box — see the Cascade
section below.

Other scripts:

```bash
bun run lint       # oxlint
bun run fmt        # oxfmt (write)
bun run build      # production build
```

## Wiring the real ElevenLabs provider

Create `.env.local` (gitignored):

```bash
# Public agent: ID is enough. Private agents need a signed-URL token route.
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=your-agent-id
ELEVENLABS_API_KEY=your-api-key
```

Then pick the **ELEVENLABS** row under Providers and press CALL — it grants the
mic, streams a live transcript, and drives the orb/bars from real audio.

## Wiring the real xAI Grok provider

xAI's realtime API is **WebSocket-only** (no native browser WebRTC). The browser
connects directly to `wss://api.x.ai/v1/realtime`, authenticated by a short-lived
**ephemeral client-secret** minted server-side at `POST /api/xai/token` — the
secret `XAI_API_KEY` never reaches the client.

The only secret is the API key — keep it in **fnox** and run via
`fnox exec -- bun run dev`. No `XAI_*` values live in `.env` files.

Everything declarative (model, voice, multi-line instructions, opening line,
tools) lives in a typed config module — **`lib/realtime/xai-agent.ts`** — the way
ElevenLabs keeps each agent in `agent_configs/*.json`. It's a shared `BASE`
(model/tools/turn-detection) plus a **per-persona** map: each app persona
(`ARIA`/`ONYX`/`SAGE`/`NOVA`/`ECHO`/`CIPHER`) maps to a Grok voice + its own
prompt + greeting. The selected persona drives the live session via
`resolveXaiAgent(personaId)`. Edit that file to personalize — no env strings.

Pick the **XAI** row under Providers (it's the default), choose a persona, and
press CALL — it mints a token, opens the WebSocket, captures the mic as PCM16,
plays the agent's audio, streams transcripts, and barges in on server-VAD speech
detection. Without `XAI_API_KEY` set, CALL shows a clear "XAI_API_KEY is not set"
caption instead of connecting.

## Wiring the real OpenAI provider

OpenAI's realtime API (`gpt-realtime-2`) connects over **WebRTC** — the browser's
peer connection carries the audio both ways, so there's no hand-rolled PCM
pipeline. A short-lived **ephemeral key** is minted server-side at
`POST /api/openai/token`; the browser then POSTs its SDP offer straight to
`https://api.openai.com/v1/realtime/calls` with that key, and session control +
transcripts flow over the `oai-events` data channel. The secret `OPENAI_API_KEY`
never reaches the client.

Keep `OPENAI_API_KEY` in **fnox** and run via `fnox exec -- bun run dev`. No
`OPENAI_*` values live in `.env` files.

Per-persona config (voice, multi-line instructions, opening line, reasoning
effort, turn-detection) lives in the typed module **`lib/realtime/openai-agent.ts`**
— a shared `BASE` (model / reasoning / `gpt-realtime-whisper` input transcription /
turn-detection) plus a per-persona map of OpenAI voice + prompt + greeting,
resolved by `resolveOpenaiAgent(personaId)`. The persona `instructions` follow a
light slice of OpenAI's Realtime 2.0 prompt skeleton (Role, Personality & Tone,
Pacing, Unclear Audio, Variety).

Pick the **OPENAI** row under Providers, choose a persona, and press CALL — it
mints a key, negotiates WebRTC, plays the agent's audio, shows the user + agent
transcripts (whisper for input), and barges in on server-VAD speech detection.
Without `OPENAI_API_KEY` set, CALL shows a clear "OPENAI_API_KEY is not set"
caption instead of connecting.

## Wiring the Cascade provider (STT → LM → TTS)

The **MISTRAL** row runs a turn-based cascade instead of a single full-duplex
model: **Mistral realtime STT** → **`/api/llm`** (LM) → **`/api/mistral/tts`**
(Voxtral TTS). Per-persona prompt/voice live in `lib/realtime/cascade-agent.ts`
(voices are Mistral slugs like `en_paul_neutral`); the **LM model is configured
separately** (see below):

```bash
# in fnox (run via `fnox exec -- bun run dev` / `mise run dev`)
HF_TOKEN=hf_...            # LM backend "hf"  (HF Inference router, any served model)
MISTRAL_API_KEY=...        # STT, TTS, and LM backend "mistral" (mistral-small-latest)
```

**Realtime STT runs through a WS proxy.** Mistral's realtime-transcription
endpoint (`voxtral-mini-transcribe-realtime-2602`) is a WebSocket that
authenticates with an `Authorization: Bearer` header on the handshake — and a
browser `WebSocket` cannot set request headers. So a tiny **bun WS proxy**
(`scripts/mistral-stt-proxy.ts`) sits between them: the browser connects to it
header-lessly, and it opens the authenticated upstream socket and pipes frames
both ways. `MISTRAL_API_KEY` never reaches the client.

`mise run dev` starts this proxy for you (and stops it with the server). To run
it on its own:

```bash
mise run stt-proxy        # = fnox exec -- bun run scripts/mistral-stt-proxy.ts (:3001)
mise run stop-stt-proxy   # stop it (port STT_PROXY_PORT, default 3001)
```

If the proxy isn't running when you press CALL on MISTRAL, the browser logs a
`ws://localhost:3001 … ERR_CONNECTION_REFUSED` error and STT falls back to Web
Speech — harmless, but `mise run dev` avoids it by starting the proxy up front.

The browser captures the mic at 16 kHz PCM16, streams it to the proxy, and turns
Mistral's `transcription.text.delta` events into user turns. Turn boundaries are
client-side, with two ways to end a turn:

- **Auto (Silero VAD).** `lib/realtime/silero-vad.ts` runs **Silero VAD** in the
  browser via `onnxruntime-web` (WASM) — a neural voice-activity detector that
  answers *"did the user stop talking?"* (Mistral answers *"what did they say?"*).
  Per-frame speech probability drives a hysteresis state machine; `onSpeechEnd`
  ends the turn. This replaced an energy/RMS gate that sat below most rooms' noise
  floor and never fired. Tunables (in `mistral-stt.ts`): `VAD_REDEMPTION_MS` (the
  "let me finish" window), `VAD_POSITIVE`/`VAD_NEGATIVE`, `VAD_MIN_SPEECH_MS`. The
  ~2 MB model (snakers4/silero-vad, 64-sample context + 512 frame @ 16 kHz) and the
  ORT WASM both load from jsDelivr at call-start, pinned to `SILERO_TAG` /
  `ORT_VERSION` in `silero-vad.ts` — no model binary in the repo. If it fails to
  load (offline / CDN down), transcription still works — use Send.
- **Manual send.** A **Send-turn** button (the arrow-into-bar glyph, enabled only
  while listening) ends your turn instantly via `endTurnNow()` — the dependable
  override when you want to barge ahead.

The proxy URL is `NEXT_PUBLIC_MISTRAL_STT_WS` (default `ws://localhost:3001`). **If
the proxy is down or the mic is denied, STT automatically falls back to browser
Web Speech** (Chrome-only), so the cascade still works with just the dev server.

`/api/llm` streams an OpenAI-compatible chat completion from the chosen backend,
keeping the key server-side; backends that `supportsThinking` run with thinking off
by default (`chat_template_kwargs` — Mistral rejects it, so its catalog entry sets
it false) so reasoning models answer immediately. `/api/mistral/tts` returns
per-clause MP3 from `voxtral-mini-tts-2603`. Without the LM backend's token the
agent turn shows "— LM error —"; without `MISTRAL_API_KEY` TTS falls back to
browser speechSynthesis.

### Configuring the cascade LM

The LM model isn't hard-coded — it's a catalog in **`config/lm-models.json`**, read
by both the server route (`app/api/llm`) and the client agent
(`lib/realtime/cascade-agent.ts`) via `lib/realtime/lm-config.ts`. No live model
list is fetched. To change the model every cascade persona uses, edit `default`:

```jsonc
{
  "default": "mistral-small",          // ← the active model id
  "backends": {
    "hf":      { "url": "https://router.huggingface.co/v1/chat/completions", "envKey": "HF_TOKEN",        "supportsThinking": true },
    "mistral": { "url": "https://api.mistral.ai/v1/chat/completions",        "envKey": "MISTRAL_API_KEY", "supportsThinking": false }
  },
  "models": [
    { "id": "gemma-4-31b", "label": "...", "backend": "hf",      "model": "google/gemma-4-31B-it", "temperature": 0.7, "maxTokens": 200 },
    { "id": "mistral-small", "label": "...", "backend": "mistral", "model": "mistral-small-latest", "temperature": 0.7, "maxTokens": 200 }
  ]
}
```

- **Add a model**: append to `models` (any model the backend serves — e.g. another
  HF-router repo) and point `default` at its `id`.
- **Add a backend**: add an entry to `backends` (OpenAI-compatible `url` + the
  `envKey` naming its fnox secret); reference it from a model's `backend`. The key
  value stays in fnox and is read server-side only — only the env var *name* and the
  public URL live in the file.
- **Per-persona override**: give a persona an `lmModelId` (a catalog id) in
  `cascade-agent.ts` to pin it to a different model than the global default.

At runtime, the **Providers** view shows an **LM MODEL** picker inset under any
provider whose engine has a multi-model catalog (just the cascade today) — pick a
model there and it persists (localStorage `tsubaki.lm-model`) and applies on the
next turn. Precedence: that runtime pick > a persona's `lmModelId` > the catalog
`default`. Providers with a single fixed model show no inset.

## Architecture

```
app/                       layout (fonts), globals.css (brutalist + orb styles), page (ConversationProvider)
app/api/xai/token/         route handler that mints the xAI ephemeral client-secret
app/api/openai/token/      route handler that mints the OpenAI ephemeral key
app/api/llm/               streaming chat-completion route (catalog-driven backend) for the cascade engine
app/api/mistral/tts/       Mistral Voxtral TTS route (per-clause MP3) for the cascade engine
config/lm-models.json      cascade LM catalog (backends + models + default) — edit to switch the model
scripts/mistral-stt-proxy.ts  standalone bun WS proxy: browser ↔ Mistral realtime STT (adds Bearer header)
components/ui/             ElevenLabs + shadcn components (copied, editable)
components/tsubaki/   app-shell (client boundary), top-bar, nav, the four views,
                           orb-visualizer (hybrid), custom-orb, bars, tools-button,
                           transcript-drawer, scroll-area, primitives, glyphs, tweaks-panel
hooks/                     use-tweaks (localStorage), use-media-query
lib/data.ts                personas, providers (with engine discriminator), tools, mock transcript
lib/realtime/              types (CallState, SessionApi), use-realtime-session (dispatcher),
                           use-xai-session (Grok WS engine), xai-audio (PCM16 + playback),
                           xai-agent (per-persona Grok config: voice + prompt + greeting),
                           use-openai-session (gpt-realtime-2 WebRTC engine),
                           openai-agent (per-persona OpenAI config: voice + prompt + greeting),
                           use-cascade-session (STT→LM→TTS engine), cascade-agent (per-persona),
                           lm-config (loads config/lm-models.json — backends + model catalog),
                           mistral-stt (16 kHz capture + realtime-STT client),
                           silero-vad (Silero VAD v5 via onnxruntime-web for turn detection)
```

The `useRealtimeSession` hook owns the call state machine. It always calls
`useConversation` (rules of hooks) but only lets it drive state when the active
provider is ElevenLabs; otherwise the mocked timers own the lifecycle.
