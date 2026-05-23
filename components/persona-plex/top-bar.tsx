import { useEffect, useState } from "react";
import { isLive, type CallState } from "@/lib/realtime/types";

export function TopBar({ compact, callState }: { compact?: boolean; callState: CallState }) {
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
  const sessionLabel = live ? "LIVE" : callState === "ended" ? "ENDED" : "IDLE";
  const micLabel = live ? "ON" : "OFF";

  return (
    <header className="pp-topbar">
      <div className="pp-brand">
        <span className="pp-brand-mark" />
        <span className="pp-brand-name">PERSONA·PLEX</span>
        {!compact && <span className="pp-brand-sub">v0.4.2 · realtime console</span>}
      </div>
      <div className="pp-topbar-status">
        <span>
          SESSION <b style={{ color: "var(--ink)" }}>{sessionLabel}</b>
        </span>
        {!compact && (
          <span>
            NETWORK <b style={{ color: "var(--ink)" }}>OK</b>
          </span>
        )}
        {!compact && (
          <span>
            MIC <b style={{ color: "var(--ink)" }}>{micLabel}</b>
          </span>
        )}
        <span style={{ fontVariantNumeric: "tabular-nums" }} suppressHydrationWarning>
          {clock}
        </span>
      </div>
    </header>
  );
}
