// The history list's paging, across two stores. Pure, so the merge rules can be
// checked without either store.
//
// ElevenLabs pages through its own cursor. OPENAI LIVE calls come from our index,
// newest first. Each request takes one ElevenLabs page and then the Live calls
// that are at least as new as that page's oldest call, so the merged list stays
// in time order. Once ElevenLabs runs out, Live calls page on their own. Either
// store may be absent (no key), which reads as exhausted from the start.

export interface HistoryCursor {
  /** ElevenLabs cursor for the next page. */
  e?: string;
  /** ElevenLabs is exhausted (or not configured). */
  ed?: boolean;
  /** Name of the last Live index entry already taken. */
  l?: string;
  /** Live calls are exhausted (or storage not configured). */
  ld?: boolean;
}

const MAX_CURSOR_CHARS = 2000;
// ElevenLabs cursors are opaque tokens; bound them so nothing odd reaches its URL.
const EL_CURSOR_RE = /^[A-Za-z0-9_\-=.]{1,512}$/;
// A Live index entry name (live-store.ts).
const LIVE_NAME_RE = /^\d{11}_olc_[0-9a-f]{32}$/;

export function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** The cursor, or null if it is malformed. */
export function decodeCursor(raw: unknown): HistoryCursor | null {
  if (typeof raw !== "string" || raw.length > MAX_CURSOR_CHARS) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof v !== "object" || v === null) return null;
    const ok =
      (v.e === undefined || (typeof v.e === "string" && EL_CURSOR_RE.test(v.e))) &&
      (v.ed === undefined || typeof v.ed === "boolean") &&
      (v.l === undefined || (typeof v.l === "string" && LIVE_NAME_RE.test(v.l))) &&
      (v.ld === undefined || typeof v.ld === "boolean");
    return ok ? (v as HistoryCursor) : null;
  } catch {
    return null;
  }
}

/**
 * The lowest start time Live calls may have on this page. With ElevenLabs
 * still paging, it is that page's oldest call (an empty page takes no Live
 * calls, since it says nothing about time); once ElevenLabs is done, anything.
 */
export function liveFloor(elFinished: boolean, elStartTimes: number[]): number {
  if (elFinished) return Number.NEGATIVE_INFINITY;
  return elStartTimes.length ? Math.min(...elStartTimes) : Number.POSITIVE_INFINITY;
}

/** Newest-first entries at or above the floor, at most `max`, and whether that took them all. */
export function takeLiveWindow<T extends { startedAt: number }>(
  entries: T[],
  floor: number,
  max: number,
): { take: T[]; consumedAll: boolean } {
  const take: T[] = [];
  for (const e of entries) {
    if (take.length >= max || e.startedAt < floor) break;
    take.push(e);
  }
  return { take, consumedAll: take.length === entries.length };
}
