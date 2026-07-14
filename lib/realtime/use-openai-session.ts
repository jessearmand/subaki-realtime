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
import { FIRECRAWL_TOOL_GUIDANCE, firecrawlMcpTool, resolveOpenaiAgent } from "./openai-agent";
import type { RealtimeToolConfig } from "./openai-agent";

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
  /** Conversation item payload (MCP tool listing / approval / call items). */
  item?: {
    id?: string;
    type?: string;
    name?: string;
    server_label?: string;
  };
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

export function useOpenaiSession(
  active: boolean,
  persona?: Persona,
  /**
   * Voice barge-in (settings INTERRUPTIONS): overrides the VAD presets'
   * `interrupt_response`. Default off — echo-safe on speaker+mic setups;
   * headphone users opt in to interrupt the agent by speaking.
   */
  bargeIn: boolean = false,
): OpenaiSession {
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
  const inBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const outBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  const mutedRef = useRef(false);
  // Half-duplex gate: with barge-in off, the mic track is silenced while agent
  // audio is playing so speaker leak can't reach the model at all.
  const micGatedRef = useRef(false);
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
  const bargeInRef = useRef(bargeIn);
  bargeInRef.current = bargeIn;

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
    inBufRef.current = null;
    outBufRef.current = null;
    configuredRef.current = false;
    greetedRef.current = false;
    micGatedRef.current = false;
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

  // User mute and the half-duplex gate compose onto the one mic track.
  // `enabled = false` makes WebRTC transmit silence — instant, no renegotiation.
  const applyMicEnabled = useCallback(() => {
    const enabled = !mutedRef.current && !micGatedRef.current;
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }, []);

  const setMicGated = useCallback(
    (gated: boolean) => {
      micGatedRef.current = gated;
      applyMicEnabled();
    },
    [applyMicEnabled],
  );

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
    // A delta that survived the cancelled/suppress/id checks above belongs to a
    // live response — accept it even while the UI sits in the brief
    // "interrupted" window, or a fast reply after a barge-in loses its leading
    // text. Only unattributed deltas (no response id and no open turn) are
    // ambiguous enough to drop there: they may be the cancelled response's tail.
    if (stateRef.current !== "interrupted") return true;
    return !!responseId || !!agentTurnIdRef.current;
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

      // 0) Kick off the Firecrawl MCP token fetch now; awaited before the SDP
      // exchange so `configure()` (data-channel open, which is later still)
      // sees the resolved value. Tools are strictly optional — any failure
      // (or the OAuth flow never having been run) degrades to a no-tools call.
      const firecrawlAuthPromise: Promise<string | null> = fetch("/api/firecrawl/token", {
        method: "POST",
      })
        .then(async (res) => {
          if (!res.ok) return null;
          const data = (await res.json()) as { authorization?: string };
          return typeof data.authorization === "string" ? data.authorization : null;
        })
        .catch(() => null);
      let tools: RealtimeToolConfig[] = [];

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
      applyMicEnabled();

      // 2) Analysers — input from the mic, output from the model's remote track.
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      // The context only drives the level analysers (playback goes through the
      // <audio> element so Chrome's echo canceller keeps its reference signal),
      // but a suspended context still means dead orb meters.
      if (ctx.state === "suspended") await ctx.resume();
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
        // Keep the analyser's context alive — e.g. after an iOS audio interruption.
        if (ctx.state === "suspended") void ctx.resume();
        // Play the element DIRECTLY — do not route it through the AudioContext
        // (createMediaElementSource → destination). Chrome's echo canceller uses
        // directly-played remote WebRTC audio as its reference; rerouting through
        // Web Audio bypasses AEC and the speakers feed the model back to itself.
        audioEl.srcObject = remote;
        void audioEl.play().catch(() => {
          // autoplay policy can defer playback; the element remains wired
        });
        // Passive tap on the remote stream for the orb level only (never connected
        // to destination — the element owns playback). Chrome keeps this analyser
        // fed as long as the same stream is attached to a playing media element.
        try {
          const outAnalyser = ctx.createAnalyser();
          outAnalyser.fftSize = 1024;
          ctx.createMediaStreamSource(remote).connect(outAnalyser);
          outAnalyserRef.current = outAnalyser;
          outBufRef.current = new Float32Array(outAnalyser.fftSize);
        } catch {
          // analyser is best-effort; playback still works without it
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
            // Tools get a prompt section too — the model won't reach for the
            // web unless it knows it can (and how to narrate doing so aloud).
            instructions: tools.length
              ? agent.instructions + FIRECRAWL_TOOL_GUIDANCE
              : agent.instructions,
            ...(tools.length ? { tools: [...agent.tools, ...tools], tool_choice: "auto" } : {}),
            audio: {
              input: {
                // The settings INTERRUPTIONS toggle decides barge-in, not the preset.
                turn_detection: { ...agent.turnDetection, interrupt_response: bargeInRef.current },
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
            // With barge-in on (`interrupt_response: true`) the server truncates
            // the model's audio for us on WebRTC — reflect the interruption in
            // the UI. With it off (the echo-safe default) this event is usually
            // the model's own leaked playback, so don't fake an interruption
            // that isn't happening; interrupting is the manual button.
            if (bargeInRef.current) {
              cancelAgentResponse();
              finalizeAgent();
              setCallState("interrupted");
              if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current);
              interruptTimerRef.current = setTimeout(() => setCallState("listening"), 600);
            }
            break;
          case "input_audio_buffer.speech_stopped":
          case "input_audio_buffer.committed":
            if (stateRef.current === "interrupted") setCallState("listening");
            break;
          case "output_audio_buffer.started":
            // Agent audio is now playing (WebRTC-only event). With barge-in off,
            // go half-duplex: silence the mic so speaker leak can't be committed
            // as a user turn and answered. With barge-in on, the mic stays open
            // so the user can talk over the agent.
            if (!bargeInRef.current) setMicGated(true);
            break;
          case "output_audio_buffer.stopped":
          case "output_audio_buffer.cleared":
            // Playback drained (or was cleared by interrupt) — reopen the mic.
            // Gate off here rather than at response.done: generation finishes
            // while the audio tail is still playing, and that tail is the echo.
            setMicGated(false);
            break;
          case "conversation.item.input_audio_transcription.delta":
            if (msg.delta) pushUserDelta(msg.delta);
            break;
          case "conversation.item.input_audio_transcription.completed":
            finalizeUser(msg.transcript ?? "");
            break;
          // ── Remote MCP tools (executed by the Realtime API, not by us) ──
          case "mcp_list_tools.failed":
            // Tools didn't import; the call continues voice-only.
            console.warn("[openai] firecrawl MCP tool listing failed");
            break;
          case "response.mcp_call.in_progress":
            // The model is between speech segments while the tool runs, so the
            // caption is free — surface the activity instead of dead air.
            setCaption("searching the web…");
            break;
          case "response.mcp_call.failed":
            setCaption("— web tool call failed —");
            break;
          case "conversation.item.done":
            // Defensive: our firecrawl config is require_approval "never", but
            // if the server ever asks anyway, auto-approve our own read-only
            // server rather than deadlocking the turn (an unanswered
            // mcp_approval_request stalls the tool call indefinitely).
            if (msg.item?.type === "mcp_approval_request") {
              if (msg.item.server_label === "firecrawl" && msg.item.id) {
                send({
                  type: "conversation.item.create",
                  item: {
                    type: "mcp_approval_response",
                    approval_request_id: msg.item.id,
                    approve: true,
                  },
                });
              } else {
                console.warn("[openai] unapproved MCP request from", msg.item.server_label);
              }
            }
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

      // Resolve Firecrawl access before the SDP exchange — the data channel
      // (whose open event triggers configure()) can't beat setRemoteDescription.
      const firecrawlAuth = await firecrawlAuthPromise;
      if (firecrawlAuth) tools = [firecrawlMcpTool(firecrawlAuth)];
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
  }, [
    applyMicEnabled,
    beginAgentResponse,
    cancelAgentResponse,
    finalizeAgent,
    pushAgentDelta,
    send,
    setMicGated,
    teardown,
  ]);

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

  const setMuted = useCallback(
    (muted: boolean) => {
      mutedRef.current = muted;
      applyMicEnabled();
    },
    [applyMicEnabled],
  );

  const getInputVolume = useCallback(() => {
    if (mutedRef.current) return 0;
    return analyserLevel(inAnalyserRef.current, inBufRef.current);
  }, []);
  const getOutputVolume = useCallback(
    () => analyserLevel(outAnalyserRef.current, outBufRef.current),
    [],
  );

  // Reflect a barge-in toggle flip into a live session — `session.update` is a
  // merge, so only turn_detection needs resending. No-ops until configured
  // (send() drops messages while the data channel is closed).
  useEffect(() => {
    // Turning barge-in on mid-call lifts the half-duplex gate immediately —
    // don't leave the mic silenced waiting for the current playback to drain.
    if (bargeIn) setMicGated(false);
    if (!configuredRef.current) return;
    const agent = resolveOpenaiAgent(personaRef.current?.id);
    send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: { ...agent.turnDetection, interrupt_response: bargeIn },
          },
        },
      },
    });
  }, [bargeIn, send, setMicGated]);

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
