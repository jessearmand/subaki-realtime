"use client";

// Real OpenAI `gpt-realtime-2` voice engine over a browser WebRTC peer connection.
//
// Architecture (no relay server): mint an ephemeral key at /api/openai/token,
// then negotiate WebRTC directly with OpenAI — POST the local SDP offer to
// https://api.openai.com/v1/realtime/calls (Authorization: Bearer <ephemeral>)
// and apply the answer. WebRTC handles ALL audio: the mic track is sent on the
// peer connection and the model's audio arrives on a remote track played by a
// hidden <audio> element. Barge-in truncation is handled server-side. Only
// session control + transcripts ride the `oai-events` data channel.
//
// Surface is deliberately identical to useXaiSession so useRealtimeSession can
// dispatch to either uniformly. Must be called unconditionally (rules of hooks);
// it stays inert until start().

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Persona } from "@/lib/data";
import type { CallState, SessionTurn } from "./types";
import { resolveOpenaiAgent } from "./openai-agent";

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const VOL_GAIN = 3.5;

export interface OpenaiSession {
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

type OpenaiEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  response_id?: string;
  response?: { id?: string };
  error?: { type?: string; code?: string; message?: string };
};

function extractToken(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.value === "string") return d.value;
  if (typeof d.client_secret === "string") return d.client_secret;
  const cs = d.client_secret;
  if (cs && typeof cs === "object" && typeof (cs as Record<string, unknown>).value === "string") {
    return (cs as Record<string, unknown>).value as string;
  }
  return null;
}

/** RMS of an analyser's current time-domain frame, scaled to a 0..1 orb level. */
function analyserLevel(
  analyser: AnalyserNode | null,
  buf: Float32Array<ArrayBuffer> | null,
): number {
  if (!analyser || !buf) return 0;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(sum / buf.length) * VOL_GAIN);
}

export function useOpenaiSession(active: boolean, persona?: Persona): OpenaiSession {
  const [callState, setCallState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [caption, setCaption] = useState("press CALL to begin");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Web Audio analysers for orb levels (WebRTC keeps the audio bytes itself).
  const ctxRef = useRef<AudioContext | null>(null);
  const inAnalyserRef = useRef<AnalyserNode | null>(null);
  const outAnalyserRef = useRef<AnalyserNode | null>(null);
  const outSourceRef = useRef<AudioNode | null>(null);
  const inBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const outBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  const mutedRef = useRef(false);
  const endedRef = useRef(false);
  const configuredRef = useRef(false);
  const greetedRef = useRef(false);

  const turnSeqRef = useRef(0);
  const agentResponseIdRef = useRef<string | null>(null);
  const cancelledAgentResponseIdsRef = useRef<Set<string>>(new Set());
  const suppressAgentDeltasRef = useRef(false);
  const agentTurnIdRef = useRef<string | null>(null);
  const agentBufRef = useRef("");
  const userTurnIdRef = useRef<string | null>(null);
  const userBufRef = useRef("");
  const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<CallState>("idle");
  stateRef.current = callState;
  const personaRef = useRef(persona);
  personaRef.current = persona;

  const teardown = useCallback(() => {
    if (interruptTimerRef.current) {
      clearTimeout(interruptTimerRef.current);
      interruptTimerRef.current = null;
    }
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        // already closing
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // already closing
      }
      pcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    inAnalyserRef.current = null;
    outAnalyserRef.current = null;
    outSourceRef.current = null;
    inBufRef.current = null;
    outBufRef.current = null;
    configuredRef.current = false;
    greetedRef.current = false;
    agentResponseIdRef.current = null;
    cancelledAgentResponseIdsRef.current.clear();
    suppressAgentDeltasRef.current = false;
    agentTurnIdRef.current = null;
    agentBufRef.current = "";
    userTurnIdRef.current = null;
    userBufRef.current = "";
  }, []);

  const send = useCallback((obj: unknown) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(obj));
  }, []);

  // The setTurns updaters must stay PURE (no ref mutation inside): React
  // StrictMode double-invokes them, so id/sequence mutation happens here once.
  const beginAgentResponse = useCallback((responseId?: string) => {
    if (!responseId) return;
    agentResponseIdRef.current = responseId;
    cancelledAgentResponseIdsRef.current.delete(responseId);
    suppressAgentDeltasRef.current = false;
  }, []);

  const shouldAcceptAgentDelta = useCallback((responseId?: string) => {
    if (suppressAgentDeltasRef.current) {
      if (!responseId || cancelledAgentResponseIdsRef.current.has(responseId)) return false;
      suppressAgentDeltasRef.current = false;
    }
    if (responseId && cancelledAgentResponseIdsRef.current.has(responseId)) return false;
    const activeResponseId = agentResponseIdRef.current;
    if (activeResponseId && responseId && activeResponseId !== responseId) return false;
    if (!activeResponseId && responseId) agentResponseIdRef.current = responseId;
    return stateRef.current !== "interrupted" || !!agentTurnIdRef.current;
  }, []);

  const cancelAgentResponse = useCallback(() => {
    const responseId = agentResponseIdRef.current;
    if (responseId) cancelledAgentResponseIdsRef.current.add(responseId);
    agentResponseIdRef.current = null;
    suppressAgentDeltasRef.current = true;
  }, []);

  const pushAgentDelta = useCallback(
    (delta: string, responseId?: string) => {
      if (!shouldAcceptAgentDelta(responseId)) return;
      agentBufRef.current += delta;
      const text = agentBufRef.current;
      setCaption(text);
      let id = agentTurnIdRef.current;
      if (id) {
        const tid = id;
        setTurns((prev) => prev.map((t) => (t.id === tid ? { ...t, text } : t)));
      } else {
        id = `o${turnSeqRef.current++}`;
        agentTurnIdRef.current = id;
        const tid = id;
        setTurns((prev) => [...prev, { id: tid, who: "agent", text, live: true }]);
      }
    },
    [shouldAcceptAgentDelta],
  );

  const finalizeAgent = useCallback((responseId?: string) => {
    if (responseId && cancelledAgentResponseIdsRef.current.has(responseId)) {
      if (agentResponseIdRef.current === responseId) agentResponseIdRef.current = null;
      return;
    }
    const activeResponseId = agentResponseIdRef.current;
    if (responseId && activeResponseId && responseId !== activeResponseId) {
      return;
    }
    const id = agentTurnIdRef.current;
    if (id) setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, live: false } : t)));
    agentResponseIdRef.current = null;
    agentTurnIdRef.current = null;
    agentBufRef.current = "";
  }, []);

  const start = useCallback(() => {
    if (stateRef.current !== "idle" && stateRef.current !== "ended") return;
    endedRef.current = false;
    configuredRef.current = false;
    greetedRef.current = false;
    setTurns([]);
    setCallState("connecting");
    setCaption("establishing session…");

    const fail = (msg: string) => {
      endedRef.current = true;
      teardown();
      setCallState("ended");
      setCaption(msg);
    };

    // ── transcript helpers ──────────────────────────────────────────────
    const pushUserDelta = (delta: string) => {
      userBufRef.current += delta;
      const text = userBufRef.current;
      setCaption(text);
      let id = userTurnIdRef.current;
      if (id) {
        const tid = id;
        setTurns((prev) => prev.map((t) => (t.id === tid ? { ...t, text } : t)));
      } else {
        id = `o${turnSeqRef.current++}`;
        userTurnIdRef.current = id;
        const tid = id;
        setTurns((prev) => [...prev, { id: tid, who: "user", text, live: true }]);
      }
    };
    const finalizeUser = (transcript: string) => {
      const text = transcript.trim();
      const id = userTurnIdRef.current;
      if (id) {
        setTurns((prev) =>
          prev.map((t) => (t.id === id ? { ...t, text: text || t.text, live: false } : t)),
        );
      } else if (text) {
        const tid = `o${turnSeqRef.current++}`;
        setTurns((prev) => [...prev, { id: tid, who: "user", text }]);
      }
      if (text) setCaption(text);
      userTurnIdRef.current = null;
      userBufRef.current = "";
    };

    void (async () => {
      const agent = resolveOpenaiAgent(personaRef.current?.id);

      // 1) Mic capture (also feeds the input analyser for the orb).
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        fail("— microphone permission denied —");
        return;
      }
      if (endedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (mutedRef.current) stream.getAudioTracks().forEach((t) => (t.enabled = false));

      // 2) Analysers — input from the mic, output from the model's remote track.
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const inAnalyser = ctx.createAnalyser();
      inAnalyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(inAnalyser);
      inAnalyserRef.current = inAnalyser;
      inBufRef.current = new Float32Array(inAnalyser.fftSize);

      // 3) Peer connection + remote audio playback.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.setAttribute("playsinline", "true");
      audioEl.setAttribute("webkit-playsinline", "true");
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        const [remote] = e.streams;
        if (!remote) return;
        audioEl.srcObject = remote;
        void audioEl.play().catch(() => {
          // autoplay policy can defer playback; the element remains wired
        });
        // Tap the same media element used for playback. Some browsers expose a
        // silent analyser for raw remote WebRTC streams, so prefer the element
        // route and fall back to the stream route if the graph cannot be built.
        try {
          const outAnalyser = ctx.createAnalyser();
          outAnalyser.fftSize = 1024;
          const outSource = ctx.createMediaElementSource(audioEl);
          outSource.connect(outAnalyser);
          outAnalyser.connect(ctx.destination);
          outSourceRef.current = outSource;
          outAnalyserRef.current = outAnalyser;
          outBufRef.current = new Float32Array(outAnalyser.fftSize);
        } catch {
          try {
            const outAnalyser = ctx.createAnalyser();
            outAnalyser.fftSize = 1024;
            ctx.createMediaStreamSource(remote).connect(outAnalyser);
            outAnalyserRef.current = outAnalyser;
            outBufRef.current = new Float32Array(outAnalyser.fftSize);
          } catch {
            // analyser is best-effort; playback still works without it
          }
        }
      };
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // 4) Data channel for session control + transcript events.
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      const configure = () => {
        if (configuredRef.current) return;
        configuredRef.current = true;
        // Voice is locked after the first audio output, so set it now, before any
        // response. reasoning.effort nests under session, per the lifecycle docs.
        send({
          type: "session.update",
          session: {
            type: "realtime",
            model: agent.model,
            output_modalities: ["audio"],
            instructions: agent.instructions,
            audio: {
              input: {
                turn_detection: agent.turnDetection,
                transcription: agent.transcription,
              },
              output: { voice: agent.voice },
            },
            reasoning: { effort: agent.reasoningEffort },
          },
        });
      };

      const greet = () => {
        if (greetedRef.current) return;
        greetedRef.current = true;
        setCallState("listening");
        setCaption("listening…");
        send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: agent.firstMessage }],
          },
        });
        send({ type: "response.create" });
      };

      dc.onopen = () => {
        if (endedRef.current) return;
        configure();
      };

      dc.onmessage = (event) => {
        if (endedRef.current) return;
        let msg: OpenaiEvent;
        try {
          msg = JSON.parse(typeof event.data === "string" ? event.data : "") as OpenaiEvent;
        } catch {
          return;
        }
        switch (msg.type) {
          case "session.created":
            configure();
            break;
          case "session.updated":
            greet();
            break;
          case "response.created":
            beginAgentResponse(msg.response?.id ?? msg.response_id);
            if (stateRef.current !== "interrupted") setCallState("speaking");
            break;
          case "response.output_audio_transcript.delta":
            if (msg.delta) {
              if (stateRef.current !== "interrupted") setCallState("speaking");
              pushAgentDelta(msg.delta, msg.response_id);
            }
            break;
          case "response.done":
            finalizeAgent(msg.response?.id ?? msg.response_id);
            if (stateRef.current === "speaking") setCallState("listening");
            break;
          case "input_audio_buffer.speech_started":
            // Server VAD detected the user — server truncates the model audio for
            // us on WebRTC; reflect the barge-in in the UI.
            cancelAgentResponse();
            finalizeAgent();
            setCallState("interrupted");
            if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current);
            interruptTimerRef.current = setTimeout(() => setCallState("listening"), 600);
            break;
          case "input_audio_buffer.speech_stopped":
          case "input_audio_buffer.committed":
            if (stateRef.current === "interrupted") setCallState("listening");
            break;
          case "conversation.item.input_audio_transcription.delta":
            if (msg.delta) pushUserDelta(msg.delta);
            break;
          case "conversation.item.input_audio_transcription.completed":
            finalizeUser(msg.transcript ?? "");
            break;
          case "error":
            setCaption(`— ${msg.error?.message ?? "OpenAI error"} —`);
            break;
          default:
            break;
        }
      };

      // 5) Mint the ephemeral key, then exchange SDP with OpenAI.
      let token: string | null = null;
      try {
        const res = await fetch("/api/openai/token", { method: "POST" });
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
        fail("— no OpenAI token returned —");
        return;
      }
      if (endedRef.current) return;

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(CALLS_URL, {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
        });
        if (!sdpRes.ok) {
          fail(`— OpenAI call setup failed (${sdpRes.status}) —`);
          return;
        }
        const answer: RTCSessionDescriptionInit = { type: "answer", sdp: await sdpRes.text() };
        if (endedRef.current) return;
        await pc.setRemoteDescription(answer);
      } catch {
        fail("— could not establish WebRTC session —");
        return;
      }
    })();
  }, [beginAgentResponse, cancelAgentResponse, finalizeAgent, pushAgentDelta, send, teardown]);

  const stop = useCallback(() => {
    endedRef.current = true;
    teardown();
    setCallState("ended");
    setCaption("— call ended —");
  }, [teardown]);

  const interrupt = useCallback(() => {
    if (stateRef.current !== "speaking") return;
    // Cancel the in-progress response and clear any unplayed server audio.
    send({ type: "response.cancel" });
    send({ type: "output_audio_buffer.clear" });
    cancelAgentResponse();
    finalizeAgent();
    setCallState("interrupted");
    if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current);
    interruptTimerRef.current = setTimeout(() => setCallState("listening"), 600);
  }, [cancelAgentResponse, finalizeAgent, send]);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, []);

  const getInputVolume = useCallback(() => {
    if (mutedRef.current) return 0;
    return analyserLevel(inAnalyserRef.current, inBufRef.current);
  }, []);
  const getOutputVolume = useCallback(
    () => analyserLevel(outAnalyserRef.current, outBufRef.current),
    [],
  );

  // Hang up + reset if the provider is switched away from OpenAI mid-session.
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

  return useMemo<OpenaiSession>(
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
