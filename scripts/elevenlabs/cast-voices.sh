#!/usr/bin/env bash
# Adds the shared-voice-library casting for the seven Tsubaki personas to the
# workspace, one voice per persona. Voice IDs / owner IDs come from
# GET /v1/shared-voices (they are public catalog identifiers, not secrets).
#
# Requires ELEVENLABS_API_KEY with the `add_voice_from_voice_library` scope:
#   fnox exec -- bash scripts/elevenlabs/cast-voices.sh
#
# Library voices keep their catalog voice_id when added, so gen-agent-configs.ts
# already references them. Casting is a starting point — audition each voice
# and recast by ear (swap voiceId, regenerate, `elevenlabs agents push`).
set -euo pipefail

: "${ELEVENLABS_API_KEY:?set via fnox exec}"

add() { # add <persona> <public_owner_id> <voice_id> <name>
  echo "── $1 ← $4"
  curl -sf -X POST "https://api.elevenlabs.io/v1/voices/add/$2/$3" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
    -d "{\"new_name\": \"$4\"}"
  echo
}

add aria e3f59c5c065dae143d73d51c5a4a6fa45d1f39e239c78b3fc1557a641de97381 ogwqBH5bbF03DSbNiRNN "Tsubaki ARIA - Savvy (Warm, Grounded & Natural)"
add onyx d55d097341fbb231b71970b6d0d067b6436adcf82866f78c127c07aea50c885a gbG7jOLRw62v3JQ8cFWq "Tsubaki ONYX - Ben (Resonant, Steady & Authoritative)"
add sage 64cbc624eb5aab4e95a968e1f41d75402277cca6e549036ed17e56ea33bbbc9e mBqbvkxIFe5HjjaoiN4P "Tsubaki SAGE - Justin (Approachable Support)"
add nova 5c83469454159b28dee4ec0b7c67e2aae7ffef719705aee500de21c4221c7ad2 oW8bn5YtBB89X2nJ0DT9 "Tsubaki NOVA - Verity (Chatty, Fast-Paced Storyteller)"
add echo 8a95c14eec614c8dc201a67dc1d0a23cf6069820822686d3c635a48998c26fa4 j7KV53NgP8U4LRS2k2Gs "Tsubaki ECHO - Violet (Soft, Wistful and Inviting)"
add cipher f059a227d4518f4d41099476f15929194274a13778d5dba20dba1091a15b4d7a EPqJ3pbzRRJKDULoCIQk "Tsubaki CIPHER - Mark (Still Waters Run Deep)"
add vesper 8ca83914d9feda1c71c14f6d7c289ea0ec01ccaa5bfd245c5c6d197de25f32a7 YDCfZMLWcUmsGvqHq0rS "Tsubaki VESPER - Blondie (Femme Fatale)"

echo "Done. New workspace voice IDs: GET /v1/voices (or \`elevenlabs\` dashboard → Voices)."
