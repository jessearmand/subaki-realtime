#!/usr/bin/env bash
# Creates the seven Japanese Tsubaki persona agents (tsubaki-<id>-ja) on the
# ElevenLabs platform from the generated configs — the JA counterpart of
# create-agents.sh. Existing agents (the EN tsubaki-* set, explorer,
# Japan-Culture-Expert, Travel-guide) are untouched — the CLI appends new
# entries to agents.json.
#
# Run from the CLI project root (the main repo root, where agents.json lives),
# after cast-voices-ja.sh has added the JA voices to the workspace.
# Requires an API key with the `convai_write` scope — either the CLI's stored
# login (`elevenlabs auth login`) or ELEVENLABS_API_KEY via fnox exec.
#
#   bun run scripts/elevenlabs/gen-agent-configs.ts
#   bash scripts/elevenlabs/create-agents-ja.sh
#
# Afterwards, copy the printed agent IDs into PERSONA_AGENT_IDS_JA in
# lib/realtime/elevenlabs-agent.ts.
set -euo pipefail

[ -f agents.json ] || { echo "run from the CLI project root (agents.json not found)" >&2; exit 1; }

for p in aria onyx sage nova echo cipher vesper; do
  elevenlabs agents add "tsubaki-$p-ja" --from-file "agent_configs/tsubaki-$p-ja.json"
done

# `agents add` only registers the config in the local project; `agents push`
# uploads to the platform and writes the assigned IDs back into agents.json.
elevenlabs agents push

echo
echo "── JA Agent IDs (paste into lib/realtime/elevenlabs-agent.ts) ──"
# `agents add` may copy the config to a `-N.json` variant when the target file
# already exists (the generator wrote it first) — repoint agents.json back to
# the canonical generated file afterwards so the generator stays authoritative.
jq -r '.agents[] | select(.config | test("tsubaki-.*-ja")) | "\(.config | sub(".*tsubaki-"; "") | sub("-ja(-[0-9]+)?\\.json"; "")): \(.id)"' agents.json
