// Memory lifecycle for one SDK conversation hook: recall at begin, inject at
// connect, ingest at disconnect. Plain class (no React), so the restart
// orderings can be exercised directly; use-elevenlabs-memory.ts wraps it.
//
// The SDK's connect/disconnect callbacks carry no attempt, and on a language
// change the old session's onDisconnect can land after begin() has armed the
// new call. So this never ends "the current call". Each connect opens a
// conversation, and each disconnect retires the oldest open one: sessions on a
// single SDK hook close in the order they opened. A late disconnect therefore
// ingests the old call and leaves the new one alone.
//
// begin() also takes an attempt token, so a recall from a replaced call never
// reaches the new one. Each conversation ingests at most once.
//
// A call may also carry a preface (a resumed conversation, see
// lib/conversations/resume.ts). It goes out at connect, ahead of the memories,
// whether or not memory is on. With memory off, the call neither recalls nor
// ingests.

import type { Lang } from "@/lib/lang";
import type { IngestTarget } from "./client";

export interface LifecycleDeps {
  userId: () => string;
  recall: (userId: string) => Promise<string[]>;
  format: (memories: string[], lang: Lang) => string | null;
  ingest: (target: IngestTarget) => void;
}

export interface BeginOptions {
  /** Recall before and ingest after this call (the memory.recall tool). */
  memory: boolean;
  /** Context to send first at connect, e.g. an earlier conversation being continued. */
  preface?: string | null;
}

interface CallRecord {
  attempt: number;
  userId: string;
  persona?: string;
  lang: Lang;
  memory: boolean;
  preface: string | null;
  recall: Promise<string[]>;
  injecting?: boolean;
}

const NO_MEMORIES: Promise<string[]> = Promise.resolve([]);

export class MemoryCallLifecycle {
  private attempt = 0;
  /** The call armed by the latest begin(); recall is injected only into it. */
  private current: CallRecord | null = null;
  /** Connected conversations not yet disconnected, oldest first. */
  private open: { id: string; call: CallRecord }[] = [];
  private ingested = new Set<string>();

  constructor(private readonly deps: LifecycleDeps) {}

  /** CALL pressed: start recall in parallel with connecting. Returns the session userId. */
  begin(
    persona: string | undefined,
    lang: Lang,
    { memory, preface = null }: BeginOptions = { memory: true },
  ): string {
    const userId = this.deps.userId();
    this.current = {
      attempt: ++this.attempt,
      userId,
      persona,
      lang,
      memory,
      preface,
      recall: memory ? this.deps.recall(userId) : NO_MEMORIES,
    };
    return userId;
  }

  /** onConnect: open the conversation, then send its preface and recalled memories once. */
  connected(conversationId: string, send: (text: string) => void): void {
    const call = this.current;
    if (!call) return;
    this.open.push({ id: conversationId, call });
    if (call.injecting) return;
    call.injecting = true;
    const { attempt } = call;
    if (call.preface) trySend(send, call.preface);
    if (!call.memory) return;
    void call.recall.then((memories) => {
      if (this.attempt !== attempt || this.current !== call) return;
      const text = this.deps.format(memories, call.lang);
      if (text) trySend(send, text);
    });
  }

  /** onDisconnect: ingest the oldest open conversation. */
  ended(): void {
    const open = this.open.shift();
    if (!open) return;
    // A recall still in flight for this call has nothing left to reach.
    if (this.current === open.call) this.current = null;
    if (!open.call.memory || this.ingested.has(open.id)) return;
    this.ingested.add(open.id);
    this.deps.ingest({
      userId: open.call.userId,
      conversationId: open.id,
      persona: open.call.persona,
      lang: open.call.lang,
    });
  }
}

function trySend(send: (text: string) => void, text: string): void {
  try {
    send(text);
  } catch {
    // The call ended before the update could go out; nothing to inject.
  }
}
