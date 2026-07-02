"use client";

// Silero VAD running in the browser via onnxruntime-web (WASM). This is a neural
// voice-activity detector — it answers "is this speech / did the turn end?", NOT
// "what was said?" (that's Mistral's job). It replaces the old energy/RMS gate,
// which sat below most rooms' noise floor and never fired end-of-turn.
//
// Model: loaded at call-start from jsDelivr, pinned to a silero-vad release tag
// (same CDN we already use for the ORT WASM runtime — no repo binary). Source of
// truth: github.com/snakers4/silero-vad → src/silero_vad/data/silero_vad.onnx
// (NOT files/silero_vad.onnx, which is the legacy h/c model). v6.x is a packaging
// change; the ONNX interface is unchanged. Interface: inputs
// input[1,576]/state[2,1,128]/sr → outputs output/stateN (see CONTEXT_SAMPLES).
//
// The model is stateful: each 512-sample (32 ms @ 16 kHz) frame is run in order,
// carrying the [2,1,128] state forward. A hysteresis state machine
// (positive/negative thresholds + a redemption grace period) turns the per-frame
// speech probability into onSpeechStart / onSpeechEnd events.
//
// Inference is async and must stay sequential (state ordering), so frames are
// queued and drained one at a time. onnxruntime-web is dynamically imported so it
// never touches the server bundle and only loads when a call actually starts.

import type * as Ort from "onnxruntime-web";

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 512; // Silero @ 16 kHz = 32 ms
// The official Silero ONNX wrapper prepends the last 64 samples of the previous
// frame as context, so each inference sees 64 + 512 = 576 samples. The current
// snakers4 model (silero-vad v6.x release) requires this — without it the model
// returns ~0.1 on clear speech. (ricky0123/vad's older bundled export took 512
// directly; that's the difference between the two same-graph models.)
const CONTEXT_SAMPLES = 64;
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;
const ORT_VERSION = "1.27.0"; // keep in sync with package.json onnxruntime-web
// Pinned silero-vad release tag → reproducible model bytes via jsDelivr's GitHub CDN.
const SILERO_TAG = "v6.2.1";
const MODEL_URL = `https://cdn.jsdelivr.net/gh/snakers4/silero-vad@${SILERO_TAG}/src/silero_vad/data/silero_vad.onnx`;

export interface SileroOptions {
  /** Override the model URL (defaults to the pinned jsDelivr CDN model). */
  modelUrl?: string;
  /** Frame prob above this ⇒ speech. */
  positiveSpeechThreshold?: number;
  /** Frame prob below this (while speaking) ⇒ counts toward end-of-turn. */
  negativeSpeechThreshold?: number;
  /** Silence after speech that ends the turn — the "let me finish" window. */
  redemptionMs?: number;
  /** Shortest run of speech that counts as a real turn (else a misfire). */
  minSpeechMs?: number;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onMisfire?: () => void;
  onError?: (message: string) => void;
}

let ortPromise: Promise<typeof import("onnxruntime-web")> | null = null;
function loadOrt(): Promise<typeof import("onnxruntime-web")> {
  return (ortPromise ??= import("onnxruntime-web"));
}

export class SileroVad {
  private readonly ort: typeof import("onnxruntime-web");
  private readonly session: Ort.InferenceSession;
  private readonly sr: Ort.Tensor;
  private state: Ort.Tensor;

  // Thresholds + grace, in frames.
  private readonly pos: number;
  private readonly neg: number;
  private readonly redemptionFrames: number;
  private readonly minSpeechFrames: number;
  private readonly cb: SileroOptions;

  // Sequential-inference queue + leftover (<512) samples.
  private leftover = new Float32Array(0);
  private queue: Float32Array[] = [];
  private draining = false;
  // Rolling 64-sample context prepended to each frame (official Silero usage).
  private context = new Float32Array(CONTEXT_SAMPLES);

  // Hysteresis state machine.
  private speaking = false;
  private redemption = 0;
  private speechFrames = 0;
  private paused = true;
  private closed = false;

  private constructor(
    ort: typeof import("onnxruntime-web"),
    session: Ort.InferenceSession,
    opts: SileroOptions,
  ) {
    this.ort = ort;
    this.session = session;
    this.cb = opts;
    this.pos = opts.positiveSpeechThreshold ?? 0.3;
    this.neg = opts.negativeSpeechThreshold ?? 0.25;
    this.redemptionFrames = Math.round((opts.redemptionMs ?? 900) / FRAME_MS);
    this.minSpeechFrames = Math.round((opts.minSpeechMs ?? 300) / FRAME_MS);
    this.sr = new ort.Tensor("int64", new BigInt64Array([BigInt(SAMPLE_RATE)]), [1]);
    this.state = SileroVad.freshState(ort);
  }

  private static freshState(ort: typeof import("onnxruntime-web")): Ort.Tensor {
    return new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
  }

  static async create(opts: SileroOptions = {}): Promise<SileroVad> {
    const ort = await loadOrt();
    // Single-threaded WASM avoids needing COOP/COEP cross-origin isolation;
    // one 512-sample frame at a time is plenty fast.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
    const session = await ort.InferenceSession.create(opts.modelUrl ?? MODEL_URL, {
      executionProviders: ["wasm"],
    });
    return new SileroVad(ort, session, opts);
  }

  /** Feed mic samples (16 kHz mono Float32). Buffers into 512-sample frames and
   *  runs them through the model in order. No-op while paused. */
  feed(samples: Float32Array): void {
    if (this.paused || this.closed) return;
    const merged = new Float32Array(this.leftover.length + samples.length);
    merged.set(this.leftover, 0);
    merged.set(samples, this.leftover.length);
    let offset = 0;
    for (; offset + FRAME_SAMPLES <= merged.length; offset += FRAME_SAMPLES) {
      this.queue.push(merged.slice(offset, offset + FRAME_SAMPLES));
    }
    this.leftover = merged.slice(offset);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        const frame = this.queue.shift();
        if (!frame) break;
        const prob = await this.infer(frame);
        if (!this.paused) this.onProb(prob);
      }
    } catch (err) {
      this.cb.onError?.(err instanceof Error ? err.message : "VAD inference error");
    } finally {
      this.draining = false;
    }
  }

  private async infer(frame: Float32Array): Promise<number> {
    // Prepend the rolling context → 64 + 512 = 576 samples, then carry the last
    // 64 samples of this frame forward (matches the official OnnxWrapper).
    const withCtx = new Float32Array(CONTEXT_SAMPLES + frame.length);
    withCtx.set(this.context, 0);
    withCtx.set(frame, CONTEXT_SAMPLES);
    this.context = frame.slice(frame.length - CONTEXT_SAMPLES);
    const input = new this.ort.Tensor("float32", withCtx, [1, withCtx.length]);
    const out = await this.session.run({ input, state: this.state, sr: this.sr });
    this.state = out.stateN as Ort.Tensor;
    return (out.output.data as Float32Array)[0];
  }

  private onProb(p: number): void {
    if (p >= this.pos) {
      if (!this.speaking) {
        this.speaking = true;
        this.speechFrames = 0;
        this.redemption = 0;
        this.cb.onSpeechStart?.();
      }
      this.speechFrames++;
      this.redemption = 0;
    } else if (this.speaking) {
      if (p < this.neg) {
        this.redemption++;
        if (this.redemption >= this.redemptionFrames) {
          const real = this.speechFrames >= this.minSpeechFrames;
          this.speaking = false;
          this.redemption = 0;
          this.speechFrames = 0;
          if (real) this.cb.onSpeechEnd?.();
          else this.cb.onMisfire?.();
        }
      } else {
        // Between thresholds while speaking: sustain, cancel the redemption dip.
        this.redemption = 0;
        this.speechFrames++;
      }
    }
  }

  /** Clear the turn/state machine (keeps the loaded session). */
  reset(): void {
    this.speaking = false;
    this.redemption = 0;
    this.speechFrames = 0;
    this.leftover = new Float32Array(0);
    this.queue = [];
    this.context = new Float32Array(CONTEXT_SAMPLES);
    this.state = SileroVad.freshState(this.ort);
  }

  /** Begin detecting (entering the listening state). */
  resume(): void {
    this.reset();
    this.paused = false;
  }

  /** Stop detecting (assistant speaking / muted) and drop any half-formed turn. */
  pause(): void {
    this.paused = true;
    this.reset();
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  close(): void {
    this.closed = true;
    this.paused = true;
    this.queue = [];
    void this.session.release?.().catch(() => {});
  }
}
