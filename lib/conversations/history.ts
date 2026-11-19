// Server-only: the visitor's stored calls from every store, as one list.
//
// ElevenLabs keeps its calls (elevenlabs-history.ts); OPENAI LIVE calls live on
// the Archil disk (live-store.ts). Paging across both is in history-cursor.ts.

import { ConversationError } from "@/lib/memory/elevenlabs-conversation";
import { isLiveCallId } from "@/lib/memory/ids";
import { getConversation, listConversations } from "./elevenlabs-history";
import {
  decodeCursor,
  encodeCursor,
  liveFloor,
  takeLiveWindow,
  type HistoryCursor,
} from "./history-cursor";
import { detailOfCall, getCall, isListable, listIndex, nowSecs, summarizeCall } from "./live-store";
import type { ConversationDetail, ConversationPage, ConversationSummary } from "./types";

/** Which stores the server can read: the ElevenLabs key, and whether Archil is set up. */
export interface HistorySources {
  elevenLabsKey?: string;
  liveStore: boolean;
}

// Index entries scanned per request, and Live calls taken once ElevenLabs is done.
const LIVE_SCAN = 60;
const LIVE_PAGE = 30;

export class CursorError extends Error {}

export async function listHistory(
  sources: HistorySources,
  userId: string,
  rawCursor?: string,
): Promise<ConversationPage> {
  const cursor: HistoryCursor | null = rawCursor ? decodeCursor(rawCursor) : {};
  if (!cursor) throw new CursorError("cursor is malformed.");

  let elItems: ConversationSummary[] = [];
  let elNext: string | null = null;
  const elDone = cursor.ed || !sources.elevenLabsKey;
  if (!elDone && sources.elevenLabsKey) {
    const page = await listConversations(sources.elevenLabsKey, userId, cursor.e);
    elItems = page.items;
    elNext = page.nextCursor;
  }
  const elFinished = elDone || !elNext;

  let liveItems: ConversationSummary[] = [];
  let lastLive = cursor.l;
  let liveDone = cursor.ld || !sources.liveStore;
  const floor = liveFloor(
    elFinished,
    elItems.map((c) => c.startedAt),
  );
  if (!liveDone && floor !== Number.POSITIVE_INFINITY) {
    const { entries, truncated } = await listIndex(userId, cursor.l ?? null, LIVE_SCAN);
    const max = elFinished ? LIVE_PAGE : LIVE_SCAN;
    const { take, consumedAll } = takeLiveWindow(entries, floor, max);
    const records = await Promise.all(take.map((e) => getCall(userId, e.callId)));
    const now = nowSecs();
    liveItems = records
      .filter((r) => r !== null && isListable(r, now))
      .map((r) => summarizeCall(r!));
    if (take.length) lastLive = take[take.length - 1].name;
    liveDone = consumedAll && !truncated;
  }

  const items = [...elItems, ...liveItems].sort((a, b) => b.startedAt - a.startedAt);
  const next: HistoryCursor = { e: elNext ?? undefined, ed: elFinished, l: lastLive, ld: liveDone };
  return { items, nextCursor: elFinished && liveDone ? null : encodeCursor(next) };
}

/** One stored call. Throws 404 for a missing call or one that isn't the visitor's. */
export async function getHistoryDetail(
  sources: HistorySources,
  userId: string,
  id: string,
): Promise<ConversationDetail> {
  if (isLiveCallId(id)) {
    if (!sources.liveStore)
      throw new ConversationError("ARCHIL_API_KEY is not set on the server.", 503);
    const record = await getCall(userId, id);
    if (!record) throw new ConversationError(`conversation ${id} not found`, 404);
    return detailOfCall(record);
  }
  if (!sources.elevenLabsKey) {
    throw new ConversationError("ELEVENLABS_API_KEY is not set on the server.", 503);
  }
  return getConversation(sources.elevenLabsKey, userId, id);
}
