"use client";

// Real xAI Grok voice engine over a DIRECT browser→xAI WebSocket.
//
// Architecture (no relay server): mint an ephemeral client-secret at
// /api/xai/token, then open `wss://api.x.ai/v1/realtime` carrying the token in
// the subprotocol (browsers can't set WS headers). We own the whole audio
// pipeline: mic → PCM16 → `input_audio_buffer.append`; inbound
// `response.output_audio.delta` → PCM16 → AudioBuffer playback. Barge-in is
// server-VAD driven (`input_audio_buffer.speech_started` → stop playback).
//
// Exposes a surface deliberately parallel to @elevenlabs/react's useConversation
// so useRealtimeSession can dispatch to either engine uniformly. Must be called
// unconditionally (rules of hooks); it stays inert until start().

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Persona } from "@/lib/data";
import type { CallState, SessionTurn } from "./types";
import { createMicCapture, type MicCapture } from "./mic-capture";
import { resolveXaiAgent } from "./xai-agent";
import {
  base64Pcm16ToFloat32,
  calculateRms,
  EarlyAudioBuffer,
  float32ToPcm16Base64,
  PlaybackQueue,
} from "./xai-audio";

const REALTIME_BASE = "wss://api.x.ai/v1/realtime";
const CHUNK_MS = 100;
const VOL_GAIN = 3.5;

export interface XaiSession {
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

type XaiEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  error?: { type?: string; code?: string; message?: string };
  item?: { role?: string; content?: Array<{ type?: string; transcript?: string; text?: string }> };
};

function extractToken(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.value === "string") return d.value;
  if (typeof d.token === "string") return d.token;
  if (typeof d.secret === "string") return d.secret;
  const cs = d.client_secret;
  if (typeof cs === "string") return cs;
  if (cs && typeof cs === "object" && typeof (cs as Record<string, unknown>).value === "string") {
    return (cs as Record<string, unknown>).value as string;
  }
  return null;
}

export function useXaiSession(active: boolean, persona?: Persona): XaiSession {
  const [callState, setCallState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [caption, setCaption] = useState("press CALL to begin");

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const playbackRef = useRef<PlaybackQueue | null>(null);
  // Early mic audio captured before the session is configured (parallel init).
  const earlyBufRef = useRef<EarlyAudioBuffer | null>(null);
  // True once `session.updated` arrives: append chunks stream live; until then
  // they accumulate in earlyBufRef.
  const streamingRef = useRef(false);

  const mutedRef = useRef(false);
  const endedRef = useRef(false);
  const configuredRef = useRef(false);
  const inputRmsRef = useRef(0);
  const turnSeqRef = useRef(0);
  const agentTurnIdRef = useRef<string | null>(null);
  const agentBufRef = useRef("");
  const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<CallState>("idle");
  stateRef.current = callState;
  // Latest selected persona, read at start() time (avoids stale closures).
  const personaRef = useRef(persona);
  personaRef.current = persona;

  const teardown = useCallback(() => {
    if (interruptTimerRef.current) {
      clearTimeout(interruptTimerRef.current);
      interruptTimerRef.current = null;
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
    configuredRef.current = false;
    streamingRef.current = false;
    earlyBufRef.current = null;
    agentTurnIdRef.current = null;
    agentBufRef.current = "";
    inputRmsRef.current = 0;
  }, []);

  const send = useCallback((obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const start = useCallback(() => {
    if (stateRef.current !== "idle" && stateRef.current !== "ended") return;
    endedRef.current = false;
    configuredRef.current = false;
    streamingRef.current = false;
    setTurns([]);
    setCallState("connecting");
    setCaption("establishing session…");

    const fail = (msg: string) => {
      endedRef.current = true;
      teardown();
      setCallState("ended");
      setCaption(msg);
    };

    // 1) Bring up audio + mic capture IMMEDIATELY, in parallel with the token
    //    mint + WS connect (xAI "parallel initialization"). Native AudioContext
    //    rate is advertised to xAI so no resampling is needed. Early PCM is
    //    buffered (earlyBufRef) until `session.updated`, then flushed — so the
    //    first words spoken right after CALL aren't lost.
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const rate = ctx.sampleRate;
    playbackRef.current = new PlaybackQueue(ctx);
    earlyBufRef.current = new EarlyAudioBuffer();

    // AudioWorklet-based capture: chunking runs on the realtime audio thread;
    // the main thread only receives finished CHUNK_MS chunks (mic-capture.ts).
    const chunkSize = Math.floor((rate * CHUNK_MS) / 1000);

    const startCapture = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (endedRef.current) {
          // Hung up (or failed) while the mic prompt was open.
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (ctx.state === "suspended") await ctx.resume();
        const capture = await createMicCapture(ctx, stream, chunkSize, (chunk) => {
          inputRmsRef.current = mutedRef.current ? 0 : calculateRms(chunk);
          if (mutedRef.current) return;
          const audio = float32ToPcm16Base64(chunk);
          // Stream live once configured; until then accumulate the early audio.
          if (streamingRef.current) send({ type: "input_audio_buffer.append", audio });
          else earlyBufRef.current?.push(audio);
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

    // Kick capture off now — do not await it, and do not wait for the WS.
    void startCapture();

    void (async () => {
      // 2) Mint the ephemeral client-secret server-side (in parallel with capture).
      let token: string | null = null;
      try {
        const res = await fetch("/api/xai/token", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          fail(`— ${typeof data?.error === "string" ? data.error : "token error"} —`);
          return;
        }
        token = extractToken(data);
      } catch {
        fail("— could not reach token endpoint —");
        return;
      }
      if (!token) {
        fail("— no xAI token returned —");
        return;
      }
      if (endedRef.current) return; // hung up (or mic denied) during fetch

      // ── transcript helpers ──────────────────────────────────────────────
      // The setTurns updaters must stay PURE (no ref mutation inside): React
      // StrictMode double-invokes them, so any id/sequence mutation happens here
      // once, before calling setTurns.
      const pushAgentDelta = (delta: string) => {
        agentBufRef.current += delta;
        const text = agentBufRef.current;
        setCaption(text);
        let id = agentTurnIdRef.current;
        if (id) {
          const tid = id;
          setTurns((prev) => prev.map((t) => (t.id === tid ? { ...t, text } : t)));
        } else {
          id = `x${turnSeqRef.current++}`;
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
      const pushUser = (text: string) => {
        if (!text) return;
        const tid = `x${turnSeqRef.current++}`;
        setTurns((prev) => [...prev, { id: tid, who: "user", text }]);
        setCaption(text);
      };

      // 3) Resolve the active persona's agent config, then open the WS
      //    (token rides the subprotocol since browsers can't set WS headers).
      const agent = resolveXaiAgent(personaRef.current?.id);
      const ws = new WebSocket(`${REALTIME_BASE}?model=${encodeURIComponent(agent.model)}`, [
        `xai-client-secret.${token}`,
      ]);
      wsRef.current = ws;

      const configure = () => {
        if (configuredRef.current) return;
        configuredRef.current = true;
        send({
          type: "session.update",
          session: {
            instructions: agent.instructions,
            voice: agent.voice,
            audio: {
              input: { format: { type: "audio/pcm", rate } },
              output: { format: { type: "audio/pcm", rate } },
            },
            turn_detection: agent.turnDetection,
            tools: agent.tools,
          },
        });
      };

      ws.onmessage = (event) => {
        if (endedRef.current) return; // ignore late events after teardown
        let msg: XaiEvent;
        try {
          msg = JSON.parse(typeof event.data === "string" ? event.data : "") as XaiEvent;
        } catch {
          return;
        }
        switch (msg.type) {
          case "conversation.created":
          case "session.created":
            configure();
            break;
          case "session.updated": {
            // Session is configured: switch capture to live streaming and flush
            // any audio the user already spoke during connect — in order, BEFORE
            // the greeting bootstrap — so their opening words reach the model.
            streamingRef.current = true;
            const buffered = earlyBufRef.current?.drain() ?? [];
            for (const audio of buffered) {
              send({ type: "input_audio_buffer.append", audio });
            }
            setCallState("listening");
            setCaption("listening…");
            // Prompt an opening line so the agent speaks first.
            send({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: agent.firstMessage }],
              },
            });
            send({ type: "response.create" });
            break;
          }
          case "response.output_audio.delta":
            if (msg.delta) {
              playbackRef.current?.enqueue(base64Pcm16ToFloat32(msg.delta));
              if (stateRef.current !== "interrupted") setCallState("speaking");
            }
            break;
          case "response.output_audio_transcript.delta":
            if (msg.delta) pushAgentDelta(msg.delta);
            break;
          case "response.done":
            finalizeAgent();
            if (stateRef.current === "speaking") setCallState("listening");
            break;
          case "input_audio_buffer.speech_started":
            // Server VAD detected the user — barge-in: stop the agent audio.
            playbackRef.current?.stop();
            finalizeAgent();
            setCallState("interrupted");
            if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current);
            interruptTimerRef.current = setTimeout(() => setCallState("listening"), 600);
            break;
          case "input_audio_buffer.committed":
          case "input_audio_buffer.speech_stopped":
            if (stateRef.current === "interrupted") setCallState("listening");
            break;
          case "conversation.item.added":
          case "conversation.item.created": {
            const item = msg.item;
            if (item?.role === "user") {
              const t = item.content?.find((c) => c.transcript || c.text);
              if (t) pushUser((t.transcript ?? t.text ?? "").trim());
            }
            break;
          }
          case "error":
            // Surface but don't kill — a fatal error will also close the socket.
            setCaption(`— ${msg.error?.message ?? "xAI error"} —`);
            break;
          default:
            break;
        }
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
  }, [send, teardown]);

  const stop = useCallback(() => {
    endedRef.current = true;
    teardown();
    setCallState("ended");
    setCaption("— call ended —");
  }, [teardown]);

  const interrupt = useCallback(() => {
    if (stateRef.current !== "speaking") return;
    playbackRef.current?.stop();
    setCallState("interrupted");
    if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current);
    interruptTimerRef.current = setTimeout(() => setCallState("listening"), 600);
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

  // Hang up + reset if the provider is switched away from xAI mid-session.
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

  return useMemo<XaiSession>(
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
