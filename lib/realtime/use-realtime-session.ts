"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { TRANSCRIPT_SCRIPT, type Provider } from "@/lib/data";
import type { CallState, SessionApi, SessionTurn } from "./types";

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
 * Unified realtime session. The selected provider decides the engine:
 * every non-ElevenLabs row runs the design's mock lifecycle; the ELEVENLABS
 * row runs a real conversation via `@elevenlabs/react`. Both expose the same
 * `SessionApi` so the UI is provider-agnostic.
 *
 * `useConversation` is always called (rules of hooks) but only drives state
 * when the active provider is ElevenLabs; otherwise the mock timers own state.
 */
export function useRealtimeSession({ provider }: { provider: Provider }): SessionApi {
  const isReal = provider.id === "elevenlabs";

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

  // Derive real CallState from the conversation status/mode.
  useEffect(() => {
    if (!isReal || realPhase.current === "idle") return;
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
  }, [isReal, status, mode, isSpeaking]);

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

  // Elapsed ticker (both engines).
  useEffect(() => {
    if (callState === "idle" || callState === "ended") {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [callState]);

  // Push mute state into the real session — only once connected, since
  // @elevenlabs/react throws "No active conversation" before startSession().
  useEffect(() => {
    if (isReal && status === "connected") conversation.setMuted(muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, isReal, status]);

  // Reset to the active engine's initial state when the provider changes.
  useEffect(() => {
    clearTimers();
    if (isReal) {
      realPhase.current = "idle";
      setCallState("idle");
      setTurns([]);
      setCaption("press CALL to begin");
    } else {
      setCallState("listening");
      setTurns(SCRIPT_TURNS);
      setCaption(mockCaption("listening"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReal]);

  useEffect(() => () => clearTimers(), []);

  // ── Controls ────────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (isReal) {
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
  }, [isReal, callState, startSession, endSession]);

  const hangup = useCallback(() => {
    if (isReal) {
      realPhase.current = "ended";
      endSession();
    } else {
      clearTimers();
    }
    setCallState("ended");
  }, [isReal, endSession]);

  const interrupt = useCallback(() => {
    if (stateRef.current !== "speaking") return;
    if (isReal) {
      conversation.sendUserActivity();
      setCallState("interrupted");
      return;
    }
    clearTimers();
    setCallState("interrupted");
    timers.current.push(setTimeout(() => setCallState("listening"), 900));
  }, [isReal, conversation]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // ── Volumes for the orb ───────────────────────────────────────────────────
  const getInputVolume = useCallback(() => {
    if (isReal) {
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
  }, [isReal, conversation]);

  const getOutputVolume = useCallback(() => {
    if (isReal) {
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
  }, [isReal, conversation]);

  return useMemo<SessionApi>(
    () => ({
      callState,
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
    }),
    [
      callState,
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
