# Tsubaki — realtime voice console

Brutalist/editorial multi-provider voice console. Stack: **Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · bun · oxlint/oxfmt**. ElevenLabs UI primitives provide the orb / bars / mic picker.

## Build & check workflow

- `bun install` · `bun run dev` (localhost:3000) · `bun run build`
- Lint/format are **oxc, not eslint/prettier**: `bun run lint` (oxlint) · `bun run fmt` (oxfmt write) · `bun run fmt:check`
- Types: `bunx tsc --noEmit`
- Run gates in this order before declaring done: `bunx tsc --noEmit` → `bun run lint` → `bun run fmt:check` → `bun run build`
- One-off CLIs via `bunx` (e.g. `bunx shadcn@latest init -d -y`)

## Secrets (fnox · dev only)

This is all a **dev environment — no production yet**. `ELEVENLABS_API_KEY` lives in **fnox** (`fnox.toml`).

- Run secret-needing commands with **`fnox exec -- <cmd>`** (e.g. `fnox exec -- elevenlabs agents list`). `fnox activate`'s shell hook auto-loads on `cd` but **doesn't fire in non-interactive shells** (the Bash tool), so always prefer `fnox exec`.
- **Dev server via mise tasks** (`mise.toml`): `mise run dev` (= `fnox exec -- bun run dev`, secrets loaded) and `mise run stop` (kills whatever's bound to `PORT`, default 3000 — the reliable way to clear an orphaned server). `next dev` itself has no stop, so `stop` targets the port, not a tracked PID.
- Agent IDs are **not secret** (public-widget embeddable). Pass `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` via your own `.env.local`, or inline for a quick test: `NEXT_PUBLIC_ELEVENLABS_AGENT_ID=<id> bun run dev`.

## Architecture map

- `components/ui/` — vendored ElevenLabs/shadcn (editable, but **excluded from oxlint**); don't hand-fix its lint warnings
- `components/tsubaki/` — our components; `app-shell.tsx` is the single `"use client"` boundary
- `lib/realtime/` — provider-agnostic `SessionApi`; UI never calls a provider directly. `provider.engine` selects the engine: mock (default) · `elevenlabs` (real, `@elevenlabs/react`) · `xai` (real Grok via direct WebSocket — `use-xai-session` + `xai-audio` + the `/api/xai/token` mint route; per-persona model/voice/prompt live in `lib/realtime/xai-agent.ts`, resolved from the selected persona — **not** env vars) · `gemini` (real Gemini Live via direct WebSocket to the v1alpha `BidiGenerateContentConstrained` endpoint — `use-gemini-session` + `gemini-agent.ts` + the `/api/gemini/token` ephemeral-token mint route, `GEMINI_API_KEY` in fnox; output is fixed 24 kHz so `PlaybackQueue` takes an explicit buffer rate, and one server message can bundle audio + transcripts + turn flags — handle fields independently, never else-if). All real-engine hooks mount unconditionally and stay inert until selected.
- `lib/data.ts` — personas/providers/tools/transcript · `hooks/` — `use-tweaks` (localStorage), `use-media-query`
- Brutalist CSS lives in `app/globals.css` under `.tsubaki` (CSS vars `--bg/--ink/--accent`); fonts via next/font as `--tb-mono`/`--tb-serif`
- Dark mode toggles `.dark` on `<html>` (shadcn) **and** `.tsubaki-dark` on `.tsubaki`

## Gotchas (cost real time — heed these)

- **`"use client"` only at the boundary.** Next's TS plugin flags function props on any `"use client"` file (error 71007). Leaf components stay plain modules in the client graph so they can take function props.
- **Client-only providers behind a wrapper.** `@elevenlabs/react`'s `ConversationProvider` calls `createContext` at module load — wrap it in a `"use client"` file; importing it into a Server Component (`page.tsx`) fails the build with "createContext is not a function".
- **No SSR for the WebGL `Orb`** (R3F) — render it only after a mounted guard.
- **Height chain:** `.tsubaki` is `height:100%`, so `<body>` must be `h-full overflow-hidden` (not `min-h-full`) or the 50/50 call layout overflows the viewport.
- **ElevenLabs CLI:** add one component per `bunx @elevenlabs/cli@latest components add <name>` call.
- **`useConversation` methods throw before `startSession()`** ("No active conversation"). Guard `setMuted`/`getInputVolume`/`getOutputVolume` on `status === "connected"` — they run as soon as the ELEVENLABS provider is selected, not just mid-call.
- **Never route the OpenAI WebRTC `<audio>` element through `createMediaElementSource`.** Chrome's echo canceller references the *directly played* remote track; rerouting playback through Web Audio bypasses AEC, and on speakers the model hears its own voice (semantic VAD commits the echo as user turns → the agent answers itself). Play the element directly; orb levels come from a passive `createMediaStreamSource(remote)` analyser never connected to `destination`.
- **OpenAI half-duplex mic gating** (barge-in OFF, the default): the mic track is silenced from `output_audio_buffer.started` until `stopped`/`cleared` — **not** `response.done`, which fires while the audio tail is still playing (that tail *is* the echo). Voice barge-in is the settings INTERRUPTIONS toggle (`voiceBargeIn` tweak, headphone users only).
- **`.env*` writes are blocked** by a hook — document env vars in the README instead.
- Bash hooks require `rg` (not `grep`/`find -name`).

## ElevenLabs integration

Before writing any ElevenLabs API code, read the matching skill in `.claude/skills/` (`agents`, `speech-engine`, `setup-api-key`, `text-to-speech`, `speech-to-text`, `voice-changer`, `voice-isolator`) — they carry current CLI/SDK usage. The real agent path (`agents` + `setup-api-key`) is **verified working** end-to-end against a public agent (`enable_auth:false`, connects via WebRTC with the agent ID alone — no signed-URL route). The skill's `livekit-client 2.16.1` override is **no longer applied**: `@elevenlabs/react` ≥1.13 requires livekit-client ≥2.21 and the WebRTC handshake verified clean on 2.22 (the `/rtc/v1` issue is fixed upstream). Re-add the override only if `/rtc/v1` 404s reappear.

- **CLI project files are disposable.** `agents.json` + `agent_configs/` (gitignored, canonical in the **main repo root**) mirror the platform; in a fresh worktree regenerate them with `elevenlabs agents init && elevenlabs agents pull` (`pull` prompts `Proceed? (y/N)` with no `--yes` flag — pipe `yes |`). Pulled configs are full platform snapshots (~400 lines); the versioned source of truth for the seven persona agents (prompts/casting/tuning) is `scripts/elevenlabs/gen-agent-configs.ts`, which emits lean configs — both forms push fine.
- **Per-persona agent IDs** live in `lib/realtime/elevenlabs-agent.ts` (`PERSONA_AGENT_IDS`); unmapped personas fall back to `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`.
- **Account-level TTS failures look like agent bugs.** A session that dies at the greeting with `dependency_error` 1002 "payment issue" (and SDKs <1.21 crash with `reading 'error_type'`) means TTS is blocked account-side — probe with a direct `POST /v1/text-to-speech` call; a `401 detected_unusual_activity` / `free_disabled` subscription needs a paid plan, not a config change. The platform conversation log (`GET /v1/convai/conversations/{id}` → `metadata.error`) has the real reason.
- **API key scopes are dashboard-managed**: a write failing 401 `missing_permissions` (e.g. `convai_write`, `add_voice_from_voice_library`) means the key needs rescoping in the dashboard, not an auth bug. The CLI also has its own stored login (`elevenlabs auth whoami`), separate from the fnox key.
- **oxfmt ignores `.gitignore` inside git worktrees** (`.git`-as-file breaks its ignore detection), so generated JSON must already be check-clean — the generator handles this.

## Verifying UI

Use the chrome-devtools MCP at 1440×900 and 390×844; drive nav with `evaluate_script` + `el.click()`. Type checks/tests verify code, not feature correctness — look at the rendered app.
