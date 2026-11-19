# Tsubaki — realtime voice console

Brutalist/editorial voice console for talking to seven personas (aspects of one camellia spirit) over eight interchangeable realtime transports. The whole console, voice and UI, runs in **English or Japanese** from a single switch.

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
- Phones can open `next dev` through `tailscale serve` (`*.ts.net`) or Bonjour (`*.local`): `allowedDevOrigins` in `next.config.ts` lets those hosts load the dev scripts. Without it the page never hydrates and shows the desktop layout squeezed to phone width. Another host needs adding there, and a config change needs a dev-server restart.
- One-off CLIs via `bunx` (e.g. `bunx shadcn@latest init -d -y`).

## Secrets & local services

Secrets live in **fnox** (`fnox.toml`, OS keychain-backed): `ELEVENLABS_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `FAL_API_KEY`, `HF_TOKEN`, `TINKER_API_KEY`, `MEM0_API_KEY`, `ARCHIL_API_KEY`. Each is used only by a server route that mints a short-lived token, proxies the call, or stores data. No secret reaches the client.

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
- `hooks/`: `use-session-routing` (transport + language), `use-tweaks` (localStorage settings, dark mode), `use-ja-fonts`, `use-lm-model`, `use-audio-output-devices`, `use-media-query`, `use-nav-keys`, `use-conversations` (history list + detail), `use-resume` (which stored call the next CALL continues).

### Session layer (`lib/realtime/`)

`use-realtime-session.ts` exposes one `SessionApi`. Every engine hook mounts unconditionally and stays inert until its provider row is selected. `Provider.engine` in `lib/data.ts` picks the engine; a row without one falls back to the design's mock lifecycle (every current row has one). The first row is the default.

| Provider row | `engine` | Transport | Japanese (`Provider.ja`) | Where to look |
| --- | --- | --- | --- | --- |
| XAI | `xai` | Browser WS, `/api/xai/token` | `prompt` | `use-xai-session`, `xai-agent`, `xai-audio`, `docs/xai-voice-agent-api.md` |
| OPENAI | `openai` | WebRTC, `/api/openai/token` | `prompt` (+ transcription hint) | `use-openai-session`, `openai-agent`, `config/realtime-models.json` |
| OPENAI LIVE | `openai-live` | WebRTC; the server creates the session (`/api/openai-live/session`) and attaches a sideband | `voice` | `use-openai-live-session`, `live-connection`, `openai-live-agent`, `openai-live-voices`, `config/openai-live-voices.json` |
| ELEVENLABS | `elevenlabs` | `@elevenlabs/react` (WebRTC) | `agent` | `use-realtime-session`, `elevenlabs-agent` |
| GOOGLE | `gemini` | Browser WS (v1alpha `BidiGenerateContentConstrained`), `/api/gemini/token` | `prompt` | `use-gemini-session`, `gemini-agent` |
| MISTRAL | `cascade` | STT → LM → TTS turns, `/api/{stt,llm,tts}` + STT proxy | none | `cascade-provider` skill |
| FAL.AI | `fal` | Browser WS, `/api/fal/token` | none | `fal-personaplex-provider` skill |
| KYUTAI | `moshi` | Local WS :8998 | none | `kyutai-local-provider` skill |

- **Personas are data, not env vars.** Each engine resolves model/voice/prompt from the selected persona at `start()` (`*-agent.ts`). The provider-neutral character model is `docs/persona-architecture.md`; the shared identity prompt is `shared-persona-prompt.ts`.
- **Engine hooks read persona (and language, where they take it) through refs at `start()`**, never through stale closures.
- **Per-start attempt tokens:** a language change mid-call hangs up and restarts the *same* hook. A shared `endedRef` boolean alone lets leftover setup from the old call resume into the new one, because the new `start()` resets it to `false`.
  - **Fenced:** xAI, OpenAI and Gemini give each `start()` its own token (`attemptRef` + `ended()`), checked by every async continuation. OPENAI LIVE gives each call its own `LiveConnection` and checks `connRef.current === conn` instead.
  - **Not fenced yet:** fal and KYUTAI still rely on a shared `endedRef`, and the cascade has no per-start guard. Routing never restarts them in place, because they have no Japanese path and any route change moves the session to another hook. A fast manual hang-up → CALL could still hit the race.
  - Add the token before giving an engine a Japanese path, and in any new engine.
- Engine hooks emit status captions as **English sentinel strings**, and `localizeCaption` (`lib/i18n.ts`, `CAPTION_KEYS`) maps them to keys. Adding a caption means adding the sentinel to `CAPTION_KEYS` and its key to both tables; otherwise it shows in English during a Japanese session. Rarer error captions still pass through untranslated.

### Long-term memory (`lib/memory/`)

mem0 gives the ElevenLabs and OPENAI LIVE engines a memory of the visitor across calls. Other engines don't use it yet. It is the live `memory.recall` tool (`lib/data.ts`; the other tools are still `preview` mocks): turning it off in Settings skips both recall and ingest.

- **Shared, not per persona.** Memory is scoped by mem0 `user_id` only, and persona, language and source go in metadata. That fits the fiction (seven aspects of one spirit), and it avoids a mem0 trap: an AND of `user_id` + `agent_id` returns nothing, because mem0 stores the entities separately.
- **Identity** is an opaque `tsubaki-<uuid>` in localStorage (`lib/memory/user-id.ts`). It is the ElevenLabs session `userId` and the mem0 `user_id`. Never put a name or email in it. Storage is per browser and per origin, so each one has its own history and memory; Settings → VISITOR ID copies an id out and pastes one in (`setMemoryUserId`). The id is the only thing guarding a visitor's calls, so treat it as private.
- **Lifecycle** (`call-lifecycle.ts`, wrapped by `use-elevenlabs-memory.ts`): `begin()` at CALL starts recall in parallel with connecting, `connected()` at `onConnect` sends the call's preface (a continued conversation, if any) and then the recalled memories as contextual updates, and `ended()` at `onDisconnect` ingests. The SDK callbacks carry no attempt, and a restart's old `onDisconnect` can land after the new `begin()`. So `ended()` never ends "the current call": each connect opens a conversation and each disconnect retires the oldest open one. Each `begin()` also takes an attempt token, so a recall from the previous call never reaches a restarted one.
- **Ingest reads ElevenLabs, not the browser.** `/api/memory/ingest` polls the stored conversation until it is `done`, refuses one whose `user_id` isn't the caller's, and sends only spoken turns to mem0.
- **Recall lists, it doesn't search.** Before the first utterance there is no query, and a broad "who is this" search scores barely above mem0's default threshold.
- **The framing stays in-world** (`framing.ts`, EN and JA): the persona just remembers. It never mentions notes or systems and never recites the list. A change there must keep both languages.
- **Memory is best-effort.** Recall resolves to `[]` on failure or after 5 s, and ingest is fire-and-forget. Without `MEM0_API_KEY` both routes return 503 and calls work as before.
- *Local check:* make a call, tell the persona something, hang up, wait a minute, then call any persona and ask what it remembers. The fact should come back in the session's language. The conversation's `user_id` on ElevenLabs should be your `tsubaki.memory-user` value.

### Conversation history (`lib/conversations/`)

The CONVERSATIONS section (key H) lists the visitor's stored ElevenLabs and OPENAI LIVE calls in one list and reads one back; CONTINUE lets the next call pick it up on the transport that stored it.

- **Two stores, one list.** `lib/conversations/history.ts` merges them newest first; the paging cursor (`history-cursor.ts`) carries both stores' positions. Either key alone (`ELEVENLABS_API_KEY`, `ARCHIL_API_KEY`) lists its own calls. The detail route dispatches on the id: `conv_…` is ElevenLabs, `olc_…` is OPENAI LIVE.
- **ElevenLabs stores its own calls.** `/api/conversations` lists by the visitor's `user_id` (finished calls where they spoke), and `/api/conversations/[id]` returns one transcript only if its `user_id` matches; otherwise it answers 404, like a missing call. Persona and language come from the agent id (`agentPersona` in `elevenlabs-agent.ts`), not from the agent name.
- **Continuing is replay, not resume.** ElevenLabs has no way to reopen a conversation. CONTINUE selects the call's persona, routes to ELEVENLABS in the call's language (`routeTo`), and arms it (`hooks/use-resume.ts`). At connect, the tail of the old transcript goes to the agent as an in-world contextual update (`resume.ts`, EN and JA, last 40 turns). The agent's static first message still plays first; overriding it would need `platform_settings.overrides` on all 14 agents.
- **Armed only where it can run:** on the ELEVENLABS row with the call's own persona. A continued call that ends spends the target, except when routing replaced it mid-call (a language change); the replacement continues the same conversation.
- **OPENAI LIVE calls are ours to store.** GPT-Live keeps no transcripts we can read back, so `/api/openai-live/session` creates the session server-side, then attaches a sideband WebSocket (`…/live/sessions/{id}/attach`) that hears the same transcript deltas (`live-capture.ts`). The record goes to the Archil disk (`config/archil.json`, `lib/storage/archil.ts`, `live-store.ts`) at `tsubaki/openai-live/calls/<userId>/<callId>.json`, checkpointed every 10 s and finalized at `session.closed`, which is also when mem0 ingests it (`lib/memory/live-ingest.ts`). An index of empty markers (`index/<userId>/<inverted start>_<callId>`) lists newest first without reading records.
  - Archil's S3 listing **ignores `start-after`**, so `listIndex` skips past the cursor itself. Archil also keeps **directory markers**: delete a directory's files before the directory.
  - Captures live in the dev server process. Restarting it mid-call loses the tail since the last checkpoint; the record then lists as abandoned after 15 minutes.
  - **Titles are generated.** ElevenLabs writes `call_summary_title` and `transcript_summary` itself. For an OPENAI LIVE call, `live-digest.ts` asks the text model in `config/realtime-models.json` (`openaiLive.summaryModel`) for both, in the call's language, when the call ends, and stores them on the record. A history load fills in any that are missing (older, abandoned or failed calls) and waits up to 5 s; a slower one shows on the next load, and a failed one is retried after 5 minutes. Until then the call lists under the visitor's opening line. Without `OPENAI_API_KEY` nothing is generated.
  - Startup seeding (`live-seed.ts`): recalled memories, then as much of a continued call as fits (newest turns kept), then the greeting, all within GPT-Live's 128-message / 8,192-token `input` cap.
- **Other transports can't read these calls.** xAI and OpenAI could seed a session with `conversation.item.create`, and Gemini with `clientContent` turns, but none of that is wired; continuing elsewhere is pending.
- *Local check:* continue a stored call, press CALL, and ask what you were talking about. The persona should answer from the old call without reading it back.

## Multilingual

One `Lang` (`lib/lang.ts`: `"en" | "ja"`) drives three things together: which agent or prompt the session runs on, the UI copy, and the document language (`<html lang>`, `.tsubaki[data-lang]`).

**Voice.** Each transport speaks Japanese at its own level (`Provider.ja`):
- `agent` (ElevenLabs): a dedicated JA platform agent per persona (`tsubaki-<id>-ja`, `PERSONA_AGENT_IDS_JA`), with its own JA prompt and a cast native-speaker voice.
- `voice` (OPENAI LIVE): Japanese through the instructions like `prompt`, but spoken by a native voice cast per persona (`config/openai-live-voices.json`): harema (feminine), shida (masculine), or a custom voice made from a text description by `scripts/openai-live/create-voices.ts` (needs the `api.voices.write` key scope). Until a custom voice has an id, the built-in voice speaks.
- `prompt` (xAI, OpenAI, Gemini): none of these sessions has a language parameter. `localizeAgent` (`lib/realtime/japanese.ts`) appends a language rule to the English persona prompt and swaps the opening direction for the persona's `ja.greet`. The voice stays the same.
- none (cascade, fal, KYUTAI): no Japanese path. Voxtral TTS has no Japanese and PersonaPlex is English-only. Don't fake one; set `ja` on the provider row only once the engine really speaks it.

**Routing** (`hooks/use-session-routing.ts`):
- Japanese picked on a no-path transport fails over to the last transport a Japanese session ran on, else the best available (`agent`, then `voice`, then `prompt`).
- A no-path transport picked while Japanese is on drops the language to EN.
- Any transport or language change during a call ends it and opens a new session; nothing is handed over mid-call. `routing-notice.tsx` explains each re-route.

**UI copy** (`lib/i18n.ts`, read through `useT()` from `components/tsubaki/i18n-context.tsx`):
- Every UI label has a key in **both** `STRINGS.en` and `STRINGS.ja`. Missing JA keys fall back to EN silently, so check parity when adding keys.
- Data-borne copy (provider notes, tool labels) stays English in `lib/data.ts` and gets a JA-only override key, read via `t(key, vars, fallback)`.
- Keep technical identifiers untranslated in both tables: vendor names, model/engine ids, tool names, device names.
- Personas carry their Japanese face in `Persona.ja` (name, aspect, traits, desc, voice, greet). Show it whenever the language is JA.
- The Tweaks panel is a design tool and stays English on purpose. The vendored mic picker is also still English.

**Type.** Plex Mono / Newsreader carry no CJK, so `--tb-mono` / `--tb-serif` fall back per glyph to Noto Sans/Serif JP (self-hosted from `@fontsource/noto-*-jp`, unicode-range sliced, never preloaded), or to the Tweaks pick (`lib/ja-fonts.ts`, loaded from Google Fonts on demand). JA-specific typography (strict kinsoku line-breaking, upright instead of synthesized-italic serif, extra leading, sizing) lives under `.tsubaki[data-lang="ja"]` in `app/globals.css`; put JA type fixes there, not in component styles.

**Adding a language** means extending `Lang`/`LANGS`, adding a full `STRINGS` table, giving each persona that language's fields, deciding each provider's support level, and generalizing what is currently Japanese-specific (`japanese.ts`, `Persona.ja`, `Provider.ja`, the JA agent IDs, the CJK font fallback). Treat it as a design task, not a find-and-replace.

## Gotchas

### React / Next
- **Keep `"use client"` at boundaries.** Next's TS plugin flags function props on components exported from a `"use client"` file (error 71007). Leaf components stay plain modules inside the client graph so they can take function props. Hooks and engine modules carry the directive harmlessly.
- **Client-only providers go behind a wrapper.** `@elevenlabs/react`'s `ConversationProvider` calls `createContext` at module load. Import it only from a `"use client"` file (`providers.tsx`); importing it into a Server Component (`page.tsx`) fails the build with "createContext is not a function".
- **No SSR for the WebGL `Orb`** (R3F). Render it only behind a mounted guard (`orb-visualizer.tsx`).
- **`<html>` carries `suppressHydrationWarning`** (`app/layout.tsx`). Chrome for iOS adds a `__gcrremoteframetoken` attribute to `<html>` before React hydrates, and the dev overlay shows a hydration mismatch on every load. The flag covers only `<html>`'s own attributes, not its children, so it hides no mismatch in our components. Don't remove it, and don't add the flag further down to quiet a real mismatch.
- **Height chain:** `.tsubaki` is `height:100%`, so `<body>` must stay `h-full overflow-hidden` (not `min-h-full`), or the 50/50 call layout overflows the viewport.
- Dark mode toggles `.dark` on `<html>` (shadcn and the vendored orb read it) **and** `.tsubaki-dark` on `.tsubaki` (our CSS vars `--bg/--ink/--accent`). Set both.

### Realtime audio
- **`useConversation` methods throw before `startSession()`** ("No active conversation"). Guard `setMuted` / `getInputVolume` / `getOutputVolume` on `status === "connected"`. They run as soon as the ELEVENLABS row is selected, not just mid-call.
- **Never route the OpenAI WebRTC `<audio>` element through `createMediaElementSource`.** Chrome's echo canceller references the directly played remote track. Rerouting playback through Web Audio bypasses AEC, so on speakers the model hears its own voice and answers itself. Play the element directly; the orb reads a passive `createMediaStreamSource(remote)` analyser that is never connected to `destination`.
  - *Local check:* a call on laptop speakers (no headphones) must not produce phantom user turns.
- **OpenAI half-duplex mic gating** (barge-in off, the default): the mic track is silenced from `output_audio_buffer.started` until `stopped` / `cleared`. Not `response.done`, which fires while the audio tail is still playing, and that tail is the echo. Voice barge-in is the Settings INTERRUPTIONS toggle (`voiceBargeIn` tweak), meant for headphone users.
  - *Local check:* same speaker test; the agent's last syllable must not come back as a user turn.
- **OPENAI LIVE is full duplex.** No half-duplex mic gating; Chrome's echo canceller does the work, with the same direct `<audio>` playback as OPENAI. GPT-Live has no response or turn events: turns are grouped by delta timing (`live-transcript.ts`) and "speaking" follows the output level. An unknown voice fails session creation with a misleading 403 "Voice session access denied".
  - *Local check:* a call on laptop speakers must not produce phantom user turns; talk over the agent and it should yield.
- **Gemini** output is fixed at 24 kHz, so `PlaybackQueue` takes an explicit buffer rate. One server message can bundle audio, transcripts and turn flags, so handle each field independently, never with else-if.

### ElevenLabs
Before writing ElevenLabs API code, read the matching skill in `.claude/skills/` (`agents`, `speech-engine`, `setup-api-key`, `text-to-speech`, `speech-to-text`, `voice-changer`, `voice-isolator`). They carry current CLI/SDK usage. The app connects to public agents (`enable_auth:false`) over WebRTC with the agent ID alone, so there is no signed-URL route.

- **Agent prompts are generated.** `scripts/elevenlabs/gen-agent-configs.ts` is the versioned source of truth for all 14 agents (7 personas × EN/JA): prompts, casting and tuning. `create-agents{,-ja}.sh` and `cast-voices{,-ja}.sh` push and cast them. Agent IDs are mapped in `lib/realtime/elevenlabs-agent.ts` (`PERSONA_AGENT_IDS`, `PERSONA_AGENT_IDS_JA`); unmapped personas fall back to `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`. A new persona needs both language variants. The agents' TTS model per language comes from `config/realtime-models.json` (`elevenlabs.ttsModel`), which the UI's MODEL label also reads; change it there, then regenerate and push.
- **CLI project files are disposable.** `agents.json` and `agent_configs/` are gitignored and live in the main repo root. In a fresh worktree, regenerate them with `elevenlabs agents init && yes | elevenlabs agents pull` (`pull` has no `--yes`). Pulled configs are full platform snapshots (~400 lines); the generator emits lean ones. Both push fine.
- **livekit-client is unpinned.** `@elevenlabs/react` 1.13 / client 1.21 resolves livekit-client 2.22, and the WebRTC handshake is clean there. The skill's old `livekit-client 2.16.1` override would now break the dependency range; re-add a pin only if `/rtc/v1` 404s reappear.
- **Account-level TTS failures look like agent bugs.** If a session dies at the greeting with `dependency_error` 1002 "payment issue", TTS is blocked on the account side. Probe with a direct `POST /v1/text-to-speech`. A `401 detected_unusual_activity` or a `free_disabled` subscription needs a paid plan, not a config change. The conversation log (`GET /v1/convai/conversations/{id}` → `metadata.error`) has the real reason.
- **API key scopes are dashboard-managed.** A write failing with 401 `missing_permissions` (e.g. `convai_write`, `add_voice_from_voice_library`) means the key needs rescoping in the dashboard; it isn't an auth bug. The CLI has its own stored login (`elevenlabs auth whoami`), separate from the fnox key.

### Fonts
- **Don't move the Japanese families back to `next/font/google`.** It downloads all ~620 Noto JP slices from Google at build time, and that fetch flakily failed CI (Turbopack: "next/font/google queries have exactly one entry"). Fontsource ships the same slices as plain CSS. Latin families (Plex Mono, Newsreader) are small and stay on `next/font`.

### Tooling
- **There is deliberately no `CLAUDE.md`; this file is the only instruction file.** Codex and other AGENTS.md-native agents read it directly. Local Claude Code loads it through the `agents-md` mod ([`anthropics/claude-code` · `mods/agents-md`](https://github.com/anthropics/claude-code/tree/main/mods/agents-md), `claude-md-and-agents-md` mode). The mod is installed per user, not from a marketplace, and isn't part of this repo. Claude Code without it, such as the GitHub Actions in `.github/workflows/claude*.yml`, must be told to read `AGENTS.md` explicitly. Don't recreate `CLAUDE.md` to fix that.
- **oxfmt may ignore `.gitignore` inside git worktrees** (`.git` is a file there). Generated JSON must therefore already pass `fmt:check`; the ElevenLabs generator handles this.
  - *Local check:* in a worktree with `agent_configs/` present, `bun run fmt:check` should stay clean.
- **Maintainer-local agent hooks** (Claude Code settings, not in this repo) block writes to `.env*` and expect `rg` rather than `grep` / `find -name` in shell commands. Document env vars in the README instead of `.env` files.
  - *Local check:* if a `.env*` write or a `grep` call is refused by a hook, that's this, not a sandbox problem. Cloud and other agents may not have these hooks at all.

## Verifying UI

Drive the running app in a browser at **1440×900** (desktop) and **390×844** (mobile drawer layout), in **both EN and 日本語**. The chrome-devtools MCP works well: `evaluate_script` + `el.click()` for nav. Check at least:

- The changed view in both languages: no clipped or overflowing JA strings, no English left in the JA UI (apart from identifiers and the known gaps above), and persona cards showing their JA face.
- Switching language or transport while idle shows the right notice (failover / downgrade / none).

Calls themselves need provider keys and a microphone, so they are **local checks**. For engine or routing changes, start a call, then switch language mid-call and while still connecting. The call should reopen once on the new agent or prompt, in the right language, with no duplicate connection and no stale "call ended".

<!-- entire-agent:begin -->
Read .entire/agent-guide.md for this repository's workflow, source inspection, and verification guidance.
@.entire/agent-guide.md
<!-- entire-agent:end -->
