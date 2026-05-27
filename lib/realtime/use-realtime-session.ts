"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { TRANSCRIPT_SCRIPT, type Provider } from "@/lib/data";
import type { CallState, SessionApi, SessionTurn } from "./types";
import { useXaiSession } from "./use-xai-session";

const SCRIPT_TURNS: SessionTurn[] = TRANSCRIPT_SCRIPT.map((t, i) => ({
  id: `s${i}`,
  who: t.who,
  text: t.text,
}));

const LAST = TRANSCRIPT_SCRIPT.length - 1;

function mockCaption(state: CallState): string {
  switch (state) {
    case "idle":
      return "press CALL to begin";
    case "ended":
      return "— call ended —";
    case "connecting":
      return "establishing session…";
    case "listening":
      return TRANSCRIPT_SCRIPT[LAST - 1].text;
    case "speaking":
      return TRANSCRIPT_SCRIPT[LAST].text;
    case "interrupted":
      return "… you interrupted";
  }
}

/**
 * Unified realtime session. `provider.engine` selects the engine:
 *   - undefined → the design's mock lifecycle (timers + TRANSCRIPT_SCRIPT)
 *   - "elevenlabs" → real conversation via `@elevenlabs/react`
 *   - "xai" → real Grok voice via a direct WebSocket (useXaiSession)
 * All expose the same `SessionApi` so the UI is provider-agnostic.
 *
 * Both real-engine hooks (`useConversation`, `useXaiSession`) are called
 * unconditionally (rules of hooks) and stay inert until their engine is
 * selected and started.
 */
export function useRealtimeSession({ provider }: { provider: Provider }): SessionApi {
  const engine = provider.engine;
  const isReal = !!engine;

  const [callState, setCallState] = useState<CallState>(isReal ? "idle" : "listening");
  const [turns, setTurns] = useState<SessionTurn[]>(isReal ? [] : SCRIPT_TURNS);
  const [caption, setCaption] = useState<string>(
    isReal ? "press CALL to begin" : mockCaption("listening"),
  );
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const stateRef = useRef(callState);
  stateRef.current = callState;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // ── ElevenLabs real conversation ──────────────────────────────────────────
  const realPhase = useRef<"idle" | "active" | "ended">("idle");
  const conversation = useConversation({
    micMuted: muted,
    onMessage: (msg: { source?: string; message?: string }) => {
      const who = msg.source === "user" ? "user" : "agent";
      const text = msg.message ?? "";
      if (!text) return;
      setTurns((prev) => [...prev, { id: `r${prev.length}`, who, text }]);
      setCaption(text);
    },
    onError: () => {
      realPhase.current = "ended";
      setCallState("ended");
      setCaption("— connection error —");
    },
  });

  const { status, mode, isSpeaking, startSession, endSession } = conversation;

  // ── xAI Grok real conversation (direct WebSocket) ─────────────────────────
  const xai = useXaiSession(engine === "xai");

  // The active call state comes from whichever engine owns the session.
  const activeCallState: CallState = engine === "xai" ? xai.callState : callState;

  // Derive real CallState from the conversation status/mode (ElevenLabs only).
  useEffect(() => {
    if (engine !== "elevenlabs" || realPhase.current === "idle") return;
    if (realPhase.current === "ended") {
      setCallState("ended");
      return;
    }
    if (status === "connecting") setCallState("connecting");
    else if (status === "error") setCallState("ended");
    else if (status === "disconnected") setCallState("ended");
    else if (status === "connected") {
      setCallState(mode === "speaking" || isSpeaking ? "speaking" : "listening");
      setCaption((c) => (c === "establishing session…" ? "listening…" : c));
    }
  }, [engine, status, mode, isSpeaking]);

  // ── Mock lifecycle ──────────────────────────────────────────────────────────
  // First-load drift: listening → speaking after 5s (matches the prototype).
  useEffect(() => {
    if (isReal) return;
    if (callState !== "listening") return;
    const t = setTimeout(() => setCallState("speaking"), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReal]);

  // Caption sync for the mock engine.
  useEffect(() => {
    if (isReal) return;
    setCaption(mockCaption(callState));
  }, [isReal, callState]);

  // Elapsed ticker (all engines) — keyed off whichever engine owns the call.
  useEffect(() => {
    if (activeCallState === "idle" || activeCallState === "ended") {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [activeCallState]);

  // Push mute into the active real engine. ElevenLabs only accepts setMuted once
  // connected (it throws "No active conversation" before startSession()); xAI
  // gates its own mic send, so it's always safe.
  useEffect(() => {
    if (engine === "elevenlabs" && status === "connected") conversation.setMuted(muted);
    else if (engine === "xai") xai.setMuted(muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, engine, status]);

  // Reset to the active engine's initial state when the engine changes. End any
  // live ElevenLabs session we're navigating away from (xAI tears itself down
  // via its own `active` effect).
  useEffect(() => {
    clearTimers();
    try {
      if (realPhase.current === "active") endSession();
    } catch {
      // no active ElevenLabs session
    }
    realPhase.current = "idle";
    if (isReal) {
      setCallState("idle");
      setTurns([]);
      setCaption("press CALL to begin");
    } else {
      setCallState("listening");
      setTurns(SCRIPT_TURNS);
      setCaption(mockCaption("listening"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  useEffect(() => () => clearTimers(), []);

  // ── Controls ────────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (engine === "xai") {
      xai.start();
      return;
    }
    if (engine === "elevenlabs") {
      if (callState === "idle" || callState === "ended") {
        const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
        if (!agentId) {
          setCaption("— set NEXT_PUBLIC_ELEVENLABS_AGENT_ID —");
          return;
        }
        realPhase.current = "active";
        setTurns([]);
        setCallState("connecting");
        setCaption("establishing session…");
        startSession({ agentId, connectionType: "webrtc" } as Parameters<typeof startSession>[0]);
      } else {
        realPhase.current = "ended";
        endSession();
        setCallState("ended");
      }
      return;
    }
    // Mock
    clearTimers();
    if (callState === "idle" || callState === "ended") {
      setTurns(SCRIPT_TURNS);
      setCallState("connecting");
      timers.current.push(setTimeout(() => setCallState("listening"), 1400));
      timers.current.push(setTimeout(() => setCallState("speaking"), 3600));
    } else {
      setCallState("ended");
    }
  }, [engine, xai, callState, startSession, endSession]);

  const hangup = useCallback(() => {
    if (engine === "xai") {
      xai.stop();
      return;
    }
    if (engine === "elevenlabs") {
      realPhase.current = "ended";
      endSession();
    } else {
      clearTimers();
    }
    setCallState("ended");
  }, [engine, xai, endSession]);

  const interrupt = useCallback(() => {
    if (engine === "xai") {
      xai.interrupt();
      return;
    }
    if (stateRef.current !== "speaking") return;
    if (engine === "elevenlabs") {
      conversation.sendUserActivity();
      setCallState("interrupted");
      return;
    }
    clearTimers();
    setCallState("interrupted");
    timers.current.push(setTimeout(() => setCallState("listening"), 900));
  }, [engine, xai, conversation]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // ── Volumes for the orb ───────────────────────────────────────────────────
  const getInputVolume = useCallback(() => {
    if (engine === "elevenlabs") {
      // Throws before startSession(); fall back to silence until connected.
      try {
        return conversation.getInputVolume();
      } catch {
        return 0;
      }
    }
    const s = stateRef.current;
    if (s === "listening" || s === "interrupted") {
      return 0.25 + 0.4 * Math.abs(Math.sin(performance.now() / 180));
    }
    return 0.04;
  }, [engine, conversation]);

  const getOutputVolume = useCallback(() => {
    if (engine === "elevenlabs") {
      try {
        return conversation.getOutputVolume();
      } catch {
        return 0;
      }
    }
    const s = stateRef.current;
    if (s === "speaking") {
      return 0.4 + 0.45 * Math.abs(Math.sin(performance.now() / 140));
    }
    return 0.04;
  }, [engine, conversation]);

  const isXai = engine === "xai";

  return useMemo<SessionApi>(
    () => ({
      callState: activeCallState,
      turns: isXai ? xai.turns : turns,
      caption: isXai ? xai.caption : caption,
      muted,
      elapsed,
      isReal,
      toggleMute,
      start,
      hangup,
      interrupt,
      getInputVolume: isXai ? xai.getInputVolume : getInputVolume,
      getOutputVolume: isXai ? xai.getOutputVolume : getOutputVolume,
    }),
    [
      activeCallState,
      isXai,
      xai,
      turns,
      caption,
      muted,
      elapsed,
      isReal,
      toggleMute,
      start,
      hangup,
      interrupt,
      getInputVolume,
      getOutputVolume,
    ],
  );
}
