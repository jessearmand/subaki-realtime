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
    <div className="tb-personas">
      <div className="tb-page-hd">
        <div>
          <div className="tb-h-eyebrow">001 / VOICE LIBRARY</div>
          <h1 className="tb-h1">Personas.</h1>
          <p className="tb-lede">
            One ancient camellia spirit. Seven named manifestations. Selection persists across
            providers.
          </p>
        </div>
        <div className="tb-page-hd-r">
          <Btn small>+ CLONE NEW</Btn>
          <Btn small>IMPORT</Btn>
        </div>
      </div>

      <div className="tb-grid">
        {PERSONAS.map((p, i) => (
          <div
            key={p.id}
            className={`tb-persona-card ${persona.id === p.id ? "on" : ""}`}
            onClick={() => setPersona(p)}
          >
            <div className="tb-persona-top">
              <div className="tb-persona-num">{String(i + 1).padStart(2, "0")}</div>
              <div
                className="tb-persona-dot"
                style={{
                  background:
                    persona.id === p.id ? accent : `color-mix(in srgb, ${accent} 26%, #000)`,
                  boxShadow:
                    persona.id === p.id
                      ? `0 0 0 4px color-mix(in srgb, ${accent} 22%, transparent)`
                      : "none",
                }}
                role="img"
                aria-label={persona.id === p.id ? "Active persona" : "Inactive persona"}
                title={persona.id === p.id ? "Active" : "Inactive"}
              />
            </div>
            <div className="tb-persona-name">{p.name}</div>
            <div className="tb-persona-accent">
              {p.accent} · {p.aspect}
            </div>
            <div className="tb-persona-traits">
              {p.traits.map((t) => (
                <span key={t} className="tb-trait">
                  {t}
                </span>
              ))}
            </div>
            <p className="tb-persona-desc">{p.desc}</p>
            <div className="tb-persona-foot">
              <span className="tb-mono-num">{p.wpm} wpm</span>
              <span className="tb-mono-num">{p.voice}</span>
            </div>
          </div>
        ))}

        <div className="tb-persona-card tb-persona-empty">
          <div className="tb-persona-num">+</div>
          <div className="tb-persona-name">EMPTY SLOT</div>
          <p className="tb-persona-desc">
            Drop a 30-second voice sample to clone. Consent prompt is run end-to-end.
          </p>
          <div className="tb-persona-drop">
            <span>DRAG · .wav · .mp3 · ≤ 30s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
