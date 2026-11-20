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
  planLiveWindow,
  type ElevenLabsRead,
  type HistoryCursor,
} from "./history-cursor";
import { isCapturing } from "./live-capture";
import { needsDigest, withDigest } from "./live-digest";
import {
  detailOfCall,
  getCall,
  isListable,
  listIndex,
  nowSecs,
  summarizeCall,
  type LiveCallRecord,
} from "./live-store";
import type { ConversationDetail, ConversationPage, ConversationSummary } from "./types";

/** Which stores the server can read: the ElevenLabs key, and whether Archil is set up. */
export interface HistorySources {
  elevenLabsKey?: string;
  liveStore: boolean;
  /** Titles OPENAI LIVE calls that have none yet; without it they keep their opening line. */
  openaiKey?: string;
}

// Index entries scanned per request, and Live calls taken once ElevenLabs is done.
const LIVE_SCAN = 60;
const LIVE_PAGE = 30;

// How long a history request waits for missing titles. One that takes longer
// keeps generating and is there on the next load.
const DIGEST_WAIT_MS = 5000;

export class CursorError extends Error {}

/**
 * Finished calls with their generated titles. A call normally gets its title
 * when it ends (app/api/openai-live/session); this covers the ones that didn't:
 * calls stored before titles existed, abandoned calls, and failed attempts.
 */
async function titled(
  sources: HistorySources,
  records: LiveCallRecord[],
): Promise<LiveCallRecord[]> {
  const key = sources.openaiKey;
  // A long silence makes a running call look abandoned. Its record is still
  // being written by the capture, so it is titled when it ends, not here.
  const due = (r: LiveCallRecord) => needsDigest(r) && !isCapturing(r.id);
  if (!key || !records.some(due)) return records;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DIGEST_WAIT_MS);
  });
  const out = await Promise.all(
    records.map((r) =>
      due(r) ? Promise.race([withDigest(key, r), deadline]).then((done) => done ?? r) : r,
    ),
  );
  clearTimeout(timer);
  return out;
}

export async function listHistory(
  sources: HistorySources,
  userId: string,
  rawCursor?: string,
): Promise<ConversationPage> {
  const cursor: HistoryCursor | null = rawCursor ? decodeCursor(rawCursor) : {};
  if (!cursor) throw new CursorError("cursor is malformed.");

  // One ElevenLabs page: the cursor's (again, if it was held) or the next one.
  let elPage: ConversationSummary[] = [];
  let elNext: string | null = null;
  let el: ElevenLabsRead = { kind: "done" };
  if (!cursor.ed && sources.elevenLabsKey) {
    const page = await listConversations(sources.elevenLabsKey, userId, cursor.e);
    elPage = page.items;
    elNext = page.nextCursor;
    el = { kind: "page", startTimes: elPage.map((c) => c.startedAt), hasMore: !!elNext };
  }
  // A held page was partly sent already: everything from its boundary up.
  const elUnsent =
    cursor.eb === undefined ? elPage : elPage.filter((c) => c.startedAt < cursor.eb!);

  let liveItems: ConversationSummary[] = [];
  let lastLive = cursor.l;
  let liveDone = !!cursor.ld || !sources.liveStore;
  let holdAt: number | null = null;
  const floor = liveFloor(el);
  if (!liveDone && floor !== Number.POSITIVE_INFINITY) {
    const { entries, truncated } = await listIndex(userId, cursor.l ?? null, LIVE_SCAN);
    const max = floor === Number.NEGATIVE_INFINITY ? LIVE_PAGE : LIVE_SCAN;
    const plan = planLiveWindow(entries, truncated, floor, max);
    const records = await Promise.all(plan.take.map((e) => getCall(userId, e.callId)));
    const now = nowSecs();
    const listable = records.filter((r): r is LiveCallRecord => r !== null && isListable(r, now));
    liveItems = (await titled(sources, listable)).map(summarizeCall);
    if (plan.take.length) lastLive = plan.take[plan.take.length - 1].name;
    liveDone = plan.liveDone;
    holdAt = plan.holdAt;
  }

  // Held: send only the page's calls at least as new as the last Live call
  // taken, and read the same page again next time. Otherwise move past it.
  const held = el.kind === "page" && holdAt !== null;
  const elItems = held ? elUnsent.filter((c) => c.startedAt >= holdAt!) : elUnsent;
  const next: HistoryCursor = held
    ? { e: cursor.e, ed: false, eb: holdAt!, l: lastLive, ld: liveDone }
    : { e: elNext ?? undefined, ed: el.kind === "done" || !elNext, l: lastLive, ld: liveDone };

  const items = [...elItems, ...liveItems].sort((a, b) => b.startedAt - a.startedAt);
  const exhausted = !!next.ed && !!next.ld;
  return { items, nextCursor: exhausted ? null : encodeCursor(next) };
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
    if (!isListable(record)) return detailOfCall(record);
    return detailOfCall((await titled(sources, [record]))[0]);
  }
  if (!sources.elevenLabsKey) {
    throw new ConversationError("ELEVENLABS_API_KEY is not set on the server.", 503);
  }
  return getConversation(sources.elevenLabsKey, userId, id);
}
