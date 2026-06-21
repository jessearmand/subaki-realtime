# Grok voice agent — follow-up review (concise)

**Date**: 2026-06 · **Status**: Superseded for actionable items — see implementation table below. No further code changes planned.

## Implementation status

| Item in this review | Status |
|---------------------|--------|
| Richer VAD per persona (`threshold`, `silence_duration_ms`, `prefix_padding_ms`) | **Done** — `ae857c7`, presets in `lib/realtime/xai-agent.ts` |
| Parallel call-start (mic before WS ready) | **Done** — `ae857c7`, `EarlyAudioBuffer` + early capture in `lib/realtime/use-xai-session.ts` |
| Custom voice ID typing | **Deferred** — roadmap |
| Pin `grok-voice-think-fast-1.0` vs `latest` | **Deferred** — `grok-voice-latest` kept for dev |
| 24 kHz sample-rate A/B | **Deferred** — native rate unchanged |
| Custom function tools + `PlaybackQueue.isPlaying` gating | **Deferred** — `isPlaying` exists; no function tools yet |
| Voice-cloning-aware prompt tuning | **Deferred** — until custom voices |

Full exploration and numbered backlog: [grok-voice-agent-review-1.md](./grok-voice-agent-review-1.md).

---

## Original assessment (archived)

The shape is sound. [lib/realtime/xai-agent.ts](../lib/realtime/xai-agent.ts) keeps persona voice, instructions, first-message, tools, and VAD centralized; [use-xai-session.ts](../lib/realtime/use-xai-session.ts) sends those through `session.update`. Ephemeral tokens ([app/api/xai/token/route.ts](../app/api/xai/token/route.ts)), PCM16 streaming, server VAD, output deltas, and barge-in were already correct.

### Suggestions (as originally written)

1. **Support custom voice IDs in the config type** — `XaiVoice` is still the five built-ins; widen when cloning is ready (runtime already passes `agent.voice` through).

2. **`grok-voice-latest`** — Fine for dev; pin `grok-voice-think-fast-1.0` if you need stable persona tuning.

3. ~~**Expose richer VAD tuning**~~ — **Implemented** (`ae857c7`).

4. **24 kHz sample-rate policy** — Optional A/B vs native `AudioContext` rate.

5. **Custom function tools** — Defer until you gate `response.create` on `PlaybackQueue.isPlaying`.

6. **Voice-cloning-aware prompts** — Relevant when moving off built-in voices.

Cookbook examples mostly validate the architecture; typed per-persona config is a better fit than env strings.

Sources: [xAI Voice Agent API](https://docs.x.ai/developers/model-capabilities/audio/voice-agent.md), [Custom Voices](https://docs.x.ai/developers/model-capabilities/audio/custom-voices.md), local `xai-cookbook/voice-examples/`.