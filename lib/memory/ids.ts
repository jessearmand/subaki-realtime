// Identifier shapes shared by the memory routes and the browser client.
//
// The memory user id is opaque and generated in the browser (see user-id.ts);
// it never carries a name or email. Both ids are validated server-side before
// they reach mem0 or ElevenLabs, so a malformed value can't widen a filter or
// alter an upstream URL.

export const MEMORY_USER_ID_PREFIX = "tsubaki-";

const MEMORY_USER_ID_RE = /^tsubaki-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONVERSATION_ID_RE = /^conv_[A-Za-z0-9]+$/;
// Our own id for an OPENAI LIVE call (never the opaque GPT-Live session id).
const LIVE_CALL_ID_RE = /^olc_[0-9a-f]{32}$/;

export function isMemoryUserId(value: unknown): value is string {
  return typeof value === "string" && MEMORY_USER_ID_RE.test(value);
}

export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && CONVERSATION_ID_RE.test(value);
}

/** An OPENAI LIVE call id, as stored in Archil (lib/conversations/live-store.ts). */
export function isLiveCallId(value: unknown): value is string {
  return typeof value === "string" && LIVE_CALL_ID_RE.test(value);
}

/** Any id the history routes accept: an ElevenLabs conversation or an OPENAI LIVE call. */
export function isHistoryId(value: unknown): value is string {
  return isConversationId(value) || isLiveCallId(value);
}

/** A fresh OPENAI LIVE call id. */
export function newLiveCallId(): string {
  return `olc_${crypto.randomUUID().replaceAll("-", "")}`;
}
