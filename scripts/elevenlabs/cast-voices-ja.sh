#!/usr/bin/env bash
# Adds the Japanese shared-voice-library casting for the seven Tsubaki personas
# to the workspace — the JA counterpart of cast-voices.sh. Voice IDs / owner IDs
# come from GET /v1/shared-voices?language=ja&category=professional (public
# catalog identifiers, not secrets).
#
# ARIA is absent on purpose: her JA voice is もりおき (Morioki,
# 8EkOjt4xTPGMclNlh1pk), already in the workspace via the Japan Culture Expert
# agent.
#
# Requires ELEVENLABS_API_KEY with the `add_voice_from_voice_library` scope:
#   fnox exec -- bash scripts/elevenlabs/cast-voices-ja.sh
#
# Library voices keep their catalog voice_id when added, so gen-agent-configs.ts
# references them directly. Casting was auditioned by ear from library previews;
# recast by ear (swap voiceId, regenerate, `elevenlabs agents push`).
set -euo pipefail

: "${ELEVENLABS_API_KEY:?set via fnox exec}"

add() { # add <persona> <public_owner_id> <voice_id> <name>
  echo "── $1 ← $4"
  curl -sf -X POST "https://api.elevenlabs.io/v1/voices/add/$2/$3" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
    -d "{\"new_name\": \"$4\"}"
  echo
}

add onyx b6abf1b689fa093e92ba588494cedb77ad31c5f089f09a817c158e56f295188b 4YdULuX6cCG6iCRjMFZM "Tsubaki ONYX JA - Kyo (Low, Soft & Steady)"
add sage cc9dbfcc1689f1415622a93b5417bf1bf0ccb7c6461e0c1d47f4f6cd29fdeaf0 nZ1TUMhlYQFm890dVJCz "Tsubaki SAGE JA - Minato (Calm, Warm & Clear)"
add nova 203417e225a14df2d2e1526ab6b429816e66fa469cd12c099c80dc8b6a5aca5b lxNssjs8lZzgD44uVifH "Tsubaki NOVA JA - Rina (Young Adult & Natural)"
add echo 50dade802a91f775fc0a154b882b4e0184c90a9f488c1d2dceaa3a76779dbbe5 nBV906YvEOdwWKK9J8Hx "Tsubaki ECHO JA - Mio (Warm Japanese Narrator)"
add cipher a41b420f57a0bd792c8c718814bb10a604ab2a6e9a55a5bb95b6d4ac51aa9782 CNs61ARiqwaYAbqKRbHf "Tsubaki CIPHER JA - Ken (Friendly Japanese male)"
add vesper c1f16853a7a051c40da1739e9f73cbceb0ff39545bd323c0a8ab7f40ef8d744c fVUIeVRB3vuo1X2r1gMM "Tsubaki VESPER JA - Mithiru (Husky)"

echo "Done. New workspace voice IDs: GET /v1/voices (or \`elevenlabs\` dashboard → Voices)."
