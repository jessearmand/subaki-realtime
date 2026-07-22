"use client";

// Real Gemini Live voice engine over a DIRECT browser→Google WebSocket.
//
// Architecture (no relay server, mirrors use-xai-session): mint a single-use
// ephemeral auth token at /api/gemini/token, then open the v1alpha
// `BidiGenerateContentConstrained` WebSocket with `?access_token=<token>`
// (ephemeral tokens are v1alpha-only; the raw-key v1beta endpoint would expose
// GEMINI_API_KEY). We own the whole audio pipeline: mic → PCM16 →
// `realtimeInput.audio`; inbound `serverContent.modelTurn` inlineData → PCM16 →
// AudioBuffer playback. Barge-in is server-VAD driven (`serverContent.interrupted`
// → stop playback).
//
// Protocol differences from the OpenAI/xAI dialect that shape this file:
//  - One server message can carry SEVERAL fields at once (audio + transcription
//    + turnComplete) — every field is checked independently, never else-if.
//  - Input audio declares its true rate in the MIME type and Google resamples;
//    output audio is FIXED at 24 kHz, so PlaybackQueue gets an explicit rate.
//  - Transcripts stream as inputTranscription/outputTranscription fragments,
//    not as discrete conversation items.
//
// Exposes the same surface as useXaiSession so useRealtimeSession can dispatch
// to either engine uniformly. Must be called unconditionally (rules of hooks);
// it stays inert until start().

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Persona } from "@/lib/data";
import type { CallState, SessionTurn } from "./types";
import { createMicCapture, type MicCapture } from "./mic-capture";
import { resolveGeminiAgent } from "./gemini-agent";
import {
  base64Pcm16ToFloat32,
  calculateRms,
  EarlyAudioBuffer,
  float32ToPcm16Base64,
  PlaybackQueue,
} from "./xai-audio";

const REALTIME_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
// Gemini Live always emits 24 kHz PCM16 regardless of the input rate.
const OUTPUT_RATE = 24_000;
const CHUNK_MS = 100;
const VOL_GAIN = 3.5;

export interface GeminiSession {
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

type GeminiServerMessage = {
  setupComplete?: Record<string, unknown>;
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string }; text?: string }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    generationComplete?: boolean;
    turnComplete?: boolean;
  };
  goAway?: { timeLeft?: string };
};

export function useGeminiSession(active: boolean, persona?: Persona): GeminiSession {
  const [callState, setCallState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [caption, setCaption] = useState("press CALL to begin");

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const playbackRef = useRef<PlaybackQueue | null>(null);
  // Early mic audio captured before setupComplete (parallel init).
  const earlyBufRef = useRef<EarlyAudioBuffer | null>(null);
  // True once `setupComplete` arrives: append chunks stream live; until then
  // they accumulate in earlyBufRef.
  const streamingRef = useRef(false);

  const mutedRef = useRef(false);
  const endedRef = useRef(false);
  const inputRmsRef = useRef(0);
  const turnSeqRef = useRef(0);
  const agentTurnIdRef = useRef<string | null>(null);
  const agentBufRef = useRef("");
  const userTurnIdRef = useRef<string | null>(null);
  const userBufRef = useRef("");
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
    streamingRef.current = false;
    earlyBufRef.current = null;
    agentTurnIdRef.current = null;
    agentBufRef.current = "";
    userTurnIdRef.current = null;
    userBufRef.current = "";
    inputRmsRef.current = 0;
  }, []);

  const send = useCallback((obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const start = useCallback(() => {
    if (stateRef.current !== "idle" && stateRef.current !== "ended") return;
    endedRef.current = false;
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
    //    mint + WS connect. The native AudioContext rate is declared to Gemini
    //    in the audio MIME type ("any sample rate can be sent" — Google
    //    resamples to 16 kHz), so no client-side resampling is needed. Early
    //    PCM is buffered (earlyBufRef) until `setupComplete`, then flushed —
    //    so the first words spoken right after CALL aren't lost.
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const rate = ctx.sampleRate;
    playbackRef.current = new PlaybackQueue(ctx, OUTPUT_RATE);
    earlyBufRef.current = new EarlyAudioBuffer();

    const chunkSize = Math.floor((rate * CHUNK_MS) / 1000);
    const inputMime = `audio/pcm;rate=${rate}`;

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
          if (streamingRef.current) {
            send({ realtimeInput: { audio: { mimeType: inputMime, data: audio } } });
          } else {
            earlyBufRef.current?.push(audio);
          }
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
      // 2) Mint the single-use ephemeral token server-side (in parallel with capture).
      let token: string | null = null;
      try {
        const res = await fetch("/api/gemini/token", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          fail(`— ${typeof data?.error === "string" ? data.error : "token error"} —`);
          return;
        }
        if (typeof data?.token === "string") token = data.token;
      } catch {
        fail("— could not reach token endpoint —");
        return;
      }
      if (!token) {
        fail("— no Gemini token returned —");
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
          id = `g${turnSeqRef.current++}`;
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
      // User speech streams in as inputTranscription fragments — accumulate a
      // live turn and finalize it once the model starts (or completes) a reply.
      const pushUserDelta = (delta: string) => {
        userBufRef.current += delta;
        const text = userBufRef.current;
        setCaption(text);
        let id = userTurnIdRef.current;
        if (id) {
          const tid = id;
          setTurns((prev) => prev.map((t) => (t.id === tid ? { ...t, text } : t)));
        } else {
          id = `g${turnSeqRef.current++}`;
          userTurnIdRef.current = id;
          const tid = id;
          setTurns((prev) => [...prev, { id: tid, who: "user", text, live: true }]);
        }
      };
      const finalizeUser = () => {
        const id = userTurnIdRef.current;
        if (id) setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, live: false } : t)));
        userTurnIdRef.current = null;
        userBufRef.current = "";
      };

      // 3) Resolve the active persona's agent config, then open the WS
      //    (the ephemeral token rides the access_token query param).
      const agent = resolveGeminiAgent(personaRef.current?.id);
      const ws = new WebSocket(`${REALTIME_URL}?access_token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (endedRef.current) return;
        // First message MUST be setup; the session is live on `setupComplete`.
        send({
          setup: {
            model: `models/${agent.model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: agent.voice } },
              },
            },
            systemInstruction: { parts: [{ text: agent.instructions }] },
            realtimeInputConfig: {
              automaticActivityDetection: { ...agent.activityDetection },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{ googleSearch: {} }],
          },
        });
      };

      const handleMessage = (msg: GeminiServerMessage) => {
        if (msg.setupComplete) {
          // Session is configured: switch capture to live streaming and flush
          // any audio the user already spoke during connect — in order, BEFORE
          // the greeting bootstrap — so their opening words reach the model.
          streamingRef.current = true;
          const buffered = earlyBufRef.current?.drain() ?? [];
          for (const audio of buffered) {
            send({ realtimeInput: { audio: { mimeType: inputMime, data: audio } } });
          }
          setCallState("listening");
          setCaption("listening…");
          // Prompt an opening line so the agent speaks first (realtimeInput
          // text is the only in-conversation text channel on Gemini Live).
          send({ realtimeInput: { text: agent.firstMessage } });
          return;
        }

        if (msg.goAway) {
          setCaption("— session ending soon —");
          return;
        }

        // A single serverContent can bundle audio, transcriptions, and turn
        // flags — every field is handled independently, never else-if.
        const content = msg.serverContent;
        if (!content) return;

        if (content.interrupted) {
          // Server VAD detected the user over the agent — barge-in.
          playbackRef.current?.stop();
          finalizeAgent();
          setCallState("interrupted");
          if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current);
          interruptTimerRef.current = setTimeout(() => setCallState("listening"), 600);
        }

        const parts = content.modelTurn?.parts;
        if (parts?.length) {
          // The model is replying — the user's turn (if any) is complete.
          if (userTurnIdRef.current) finalizeUser();
          for (const part of parts) {
            if (part.inlineData?.data) {
              playbackRef.current?.enqueue(base64Pcm16ToFloat32(part.inlineData.data));
              if (stateRef.current !== "interrupted") setCallState("speaking");
            }
          }
        }

        if (content.outputTranscription?.text) {
          if (userTurnIdRef.current) finalizeUser();
          pushAgentDelta(content.outputTranscription.text);
        }
        if (content.inputTranscription?.text) {
          pushUserDelta(content.inputTranscription.text);
        }

        if (content.turnComplete) {
          finalizeAgent();
          finalizeUser();
          if (stateRef.current === "speaking") setCallState("listening");
        }
      };

      // Frames may arrive as Blob/ArrayBuffer; decode async but process IN
      // ORDER via a promise chain (out-of-order audio deltas would glitch).
      let parseChain: Promise<void> = Promise.resolve();
      ws.onmessage = (event) => {
        const data = event.data;
        parseChain = parseChain.then(async () => {
          if (endedRef.current) return; // ignore late events after teardown
          let raw: string;
          if (typeof data === "string") raw = data;
          else if (data instanceof Blob) raw = await data.text();
          else if (data instanceof ArrayBuffer) raw = new TextDecoder().decode(data);
          else return;
          let msg: GeminiServerMessage;
          try {
            msg = JSON.parse(raw) as GeminiServerMessage;
          } catch {
            return;
          }
          handleMessage(msg);
        });
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

  // Hang up + reset if the provider is switched away from Gemini mid-session.
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

  return useMemo<GeminiSession>(
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
