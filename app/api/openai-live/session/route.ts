// Creates an OPENAI LIVE (GPT-Live) WebRTC session for the browser.
//
// GPT-Live has no browser token: the server creates the session with the
// project key, forwarding the browser's SDP offer and returning the answer.
// That puts everything the persona knows at startup on the server:
//   - the persona prompt and voice (resolveLiveAgent), never from the request,
//   - recalled mem0 memories (best-effort, capped at RECALL_TIMEOUT_MS),
//   - a continued OPENAI LIVE call, read from Archil for this visitor only,
//   - the greeting instruction, last in the startup input.
// It then stores a call record for the visitor and attaches a sideband that
// records the transcript until the call closes (live-capture.ts).
//
// POST { sdp, personaId, lang, userId?, memory?, resumeId? }
//   → { sdp, callId, greeting }   callId is null when the call isn't stored.
// Storage and memory never fail or noticeably delay the call.
//
// Dev only: OPENAI_API_KEY, MEM0_API_KEY, ARCHIL_API_KEY come from fnox.

import { PERSONAS } from "@/lib/data";
import { LANGS, type Lang } from "@/lib/lang";
import { startLiveCapture } from "@/lib/conversations/live-capture";
import { withDigest } from "@/lib/conversations/live-digest";
import { buildLiveInput } from "@/lib/conversations/live-seed";
import { createCall, getCall, nowSecs, type LiveCallRecord } from "@/lib/conversations/live-store";
import { isLiveCallId, isMemoryUserId, newLiveCallId } from "@/lib/memory/ids";
import { ingestLiveCall } from "@/lib/memory/live-ingest";
import { listRecentMemories, mem0ApiKey } from "@/lib/memory/mem0-rest";
import { resolveLiveAgent } from "@/lib/realtime/openai-live-agent";
import { archilConfigured } from "@/lib/storage/archil";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
const MAX_SDP_CHARS = 20_000;
const RECALL_LIMIT = 20;
const RECALL_TIMEOUT_MS = 2000;
const STORE_TIMEOUT_MS = 3000;

interface SessionRequest {
  sdp?: unknown;
  personaId?: unknown;
  lang?: unknown;
  userId?: unknown;
  memory?: unknown;
  resumeId?: unknown;
}

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/** The promise's value, or `fallback` if it fails or takes longer than `ms`. */
async function within<T>(p: Promise<T>, ms: number, fallback: T, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } catch (err) {
    console.warn(`[openai-live] ${what} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** "429 · You have no credits remaining." — OpenAI's own reason, first sentence. */
async function describeFailure(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    const reason = body.error?.message?.split(/(?<=\.)\s/)[0] ?? body.error?.code;
    if (reason) return `${res.status} · ${reason}`;
  } catch {
    // non-JSON error body
  }
  return String(res.status);
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fail("OPENAI_API_KEY is not set on the server (provide it via fnox).", 500);

  let body: SessionRequest;
  try {
    body = (await req.json()) as SessionRequest;
  } catch {
    return fail("Invalid JSON body.", 400);
  }
  const { sdp, personaId, lang, userId, memory, resumeId } = body;
  if (typeof sdp !== "string" || !sdp.trim() || sdp.length > MAX_SDP_CHARS) {
    return fail("An SDP offer is required.", 400);
  }
  const persona = PERSONAS.find((p) => p.id === personaId);
  if (!persona) return fail("personaId is unknown.", 400);
  const sessionLang: Lang = LANGS.includes(lang as Lang) ? (lang as Lang) : "en";
  // Without a visitor id the call simply isn't remembered or stored.
  const visitor = isMemoryUserId(userId) ? userId : null;
  const stored = visitor !== null && archilConfigured();
  const wantsMemory = memory === true;

  const mem0Key = mem0ApiKey();
  const recall =
    visitor && wantsMemory && mem0Key
      ? within(
          listRecentMemories(mem0Key, visitor, RECALL_LIMIT).then((ms) =>
            ms.map((m) => m.memory).filter(Boolean),
          ),
          RECALL_TIMEOUT_MS,
          [] as string[],
          "recall",
        )
      : Promise.resolve([] as string[]);
  const resume =
    stored && isLiveCallId(resumeId)
      ? within(getCall(visitor, resumeId), STORE_TIMEOUT_MS, null, "resume load")
      : Promise.resolve(null);
  const [memories, resumed] = await Promise.all([recall, resume]);

  const agent = resolveLiveAgent(persona.id, sessionLang, { resumed: !!resumed });
  const input = buildLiveInput({
    memories,
    resume: resumed ? { lang: resumed.lang, transcript: resumed.turns } : null,
    greeting: agent.greeting,
    lang: sessionLang,
  });

  // Store the call record while OpenAI creates the session: the sideband must
  // attach soon after creation, since it replays only the last 3 seconds. A
  // record whose session then fails holds no turns and is never listed.
  let record: LiveCallRecord | null = null;
  if (stored) {
    const now = nowSecs();
    record = {
      v: 1,
      id: newLiveCallId(),
      userId: visitor,
      personaId: persona.id,
      lang: sessionLang,
      memory: wantsMemory,
      startedAt: now,
      updatedAt: now,
      status: "open",
      ...(resumed ? { resumedFrom: resumed.id } : {}),
      turns: [],
    };
  }
  const storing = record
    ? within(
        createCall(record).then(() => true),
        STORE_TIMEOUT_MS,
        false,
        "store",
      )
    : Promise.resolve(false);

  let upstream: Response;
  try {
    upstream = await fetch(SESSIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          model: agent.model,
          instructions: agent.instructions,
          input,
          audio: { output: { voice: agent.voice.param } },
          // Client delegation with no backend behind it: the prompt says not to
          // delegate, and the browser answers a stray delegation anyway.
          delegation: { type: "client" },
        },
        transport: { type: "webrtc", sdp },
      }),
    });
  } catch (err) {
    return fail(
      `Failed to reach OpenAI: ${err instanceof Error ? err.message : "network error"}`,
      502,
    );
  }
  if (!upstream.ok) return fail(`OpenAI Live: ${await describeFailure(upstream)}`, 502);
  const created = (await upstream.json()) as {
    session?: { id?: string };
    transport?: { sdp?: string };
  };
  const sessionId = created.session?.id;
  const answer = created.transport?.sdp;
  if (!sessionId || !answer) return fail("OpenAI Live returned no session.", 502);

  let callId: string | null = null;
  if (record && (await storing)) {
    callId = record.id;
    startLiveCapture({
      apiKey,
      sessionId,
      record,
      // Independent post-call steps: remember the call, and title it for history.
      onFinished: async (finished) => {
        await Promise.all([ingestLiveCall(finished), withDigest(apiKey, finished)]);
      },
    });
  }

  return Response.json(
    { sdp: answer, callId, greeting: agent.greeting },
    { headers: { "Cache-Control": "no-store" } },
  );
}
