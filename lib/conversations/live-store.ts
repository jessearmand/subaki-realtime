// Server-only: OPENAI LIVE calls on the Archil disk.
//
// GPT-Live stores no transcripts we can list or read back, so this app keeps
// its own. Layout, under <root>/openai-live/:
//
//   calls/<userId>/<callId>.json         the call record (LiveCallRecord)
//   index/<userId>/<inverted>_<callId>   empty marker, one per call
//
// <inverted> is a fixed-width countdown from the call's start time, so a plain
// lexicographic listing of the index is newest first, and `startAfter` pages
// back in time without reading any record. Records are keyed by the visitor's
// opaque id, so reading one is also the ownership check.

import type { Lang } from "@/lib/lang";
import { ARCHIL_ROOT, archilDisk, isNotFound } from "@/lib/storage/archil";
import type { ConversationDetail, ConversationSummary, ConversationTurn } from "./types";

export interface LiveCallRecord {
  v: 1;
  id: string;
  userId: string;
  personaId: string;
  lang: Lang;
  /** The memory.recall tool was on: ingest into mem0 when the call ends. */
  memory: boolean;
  /** Unix seconds. */
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  status: "open" | "done";
  /** The stored call this one continued, if any. */
  resumedFrom?: string;
  /** Generated once the call is over (live-digest.ts); absent until then. */
  title?: string;
  summary?: string;
  turns: ConversationTurn[];
}

export interface IndexEntry {
  /** Marker name within the visitor's index, usable as a listing cursor. */
  name: string;
  callId: string;
  startedAt: number;
}

const ROOT = `${ARCHIL_ROOT}/openai-live`;
// Countdown base: far past any real start time, fixed width for sorting.
const MAX_SECS = 99_999_999_999;
const INVERTED_WIDTH = 11;
const INDEX_NAME_RE = /^(\d{11})_(olc_[0-9a-f]{32})$/;
/** An open call untouched this long was abandoned (tab closed, server restarted). */
const ABANDONED_SECS = 15 * 60;
const TITLE_CHARS = 60;

const callKey = (userId: string, callId: string) => `${ROOT}/calls/${userId}/${callId}.json`;
const indexPrefix = (userId: string) => `${ROOT}/index/${userId}/`;
const indexName = (startedAt: number, callId: string) =>
  `${String(MAX_SECS - startedAt).padStart(INVERTED_WIDTH, "0")}_${callId}`;

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

export async function putCall(record: LiveCallRecord): Promise<void> {
  const disk = await archilDisk();
  await disk.putObject(
    callKey(record.userId, record.id),
    JSON.stringify(record),
    "application/json",
  );
}

/** Store a new call and its index marker. */
export async function createCall(record: LiveCallRecord): Promise<void> {
  const disk = await archilDisk();
  await putCall(record);
  await disk.putObject(indexPrefix(record.userId) + indexName(record.startedAt, record.id), "");
}

/** The visitor's call, or null if they have none with this id. */
export async function getCall(userId: string, callId: string): Promise<LiveCallRecord | null> {
  const disk = await archilDisk();
  try {
    const bytes = await disk.getObject(callKey(userId, callId));
    const record = JSON.parse(new TextDecoder().decode(bytes)) as LiveCallRecord;
    return record.userId === userId && record.id === callId ? record : null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Index entries newest first, after `after` (a previous entry's name). */
export async function listIndex(
  userId: string,
  after: string | null,
  limit: number,
): Promise<{ entries: IndexEntry[]; truncated: boolean }> {
  const disk = await archilDisk();
  const prefix = indexPrefix(userId);
  // Archil's listing ignores `start-after` (checked 2026-11), so entries up to
  // `after` are skipped here; the hint stays for a server that honours it.
  // Its pages come back in key order, which is newest first.
  const pages = disk.listObjectsPages(prefix, after ? { startAfter: prefix + after } : {});
  const entries: IndexEntry[] = [];
  for await (const page of pages) {
    for (const obj of page.objects) {
      const name = obj.key.slice(prefix.length);
      const m = INDEX_NAME_RE.exec(name);
      if (!m || (after && name <= after)) continue;
      if (entries.length === limit) return { entries, truncated: true };
      entries.push({ name, callId: m[2], startedAt: MAX_SECS - Number(m[1]) });
    }
  }
  return { entries, truncated: false };
}

/** Worth listing: the visitor spoke, and the call is over (or was abandoned). */
export function isListable(record: LiveCallRecord, now = nowSecs()): boolean {
  if (!record.turns.some((t) => t.who === "user")) return false;
  return record.status === "done" || now - record.updatedAt > ABANDONED_SECS;
}

/** Stands in for the title until one is generated: the visitor's first words. */
function openingLine(record: LiveCallRecord): string {
  const firstUser = record.turns.find((t) => t.who === "user")?.text ?? "";
  return firstUser.length > TITLE_CHARS ? `${firstUser.slice(0, TITLE_CHARS)}…` : firstUser;
}

export function summarizeCall(record: LiveCallRecord): ConversationSummary {
  return {
    id: record.id,
    source: "openai-live",
    personaId: record.personaId,
    lang: record.lang,
    title: record.title || openingLine(record),
    summary: record.summary ?? "",
    startedAt: record.startedAt,
    durationSecs: Math.max(0, (record.endedAt ?? record.updatedAt) - record.startedAt),
    messageCount: record.turns.length,
  };
}

export function detailOfCall(record: LiveCallRecord): ConversationDetail {
  return { ...summarizeCall(record), transcript: record.turns };
}
