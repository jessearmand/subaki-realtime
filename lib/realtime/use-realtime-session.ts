"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { TRANSCRIPT_SCRIPT, type Persona, type Provider } from "@/lib/data";
import type { Lang } from "@/lib/lang";
import type { CallState, SessionApi, SessionTurn } from "./types";
import { useElevenLabsMemory } from "@/lib/memory/use-elevenlabs-memory";
import { formatResumeUpdate } from "@/lib/conversations/resume";
import type { ConversationDetail } from "@/lib/conversations/types";
import { resolveElevenLabsAgentId } from "./elevenlabs-agent";
import { useXaiSession } from "./use-xai-session";
import { useOpenaiSession } from "./use-openai-session";
import { useOpenaiLiveSession } from "./use-openai-live-session";
import { useGeminiSession } from "./use-gemini-session";
import { useCascadeSession } from "./use-cascade-session";
import { useFalSession } from "./use-fal-session";
import { useMoshiSession } from "./use-moshi-session";

const SCRIPT_TURNS: SessionTurn[] = TRANSCRIPT_SCRIPT.map((t, i) => ({
  id: `s${i}`,
  who: t.who,
  text: t.text,
}));

const LAST = TRANSCRIPT_SCRIPT.length - 1;

/** An earlier call's turns, shown above the new call's while it is being continued. */
function priorTurns(resume: ConversationDetail): SessionTurn[] {
  return resume.transcript.map((t, i) => ({ id: `h${i}`, who: t.who, text: t.text }));
}

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
 *   - "openai" → real gpt-realtime voice via WebRTC (useOpenaiSession)
 *   - "openai-live" → GPT-Live via WebRTC, session made server-side (useOpenaiLiveSession)
 *   - "gemini" → real Gemini Live voice via a direct WebSocket (useGeminiSession)
 *   - "fal" → full-duplex PersonaPlex via a direct WebSocket (useFalSession)
 *   - "moshi" → full-duplex PersonaPlex on the LOCAL MLX server (useMoshiSession)
 * All expose the same `SessionApi` so the UI is provider-agnostic.
 *
 * `useXaiSession` and `useOpenaiSession` share one interface, so the dispatcher
 * picks whichever is active as `custom` and routes every control through it.
 *
 * All real-engine hooks (`useConversation`, `useXaiSession`, `useOpenaiSession`)
 * are called unconditionally (rules of hooks) and stay inert until their engine
 * is selected and started.
 */
export function useRealtimeSession({
  provider,
  persona,
  lang = "en",
  lmModelId,
  voiceBargeIn,
  pushToTalk,
  resume = null,
  memoryEnabled = true,
}: {
  provider: Provider;
  persona?: Persona;
  /**
   * Session language. ElevenLabs routes it to a dedicated JA agent; xAI, OpenAI
   * and Gemini apply it through the prompt. Read when a call starts — changing
   * it mid-call needs a new session (see use-session-routing).
   */
  lang?: Lang;
  /** Cascade-only: overrides the catalog default LM model (from the Providers picker). */
  lmModelId?: string;
  /** OpenAI-only: let user speech interrupt the agent (settings INTERRUPTIONS toggle). */
  voiceBargeIn?: boolean;
  /** Cascade-only: only the Send button ends a turn (settings PUSH-TO-TALK toggle). */
  pushToTalk?: boolean;
  /**
   * ElevenLabs and OPENAI LIVE: an earlier call to continue. While idle its
   * turns fill the transcript; at CALL it goes to the agent as context. The
   * caller arms it only for the call's own persona on the transport that
   * stored it (useResume).
   */
  resume?: ConversationDetail | null;
  /** ElevenLabs and OPENAI LIVE: long-term memory (the memory.recall tool). */
  memoryEnabled?: boolean;
}): SessionApi {
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
  // mem0 long-term memory: recalled at CALL, injected at connect, ingested at end.
  const memory = useElevenLabsMemory();
  // Callbacks below outlive the render that created them; read the live object.
  const conversationRef = useRef<ReturnType<typeof useConversation> | null>(null);
  const conversation = useConversation({
    micMuted: muted,
    onConnect: ({ conversationId }: { conversationId: string }) => {
      memory.connected(conversationId, (text) =>
        conversationRef.current?.sendContextualUpdate(text),
      );
    },
    onDisconnect: () => memory.ended(),
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

  conversationRef.current = conversation;
  const { status, mode, isSpeaking, startSession, endSession } = conversation;

  // ── Custom real engines (own WebSocket / WebRTC, shared interface) ─────────
  const xai = useXaiSession(engine === "xai", persona, lang);
  const openai = useOpenaiSession(engine === "openai", persona, voiceBargeIn ?? false, lang);
  const openaiLive = useOpenaiLiveSession(engine === "openai-live", persona, lang, {
    memoryEnabled,
    resume: engine === "openai-live" ? resume : null,
  });
  const gemini = useGeminiSession(engine === "gemini", persona, lang);
  const cascade = useCascadeSession(engine === "cascade", persona, lmModelId, pushToTalk ?? false);
  const fal = useFalSession(engine === "fal", persona);
  const moshi = useMoshiSession(engine === "moshi", persona);
  // Whichever custom engine is active owns the session; null ⇒ ElevenLabs/mock.
  const custom =
    engine === "xai"
      ? xai
      : engine === "openai"
        ? openai
        : engine === "openai-live"
          ? openaiLive
          : engine === "gemini"
            ? gemini
            : engine === "cascade"
              ? cascade
              : engine === "fal"
                ? fal
                : engine === "moshi"
                  ? moshi
                  : null;

  // The active call state comes from whichever engine owns the session.
  const activeCallState: CallState = custom ? custom.callState : callState;

  // Derive real CallState from the conversation status/mode (ElevenLabs only).
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (engine !== "elevenlabs" || realPhase.current === "idle") return;
    // A call that drops on its own (remote hangup, network) never passes
    // through hangup() or onError, so mark it ended here. Only a transition
    // out of a live status counts: right after CALL the SDK still reports the
    // previous call's "disconnected" while realPhase is already "active".
    const live = prev === "connecting" || prev === "connected";
    if (live && (status === "disconnected" || status === "error")) {
      realPhase.current = "ended";
    }
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
    else if (custom) custom.setMuted(muted);
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

  // Arming or clearing a resume between calls shows (or drops) the earlier
  // call's turns. A call in progress keeps its transcript, and so does a
  // finished call: only turns this effect put up are taken down.
  const showingPriorRef = useRef(false);
  useEffect(() => {
    if (engine !== "elevenlabs" || realPhase.current === "active") return;
    if (resume) {
      showingPriorRef.current = true;
      setTurns(priorTurns(resume));
      setCaption("press CALL to continue");
    } else if (showingPriorRef.current) {
      showingPriorRef.current = false;
      setTurns([]);
      setCaption(stateRef.current === "ended" ? "— call ended —" : "press CALL to begin");
    }
  }, [engine, resume]);

  useEffect(() => () => clearTimers(), []);

  // ── Controls ────────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (custom) {
      custom.start();
      return;
    }
    if (engine === "elevenlabs") {
      if (callState === "idle" || callState === "ended") {
        const agentId = resolveElevenLabsAgentId(persona?.id, lang);
        if (!agentId) {
          setCaption("— set NEXT_PUBLIC_ELEVENLABS_AGENT_ID —");
          return;
        }
        realPhase.current = "active";
        showingPriorRef.current = false;
        setTurns(resume ? priorTurns(resume) : []);
        setCallState("connecting");
        setCaption("establishing session…");
        const userId = memory.begin(persona?.id, lang, {
          memory: memoryEnabled,
          preface: resume ? formatResumeUpdate(resume, lang) : null,
        });
        startSession({ agentId, connectionType: "webrtc", userId } as Parameters<
          typeof startSession
        >[0]);
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
  }, [
    engine,
    custom,
    callState,
    persona,
    lang,
    startSession,
    endSession,
    memory,
    resume,
    memoryEnabled,
  ]);

  const hangup = useCallback(() => {
    if (custom) {
      custom.stop();
      return;
    }
    if (engine === "elevenlabs") {
      realPhase.current = "ended";
      endSession();
    } else {
      clearTimers();
    }
    setCallState("ended");
  }, [engine, custom, endSession]);

  const interrupt = useCallback(() => {
    if (custom) {
      custom.interrupt();
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
  }, [engine, custom, conversation]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // Manual end-of-turn — only the half-duplex cascade STT exposes one.
  const canSendTurn = engine === "cascade";
  const sendTurnEnabled = canSendTurn && cascade.sendTurnEnabled;
  const sendTurn = useCallback(() => {
    if (engine === "cascade") cascade.sendTurn();
  }, [engine, cascade]);

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

  return useMemo<SessionApi>(
    () => ({
      callState: activeCallState,
      turns: custom ? custom.turns : turns,
      caption: custom ? custom.caption : caption,
      muted,
      elapsed,
      isReal,
      toggleMute,
      start,
      hangup,
      interrupt,
      sendTurn,
      canSendTurn,
      sendTurnEnabled,
      getInputVolume: custom ? custom.getInputVolume : getInputVolume,
      getOutputVolume: custom ? custom.getOutputVolume : getOutputVolume,
    }),
    [
      activeCallState,
      custom,
      turns,
      caption,
      muted,
      elapsed,
      isReal,
      toggleMute,
      start,
      hangup,
      interrupt,
      sendTurn,
      canSendTurn,
      sendTurnEnabled,
      getInputVolume,
      getOutputVolume,
    ],
  );
}
