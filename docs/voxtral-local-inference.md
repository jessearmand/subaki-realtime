# Voxtral local inference (Mistral) — cascade STT/LM/TTS on Apple Silicon

Status: **Both cascade legs validated on hardware (M5 Max)** — Voxtral STT (voxmlx)
and Voxtral TTS (mlx-audio) run realtime with large headroom; a swappable-LM
cascade prototype (`~/Develop/voice-cascade/`) measured end-to-end latency. The
app today runs the **same models via Mistral's cloud API** (`app/api/llm`,
`app/api/mistral/tts`, and the realtime-STT proxy); this doc records what the
**local** path needs so the `MISTRAL` cascade row can run STT → LM → TTS on-device.

This is the **cascade** (turn-based STT → LM → TTS) track. The **full-duplex**
speech-to-speech track (NVIDIA PersonaPlex / kyutai RL-seamless, Moshi
architecture, the `moshi` engine) lives in
[personaplex-local-inference.md](personaplex-local-inference.md). The two
architectures trade off along a cadence axis:

| | PersonaPlex (full-duplex S2S) | Cascade (Voxtral STT → LLM → TTS) |
| --- | ----------------------------- | --------------------------------- |
| Assistant voice | model generates it directly | a TTS generates it |
| Opening/utterance cadence | **halting** (per-frame speak/pad, no look-ahead) | **smooth** (TTS plans whole utterance) |
| Turn-taking / barge-in | native, 80 ms granularity | turn-based; barge-in must be engineered (VAD + cancel) |
| Latency | ~160 ms model delay, one model | STT delay + LLM TTFT + TTS first-chunk (additive) |
| Voice/persona control | voice-prompt `.pt` + text prompt | full control (any TTS voice + system prompt) |
| Local cost on M5 Max | q8 ~10.1 GB, RTF 0.84 | Voxtral 4.2 GB RTF 0.09 + LLM + TTS (all fit in 64 GB) |

So the cascade is the path to **smooth assistant speech** (no halting greeting) at
the cost of true full-duplex naturalness and additive latency. Voxtral's tiny
footprint (4.2 GB, RTF 0.09) leaves ample room for a local LLM + a local TTS on
the same machine.

## The three legs

### Voxtral STT — the ASR front-end (`~/Develop/voxmlx`, 2026-06-18)

[Voxtral-Mini-4B-Realtime-2602](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602)
(Mistral, **Apache-2.0**) run via [awni/voxmlx](https://github.com/awni/voxmlx).
**Crucial: this is streaming ASR — audio in, *text* out. It does not generate
speech.** ≈3.4B LM + ≈970M causal audio encoder, natively streaming
(sliding-window attention, <500 ms claimed delay), 16 kHz mono input, 13 languages.

Setup + benchmark on **M5 Max**:

```bash
git clone https://github.com/awni/voxmlx ~/Develop/voxmlx && cd ~/Develop/voxmlx
uv venv --python 3.12 .venv && uv pip install -e . --python .venv/bin/python
.venv/bin/voxmlx --audio file.flac          # file mode (soundfile-readable: flac/16k wav)
.venv/bin/voxmlx                            # mic streaming
```

Default model `mlx-community/Voxtral-Mini-4B-Realtime-6bit`. Results (offline
batch, `scratchpad/bench_vox.py`): **RTF 0.091 (~11× realtime), 4.2 GB peak, 0.6 s
load**, transcription verbatim-accurate on a 10.6 s clip. (A non-16k/flac WAV
failed `soundfile.read`; convert with ffmpeg to `-ac 1 -ar 16000` flac first.) The
<500 ms figure is the streaming-mode incremental delay (design-bound, not
compute-bound — compute has 10× headroom).

### Voxtral TTS — the speech-generation leg (`~/Develop/mlx-audio`, 2026-06-18)

[Voxtral-4B-TTS-2603](https://huggingface.co/mistralai/Voxtral-4B-TTS-2603)
(Mistral; **CC-BY-NC-4.0**, non-commercial) runs locally via **mlx-audio**
(`voxtral_tts` model) using the `mlx-community/Voxtral-4B-TTS-2603-mlx-6bit` quant.
1016 M params, 24 kHz output, **20 preset voices** across 9 languages
(`casual_male`, `cheerful_female`, `neutral_male`, `fr_female`, …; no voice
cloning).

Setup + benchmark on **M5 Max**:

```bash
cd ~/Develop/mlx-audio && uv venv --python 3.12 .venv
uv pip install -e . "mistral-common[audio]" soundfile --python .venv/bin/python
# from mlx_audio.tts.utils import load; model = load("mlx-community/Voxtral-4B-TTS-2603-mlx-6bit")
# model.generate(text=..., voice="cheerful_female", stream=True, streaming_interval=0.08)
```

Results (`scratchpad/bench_tts.py`, `ttfa.py`): **RTF 0.25–0.42, 4.0 GB peak, 3.0 s
load**, coherent multilingual speech. Crucially for a cascade, it **streams**:
warm **time-to-first-audio ≈ 80–150 ms** (at `streaming_interval=0.08–0.5`; the
first cold call is ~1 s due to graph compile). At `temperature=0.8`
sentence-boundary pauses can run long (a 1.4 s inter-sentence gap in one take) —
`temperature≈0.5` tightens it. Samples staged at
`~/Develop/mlx-audio/voxtral_tts_medical*.wav`.

> mlx-audio (Blaizzy, MIT) is the runtime for the local TTS leg. It also has a
> pure-MLX Mimi codec and a full-duplex Moshi STS, but that path is **base
> `moshiko` only** (no PersonaPlex conditioning) and its `/v1/realtime` WebSocket
> is **STT-only** — see the mlx-audio evaluation in
> [personaplex-local-inference.md](personaplex-local-inference.md) for why it does
> not replace the full-duplex serving stack.

**Both cascade legs validated locally:** Voxtral STT (4.2 GB, RTF 0.09, <500 ms
streaming) + Voxtral TTS (4.0 GB, RTF ≤0.42, TTFA ~80–150 ms) ≈ **8 GB combined**,
leaving room for a local LLM in 64 GB — and the whole cascade can run alongside or
instead of PersonaPlex (10.1 GB). Whether the TTS actually *sounds* smoother than
PersonaPlex's halting opening is a by-ear judgment (the voiced-fraction metric,
45–68 %, overlaps PersonaPlex and can't distinguish planned-TTS prosody from
per-frame halting) — but a TTS plans whole utterances, which is the structural
reason to expect smoother delivery. License caveat: TTS is **CC-BY-NC**
(non-commercial).

### Cascade LM stage + end-to-end latency (`~/Develop/voice-cascade/`, 2026-06-19)

Prototyped the **LM → TTS** half of the cascade with a **swappable LM** at
`~/Develop/voice-cascade/` (Python; runs in the mlx-audio venv). The LM stage
(`cascade/lm.py`) has one streaming interface with three backends, selected by
`LMConfig.engine` — mirroring Tsubaki's `provider.engine` switch:

- **`engine="hf"`** — any chat model on the Hub via **Hugging Face Inference
  Providers**. `huggingface_hub.InferenceClient(provider="auto")` hits the unified
  **router** (OpenAI-compatible,
  `https://router.huggingface.co/v1/chat/completions`); token from `hf auth
  login`/`HF_TOKEN`, no local download. (The `hf-inference` provider itself now
  serves mostly CPU/small models; for conversational LLMs use `provider="auto"`,
  which routes to partner providers.)
- **`engine="openai"`** — any **OpenAI-compatible** `/v1` endpoint via httpx+SSE: a
  local **`llama-server`** (llama.cpp, GGUF + MTP speculative decoding), vLLM, etc.
  The difference from the HF path is just `base_url`. This is the path for models
  **no provider serves** (e.g. `Qwen/Qwen3.6-35B-A3B` → BadRequest on the router;
  only GGUF/FP8 quants exist).
- **`engine="local"`** — local MLX via `mlx-lm` (written, untested — needs a model
  download).

Router LM results (M5 Max client, `bench_lm.py`, `provider="auto"`):

| model | TTFT | tok/s | served? |
| ----- | ---- | ----- | ------- |
| meta-llama/Llama-3.3-70B-Instruct | 439 ms | 34.1 | ✅ router |
| Qwen/Qwen2.5-7B-Instruct | ~510 ms | ~22 | ✅ router |
| google/gemma-4-31B-it | 503 ms | 15.2 | ✅ router (needs thinking off) |
| google/gemma-4-26B-A4B-it | 0.5–5 s (variable) | 1.8–10 | ✅ router (MoE; provider-side queueing) |
| Qwen/Qwen3.6-35B-A3B | — | — | ❌ no provider → local llama-server |

**Reasoning-model gotcha (found via `gemma-4-31B-it`):** it streams
chain-of-thought in a `reasoning` delta field and emits **no spoken `content`**
until thinking ends, so a small token budget yields zero output (looks like a
failure — a `TypeError` in the bench, not a 4xx). Fix:
`LMConfig.enable_thinking=False` (default), which sends
`chat_template_kwargs:{enable_thinking:false}` to the router (`extra_body`) and
llama-server (body) — ignored by non-reasoning models. A voice agent never speaks
the CoT and wants low latency, so thinking stays off. With it off,
`gemma-4-31B-it` → TTFT 503 ms. (This is exactly the `supportsThinking` flag in
the app's `config/lm-models.json`.)

End-to-end cascade → Voxtral TTS: `gemma-4-31B-it` **TTFT 503 ms, first-audio
1357 ms**; `gemma-4-26B-A4B-it` first-audio 1187 ms (when the provider is warm).
Local llama-server path (gemma-4-12B-it-qat GGUF + MTP) wired via `engine="openai"`.

End-to-end **LM → clause-segmented → Voxtral TTS** (`demo_cascade.py`, TTS warmed):
**time-to-first-audio ≈ 1.5 s**, full short turn ≈ 3 s. Dominated by the LM
round-trip (network + provider TTFT ~0.5 s + first-clause generation) plus warm
TTS synth (~80–150 ms). A *local* LM removes the network leg; PersonaPlex
full-duplex is ~160 ms by comparison — **the cascade trades ~1.5 s first-audio for
smooth, controllable, any-model speech.**

## What the app runs today (cloud Voxtral)

The `MISTRAL` provider row (`engine: "cascade"` in `lib/data.ts`, `exec: "local /
remote"`) already runs the full cascade — but every model leg is a **cloud** call
to Mistral / the HF router. The only on-device pieces are Silero VAD (turn
detection) and mic/audio capture:

| Leg | Today (cloud) | Local Voxtral equivalent |
| --- | ------------- | ------------------------ |
| STT | Mistral realtime WS (`voxtral-mini-transcribe-realtime-2602`) via the Bun proxy `scripts/mistral-stt-proxy.ts` | voxmlx (`Voxtral-Mini-4B-Realtime`) |
| LM | `app/api/llm` → catalog backend (`hf` router / `mistral`) | local OpenAI-compatible server (llama-server / mlx-lm / vLLM) |
| TTS | `app/api/mistral/tts` → `voxtral-mini-tts-2603` | mlx-audio (`Voxtral-4B-TTS-2603`) |
| Turn detection | Silero VAD (browser, onnxruntime-web) — already local | unchanged |

So "local Voxtral" is not a new engine — it is the **same cascade topology with
each leg pointed at a local server** instead of Mistral's API.

## What needs to be prepared for local Voxtral

Ordered easiest → hardest. Each leg maps to an existing seam in the app.

### 1. LM → local (smallest change)

The LM leg is already backend-agnostic (`config/lm-models.json` +
`resolveLmBackend`; the route pipes OpenAI-compatible SSE verbatim). A local server
is just a catalog entry:

```jsonc
// config/lm-models.json → backends
"local": {
  "url": "http://localhost:8080/v1/chat/completions",
  "envKey": "",          // keyless localhost
  "supportsThinking": true
}
```

**One code change:** `app/api/llm/route.ts` currently returns 500 when the
backend's `envKey` is unset. Make the auth header optional so a keyless local
backend is allowed (`if (backend.envKey) headers.Authorization = ...`). Then add a
`models[]` entry pointing at the local server and pick it from the Providers model
picker.

Serving options (any OpenAI-compatible `/v1`): `llama-server` (llama.cpp, GGUF +
MTP), `mlx_lm.server`, vLLM, or LM Studio. The `voice-cascade` prototype already
proved the `engine="openai"` path against a local `llama-server`.

### 2. TTS → local (small refactor)

`app/api/mistral/tts/route.ts` **hardcodes** the Mistral URL + model — unlike the
LM leg, it never got the catalog treatment. To go local:

- Give TTS a small catalog (a `tts` section in `config/lm-models.json` or a sibling
  file): `{ url, envKey, model, voiceMap }`, and resolve a backend per request the
  way `/api/llm` does.
- Stand up an mlx-audio HTTP endpoint serving `voxtral_tts` and point a `local`
  TTS backend at it.
- **Voice mapping:** `cascade-agent.ts`'s `ttsVoice` is a flat Mistral `voice_id`
  slug (`gb_jane_neutral`). mlx-audio uses different preset names
  (`cheerful_female`, `neutral_male`, …). Each persona needs a per-backend voice
  map, not one string — the cleanest place is a `voiceMap` in the TTS backend
  config keyed by persona.

### 3. STT → local (largest change)

The browser speaks the **Mistral realtime WS protocol**
(`session.update` / `input_audio.append` / `transcription.text.delta`) to the Bun
proxy. Two ways to go local:

- **(a) Local realtime WS shim** — a small server wrapping voxmlx that speaks the
  same wire protocol, then flip `NEXT_PUBLIC_MISTRAL_STT_WS` to
  `ws://localhost:<port>`. Keeps the entire client path (`mistral-stt.ts`, Silero
  VAD, partial captions) unchanged. Most work, cleanest result. (voxmlx today is a
  CLI/mic tool, not a server — the shim is the missing piece.)
- **(b) Per-turn batch STT** — Silero VAD already owns turn boundaries client-side,
  so POST each finished turn's PCM to a local `/api/stt` → voxmlx and skip the
  streaming WS entirely. Loses live partial captions but is far simpler; a good
  MVP given VAD already fires end-of-turn.

### Serving / ops

Local Voxtral means running background inference servers alongside `bun run dev`:
voxmlx (STT, option a) or an `/api/stt` route (option b), an mlx-audio TTS
endpoint, and a local LLM server. Worth a `mise` task group (mirroring `mise run
stt-proxy`) that brings the local stack up/down. All three fit comfortably in
64 GB (STT 4.2 + TTS 4.0 + a mid-size LM), and can co-reside with PersonaPlex if
needed.

### License caveats

- **Voxtral STT** — Apache-2.0 (unrestricted).
- **Voxtral TTS** — CC-BY-NC-4.0 (**non-commercial**); fine for dev/eval, blocks a
  commercial ship. Same constraint as the kyutai RL full-duplex checkpoint.
- LM license depends on the chosen model.

## Open next steps

- LM-local: make `envKey` optional in `app/api/llm/route.ts`, add a `local`
  backend + model entry. (Afternoon.)
- TTS-local: catalog-ize `app/api/mistral/tts`, add per-persona voice map, stand up
  mlx-audio HTTP. (Day.)
- STT-local: build the voxmlx WS shim (option a) or the batch `/api/stt` route
  (option b).
- Live mic test of the fully-local cascade; measure end-to-end first-audio vs the
  cloud path (cloud baseline ≈ 1.5 s first-audio).

Full Python design in `~/Develop/voice-cascade/README.md`.
