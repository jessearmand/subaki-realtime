"use client";

// OPENAI LIVE engine: GPT-Live (full duplex) over WebRTC, with the session
// created by our server (app/api/openai-live/session). Same surface as the
// other custom engines, so useRealtimeSession dispatches to it uniformly.
//
// What differs from the Realtime engine (use-openai-session.ts):
//   - No turn events. Transcript deltas are grouped into turns by timing
//     (lib/conversations/live-transcript.ts), and "speaking" comes from the
//     output level, since GPT-Live has no end-of-response event.
//   - Full duplex: no half-duplex mic gating. The user can talk over the agent.
//   - The server stores the call and its transcript, and ingests it into mem0
//     (live-capture.ts); this hook never uploads a transcript.
//   - Each call is a LiveConnection of its own, so a call still closing never
//     touches the one that replaced it (a language change restarts this hook).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Persona } from "@/lib/data";
import type { Lang } from "@/lib/lang";
import type { ConversationDetail } from "@/lib/conversations/types";
import { appendTranscriptDelta, type LiveTurn } from "@/lib/conversations/live-transcript";
import { getMemoryUserId } from "@/lib/memory/user-id";
import { LiveConnection, type LiveServerEvent } from "./live-connection";
import { isLive, type CallState, type SessionTurn } from "./types";

// Output level above this counts as the agent speaking; below it for
// SPEAKING_HOLD_MS, the agent has stopped.
const SPEAKING_LEVEL = 0.04;
const SPEAKING_HOLD_MS = 600;
const MONITOR_MS = 100;
// A manual interrupt mutes playback until the agent goes quiet, at most this long.
const INTERRUPT_MAX_MS = 4000;

const INTERRUPT_INSTRUCTION =
  "The caller pressed interrupt. Stop speaking now and listen to what they say.";
const NO_BACKEND_REPLY =
  "No lookup is possible in this conversation. Answer briefly from what you already know.";

// Data-channel events that need no handling (acks, reflected state).
const IGNORED_EVENTS = new Set([
  "session.instructions.appended",
  "session.commentary.appended",
  "session.thinking.appended",
  "session.usage.updated",
  "session.updated",
]);

export interface OpenaiLiveSession {
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

export interface OpenaiLiveOptions {
  /** The memory.recall tool: recall before and ingest after the call (server-side). */
  memoryEnabled: boolean;
  /** A stored OPENAI LIVE call to continue, armed by useResume. */
  resume: ConversationDetail | null;
}

/** One call's connection plus its greeting handshake (both halves arrive in either order). */
interface LiveCallCtx {
  conn: LiveConnection;
  greeting: string;
  started: boolean;
  greeted: boolean;
}

function priorTurns(resume: ConversationDetail | null): SessionTurn[] {
  return (resume?.transcript ?? []).map((t, i) => ({ id: `h${i}`, who: t.who, text: t.text }));
}

/**
 * Ask for the greeting once both the session has started and the server's
 * greeting is known. Startup input already carries it; this repeats it on the
 * instruction channel, the one that keeps exact wording.
 */
function sendGreeting(call: LiveCallCtx): void {
  if (call.greeted || !call.started || !call.greeting) return;
  call.greeted = true;
  call.conn.send({
    type: "session.instructions.append",
    event_id: "greeting",
    delegation_id: null,
    content: call.greeting,
  });
}

function liveTurns(turns: LiveTurn[]): SessionTurn[] {
  return turns.map((t, i) => ({
    id: `l${i}`,
    who: t.who,
    text: t.text.trim(),
    live: i === turns.length - 1,
  }));
}

export function useOpenaiLiveSession(
  active: boolean,
  persona: Persona | undefined,
  lang: Lang,
  { memoryEnabled, resume }: OpenaiLiveOptions,
): OpenaiLiveSession {
  const [callState, setCallState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [caption, setCaption] = useState("press CALL to begin");

  const connRef = useRef<LiveConnection | null>(null);
  const stateRef = useRef<CallState>("idle");
  stateRef.current = callState;
  const personaRef = useRef(persona);
  personaRef.current = persona;
  const langRef = useRef(lang);
  langRef.current = lang;
  const memoryRef = useRef(memoryEnabled);
  memoryRef.current = memoryEnabled;
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  const mutedRef = useRef(false);
  // The transcript shows an armed resume's earlier turns only, not a call's.
  const showingPriorRef = useRef(false);

  // The current call's transcript. Updated here, then handed to setTurns as a
  // value: setTurns updaters must stay pure (StrictMode runs them twice).
  const liveTurnsRef = useRef<LiveTurn[]>([]);
  const priorRef = useRef<SessionTurn[]>([]);
  const monitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLoudRef = useRef(0);
  const interruptAtRef = useRef<number | null>(null);

  const stopMonitor = useCallback(() => {
    if (monitorRef.current) clearInterval(monitorRef.current);
    monitorRef.current = null;
    interruptAtRef.current = null;
  }, []);

  /** End the current call locally (dropped, closed by OpenAI, or setup failed). */
  const endCall = useCallback(
    (conn: LiveConnection, message: string) => {
      if (connRef.current !== conn) return;
      connRef.current = null;
      stopMonitor();
      conn.dispose();
      setCallState("ended");
      setCaption(message);
    },
    [stopMonitor],
  );

  // Speaking follows the output level: GPT-Live has no end-of-response event.
  const startMonitor = useCallback(
    (conn: LiveConnection) => {
      stopMonitor();
      monitorRef.current = setInterval(() => {
        if (connRef.current !== conn) return;
        const now = performance.now();
        if (conn.outputLevel() > SPEAKING_LEVEL) lastLoudRef.current = now;
        const speaking = now - lastLoudRef.current < SPEAKING_HOLD_MS;
        const interruptAt = interruptAtRef.current;
        if (interruptAt !== null) {
          if (speaking && now - interruptAt < INTERRUPT_MAX_MS) return;
          interruptAtRef.current = null;
          conn.setOutputMuted(false);
        }
        const next: CallState = speaking ? "speaking" : "listening";
        if (stateRef.current !== next) setCallState(next);
      }, MONITOR_MS);
    },
    [stopMonitor],
  );

  const handleEvent = useCallback(
    (call: LiveCallCtx, ev: LiveServerEvent) => {
      const { conn } = call;
      if (connRef.current !== conn) return;
      switch (ev.type) {
        case "session.started":
          call.started = true;
          setCallState("listening");
          setCaption("listening…");
          sendGreeting(call);
          startMonitor(conn);
          break;
        case "session.input_transcript.delta":
        case "session.output_transcript.delta": {
          const who = ev.type === "session.input_transcript.delta" ? "user" : "agent";
          const next = appendTranscriptDelta(
            liveTurnsRef.current,
            who,
            ev.delta ?? "",
            ev.start_ms,
            ev.end_ms,
          );
          liveTurnsRef.current = next;
          setTurns([...priorRef.current, ...liveTurns(next)]);
          const latest = [...next].reverse().find((t) => t.who === who);
          if (latest) setCaption(latest.text.trim());
          break;
        }
        case "session.delegation.created":
          // Nothing is behind client delegation here; answer so the turn can't stall.
          if (ev.delegation?.id) {
            conn.send({
              type: "session.commentary.append",
              event_id: `no-backend-${ev.delegation.id}`,
              delegation_id: ev.delegation.id,
              content: NO_BACKEND_REPLY,
            });
          }
          break;
        case "session.closed":
          endCall(conn, "— call ended —");
          break;
        case "error":
          setCaption(`— ${ev.error?.message ?? "OpenAI error"} —`);
          break;
        default:
          if (!IGNORED_EVENTS.has(ev.type) && process.env.NODE_ENV !== "production") {
            console.debug("[openai-live] unhandled event", ev.type);
          }
          break;
      }
    },
    [endCall, startMonitor],
  );

  const start = useCallback(() => {
    if (isLive(stateRef.current)) return;
    const conn = new LiveConnection({
      onEvent: (ev) => handleEvent(call, ev),
      onDrop: () => endCall(conn, "— connection error —"),
    });
    const call: LiveCallCtx = { conn, greeting: "", started: false, greeted: false };
    connRef.current = conn;
    const prior = priorTurns(resumeRef.current);
    priorRef.current = prior;
    // From here the transcript is this call's: spending the resume target
    // when it ends must not clear it.
    showingPriorRef.current = false;
    liveTurnsRef.current = [];
    lastLoudRef.current = 0;
    setTurns(prior);
    setCallState("connecting");
    setCaption("establishing session…");
    conn.setMicEnabled(!mutedRef.current);

    void (async () => {
      const result = await conn.open(
        {
          personaId: personaRef.current?.id,
          lang: langRef.current,
          userId: getMemoryUserId(),
          memory: memoryRef.current,
          resumeId: resumeRef.current?.id ?? null,
        },
        () => connRef.current !== conn,
      );
      if (connRef.current !== conn) {
        conn.dispose();
        return;
      }
      if (!result.ok) {
        endCall(conn, "caption" in result ? result.caption : "— call ended —");
        return;
      }
      call.greeting = result.greeting;
      sendGreeting(call);
    })();
  }, [endCall, handleEvent]);

  const stop = useCallback(() => {
    const conn = connRef.current;
    connRef.current = null;
    stopMonitor();
    setCallState("ended");
    setCaption("— call ended —");
    // Drains in the background on its own connection.
    if (conn) void conn.close();
  }, [stopMonitor]);

  const interrupt = useCallback(() => {
    const conn = connRef.current;
    if (!conn || stateRef.current !== "speaking") return;
    conn.send({
      type: "session.instructions.append",
      event_id: `interrupt-${Date.now()}`,
      delegation_id: null,
      content: INTERRUPT_INSTRUCTION,
    });
    // Cut what is already playing; the monitor unmutes once the agent is quiet.
    conn.setOutputMuted(true);
    interruptAtRef.current = performance.now();
    setCallState("interrupted");
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    connRef.current?.setMicEnabled(!muted);
  }, []);

  const getInputVolume = useCallback(() => connRef.current?.inputLevel() ?? 0, []);
  const getOutputVolume = useCallback(() => connRef.current?.outputLevel() ?? 0, []);

  // Between calls, an armed resume shows the earlier call's turns.
  useEffect(() => {
    if (!active || isLive(stateRef.current)) return;
    if (resume) {
      showingPriorRef.current = true;
      setTurns(priorTurns(resume));
      setCaption("press CALL to continue");
    } else if (showingPriorRef.current) {
      showingPriorRef.current = false;
      setTurns([]);
      setCaption(stateRef.current === "ended" ? "— call ended —" : "press CALL to begin");
    }
  }, [active, resume]);

  // Switched away from OPENAI LIVE: hang up and reset.
  useEffect(() => {
    if (active) return;
    const conn = connRef.current;
    connRef.current = null;
    stopMonitor();
    if (conn) void conn.close();
    if (stateRef.current !== "idle") {
      setCallState("idle");
      setTurns([]);
      setCaption("press CALL to begin");
    }
  }, [active, stopMonitor]);

  useEffect(
    () => () => {
      const conn = connRef.current;
      connRef.current = null;
      stopMonitor();
      if (conn) void conn.close();
    },
    [stopMonitor],
  );

  return useMemo<OpenaiLiveSession>(
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
