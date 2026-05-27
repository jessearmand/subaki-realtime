# TSUBAKI — realtime voice console

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

Required (server-side, dev only — keep it in **fnox**, run via `fnox exec -- bun run dev`):

```bash
XAI_API_KEY=your-xai-api-key       # used only by the /api/xai/token route handler
```

Optional client config (in `.env.local`; all have sensible defaults):

```bash
NEXT_PUBLIC_XAI_MODEL=grok-voice-latest
NEXT_PUBLIC_XAI_VOICE=eve                 # eve | ara | rex | sal | leo
NEXT_PUBLIC_XAI_INSTRUCTIONS="You are Tsubaki, a warm, concise realtime voice assistant…"
```

Pick the **XAI** row under Providers and press CALL — it mints a token, opens the
WebSocket, captures the mic as PCM16, plays the agent's audio, streams transcripts,
and barges in on server-VAD speech detection. Without `XAI_API_KEY` set, CALL shows
a clear "XAI_API_KEY is not set" caption instead of connecting.

## Architecture

```
app/                       layout (fonts), globals.css (brutalist + orb styles), page (ConversationProvider)
app/api/xai/token/         route handler that mints the xAI ephemeral client-secret
components/ui/             ElevenLabs + shadcn components (copied, editable)
components/tsubaki/   app-shell (client boundary), top-bar, nav, the four views,
                           orb-visualizer (hybrid), custom-orb, bars, tools-button,
                           transcript-drawer, scroll-area, primitives, glyphs, tweaks-panel
hooks/                     use-tweaks (localStorage), use-media-query
lib/data.ts                personas, providers (with engine discriminator), tools, mock transcript
lib/realtime/              types (CallState, SessionApi), use-realtime-session (dispatcher),
                           use-xai-session (Grok WS engine), xai-audio (PCM16 + playback)
```

The `useRealtimeSession` hook owns the call state machine. It always calls
`useConversation` (rules of hooks) but only lets it drive state when the active
provider is ElevenLabs; otherwise the mocked timers own the lifecycle.
