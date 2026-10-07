import { useT } from "./i18n-context";
import type { RouteNotice } from "@/hooks/use-session-routing";
import type { Translate } from "@/lib/i18n";

function noticeText(t: Translate, notice: RouteNotice, personaId: string): string {
  const { kind, phase, live, from, to, lang } = notice;
  if (kind === "unavailable") return t("route.unavailable");
  if (phase === "switching") return t(`route.${kind}.switching`, { from, to });
  // How the target transport speaks Japanese.
  const via =
    notice.level === "agent"
      ? t("route.via.agent", { agent: `tsubaki-${personaId}-ja` })
      : t("route.via.prompt");
  if (kind === "switch") {
    const langName = t(`lang.name.${lang}`);
    return t("route.switch.done", { to, lang: lang === "ja" ? `${langName} · ${via}` : langName });
  }
  return t(`route.${kind}.${live ? "done" : "idle"}`, { to, via });
}

/**
 * Session routing strip. Rendered once, above every page, so a language drop
 * triggered from Providers or Settings is explained where it happens.
 */
export function RoutingNotice({
  notice,
  personaId,
}: {
  notice: RouteNotice | null;
  personaId: string;
}) {
  const t = useT();
  if (!notice) return null;
  return (
    <div className="tb-route-slot">
      <div
        className={`tb-route-notice ${notice.phase} tb-route-${notice.kind}`}
        role="status"
        aria-live="polite"
      >
        {noticeText(t, notice, personaId)}
      </div>
    </div>
  );
}
