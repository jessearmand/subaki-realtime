// Server-side LM stage for the STT → LM → TTS cascade engine.
//
// Streams an OpenAI-compatible chat completion from one of two backends, chosen
// per request so the cascade can swap LMs without the browser ever seeing a key:
//   - "hf"      → Hugging Face Inference router (any served model, e.g. gemma-4-31B-it)
//   - "mistral" → Mistral API (e.g. mistral-small-latest)
// The upstream SSE body is piped straight back to the client, which reads the
// `data: {...}` deltas. Reasoning models stream chain-of-thought in a separate
// field and emit no spoken `content` until thinking ends, so we send
// `chat_template_kwargs.enable_thinking:false` by default (ignored otherwise).
//
// Dev only: HF_TOKEN / MISTRAL_API_KEY are provided via fnox (`fnox exec -- bun run dev`).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Backend = "hf" | "mistral";

const UPSTREAM: Record<Backend, { url: string; envKey: string }> = {
  hf: {
    url: "https://router.huggingface.co/v1/chat/completions",
    envKey: "HF_TOKEN",
  },
  mistral: {
    url: "https://api.mistral.ai/v1/chat/completions",
    envKey: "MISTRAL_API_KEY",
  },
};

interface LlmRequest {
  backend?: Backend;
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

  const backend: Backend = body.backend === "mistral" ? "mistral" : "hf";
  const { url, envKey } = UPSTREAM[backend];
  const apiKey = process.env[envKey];
  if (!apiKey) {
    return Response.json(
      { error: `${envKey} is not set on the server (provide it via fnox).` },
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
  // HF-router reasoning models toggle chain-of-thought via chat_template_kwargs
  // (ignored by non-reasoning models). Mistral's API rejects unknown fields (422),
  // so only send it for the HF backend.
  if (backend === "hf") {
    upstreamBody.chat_template_kwargs = { enable_thinking: body.enableThinking ?? false };
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
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
        error: `Failed to reach ${backend}: ${err instanceof Error ? err.message : "network error"}`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: `${backend} chat completion failed`, status: upstream.status, detail },
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
