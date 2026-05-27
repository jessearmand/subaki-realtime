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
- Agent IDs are **not secret** (public-widget embeddable). Pass `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` via your own `.env.local`, or inline for a quick test: `NEXT_PUBLIC_ELEVENLABS_AGENT_ID=<id> bun run dev`.

## Architecture map

- `components/ui/` — vendored ElevenLabs/shadcn (editable, but **excluded from oxlint**); don't hand-fix its lint warnings
- `components/tsubaki/` — our components; `app-shell.tsx` is the single `"use client"` boundary
- `lib/realtime/` — provider-agnostic `SessionApi`; UI never calls a provider directly. `provider.engine` selects the engine: mock (default) · `elevenlabs` (real, `@elevenlabs/react`) · `xai` (real Grok via direct WebSocket — `use-xai-session` + `xai-audio` + the `/api/xai/token` mint route). Both real-engine hooks mount unconditionally and stay inert until selected.
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
- **`.env*` writes are blocked** by a hook — document env vars in the README instead.
- Bash hooks require `rg` (not `grep`/`find -name`).

## ElevenLabs integration

Before writing any ElevenLabs API code, read the matching skill in `.claude/skills/` (`agents`, `speech-engine`, `setup-api-key`, `text-to-speech`, `speech-to-text`, `voice-changer`, `voice-isolator`) — they carry current CLI/SDK usage. The real agent path (`agents` + `setup-api-key`) is **verified working** end-to-end against a public agent (`enable_auth:false`, connects via WebRTC with the agent ID alone — no signed-URL route). `package.json` pins `livekit-client` to `2.16.1` (skill's WebRTC workaround).

## Verifying UI

Use the chrome-devtools MCP at 1440×900 and 390×844; drive nav with `evaluate_script` + `el.click()`. Type checks/tests verify code, not feature correctness — look at the rendered app.
