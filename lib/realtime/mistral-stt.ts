"use client";

// Browser-side leg of the Mistral realtime-STT cascade. Captures the mic at
// 16 kHz, streams PCM16 to the local proxy (which adds the Bearer header the
// browser can't), and turns Mistral's streaming `transcription.text.delta`
// events into discrete user turns.
//
// Turn boundaries are OURS, not the model's: Mistral only emits a terminal
// `transcription.done` after `input_audio.end` (which closes the stream), so for
// a back-and-forth conversation we keep the session open and decide a turn ended
// with a client-side silence gate (`SILENCE_HANGOVER_MS`) — directly fixing the
// "it cut me off before I finished" feel of the browser's fixed endpointer.
//
// The proxy lives at NEXT_PUBLIC_MISTRAL_STT_WS (default ws://localhost:3001);
// run it with `mise run stt-proxy`. See scripts/mistral-stt-proxy.ts.

import { calculateRms, float32ToPcm16Base64 } from "./xai-audio";

const SAMPLE_RATE = 16000;
const PROC_FRAMES = 2048; // ~128 ms per audio block (finer VAD resolution)
// VAD tunables. The voice threshold is ADAPTIVE: it tracks the room's noise floor
// (EMA over silent frames) so a noisy mic doesn't read as perpetual speech — the
// old fixed 0.012 was below many rooms' noise floor, so the turn never ended.
const BASE_VOICE_RMS = 0.02; // floor of the dynamic threshold (quiet room)
const MAX_VOICE_RMS = 0.09; // cap so a loud room still lets speech through
const NOISE_MULT = 2.2; // speech must exceed noiseFloor × this …
const NOISE_MARGIN = 0.008; // … plus this fixed margin
const NOISE_EMA = 0.04; // noise-floor adaptation rate per silent frame
const MIN_SPEECH_MS = 300; // ignore sub-300 ms blips (clicks, breaths)
const SILENCE_HANGOVER_MS = 800; // silence after speech that ends the turn
const FLUSH_GRACE_MS = 350; // wait after flush to collect trailing deltas

export interface MistralSttOptions {
  /** WebSocket URL of the local proxy (e.g. ws://localhost:3001). */
  wsUrl: string;
  /** Realtime transcription model id. */
  model?: string;
  /** Running transcript of the in-progress turn (drive the live caption). */
  onPartial: (text: string) => void;
  /** A completed user turn (silence detected after speech). */
  onFinal: (text: string) => void;
  /** Connected and configured — safe to start speaking. */
  onReady?: () => void;
  /** Fatal error (proxy down, mic denied, upstream closed). */
  onError?: (message: string) => void;
}

export class MistralStt {
  private readonly opts: MistralSttOptions;
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private proc: ScriptProcessorNode | null = null;

  // Capture gating: audio is streamed only while listening && !muted.
  private listening = false;
  private muted = false;
  private closed = false;
  private ready = false;

  // Per-turn transcript + VAD state.
  private turnText = "";
  private voiceMs = 0;
  private hadSpeech = false;
  private silenceMs = 0;
  private emitting = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inputRms = 0;
  // Adaptive background-noise estimate (EMA over silent frames).
  private noiseFloor = 0.01;

  constructor(opts: MistralSttOptions) {
    this.opts = opts;
  }

  /** Open the mic + proxy WebSocket and configure the session. Resolves once
   *  the audio graph and socket are wired (not necessarily server-ready). */
  async start(): Promise<void> {
    this.closed = false;
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.ctx = ctx;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        // AGC boosts ambient noise enough to trip the VAD — keep it off so the
        // silence gate stays stable (same lesson as the PersonaPlex mic gate).
        autoGainControl: false,
      },
    });
    if (this.closed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    this.source = source;
    const proc = ctx.createScriptProcessor(PROC_FRAMES, 1, 1);
    this.proc = proc;
    const frameMs = (PROC_FRAMES / SAMPLE_RATE) * 1000;
    proc.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0), frameMs);
    source.connect(proc);
    // Required for the callback to fire in some browsers; the node writes no
    // output, so this does not echo the mic to the speakers.
    proc.connect(ctx.destination);

    this.connectWs();
  }

  private connectWs(): void {
    const model = this.opts.model ?? "voxtral-mini-transcribe-realtime-2602";
    const url = `${this.opts.wsUrl}?model=${encodeURIComponent(model)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.opts.onError?.("STT proxy unreachable");
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            audio_format: { encoding: "pcm_s16le", sample_rate: SAMPLE_RATE },
            target_streaming_delay_ms: 1000,
          },
        }),
      );
    };
    ws.onmessage = (ev) => this.onMessage(ev);
    ws.onerror = () => {
      if (!this.closed) this.opts.onError?.("STT proxy connection error");
    };
    ws.onclose = () => {
      if (!this.closed && this.ready) this.opts.onError?.("STT session closed");
    };
  }

  private onMessage(ev: MessageEvent): void {
    let msg: { type?: string; text?: string };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
    } catch {
      return;
    }
    switch (msg.type) {
      case "session.updated":
        if (!this.ready) {
          this.ready = true;
          this.opts.onReady?.();
        }
        break;
      case "transcription.text.delta":
        // Deltas only count toward a turn while we're actually listening; any
        // that arrive during the assistant's turn are dropped on resume.
        if (this.listening && !this.muted && msg.text) {
          this.turnText += msg.text;
          this.opts.onPartial(this.turnText.trim());
        }
        break;
      case "error":
        this.opts.onError?.("STT error");
        break;
      default:
        break;
    }
  }

  private onAudio(input: Float32Array, frameMs: number): void {
    if (this.muted || !this.listening) {
      this.inputRms = 0;
      return;
    }
    const rms = calculateRms(input);
    this.inputRms = rms;

    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input_audio.append", audio: float32ToPcm16Base64(input) }));
    }

    // Adaptive silence-gated turn detection.
    const threshold = Math.min(
      MAX_VOICE_RMS,
      Math.max(BASE_VOICE_RMS, this.noiseFloor * NOISE_MULT + NOISE_MARGIN),
    );
    if (rms >= threshold) {
      this.voiceMs += frameMs;
      this.silenceMs = 0;
      if (this.voiceMs >= MIN_SPEECH_MS) this.hadSpeech = true;
    } else {
      // Below threshold ⇒ this frame is ambient; let the noise floor track it.
      this.noiseFloor = this.noiseFloor * (1 - NOISE_EMA) + rms * NOISE_EMA;
      if (this.hadSpeech) {
        this.silenceMs += frameMs;
        if (this.silenceMs >= SILENCE_HANGOVER_MS && !this.emitting) this.endTurn();
      }
    }
  }

  /** Manually end the current turn now (the "send" button), bypassing the
   *  silence gate. Flushes and emits whatever has been transcribed; no-op if not
   *  listening or already emitting. */
  endTurnNow(): void {
    if (!this.listening || this.muted || this.emitting) return;
    this.endTurn();
  }

  /** Flush the tail, wait briefly for trailing deltas, then emit the turn. */
  private endTurn(): void {
    this.emitting = true;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input_audio.flush" }));
    }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      const text = this.turnText.trim();
      this.resetTurn();
      this.emitting = false;
      if (text) this.opts.onFinal(text);
    }, FLUSH_GRACE_MS);
  }

  private resetTurn(): void {
    this.turnText = "";
    this.voiceMs = 0;
    this.silenceMs = 0;
    this.hadSpeech = false;
  }

  /** Resume capturing the user (call when entering the listening state). */
  resume(): void {
    this.resetTurn();
    this.emitting = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.listening = true;
  }

  /** Pause capturing (call while the assistant is speaking). Drops any
   *  half-formed turn so TTS bleed-through never becomes a user message. */
  pause(): void {
    this.listening = false;
    this.resetTurn();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Current mic RMS (0 while paused/muted) for the input visualizer. */
  get level(): number {
    return this.inputRms;
  }

  /** Tear everything down. */
  stop(): void {
    this.closed = true;
    this.listening = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.proc) {
      this.proc.onaudioprocess = null;
      try {
        this.proc.disconnect();
      } catch {
        // already disconnected
      }
      this.proc = null;
    }
    try {
      this.source?.disconnect();
    } catch {
      // already disconnected
    }
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input_audio.end" }));
        ws.close();
      } catch {
        // already closing
      }
    }
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }
}
