---
name: kyutai-local-provider
description: Set up, configure, or debug Tsubaki's local KYUTAI provider — full-duplex PersonaPlex running on-device via the personaplex-mlx fork (ws://localhost:8998). Use when working on lib/realtime/use-moshi-session.ts / moshi-agent.ts, the mise run personaplex-local task, PersonaPlex persona conditioning, or local full-duplex audio issues (greeting gate, mute/silence, stalled generation).
---

# Local KYUTAI provider (full-duplex, on-device)

The **KYUTAI** provider row runs PersonaPlex fully on-device: the
[kyutai/personaplex-rl-seamless](https://huggingface.co/kyutai/personaplex-rl-seamless)
RL fine-tune (better turn-taking/backchanneling; non-commercial RL delta)
served at q8 on Apple Silicon by the
[personaplex-mlx fork](https://github.com/jessearmand/personaplex-mlx)
(`tsubaki-server` branch, checkout at `~/Develop/personaplex-mlx`). Same model
family and persona conditioning as the hosted FAL.AI row, so an A/B between
them varies only the serving stack.

## Quick start

```bash
mise run personaplex-local   # personaplex-mlx local_web on :8998 (kyutai RL, q8)
mise run dev                 # the app
mise run stop-personaplex-local
```

No API key — the browser connects straight to the local server. (An ambient HF
token is only needed once, for the gated checkpoint download on first run.)

Env overrides for the `personaplex-local` task:

| Var | Default | Meaning |
| --- | --- | --- |
| `PERSONAPLEX_HF_REPO` | `kyutai/personaplex-rl-seamless` | checkpoint; set `nvidia/personaplex-7b-v1` for the base model |
| `PERSONAPLEX_DIR` | `~/Develop/personaplex-mlx` | fork checkout path |
| `PERSONAPLEX_PORT` | `8998` | server port |

## Connection & protocol

`lib/realtime/moshi-agent.ts` builds the WS URL:
`ws://localhost:8998/api/chat?voice_prompt=<PRESET>.pt&text_prompt=<prompt>&format=pcm`
(base overridable with `NEXT_PUBLIC_PERSONAPLEX_WS_URL`). Session config rides
the query params; sampling temperatures/top-k are server launch flags, not
per-session params.

`format=pcm` is the fork's codec-free wire mode: binary frames whose first byte
is a tag — `0x00` handshake (server ready; prompts stepped), `0x01` audio
(raw **PCM16 LE @ 24 kHz** both ways, no codec), `0x02` agent text token. See
the fork's README for the full protocol.

## Key files

- `lib/realtime/use-moshi-session.ts` — the engine hook (24 kHz AudioContext,
  80 ms Mimi-frame-aligned mic chunks of 1920 samples, tag dispatch,
  output-RMS-derived call state)
- `lib/realtime/moshi-agent.ts` — WS URL construction from the persona
- `lib/realtime/personaplex-personas.ts` — persona conditioning (voice preset
  + role prompt), **shared with the fal engine** — edit personas here once for
  both. Prompts must follow PersonaPlex's two template families (service /
  discussion); see the file header and docs/persona-architecture.md.

## Full-duplex rules (violations = broken audio)

- **The model speaks first** — no greeting bootstrap, no VAD, no turn events;
  `interrupt()` just stops local playback (barge-in is native — talk over it).
- **The input clock must never stop.** The model's steps are input-driven: mic
  chunks must flow continuously from the handshake on, or generation stalls.
  Mute streams **silence chunks**, never pauses sends.
- **Greeting mic-gate is server-side**: the fork holds the mic input shut until
  the opening greeting finishes (on by default), so unlike the fal engine there
  is no client-side `GreetingGate`. `autoGainControl` stays off in the browser
  regardless, so room tone isn't amplified into "speech" mid-conversation.
- **No user-side transcript** (no ASR in the path); the agent transcript
  streams from text tokens (`0x02` frames).
- **Headphones recommended** — the model hears everything the mic hears,
  including its own voice from speakers.

Background: [docs/personaplex-local-inference.md](../../../docs/personaplex-local-inference.md)
(server-side validation of the greeting gate and full-duplex behavior).
