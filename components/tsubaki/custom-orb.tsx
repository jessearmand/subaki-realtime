// Custom CSS/SVG orb ported from the design bundle (orb.jsx). Covers the
// brutalist 'mono' and 'particles' styles the ElevenLabs WebGL orb can't do.
// Animations live in globals.css (.tb-orb*).

import type { CSSProperties } from "react";
import type { CallState } from "@/lib/realtime/types";

type CustomStyle = "mono" | "particles" | "gradient";

interface Particle {
  cx: number;
  cy: number;
  r: number;
  o: number;
}

// Stable particle field (mulberry32) so positions don't jump between renders.
function makeParticles(seed: number, count: number): Particle[] {
  let s = seed;
  const rng = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rng()) * 48;
    const a = rng() * Math.PI * 2;
    out.push({
      cx: 50 + Math.cos(a) * r,
      cy: 50 + Math.sin(a) * r,
      r: 0.3 + rng() * 1.4,
      o: 0.25 + rng() * 0.7,
    });
  }
  return out;
}

const PARTICLES = makeParticles(42, 280);

export function CustomOrb({
  state = "idle",
  style = "mono",
  size = 320,
  accent = "#B0122F",
  dark = false,
}: {
  state?: CallState;
  style?: CustomStyle;
  size?: number | string;
  accent?: string;
  dark?: boolean;
}) {
  const wrapStyle = {
    "--tb-orb-size": typeof size === "number" ? `${size}px` : size,
    "--tb-accent": accent,
    color: dark ? "#F4F2ED" : "#0A0A09",
  } as CSSProperties;

  let inner;
  if (style === "particles") {
    inner = (
      <div className="tb-orb-particle">
        <svg viewBox="0 0 100 100">
          <defs>
            <radialGradient id="tb-pgrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={dark ? "#F4F2ED" : "#0A0A09"} stopOpacity="0.15" />
              <stop offset="55%" stopColor={accent} stopOpacity="0.55" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="48" fill="url(#tb-pgrad)" />
          {PARTICLES.map((p, i) => (
            <circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              fill={dark ? "#F4F2ED" : "#0A0A09"}
              opacity={p.o}
            />
          ))}
        </svg>
      </div>
    );
  } else {
    inner = <div className="tb-orb-mono" />;
  }

  return (
    <div className={`tb-orb ${dark ? "dark" : ""}`} data-state={state} style={wrapStyle}>
      <div className="tb-orb-core">{inner}</div>
      <div className="tb-orb-ring tb-orb-ring-1" />
      <div className="tb-orb-ring tb-orb-ring-2" />
      <div className="tb-orb-ring tb-orb-ring-3" />
    </div>
  );
}
