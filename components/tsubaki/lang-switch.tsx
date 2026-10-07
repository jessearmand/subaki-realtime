import { useT } from "./i18n-context";
import { LANGS, LANG_LABEL, type Lang } from "@/lib/lang";

/**
 * EN / 日本語 switch. Language is a property of the *session*, not of a card:
 * flipping it re-points the session at the Japanese agent (ElevenLabs) or the
 * Japanese prompt (xAI, OpenAI, Gemini) for the armed persona. One control,
 * shown wherever that choice is live. stopPropagation so it never steals a
 * parent's click.
 */
export function LangSwitch({
  lang,
  onChange,
  compact,
}: {
  lang: Lang;
  onChange: (lang: Lang) => void;
  /** Narrow layouts: "JA" instead of "日本語". */
  compact?: boolean;
}) {
  const t = useT();
  return (
    <span className="tb-lang-sw" role="group" aria-label={t("lang.aria")}>
      {LANGS.map((id) => (
        <button
          key={id}
          type="button"
          lang={id}
          className={`tb-lang-btn ${lang === id ? "on" : ""}`}
          aria-pressed={lang === id}
          onClick={(e) => {
            e.stopPropagation();
            onChange(id);
          }}
        >
          {id === "ja" && compact ? "JA" : LANG_LABEL[id]}
        </button>
      ))}
    </span>
  );
}
