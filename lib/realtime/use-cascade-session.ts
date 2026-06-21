"use client";

// Cascade voice engine: STT → LM → TTS, turn-based, as a SessionApi-compatible
// custom engine (same shape as useXaiSession). MVP legs are browser-native so it
// works today with only a server-side HF/Mistral key for the LM:
//   - STT  → Web Speech API (webkitSpeechRecognition), streaming transcripts
//   - LM   → /api/llm (HF Inference router or Mistral), streamed clauses
//   - TTS  → Mistral /api/mistral/tts per clause (browser speechSynthesis fallback)
// The Mistral realtime-STT leg replaces the Web Speech piece later; the LM and
// turn machine stay the same.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Persona } from "@/lib/data";
import { resolveCascadeAgent } from "./cascade-agent";
import { MistralStt } from "./mistral-stt";
import type { CallState, SessionTurn } from "./types";

// Local WS proxy that adds the Mistral Bearer header the browser can't set.
// Public (non-secret) URL; override with NEXT_PUBLIC_MISTRAL_STT_WS.
const STT_WS_URL = process.env.NEXT_PUBLIC_MISTRAL_STT_WS ?? "ws://localhost:3001";

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

export function useCascadeSession(active: boolean, persona?: Persona): CascadeSession {
  const [callState, setCallState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [caption, setCaption] = useState("press CALL to begin");

  const agent = useMemo(() => resolveCascadeAgent(persona?.id), [persona?.id]);
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
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
      if (finalText.trim()) onUserTurnRef.current(finalText.trim());
    };
    rec.onerror = () => {};
    // Chrome stops recognition on silence; restart it while we're still listening.
    rec.onend = () => {
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
    if (usingMistralRef.current && sttRef.current) {
      sttRef.current.resume();
      setCaption("listening…");
      setState("listening");
      return;
    }
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
        const res = await fetch("/api/mistral/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: agentRef.current.ttsVoice }),
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
  const onUserTurn = useCallback(
    async (userText: string) => {
      endListening();
      speakingRef.current = true;
      setTurns((prev) => [...prev, { id: `u${prev.length}`, who: "user", text: userText }]);
      messagesRef.current.push({ role: "user", content: userText });
      setState("speaking");

      const a = agentRef.current;
      const agentTurnId = `a${Date.now()}`;
      liveTurnId.current = agentTurnId;
      setTurns((prev) => [...prev, { id: agentTurnId, who: "agent", text: "", live: true }]);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      let buf = "";
      let full = "";
      const speakQueue: Promise<void> = Promise.resolve();
      let chain = speakQueue;

      const enqueue = (clause: string) => {
        chain = chain.then(() => (ac.signal.aborted ? undefined : speakClause(clause, ac.signal)));
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

  const start = useCallback(() => {
    if (stateRef.current !== "idle" && stateRef.current !== "ended") return;
    messagesRef.current = [];
    setTurns([]);
    setState("connecting");
    setCaption("connecting…");

    // Bring up Mistral realtime STT in parallel with the opening line. The mic
    // stays paused (endListening on the greeting turn) until the greeting
    // finishes and beginListening() resumes it.
    usingMistralRef.current = true;
    const stt = new MistralStt({
      wsUrl: STT_WS_URL,
      onPartial: (text) => {
        if (stateRef.current === "listening") setCaption(text);
      },
      onFinal: (text) => {
        if (!speakingRef.current && !mutedRef.current) onUserTurnRef.current(text);
      },
      onError: () => {
        // Drop to the browser Web Speech fallback for subsequent listens.
        usingMistralRef.current = false;
        if (stateRef.current === "listening") {
          setCaption("— STT proxy unavailable, using browser speech —");
          startListening();
        }
      },
    });
    stt.setMuted(mutedRef.current);
    sttRef.current = stt;
    stt.start().catch(() => {
      usingMistralRef.current = false;
    });

    // Opening line: ask the LM for a greeting, then drop into listening.
    onUserTurn(agentRef.current.firstMessage);
  }, [onUserTurn, setState, startListening]);

  const teardownStt = useCallback(() => {
    sttRef.current?.stop();
    sttRef.current = null;
    usingMistralRef.current = false;
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    speakingRef.current = false;
    stopRecognition();
    teardownStt();
    currentAudioRef.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setState("ended");
    setCaption("— call ended —");
  }, [setState, stopRecognition, teardownStt]);

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
  // of waiting for the silence gate. For Web Speech, stop() forces a final result.
  const sendTurn = useCallback(() => {
    if (stateRef.current !== "listening") return;
    if (usingMistralRef.current && sttRef.current) sttRef.current.endTurnNow();
    else recognitionRef.current?.stop();
  }, []);

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    sttRef.current?.setMuted(m);
  }, []);

  // Tear down when the engine is deselected or unmounted.
  useEffect(() => {
    if (active) return;
    return () => {
      abortRef.current?.abort();
      stopRecognition();
      teardownStt();
      currentAudioRef.current?.pause();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      stateRef.current = "idle";
    };
  }, [active, stopRecognition, teardownStt]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopRecognition();
      teardownStt();
      currentAudioRef.current?.pause();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, [stopRecognition, teardownStt]);

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
