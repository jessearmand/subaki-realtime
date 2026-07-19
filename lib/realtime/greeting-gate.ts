// Mic gate for full-duplex engines (PersonaPlex): hold the user's mic shut
// until the model has finished its opening greeting.
//
// Why: PersonaPlex listens while it speaks, and ambient mic noise (breathing,
// room tone) during the greeting reads as the user talking — the model then
// pauses or truncates its own greeting. Feeding it silence until the greeting
// completes fixes this without touching the model (validated server-side in
// personaplex-mlx; this is the same sample-count-based logic, client-side).
//
// Lifecycle: starts CLOSED. Feed every decoded agent-output chunk to
// `observeOutput`. The gate OPENS once the model has produced voiced audio and
// then `endMs` of quiet (greeting turn is over), or unconditionally after
// `maxMs` of output. Sample-count based — deterministic, no wall clock.

import { calculateRms } from "./xai-audio";

export class GreetingGate {
  private opened = false;
  private sawVoice = false;
  private quietSamples = 0;
  private totalSamples = 0;
  private readonly rmsThreshold: number;
  private readonly endSamples: number;
  private readonly maxSamples: number;

  constructor(sampleRate: number, rmsThreshold = 0.02, endMs = 600, maxMs = 12000) {
    this.rmsThreshold = rmsThreshold;
    this.endSamples = Math.floor((endMs / 1000) * sampleRate);
    this.maxSamples = Math.floor((maxMs / 1000) * sampleRate);
  }

  /** Feed one decoded agent-output chunk; may open the gate. */
  observeOutput(chunk: Float32Array): void {
    if (this.opened || chunk.length === 0) return;
    this.totalSamples += chunk.length;
    if (calculateRms(chunk) >= this.rmsThreshold) {
      this.sawVoice = true;
      this.quietSamples = 0;
    } else if (this.sawVoice) {
      this.quietSamples += chunk.length;
    }
    if (
      (this.sawVoice && this.quietSamples >= this.endSamples) ||
      this.totalSamples >= this.maxSamples
    ) {
      this.opened = true;
    }
  }

  /** While false, replace mic frames with silence (keep the timeline). */
  get isOpen(): boolean {
    return this.opened;
  }
}
