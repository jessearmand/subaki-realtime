// Identifier shapes shared by the memory routes and the browser client.
//
// The memory user id is opaque and generated in the browser (see user-id.ts);
// it never carries a name or email. Both ids are validated server-side before
// they reach mem0 or ElevenLabs, so a malformed value can't widen a filter or
// alter an upstream URL.

export const MEMORY_USER_ID_PREFIX = "tsubaki-";

const MEMORY_USER_ID_RE = /^tsubaki-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONVERSATION_ID_RE = /^conv_[A-Za-z0-9]+$/;

export function isMemoryUserId(value: unknown): value is string {
  return typeof value === "string" && MEMORY_USER_ID_RE.test(value);
}

export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && CONVERSATION_ID_RE.test(value);
}
