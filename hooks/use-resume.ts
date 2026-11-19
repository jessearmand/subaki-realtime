"use client";

// Which stored conversation (if any) the next call continues.
//
// Continuing is per transport and per persona: a stored call continues on the
// transport that stored it (ElevenLabs or OPENAI LIVE), with the same persona.
// So the target is only *armed* while that row and that persona are selected;
// switching away leaves it pending, and switching back re-arms it. Once a continued call ends it is spent, unless the
// call ended only because routing is replacing it (a language change mid-call):
// the replacement call continues the same conversation.
//
// Two hooks, because the session needs `armed` and spending needs the
// session's call state: useResume() before useRealtimeSession(), then
// useSpendResumeAfterCall() after it.

import { useEffect, useRef, useState } from "react";
import type { ConversationDetail, HistorySource } from "@/lib/conversations/types";
import type { Persona, Provider } from "@/lib/data";
import { isLive, type CallState } from "@/lib/realtime/types";

export interface ResumeState {
  /** The selected conversation, armed or not. */
  target: ConversationDetail | null;
  /** The target when the current transport and persona can continue it; else null. */
  armed: ConversationDetail | null;
  select: (detail: ConversationDetail) => void;
  clear: () => void;
}

/** The engine that can continue a call from this store. */
export const SOURCE_ENGINE: Record<HistorySource, NonNullable<Provider["engine"]>> = {
  elevenlabs: "elevenlabs",
  "openai-live": "openai-live",
};

export function useResume(provider: Provider, persona: Persona): ResumeState {
  const [target, setTarget] = useState<ConversationDetail | null>(null);
  const armed =
    target && provider.engine === SOURCE_ENGINE[target.source] && target.personaId === persona.id
      ? target
      : null;
  return { target, armed, select: setTarget, clear: () => setTarget(null) };
}

export function useSpendResumeAfterCall(
  resume: ResumeState,
  callState: CallState,
  restartPending: boolean,
): void {
  const { armed, clear } = resume;
  const clearRef = useRef(clear);
  clearRef.current = clear;
  // Whether the call in progress (or the one just replaced) continued the
  // target. Set only once it connected: a call that fails to connect leaves the
  // target armed for another try.
  const continuingRef = useRef(false);
  const live = isLive(callState);
  const connected = live && callState !== "connecting";
  useEffect(() => {
    if (live) {
      if (connected) continuingRef.current ||= armed !== null;
      return;
    }
    if (continuingRef.current && !restartPending) {
      continuingRef.current = false;
      clearRef.current();
    }
  }, [live, connected, armed, restartPending]);
}
