// Mic-capture AudioWorkletProcessor — runs on the REALTIME AUDIO THREAD.
//
// Accumulates the 128-sample render quanta into fixed-size chunks and posts
// each finished chunk to the main thread (transferred, zero-copy). Replaces
// the deprecated main-thread ScriptProcessorNode, whose callbacks jank (and
// can glitch the whole shared AudioContext) whenever React renders block the
// main thread. Loaded by lib/realtime/mic-capture.ts.
//
// Plain JS on purpose: AudioWorklet modules are fetched by URL and executed
// inside the AudioWorkletGlobalScope — no bundler, no imports.

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const chunkSamples =
      (options && options.processorOptions && options.processorOptions.chunkSamples) || 1920;
    this.chunkSamples = chunkSamples;
    this.buf = new Float32Array(chunkSamples);
    this.filled = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, this.chunkSamples - this.filled);
      this.buf.set(ch.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === this.chunkSamples) {
        const out = this.buf.slice(0);
        this.port.postMessage(out, [out.buffer]);
        this.filled = 0;
      }
    }
    // Never write to outputs — the node contributes silence to the graph.
    return true;
  }
}

registerProcessor("mic-capture", MicCaptureProcessor);
