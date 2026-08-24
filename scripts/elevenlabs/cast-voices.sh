#!/usr/bin/env bash
# Adds the shared-voice-library casting for the seven Tsubaki personas to the
# workspace, one voice per persona. Voice IDs / owner IDs come from
# GET /v1/shared-voices (they are public catalog identifiers, not secrets).
#
# Requires ELEVENLABS_API_KEY with the `add_voice_from_voice_library` scope:
#   fnox exec -- bash scripts/elevenlabs/cast-voices.sh
#
# Library voices keep their catalog voice_id when added, so gen-agent-configs.ts
# references them directly. This is the audition-chosen casting (character/
# villain reads); recast by ear (swap voiceId, regenerate, `elevenlabs agents push`).
set -euo pipefail

: "${ELEVENLABS_API_KEY:?set via fnox exec}"

add() { # add <persona> <public_owner_id> <voice_id> <name>
  echo "── $1 ← $4"
  curl -sf -X POST "https://api.elevenlabs.io/v1/voices/add/$2/$3" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
    -d "{\"new_name\": \"$4\"}"
  echo
}

add aria 2b0d07a6ce09d07685ec4dabdf136a37762f1764f4de7d3b52d2a108940683c4 TC0Zp7WVFzhA8zpTlRqV "Tsubaki ARIA - Aria (Sultry Villain)"
add onyx ae23ca715ed6b339e4ad22f2d45dd40b36a6449e031b4f8970bfe29524bd1bbc 3SF4rB1fGBMXU9xRM7pz "Tsubaki ONYX - Oxley (Eccentric, Distorted and Evil)"
add sage cf9bd07551c5671599c30098fa8e3bbcdebd88067cfe543b11c17ddabbd50cd5 kPtEHAvRnjUJFv7SK9WI "Tsubaki SAGE - Glitch (Digital prankster)"
add nova 89aa1f4768185949a1b12bf3aa6a9f31995d2cf8ff70e9051d4e2dfa758d1ab5 Se2Vw1WbHmGbBbyWTuu4 "Tsubaki NOVA - Allison (Inviting and Velvety)"
add echo 76fb06688ef565775843b4efa41dd61de204a6cf28aa7ba86536140378d39188 tQ4MEZFJOzsahSEEZtHK "Tsubaki ECHO - Ivanna (Seductive & Intimate)"
add cipher 18599001ec9126b66cf378225f5b839e6c127716f0f3dc7807450b275732de44 Vs5CmVCVJwW4odQS2pVf "Tsubaki CIPHER - Branok (Evil & Villainous)"
add vesper 8ca83914d9feda1c71c14f6d7c289ea0ec01ccaa5bfd245c5c6d197de25f32a7 YDCfZMLWcUmsGvqHq0rS "Tsubaki VESPER - Blondie (Femme Fatale)"

echo "Done. New workspace voice IDs: GET /v1/voices (or \`elevenlabs\` dashboard → Voices)."
