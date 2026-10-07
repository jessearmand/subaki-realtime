#### Model Capabilities

# Voice Overview (local reference)

Local working notes for xAI Voice APIs as used by Tsubaki’s Grok path.  
**Upstream:** [docs.x.ai — Voice](https://docs.x.ai/developers/model-capabilities/audio/voice.md)  
**Last verified against upstream:** 2026-08-10

> The older standalone path `…/audio/voice-agent.md` now 404s; content lives under the Voice overview + sibling pages (TTS, STT, custom voices, ephemeral tokens).

The xAI Voice APIs offer speech-to-speech agents, TTS, STT, and custom voices, powered by Grok, with enterprise-grade reliability and sub-second latency.

## Voice Agent API (Speech to Speech)

Build real-time, speech-to-speech voice agents over WebSockets, with low-latency turn-taking and tool use. For client-side apps, use [Ephemeral Tokens](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens) to connect securely without exposing your API key.

**Endpoint:** `wss://api.x.ai/v1/realtime?model=grok-voice-latest`  
**Tsubaki wiring:** `lib/realtime/use-xai-session.ts` + `lib/realtime/xai-agent.ts` + `app/api/xai/token/route.ts`

```python customLanguage="pythonWithoutSDK"
import asyncio
import json
import os
import websockets

async def voice_agent():
    async with websockets.connect(
        "wss://api.x.ai/v1/realtime?model=grok-voice-latest",
        additional_headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"}
    ) as ws:
        # Configure voice and enable tools
        await ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "voice": "eve",
                "instructions": "You are a helpful customer support agent.",
                "turn_detection": {"type": "server_vad"},
                "tools": [{"type": "web_search"}]
            }
        }))

        # Stream audio and receive responses
        async for message in ws:
            event = json.loads(message)
            if event["type"] == "response.output_audio.delta":
                # Play audio: base64.b64decode(event["delta"])
                pass

asyncio.run(voice_agent())
```

```javascript customLanguage="javascriptWithoutSDK"
import WebSocket from "ws";

const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", {
  headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
});

ws.on("open", () => {
  // Configure voice and enable tools
  ws.send(
    JSON.stringify({
      type: "session.update",
      session: {
        voice: "eve",
        instructions: "You are a helpful customer support agent.",
        turn_detection: { type: "server_vad" },
        tools: [{ type: "web_search" }],
      },
    }),
  );
});

ws.on("message", (data) => {
  const event = JSON.parse(data);
  if (event.type === "response.output_audio.delta") {
    // Play audio: Buffer.from(event.delta, "base64")
  }
});
```

**Demo Apps:** [Web Agent](https://github.com/xai-org/xai-cookbook/tree/main/voice-examples/agent/web) · [Twilio Phone Agent](https://github.com/xai-org/xai-cookbook/tree/main/voice-examples/agent/telephony) · [WebRTC Agent](https://github.com/xai-org/xai-cookbook/tree/main/voice-examples/agent/webrtc) · [iOS Tester App](https://github.com/xai-org/xai-cookbook/tree/main/iOS/VoiceTesterApp)

### `session.update` fields (S2S)

Documented / cookbook-shaped fields used in practice:

| Field | Role |
|-------|------|
| `instructions` | System prompt — **also the language-control surface** (see below) |
| `voice` | Built-in name **or** custom `voice_id` |
| `turn_detection` | `{ type: "server_vad", threshold?, silence_duration_ms?, prefix_padding_ms? }` |
| `tools` | e.g. `{ type: "web_search" }`, `x_search`, custom `function`, … |
| `audio.input/output.format` | PCM rate advertisement (Tsubaki uses native `AudioContext` rate) |

There is **no documented top-level `language` / `locale` field** on the realtime voice-agent session. Do not expect TTS-style `language: "ja"` to apply here.

Secondary writeups sometimes mention `audio.input.transcription.language_hint` (BCP-47). That path is **not** in the published Voice overview examples and is **not** sent by Tsubaki. If it exists server-side it would only bias input transcription — not force spoken output language. Treat as unverified until confirmed live.

### Multilingual / Japanese (S2S)

**For a Japanese voice agent on the realtime path: use instructions (and first-message text), not an API language parameter.**

1. **Default behavior** — the S2S model is natively multilingual. It auto-detects the user’s spoken language and typically answers in kind (Japanese included in the supported set for the voice stack; quality can still vary by accent/domain).
2. **Pin output language** — put an explicit rule in `session.instructions`, and align the bootstrap `firstMessage` so the opening line is already Japanese.
3. **TTS / STT / custom-voice `language`** — those APIs *do* take BCP-47 codes (Japanese = `ja`). They are separate products; they do not configure the S2S WebSocket session.

Example `session.update` for a JP-only agent:

```json
{
  "type": "session.update",
  "session": {
    "voice": "eve",
    "instructions": "You are a helpful assistant. Always converse in Japanese (日本語). Match the user's politeness level. Keep replies short — words are spoken aloud.",
    "turn_detection": { "type": "server_vad" },
    "tools": [{ "type": "web_search" }]
  }
}
```

Tsubaki equivalent: edit the persona block in `lib/realtime/xai-agent.ts` (`instructions` + `firstMessage`). `XaiAgentConfig` has no `language` field by design.

Suggested JP lines:

```text
// instructions (append to SHARED / persona block)
Always converse in Japanese (日本語). Respond only in natural Japanese unless the user explicitly asks for another language.

// firstMessage (user item that elicits the opening line)
日本語で、短く自己紹介してから用件を聞いて。
```

## Text to Speech

Convert text to spoken audio with a large roster of expressive voices (not “5 only” — the built-in set has grown; Tsubaki’s `XaiVoice` union tracks the current names plus custom IDs). Inline speech tags (laughter, whispers, pauses) and output formats from high-fidelity MP3 to telephony μ-law. Unary requests or WebSocket streaming.

**`language` is required** on TTS — BCP-47 code or `auto`. Japanese = `ja`. See [TTS supported languages](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech.md).

```bash
curl -X POST https://api.x.ai/v1/tts \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Welcome to xAI. How can I help you today?",
    "voice_id": "eve",
    "language": "en"
  }' \
  --output welcome.mp3
```

```python customLanguage="pythonWithoutSDK"
import os
import requests

response = requests.post(
    "https://api.x.ai/v1/tts",
    headers={
        "Authorization": f"Bearer {os.environ['XAI_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "text": "Welcome to xAI. How can I help you today?",
        "voice_id": "eve",
        "language": "en",
    },
)

with open("welcome.mp3", "wb") as f:
    f.write(response.content)
```

```javascript customLanguage="javascriptWithoutSDK"
import fs from "fs";

const response = await fetch("https://api.x.ai/v1/tts", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text: "Welcome to xAI. How can I help you today?",
    voice_id: "eve",
    language: "en",
  }),
});

const buffer = Buffer.from(await response.arrayBuffer());
fs.writeFileSync("welcome.mp3", buffer);
```

**Real World Examples:** [LiveKit](https://docs.livekit.io/agents/integrations/xai/) · [Pipecat](https://docs.pipecat.ai/server/services/s2s/grok)

### TTS language codes (excerpt)

| Language | Code |
|----------|------|
| Auto-detect | `auto` |
| English | `en` |
| Japanese | `ja` |
| Korean | `ko` |
| Chinese (Simplified) | `zh` |
| French | `fr` |
| German | `de` |
| Spanish (Mexico / Spain) | `es-MX` / `es-ES` |
| Portuguese (Brazil / Portugal) | `pt-BR` / `pt-PT` |

Full table + speech tags: upstream TTS page. Codes are case-insensitive.

## Speech to Text

Transcribe audio files in a single call or stream over WebSocket. 12 audio formats, word-level timestamps, multichannel, speaker diarization, Smart Turn end-of-turn detection, and ~25 languages (including Japanese `ja`).

On STT, `language` is optional and mainly enables inverse text normalization / formatting when `format=true` — the model still transcribes supported languages without it.

```bash
curl -X POST https://api.x.ai/v1/stt \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -F file=@recording.mp3
```

```python customLanguage="pythonWithoutSDK"
import os
import requests

response = requests.post(
    "https://api.x.ai/v1/stt",
    headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"},
    files={"file": ("recording.mp3", open("recording.mp3", "rb"), "audio/mpeg")},
)

print(response.json()["text"])
```

```javascript customLanguage="javascriptWithoutSDK"
import fs from "fs";

const formData = new FormData();
formData.append("file", new Blob([fs.readFileSync("recording.mp3")]), "recording.mp3");

const response = await fetch("https://api.x.ai/v1/stt", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
  body: formData,
});

const result = await response.json();
console.log(result.text);
```

**Real World Examples:** [Voximplant](https://voximplant.com/products/grok-client)

## Quick Start: Custom Voices

Clone a voice from a short reference clip, then use the resulting `voice_id` anywhere a built-in voice works (S2S `session.voice`, TTS `voice_id`, streaming TTS). Create metadata may include `language` (e.g. `ja` for a Japanese reference clip) — that tags the clone; it still does not replace S2S instruction-based language control.

```bash
# 1. Create a custom voice from a reference audio clip (max 120s).
curl -X POST https://api.x.ai/v1/custom-voices \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -F "name=Friendly Narrator" \
  -F "language=en" \
  -F "file=@reference.wav;type=audio/wav"

# Response: { "voice_id": "nlbqfwie", ... }

# 2. Use the custom voice for TTS.
curl -X POST https://api.x.ai/v1/tts \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! This is my custom voice.",
    "voice_id": "nlbqfwie",
    "language": "en"
  }' \
  --output custom.mp3
```

```python customLanguage="pythonWithoutSDK"
import os
import requests

# 1. Create a custom voice from a reference audio clip (max 120s).
with open("reference.wav", "rb") as f:
    create = requests.post(
        "https://api.x.ai/v1/custom-voices",
        headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"},
        files={"file": ("reference.wav", f, "audio/wav")},
        data={"name": "Friendly Narrator", "language": "en"},
    )
voice_id = create.json()["voice_id"]

# 2. Use the custom voice for TTS.
speech = requests.post(
    "https://api.x.ai/v1/tts",
    headers={
        "Authorization": f"Bearer {os.environ['XAI_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "text": "Hello! This is my custom voice.",
        "voice_id": voice_id,
        "language": "en",
    },
)
with open("custom.mp3", "wb") as f:
    f.write(speech.content)
```

```javascript customLanguage="javascriptWithoutSDK"
import fs from "fs";

// 1. Create a custom voice from a reference audio clip (max 120s).
const form = new FormData();
form.append("file", new Blob([fs.readFileSync("reference.wav")]), "reference.wav");
form.append("name", "Friendly Narrator");
form.append("language", "en");

const create = await fetch("https://api.x.ai/v1/custom-voices", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
  body: form,
});
const { voice_id } = await create.json();

// 2. Use the custom voice for TTS.
const speech = await fetch("https://api.x.ai/v1/tts", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text: "Hello! This is my custom voice.",
    voice_id,
    language: "en",
  }),
});
fs.writeFileSync("custom.mp3", Buffer.from(await speech.arrayBuffer()));
```

The custom `voice_id` also works with the streaming TTS WebSocket and the Voice Agent realtime API. See the [Custom Voices guide](https://docs.x.ai/developers/model-capabilities/audio/custom-voices) for the full API.

## Voices

When using the Voice Agent API or Text to Speech, pick from the full built-in roster (upstream docs now say a large set; earlier snapshots said “5”). Each has its own personality and tone (`eve` is the default).

Tsubaki’s typed allow-list in `lib/realtime/xai-agent.ts` (`XaiVoice`) currently includes the original five plus expanded names (`carina`, `zagan`, `helix`, `orion`, `luna`, …) and `(string & {})` so custom `voice_id`s type-check. Runtime always passes `agent.voice` through `session.update`.

| Voice (original core) | Type    | Tone                  | Description                                                 |
| --------------------- | ------- | --------------------- | ----------------------------------------------------------- |
| **`eve`**             | Female  | Energetic, upbeat     | Default voice, engaging and enthusiastic                    |
| **`ara`**             | Female  | Warm, friendly        | Balanced and conversational                                 |
| **`rex`**             | Male    | Confident, clear      | Professional and articulate, ideal for business             |
| **`sal`**             | Neutral | Smooth, balanced      | Versatile voice suitable for various contexts               |
| **`leo`**             | Male    | Authoritative, strong | Decisive and commanding, suitable for instructional content |

Preview samples and the full live roster on the [xAI voice console / docs](https://docs.x.ai/developers/model-capabilities/audio/voice.md).

### Language control cheat-sheet

| Product | How to set Japanese |
|---------|---------------------|
| **S2S realtime** (`/v1/realtime`) | `instructions` (+ `firstMessage`); auto-detect if omitted |
| **TTS** (`/v1/tts`) | required `language: "ja"` (or `"auto"`) |
| **STT** (`/v1/stt`) | optional `language=ja` (formatting); JP is supported |
| **Custom voice create** | metadata `language=ja` on the reference clip |

### Enterprise Compliance & Security

The xAI Voice APIs are built for production workloads with strict security and compliance requirements. All audio data is processed in real time and never stored or used for training.

- **SOC 2 Type II** — Audited controls for security, availability, and confidentiality
- **HIPAA Eligible** — BAA available for healthcare applications handling PHI
- **GDPR Compliant** — Data processing agreements and EU data residency options
- **Data Residency** — Regional processing for compliance requirements
- **High Availability** — Multi-region infrastructure with custom SLAs for enterprise workloads
- **SSO & RBAC** — SAML SSO, role-based access, and audit logging
