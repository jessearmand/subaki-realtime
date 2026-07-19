// Sample-accurate playback for CONTINUOUS realtime PCM streams (PersonaPlex).
//
// Why not PlaybackQueue (xai-audio.ts)? That queue starts chunk N+1 from chunk
// N's `onended` callback — a main-thread event that fires 1–10ms late. xAI's
// large turn-based deltas hide that; PersonaPlex delivers 80ms frames paced at
// realtime, so EVERY frame boundary picks up an audible micro-gap and any
// slightly-late frame underruns — a crackle every 80ms (the bundled
// personaplex-mlx client solves this with an AudioWorklet jitter buffer).
//
// This queue instead schedules every chunk at an exact position on the
// AudioContext clock (`source.start(when)`): back-to-back chunks are
// sample-contiguous regardless of main-thread latency. A small `lead` (jitter
// buffer) delays the stream start so network/pacing jitter up to that lead
// never underruns; on underrun (a chunk arrives after its slot passed) the
// stream re-anchors with the same lead — one gap, not a crackle.

import { calculateRms } from "./xai-audio";

interface ScheduledChunk {
  start: number;
  end: number;
  rms: number;
  src: AudioBufferSourceNode;
}

export class ScheduledPlaybackQueue {
  private ctx: AudioContext;
  private readonly leadS: number;
  /** Context-clock position where the next chunk will be scheduled. */
  private nextTime = 0;
  private scheduled: ScheduledChunk[] = [];

  /** @param leadMs initial jitter buffer — absorbs inter-chunk arrival jitter. */
  constructor(ctx: AudioContext, leadMs = 160) {
    this.ctx = ctx;
    this.leadS = leadMs / 1000;
  }

  enqueue(chunk: Float32Array): void {
    if (chunk.length === 0) return;
    const now = this.ctx.currentTime;
    // Fresh stream or underrun (our slot already passed) — re-anchor with lead.
    if (this.nextTime < now + 0.005) this.nextTime = now + this.leadS;

    const buffer = this.ctx.createBuffer(1, chunk.length, this.ctx.sampleRate);
    buffer.getChannelData(0).set(chunk);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);

    const entry: ScheduledChunk = {
      start: this.nextTime,
      end: this.nextTime + chunk.length / this.ctx.sampleRate,
      rms: calculateRms(chunk),
      src,
    };
    this.scheduled.push(entry);
    src.onended = () => {
      const i = this.scheduled.indexOf(entry);
      if (i >= 0) this.scheduled.splice(i, 1);
    };
    src.start(this.nextTime);
    this.nextTime = entry.end;
  }

  /** Barge-in/teardown: stop everything scheduled and reset the clock anchor. */
  stop(): void {
    for (const e of this.scheduled) {
      e.src.onended = null;
      try {
        e.src.stop();
        e.src.disconnect();
      } catch {
        // already stopped
      }
    }
    this.scheduled = [];
    this.nextTime = 0;
  }

  /** RMS of the chunk playing right now (0 when idle) — drives the orb. */
  get level(): number {
    const t = this.ctx.currentTime;
    const e = this.scheduled.find((c) => t >= c.start && t < c.end);
    return e ? e.rms : 0;
  }

  get isPlaying(): boolean {
    const t = this.ctx.currentTime;
    return this.scheduled.some((c) => c.end > t);
  }
}
