---
name: fal-personaplex-provider
description: Set up, configure, or debug Tsubaki's FAL.AI provider — full-duplex NVIDIA PersonaPlex hosted on fal.ai over a direct browser WebSocket. Use when working on lib/realtime/use-fal-session.ts / fal-agent.ts, the /api/fal/token JWT mint route, the greeting gate, msgpack audio frames, PersonaPlex voice presets, or fal realtime billing/connection issues.
---

# fal.ai PersonaPlex provider (full-duplex, hosted)

The **FAL.AI** provider row runs
[NVIDIA PersonaPlex](https://huggingface.co/nvidia/personaplex-7b-v1)
(`personaplex-7b`) hosted on fal.ai
([`fal-ai/personaplex/realtime`](https://fal.ai/models/fal-ai/personaplex/realtime))
— a **full-duplex** speech-to-speech model that listens while it speaks. No
VAD, no turn events: the model opens the call with its own greeting, barge-in
is native (just talk over it), and INTERRUPT is effectively a no-op.

## Quick start

Keep `FAL_API_KEY` in **fnox**; run `mise run dev` (or
`fnox exec -- bun run dev`). No `FAL_*` values in `.env` files. Pick the
**FAL.AI** row under Providers, choose a persona, press CALL. Without
`FAL_API_KEY`, CALL shows a clear "FAL_API_KEY is not set" caption.

**Pricing**: $0.001/compute-second, billed while the socket is open.

## Transport

Direct browser→fal WebSocket, no fal SDK:

1. Client POSTs `/api/fal/token` (`app/api/fal/token/route.ts`) — the route
   calls `https://rest.fal.ai/tokens/realtime` with `FAL_API_KEY` and returns a
   short-lived JWT (300 s TTL). The key never reaches the client.
   **Gotcha**: the token API takes a SINGULAR owner-prefixed `app` path +
   `duration` — the docs' own example shows `allowed_apps`, but the live
   endpoint 422s on it ("Field required: app").
2. Browser opens
   `wss://fal.run/fal-ai/personaplex/realtime?fal_jwt_token=<jwt>`.
3. Frames are **msgpack binary** both ways — the server silently ignores JSON
   text frames (verified by probe). Send `{audio: <raw PCM16 bytes>, …config}`
   continuously; receive `{audio, text}`.
4. Audio is fixed **PCM16 @ 24 kHz** both ways: the `AudioContext` is
   constructed at 24 kHz so the browser resamples at the edges. Mic chunks are
   aligned to the 80 ms Mimi frame (1920 samples).

## Per-persona config

`lib/realtime/fal-agent.ts` holds transport + sampling (`appId`, text/audio
temperatures, top-k — defaults follow the fal endpoint's own; lower audio
temperature is one of the few levers against halting delivery), resolved by
`resolveFalAgent(personaId)`.

The persona conditioning itself (voice preset + role prompt) lives in
`lib/realtime/personaplex-personas.ts`, **shared with the local KYUTAI engine**
— PersonaPlex is conditioned per session by one of **18 voice presets**
(`NATF0–3`, `NATM0–3`, `VARF0–4`, `VARM0–4`) plus a short role-play prompt (no
instruction-following scaffold; prompts must follow the model's two template
families — see that file's header).

## Full-duplex rules (engine: `lib/realtime/use-fal-session.ts`)

- **Greeting gate** (`lib/realtime/greeting-gate.ts`): the mic is replaced with
  silence until the model finishes its opening greeting, and `autoGainControl`
  is off — otherwise amplified room tone reads as the user talking and the
  model interrupts its own greeting mid-sentence. The gate is sample-count
  based (opens after voiced output + ~600 ms of quiet, or unconditionally
  after ~12 s), the same logic validated server-side in personaplex-mlx.
- **Continuous timeline**: mute and the gate send silence chunks instead of
  pausing sends — the model tracks the conversation as two synchronized audio
  streams, so the input clock must never stop.
- **No user-side transcript** (no ASR anywhere in the path); the agent
  transcript streams from the model's inner-monologue text tokens. Call state
  is derived from output audio RMS, not server events.
- **Headphones** — the model hears everything the mic hears, including its own
  voice from speakers.

## Known quirks

- fal's dashboard logs realtime inputs as empty — not a bug in the app.
- Cold starts can take ~20 s+ before the greeting arrives.

Background: [docs/personaplex-local-inference.md](../../../docs/personaplex-local-inference.md).
