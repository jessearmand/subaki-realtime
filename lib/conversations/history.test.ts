// The merged history list's paging (history.ts), walked end to end.
//
// The client appends each page under the last, so across every page the calls
// must come out once each, newest first. The stores are faked (ElevenLabs with
// small pages, the Archil index as a sorted list), so this runs offline with
// no keys. Run with `bun test lib`.

import { expect, mock, test } from "bun:test";
import type { ConversationPage, ConversationSummary } from "./types";

interface Call {
  id: string;
  startedAt: number;
}

const EL_PAGE = 5;
let elCalls: Call[] = [];
let liveCalls: Call[] = [];

// Same layout as live-store.ts: a countdown from the start time, so names sort newest first.
const indexName = (c: Call) => `${String(99_999_999_999 - c.startedAt).padStart(11, "0")}_${c.id}`;

mock.module("./elevenlabs-history", () => ({
  listConversations: async (_key: string, _user: string, cursor?: string) => {
    const offset = cursor ? Number(cursor.slice(1)) : 0;
    const items = elCalls
      .slice(offset, offset + EL_PAGE)
      .map((c) => ({ ...c, source: "elevenlabs" }));
    const more = offset + EL_PAGE < elCalls.length;
    return { items, nextCursor: more ? `c${offset + EL_PAGE}` : null };
  },
  getConversation: async () => null,
}));
mock.module("./live-capture", () => ({ isCapturing: () => false }));
mock.module("./live-digest", () => ({
  needsDigest: () => false,
  withDigest: async (_key: string, record: unknown) => record,
}));
mock.module("./live-store", () => ({
  nowSecs: () => 2_000_000_000,
  isListable: () => true,
  summarizeCall: (r: Call) => ({ id: r.id, startedAt: r.startedAt, source: "openai-live" }),
  detailOfCall: (r: unknown) => r,
  getCall: async (_user: string, id: string) => liveCalls.find((c) => c.id === id) ?? null,
  listIndex: async (_user: string, after: string | null, limit: number) => {
    const entries = liveCalls
      .map((c) => ({ name: indexName(c), callId: c.id, startedAt: c.startedAt }))
      .filter((e) => !after || e.name > after);
    return { entries: entries.slice(0, limit), truncated: entries.length > limit };
  },
}));

// Imported after the mocks so history.ts binds to them.
const { listHistory } = await import("./history");

const SOURCES = { elevenLabsKey: "test", liveStore: true };
const MAX_PAGES = 200;

const liveId = (i: number) => `olc_${i.toString(16).padStart(32, "0")}`;
const newestFirst = (calls: Call[]) => calls.sort((a, b) => b.startedAt - a.startedAt);

/** Every page in order, as the client would append them. */
async function walk(): Promise<ConversationSummary[]> {
  const out: ConversationSummary[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const page: ConversationPage = await listHistory(SOURCES, "tsubaki-test", cursor);
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
  throw new Error(`history did not end within ${MAX_PAGES} pages`);
}

function expectWholeAndOrdered(out: ConversationSummary[]) {
  const ids = out.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBe(elCalls.length + liveCalls.length);
  for (let i = 1; i < out.length; i++) {
    expect(out[i - 1].startedAt).toBeGreaterThanOrEqual(out[i].startedAt);
  }
}

/** Distinct start times from a seeded generator, so a failure reproduces. */
function seededTimes(seed: number) {
  let s = seed;
  const used = new Set<number>();
  return () => {
    let t: number;
    do {
      s = (s * 1_103_515_245 + 12_345) % 2 ** 31;
      t = 1_700_000_000 + Math.floor((s / 2 ** 31) * 1_000_000);
    } while (used.has(t));
    used.add(t);
    return t;
  };
}

test("more Live calls than one page, all newer than the ElevenLabs call", async () => {
  // The case from review: 31 Live calls newer than one ElevenLabs call.
  elCalls = [{ id: "conv_old", startedAt: 1000 }];
  liveCalls = Array.from({ length: 31 }, (_, i) => ({ id: liveId(i), startedAt: 5000 - i }));
  const out = await walk();
  expectWholeAndOrdered(out);
  expect(out.at(-1)?.id).toBe("conv_old");
});

const MIXES: [name: string, el: number, live: number, seed: number][] = [
  ["many Live, few ElevenLabs", 3, 200, 1],
  ["many ElevenLabs, few Live", 40, 4, 2],
  ["interleaved", 37, 143, 3],
  ["Live only", 0, 75, 4],
  ["ElevenLabs only", 23, 0, 5],
  ["both large", 61, 260, 6],
];

for (const [name, elCount, liveCount, seed] of MIXES) {
  test(`every call once, newest first: ${name}`, async () => {
    const next = seededTimes(seed);
    elCalls = newestFirst(
      Array.from({ length: elCount }, (_, i) => ({ id: `conv_${i}`, startedAt: next() })),
    );
    liveCalls = newestFirst(
      Array.from({ length: liveCount }, (_, i) => ({ id: liveId(i), startedAt: next() })),
    );
    expectWholeAndOrdered(await walk());
  });
}
