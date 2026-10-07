import { useEffect, type ReactNode } from "react";
import { useT } from "./i18n-context";
import type { Provider, ResolvedPersona } from "@/lib/data";
import { formatExec } from "@/lib/i18n";
import { LANG_LABEL } from "@/lib/lang";

export type NavId = "call" | "personas" | "providers" | "settings";

// Labels come from the string layer (`nav.<id>`).
export const NAV: { id: NavId; key: string }[] = [
  { id: "call", key: "C" },
  { id: "personas", key: "P" },
  { id: "providers", key: "V" },
  { id: "settings", key: "S" },
];

export function Sidebar({
  nav,
  setNav,
  persona,
  provider,
  providerModel,
  providerExec,
}: {
  nav: NavId;
  setNav: (id: NavId) => void;
  /** The armed persona, resolved to the session language. */
  persona: ResolvedPersona;
  provider: Provider;
  /** Display model — tracks the cascade LM picker (see providerModelLabel). */
  providerModel: string;
  /** Execution mode — cascade computes it from the resolved backends
   *  (see providerExecLabel); other engines pass their static `exec`. */
  providerExec: string;
}) {
  const t = useT();
  return (
    <nav className="tb-side">
      <div className="tb-side-eyebrow">{t("side.sections")}</div>
      {NAV.map((item) => (
        <button
          key={item.id}
          className={`tb-nav-item ${nav === item.id ? "on" : ""}`}
          onClick={() => setNav(item.id)}
        >
          <span>{t(`nav.${item.id}`)}</span>
          <span className="tb-nav-key">{item.key}</span>
        </button>
      ))}
      <div className="tb-side-foot">
        <div>
          <b>{persona.name}</b> · {LANG_LABEL[persona.lang]}
          <br />
          {t("side.activePersona")}
        </div>
        <div>
          <b>{provider.name}</b> · {providerModel}
          <br />
          {t("side.activeTransport")}
        </div>
        <div>
          {t("side.exec")} <b>{formatExec(t, providerExec)}</b>
        </div>
      </div>
    </nav>
  );
}

/**
 * Mobile sections drawer. Hosts the desktop Sidebar unchanged, so both layouts
 * share one navigation model (and one footer: persona · language · transport).
 * Scrim tap or Esc closes it.
 */
export function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <div className={`tb-drawer-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="tb-drawer-scrim" onClick={onClose} />
      <div className="tb-drawer" role="dialog" aria-modal="true" aria-label={t("aria.sections")}>
        {children}
      </div>
    </div>
  );
}
