// The visitor's opaque memory id, created once per browser and kept in localStorage.
//
// It is the only identity the app has: no names, no emails. It is passed to
// ElevenLabs as the session `userId` (so stored conversations are attributable)
// and to mem0 as `user_id`. Clearing site data starts a fresh memory.
//
// Storage is per browser and per origin, so each one mints its own id and sees
// only its own calls and memories. `setMemoryUserId` lets a visitor carry an id
// from one browser to another (Settings → VISITOR ID).

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

/**
 * Adopt an id minted by another browser. Every reader calls `getMemoryUserId`
 * at the moment it needs the id, so the change reaches the next history load
 * and the next call; a call already running keeps the id it started with.
 * Returns false, and changes nothing, for a malformed id.
 */
export function setMemoryUserId(id: string): boolean {
  if (!isMemoryUserId(id)) return false;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Storage blocked: hold it for this page load, as getMemoryUserId does.
    fallback = id;
  }
  return true;
}
