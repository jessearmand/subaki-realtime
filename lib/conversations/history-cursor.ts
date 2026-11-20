// The history list's paging, across two stores. Pure, so the merge rules can be
// checked without either store.
//
// ElevenLabs pages through its own cursor. OPENAI LIVE calls come from our index,
// newest first. Each request takes one ElevenLabs page and then the Live calls
// that are at least as new as that page's oldest call. Once ElevenLabs runs
// out, Live calls page on their own. Either store may be absent (no key), which
// reads as exhausted from the start.
//
// The client appends pages, so every item of one response must be newer than
// every item of the next. When more Live calls are newer than the ElevenLabs
// page than one response takes, the page is *held*: only its calls at least as
// new as the last Live call taken are sent, its cursor is not advanced, and
// `eb` records that boundary so the next request (which reads the same page
// again) skips what was already sent.

export interface HistoryCursor {
  /** ElevenLabs cursor for the next page. */
  e?: string;
  /** ElevenLabs is exhausted (or not configured). */
  ed?: boolean;
  /** Name of the last Live index entry already taken. */
  l?: string;
  /** Live calls are exhausted (or storage not configured). */
  ld?: boolean;
  /** Held ElevenLabs page: its calls started at or after this (unix s) were already sent. */
  eb?: number;
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
      (v.ld === undefined || typeof v.ld === "boolean") &&
      (v.eb === undefined || (typeof v.eb === "number" && Number.isFinite(v.eb)));
    return ok ? (v as HistoryCursor) : null;
  } catch {
    return null;
  }
}

/** What this request read from ElevenLabs. */
export type ElevenLabsRead =
  | { kind: "done" }
  | { kind: "page"; startTimes: number[]; hasMore: boolean };

/**
 * The lowest start time Live calls may have on this page: the ElevenLabs
 * page's oldest call. An empty page with more behind it takes no Live calls,
 * since it says nothing about time; once ElevenLabs is done, anything goes.
 */
export function liveFloor(el: ElevenLabsRead): number {
  if (el.kind === "done") return Number.NEGATIVE_INFINITY;
  if (el.startTimes.length) return Math.min(...el.startTimes);
  return el.hasMore ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

export interface LiveWindow<T> {
  take: T[];
  /** No Live calls remain after `take`. */
  liveDone: boolean;
  /**
   * Live calls at or above the floor were left for the next request: hold the
   * ElevenLabs page at this start time (the oldest call taken). Null when the
   * window reached the floor.
   */
  holdAt: number | null;
}

/**
 * Newest-first entries at or above the floor, at most `max`. `truncated` says
 * the index listing stopped early, so more entries exist past `entries`.
 */
export function planLiveWindow<T extends { startedAt: number }>(
  entries: T[],
  truncated: boolean,
  floor: number,
  max: number,
): LiveWindow<T> {
  const take: T[] = [];
  for (const e of entries) {
    if (take.length >= max || e.startedAt < floor) break;
    take.push(e);
  }
  const next = entries[take.length];
  const liveDone = !next && !truncated;
  // Cut by the size limit rather than the floor (or the listing ran out
  // before reaching it): newer Live calls may still be waiting.
  const moreAboveFloor = next ? next.startedAt >= floor : truncated;
  const holdAt =
    moreAboveFloor && take.length && floor !== Number.NEGATIVE_INFINITY
      ? take[take.length - 1].startedAt
      : null;
  return { take, liveDone, holdAt };
}
