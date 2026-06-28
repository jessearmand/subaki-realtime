// Server-side LM stage for the STT → LM → TTS cascade engine.
//
// Streams an OpenAI-compatible chat completion from a backend chosen per request,
// so the cascade can swap LMs without the browser ever seeing a key. Backends and
// their URL + secret env key are defined in `config/lm-models.json` (the model
// catalog) — add one there, not here. The upstream SSE body is piped straight back
// to the client, which reads the `data: {...}` deltas. Reasoning models stream
// chain-of-thought in a separate field and emit no spoken `content` until thinking
// ends, so for backends with `supportsThinking` we send
// `chat_template_kwargs.enable_thinking:false` by default.
//
// Dev only: the secret named by each backend's `envKey` (HF_TOKEN / MISTRAL_API_KEY)
// is provided via fnox (`fnox exec -- bun run dev`).

import { DEFAULT_LM_MODEL, resolveLmBackend } from "@/lib/realtime/lm-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LlmRequest {
  /** Backend id from the catalog (a key of `backends` in config/lm-models.json). */
  backend?: string;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  enableThinking?: boolean;
}

export async function POST(req: Request): Promise<Response> {
  let body: LlmRequest;
  try {
    body = (await req.json()) as LlmRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const backendId = body.backend ?? DEFAULT_LM_MODEL.backend;
  const backend = resolveLmBackend(backendId);
  if (!backend) {
    return Response.json(
      { error: `Unknown LM backend "${backendId}" (define it in config/lm-models.json).` },
      { status: 400 },
    );
  }
  const apiKey = process.env[backend.envKey];
  if (!apiKey) {
    return Response.json(
      { error: `${backend.envKey} is not set on the server (provide it via fnox).` },
      { status: 500 },
    );
  }
  if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "model and messages are required." }, { status: 400 });
  }

  const upstreamBody: Record<string, unknown> = {
    model: body.model,
    messages: body.messages,
    stream: true,
    max_tokens: body.maxTokens ?? 256,
    temperature: body.temperature ?? 0.7,
  };
  // Reasoning models toggle chain-of-thought via chat_template_kwargs (ignored by
  // non-reasoning models). APIs that reject unknown fields (e.g. Mistral, 422) set
  // supportsThinking:false in the catalog, so we only send it where it's accepted.
  if (backend.supportsThinking) {
    upstreamBody.chat_template_kwargs = { enable_thinking: body.enableThinking ?? false };
  }

  let upstream: Response;
  try {
    upstream = await fetch(backend.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    return Response.json(
      {
        error: `Failed to reach ${backendId}: ${err instanceof Error ? err.message : "network error"}`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: `${backendId} chat completion failed`, status: upstream.status, detail },
      { status: 502 },
    );
  }

  // Pipe the upstream SSE straight to the client.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
