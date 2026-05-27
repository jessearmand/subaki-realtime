// Hybrid orb: the ElevenLabs WebGL Orb renders the 'gradient' style with real
// audio reactivity; the ported CSS/SVG CustomOrb renders 'mono' and 'particles'.
// No "use client" directive — this is a leaf in the client graph (its only
// consumers are client components), which keeps it off the server/client
// serialization boundary so it can take function props.

import { useEffect, useRef, useState } from "react";
import { Orb } from "@/components/ui/orb";
import { CustomOrb } from "./custom-orb";
import { toOrbState, type CallState } from "@/lib/realtime/types";
import type { OrbStyle } from "@/hooks/use-tweaks";

// Derive a darker second gradient stop from the accent so the orb stays
// accent-driven across the five palette options.
function shade(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(full, 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function OrbVisualizer({
  orbStyle,
  callState,
  accent,
  dark,
  getInputVolume,
  getOutputVolume,
}: {
  orbStyle: OrbStyle;
  callState: CallState;
  accent: string;
  dark: boolean;
  getInputVolume: () => number;
  getOutputVolume: () => number;
}) {
  const inRef = useRef(0);
  const outRef = useRef(0);
  // Only mount the WebGL canvas after hydration (no SSR for Three.js).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (orbStyle !== "gradient") return;
    let raf = 0;
    const tick = () => {
      inRef.current = getInputVolume();
      outRef.current = getOutputVolume();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [orbStyle, getInputVolume, getOutputVolume]);

  if (orbStyle === "gradient") {
    return (
      <div style={{ width: "100%", height: "100%" }}>
        {mounted && (
          <Orb
            colors={[accent, shade(accent, -60)]}
            agentState={toOrbState(callState)}
            inputVolumeRef={inRef}
            outputVolumeRef={outRef}
          />
        )}
      </div>
    );
  }
  return <CustomOrb state={callState} style={orbStyle} size="100%" accent={accent} dark={dark} />;
}
