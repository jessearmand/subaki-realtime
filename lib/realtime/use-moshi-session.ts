"use client";

// Real PersonaPlex full-duplex voice engine against the LOCAL MLX server
// (personaplex-mlx `local_web`, our fork) over a direct browser→localhost
// WebSocket. Mirrors useFalSession — same model, different serving stack — so
// an A/B between them varies only the transport.
//
// Protocol (see the fork's README): binary frames, first byte is a tag —
// 0x00 handshake (server ready; prompts stepped), 0x01 audio, 0x02 agent text
// token. With `format=pcm` the 0x01 frames carry raw PCM16 LE @ 24kHz both
// ways (no codec). Config rides the connect URL's query params (moshi-agent).
//
// Full-duplex consequences (identical to the fal engine):
//   - The model speaks FIRST — no greeting bootstrap; no VAD or turn events;
//     `interrupt()` just stops local playback (barge-in is native — talk).
//   - No user-side transcript; agent transcript streams as text tokens.
//   - The model's steps are INPUT-DRIVEN: mic chunks must flow continuously
//     from the handshake on (silence while muted), or generation stalls.
//   - The greeting mic-gate lives SERVER-side in our fork (on by default), so
//     unlike the fal engine there is no client gate — but autoGainControl
//     stays off so room tone isn't amplified into "speech" mid-conversation.
//
// Exposes the same surface as useFalSession/useXaiSession so
// useRealtimeSession dispatches uniformly. Called unconditionally (rules of
// hooks); inert until start().

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Persona } from "@/lib/data";
import type { CallState, SessionTurn } from "./types";
import { createMicCapture, type MicCapture } from "./mic-capture";
import { resolveMoshiAgent } from "./moshi-agent";
import { ScheduledPlaybackQueue } from "./scheduled-playback";
import { calculateRms, float32ToPcm16Bytes, pcm16BytesToFloat32 } from "./xai-audio";

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

// Frame tags (first payload byte) of the local server's WS protocol.
const TAG_HANDSHAKE = 0x00;
const TAG_AUDIO = 0x01;
const TAG_TEXT = 0x02;

export interface MoshiSession {
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

export function useMoshiSession(active: boolean, persona?: Persona): MoshiSession {
  const [callState, setCallState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [caption, setCaption] = useState("press CALL to begin");

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const playbackRef = useRef<ScheduledPlaybackQueue | null>(null);

  const mutedRef = useRef(false);
  const endedRef = useRef(false);
  // True once the 0x00 handshake arrives — mic chunks stream from then on.
  const handshakeRef = useRef(false);
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
    handshakeRef.current = false;
    agentTurnIdRef.current = null;
    agentBufRef.current = "";
    inputRmsRef.current = 0;
  }, []);

  const start = useCallback(() => {
    if (stateRef.current !== "idle" && stateRef.current !== "ended") return;
    endedRef.current = false;
    handshakeRef.current = false;
    setTurns([]);
    setCallState("connecting");
    setCaption("waking the local model…");

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

    const sendAudio = (pcm: Uint8Array) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const framed = new Uint8Array(1 + pcm.length);
      framed[0] = TAG_AUDIO;
      framed.set(pcm, 1);
      ws.send(framed);
    };

    // Silence for one mic chunk — sent while muted so the model's input-driven
    // clock never stops (its steps consume exactly the frames we send).
    const silentChunk = new Uint8Array(CHUNK_SAMPLES * 2);

    // ── mic capture (starts in parallel with the WS connect) ────────────────
    // AudioWorklet-based: chunking runs on the realtime audio thread; the main
    // thread only receives finished CHUNK_SAMPLES chunks (see mic-capture.ts).
    const startCapture = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            // AGC amplifies room tone into "speech"; the full-duplex model
            // would yield to it mid-conversation. Keep it off. (The greeting
            // window itself is protected by the server-side gate.)
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
          // Until the handshake the server hasn't stepped the prompts — drop
          // mic audio rather than queueing a backlog it would burn through.
          if (!handshakeRef.current) return;
          sendAudio(mutedRef.current ? silentChunk : float32ToPcm16Bytes(chunk));
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

    // ── transcript helpers (setTurns updaters stay PURE — StrictMode) ────────
    const pushAgentDelta = (delta: string) => {
      agentBufRef.current += delta;
      const text = agentBufRef.current;
      setCaption(text);
      let id = agentTurnIdRef.current;
      if (id) {
        const tid = id;
        setTurns((prev) => prev.map((t) => (t.id === tid ? { ...t, text } : t)));
      } else {
        id = `m${turnSeqRef.current++}`;
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

    const agent = resolveMoshiAgent(personaRef.current?.id);
    const ws = new WebSocket(agent.url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (endedRef.current || typeof event.data === "string") return;
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes.length === 0) return;
      switch (bytes[0]) {
        case TAG_HANDSHAKE:
          // Server has stepped the prompts — start streaming; the model
          // greets first, so the user is "listening" from the start.
          handshakeRef.current = true;
          setCallState("listening");
          setCaption("listening…");
          break;
        case TAG_AUDIO: {
          const chunk = pcm16BytesToFloat32(bytes.subarray(1));
          if (chunk.length === 0) break;
          playbackRef.current?.enqueue(chunk);
          // Full-duplex: no turn events — derive speaking/listening from
          // output voicing, holding through the model's word-by-word pad gaps.
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
          break;
        }
        case TAG_TEXT:
          pushAgentDelta(new TextDecoder().decode(bytes.subarray(1)));
          break;
        default:
          break; // 0x06 ping and anything newer
      }
    };

    ws.onerror = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      teardown();
      setCallState("ended");
      setCaption("— local server unreachable (mise run personaplex-local) —");
    };

    ws.onclose = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      teardown();
      setCallState("ended");
      setCaption("— call ended —");
    };
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

  // Hang up + reset if the provider is switched away mid-session.
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

  return useMemo<MoshiSession>(
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
