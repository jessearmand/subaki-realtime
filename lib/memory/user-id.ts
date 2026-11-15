// The visitor's opaque memory id, created once per browser and kept in localStorage.
//
// It is the only identity the app has: no names, no emails. It is passed to
// ElevenLabs as the session `userId` (so stored conversations are attributable)
// and to mem0 as `user_id`. Clearing site data starts a fresh memory.

import { MEMORY_USER_ID_PREFIX, isMemoryUserId } from "./ids";

const KEY = "tsubaki.memory-user";

let fallback: string | undefined;

function mint(): string {
  return `${MEMORY_USER_ID_PREFIX}${crypto.randomUUID()}`;
}

export function getMemoryUserId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (isMemoryUserId(saved)) return saved;
    const id = mint();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage blocked (private mode, policy): remember for this page load only.
    fallback ??= mint();
    return fallback;
  }
}
