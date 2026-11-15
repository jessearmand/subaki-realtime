"use client";

// Long-term memory for ElevenLabs calls (mem0), as three lifecycle hooks:
//
//   begin(persona, lang)    CALL pressed: start recall in parallel with connecting,
//                           so memory never delays the call. Returns the userId
//                           to pass to startSession.
//   connected(id, send)     onConnect: remember the conversation id, then send the
//                           recalled memories as a contextual update.
//   ended()                 onDisconnect / teardown: ingest the finished call.
//
// Each begin() gets its own attempt token. A language change hangs up and
// restarts this same hook, so a recall from the previous call must not reach
// the new one. ended() is idempotent per conversation, and begin() flushes any
// call that never reported a disconnect, so every end path (hangup, end_call,
// error, re-route) ingests exactly once.

import { useCallback, useMemo, useRef } from "react";
import type { Lang } from "@/lib/lang";
import { ingestConversation, recallMemories } from "./client";
import { formatMemoryUpdate } from "./framing";
import { getMemoryUserId } from "./user-id";

interface CallRecord {
  attempt: number;
  userId: string;
  persona?: string;
  lang: Lang;
  recall: Promise<string[]>;
  conversationId?: string;
  injecting?: boolean;
}

export interface ElevenLabsMemory {
  begin: (persona: string | undefined, lang: Lang) => string;
  connected: (conversationId: string, send: (text: string) => void) => void;
  ended: () => void;
}

export function useElevenLabsMemory(): ElevenLabsMemory {
  const attemptRef = useRef(0);
  const callRef = useRef<CallRecord | null>(null);
  const ingestedRef = useRef(new Set<string>());

  const ended = useCallback(() => {
    const call = callRef.current;
    callRef.current = null;
    const id = call?.conversationId;
    if (!call || !id || ingestedRef.current.has(id)) return;
    ingestedRef.current.add(id);
    ingestConversation({
      userId: call.userId,
      conversationId: id,
      persona: call.persona,
      lang: call.lang,
    });
  }, []);

  const begin = useCallback(
    (persona: string | undefined, lang: Lang) => {
      ended();
      const userId = getMemoryUserId();
      callRef.current = {
        attempt: ++attemptRef.current,
        userId,
        persona,
        lang,
        recall: recallMemories(userId),
      };
      return userId;
    },
    [ended],
  );

  const connected = useCallback((conversationId: string, send: (text: string) => void) => {
    const call = callRef.current;
    if (!call) return;
    // onConnect isn't tied to an attempt: a cancelled session's event can arrive
    // first, so the latest id wins and the memories are injected only once.
    call.conversationId = conversationId;
    if (call.injecting) return;
    call.injecting = true;
    const { attempt } = call;
    void call.recall.then((memories) => {
      if (attemptRef.current !== attempt || callRef.current !== call) return;
      const text = formatMemoryUpdate(memories, call.lang);
      if (!text) return;
      try {
        send(text);
      } catch {
        // The call ended between recall and send; nothing to inject.
      }
    });
  }, []);

  return useMemo(() => ({ begin, connected, ended }), [begin, connected, ended]);
}
