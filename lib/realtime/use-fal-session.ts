"use client";

// Real PersonaPlex full-duplex voice engine over a DIRECT browser→fal.ai
// WebSocket (no fal SDK — same direct-socket pattern as useXaiSession).
//
// Architecture: mint a short-lived JWT at /api/fal/token, then open
// `wss://fal.run/fal-ai/personaplex/realtime?fal_jwt_token=…`. Transport is
// MSGPACK binary frames both ways (verified by probe — the server silently
// ignores JSON text frames): we send `{audio: <raw PCM16 bytes>, …config}`
// continuously; the server streams back `{audio: <raw PCM16 bytes>, text}`.
//
// Full-duplex consequences (PersonaPlex is a Moshi-style model that listens
// while it speaks — see docs/personaplex-local-inference.md):
//   - The model speaks FIRST (trained to open the call) — no greeting bootstrap.
//   - There is no server VAD and no turn events: `interrupt()` is a no-op
//     (barge-in is native — just talk), and callState is derived from output
//     audio activity.
//   - No user-side transcript (no ASR anywhere in the path); the agent
//     transcript streams as inner-monologue text tokens.
//   - The mic is GATED to silence during the opening greeting (GreetingGate),
//     and autoGainControl is off, so room noise can't make the model interrupt
//     its own greeting. Muting likewise sends zeros — the input timeline must
//     stay continuous.
//   - Audio is fixed 24kHz PCM16 both ways: the AudioContext is constructed at
//     24kHz and the browser resamples mic/speaker at the edges.
//
// Exposes the same surface as useXaiSession so useRealtimeSession dispatches
// uniformly. Must be called unconditionally (rules of hooks); inert until start().

import { decode, encode } from "@msgpack/msgpack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Persona } from "@/lib/data";
import { GreetingGate } from "./greeting-gate";
import type { CallState, SessionTurn } from "./types";
import { createMicCapture, type MicCapture } from "./mic-capture";
import { resolveFalAgent } from "./fal-agent";
import { ScheduledPlaybackQueue } from "./scheduled-playback";
import { calculateRms, float32ToPcm16Bytes, pcm16BytesToFloat32 } from "./xai-audio";

const REALTIME_BASE = "wss://fal.run";
/** PersonaPlex is fixed at 24kHz mono PCM both directions. */
const SAMPLE_RATE = 24000;
/** One Mimi frame is 80ms — align mic chunks to the model's step size. */
const CHUNK_SAMPLES = 1920;
const VOL_GAIN = 3.5;
/** Output RMS above this counts as the agent audibly speaking. */
const VOICED_RMS = 0.01;
/** Keep "speaking" through pad-token gaps shorter than this (halting cadence). */
const SPEAKING_HOLD_MS = 700;
/** Finalize the agent's transcript turn after this much output quiet. */
const TURN_QUIET_MS = 1500;

export interface FalSession {
  callState: CallState;
  turns: SessionTurn[];
  caption: string;
  start: () => void;
  stop: () => void;
  interrupt: () => void;
  setMuted: (muted: boolean) => void;
  getInputVolume: () => number;
  getOutputVolume: () => number;
}

type FalResult = {
  type?: string;
  status?: string;
  error?: string;
  reason?: string;
  /** Raw PCM16 bytes in msgpack transport (base64 string only in JSON fallback). */
  audio?: Uint8Array | string;
  text?: string;
};

export function useFalSession(active: boolean, persona?: Persona): FalSession {
  const [callState, setCallState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [caption, setCaption] = useState("press CALL to begin");

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const playbackRef = useRef<ScheduledPlaybackQueue | null>(null);
  const gateRef = useRef<GreetingGate | null>(null);

  const mutedRef = useRef(false);
  const endedRef = useRef(false);
  const inputRmsRef = useRef(0);
  const turnSeqRef = useRef(0);
  const agentTurnIdRef = useRef<string | null>(null);
  const agentBufRef = useRef("");
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<CallState>("idle");
  stateRef.current = callState;
  // Latest selected persona, read at start() time (avoids stale closures).
  const personaRef = useRef(persona);
  personaRef.current = persona;

  const teardown = useCallback(() => {
    if (speakingTimerRef.current) {
      clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    if (captureRef.current) {
      captureRef.current.stop();
      captureRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (playbackRef.current) {
      playbackRef.current.stop();
      playbackRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // already closing
      }
      wsRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    gateRef.current = null;
    agentTurnIdRef.current = null;
    agentBufRef.current = "";
    inputRmsRef.current = 0;
  }, []);

  const start = useCallback(() => {
    if (stateRef.current !== "idle" && stateRef.current !== "ended") return;
    endedRef.current = false;
    setTurns([]);
    setCallState("connecting");
    setCaption("establishing session…");

    const fail = (msg: string) => {
      endedRef.current = true;
      teardown();
      setCallState("ended");
      setCaption(msg);
    };

    // Everything runs at the model's native 24kHz: the browser resamples the
    // mic into this context and the speakers out of it, so no manual SRC.
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    ctxRef.current = ctx;
    playbackRef.current = new ScheduledPlaybackQueue(ctx);
    gateRef.current = new GreetingGate(SAMPLE_RATE);

    const agent = resolveFalAgent(personaRef.current?.id);
    // Optional-with-default schema: an omitted field means fal's DEFAULT, not
    // "keep the previous value" — so the persona config rides on EVERY message.
    const config = {
      prompt: agent.prompt,
      voice: agent.voice,
      temperature_text: agent.temperatureText,
      temperature_audio: agent.temperatureAudio,
      top_k_text: agent.topKText,
      top_k_audio: agent.topKAudio,
    };

    const sendAudio = (audio: Uint8Array) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encode({ ...config, audio }));
    };

    // Silence for one mic chunk — sent while the greeting gate is closed or the
    // user is muted, so the model's input timeline never has holes.
    const silentChunk = new Uint8Array(CHUNK_SAMPLES * 2);

    // ── mic capture (starts in parallel with the token mint + WS connect) ────
    // AudioWorklet-based: chunking runs on the realtime audio thread; the main
    // thread only receives finished CHUNK_SAMPLES chunks (see mic-capture.ts).
    const startCapture = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            // AGC amplifies room tone into "speech" during the greeting window;
            // the full-duplex model would yield to it. Keep it off.
            autoGainControl: false,
          },
        });
        if (endedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (ctx.state === "suspended") await ctx.resume();
        const capture = await createMicCapture(ctx, stream, CHUNK_SAMPLES, (chunk) => {
          inputRmsRef.current = mutedRef.current ? 0 : calculateRms(chunk);
          // Gate closed or muted ⇒ ship silence in the chunk's place.
          const gated = !(gateRef.current?.isOpen ?? true) || mutedRef.current;
          sendAudio(gated ? silentChunk : float32ToPcm16Bytes(chunk));
        });
        if (endedRef.current) {
          // Hung up while the worklet module loaded.
          capture.stop();
          return;
        }
        captureRef.current = capture;
      } catch {
        fail("— microphone permission denied —");
      }
    };
    void startCapture();

    void (async () => {
      // Mint the ephemeral JWT server-side (in parallel with capture).
      let token: string | null = null;
      try {
        const res = await fetch("/api/fal/token", { method: "POST" });
        const data: unknown = await res.json();
        if (!res.ok) {
          const err = (data as Record<string, unknown> | null)?.error;
          fail(`— ${typeof err === "string" ? err : "token error"} —`);
          return;
        }
        const t = (data as Record<string, unknown> | null)?.token;
        if (typeof t === "string") token = t;
      } catch {
        fail("— could not reach token endpoint —");
        return;
      }
      if (!token) {
        fail("— no fal token returned —");
        return;
      }
      if (endedRef.current) return; // hung up (or mic denied) during fetch

      // ── transcript helpers (setTurns updaters stay PURE — StrictMode) ──────
      const pushAgentDelta = (delta: string) => {
        agentBufRef.current += delta;
        const text = agentBufRef.current;
        setCaption(text);
        let id = agentTurnIdRef.current;
        if (id) {
          const tid = id;
          setTurns((prev) => prev.map((t) => (t.id === tid ? { ...t, text } : t)));
        } else {
          id = `f${turnSeqRef.current++}`;
          agentTurnIdRef.current = id;
          const tid = id;
          setTurns((prev) => [...prev, { id: tid, who: "agent", text, live: true }]);
        }
      };
      const finalizeAgent = () => {
        const id = agentTurnIdRef.current;
        if (id) setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, live: false } : t)));
        agentTurnIdRef.current = null;
        agentBufRef.current = "";
      };

      const ws = new WebSocket(
        `${REALTIME_BASE}/${agent.appId}/realtime?fal_jwt_token=${encodeURIComponent(token)}`,
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (endedRef.current) return;
        // Kick the session with the persona config; the model greets first,
        // so the user is "listening" from the start.
        sendAudio(new Uint8Array(0));
        setCallState("listening");
        setCaption("listening…");
      };

      const handleResult = (msg: FalResult) => {
        if (msg.status === "error" || msg.type === "x-fal-error") {
          // Auth/app errors are fatal (fal closes the socket after most).
          setCaption(`— ${msg.reason ?? msg.error ?? "fal error"} —`);
          return;
        }
        if (typeof msg.type === "string" && msg.type.startsWith("x-fal-")) return; // control chatter
        if (msg.text) pushAgentDelta(msg.text);
        if (msg.audio && msg.audio.length > 0) {
          // msgpack carries the PCM as raw bytes; tolerate a base64 string too.
          const chunk =
            typeof msg.audio === "string"
              ? pcm16BytesToFloat32(Uint8Array.from(atob(msg.audio), (c) => c.charCodeAt(0)))
              : pcm16BytesToFloat32(msg.audio);
          gateRef.current?.observeOutput(chunk);
          playbackRef.current?.enqueue(chunk);
          // Full-duplex: no turn events — derive speaking/listening from output
          // voicing, holding through the model's word-by-word pad gaps.
          if (calculateRms(chunk) >= VOICED_RMS) {
            setCallState("speaking");
            if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
            speakingTimerRef.current = setTimeout(() => {
              if (!endedRef.current) setCallState("listening");
            }, SPEAKING_HOLD_MS);
            if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
            turnTimerRef.current = setTimeout(() => {
              if (!endedRef.current) finalizeAgent();
            }, TURN_QUIET_MS);
          }
        }
      };

      ws.onmessage = (event) => {
        if (endedRef.current) return;
        let msg: FalResult;
        try {
          msg =
            typeof event.data === "string"
              ? (JSON.parse(event.data) as FalResult)
              : (decode(new Uint8Array(event.data as ArrayBuffer)) as FalResult);
        } catch {
          return; // frame we don't understand
        }
        handleResult(msg);
      };

      ws.onerror = () => {
        if (endedRef.current) return;
        endedRef.current = true;
        teardown();
        setCallState("ended");
        setCaption("— connection error —");
      };

      ws.onclose = () => {
        if (endedRef.current) return;
        endedRef.current = true;
        teardown();
        setCallState("ended");
        setCaption("— call ended —");
      };
    })();
  }, [teardown]);

  const stop = useCallback(() => {
    endedRef.current = true;
    teardown();
    setCallState("ended");
    setCaption("— call ended —");
  }, [teardown]);

  // Full-duplex: the model yields to speech natively — just talk over it.
  // Stop local playback so the button still feels responsive.
  const interrupt = useCallback(() => {
    if (stateRef.current !== "speaking") return;
    playbackRef.current?.stop();
    setCallState("listening");
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    if (muted) inputRmsRef.current = 0;
  }, []);

  const getInputVolume = useCallback(() => Math.min(1, inputRmsRef.current * VOL_GAIN), []);
  const getOutputVolume = useCallback(
    () => Math.min(1, (playbackRef.current?.level ?? 0) * VOL_GAIN),
    [],
  );

  // Hang up + reset if the provider is switched away from fal mid-session.
  useEffect(() => {
    if (active) return;
    if (stateRef.current !== "idle") {
      endedRef.current = true;
      teardown();
      setCallState("idle");
      setTurns([]);
      setCaption("press CALL to begin");
    }
  }, [active, teardown]);

  // Cleanup on unmount.
  useEffect(() => () => teardown(), [teardown]);

  return useMemo<FalSession>(
    () => ({
      callState,
      turns,
      caption,
      start,
      stop,
      interrupt,
      setMuted,
      getInputVolume,
      getOutputVolume,
    }),
    [callState, turns, caption, start, stop, interrupt, setMuted, getInputVolume, getOutputVolume],
  );
}
