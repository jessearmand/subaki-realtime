"use client";

// Long-term memory for ElevenLabs calls (mem0), bound to the SDK's lifecycle:
//
//   begin(persona, lang)    CALL pressed: start recall in parallel with connecting,
//                           so memory never delays the call. Returns the userId
//                           to pass to startSession.
//   connected(id, send)     onConnect: send the recalled memories as a contextual update.
//   ended()                 onDisconnect: ingest the finished call.
//
// The ordering rules (late disconnects on a language-change restart, stale
// recalls) live in call-lifecycle.ts.

import { useRef } from "react";
import { ingestConversation, recallMemories } from "./client";
import { MemoryCallLifecycle } from "./call-lifecycle";
import { formatMemoryUpdate } from "./framing";
import { getMemoryUserId } from "./user-id";

export type ElevenLabsMemory = Pick<MemoryCallLifecycle, "begin" | "connected" | "ended">;

export function useElevenLabsMemory(): ElevenLabsMemory {
  const ref = useRef<MemoryCallLifecycle | null>(null);
  ref.current ??= new MemoryCallLifecycle({
    userId: getMemoryUserId,
    recall: recallMemories,
    format: formatMemoryUpdate,
    ingest: ingestConversation,
  });
  return ref.current;
}
