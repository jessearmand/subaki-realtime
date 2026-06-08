// Brutalist soundbars — wraps the ElevenLabs BarVisualizer (real frequency
// animation, demo-driven here) and squares off its bars to match the design.

import { BarVisualizer } from "@/components/ui/bar-visualizer";
import { toBarState, type CallState } from "@/lib/realtime/types";

export function Bars({ callState, count = 10 }: { callState: CallState; count?: number }) {
  return (
    <div className="tb-elbars" aria-hidden="true">
      <BarVisualizer
        state={toBarState(callState)}
        barCount={count}
        demo
        centerAlign={false}
        className="tb-elbars-viz"
      />
    </div>
  );
}
