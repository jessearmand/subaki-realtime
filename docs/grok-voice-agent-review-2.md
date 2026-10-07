# Grok voice agent — follow-up review (concise)

**Date**: 2026-06 · **Docs refresh**: 2026-08-10 · **Status**: Superseded for actionable code items — see implementation table below. No further code changes planned from the original review.

## Implementation status

| Item in this review | Status |
|---------------------|--------|
| Richer VAD per persona (`threshold`, `silence_duration_ms`, `prefix_padding_ms`) | **Done** — `ae857c7`, presets in `lib/realtime/xai-agent.ts` |
| Parallel call-start (mic before WS ready) | **Done** — `ae857c7`, `EarlyAudioBuffer` + early capture in `lib/realtime/use-xai-session.ts` |
| Custom voice ID typing | **Done** — `XaiVoice` = expanded built-ins + `(string & {})`; runtime already passed `agent.voice` through. Create/list UI still roadmap |
| Pin `grok-voice-think-fast-1.0` vs `latest` | **Deferred** — `grok-voice-latest` kept for dev |
| 24 kHz sample-rate A/B | **Deferred** — native rate unchanged |
| Custom function tools + `PlaybackQueue.isPlaying` gating | **Deferred** — `isPlaying` exists; no function tools yet |
| Voice-cloning-aware prompt tuning | **Deferred** — until custom voices are productized |
| Multilingual / Japanese S2S | **Docs (2026-08-10)** — no session `language` param; pin via `instructions` + `firstMessage` in `xai-agent.ts`. Details: [xai-voice-agent-api.md](./xai-voice-agent-api.md#multilingual--japanese-s2s) |

Full exploration and numbered backlog: [grok-voice-agent-review-1.md](./grok-voice-agent-review-1.md).

---

## Original assessment (archived)

The shape is sound. [lib/realtime/xai-agent.ts](../lib/realtime/xai-agent.ts) keeps persona voice, instructions, first-message, tools, and VAD centralized; [use-xai-session.ts](../lib/realtime/use-xai-session.ts) sends those through `session.update`. Ephemeral tokens ([app/api/xai/token/route.ts](../app/api/xai/token/route.ts)), PCM16 streaming, server VAD, output deltas, and barge-in were already correct.

### Suggestions (as originally written)

1. ~~**Support custom voice IDs in the config type**~~ — **Done** (expanded roster + open string). Product create/list still open.
2. **`grok-voice-latest`** — Fine for dev; pin `grok-voice-think-fast-1.0` if you need stable persona tuning.
3. ~~**Expose richer VAD tuning**~~ — **Implemented** (`ae857c7`).
4. **24 kHz sample-rate policy** — Optional A/B vs native `AudioContext` rate.
5. **Custom function tools** — Defer until you gate `response.create` on `PlaybackQueue.isPlaying`.
6. **Voice-cloning-aware prompts** — Relevant when moving off built-in voices.
7. **Japanese / multilingual (added 2026-08-10)** — S2S has no API `language` field (unlike TTS `language: "ja"` / STT optional `language`). Default is auto-detect; to force JP, edit persona `instructions` + `firstMessage`. Do not add a fake session `language` unless upstream documents one.

Cookbook examples mostly validate the architecture; typed per-persona config is a better fit than env strings.

### Stale facts corrected (2026-08-10)

- Upstream S2S home is [voice.md](https://docs.x.ai/developers/model-capabilities/audio/voice.md); `…/voice-agent.md` 404s.
- Built-in voice count is no longer “5 only”; Tsubaki tracks the larger roster in `XaiVoice`.
- Personas: 7 (includes `vesper`), not 6.
- TTS requires `language`; S2S does not expose an equivalent session field.

Sources: [xAI Voice overview](https://docs.x.ai/developers/model-capabilities/audio/voice.md), [TTS](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech.md), [STT](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text.md), [Custom Voices](https://docs.x.ai/developers/model-capabilities/audio/custom-voices.md), local [xai-voice-agent-api.md](./xai-voice-agent-api.md), local `xai-cookbook/voice-examples/`.
