// Framework-free Web Audio helpers for the xAI Grok voice engine.
//
// xAI's realtime API exchanges raw PCM16 little-endian audio as base64 strings
// over the WebSocket (no codec). We capture mic Float32 frames, convert to
// PCM16, and base64-encode for `input_audio_buffer.append`; inbound
// `response.output_audio.delta` chunks are the reverse. Sample rate is the
// browser's native AudioContext rate end-to-end — we advertise it to xAI in
// `session.update`, so no resampling is needed (mirrors the xai-cookbook).

/** Float32 [-1,1] → PCM16 → base64. */
export function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return arrayBufferToBase64(pcm16.buffer);
}

/** base64 PCM16 → Float32 [-1,1]. */
export function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunk to stay well under the argument-count limit of String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Bounded FIFO of base64 PCM16 `input_audio_buffer.append` chunks captured
 * BEFORE the xAI session is configured.
 *
 * xAI's "parallel initialization" guidance: open the mic immediately (in
 * parallel with the token mint + WS connect), buffer the user's early speech
 * client-side, then flush it the instant `session.updated` arrives — so the
 * first words spoken right after pressing CALL aren't lost. Capacity-bounded so
 * a stalled or failed configuration can't grow memory without limit (the oldest
 * chunk is dropped past `maxChunks`).
 */
export class EarlyAudioBuffer {
  private chunks: string[] = [];
  private readonly maxChunks: number;

  /** @param maxChunks default 50 ≈ 5 s at 100 ms/chunk. */
  constructor(maxChunks = 50) {
    this.maxChunks = maxChunks;
  }

  push(base64: string): void {
    this.chunks.push(base64);
    if (this.chunks.length > this.maxChunks) this.chunks.shift();
  }

  /** Return everything buffered (in order) and reset — flush on session ready. */
  drain(): string[] {
    const out = this.chunks;
    this.chunks = [];
    return out;
  }

  clear(): void {
    this.chunks = [];
  }

  get size(): number {
    return this.chunks.length;
  }
}

/** Root-mean-square level of a frame, ~0..1. */
export function calculateRms(float32: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.sqrt(sum / float32.length);
}

/**
 * Gap-less playback of streamed PCM16 chunks via chained AudioBufferSourceNodes.
 * `stop()` clears the queue + kills the current source for barge-in. `level`
 * exposes the currently-playing chunk's RMS so the orb can react to TTS output.
 */
export class PlaybackQueue {
  private ctx: AudioContext;
  private queue: Float32Array[] = [];
  private playing = false;
  private current: AudioBufferSourceNode | null = null;
  private _level = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  enqueue(chunk: Float32Array): void {
    this.queue.push(chunk);
    if (!this.playing) {
      this.playing = true;
      this.playNext();
    }
  }

  private playNext(): void {
    const chunk = this.queue.shift();
    if (!chunk) {
      this.playing = false;
      this.current = null;
      this._level = 0;
      return;
    }
    const buffer = this.ctx.createBuffer(1, chunk.length, this.ctx.sampleRate);
    buffer.getChannelData(0).set(chunk);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    this.current = source;
    this._level = calculateRms(chunk);
    source.onended = () => {
      if (this.current === source) this.current = null;
      this.playNext();
    };
    source.start();
  }

  /** Barge-in: stop now and drop anything queued. */
  stop(): void {
    if (this.current) {
      try {
        this.current.stop();
        this.current.disconnect();
      } catch {
        // already stopped
      }
      this.current = null;
    }
    this.queue = [];
    this.playing = false;
    this._level = 0;
  }

  get level(): number {
    return this._level;
  }

  get isPlaying(): boolean {
    return this.playing;
  }
}
