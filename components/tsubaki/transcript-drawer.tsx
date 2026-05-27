// Desktop transcript drawer — turn-by-turn live transcript with a blinking
// cursor while the agent is speaking. Brutalist turn rows (not chat bubbles).

import { ScrollArea } from "./scroll-area";
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
  return (
    <aside className={`tb-transcript ${open ? "open" : ""}`}>
      <div className="tb-transcript-hd">
        <span className="tb-h-eyebrow">LIVE TRANSCRIPT</span>
        <span className="tb-h-meta">
          {turns.length} TURNS · {providerModel}
        </span>
      </div>
      <ScrollArea className="tb-transcript-scroll" dark={dark}>
        <div className="tb-transcript-body">
          {turns.map((t, i) => (
            <div key={t.id} className={`tb-turn tb-turn-${t.who}`}>
              <div className="tb-turn-hd">
                <span className="tb-turn-who">{t.who === "user" ? "YOU" : personaName}</span>
                <span className="tb-turn-t">00:{String(i * 7).padStart(2, "0")}</span>
              </div>
              <div className="tb-turn-text">{t.text}</div>
            </div>
          ))}
          {callState === "speaking" && (
            <div className="tb-turn tb-turn-agent tb-turn-live">
              <div className="tb-turn-hd">
                <span className="tb-turn-who">{personaName}</span>
                <span className="tb-turn-t">— LIVE —</span>
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
