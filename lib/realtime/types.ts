// Shared realtime types + small mapping helpers used across providers.

import type { AgentState } from "@/components/ui/orb";
import type { AgentState as BarState } from "@/components/ui/bar-visualizer";

export type CallState = "idle" | "connecting" | "listening" | "speaking" | "interrupted" | "ended";

export interface SessionTurn {
  id: string;
  who: "agent" | "user";
  text: string;
  live?: boolean;
}

// The unified surface every provider exposes to the UI. The UI never talks to a
// provider directly — it binds to this, and the active provider is swapped
// behind it (mock for the design's fake lifecycle, ElevenLabs for the real one).
export interface SessionApi {
  callState: CallState;
  turns: SessionTurn[];
  caption: string;
  muted: boolean;
  elapsed: number;
  isReal: boolean;
  toggleMute: () => void;
  start: () => void;
  hangup: () => void;
  interrupt: () => void;
  getInputVolume: () => number;
  getOutputVolume: () => number;
}

export const STATE_LABEL: Record<CallState, string> = {
  idle: "IDLE",
  connecting: "CONNECTING",
  listening: "LISTENING",
  speaking: "SPEAKING",
  interrupted: "INTERRUPTED",
  ended: "ENDED",
};

export function isLive(s: CallState): boolean {
  return s !== "idle" && s !== "ended";
}

// CallState → ElevenLabs WebGL Orb agentState.
export function toOrbState(s: CallState): AgentState {
  switch (s) {
    case "speaking":
      return "talking";
    case "listening":
    case "interrupted":
      return "listening";
    case "connecting":
      return "thinking";
    default:
      return null;
  }
}

// CallState → BarVisualizer state.
export function toBarState(s: CallState): BarState {
  switch (s) {
    case "speaking":
      return "speaking";
    case "connecting":
      return "connecting";
    case "interrupted":
    case "listening":
      return "listening";
    default:
      return "initializing";
  }
}
