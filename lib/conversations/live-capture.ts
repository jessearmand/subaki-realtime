// Server-only: capture an OPENAI LIVE call's transcript over a sideband.
//
// After creating a session, the server attaches its own WebSocket to it
// (wss://…/v1/live/sessions/{id}/attach, project key) and hears the same
// transcript deltas as the browser. The stored transcript therefore comes from
// OpenAI, not from the browser, and survives a closed tab. The record is
// checkpointed while the call runs and finalized at session.closed (or when the
// sideband drops), which is also when the call is ingested into mem0.
//
// Each capture lives in this server process (dev: `next dev`). A restart
// mid-call loses the tail since the last checkpoint; the record then shows as
// abandoned in history.

import { appendTranscriptDelta, settledTurns, type LiveTurn } from "./live-transcript";
import { nowSecs, putCall, type LiveCallRecord } from "./live-store";

const ATTACH_URL = "wss://api.openai.com/v1/live/sessions";
const CHECKPOINT_MS = 10_000;
// GPT-Live connected calls are capped at 2 hours; stop listening a bit after.
const MAX_CAPTURE_MS = 2 * 60 * 60 * 1000 + 5 * 60 * 1000;
// The attach replays the last 3 s; event ids dedupe it.
const MAX_SEEN_IDS = 10_000;

interface SidebandEvent {
  type?: string;
  event_id?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  reason?: string;
  error?: { message?: string };
}

export interface CaptureOptions {
  apiKey: string;
  /** The GPT-Live session id from creation (opaque; never stored as our id). */
  sessionId: string;
  record: LiveCallRecord;
  /** Runs once after the final record is written (mem0 ingest). */
  onFinished: (record: LiveCallRecord) => Promise<void>;
}

// Node's WebSocket (undici) takes request headers in its init object; the DOM
// typings only know the protocols argument.
type HeaderWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/**
 * Upstream text for one log line: control characters (newlines included)
 * become spaces and the length is capped, so it can't forge or flood entries.
 */
function logSafe(text: unknown, max = 300): string {
  if (typeof text !== "string") return "error";
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  const flat = text.replace(/[\u{0}-\u{1f}\u{7f}-\u{9f}\u{2028}\u{2029}]+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat || "error";
}

class LiveCapture {
  private turns: LiveTurn[] = [];
  private seen = new Set<string>();
  private dirty = false;
  private finished = false;
  private writing: Promise<void> = Promise.resolve();
  private ws: WebSocket | null = null;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: CaptureOptions) {}

  start(): void {
    const url = `${ATTACH_URL}/${encodeURIComponent(this.opts.sessionId)}/attach`;
    const ws = new (WebSocket as unknown as HeaderWebSocket)(url, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    this.ws = ws;
    ws.onmessage = (msg) => this.onMessage(msg.data);
    ws.onerror = () => console.warn(`[live-capture] sideband error for ${this.opts.record.id}`);
    ws.onclose = () => void this.finish();
    this.checkpointTimer = setInterval(() => this.checkpoint(), CHECKPOINT_MS);
    this.deadline = setTimeout(() => void this.finish(), MAX_CAPTURE_MS);
  }

  private onMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let ev: SidebandEvent;
    try {
      ev = JSON.parse(data) as SidebandEvent;
    } catch {
      return;
    }
    if (ev.event_id) {
      if (this.seen.has(ev.event_id)) return;
      if (this.seen.size >= MAX_SEEN_IDS) this.seen.clear();
      this.seen.add(ev.event_id);
    }
    switch (ev.type) {
      case "session.input_transcript.delta":
      case "session.output_transcript.delta": {
        const who = ev.type === "session.input_transcript.delta" ? "user" : "agent";
        this.turns = appendTranscriptDelta(this.turns, who, ev.delta ?? "", ev.start_ms, ev.end_ms);
        this.dirty = true;
        break;
      }
      case "session.closed":
        void this.finish();
        break;
      case "error":
        console.warn(`[live-capture] ${this.opts.record.id}: ${logSafe(ev.error?.message)}`);
        break;
      default:
        break;
    }
  }

  /** Write the record with the turns so far; writes never overlap. */
  private write(final: boolean): Promise<void> {
    const turns = settledTurns(this.turns);
    const now = nowSecs();
    const record: LiveCallRecord = {
      ...this.opts.record,
      turns,
      updatedAt: now,
      ...(final ? { status: "done", endedAt: now } : {}),
    };
    this.writing = this.writing
      .then(() => putCall(record))
      .catch((err: unknown) => {
        console.warn(`[live-capture] write failed for ${record.id}:`, err);
      });
    return this.writing.then(() => {
      if (final) this.opts.record = record;
    });
  }

  private checkpoint(): void {
    if (!this.dirty || this.finished) return;
    this.dirty = false;
    void this.write(false);
  }

  private async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    captures.delete(this.opts.record.id);
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
    if (this.deadline) clearTimeout(this.deadline);
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    await this.write(true);
    try {
      await this.opts.onFinished(this.opts.record);
    } catch (err) {
      console.warn(`[live-capture] post-call step failed for ${this.opts.record.id}:`, err);
    }
  }
}

// One capture per call, kept on globalThis so a dev-server module reload
// doesn't orphan running captures.
const store = globalThis as typeof globalThis & {
  __tsubakiLiveCaptures?: Map<string, LiveCapture>;
};
const captures = (store.__tsubakiLiveCaptures ??= new Map<string, LiveCapture>());

/** Whether this server process is still recording the call; its record is not final yet. */
export function isCapturing(callId: string): boolean {
  return captures.has(callId);
}

/** Attach to a just-created session and record its transcript until it closes. */
export function startLiveCapture(opts: CaptureOptions): void {
  if (captures.has(opts.record.id)) return;
  const capture = new LiveCapture(opts);
  captures.set(opts.record.id, capture);
  try {
    capture.start();
  } catch (err) {
    // The session already exists upstream: let the call go on unrecorded
    // rather than fail the route, and don't leave it looking "capturing".
    captures.delete(opts.record.id);
    console.warn(`[live-capture] could not attach to ${opts.record.id}:`, err);
  }
}
