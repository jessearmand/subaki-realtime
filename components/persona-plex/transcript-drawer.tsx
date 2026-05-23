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
    <aside className={`pp-transcript ${open ? "open" : ""}`}>
      <div className="pp-transcript-hd">
        <span className="pp-h-eyebrow">LIVE TRANSCRIPT</span>
        <span className="pp-h-meta">
          {turns.length} TURNS · {providerModel}
        </span>
      </div>
      <ScrollArea className="pp-transcript-scroll" dark={dark}>
        <div className="pp-transcript-body">
          {turns.map((t, i) => (
            <div key={t.id} className={`pp-turn pp-turn-${t.who}`}>
              <div className="pp-turn-hd">
                <span className="pp-turn-who">{t.who === "user" ? "YOU" : personaName}</span>
                <span className="pp-turn-t">00:{String(i * 7).padStart(2, "0")}</span>
              </div>
              <div className="pp-turn-text">{t.text}</div>
            </div>
          ))}
          {callState === "speaking" && (
            <div className="pp-turn pp-turn-agent pp-turn-live">
              <div className="pp-turn-hd">
                <span className="pp-turn-who">{personaName}</span>
                <span className="pp-turn-t">— LIVE —</span>
              </div>
              <div className="pp-turn-text">
                <span className="pp-cursor" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
