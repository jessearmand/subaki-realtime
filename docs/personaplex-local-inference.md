# PersonaPlex local inference on Apple Silicon (MLX)

Status: **Phase 1 verified on hardware** — q8 is realtime on M5 Max (benchmarks below); live web server runs at `localhost:8998`. Remaining: subjective live-conversation notes (requires mic + headphones — the bundled client has no echo cancellation).

## What we're running

- **Model:** [nvidia/personaplex-7b-v1](https://huggingface.co/nvidia/personaplex-7b-v1) — full-duplex speech-to-speech (Moshi architecture, 8.37B params incl. depth transformer + Mimi codec), conditioned on a voice prompt (`NATF0-3`, `NATM0-3`, `VARF0-4`, `VARM0-4` presets) and a free-text persona prompt. Gated: auto-approve after accepting the NVIDIA Open Model License (account-level, do it once in the browser).
- **Runtime:** [mu-hashmi/personaplex-mlx](https://github.com/mu-hashmi/personaplex-mlx) — Python MLX port (moshi_mlx fork) with realtime web mode (`personaplex_mlx.local_web`), realtime terminal mode, and offline WAV mode. Quantizes the bf16 checkpoint at load time (`-q 4|8`).
- **Follow-up checkpoint (Phase 2):** [kyutai/personaplex-rl-seamless](https://huggingface.co/kyutai/personaplex-rl-seamless) — RL fine-tune for turn-taking/backchanneling. Gated, bf16 only, RL delta licensed CC BY-NC 4.0 (non-commercial).

## Setup (commands that worked)

```bash
git clone https://github.com/mu-hashmi/personaplex-mlx ~/Develop/personaplex-mlx
cd ~/Develop/personaplex-mlx
uv venv --python 3.12 .venv
uv pip install -e . --python .venv/bin/python

# one-time: accept the license at https://huggingface.co/nvidia/personaplex-7b-v1
hf download nvidia/personaplex-7b-v1   # ~17GB model.safetensors + tokenizer + mimi + voices.tgz + dist.tgz

.venv/bin/python -m personaplex_mlx.local_web -q 8 \
  --voice NATF2 \
  --text-prompt "You enjoy having a good conversation."
# web client + WebSocket at http://localhost:8998
```

Notes:

- `-q 8` quantizes in-process from bf16 (no pre-quantized `model.q8.safetensors` exists in the NVIDIA repo). Community benchmarks of the Swift MLX build report 4-bit produces garbled output; prefer 8-bit or bf16.
- The bundled web client has **no echo cancellation** — use headphones.
- Quantization at load is cheap (~2s total to load + quantize on M5 Max), so there's no need to persist quantized weights.
- Benchmark harness: `bench_steps.py` in the fork checkout (`~/Develop/personaplex-mlx`); response audio samples: `bench-output-q8.wav` / `bench-output-bf16.wav` there.

## Phase 2: kyutai RL checkpoint (done — 2026-06-18)

`kyutai/personaplex-rl-seamless` is gated **auto** and its file layout is identical to base (`model.safetensors`, same Mimi checkpoint, tokenizer, `voices.tgz` — same 18 NATF/NATM/VARF/VARM voices). License accepted on account jessearmand. Runs via the same server:

```bash
.venv/bin/python -m personaplex_mlx.local_web -q 8 --hf-repo kyutai/personaplex-rl-seamless ...
```

**One code fix was required.** Unlike base (whose `config.json` is a stub with no `dim`, routing to the hardcoded `config_personaplex_7b_v1()`), the RL repo ships a *full* `config.json`, so the fork parses it via `LmConfig.from_config_dict` — which had two bugs: it hardcoded the feed-forward width as `4 * dim` (PersonaPlex uses `hidden_scale = 4.125`, so weights wouldn't match) and passed `depformer_dim_feedforward` straight through (it's `null` in the RL config → `TypeError`). Fixed `from_config_dict` in `personaplex_mlx/models/lm.py` to honor `hidden_scale` (default 4) for both the main and depformer feed-forward dims. After the fix the RL model loads and runs realtime at q8: **67.3 ms/step mean, p95 70.2 ms, RTF 0.84, 10.1 GB** (≈3 ms/step slower than base, still comfortably realtime).

### A/B vs base — greeting cadence is unchanged

RL-seamless is RL-tuned for **interaction dynamics** (pause handling, turn-taking, backchanneling, user interruption), *not* solo-monologue fluency. Confirmed by an opening-greeting cadence A/B (voiced fraction of the first 3 s, silence mic, 3 seeds each via `scratchpad/cadence.py`):

| model | medical greeting (voiced %, 3 seeds) |
| ----- | ------------------------------------ |
| base `nvidia/personaplex-7b-v1` | 63 / 56 / 75 (avg ~65%) |
| RL `kyutai/personaplex-rl-seamless` | 68 / 64 / 62 (avg ~65%) |

Statistically identical — **RL does not fix the halting/choppy opening greeting** (that cadence is inherent to the architecture's solo speech rhythm, and is already faithfully reproduced; see the residual-glitch section). RL's benefit appears only in live conversation (turn-taking, fewer mid-greeting/mid-turn self-interruptions), which the headless silence probes can't exercise — evaluate it in the browser. The mic-gate already covers the greeting-interruption case for both checkpoints.

A user recording of a full RL conversation (`astronaut_conversation.webm`, 5m39s) confirms it: onset 0.29s but only ~1% voiced in the first 3s — the opening is tiny fragments (70–360ms) then a 3.6s wait, **zero clicks** (max sample step 0.103). Same halting cadence as base, no codec artifact.

### Why the halting cadence is inherent to the architecture

The "glitch" is the model's *speaking rhythm*, and it falls out of how Moshi/PersonaPlex generates — it is not a bug we can tune away in the serving stack:

1. **Frame-synchronous streaming at 12.5 Hz with an "inner monologue."** Every 80 ms the model jointly samples **one text token** — an inner-monologue word-piece, *or* a `PAD`/`EPAD` token (ids 0–3) meaning "emit no word this frame" — together with the matching Mimi audio codebooks (`delays=[0,0,1,1,…]` is the text→audio acoustic offset). Speech only comes out on frames where the text stream emits a real word-piece; between word-pieces it emits `PAD` and the audio is silence/breath. So speech is *intrinsically* delivered in word/syllable-sized bursts separated by pad-driven gaps — **the 50–360 ms "gaps" we measure are `PAD` runs in the inner monologue, not dropped audio.**

2. **No utterance-level prosody planning.** To stay ready to yield to the user at any 80 ms frame (full-duplex), the model commits token-by-token with no look-ahead over the whole sentence. A non-streaming TTS plans a smooth pitch/timing contour across the entire utterance; Moshi decides "speak or pad" and "which word-piece" one frame at a time under temperature sampling. That yields choppier, less-planned timing — most pronounced at turn onset, before the model "gets going."

3. **Trained on natural two-person dialogue.** The data is real conversational speech — hesitations, variable pacing, mid-sentence pauses — not the polished read-aloud prosody of TTS corpora. The model faithfully reproduces that disfluent, conversational cadence rather than narration smoothness.

4. **It's the price of full-duplex.** The very mechanism that lets the model listen and barge-in at 80 ms granularity (per-frame speak/pad decision, no look-ahead) is what makes its monologue halting. One autoregressive stream can't be both narration-smooth *and* 80 ms-responsive. RL-seamless tunes *when* to pad/yield in response to the user (turn-taking); the *within-turn* word-by-word delivery is structural — hence unchanged in the A/B above.

**Implication:** smoothing the opening would require a different model class (a non-streaming TTS for the greeting, or a half-duplex turn-based model that plans whole utterances), not a fix to PersonaPlex serving. Within PersonaPlex the levers are marginal — lower audio-sampling temperature, voice-prompt choice, or simply accepting it as the model's conversational voice. This is the main reason to evaluate alternatives like the Voxtral cascade ([voxtral-local-inference.md](voxtral-local-inference.md)).

## Measurements

Hardware: **Apple M5 Max, 64GB unified memory**. Benchmark: `bench_steps.py` in the fork's checkout — mirrors the offline generation loop (mimi encode + LM step + mimi decode per 80ms frame) over a 10.6s/133-step input, timed per step (first 2 warmup steps excluded), voice `NATF2`.

| Config | ms/step mean (budget 80ms) | p95  | max  | RTF  | Peak memory | Load time |
| ------ | -------------------------- | ---- | ---- | ---- | ----------- | --------- |
| q8     | 64.0                       | 65.9 | 67.4 | 0.80 | 10.1 GB     | 1.7s + 1.1s prompts |
| bf16   | 78.7                       | 80.9 | 83.2 | 0.98 | 15.9 GB     | 1.2s + 1.2s prompts |

- q8 is **realtime with ~20% headroom** — p95 well under the 80ms frame budget, very low jitter (max 67.4ms).
- bf16 is **not reliably realtime** (p95 crosses the 80ms budget) — use q8. This also means the bandwidth-bound 7B temporal transformer is the bottleneck, so the q8 headroom is genuine, not load-order luck.
- End-to-end response latency (by ear):
- Barge-in / interruption behavior:
- Voice preset notes:

## Protocol (verified in source — basis for the future Tsubaki engine)

WebSocket at `ws://localhost:8998/api/chat`. Binary frames, first byte is the message tag:

| Tag    | Meaning                                              |
| ------ | ---------------------------------------------------- |
| `0x00` | handshake                                            |
| `0x01` | audio — continuous **Ogg Opus** stream (24kHz mono), both directions |
| `0x02` | text token (agent transcript)                        |
| `0x06` | ping                                                 |

Session config travels as **URL query params** on connect: `text_prompt`, `voice_prompt` (e.g. `NATF2.pt`), temperatures, top-k, seeds, repetition penalty. Mimi codec frames are 80ms (12.5Hz) — each model step must complete in ≤80ms for realtime.

## Review

First impression, I can see the default voice greeting that the model is outputting, but the voice or speech couldn't be heard clearly. It can be about the codec, it can be about thhe MLX inference itself. I couldn't test further because the speech itself is not being played back correctly

### Diagnosis (2026-06-13)

Investigated the full path: MLX inference → Mimi decode → `sphn` Opus encode → WebSocket → browser `opus-recorder` decode → `moshi-processor` AudioWorklet. **The audio pipeline is correct end to end — the greeting is clean, normal-level, intelligible speech, and the browser reproduces it faithfully.** Evidence:

1. **Inference** — offline q8/bf16 produce coherent audio and text (`bench-output-q8.wav`).
2. **Opus codec is transparent** — a controlled 200 Hz tone round-trips through `sphn.OpusStreamWriter(24000)` at 1.00s→1.00s; ffmpeg/libopus (what the browser uses) agrees. The `OpusHead` declares `input_sample_rate=48000`, which is *normal* per RFC 7845 (informational only; decoders always run at 48 kHz internally) — it is **not** a bug.
3. **Browser playback is faithful** — captured the raw server Opus *and* the decoded frames fed to the playback worklet **in the same session** (browser instrumented via chrome-devtools). Played-vs-server duration ratio = **1.008**, pitch identical (**86.5 Hz** both). No 2× inflation, no sample-rate error. (An earlier "2× / lower-pitch" read was an artifact of comparing two *different* stochastic sessions — each connect uses a fresh seed and greets differently.)
4. **Streaming audio is spectrally clean** — spectral flatness 0.006–0.053 (tonal/harmonic speech; garbled noise would be >0.3). Levels match the known-good offline output (loudest-1s RMS 0.097 vs 0.099).

**So the in-browser "can't be heard clearly" is not inference, codec, or sample-rate.** Confirmed by the user: `afplay ws-greeting.wav` is perfectly clear, and the browser greeting stays mangled even on AirPods Pro 2 with noise cancellation — so it is **not** echo/feedback either (the earlier echo hypothesis is retracted).

### Root cause (proven at the speaker output)

Instrumented the live page to capture, in the same session, both the audio frames *delivered into* the playback worklet and the audio it *outputs to the speakers* (ScriptProcessor tap on the worklet node):

| Tap | duration | peak | rms | silence |
| --- | -------- | ---- | --- | ------- |
| delivered → worklet | 17.44s | 0.316 | 0.0155 | — |
| worklet → speakers  | 17.92s | 0.160 | 0.0032 | **98% of frames** |

The worklet receives clean, full-level audio but emits ~98% silence at roughly half the peak and a fifth of the RMS. Cause: **the server streams the opening greeting as a ~2× realtime burst** (`send_loop` ships decoded PCM as fast as it's produced, with no realtime pacing; the model runs at RTF ~0.8 and isn't gated by mic input at connect). The bundled client's barebones `moshi-processor` AudioWorklet has only an ~80–240 ms jitter buffer (observed startup `delay` peaked at **2.24s**); it cannot absorb a multi-second burst, so its overflow-drop + glitch-fade path collapses to near-silence. Hence: clean via `afplay` (no worklet), mangled in-browser, unaffected by headphones/NC.

This is a limitation of the bundled barebones web client, **not** the model or the serving stack.

### Mitigations

- For evaluation, audition greetings headlessly (bypasses the worklet) — see samples below.
- For the bundled client specifically, the real fix is server-side realtime pacing of `send_loop` and/or a larger client jitter buffer; not worth patching since we won't ship that client.
- **Tsubaki engine:** `use-moshi-session.ts` owns its own playback (reuse `PlaybackQueue` from `xai-audio.ts`) and mic capture, so it gets a properly sized jitter buffer, output gain, and `echoCancellation: true` constraints for free — the burst-collapse cannot happen there.

### Greeting samples (headless, clean) — `afplay ~/Develop/personaplex-mlx/greet-<name>.wav`

Generated via `greetings_batch.sh` (per-connection `voice_prompt`/`text_prompt` query params against the running server; no restart needed):

| name | voice | transcript |
| ---- | ----- | ---------- |
| medical | NATF2 | "Good morning, you're calling Dr. Jones's medical office. How can I help today?" |
| bank | NATF1 | "Thank you for calling First Neuron Bank. How can I help today?" |
| concierge | NATF3 | "Hello, this is Tsubaki speaking. How can I assist you today?" |
| astronaut | NATM0 | "Hello, this is Alex." (discussion personas expect a human first; less monologue from silence) |

Note: with silence-only input the model gives a natural phone greeting then waits for the caller — service personas (medical/bank/concierge) yield the most natural multi-clause openings. The `text:` token stream shows minor display artifacts (e.g. "you'" for "you're"); the audio is correct.

Diagnostic harnesses (in `~/Develop/personaplex-mlx`): `ws_probe.py` (headless WS client → decodes server greeting to WAV; `--dump-opus` for the raw stream), `bench_steps.py`, `greetings_batch.sh`.

### Fix applied (2026-06-15)

Two server-side changes landed in `personaplex-mlx`:

1. **Realtime output pacing** (user commit `e41bf5a`, `OutboundAudioPacer`) — releases decoded PCM at realtime cadence instead of bursting, plus an in-memory patch that enlarges the bundled worklet's jitter buffer (80→320 ms initial, max 1200 ms). Killed the 2× **overflow** burst above, but exposed an **underrun**.
2. **`model_loop` yield + startup warmup** (`local_web.py`) — `await asyncio.sleep(0)` between MLX steps so the paced `send_loop` is never starved while draining a startup backlog (was a ~460 ms event-loop stall → worklet underrun → crackle), plus a `ServerState.warmup()` that pre-compiles the sampling graph so the first session doesn't compile-stall.

Verified: server delivery stalls >120 ms went 2→0 (gaps now 80–100 ms from the first frame, real-speech input included); browser worklet output went from 98 %-silence to faithfully matching its input (peak 0.316, **0 discontinuities**). Probes: `scratchpad/gap_timeline2.py`, `convo_probe.py`.

### Residual "glitch": full-duplex self-interruption (not a pipeline bug)

After the fix, a user recording of a live "Bank" conversation (`bank_teller_personaplex_audio.webm`) still had a choppy opening: silence dropouts of ~1120 ms and ~860 ms in the first ~2.7 s, then clean. But the recording has **zero clicks** (max sample step 0.032) — these are clean silence gaps, not codec/buffer artifacts. Tracing it:

- Server delivery under real-speech mic input is **smooth** (p95 84 ms, no gaps >120 ms) — so the dropouts are **not** produced on the wire.
- With **pure-silence** mic, the greeting is **continuous** (onset 0.22 s → 3.52 s, no internal gaps).
- Feeding low-level mic **noise** reproduces the dropouts: at −40 dB an internal 300 ms gap appears and the greeting is cut short; at higher levels it truncates further.

**Conclusion:** the full-duplex model pauses/cuts its own greeting whenever it detects mic activity. The bundled client requests `echoCancellation:true, noiseSuppression:true, autoGainControl:true`, but **AGC boosts ambient room noise/breathing** during the silent greeting window enough to trip the model's turn-taking — even on AirPods (no real echo). This is model behavior, not the codec/pacing/buffer path.

Mitigations (for the future Tsubaki engine, which owns mic capture):
- **Gate the mic during the opening greeting** — withhold mic frames (or hard-gate below a VAD threshold) until the model finishes greeting / the user clearly speaks. Simplest, most effective.
- Disable `autoGainControl` (keep `echoCancellation`/`noiseSuppression`) so ambient noise isn't amplified into false speech.
- The RL checkpoint `kyutai/personaplex-rl-seamless` specifically targets "inappropriate interruptions" and should be less twitchy here — worth A/B-ing in Phase 2.

Probes for this: `scratchpad/silence_greeting.py`, `noise_greeting.py`, `convo_probe.py`.

### Mic-gate prototype (2026-06-15) — implemented & validated

Prototyped the mic-gate **server-side** in `personaplex-mlx` (cleaner than patching minified client JS; the server directly controls model input):

- `personaplex_mlx/greeting_gate.py` — `GreetingGate`: starts muted, feeds the model silence; observes the model's decoded **output** and opens once it has produced voiced audio and then `end_silence_ms` of quiet (greeting turn over), with a `max_ms` safety cap. Sample-count based (no wall clock) → deterministic, unit-tested (`tests/test_greeting_gate.py`).
- `local_web.py` — instantiated per session; `recv_loop` replaces mic frames with silence while `is_muted()`, `send_loop` calls `observe_output()`. On by default; flags `--no-greeting-gate`, `--greeting-gate-{rms,end-ms,max-ms}` (defaults 0.02 / 600 / 12000).

Validated against the same noise that previously chopped the greeting — same prompt/seed, gate ON, varying only mic level:

| mic level | greeting (gate ON) | greeting (gate OFF, prior) |
| --------- | ------------------ | -------------------------- |
| 0.0 silence | continuous 0.22→3.76s | continuous →3.52s |
| 0.03 noise | continuous 0.22→**3.76s** | truncated →2.9s |
| 0.08 loud noise | continuous 0.22→**3.76s** | (worse) |

The greeting is now identical regardless of mic noise, and an end-to-end probe (`scratchpad/gate_e2e.py`) confirms the gate **opens after the greeting** so the model responds to subsequent user speech. Gates pass: `ruff format`/`check`, `ty`, 11 tests. The browser receives the gated (clean) greeting unchanged, since the gate is upstream of Opus/WS. Next: port the same logic into `use-moshi-session.ts` (client-side, plus `autoGainControl:false`).

## mlx-audio evaluation (`~/Develop/mlx-audio`) — considered, not adopted

Checked whether [mlx-audio](https://github.com/Blaizzy/mlx-audio) (Blaizzy, MIT, actively maintained) can replace or augment our stack. **We do not use it anywhere** (neither `personaplex-mlx` nor `realtime-persona` reference it; our codec path is `rustymimi` + `sphn`). Findings:

- It has a **pure-MLX Mimi codec** and a **full-duplex Moshi STS** (`sts/models/moshi/`, `generate()` accepts user-mic audio, warms its tokenizer) — but it's **base `moshiko` only**, with **zero PersonaPlex/NVIDIA awareness** (no voice-prompt `.pt` injection, no text-persona `step_system_prompts`, no `config_personaplex_7b_v1`). It cannot run PersonaPlex without porting all the persona conditioning our fork already implements.
- Its server's `/v1/realtime` WebSocket is **STT-only** (OpenAI-Realtime *transcription* — no speech output); there's no full-duplex STS browser server, so it doesn't solve the web-serving problem `local_web.py` does.
- Its realtime code independently documents the **same MLX+asyncio constraint** we hit ("MLX streams are thread-bound… all realtime MLX work must share one thread"), serialized via an inference lock — confirming the event-loop-blocking root cause behind the greeting crackle was intrinsic, not a fork bug.

**Verdict:** keep `personaplex-mlx` for PersonaPlex full-duplex; do **not** migrate the codec. Revisit mlx-audio only if/when Tsubaki wants **non-duplex local engines** (local TTS like Kokoro/Sesame, or local STT like Parakeet/Whisper) — its OpenAI-compatible API would map cleanly onto the existing token-mint/engine patterns.

## Voxtral cascade (Mistral) — moved

The Voxtral STT / TTS / cascade-LM evaluation (the turn-based STT → LM → TTS
alternative to full-duplex PersonaPlex) now lives in its own document:
[voxtral-local-inference.md](voxtral-local-inference.md). It covers the local
Voxtral models, the swappable-LM cascade prototype, end-to-end latency, and what
the app needs to run the `MISTRAL` cascade row on-device. The full-duplex
architecture (this doc) and the cascade are complementary tracks; see the
comparison table there.

## Tsubaki integration — full-duplex `moshi` engine (assessed, not yet built)

No WebRTC and no new web architecture needed — this is a direct-WebSocket engine like xAI (`lib/realtime/use-xai-session.ts`):

- `use-moshi-session.ts` implementing `SessionApi`; provider entry `engine: "moshi"` → `ws://localhost:8998/api/chat`; per-persona `moshi-agent.ts` resolving voice/text prompts into query params.
- New piece: browser-side Opus (`opus-recorder` encode / `ogg-opus-decoder` decode) instead of PCM16-base64; playback reuses `PlaybackQueue` from `xai-audio.ts`.
- Full-duplex consequences: no user-side transcript (no ASR events), `interrupt()` is a no-op (model handles barge-in natively), `callState` derives from output audio activity.
- **Mic-gate the opening greeting** (see residual-glitch section): hold/threshold mic frames until the greeting completes, and set `autoGainControl:false` (keep `echoCancellation`/`noiseSuppression`), so ambient noise doesn't make the model interrupt its own greeting.
