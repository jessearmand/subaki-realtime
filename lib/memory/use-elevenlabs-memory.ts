"use client";

// Long-term memory for ElevenLabs calls (mem0), bound to the SDK's lifecycle:
//
//   begin(persona, lang, o) CALL pressed: start recall in parallel with connecting,
//                           so memory never delays the call. Returns the userId
//                           to pass to startSession.
//   connected(id, send)     onConnect: send the preface (a resumed call), then the
//                           recalled memories, as contextual updates.
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
export type { BeginOptions } from "./call-lifecycle";

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
