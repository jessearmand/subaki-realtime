import type { RouteNotice } from "@/hooks/use-session-routing";
import { LANG_LABEL } from "@/lib/lang";

// How the target transport speaks Japanese, named in the notice.
function via(notice: RouteNotice, personaId: string): string {
  return notice.level === "agent" ? `AGENT tsubaki-${personaId}-ja` : "VIA PROMPT";
}

function noticeText(notice: RouteNotice, personaId: string): string {
  const { kind, phase, live, from, to, lang } = notice;
  if (kind === "unavailable") return "▲ NO TRANSPORT SPEAKS JAPANESE — LANGUAGE STAYS EN";
  if (kind === "failover") {
    if (phase === "switching")
      return `▲ NO JAPANESE ON ${from} — ENDING SESSION → NEW SESSION ON ${to}`;
    return live
      ? `● NEW SESSION ON ${to} · JA ${via(notice, personaId)}`
      : `● TRANSPORT → ${to} · JA ${via(notice, personaId)}`;
  }
  if (kind === "downgrade") {
    if (phase === "switching") return `▲ NO JAPANESE ON ${to} — LANGUAGE → EN · ENDING SESSION`;
    return live
      ? `● LANGUAGE → EN · NEW SESSION ON ${to}`
      : `▲ NO JAPANESE ON ${to} — LANGUAGE → EN`;
  }
  if (phase === "switching") return `▲ ENDING SESSION ON ${from} → NEW SESSION ON ${to}`;
  const langName = LANG_LABEL[lang];
  return `● NEW SESSION ON ${to} · ${lang === "ja" ? `${langName} · ${via(notice, personaId)}` : langName}`;
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
  if (!notice) return null;
  return (
    <div className="tb-route-slot">
      <div
        className={`tb-route-notice ${notice.phase} tb-route-${notice.kind}`}
        role="status"
        aria-live="polite"
      >
        {noticeText(notice, personaId)}
      </div>
    </div>
  );
}
