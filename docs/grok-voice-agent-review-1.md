# Exploration & Improvement Suggestions Plan: xAI Voice Agent Persona Configuration

**Date**: 2026-05 (exploration) · **Updated**: 2026-06-03 (implementation status)  
**Status**: Exploration complete. **High-priority follow-ups implemented** in commit `ae857c7` (`feat/grok-voice-agent`). No further code changes planned unless optional/roadmap items are explicitly requested.  
**Scope**: Review of `lib/realtime/xai-agent.ts` + persona-driven Grok voice config, cross-referenced against official xAI docs (voice-agent + custom-voices) and local xAI Cookbook (`~/Develop/xai-cookbook/voice-examples/` + related).

## Implementation status (2026-06-03)

| # | Suggestion | Status |
|---|------------|--------|
| 1 | Parallel mic + early audio buffering | **Done** — `EarlyAudioBuffer` in `lib/realtime/xai-audio.ts`; capture starts on CALL in parallel with token/WS; flush on `session.updated` before greeting (`ae857c7`) |
| 2 | Per-persona VAD presets | **Done** — `VAD_SNAPPY` / `VAD_RELAXED` / `VAD_PATIENT` in `lib/realtime/xai-agent.ts` (`ae857c7`) |
| 3 | Model pinning | **Deferred** — still `grok-voice-latest` (acceptable for dev) |
| 4 | Custom voices | **Deferred** — roadmap |
| 5 | Prompt compression | **Deferred** — persona copy realigned in `30e051b`, not a think-fast compression pass |
| 6 | Event/tooling robustness | **Deferred** — future-proofing |
| 7 | Minor nice-to-haves | **Deferred** |

Persona/voice alignment (`30e051b`) predates the parallel/VAD work and is separate from this backlog.

---

## Context & Why This Review

The Tsubaki realtime voice console (Next.js) supports multiple providers. The xAI ("Grok voice") path is a **direct browser-to-api.x.ai WebSocket** implementation (no heavy relay in the hot path):

- Ephemeral client-secret minted at `app/api/xai/token/route.ts` (300s TTL, never exposes `XAI_API_KEY` to browser).
- `lib/realtime/use-xai-session.ts` owns the full PCM16 audio pipeline + PlaybackQueue (barge-in via `input_audio_buffer.speech_started`).
- **Persona personality lives in `lib/realtime/xai-agent.ts`** (the single source of truth, analogous to ElevenLabs agent configs): `model`, built-in `voice`, `instructions` (system prompt), `firstMessage` (bootstrap via `conversation.item.create`), `tools`, `turnDetection`.
- `resolveXaiAgent(personaId)` merges per-persona overrides over a small `BASE`.
- 6 personas (aria/onyx/sage/nova/echo/cipher) map to the 5 built-in xAI voices with hand-crafted spoken guardrails + character prompts.
- Always-on `web_search` tool (server-side tool — xAI executes automatically; no client handler required today).

This design is clean, type-safe, version-controlled, and closely mirrors patterns from the official xAI Cookbook examples (web + webrtc + telephony agents).

The task was **pure exploration** (no edits): compare against:
- https://docs.x.ai/developers/model-capabilities/audio/voice-agent (best practices, session params, tools, latency, migration from OpenAI Realtime, event flows)
- https://docs.x.ai/developers/model-capabilities/audio/custom-voices (cloning, reference audio guidelines, voice_id usage, limits)
- Local cookbook `voice-examples/agent/{web,webrtc,telephony}/` (real working code for session.update, ephemeral tokens, VAD, function tools, audio formats, turn handling, G.711 telephony, etc.)
- Supporting pages (ephemeral-tokens, models/voice-agent-api, full realtime reference)

**Current state is already high-quality and production-leaning for a demo console.** Most "improvements" are incremental polish or future-proofing rather than bugs.

---

## Key Alignments (What We're Already Doing Right)

- **Ephemeral tokens + browser subprotocol auth** (`xai-client-secret.${token}`): Exact match to docs recommendation. Token route is minimal, secure, and correctly marked `dynamic`.
- **Native sample rate PCM16 end-to-end** (advertised in `session.update` `audio.input/output.format`): Matches cookbook + docs "no resampling" best practice. 24 kHz recommended in docs but 44.1/48 kHz also fully supported and used in examples.
- **Server VAD** (`turn_detection: { type: "server_vad" }`): Preferred pattern everywhere in docs/cookbook.
- **Bootstrap first utterance** via `conversation.item.create` (user text) + `response.create` after `session.updated`: Universal pattern in all cookbook agents (web, webrtc, telephony, outbound).
- **Per-persona `instructions` + `firstMessage` + voice mapping**: Excellent factorization. `SHARED` guardrails ("keep short, conversational, no markdown/emoji/lists — words are spoken") are spot-on for voice UX.
- **Server-side tools** (`web_search`): Correctly enabled in BASE; no client-side function handler needed (xAI auto-executes). Matches docs distinction between server tools vs. custom `function` tools.
- **Barge-in**: Proper handling of `input_audio_buffer.speech_started` + `PlaybackQueue.stop()`.
- **Direct WS (no proxy in audio path)**: Lower latency than the older "proxy everything" cookbook variants; modern examples have moved to ephemeral + direct or thin relay.
- **TypeScript config module**: Better than env-var sprawl for multi-line prompts (explicitly called out as motivation in the file header).

---

## Recommended Improvement Areas (Prioritized Suggestions)

These are **observations + concrete suggestions**. Nothing is broken today. Prioritize by user impact (latency first).

### 1. Call-Start Latency & Parallel Initialization — **IMPLEMENTED** (`ae857c7`)

**Problem** (original): In `use-xai-session.ts`:
- Token fetch → AudioContext → WS open → `conversation.created`/`session.created` → `session.update` → `session.updated` → **only then** `startCapture()` (getUserMedia + ScriptProcessor + `input_audio_buffer.append` streaming).
- User cannot speak naturally for the first 1–2+ seconds after "CALL". Early speech is lost.

**Docs recommendation** (voice-agent.md "Minimize Perceived Latency – Parallel Initialization"):
- Start `getUserMedia` + mic buffering **immediately** (in parallel with WS connect).
- Buffer early PCM chunks client-side.
- On WS open + after `session.update` succeeds, flush the ring buffer.
- "Do **not** wait for the WebSocket `open` event before starting to collect microphone samples."

Cookbook web client is closer (mic starts from UI gesture, but still sequential in practice); telephony/webrtc examples also note "DO NOT send audio until sessionReady".

**Suggested changes (future)**:
- Move mic permission + early buffering into the `start()` path before WS creation.
- Add a small `EarlyAudioBuffer` (Float32Array ring or queue) + flush logic after `configure()`.
- Keep the existing `PlaybackQueue` for output (already excellent for gapless + barge-in).
- Consider forcing a consistent 24 kHz `AudioContext({ sampleRate: 24000 })` (docs sweet spot) vs. always native (tradeoff: fidelity vs. perfect match to device + bandwidth).

**Files involved**: `lib/realtime/use-xai-session.ts` (core), `lib/realtime/xai-audio.ts` (add buffer helper?), `app-shell.tsx` or call UI if gesture timing matters.

### 2. VAD / Turn-Detection Tuning — **IMPLEMENTED** (`ae857c7`)

Original state: Hardcoded minimal `{ type: "server_vad" }` in BASE (inherited by all).

Docs expose (all optional, sensible defaults):
- `threshold`: 0.1–0.9 (default 0.85) — higher = needs louder audio to trigger (less false starts).
- `silence_duration_ms`: 0–10000 — how long user must be silent before server ends turn.
- `prefix_padding_ms`: 0–10000 (default 333) — audio included before speech start (prevents clipping first words).

**Suggestion**: Promote `turnDetection` into per-persona config (or a small `VAD_PRESETS` map). Examples:
- Fast personas (sage, nova): slightly higher threshold + shorter silence.
- Slow/atmospheric (aria, cipher, echo, onyx): lower threshold + longer `silence_duration_ms` (e.g. 800–1200 ms) so they don't get cut off mid-thought.
- Keep a global default but allow override.

This directly improves "measured", "deliberate", "patient" character fidelity.

**Files**: `lib/realtime/xai-agent.ts` (extend interface + BASE/persona values), `use-xai-session.ts` (pass through; already does `agent.turnDetection`).

### 3. Model Version Strategy

Current: `"grok-voice-latest"` (fine for dev; always newest).

Docs (migration + models page):
- `grok-voice-latest` → currently `grok-voice-think-fast-1.0` (flagship, more capable reasoning).
- `grok-voice-fast-1.0` is legacy/deprecated.
- **Production recommendation**: Pin to a specific versioned model for stability ("`grok-voice-think-fast-1.0`").

**Suggestion**:
- Add `modelVersion?: string` or change BASE to a pinned value with clear comment.
- Or expose via env for flexibility while defaulting to pinned.
- Update comments to reference the migration guidance ("simplify prompts for think-fast").

**Files**: `lib/realtime/xai-agent.ts` (BASE), `use-xai-session.ts` (query param construction).

### 4. Custom Voices — The Biggest "Future" Opportunity (High Fidelity + Feature Parity)

Docs + custom-voices page: `voice` param in `session.update` accepts **either** a built-in name **or** any custom `voice_id` (8-char lowercase alphanum returned from `/v1/custom-voices` create). Works identically in Voice Agent, TTS, streaming TTS.

**Current limitations in code**:
- `type XaiVoice = "eve" | "ara" | "rex" | "sal" | "leo";` (literal union).
- Persona mappings are compromises (e.g. soft/intimate "echo" → energetic "eve"; deep bass "onyx" → authoritative "leo").
- Mock transcript in `lib/data.ts` talks about "clone your own from a 30-second sample" and "slot to clone your own" — UI promise not yet backed by xAI path.

**Strong suggestion** (when ready to productize):
- Extend voice typing to `string` (or `XaiVoice | CustomVoiceId`).
- Add optional `customVoiceId?: string` per persona (or a separate "voice library" concept).
- Support creating/listing custom voices (console first is easiest; Enterprise API for automation).
- Follow recording guidelines religiously: 90–120 s, quiet studio mic + pop filter, single speaker, natural/expressive delivery **matching the intended use-case** (conversational vs. narration), mono 24 kHz 16-bit WAV preferred.
- Metadata on create: `tone`, `accent`, `use_case` ("conversational"), `gender`, etc. — helps quality.
- Note hard limits: US only (excl. Illinois), max 30 per team (request more via support), team-scoped.

This would let every persona have a **true timbre/pacing match** instead of nearest built-in.

**Files (future)**: `xai-agent.ts` (types + resolve), new `lib/realtime/xai-voices.ts` or similar?, token + any admin routes, UI picker, docs/README updates.

### 5. Prompt Tightening for Flagship Model (Low–Medium Polish)

Docs migration note (for `grok-voice-think-fast-1.0`):
> "Simplify your system prompt. The model is significantly more capable... Ask Grok to generalize your existing system prompt rather than porting it verbatim. Remove workaround prompting."

Current `SHARED` + persona blocks are already concise and voice-first (excellent). Some lines ("Reassure before you instruct", detailed "mystery-novel narrator" theater) are characterful and work well for this product.

**Light suggestion**: Periodically ask the model (or run A/B) to compress the longer persona blocks while preserving the "voice" (pace, affect, sentence length). Keep the spoken guardrails strong.

### 6. Event Handling & Tooling Robustness (Future-Proofing)

- **Input transcripts**: Telephony example listens to `conversation.item.input_audio_transcription.completed`. Current xAI path only surfaces agent `output_audio_transcript.delta`. Adding this (when desired) gives live user captions and richer transcript export.
- **Custom function tools**: If any persona ever needs client-side tools (beyond server `web_search`/`x_search`), implement the exact flow from docs + telephony example:
  1. Listen for `response.output_item.added` (or `response.function_call_arguments.done`).
  2. Execute locally.
  3. `conversation.item.create` with `type: "function_call_output"`.
  4. `response.create`.
  5. (Best practice) Wait for current playback to finish before `response.create` to avoid audio overlap; show "thinking" UI.
- Telephony also has good turn counting / interruption logging patterns worth borrowing for debug.

**Files**: `use-xai-session.ts` (add cases), `xai-agent.ts` (if adding per-persona tools).

### 7. Minor / Nice-to-Haves

- **Reconnection + resume**: Docs call out "graceful reconnection while continuing to buffer new audio" + exponential backoff. Current is "end on close". Low priority for a console, high for always-on telephony.
- **Subprotocol alignment**: Some cookbook clients send extra protocols (`realtime`, `openai-beta.realtime-v1`, `openai-insecure-api-key.*`). Project's single `xai-client-secret.*` works per docs; consider adding for broader compatibility if issues appear.
- **Pricing awareness**: `conversation.item.create` (text) costs $0.004 each (except function outputs). The bootstrap firstMessage is one per call — fine, but worth noting if adding more text priming.
- **Rate limits / enterprise**: 100 concurrent sessions/team, 120 min max. Document in ops notes.
- **Type for voice**: Consider `voice: string` + runtime allow-list or branded type once custom voices are supported.
- **Audio chunking**: Current 100 ms chunks (`CHUNK_MS`). Cookbook recommends "~100ms" — already good.

---

## Files Referenced (for Future Targeted Work)

**Core config (primary focus of review)**:
- `lib/realtime/xai-agent.ts` — Persona agents, SHARED guardrails, BASE, `resolveXaiAgent`, `XaiVoice`/`XaiAgentConfig`.
- `lib/realtime/use-xai-session.ts` — Full direct-WS lifecycle, session.update construction, firstMessage bootstrap, barge-in, audio pipeline wiring.
- `lib/realtime/xai-audio.ts` — PCM16 <-> base64, `PlaybackQueue`, RMS (output volume for orb).

**Supporting**:
- `app/api/xai/token/route.ts` — Ephemeral secret minting.
- `lib/data.ts` — `PERSONAS` (id, accent, traits, desc, wpm) + provider metadata; mock transcript mentions cloning.
- `app-shell.tsx` (and call UI) — Provider switching, call controls (the single "use client" boundary per AGENTS.md).

**Cookbook patterns to borrow (read-only reference)**:
- `voice-examples/agent/web/xai/backend-{node,python}/` + client `hooks/useWebSocket.ts` + `useAudioStream.ts` (ephemeral + direct, dynamic sampleRate, session config shape).
- `voice-examples/agent/webrtc/server/src/xai-client.ts` (very similar config, debug logging, ready signaling).
- `voice-examples/agent/telephony/xai/src/index.ts` + `bot.ts` (G.711 pcmu, custom `function` tool + full handler, `response.output_item.added`, input transcription, ENABLE_TOOLS flag, outbound flow, turn tracking).
- `voice-examples/agent/README.md` + per-example READMEs (architecture diagrams, disclaimers, comparison table).

**Docs (authoritative)**:
- Voice Agent API + Best Practices (latency parallel init, session params table, tools (web_search / x_search / mcp / function), function call flow, OpenAI migration notes, supported languages, audio formats/rates).
- Custom Voices (creation, recording guidelines, metadata fields, voice_id interchangeability, limits, geo).
- Ephemeral Tokens (exact browser subprotocol).
- Models + Pricing (text input billing, rate limits).

---

## Verification Approach (Once Approved for Implementation)

Run the full gate **before any PR** (per AGENTS.md):
1. `bunx tsc --noEmit`
2. `bun run lint`
3. `bun run fmt:check`
4. `bun run build`

**Functional verification** (Chrome DevTools MCP at 1440×900 + mobile 390×844 recommended):
- Switch provider to xAI (Grok) for each of the 6 personas.
- Start call; measure time-to-first-agent-audio and time-to-first-user-barge-in.
- Test natural pauses (slow personas should not get cut off).
- Trigger web_search via conversation (e.g. "what's the weather in SF?"); verify tool use doesn't break audio flow or cause overlap.
- Interrupt mid-response (barge-in orb behavior).
- Long sessions (monitor for drift, memory, WS health).
- Mute/unmute, volume orb reactivity (input + output RMS).
- Switch providers mid-experience (existing guard in hook).
- (Future) If custom voices added: console-create one, hardcode its id for a test persona, confirm it loads and sounds distinct.

**Optional deeper**:
- Compare side-by-side with ElevenLabs provider for same persona (timbre/pacing delta).
- Add a temporary debug panel (like cookbook) showing raw events + VAD decisions.
- Lighthouse / Web Audio performance trace during parallel-buffering change.

**No new tests required unless adding complex new behavior** (current is mostly integration via the console UI).

---

## Summary Recommendation

The xAI path was already high quality at review time. **Items 1 and 2 are done** (`ae857c7`). Remaining suggestions are optional or roadmap — no further work required for the Grok voice agent unless product needs change.

**Open backlog (optional / roadmap only)**:
1. ~~Parallel mic + early audio buffering~~ — done
2. ~~Per-persona VAD presets~~ — done
3. Model pinning + prompt compression pass (optional)
4. Custom voice support per persona (roadmap)

---

**Final note**: Original exploration (2026-05) recommended no immediate changes. Follow-up implementation (2026-05-30) addressed the two highest-impact items only. This file is the authoritative in-repo copy of that review plus current status.

**End of document**.
