// StreamingText — renders a streamed string as settled text plus freshly
// appended chunks. Each update is diffed against the previous text: a pure
// append becomes one animated chunk (however many words the engine emitted),
// a partial rewrite (STT correction) keeps the common prefix settled and
// animates only what changed. Settled text never re-renders as a chunk, so
// nothing already on screen ever re-animates.

import { useState } from "react";

interface Chunk {
  id: number;
  text: string;
}

interface StreamState {
  /** Full text as of the last render — the diff baseline. */
  text: string;
  /** Prefix that has been on screen long enough to render unanimated. */
  settled: string;
  /** Appended deltas still wearing their entry animation. */
  fresh: Chunk[];
  nextId: number;
}

function advance(prev: StreamState, text: string): StreamState {
  if (text.startsWith(prev.text)) {
    const delta = text.slice(prev.text.length);
    if (!delta) return prev;
    return {
      text,
      settled: prev.settled,
      fresh: [...prev.fresh, { id: prev.nextId, text: delta }],
      nextId: prev.nextId + 1,
    };
  }
  // Rewrite: keep the unchanged prefix settled, animate only the divergent tail.
  const n = Math.min(prev.text.length, text.length);
  let p = 0;
  while (p < n && prev.text[p] === text[p]) p++;
  return {
    text,
    settled: text.slice(0, p),
    fresh: p < text.length ? [{ id: prev.nextId, text: text.slice(p) }] : [],
    nextId: prev.nextId + 1,
  };
}

export function StreamingText({ text }: { text: string }) {
  // Mount renders everything settled — the block-level entry animation on the
  // parent covers the first paint; chunks only animate for subsequent deltas.
  const [state, setState] = useState<StreamState>(() => ({
    text,
    settled: text,
    fresh: [],
    nextId: 0,
  }));

  // Render-phase state adjustment (React's "adjusting state when a prop
  // changes" pattern). The updater is pure, so this is StrictMode-safe.
  if (state.text !== text) setState((prev) => advance(prev, text));

  return (
    <>
      {state.settled}
      {state.fresh.map((c) => (
        <span key={c.id} className="tb-stream-chunk">
          {c.text}
        </span>
      ))}
    </>
  );
}
