// Minimal WAV (RIFF/PCM16) encoder for posting a recorded turn to /api/stt.
// Mono, little-endian; the sample rate is whatever the capture context runs at
// (the cascade records at 16 kHz for Voxtral).

/** Encode Float32 [-1, 1] chunks as a mono PCM16 WAV file. */
export function encodeWavPcm16(chunks: Float32Array[], sampleRate: number): Blob {
  const frames = chunks.reduce((n, c) => n + c.length, 0);
  const dataSize = frames * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}
