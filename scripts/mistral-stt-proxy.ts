// Standalone Bun WebSocket proxy for Mistral realtime transcription.
//
// Why this exists: Mistral's realtime-STT endpoint authenticates with an
// `Authorization: Bearer` header on the WebSocket *handshake* (the Python SDK
// sets it via `websockets.connect(..., additional_headers=...)`). The browser
// `WebSocket` constructor cannot set request headers, so the browser can't
// connect directly. This proxy bridges the gap:
//
//   browser ──ws(no auth)──▶ this proxy ──wss(Bearer header)──▶ api.mistral.ai
//
// It is a dumb pipe: every text/binary frame is forwarded verbatim in both
// directions. The only thing it adds is the auth header (and the upstream URL),
// so MISTRAL_API_KEY never reaches the client. Bun's `WebSocket` client accepts
// a `headers` option — the piece a browser lacks.
//
// Dev only. Run with secrets loaded: `fnox exec -- bun run scripts/mistral-stt-proxy.ts`
// (or `mise run stt-proxy`). Port via STT_PROXY_PORT (default 3001).

const UPSTREAM_BASE = "wss://api.mistral.ai/v1/audio/transcriptions/realtime";
const DEFAULT_MODEL = "voxtral-mini-transcribe-realtime-2602";
const PORT = Number(process.env.STT_PROXY_PORT ?? 3001);

const API_KEY = process.env.MISTRAL_API_KEY;
if (!API_KEY) {
  console.error(
    "[stt-proxy] MISTRAL_API_KEY is not set. Run via `fnox exec -- bun run scripts/mistral-stt-proxy.ts`.",
  );
  process.exit(1);
}

// Per-connection state hung off the ServerWebSocket.
interface ProxyData {
  upstream: WebSocket | null;
  // Frames received from the browser before the upstream socket is open.
  pending: Array<string | ArrayBufferLike>;
  closed: boolean;
}

const server = Bun.serve<ProxyData, undefined>({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    // Forward the model query param through to Mistral (default if absent).
    const model = url.searchParams.get("model") ?? DEFAULT_MODEL;
    const upgraded = srv.upgrade(req, {
      data: { upstream: null, pending: [], closed: false, model } as ProxyData & { model: string },
    });
    if (upgraded) return undefined;
    return new Response("This endpoint speaks WebSocket only.", { status: 426 });
  },
  websocket: {
    open(ws) {
      const data = ws.data as ProxyData & { model: string };
      const upstreamUrl = `${UPSTREAM_BASE}?model=${encodeURIComponent(data.model)}`;
      const upstream = new WebSocket(upstreamUrl, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      } as unknown as string[]);
      upstream.binaryType = "arraybuffer";
      data.upstream = upstream;

      upstream.addEventListener("open", () => {
        for (const frame of data.pending) upstream.send(frame);
        data.pending = [];
      });
      upstream.addEventListener("message", (ev: MessageEvent) => {
        if (data.closed) return;
        ws.send(ev.data as string | ArrayBufferLike);
      });
      upstream.addEventListener("close", (ev: CloseEvent) => {
        if (!data.closed) ws.close(ev.code === 1006 ? 1011 : ev.code, ev.reason);
      });
      upstream.addEventListener("error", () => {
        if (!data.closed) ws.close(1011, "upstream error");
      });
    },
    message(ws, message) {
      const data = ws.data as ProxyData;
      const up = data.upstream;
      const frame = typeof message === "string" ? message : (message as Uint8Array).buffer;
      if (up && up.readyState === WebSocket.OPEN) up.send(frame);
      else data.pending.push(frame);
    },
    close(ws) {
      const data = ws.data as ProxyData;
      data.closed = true;
      try {
        data.upstream?.close();
      } catch {
        // already closing
      }
    },
  },
});

console.log(
  `[stt-proxy] listening on ws://localhost:${server.port}  →  ${UPSTREAM_BASE} (default model ${DEFAULT_MODEL})`,
);
