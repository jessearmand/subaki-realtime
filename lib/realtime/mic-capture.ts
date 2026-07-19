// Mic capture via AudioWorklet — the modern replacement for the deprecated
// ScriptProcessorNode used by the realtime engines.
//
// Why: ScriptProcessor runs its audio callback on the MAIN thread, so React
// renders / GC pauses delay it — mic chunks arrive in bursts and, in the worst
// case, the whole shared AudioContext glitches. An AudioWorklet processes on
// the realtime audio thread; the main thread only receives finished chunks
// over a MessagePort. The worklet module lives at public/worklets/mic-capture.js
// (fetched by URL into the AudioWorkletGlobalScope — it cannot be bundled).

const MODULE_URL = "/worklets/mic-capture.js";

// addModule() is per-context and idempotent-but-slow; run it once per ctx.
const loadedContexts = new WeakSet<AudioContext>();

export interface MicCapture {
  /** Disconnect and stop delivering chunks (does not stop the MediaStream). */
  stop(): void;
}

/**
 * Start streaming the mic into `onChunk` as fixed-size Float32 chunks.
 * The caller owns the MediaStream's and AudioContext's lifecycles.
 */
export async function createMicCapture(
  ctx: AudioContext,
  stream: MediaStream,
  chunkSamples: number,
  onChunk: (chunk: Float32Array) => void,
): Promise<MicCapture> {
  if (!loadedContexts.has(ctx)) {
    await ctx.audioWorklet.addModule(MODULE_URL);
    loadedContexts.add(ctx);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "mic-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    processorOptions: { chunkSamples },
  });
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
  source.connect(node);
  // Keeps the node live in the rendering graph across browsers; the processor
  // never writes to its output, so this contributes silence — not mic echo.
  node.connect(ctx.destination);
  return {
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
    },
  };
}
