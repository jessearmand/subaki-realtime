"use client";

// Cascade voice engine: STT → LM → TTS, turn-based, as a SessionApi-compatible
// custom engine (same shape as useXaiSession). Every leg resolves a backend
// from a catalog, so cloud ↔ local is config, not code:
//   - STT  → Mistral realtime WS via the Bun proxy, or per-turn batch /api/stt
//            (local mlx-audio server) — config/voice-models.json `stt`;
//            Web Speech remains the fallback if the primary STT leg dies
//   - LM   → /api/llm (HF router / Mistral / local llama-server), streamed
//            clauses — config/lm-models.json
//   - TTS  → /api/tts per clause (Mistral or local mlx-audio;
//            config/voice-models.json `tts`), browser speechSynthesis fallback

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Persona } from "@/lib/data";
import { resolveCascadeAgent } from "./cascade-agent";
import { MistralStt } from "./mistral-stt";
import { DEFAULT_STT_BACKEND_ID, DEFAULT_TTS_BACKEND_ID, resolveSttBackend } from "./voice-config";
import type { CallState, SessionTurn } from "./types";

// Local WS proxy that adds the Mistral Bearer header the browser can't set.
// Public (non-secret) URL; override with NEXT_PUBLIC_MISTRAL_STT_WS.
const STT_WS_URL = process.env.NEXT_PUBLIC_MISTRAL_STT_WS ?? "ws://localhost:3001";
// A dropped Mistral STT session is re-established this many times before the
// call is demoted to the Web Speech fallback for good. Reconnecting keeps
// Silero turn-taking; the fallback endpoints with Chrome's aggressive ~1 s
// silence gate, which users perceive as early turn cuts.
const MAX_STT_RECONNECTS = 2;
const STT_RECONNECT_DELAY_MS = 500;

export interface CascadeSession {
  callState: CallState;
  turns: SessionTurn[];
  caption: string;
  start: () => void;
  stop: () => void;
  interrupt: () => void;
  sendTurn: () => void;
  setMuted: (muted: boolean) => void;
  getInputVolume: () => number;
  getOutputVolume: () => number;
}

// ── Minimal Web Speech typings (not in the standard DOM lib) ──────────────────
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResult };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Segment a streamed token buffer into speakable clauses (sentence end, or a
// clause break once long enough) so TTS starts on the first clause.
const SENTENCE_END = /[.!?](?=\s|$)/;
const CLAUSE_BREAK = /[,;:](?=\s)/;
const MIN_CLAUSE = 30;

function nextClause(buf: string): [string, string] | null {
  const end = buf.match(SENTENCE_END);
  if (end && end.index != null) {
    const cut = end.index + 1;
    return [buf.slice(0, cut).trim(), buf.slice(cut)];
  }
  if (buf.length >= MIN_CLAUSE) {
    const c = buf.match(CLAUSE_BREAK);
    if (c && c.index != null) {
      const cut = c.index + 1;
      return [buf.slice(0, cut).trim(), buf.slice(cut)];
    }
  }
  return null;
}

export function useCascadeSession(
  active: boolean,
  persona?: Persona,
  lmModelId?: string,
  /** Push-to-talk: disable Silero auto turn-end — only the Send button ends a
   *  turn. Applies live (mid-call) via MistralStt.setAutoEndTurns. */
  pushToTalk = false,
): CascadeSession {
  const [callState, setCallState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [caption, setCaption] = useState("press CALL to begin");

  // Re-resolves when the persona or the picked LM model changes; agentRef is
  // updated every render, so a model switch applies on the next turn.
  const agent = useMemo(
    () => resolveCascadeAgent(persona?.id, lmModelId),
    [persona?.id, lmModelId],
  );
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const pushToTalkRef = useRef(pushToTalk);
  pushToTalkRef.current = pushToTalk;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Web Speech push-to-talk: finals buffered here until Send flushes them
  // (Web Speech endpoints on its own, so PTT must hold its results back).
  const webFinalRef = useRef("");
  const webFlushRef = useRef(false);
  // Mistral realtime STT (preferred). Falls back to Web Speech if the proxy or
  // mic is unavailable, in which case usingMistralRef flips to false.
  const sttRef = useRef<MistralStt | null>(null);
  const usingMistralRef = useRef(false);
  const messagesRef = useRef<Array<{ role: string; content: string }>>([]);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const liveTurnId = useRef<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // Breaks the startListening ↔ onUserTurn recursion (each is declared before
  // the other needs it); startListening calls through the ref.
  const onUserTurnRef = useRef<(t: string) => void>(() => {});
  // STT reconnect budget for the current call, and a ref so the STT onError
  // handler can re-invoke the function that creates the session.
  const sttRetriesRef = useRef(0);
  const startSttRef = useRef<() => MistralStt | null>(() => null);

  const stateRef = useRef<CallState>("idle");
  const setState = useCallback((s: CallState) => {
    stateRef.current = s;
    setCallState(s);
  }, []);

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // already stopped
      }
    }
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setCaption("— speech recognition unavailable (use Chrome) —");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      if (speakingRef.current || mutedRef.current) return;
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) setCaption(interim);
      if (finalText.trim()) {
        if (pushToTalkRef.current) {
          // Web Speech endpoints on its own; in push-to-talk, hold finals until
          // the Send button flushes them instead of replying immediately.
          webFinalRef.current = `${webFinalRef.current} ${finalText}`.trim();
          setCaption(webFinalRef.current);
        } else {
          onUserTurnRef.current(finalText.trim());
        }
      }
    };
    rec.onerror = () => {};
    // Chrome stops recognition on silence; restart it while we're still listening.
    rec.onend = () => {
      // Send pressed in push-to-talk: emit the buffered turn (stop() has forced
      // out any pending final by now) instead of restarting.
      if (webFlushRef.current) {
        webFlushRef.current = false;
        const text = webFinalRef.current.trim();
        webFinalRef.current = "";
        if (text) {
          onUserTurnRef.current(text);
          return;
        }
      }
      if (stateRef.current === "listening" && !speakingRef.current) {
        try {
          rec.start();
        } catch {
          // start() throws if already running; ignore
        }
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      // ignore double-start
    }
    setState("listening");
  }, [setState]);

  // Enter the listening state on whichever STT path is active: resume the open
  // Mistral session, or (fallback) (re)start Web Speech.
  const beginListening = useCallback(() => {
    const hint = pushToTalkRef.current ? "listening — send ends your turn" : "listening…";
    if (usingMistralRef.current && sttRef.current) {
      sttRef.current.resume();
      setCaption(hint);
      setState("listening");
      return;
    }
    webFinalRef.current = "";
    webFlushRef.current = false;
    setCaption(hint);
    startListening();
  }, [setState, startListening]);

  // Leave the listening state (assistant about to speak): pause the Mistral
  // session, or stop Web Speech.
  const endListening = useCallback(() => {
    if (usingMistralRef.current && sttRef.current) {
      sttRef.current.pause();
      return;
    }
    stopRecognition();
  }, [stopRecognition]);

  // Browser speechSynthesis fallback (used when the Mistral TTS route fails).
  const speakBrowser = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        resolve();
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }, []);

  // Speak one clause via Mistral TTS; resolves when playback finishes. Falls back
  // to browser speechSynthesis if the route/key is unavailable.
  const speakClause = useCallback(
    async (text: string, signal: AbortSignal): Promise<void> => {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: agentRef.current.ttsVoice,
            backend: DEFAULT_TTS_BACKEND_ID,
          }),
          signal,
        });
        if (!res.ok) throw new Error("tts");
        const blob = await res.blob();
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
      } catch {
        if (!signal.aborted) await speakBrowser(text);
      }
    },
    [speakBrowser],
  );

  // Run one assistant turn: stream the LM reply and speak it clause by clause.
  // `visible: false` keeps the user text out of the transcript — the greeting
  // bootstrap is an internal instruction to the LM, not something the user said.
  //
  // Dead-air continuation: the mic is NOT gated at turn end — it stays live
  // while the LM thinks and is paused only when the first TTS clause is about
  // to play (`gateMic`). Speech completed in that window arrives as a fresh
  // onFinal → this function runs again, aborts the in-flight turn (whose
  // never-heard partial reply is dropped), and merges the new text into the
  // pending user message. Without this, anything said while a slow model
  // thinks (e.g. a serverless cold start) lands on a paused mic and vanishes.
  const onUserTurn = useCallback(
    async (userText: string, { visible = true } = {}) => {
      // Supersede any in-flight turn first (dead-air continuation) so its
      // cleanup sees the abort before this turn's messages are appended.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (visible) {
        setTurns((prev) => [...prev, { id: `u${prev.length}`, who: "user", text: userText }]);
      }
      // Merge consecutive user texts into one message (a continuation follows
      // a user message whose reply was dropped) — some chat APIs reject
      // non-alternating roles.
      const msgs = messagesRef.current;
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg?.role === "user") lastMsg.content = `${lastMsg.content}\n${userText}`;
      else msgs.push({ role: "user", content: userText });
      setState("speaking");

      const a = agentRef.current;
      const agentTurnId = `a${Date.now()}`;
      liveTurnId.current = agentTurnId;
      setTurns((prev) => [...prev, { id: agentTurnId, who: "agent", text: "", live: true }]);

      let buf = "";
      let full = "";
      let audioStarted = false;
      const speakQueue: Promise<void> = Promise.resolve();
      let chain = speakQueue;

      // Close the dead-air window: pause capture when the first clause starts
      // TTS synthesis (just ahead of it becoming audible — the gate must lead
      // playback so speaker bleed never reaches the mic). From here on user
      // speech is barge-in territory, not continuation.
      const gateMic = () => {
        if (audioStarted) return;
        audioStarted = true;
        endListening();
        speakingRef.current = true;
      };

      const enqueue = (clause: string) => {
        chain = chain.then(() => {
          if (ac.signal.aborted) return;
          gateMic();
          return speakClause(clause, ac.signal);
        });
      };

      try {
        const res = await fetch("/api/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            backend: a.lmBackend,
            model: a.lmModel,
            messages: [{ role: "system", content: a.instructions }, ...messagesRef.current],
            maxTokens: a.maxTokens,
            temperature: a.temperature,
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          setCaption("— LM error —");
          throw new Error("llm");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sse = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sse += decoder.decode(value, { stream: true });
          const lines = sse.split("\n");
          sse = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (data === "[DONE]") continue;
            let delta = "";
            try {
              delta = JSON.parse(data)?.choices?.[0]?.delta?.content ?? "";
            } catch {
              continue;
            }
            if (!delta) continue;
            full += delta;
            buf += delta;
            setCaption(full);
            setTurns((prev) => prev.map((x) => (x.id === agentTurnId ? { ...x, text: full } : x)));
            let seg: [string, string] | null;
            while ((seg = nextClause(buf))) {
              if (seg[0]) enqueue(seg[0]);
              buf = seg[1];
            }
          }
        }
        if (buf.trim()) enqueue(buf.trim());
      } catch {
        // aborted or network error — fall through to cleanup
      }

      if (ac.signal.aborted && !audioStarted) {
        // Superseded during dead-air: the user never heard this reply — drop
        // it from the transcript and keep it out of the LM history so the
        // continuation turn answers the full utterance fresh.
        setTurns((prev) => prev.filter((x) => x.id !== agentTurnId));
        return;
      }

      messagesRef.current.push({ role: "assistant", content: full });
      setTurns((prev) => prev.map((x) => (x.id === agentTurnId ? { ...x, live: false } : x)));

      await chain; // wait until the last clause finishes speaking
      if (ac.signal.aborted) return;
      speakingRef.current = false;
      if (stateRef.current !== "ended") beginListening();
    },
    [beginListening, endListening, setState, speakClause],
  );
  onUserTurnRef.current = onUserTurn;

  const teardownStt = useCallback(() => {
    sttRef.current?.stop();
    sttRef.current = null;
    usingMistralRef.current = false;
  }, []);

  // Full hang-up: abort the in-flight LM turn and silence every audio path.
  const teardown = useCallback(() => {
    abortRef.current?.abort();
    speakingRef.current = false;
    stopRecognition();
    teardownStt();
    currentAudioRef.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, [stopRecognition, teardownStt]);

  // Build + start the Mistral STT leg: the realtime WS, or batch recording for
  // the local backend (mode from config/voice-models.json). Called at call
  // start and again (through startSttRef) to reconnect a dropped session;
  // returns the fresh instance so the reconnect path can resume() it.
  const startStt = useCallback((): MistralStt => {
    usingMistralRef.current = true;
    const sttBackend = resolveSttBackend(DEFAULT_STT_BACKEND_ID);
    const stt = new MistralStt({
      wsUrl: STT_WS_URL,
      mode: sttBackend?.mode ?? "realtime",
      sttBackend: DEFAULT_STT_BACKEND_ID,
      autoEndTurns: !pushToTalkRef.current,
      onPartial: (text) => {
        if (stateRef.current === "listening") setCaption(text);
      },
      onFinal: (text) => {
        if (!speakingRef.current && !mutedRef.current) onUserTurnRef.current(text);
      },
      // A successful (re)connect refunds the retry budget, so a session that
      // drops again much later gets its own reconnect attempts.
      onReady: () => {
        sttRetriesRef.current = 0;
      },
      onError: (message) => {
        // Shut down the failed Mistral leg (mic stream, AudioContext, VAD,
        // socket) first — otherwise capture paths pile up across reconnects.
        teardownStt();
        if (stateRef.current === "idle" || stateRef.current === "ended") return;
        const attempt = sttRetriesRef.current + 1;
        if (attempt <= MAX_STT_RECONNECTS) {
          sttRetriesRef.current = attempt;
          console.warn(
            `[cascade] Mistral STT leg failed (${message}) — reconnecting ${attempt}/${MAX_STT_RECONNECTS}`,
          );
          setTimeout(() => {
            if (stateRef.current === "idle" || stateRef.current === "ended" || sttRef.current) {
              return;
            }
            const fresh = startSttRef.current();
            // Re-enter listening on the fresh session; the in-progress turn's
            // partial transcript is lost (acceptable for a rare drop).
            if (fresh && stateRef.current === "listening") {
              fresh.resume();
              setCaption("— speech-to-text reconnected, please repeat —");
            }
          }, STT_RECONNECT_DELAY_MS);
          return;
        }
        // Loud on purpose: the fallback swaps Silero turn-taking for Chrome's
        // aggressive ~1 s endpointing, which users perceive as early cuts —
        // a silent demotion here masquerades as a VAD tuning problem.
        console.warn(
          `[cascade] Mistral STT leg failed (${message}) after ${MAX_STT_RECONNECTS} reconnects — falling back to Web Speech (browser endpointing, no Silero turn-taking)`,
        );
        if (stateRef.current === "listening") {
          setCaption("— STT unavailable, using browser speech —");
          startListening();
        }
      },
    });
    stt.setMuted(mutedRef.current);
    sttRef.current = stt;
    stt.start().catch(() => {
      // Mic denied / AudioContext failure: release whatever start() got to.
      teardownStt();
    });
    return stt;
  }, [startListening, teardownStt]);
  startSttRef.current = startStt;

  const start = useCallback(() => {
    if (stateRef.current !== "idle" && stateRef.current !== "ended") return;
    messagesRef.current = [];
    sttRetriesRef.current = 0;
    setTurns([]);
    setState("connecting");
    setCaption("connecting…");

    // Bring up the STT leg in parallel with the opening line. The mic stays
    // paused (endListening on the greeting turn) until the greeting finishes
    // and beginListening() resumes it.
    startStt();

    // Opening line: ask the LM for a greeting, then drop into listening. The
    // elicitation prompt goes to the LM only — never into the visible transcript.
    onUserTurn(agentRef.current.firstMessage, { visible: false });
  }, [onUserTurn, setState, startStt]);

  const stop = useCallback(() => {
    teardown();
    setState("ended");
    setCaption("— call ended —");
  }, [setState, teardown]);

  const interrupt = useCallback(() => {
    if (stateRef.current !== "speaking") return;
    abortRef.current?.abort();
    currentAudioRef.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    speakingRef.current = false;
    setState("interrupted");
    beginListening();
  }, [beginListening, setState]);

  // Manual end-of-turn ("send" button): end the current turn immediately instead
  // of waiting for the silence gate. For Web Speech, stop() forces a final result;
  // in push-to-talk the flush flag makes onend emit the buffered turn.
  const sendTurn = useCallback(() => {
    if (stateRef.current !== "listening") return;
    if (usingMistralRef.current && sttRef.current) {
      sttRef.current.endTurnNow();
    } else {
      webFlushRef.current = true;
      recognitionRef.current?.stop();
    }
  }, []);

  // Push-to-talk toggled mid-call: flip auto turn-end on the live STT session.
  useEffect(() => {
    sttRef.current?.setAutoEndTurns(!pushToTalk);
  }, [pushToTalk]);

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    sttRef.current?.setMuted(m);
  }, []);

  // Hang up + reset if the engine is deselected mid-session. Teardown must run
  // directly in the !active branch (same as the xAI/OpenAI hooks) — a cleanup
  // returned here would only fire on the *next* deps change or unmount, leaving
  // the mic and STT socket live after a provider switch.
  useEffect(() => {
    if (active || stateRef.current === "idle") return;
    teardown();
    setState("idle");
    setTurns([]);
    setCaption("press CALL to begin");
  }, [active, setState, teardown]);

  // Cleanup on unmount.
  useEffect(() => () => teardown(), [teardown]);

  const getInputVolume = useCallback(() => {
    const s = stateRef.current;
    // Real mic RMS when Mistral STT is driving; otherwise a synthetic pulse
    // (Web Speech exposes no level).
    if (usingMistralRef.current && sttRef.current && (s === "listening" || s === "interrupted")) {
      return Math.min(1, 0.06 + sttRef.current.level * 6);
    }
    if (s === "listening" || s === "interrupted")
      return 0.25 + 0.4 * Math.abs(Math.sin(performance.now() / 180));
    return 0.04;
  }, []);
  const getOutputVolume = useCallback(() => {
    if (stateRef.current === "speaking")
      return 0.4 + 0.45 * Math.abs(Math.sin(performance.now() / 140));
    return 0.04;
  }, []);

  return useMemo<CascadeSession>(
    () => ({
      callState,
      turns,
      caption,
      start,
      stop,
      interrupt,
      sendTurn,
      setMuted,
      getInputVolume,
      getOutputVolume,
    }),
    [
      callState,
      turns,
      caption,
      start,
      stop,
      interrupt,
      sendTurn,
      setMuted,
      getInputVolume,
      getOutputVolume,
    ],
  );
}
