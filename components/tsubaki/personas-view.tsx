import { Btn } from "./primitives";
import { LangSwitch } from "./lang-switch";
import { useT } from "./i18n-context";
import { PERSONAS, resolvePersona, type Persona, type Provider } from "@/lib/data";
import type { Lang } from "@/lib/lang";

/** One persona, shown in the session language. */
function PersonaCard({
  p,
  index,
  lang,
  provider,
  on,
  accent,
  onSelect,
}: {
  p: Persona;
  index: number;
  lang: Lang;
  provider: Provider;
  on: boolean;
  accent: string;
  onSelect: (p: Persona) => void;
}) {
  const t = useT();
  const r = resolvePersona(p, lang);
  const ja = lang === "ja";
  // The cast JA voice belongs to the dedicated agent; on a prompt-level
  // transport the persona's usual voice speaks Japanese.
  const jaAgent = provider.ja === "agent";
  return (
    <div className={`tb-persona-card ${on ? "on" : ""}`} onClick={() => onSelect(p)}>
      <div className="tb-persona-top">
        <div className="tb-persona-num">{String(index + 1).padStart(2, "0")}</div>
        <div
          className="tb-persona-dot"
          style={{
            background: on ? accent : `color-mix(in srgb, ${accent} 26%, #000)`,
            boxShadow: on ? `0 0 0 4px color-mix(in srgb, ${accent} 22%, transparent)` : "none",
          }}
          role="img"
          aria-label={t(on ? "aria.activePersona" : "aria.inactivePersona")}
        />
      </div>
      <div className="tb-persona-name">
        {r.name}
        {ja && (
          <span className="tb-name-sub" lang="en">
            {p.name}
          </span>
        )}
      </div>
      <div className="tb-persona-accent">
        {r.accent} · {r.aspect}
      </div>
      <div className="tb-persona-traits">
        {r.traits.map((trait) => (
          <span key={trait} className="tb-trait">
            {trait}
          </span>
        ))}
      </div>
      <p className="tb-persona-desc">{r.desc}</p>
      {ja && r.greet && (
        <div className="tb-ja-greet">
          <span className="tb-ja-greet-l">{t("personas.firstMessage")}</span>
          <span className="tb-ja-greet-t">{r.greet}</span>
        </div>
      )}
      {ja && (
        <div className="tb-ja-support">
          <span className="tb-ja-support-l">
            {t(jaAgent ? "personas.jaAgent" : "personas.jaPrompt")}
          </span>
          <span className="tb-ja-support-v">
            {provider.name} · {jaAgent ? `tsubaki-${p.id}-ja` : t("personas.jaPromptValue")}
          </span>
        </div>
      )}
      <div className="tb-persona-foot">
        <span className="tb-mono-num">{r.rateLabel}</span>
        <span className="tb-mono-num">{ja && !jaAgent ? p.voice : r.voice}</span>
      </div>
    </div>
  );
}

export function PersonasView({
  persona,
  setPersona,
  provider,
  lang,
  setLang,
  accent,
}: {
  persona: Persona;
  setPersona: (p: Persona) => void;
  /** Active transport — decides whether Japanese uses a cast agent voice. */
  provider: Provider;
  lang: Lang;
  setLang: (lang: Lang) => void;
  accent: string;
}) {
  const t = useT();
  return (
    <div className="tb-personas">
      <div className="tb-page-hd">
        <div>
          <div className="tb-h-eyebrow">{t("personas.eyebrow")}</div>
          <h1 className="tb-h1">{t("personas.title")}</h1>
          <p className="tb-lede">{t("personas.lede")}</p>
        </div>
        <div className="tb-page-hd-r">
          <span className="tb-lang-field">
            <span className="tb-lang-field-l">{t("lang.label")}</span>
            <LangSwitch lang={lang} onChange={setLang} />
          </span>
          <Btn small>{t("personas.clone")}</Btn>
          <Btn small>{t("personas.import")}</Btn>
        </div>
      </div>

      <div className="tb-grid">
        {PERSONAS.map((p, i) => (
          <PersonaCard
            key={p.id}
            p={p}
            index={i}
            lang={lang}
            provider={provider}
            on={persona.id === p.id}
            accent={accent}
            onSelect={setPersona}
          />
        ))}

        <div className="tb-persona-card tb-persona-empty">
          <div className="tb-persona-num">+</div>
          <div className="tb-persona-name">{t("slot.name")}</div>
          <p className="tb-persona-desc">{t("slot.desc")}</p>
          <div className="tb-persona-drop">
            <span>{t("slot.drop")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
