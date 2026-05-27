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
    <header className="tb-topbar">
      <div className="tb-brand">
        <span className="tb-brand-mark" />
        <span className="tb-brand-name">TSUBAKI</span>
        {!compact && <span className="tb-brand-sub">v0.4.2 · realtime console</span>}
      </div>
      <div className="tb-topbar-status">
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
