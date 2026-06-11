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
mise run dev       # = fnox exec -- bun run dev (ElevenLabs/xAI/OpenAI keys loaded)
mise run stop      # stop the server on PORT (default 3000)
```

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

## Architecture

```
app/                       layout (fonts), globals.css (brutalist + orb styles), page (ConversationProvider)
app/api/xai/token/         route handler that mints the xAI ephemeral client-secret
app/api/openai/token/      route handler that mints the OpenAI ephemeral key
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
                           openai-agent (per-persona OpenAI config: voice + prompt + greeting)
```

The `useRealtimeSession` hook owns the call state machine. It always calls
`useConversation` (rules of hooks) but only lets it drive state when the active
provider is ElevenLabs; otherwise the mocked timers own the lifecycle.
