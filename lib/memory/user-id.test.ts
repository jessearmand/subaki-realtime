// The visitor id (user-id.ts): minted once, adopted from another browser, and
// still honoured when localStorage can't save it. Runs against a fake
// localStorage; the tests share the module's state and run in order.

import { expect, test } from "bun:test";
import { getMemoryUserId, setMemoryUserId } from "./user-id";

const store = new Map<string, string>();
let writesFail = false;

globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (writesFail) throw new DOMException("quota exceeded", "QuotaExceededError");
    store.set(k, v);
  },
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() {
    return store.size;
  },
} as Storage;

const OTHER = "tsubaki-11111111-1111-4111-8111-111111111111";
const THIRD = "tsubaki-22222222-2222-4222-8222-222222222222";

test("mints one id and keeps it", () => {
  const first = getMemoryUserId();
  expect(first).toMatch(/^tsubaki-/);
  expect(getMemoryUserId()).toBe(first);
  expect(store.get("tsubaki.memory-user")).toBe(first);
});

test("rejects a malformed id and changes nothing", () => {
  const before = getMemoryUserId();
  expect(setMemoryUserId("not-an-id")).toBe(false);
  expect(getMemoryUserId()).toBe(before);
});

test("an adopted id that can't be saved is still the one used", () => {
  const before = getMemoryUserId();
  writesFail = true;
  expect(setMemoryUserId(OTHER)).toBe(true);
  // The old id is still readable in storage; the adopted one must win.
  expect(store.get("tsubaki.memory-user")).toBe(before);
  expect(getMemoryUserId()).toBe(OTHER);
});

test("once saving works again, storage is the truth", () => {
  writesFail = false;
  expect(setMemoryUserId(THIRD)).toBe(true);
  expect(store.get("tsubaki.memory-user")).toBe(THIRD);
  expect(getMemoryUserId()).toBe(THIRD);
});
