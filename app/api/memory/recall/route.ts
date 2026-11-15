// Pre-call recall: the visitor's most recent mem0 memories, shared by all personas.
//
// The browser calls this when CALL is pressed, in parallel with connecting, and
// hands the result to the agent as a contextual update once the call is up.
// Listing beats searching here: before the first utterance there is no query,
// and a broad "who is this person" search scores barely above mem0's threshold.
//
// Dev only: MEM0_API_KEY comes from fnox (`fnox exec -- bun run dev`). Without
// it the route answers 503 and the call simply proceeds without memory.

import { isMemoryUserId } from "@/lib/memory/ids";
import { Mem0Error, listRecentMemories, mem0ApiKey } from "@/lib/memory/mem0-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECALL_LIMIT = 20;

export async function POST(req: Request): Promise<Response> {
  const apiKey = mem0ApiKey();
  if (!apiKey) {
    return Response.json({ error: "MEM0_API_KEY is not set on the server." }, { status: 503 });
  }

  let userId: unknown;
  try {
    ({ userId } = (await req.json()) as { userId?: unknown });
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isMemoryUserId(userId)) {
    return Response.json({ error: "userId is missing or malformed." }, { status: 400 });
  }

  try {
    const memories = await listRecentMemories(apiKey, userId, RECALL_LIMIT);
    return Response.json(
      { memories: memories.map((m) => m.memory).filter(Boolean) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const status = err instanceof Mem0Error ? err.status : 0;
    const message = err instanceof Error ? err.message : "network error";
    return Response.json({ error: message, status }, { status: 502 });
  }
}
