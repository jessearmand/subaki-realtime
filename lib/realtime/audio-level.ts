// Orb levels from Web Audio analysers.

const VOL_GAIN = 3.5;

/** RMS of an analyser's current time-domain frame, scaled to a 0..1 orb level. */
export function analyserLevel(
  analyser: AnalyserNode | null,
  buf: Float32Array<ArrayBuffer> | null,
): number {
  if (!analyser || !buf) return 0;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(sum / buf.length) * VOL_GAIN);
}
