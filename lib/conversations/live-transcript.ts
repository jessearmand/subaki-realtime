// Grouping GPT-Live transcript deltas into turns. Pure, shared by the browser
// (live captions) and the server (the stored transcript, see live-capture.ts).
//
// GPT-Live is full duplex and its transcript deltas carry no turn ids or
// end-of-turn events, only text and an approximate [start_ms, end_ms) on the
// session timeline. A delta joins the speaker's latest turn when that turn is
// the newest one, or when it ended at most OVERLAP_GAP_MS before this delta
// starts: the other side spoke over them (a backchannel, an interruption), but
// the speaker carried on. Otherwise it opens a new turn.

export type Speaker = "user" | "agent";

export interface LiveTurn {
  who: Speaker;
  text: string;
  /** Session-timeline ms of the turn's first and last delta. */
  startMs: number;
  endMs: number;
}

/** How long a speaker may pause under the other's speech and still be continuing. */
export const OVERLAP_GAP_MS = 800;

function lastIndexOf(turns: readonly LiveTurn[], who: Speaker): number {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].who === who) return i;
  return -1;
}

/** The turns with one more delta applied. Never mutates its input. */
export function appendTranscriptDelta(
  turns: readonly LiveTurn[],
  who: Speaker,
  delta: string,
  startMs?: number,
  endMs?: number,
): LiveTurn[] {
  if (!delta) return turns.slice();
  const j = lastIndexOf(turns, who);
  const prev = j >= 0 ? turns[j] : undefined;
  const start = startMs ?? prev?.endMs ?? 0;
  const end = Math.max(endMs ?? start, start);
  const continues = prev && (j === turns.length - 1 || start - prev.endMs <= OVERLAP_GAP_MS);
  if (prev && continues) {
    const merged = { ...prev, text: prev.text + delta, endMs: Math.max(prev.endMs, end) };
    return [...turns.slice(0, j), merged, ...turns.slice(j + 1)];
  }
  return [...turns, { who, text: delta, startMs: start, endMs: end }];
}

/** Turns as stored and shown: trimmed text, empty turns dropped. */
export function settledTurns(turns: readonly LiveTurn[]): { who: Speaker; text: string }[] {
  const out: { who: Speaker; text: string }[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (text) out.push({ who: t.who, text });
  }
  return out;
}
