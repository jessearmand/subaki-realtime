"use client";

// Conversation history for the Conversations view: the visitor's stored calls
// (paged) and the one selected for reading. Loaded when the view mounts, so the
// list is fresh each visit; ElevenLabs needs a minute after hangup before a
// call is listed.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HistoryError,
  fetchConversationDetail,
  fetchConversationPage,
} from "@/lib/conversations/client";
import type { ConversationDetail, ConversationSummary } from "@/lib/conversations/types";
import { getMemoryUserId } from "@/lib/memory/user-id";

/** Why a load failed, in terms the view can phrase: missing key, or anything else. */
export type HistoryFailure = "unconfigured" | "failed";

export interface ConversationsState {
  items: ConversationSummary[];
  loading: boolean;
  failure: HistoryFailure | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  selectedId: string | null;
  select: (id: string) => void;
  detail: ConversationDetail | null;
  detailLoading: boolean;
  detailFailure: HistoryFailure | null;
}

function failureOf(err: unknown): HistoryFailure | null {
  if (err instanceof DOMException && err.name === "AbortError") return null;
  return err instanceof HistoryError && err.status === 503 ? "unconfigured" : "failed";
}

function useConversationList() {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<HistoryFailure | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((from: string | null) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setFailure(null);
    fetchConversationPage(getMemoryUserId(), from, ctrl.signal)
      .then((page) => {
        setItems((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const f = failureOf(err);
        if (f === null) return; // superseded by a newer load
        setFailure(f);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(null);
    return () => abortRef.current?.abort();
  }, [load]);

  return {
    items,
    loading,
    failure,
    hasMore: cursor !== null,
    loadMore: () => cursor && !loading && load(cursor),
    reload: () => load(null),
  };
}

function useConversationDetail(selectedId: string | null) {
  const cache = useRef(new Map<string, ConversationDetail>());
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<HistoryFailure | null>(null);
  // Bumped to fetch the selected transcript again after a failure: the id
  // alone doesn't change, so the effect would not rerun.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!selectedId) return;
    const hit = cache.current.get(selectedId);
    setDetail(hit ?? null);
    setFailure(null);
    setLoading(!hit);
    if (hit) return;
    const ctrl = new AbortController();
    fetchConversationDetail(getMemoryUserId(), selectedId, ctrl.signal)
      .then((d) => {
        cache.current.set(d.id, d);
        setDetail(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const f = failureOf(err);
        if (f === null) return;
        setFailure(f);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [selectedId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { detail, loading, failure, retry };
}

export function useConversations(initialId: string | null = null): ConversationsState {
  const list = useConversationList();
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const { detail, loading, failure, retry } = useConversationDetail(selectedId);
  return {
    ...list,
    // REFRESH also retries a transcript that failed to load. A loaded one is
    // kept: a finished call's transcript does not change.
    reload: () => {
      list.reload();
      if (failure) retry();
    },
    selectedId,
    select: setSelectedId,
    detail,
    detailLoading: loading,
    detailFailure: failure,
  };
}
