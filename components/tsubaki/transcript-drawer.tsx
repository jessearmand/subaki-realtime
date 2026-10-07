// Desktop transcript drawer — turn-by-turn live transcript with a blinking
// cursor while the agent is speaking. Brutalist turn rows (not chat bubbles).

import { ScrollArea } from "./scroll-area";
import { useT } from "./i18n-context";
import type { CallState, SessionTurn } from "@/lib/realtime/types";

export function TranscriptDrawer({
  open,
  turns,
  personaName,
  providerModel,
  callState,
  dark,
}: {
  open: boolean;
  turns: SessionTurn[];
  personaName: string;
  providerModel: string;
  callState: CallState;
  dark: boolean;
}) {
  const t = useT();
  return (
    <aside className={`tb-transcript ${open ? "open" : ""}`}>
      <div className="tb-transcript-hd">
        <span className="tb-h-eyebrow">{t("transcript.live")}</span>
        <span className="tb-h-meta">
          {t("transcript.turns", { n: turns.length })} · {providerModel}
        </span>
      </div>
      <ScrollArea className="tb-transcript-scroll" dark={dark}>
        <div className="tb-transcript-body">
          {turns.map((turn, i) => (
            <div key={turn.id} className={`tb-turn tb-turn-${turn.who}`}>
              <div className="tb-turn-hd">
                <span className="tb-turn-who">
                  {turn.who === "user" ? t("transcript.you") : personaName}
                </span>
                <span className="tb-turn-t">00:{String(i * 7).padStart(2, "0")}</span>
              </div>
              <div className="tb-turn-text">{turn.text}</div>
            </div>
          ))}
          {callState === "speaking" && (
            <div className="tb-turn tb-turn-agent tb-turn-live">
              <div className="tb-turn-hd">
                <span className="tb-turn-who">{personaName}</span>
                <span className="tb-turn-t">{t("transcript.liveTag")}</span>
              </div>
              <div className="tb-turn-text">
                <span className="tb-cursor" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
