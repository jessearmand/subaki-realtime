import { Btn } from "./primitives";
import { PERSONAS, type Persona } from "@/lib/data";

export function PersonasView({
  persona,
  setPersona,
  accent,
}: {
  persona: Persona;
  setPersona: (p: Persona) => void;
  accent: string;
}) {
  return (
    <div className="pp-personas">
      <div className="pp-page-hd">
        <div>
          <div className="pp-h-eyebrow">001 / VOICE LIBRARY</div>
          <h1 className="pp-h1">Personas.</h1>
          <p className="pp-lede">
            Six built-in voices. Two clone slots. Selection persists across providers.
          </p>
        </div>
        <div className="pp-page-hd-r">
          <Btn small>+ CLONE NEW</Btn>
          <Btn small>IMPORT</Btn>
        </div>
      </div>

      <div className="pp-grid">
        {PERSONAS.map((p, i) => (
          <div
            key={p.id}
            className={`pp-persona-card ${persona.id === p.id ? "on" : ""}`}
            onClick={() => setPersona(p)}
          >
            <div className="pp-persona-top">
              <div className="pp-persona-num">{String(i + 1).padStart(2, "0")}</div>
              <div className="pp-persona-portrait">
                <svg viewBox="0 0 60 60" preserveAspectRatio="none">
                  <defs>
                    <pattern
                      id={`stripe-${p.id}`}
                      width="4"
                      height="4"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <line
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="4"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        strokeWidth="1"
                      />
                    </pattern>
                  </defs>
                  <rect width="60" height="60" fill={`url(#stripe-${p.id})`} />
                  <text
                    x="50%"
                    y="55%"
                    textAnchor="middle"
                    fontFamily="var(--pp-mono)"
                    fontSize="9"
                    fill="currentColor"
                    fillOpacity="0.7"
                  >
                    {p.name.slice(0, 3)}
                  </text>
                </svg>
              </div>
            </div>
            <div className="pp-persona-name">{p.name}</div>
            <div className="pp-persona-accent">{p.accent}</div>
            <div className="pp-persona-traits">
              {p.traits.map((t) => (
                <span key={t} className="pp-trait">
                  {t}
                </span>
              ))}
            </div>
            <p className="pp-persona-desc">{p.desc}</p>
            <div className="pp-persona-foot">
              <span className="pp-mono-num">{p.wpm} wpm</span>
              <span className="pp-mono-num">{p.voice}</span>
            </div>
            {persona.id === p.id && (
              <div className="pp-persona-active" style={{ color: accent }}>
                ◉ ACTIVE
              </div>
            )}
          </div>
        ))}

        <div className="pp-persona-card pp-persona-empty">
          <div className="pp-persona-num">+</div>
          <div className="pp-persona-name">EMPTY SLOT</div>
          <p className="pp-persona-desc">
            Drop a 30-second voice sample to clone. Consent prompt is run end-to-end.
          </p>
          <div className="pp-persona-drop">
            <span>DRAG · .wav · .mp3 · ≤ 30s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
