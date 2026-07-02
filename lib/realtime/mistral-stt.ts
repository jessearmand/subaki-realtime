"use client";

// Browser-side leg of the Mistral realtime-STT cascade. Captures the mic at
// 16 kHz, streams PCM16 to the local proxy (which adds the Bearer header the
// browser can't), and turns Mistral's streaming `transcription.text.delta`
// events into discrete user turns.
//
// Turn boundaries are OURS, not the model's: Mistral only emits a terminal
// `transcription.done` after `input_audio.end` (which closes the stream), so for
// a back-and-forth conversation we keep the session open and detect end-of-turn
// client-side with **Silero VAD** (neural, via onnxruntime-web — see
// `silero-vad.ts`). Silero answers "did the user stop talking?"; Mistral answers
// "what did they say?". This replaced an energy/RMS gate that sat below most
// rooms' noise floor and never fired end-of-turn. The manual "send" button
// (`endTurnNow`) remains as an override.
//
// The proxy lives at NEXT_PUBLIC_MISTRAL_STT_WS (default ws://localhost:3001);
// run it with `mise run stt-proxy`. See scripts/mistral-stt-proxy.ts.
//
// A second capture mode, `batch`, serves the LOCAL STT backend
// (config/voice-models.json → mlx-audio server): no WebSocket at all — the
// turn's PCM is buffered while the user speaks and POSTed as one WAV to
// /api/stt when the same Silero VAD (or the Send button) ends the turn. No
// live partial captions in this mode; everything else (mic graph, gating,
// levels, turn machine) is shared.

import { calculateRms, float32ToPcm16Base64 } from "./xai-audio";
import { SileroVad } from "./silero-vad";
import { encodeWavPcm16 } from "./wav";

const SAMPLE_RATE = 16000;
const PROC_FRAMES = 2048; // ~128 ms per audio block; a multiple of Silero's 512
const FLUSH_GRACE_MS = 350; // wait after flush to collect trailing deltas
// Silero turn-detection tunables (forwarded to SileroVad). Bump REDEMPTION_MS if
// it still ends turns too early; raise the thresholds if a noisy room over-triggers.
const VAD_REDEMPTION_MS = 900; // silence after speech that ends the turn
const VAD_MIN_SPEECH_MS = 250; // shortest run that counts as a real turn
const VAD_POSITIVE = 0.3; // speech-probability onset threshold
const VAD_NEGATIVE = 0.25; // speech-probability release threshold
// Batch mode: cap the per-turn recording (memory guard — 16 kHz mono Float32 is
// ~64 KB/s, so 120 s ≈ 7.5 MB). Beyond the cap the turn stops growing.
const BATCH_MAX_TURN_S = 120;

export interface MistralSttOptions {
  /** WebSocket URL of the local proxy (e.g. ws://localhost:3001). */
  wsUrl: string;
  /** Realtime transcription model id. */
  model?: string;
  /** `realtime` (default) streams to the Mistral WS proxy; `batch` records the
   *  turn and POSTs one WAV to /api/stt on turn end (local backend). */
  mode?: "realtime" | "batch";
  /** Catalog backend id forwarded to /api/stt in batch mode. */
  sttBackend?: string;
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
  private vad: SileroVad | null = null;

  // Capture gating: audio is streamed only while listening && !muted.
  private listening = false;
  private muted = false;
  private closed = false;
  private ready = false;

  // Per-turn transcript + emit state.
  private turnText = "";
  private emitting = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inputRms = 0;

  // Batch mode: the turn's recorded PCM (Float32 blocks at SAMPLE_RATE).
  private turnChunks: Float32Array[] = [];
  private turnSamples = 0;

  private get batch(): boolean {
    return this.opts.mode === "batch";
  }

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
    proc.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
    source.connect(proc);
    // Required for the callback to fire in some browsers; the node writes no
    // output, so this does not echo the mic to the speakers.
    proc.connect(ctx.destination);

    if (this.batch) {
      // No socket in batch mode — the mic graph is the whole session.
      this.ready = true;
      this.opts.onReady?.();
    } else {
      this.connectWs();
    }

    // Load Silero VAD in parallel (model fetch + ORT init). The mic streams to
    // Mistral immediately; turn detection comes online once this resolves. If it
    // fails to load, transcription still works — the manual "send" button covers
    // turn ends.
    SileroVad.create({
      positiveSpeechThreshold: VAD_POSITIVE,
      negativeSpeechThreshold: VAD_NEGATIVE,
      redemptionMs: VAD_REDEMPTION_MS,
      minSpeechMs: VAD_MIN_SPEECH_MS,
      onSpeechStart: () => this.onSpeechStart(),
      onSpeechEnd: () => this.onSpeechEnd(),
      // VAD failure is non-fatal: don't tear down Mistral STT (and don't fall
      // back to Web Speech, which is the thing we moved away from) — just lose
      // auto turn-detection. The manual "send" button still ends turns.
      onError: (m) => console.warn(`[mistral-stt] VAD: ${m} — use the Send button`),
    })
      .then((vad) => {
        if (this.closed) {
          vad.close();
          return;
        }
        this.vad = vad;
        if (this.listening && !this.muted) vad.resume();
      })
      .catch((err) => {
        console.warn(
          `[mistral-stt] Silero VAD load failed (${err instanceof Error ? err.message : "unknown"}) — use the Send button`,
        );
      });
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
      // Mistral marks a successful handshake with `session.created`; our
      // session.update on open is acked with `session.updated`. Either one
      // means the session is live — without `ready`, ws.onclose stays silent
      // and a dead socket would never trigger the Web Speech fallback.
      case "session.created":
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

  private onAudio(input: Float32Array): void {
    if (this.muted || !this.listening) {
      this.inputRms = 0;
      return;
    }
    this.inputRms = calculateRms(input); // for the input-level visualizer only

    if (this.batch) {
      // Record the turn locally; it's transcribed in one shot on turn end. The
      // buffer must copy — ScriptProcessor reuses its channel-data array.
      if (this.turnSamples < SAMPLE_RATE * BATCH_MAX_TURN_S && !this.emitting) {
        this.turnChunks.push(new Float32Array(input));
        this.turnSamples += input.length;
      }
    } else {
      const ws = this.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input_audio.append", audio: float32ToPcm16Base64(input) }));
      }
    }

    // Silero decides the turn boundaries (onSpeechEnd → endTurn).
    this.vad?.feed(input);
  }

  /** Silero saw speech begin. If an emit was pending (user paused, then resumed
   *  within the flush grace), cancel it and keep building the same turn. */
  private onSpeechStart(): void {
    if (this.emitting && this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.emitting = false;
    }
  }

  /** Silero saw end-of-speech ⇒ end the turn (flush + emit). */
  private onSpeechEnd(): void {
    if (this.listening && !this.muted && !this.emitting) this.endTurn();
  }

  /** Manually end the current turn now (the "send" button), bypassing the
   *  silence gate. Flushes and emits whatever has been transcribed; no-op if not
   *  listening or already emitting. */
  endTurnNow(): void {
    if (!this.listening || this.muted || this.emitting) return;
    this.endTurn();
  }

  /** Realtime: flush the tail, wait briefly for trailing deltas, then emit.
   *  Batch: POST the recorded turn as one WAV and emit the transcription. */
  private endTurn(): void {
    if (this.batch) {
      void this.endTurnBatch();
      return;
    }
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

  private async endTurnBatch(): Promise<void> {
    const chunks = this.turnChunks;
    this.resetTurn();
    if (chunks.length === 0) return;
    this.emitting = true;
    this.opts.onPartial("… transcribing");
    try {
      const backend = this.opts.sttBackend;
      const res = await fetch(
        `/api/stt${backend ? `?backend=${encodeURIComponent(backend)}` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: encodeWavPcm16(chunks, SAMPLE_RATE),
        },
      );
      if (!res.ok) throw new Error(`stt ${res.status}`);
      const json = (await res.json()) as { text?: string };
      const text = json.text?.trim();
      if (!this.closed && text) this.opts.onFinal(text);
    } catch (err) {
      // Non-fatal: one lost turn shouldn't demote the whole session to the
      // Web Speech fallback (unlike a dead realtime socket). Ask again instead.
      if (!this.closed) {
        console.warn(
          `[mistral-stt] batch STT failed (${err instanceof Error ? err.message : "network error"})`,
        );
        this.opts.onPartial("— transcription failed, try again —");
      }
    } finally {
      this.emitting = false;
    }
  }

  private resetTurn(): void {
    this.turnText = "";
    this.turnChunks = [];
    this.turnSamples = 0;
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
    this.vad?.resume();
  }

  /** Pause capturing (call while the assistant is speaking). Drops any
   *  half-formed turn so TTS bleed-through never becomes a user message. */
  pause(): void {
    this.listening = false;
    this.resetTurn();
    this.vad?.pause();
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
    this.vad?.close();
    this.vad = null;
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
