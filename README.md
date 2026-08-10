# TSUBAKI — realtime voice console

[![Oxc](https://github.com/jessearmand/subaki-realtime/actions/workflows/oxc.yml/badge.svg)](https://github.com/jessearmand/subaki-realtime/actions/workflows/oxc.yml)
[![Build](https://github.com/jessearmand/subaki-realtime/actions/workflows/build.yml/badge.svg)](https://github.com/jessearmand/subaki-realtime/actions/workflows/build.yml)
[![CodeQL](https://github.com/jessearmand/subaki-realtime/actions/workflows/codeql.yml/badge.svg)](https://github.com/jessearmand/subaki-realtime/actions/workflows/codeql.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A brutalist inspired design of realtime voice console inspired by [古椿の霊](https://grokipedia.com/page/furutsubaki_no_rei) a yokai (妖怪) in Japanese folklore, made with Claude Design, and built from **ElevenLabs UI** primitives.

Refer to [yokai-finder](https://yokai.com/finder/) for more information about yokai from each region in Japan.

Four screens — Sessions (voice interaction), Personas, Providers, Settings
— with a full call lifecycle (idle → connecting → listening → speaking → interrupted → ended).

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

The default fnox profile holds only the app's provider keys.
`CLAUDE_CODE_OAUTH_TOKEN` (remote-control / CI use of Claude Code) sits in a
separate `remote` profile — run `fnox -P remote exec -- <cmd>` when you need it.
Keeping it out of the default profile matters: an OAuth token in the environment
overrides Claude Code's stored Claude Max login, so `fnox exec -- claude` would
otherwise silently authenticate as a token instead of your subscription.

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

OpenAI's realtime API (`gpt-realtime-2.1`) connects over **WebRTC** — the browser's
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
resolved by `resolveOpenaiAgent(personaId)`. The model ids themselves live in
**`config/realtime-models.json`** (read by `lib/realtime/realtime-model-config.ts`),
the single source shared by the agent `BASE`, the `/api/openai/token` mint route,
and the Providers UI label — bump the model there and every consumer follows. The persona `instructions` follow a
light slice of OpenAI's Realtime 2.0 prompt skeleton (Role, Personality & Tone,
Pacing, Unclear Audio, Variety).

Pick the **OPENAI** row under Providers, choose a persona, and press CALL — it
mints a key, negotiates WebRTC, plays the agent's audio, shows the user + agent
transcripts (whisper for input), and barges in on server-VAD speech detection.
Without `OPENAI_API_KEY` set, CALL shows a clear "OPENAI_API_KEY is not set"
caption instead of connecting.

### Web tools via Firecrawl MCP (OAuth)

The OPENAI engine can search and read the live web through **Firecrawl's
remote MCP server**. Remote MCP tools are executed **by the Realtime API
itself** — the browser only configures access in `session.update` and listens
to lifecycle events (`mcp_list_tools.*`, `response.mcp_call.*`); it never runs
the tools. The tool surface is deliberately narrow: `firecrawl_search` +
`firecrawl_scrape` via `allowed_tools`, with `require_approval: "never"`
(both are read-only web operations). See `firecrawlMcpTool()` in
`lib/realtime/openai-agent.ts`.

Auth uses Firecrawl's **keyless OAuth endpoint** (`https://mcp.firecrawl.dev/v2/mcp`)
instead of the API-key-in-URL form, so no `fc-` key exists anywhere in the app:

1. Start the dev server and open **`http://localhost:3000/api/firecrawl/oauth/start`**
   once. This registers a public OAuth client (Dynamic Client Registration),
   runs Authorization Code + PKCE against firecrawl.dev, and redirects back.
2. Tokens land in **`.firecrawl/oauth.json`** (gitignored). Access tokens last
   ~1h; the refresh token rotates on every server-side refresh — no manual
   upkeep after the one-time consent.
3. On each CALL, the session hook POSTs `/api/firecrawl/token` and, if
   connected, injects the MCP tool (plus a `# Web Tools` prompt section) into
   the session config. Not connected → the call proceeds voice-only.

The browser sees only the short-lived scoped access token — that is the OAuth
trade Firecrawl documents (revocable per-client, small blast radius), versus a
raw API key that never expires.

## Wiring the real Google Gemini provider

Gemini's Live API is **WebSocket-only** in the browser. The client connects
directly to the v1alpha `BidiGenerateContentConstrained` endpoint on
`generativelanguage.googleapis.com`, authenticated by a **single-use ephemeral
auth token** minted server-side at `POST /api/gemini/token` (via `@google/genai`
`authTokens.create` — ephemeral tokens are v1alpha-only and Google documents no
raw REST mint endpoint). The secret `GEMINI_API_KEY` never reaches the client.

Keep `GEMINI_API_KEY` in **fnox** and run via `fnox exec -- bun run dev` /
`mise run dev`. No `GEMINI_*` values live in `.env` files.

Per-persona config (prebuilt voice, multi-line instructions, opening line,
VAD tuning) lives in the typed module **`lib/realtime/gemini-agent.ts`** — a
shared `BASE` (model + activity detection) plus a per-persona map of Gemini
voice + prompt + greeting, resolved by `resolveGeminiAgent(personaId)`. Voice
casting is auditioned in AI Studio; Gemini's VAD sensitivity knobs are coarse
two-level enums rather than xAI's numeric threshold.

Protocol notes that shape `lib/realtime/use-gemini-session.ts`: mic PCM16
streams as `realtimeInput.audio` with the AudioContext's native rate declared
in the MIME type (Google resamples to 16 kHz); output audio is **fixed 24 kHz**,
so the shared `PlaybackQueue` is constructed with an explicit buffer rate; one
server message can bundle audio + transcriptions + turn flags, so every
`serverContent` field is handled independently; barge-in is server-VAD driven
via `serverContent.interrupted`; and the greeting is elicited through
`realtimeInput.text` (`sendClientContent` is history-seeding only on current
Live models).

Pick the **GOOGLE** row under Providers, choose a persona, and press CALL —
it mints a token, opens the WebSocket, sends the persona `setup`, streams both
transcripts (input/output transcription enabled in setup), and grounds answers
with the built-in `googleSearch` tool. Sessions are capped by Google at ~10 min
of connection (15 min audio) — fine for a console call; session resumption is
not wired.

## Wiring the fal.ai PersonaPlex provider (full-duplex)

The **FAL.AI** row runs [NVIDIA PersonaPlex](https://huggingface.co/nvidia/personaplex-7b-v1)
hosted on fal.ai — a **full-duplex** speech-to-speech model that listens while
it speaks (the model greets first, barge-in is native, no user-side ASR). The
browser opens a direct WebSocket to `wss://fal.run/fal-ai/personaplex/realtime`
(msgpack frames, PCM16 @ 24 kHz) with a JWT minted at `POST /api/fal/token`.
Keep `FAL_API_KEY` in **fnox** and run `mise run dev`; use headphones.

Full setup, per-persona config, greeting-gate/continuous-timeline rules, and
gotchas: [.claude/skills/fal-personaplex-provider/SKILL.md](.claude/skills/fal-personaplex-provider/SKILL.md).

## Wiring the local KYUTAI provider (full-duplex, on-device)

The **KYUTAI** row runs the same PersonaPlex architecture fully **on-device**:
the [kyutai/personaplex-rl-seamless](https://huggingface.co/kyutai/personaplex-rl-seamless)
RL fine-tune served by our [personaplex-mlx fork](https://github.com/jessearmand/personaplex-mlx)
(`tsubaki-server` branch) at q8 on Apple Silicon. No API key — the browser
connects straight to `ws://localhost:8998/api/chat` (raw PCM16 @ 24 kHz via
`format=pcm`). Start with `mise run personaplex-local`, then `mise run dev`.

Full setup, env overrides, the wire protocol, and the full-duplex rules:
[.claude/skills/kyutai-local-provider/SKILL.md](.claude/skills/kyutai-local-provider/SKILL.md).

## Wiring the Cascade provider (STT → LM → TTS)

The **MISTRAL** row runs a turn-based cascade instead of a single full-duplex
model: **Mistral realtime STT** (via the bun WS proxy in
`scripts/mistral-stt-proxy.ts`) → **`/api/llm`** (catalog-driven, streaming) →
**`/api/tts`** (per clause). Turn boundaries are client-side (Silero VAD, the
Send button, or push-to-talk). `mise run dev` starts everything (secrets in
**fnox**: `MISTRAL_API_KEY`, `HF_TOKEN`, `TINKER_API_KEY`); the LM catalog is
`config/lm-models.json`, the TTS/STT catalog `config/voice-models.json`, and a
fully-local stack runs via `mise run local-stack`.

Full setup, VAD tuning, catalogs, and the local stack:
[.claude/skills/cascade-provider/SKILL.md](.claude/skills/cascade-provider/SKILL.md).

## Architecture

```
app/                       layout (fonts), globals.css (brutalist + orb styles), page (ConversationProvider)
app/api/xai/token/         route handler that mints the xAI ephemeral client-secret
app/api/openai/token/      route handler that mints the OpenAI ephemeral key
app/api/llm/               streaming chat-completion route (catalog-driven backend) for the cascade engine
app/api/tts/               TTS route (per-clause MP3; Mistral or local mlx-audio, catalog-driven)
app/api/stt/               batch STT route (per-turn WAV → local mlx-audio transcription)
config/lm-models.json      cascade LM catalog (backends + models + default) — edit to switch the model
config/voice-models.json   cascade TTS/STT catalog (cloud/local backends + persona voice map)
config/realtime-models.json  fixed realtime model ids (OpenAI session + mint + UI label) — edit to bump
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
                           use-openai-session (gpt-realtime-2.1 WebRTC engine),
                           openai-agent (per-persona OpenAI config: voice + prompt + greeting),
                           realtime-model-config (loads config/realtime-models.json — model ids),
                           use-cascade-session (STT→LM→TTS engine), cascade-agent (per-persona),
                           lm-config (loads config/lm-models.json — backends + model catalog),
                           voice-config (loads config/voice-models.json — TTS/STT backends),
                           mistral-stt (16 kHz capture + realtime-STT client + batch turn recorder),
                           wav (PCM16 WAV encoder for batch STT turns),
                           silero-vad (Silero VAD v5 via onnxruntime-web for turn detection)
```

The `useRealtimeSession` hook owns the call state machine. It always calls
`useConversation` (rules of hooks) but only lets it drive state when the active
provider is ElevenLabs; otherwise the mocked timers own the lifecycle.
