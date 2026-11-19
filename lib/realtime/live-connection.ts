"use client";

// One OPENAI LIVE call's browser side: microphone, WebRTC peer connection,
// `oai-events` data channel, playback element and level analysers.
//
// Each call owns its own instance, so a call still closing gracefully (waiting
// for session.closed) can never touch the call that replaced it. The server
// creates the session (app/api/openai-live/session); the browser only carries
// the media and shows what it hears.
//
// Playback goes straight through an <audio> element so Chrome's echo canceller
// keeps the remote track as its reference; the output analyser reads the remote
// stream passively and is never connected to the speakers.

import type { Lang } from "@/lib/lang";
import { analyserLevel } from "./audio-level";

const ICE_GATHER_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 5000;

/** A data-channel event, loosely typed: only the fields the client reads. */
export interface LiveServerEvent {
  type: string;
  event_id?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  reason?: string;
  delegation?: { id?: string };
  error?: { message?: string; code?: string | null };
}

export interface LiveStartParams {
  personaId?: string;
  lang: Lang;
  /** The visitor's memory id; null skips memory and storage. */
  userId: string | null;
  memory: boolean;
  /** A stored OPENAI LIVE call to continue. */
  resumeId: string | null;
}

export type LiveOpenResult =
  | { ok: true; callId: string | null; greeting: string }
  | { ok: false; caption: string }
  | { ok: false; stale: true };

export interface LiveConnectionHandlers {
  onEvent: (ev: LiveServerEvent) => void;
  /** The connection went away without session.closed. */
  onDrop: () => void;
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    // Past the timeout, send what has been gathered; the server answer still works
    // with partial candidates on most networks.
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onState);
      resolve();
    }
    function onState() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", onState);
  });
}

export class LiveConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private inAnalyser: AnalyserNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private inBuf: Float32Array<ArrayBuffer> | null = null;
  private outBuf: Float32Array<ArrayBuffer> | null = null;
  private disposed = false;
  private closing = false;
  private resolveClosed: (() => void) | null = null;
  private micEnabled = true;

  constructor(private readonly handlers: LiveConnectionHandlers) {}

  /** Connect. `isStale` reports a hang-up or a newer call; setup backs off when it does. */
  async open(params: LiveStartParams, isStale: () => boolean): Promise<LiveOpenResult> {
    const stale = () => this.disposed || isStale();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      return { ok: false, caption: "— microphone permission denied —" };
    }
    if (stale()) return this.backOff();
    this.applyMic();

    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    if (stale()) return this.backOff();
    this.inAnalyser = ctx.createAnalyser();
    this.inAnalyser.fftSize = 1024;
    ctx.createMediaStreamSource(this.stream).connect(this.inAnalyser);
    this.inBuf = new Float32Array(this.inAnalyser.fftSize);

    const pc = new RTCPeerConnection();
    this.pc = pc;
    const audio = document.createElement("audio");
    audio.autoplay = true;
    this.audio = audio;
    pc.ontrack = (e) => {
      const remote = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = remote;
      void audio.play().catch(() => {
        // Autoplay is allowed after the CALL click; nothing to recover here.
      });
      try {
        const out = ctx.createAnalyser();
        out.fftSize = 1024;
        ctx.createMediaStreamSource(remote).connect(out);
        this.outAnalyser = out;
        this.outBuf = new Float32Array(out.fftSize);
      } catch {
        // levels are best-effort
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.dropped();
    };
    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream!));

    // The data channel must exist before the offer.
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (m) => {
      if (this.disposed) return;
      let ev: LiveServerEvent;
      try {
        ev = JSON.parse(typeof m.data === "string" ? m.data : "") as LiveServerEvent;
      } catch {
        return;
      }
      if (ev.type === "session.closed") this.resolveClosed?.();
      this.handlers.onEvent(ev);
    };
    dc.onclose = () => this.dropped();

    let offerSdp: string | undefined;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);
      offerSdp = pc.localDescription?.sdp;
    } catch {
      return { ok: false, caption: "— could not establish WebRTC session —" };
    }
    if (stale()) return this.backOff();
    if (!offerSdp) return { ok: false, caption: "— could not establish WebRTC session —" };

    let data: { sdp?: string; callId?: string | null; greeting?: string; error?: string };
    try {
      const res = await fetch("/api/openai-live/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, sdp: offerSdp }),
      });
      data = (await res.json()) as typeof data;
      if (!res.ok) return { ok: false, caption: `— ${data.error ?? "session error"} —` };
    } catch {
      return { ok: false, caption: "— could not reach session endpoint —" };
    }
    // The session exists upstream but never gets its media; OpenAI ends it,
    // and the server-side capture finalizes an empty record (never listed).
    if (stale()) return this.backOff();
    if (!data.sdp) return { ok: false, caption: "— could not establish WebRTC session —" };
    try {
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    } catch {
      return { ok: false, caption: "— could not establish WebRTC session —" };
    }
    return { ok: true, callId: data.callId ?? null, greeting: data.greeting ?? "" };
  }

  /** A hang-up or newer call landed mid-setup: release what was acquired since. */
  private backOff(): LiveOpenResult {
    this.dispose();
    return { ok: false, stale: true };
  }

  send(ev: Record<string, unknown>): void {
    const dc = this.dc;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(ev));
  }

  setMicEnabled(enabled: boolean): void {
    this.micEnabled = enabled;
    this.applyMic();
  }

  private applyMic(): void {
    // `enabled = false` sends silence: the session keeps running, as GPT-Live expects.
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = this.micEnabled));
  }

  /** Silence playback locally (the model's speech keeps flowing; the analyser still hears it). */
  setOutputMuted(muted: boolean): void {
    if (this.audio) this.audio.muted = muted;
  }

  inputLevel(): number {
    return this.micEnabled ? analyserLevel(this.inAnalyser, this.inBuf) : 0;
  }

  outputLevel(): number {
    return analyserLevel(this.outAnalyser, this.outBuf);
  }

  /**
   * Hang up gracefully: session.close, then wait for session.closed (so the
   * server-side capture finalizes cleanly) or a timeout, then release.
   */
  async close(): Promise<void> {
    if (this.disposed || this.closing) return;
    this.closing = true;
    if (this.dc?.readyState === "open") {
      const closed = new Promise<void>((resolve) => {
        this.resolveClosed = resolve;
        setTimeout(resolve, CLOSE_TIMEOUT_MS);
      });
      this.send({ type: "session.close" });
      // Nothing more should reach the caller while the session drains.
      this.setMicEnabled(false);
      this.setOutputMuted(true);
      await closed;
    }
    this.dispose();
  }

  private dropped(): void {
    if (this.disposed || this.closing) return;
    this.handlers.onDrop();
  }

  /**
   * Release everything. Safe to call again: setup still in flight when a call
   * is hung up acquires resources after the first call, and backOff() releases
   * them with a second one.
   */
  dispose(): void {
    this.disposed = true;
    try {
      this.dc?.close();
    } catch {
      // already closing
    }
    try {
      this.pc?.close();
    } catch {
      // already closing
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audio) this.audio.srcObject = null;
    void this.ctx?.close();
    this.dc = null;
    this.pc = null;
    this.stream = null;
    this.audio = null;
    this.ctx = null;
    this.inAnalyser = null;
    this.outAnalyser = null;
  }
}
