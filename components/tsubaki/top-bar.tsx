import { useEffect, useState } from "react";
import { MenuGlyph } from "./glyphs";
import { useT } from "./i18n-context";
import { isLive, type CallState } from "@/lib/realtime/types";

export function TopBar({
  compact,
  callState,
  onMenu,
  menuOpen,
}: {
  compact?: boolean;
  callState: CallState;
  /** Mobile: toggles the sections drawer. Absent ⇒ no menu button. */
  onMenu?: () => void;
  menuOpen?: boolean;
}) {
  const t = useT();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const clock = now
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
    : "--:--:--";

  const live = isLive(callState);
  const sessionLabel = t(
    live ? "status.live" : callState === "ended" ? "status.ended" : "status.idle",
  );
  const micLabel = t(live ? "status.on" : "status.off");

  return (
    <header className="tb-topbar">
      {onMenu && (
        <button
          type="button"
          className="tb-menu-btn"
          onClick={onMenu}
          aria-label={t(menuOpen ? "aria.closeMenu" : "aria.openMenu")}
          aria-expanded={!!menuOpen}
        >
          <MenuGlyph />
        </button>
      )}
      <div className="tb-brand">
        <span className="tb-brand-mark" />
        <span className="tb-brand-name">TSUBAKI</span>
        {!compact && <span className="tb-brand-sub">v0.4.2 · {t("brand.sub")}</span>}
      </div>
      <div className="tb-topbar-status">
        <span>
          {t("top.session")} <b style={{ color: "var(--ink)" }}>{sessionLabel}</b>
        </span>
        {!compact && (
          <span>
            {t("top.network")} <b style={{ color: "var(--ink)" }}>{t("status.ok")}</b>
          </span>
        )}
        {!compact && (
          <span>
            {t("top.mic")} <b style={{ color: "var(--ink)" }}>{micLabel}</b>
          </span>
        )}
        <span style={{ fontVariantNumeric: "tabular-nums" }} suppressHydrationWarning>
          {clock}
        </span>
      </div>
    </header>
  );
}
