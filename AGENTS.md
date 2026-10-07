# Tsubaki — realtime voice console

Brutalist/editorial voice console for talking to seven personas (aspects of one camellia spirit) over seven interchangeable realtime transports. The whole console, voice and UI, runs in **English or Japanese** from a single switch.

Stack: **Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · bun · oxlint/oxfmt**. ElevenLabs UI primitives (vendored) provide the orb, bars and mic picker.

This is a **dev environment only; there is no production deployment yet.**

## Ground rules

- **Every user-facing change is bilingual.** New copy goes into both string tables, new persona-facing behavior must say what it does in Japanese, and new UI must survive Japanese text (longer or shorter strings, no word spaces, CJK glyph fallback). See [Multilingual](#multilingual).
- **The UI never talks to a provider directly.** Everything goes through the `SessionApi` in `lib/realtime/`.
- **Type checks and lint verify code, not features.** Look at the rendered app, in both languages, before calling a UI change done.
- Prefer the repo's own sources of truth (named below) over restating values in prose. Where this file and the code disagree, the code wins; fix this file.

## Build & check

- `bun install` · `bun run dev` (localhost:3000) · `bun run build`
- Lint/format are **oxc, not eslint/prettier**: `bun run lint` (oxlint) · `bun run fmt` (oxfmt write) · `bun run fmt:check`
- Types: `bunx tsc --noEmit`
- Gates, in order, before declaring done: `bunx tsc --noEmit` → `bun run lint` → `bun run fmt:check` → `bun run build`. In a fresh checkout run `bun install` first; without `node_modules`, tsc fails with hundreds of misleading "cannot find module" errors.
- oxlint ignores `components/ui` and `scripts` (`.oxlintrc.json`); oxfmt ignores `*.md`, YAML, `package.json` and `fnox.toml` (`.oxfmtrc.json`).
- One-off CLIs via `bunx` (e.g. `bunx shadcn@latest init -d -y`).

## Secrets & local services

Secrets live in **fnox** (`fnox.toml`, OS keychain-backed): `ELEVENLABS_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `FAL_API_KEY`, `HF_TOKEN`, `TINKER_API_KEY`. Each is used only by a server route that mints a short-lived token or proxies the call. No secret reaches the client.

- Run secret-needing commands as **`fnox exec -- <cmd>`**. `fnox activate`'s shell hook doesn't fire in non-interactive shells (agent tool calls), so don't rely on it.
- **mise tasks** (`mise.toml`) wrap the common processes:
  - `mise run dev`: `fnox exec -- bun run dev`, plus the Mistral STT proxy (:3001) in the background.
  - `mise run stop`: kills whatever holds `PORT` (default 3000). This is the reliable way to clear an orphaned `next dev`, which has no stop of its own.
  - Local inference for the cascade and KYUTAI engines: `lm-local` (:8001), `audio-local` (:8002), `local-stack` (both), `personaplex-local` (:8998), each with a matching `stop-*` task. These expect sibling checkouts under `~/Develop/` and Apple-silicon tooling, so they only run on the maintainer's machine.
- `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` (the fallback agent) is set in `mise.toml [env]`. Agent IDs are **not secret** (public-widget embeddable). Override it inline for a quick test: `NEXT_PUBLIC_ELEVENLABS_AGENT_ID=<id> bun run dev`.
- Without a key, an engine fails its own CALL with a readable caption ("XAI_API_KEY is not set"). The rest of the app still works, so you can verify UI without any secrets.

## Architecture

### Shell

- `components/tsubaki/`: our components. `app-shell.tsx` is the client boundary for the page; `providers.tsx` is the `"use client"` wrapper for client-only context providers.
- `components/ui/`: vendored ElevenLabs/shadcn. Editable, but excluded from oxlint; don't hand-fix its lint warnings.
- Mobile (`tb-mobile`) swaps the sidebar for `MobileDrawer` (`nav.tsx`), which hosts the desktop `Sidebar` unchanged. A nav change therefore lands on both layouts.
- `hooks/`: `use-session-routing` (transport + language), `use-tweaks` (localStorage settings, dark mode), `use-ja-fonts`, `use-lm-model`, `use-audio-output-devices`, `use-media-query`, `use-nav-keys`.

### Session layer (`lib/realtime/`)

`use-realtime-session.ts` exposes one `SessionApi`. Every engine hook mounts unconditionally and stays inert until its provider row is selected. `Provider.engine` in `lib/data.ts` picks the engine; a row without one falls back to the design's mock lifecycle (every current row has one). The first row is the default.

| Provider row | `engine` | Transport | Japanese (`Provider.ja`) | Where to look |
| --- | --- | --- | --- | --- |
| XAI | `xai` | Browser WS, `/api/xai/token` | `prompt` | `use-xai-session`, `xai-agent`, `xai-audio`, `docs/xai-voice-agent-api.md` |
| OPENAI | `openai` | WebRTC, `/api/openai/token` | `prompt` (+ transcription hint) | `use-openai-session`, `openai-agent`, `config/realtime-models.json` |
| ELEVENLABS | `elevenlabs` | `@elevenlabs/react` (WebRTC) | `agent` | `use-realtime-session`, `elevenlabs-agent` |
| GOOGLE | `gemini` | Browser WS (v1alpha `BidiGenerateContentConstrained`), `/api/gemini/token` | `prompt` | `use-gemini-session`, `gemini-agent` |
| MISTRAL | `cascade` | STT → LM → TTS turns, `/api/{stt,llm,tts}` + STT proxy | none | `cascade-provider` skill |
| FAL.AI | `fal` | Browser WS, `/api/fal/token` | none | `fal-personaplex-provider` skill |
| KYUTAI | `moshi` | Local WS :8998 | none | `kyutai-local-provider` skill |

- **Personas are data, not env vars.** Each engine resolves model/voice/prompt from the selected persona at `start()` (`*-agent.ts`). The provider-neutral character model is `docs/persona-architecture.md`; the shared identity prompt is `shared-persona-prompt.ts`.
- **Engine hooks read persona and language through refs at `start()`**, never through stale closures.
- **Each `start()` gets its own attempt token** (`attemptRef` + `ended()`), and every async continuation checks it. A route change hangs up and restarts the same hook, so a shared `ended` boolean alone would let leftover setup from the old call resume into the new one. Any new engine must follow this pattern.
- Engine hooks emit status captions as **English sentinel strings**, and `localizeCaption` (`lib/i18n.ts`, `CAPTION_KEYS`) maps them to keys. Adding a caption means adding the sentinel to `CAPTION_KEYS` and its key to both tables; otherwise it shows in English during a Japanese session. Rarer error captions still pass through untranslated.

## Multilingual

One `Lang` (`lib/lang.ts`: `"en" | "ja"`) drives three things together: which agent or prompt the session runs on, the UI copy, and the document language (`<html lang>`, `.tsubaki[data-lang]`).

**Voice.** Each transport speaks Japanese at its own level (`Provider.ja`):
- `agent` (ElevenLabs): a dedicated JA platform agent per persona (`tsubaki-<id>-ja`, `PERSONA_AGENT_IDS_JA`), with its own JA prompt and a cast native-speaker voice.
- `prompt` (xAI, OpenAI, Gemini): none of these sessions has a language parameter. `localizeAgent` (`lib/realtime/japanese.ts`) appends a language rule to the English persona prompt and swaps the opening direction for the persona's `ja.greet`. The voice stays the same.
- none (cascade, fal, KYUTAI): no Japanese path. Voxtral TTS has no Japanese and PersonaPlex is English-only. Don't fake one; set `ja` on the provider row only once the engine really speaks it.

**Routing** (`hooks/use-session-routing.ts`):
- Japanese picked on a no-path transport fails over to the last transport a Japanese session ran on, else the best available (`agent` before `prompt`).
- A no-path transport picked while Japanese is on drops the language to EN.
- Any transport or language change during a call ends it and opens a new session; nothing is handed over mid-call. `routing-notice.tsx` explains each re-route.

**UI copy** (`lib/i18n.ts`, read through `useT()` from `components/tsubaki/i18n-context.tsx`):
- Every UI label has a key in **both** `STRINGS.en` and `STRINGS.ja`. Missing JA keys fall back to EN silently, so check parity when adding keys.
- Data-borne copy (provider notes, tool labels) stays English in `lib/data.ts` and gets a JA-only override key, read via `t(key, vars, fallback)`.
- Keep technical identifiers untranslated in both tables: vendor names, model/engine ids, tool names, device names.
- Personas carry their Japanese face in `Persona.ja` (name, aspect, traits, desc, voice, greet). Show it whenever the language is JA.
- The Tweaks panel is a design tool and stays English on purpose. The vendored mic picker is also still English.

**Type.** Plex Mono / Newsreader carry no CJK, so `--tb-mono` / `--tb-serif` fall back per glyph to Noto Sans/Serif JP (next/font, `preload: false`), or to the Tweaks pick (`lib/ja-fonts.ts`, loaded from Google Fonts on demand). JA-specific typography (strict kinsoku line-breaking, upright instead of synthesized-italic serif, extra leading, sizing) lives under `.tsubaki[data-lang="ja"]` in `app/globals.css`; put JA type fixes there, not in component styles.

**Adding a language** means extending `Lang`/`LANGS`, adding a full `STRINGS` table, giving each persona that language's fields, deciding each provider's support level, and generalizing what is currently Japanese-specific (`japanese.ts`, `Persona.ja`, `Provider.ja`, the JA agent IDs, the CJK font fallback). Treat it as a design task, not a find-and-replace.

## Gotchas

### React / Next
- **Keep `"use client"` at boundaries.** Next's TS plugin flags function props on components exported from a `"use client"` file (error 71007). Leaf components stay plain modules inside the client graph so they can take function props. Hooks and engine modules carry the directive harmlessly.
- **Client-only providers go behind a wrapper.** `@elevenlabs/react`'s `ConversationProvider` calls `createContext` at module load. Import it only from a `"use client"` file (`providers.tsx`); importing it into a Server Component (`page.tsx`) fails the build with "createContext is not a function".
- **No SSR for the WebGL `Orb`** (R3F). Render it only behind a mounted guard (`orb-visualizer.tsx`).
- **Height chain:** `.tsubaki` is `height:100%`, so `<body>` must stay `h-full overflow-hidden` (not `min-h-full`), or the 50/50 call layout overflows the viewport.
- Dark mode toggles `.dark` on `<html>` (shadcn and the vendored orb read it) **and** `.tsubaki-dark` on `.tsubaki` (our CSS vars `--bg/--ink/--accent`). Set both.

### Realtime audio
- **`useConversation` methods throw before `startSession()`** ("No active conversation"). Guard `setMuted` / `getInputVolume` / `getOutputVolume` on `status === "connected"`. They run as soon as the ELEVENLABS row is selected, not just mid-call.
- **Never route the OpenAI WebRTC `<audio>` element through `createMediaElementSource`.** Chrome's echo canceller references the directly played remote track. Rerouting playback through Web Audio bypasses AEC, so on speakers the model hears its own voice and answers itself. Play the element directly; the orb reads a passive `createMediaStreamSource(remote)` analyser that is never connected to `destination`.
  - *Local check:* a call on laptop speakers (no headphones) must not produce phantom user turns.
- **OpenAI half-duplex mic gating** (barge-in off, the default): the mic track is silenced from `output_audio_buffer.started` until `stopped` / `cleared`. Not `response.done`, which fires while the audio tail is still playing, and that tail is the echo. Voice barge-in is the Settings INTERRUPTIONS toggle (`voiceBargeIn` tweak), meant for headphone users.
  - *Local check:* same speaker test; the agent's last syllable must not come back as a user turn.
- **Gemini** output is fixed at 24 kHz, so `PlaybackQueue` takes an explicit buffer rate. One server message can bundle audio, transcripts and turn flags, so handle each field independently, never with else-if.

### ElevenLabs
Before writing ElevenLabs API code, read the matching skill in `.claude/skills/` (`agents`, `speech-engine`, `setup-api-key`, `text-to-speech`, `speech-to-text`, `voice-changer`, `voice-isolator`). They carry current CLI/SDK usage. The app connects to public agents (`enable_auth:false`) over WebRTC with the agent ID alone, so there is no signed-URL route.

- **Agent prompts are generated.** `scripts/elevenlabs/gen-agent-configs.ts` is the versioned source of truth for all 14 agents (7 personas × EN/JA): prompts, casting and tuning. `create-agents{,-ja}.sh` and `cast-voices{,-ja}.sh` push and cast them. Agent IDs are mapped in `lib/realtime/elevenlabs-agent.ts` (`PERSONA_AGENT_IDS`, `PERSONA_AGENT_IDS_JA`); unmapped personas fall back to `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`. A new persona needs both language variants.
- **CLI project files are disposable.** `agents.json` and `agent_configs/` are gitignored and live in the main repo root. In a fresh worktree, regenerate them with `elevenlabs agents init && yes | elevenlabs agents pull` (`pull` has no `--yes`). Pulled configs are full platform snapshots (~400 lines); the generator emits lean ones. Both push fine.
- **livekit-client is unpinned.** `@elevenlabs/react` 1.13 / client 1.21 resolves livekit-client 2.22, and the WebRTC handshake is clean there. The skill's old `livekit-client 2.16.1` override would now break the dependency range; re-add a pin only if `/rtc/v1` 404s reappear.
- **Account-level TTS failures look like agent bugs.** If a session dies at the greeting with `dependency_error` 1002 "payment issue", TTS is blocked on the account side. Probe with a direct `POST /v1/text-to-speech`. A `401 detected_unusual_activity` or a `free_disabled` subscription needs a paid plan, not a config change. The conversation log (`GET /v1/convai/conversations/{id}` → `metadata.error`) has the real reason.
- **API key scopes are dashboard-managed.** A write failing with 401 `missing_permissions` (e.g. `convai_write`, `add_voice_from_voice_library`) means the key needs rescoping in the dashboard; it isn't an auth bug. The CLI has its own stored login (`elevenlabs auth whoami`), separate from the fnox key.

### Tooling
- **oxfmt may ignore `.gitignore` inside git worktrees** (`.git` is a file there). Generated JSON must therefore already pass `fmt:check`; the ElevenLabs generator handles this.
  - *Local check:* in a worktree with `agent_configs/` present, `bun run fmt:check` should stay clean.
- **Maintainer-local agent hooks** (Claude Code settings, not in this repo) block writes to `.env*` and expect `rg` rather than `grep` / `find -name` in shell commands. Document env vars in the README instead of `.env` files.
  - *Local check:* if a `.env*` write or a `grep` call is refused by a hook, that's this, not a sandbox problem. Cloud and other agents may not have these hooks at all.

## Verifying UI

Drive the running app in a browser at **1440×900** (desktop) and **390×844** (mobile drawer layout), in **both EN and 日本語**. The chrome-devtools MCP works well: `evaluate_script` + `el.click()` for nav. Check at least:

- The changed view in both languages: no clipped or overflowing JA strings, no English left in the JA UI (apart from identifiers and the known gaps above), and persona cards showing their JA face.
- Switching language or transport while idle shows the right notice (failover / downgrade / none).

Calls themselves need provider keys and a microphone, so they are **local checks**. For engine or routing changes, start a call, then switch language mid-call and while still connecting. The call should reopen once on the new agent or prompt, in the right language, with no duplicate connection and no stale "call ended".
