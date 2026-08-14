#!/usr/bin/env bash
# Creates the seven Tsubaki persona agents on the ElevenLabs platform from the
# generated configs. Existing agents (explorer, Japan-Culture-Expert,
# Travel-guide) are untouched — the CLI appends new entries to agents.json.
#
# Run from the CLI project root (the main repo root, where agents.json lives).
# Requires an API key with the `convai_write` scope — either the CLI's stored
# login (`elevenlabs auth login`) or ELEVENLABS_API_KEY via fnox exec.
#
#   bun run scripts/elevenlabs/gen-agent-configs.ts
#   bash scripts/elevenlabs/create-agents.sh
#
# Afterwards, copy the printed agent IDs into PERSONA_AGENT_IDS in
# lib/realtime/elevenlabs-agent.ts.
set -euo pipefail

[ -f agents.json ] || { echo "run from the CLI project root (agents.json not found)" >&2; exit 1; }

for p in aria onyx sage nova echo cipher vesper; do
  elevenlabs agents add "tsubaki-$p" --from-file "agent_configs/tsubaki-$p.json"
done

# `agents add` only registers the config in the local project; `agents push`
# uploads to the platform and writes the assigned IDs back into agents.json.
elevenlabs agents push

echo
echo "── Agent IDs (paste into lib/realtime/elevenlabs-agent.ts) ──"
jq -r '.agents[] | select(.config | test("tsubaki-")) | "\(.config | sub(".*tsubaki-"; "") | sub(".json"; "")): \(.id)"' agents.json
