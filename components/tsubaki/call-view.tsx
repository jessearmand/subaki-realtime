import { useEffect, useState } from "react";
import { Btn, Tag } from "./primitives";
import {
  MicGlyph,
  InterruptGlyph,
  PhoneHangGlyph,
  WaveGlyph,
  ScrollGlyph,
  SendGlyph,
} from "./glyphs";
import { OrbVisualizer } from "./orb-visualizer";
import { Bars } from "./bars";
import { ScrollArea } from "./scroll-area";
import { ToolsButton } from "./tools-button";
import { StreamingText } from "./streaming-text";
import { TranscriptDrawer } from "./transcript-drawer";
import { LangSwitch } from "./lang-switch";
import { useT } from "./i18n-context";
import { localizeCaption } from "@/lib/i18n";
import { isLive, type SessionApi } from "@/lib/realtime/types";
import type { Provider, ResolvedPersona, Tool } from "@/lib/data";
import type { Lang } from "@/lib/lang";
import type { Tweaks } from "@/hooks/use-tweaks";

export function CallView({
  tweaks,
  session,
  persona,
  provider,
  providerModel,
  lang,
  setLang,
  compact,
  tools,
}: {
  tweaks: Tweaks;
  session: SessionApi;
  /** The armed persona, resolved to the session language. */
  persona: ResolvedPersona;
  provider: Provider;
  /** Display model — tracks the cascade LM picker (see providerModelLabel). */
  providerModel: string;
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Mobile layout — the language switch uses its short labels. */
  compact?: boolean;
  tools: Tool[];
}) {
  const t = useT();
  const { callState, muted, elapsed, canSendTurn, sendTurnEnabled } = session;
  // Status captions come from the engines in English; show them in the session language.
  const caption = localizeCaption(t, session.caption);
  // Animation identity for the caption: while a turn is actively streaming
  // (live: true — cascade/xai/openai engines), key by the turn id so token
  // updates mutate the node in place. Everywhere else (mock script, status
  // captions, ElevenLabs whole-message turns) key by text so the entry
  // animation replays per caption change, as originally designed.
  const liveTurn = session.turns.at(-1);
  const captionKey = liveTurn?.live ? liveTurn.id : caption;
  const [transcriptOpen, setTranscriptOpen] = useState(tweaks.transcript === "drawer");
  const [toolsOpen, setToolsOpen] = useState(false);

  // Re-open the drawer when the user switches transcript treatment to "drawer".
  useEffect(() => {
    if (tweaks.transcript === "drawer") setTranscriptOpen(true);
  }, [tweaks.transcript]);

  const live = isLive(callState);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="tb-call">
      <div className="tb-call-stage">
        <div className="tb-call-meta">
          <div className="tb-call-meta-l">
            <Tag mono dot>
              {t("call.session")} · {mm}:{ss}
            </Tag>
            {tweaks.providerPreview && (
              <Tag mono>
                {t("call.via")} {provider.name} · {providerModel}
              </Tag>
            )}
          </div>
          <div className="tb-call-meta-r">
            <LangSwitch lang={lang} onChange={setLang} compact={compact} />
            <Tag mono>
              {t("call.persona")} · {persona.name}
            </Tag>
          </div>
        </div>

        {/* 50/50 vertical split: orb half on top, caption half on bottom. */}
        <div className="tb-call-body">
          <div className="tb-orb-area">
            <div className="tb-orb-fit">
              <OrbVisualizer
                orbStyle={tweaks.orbStyle}
                callState={callState}
                accent={tweaks.accent}
                dark={tweaks.dark}
                getInputVolume={session.getInputVolume}
                getOutputVolume={session.getOutputVolume}
              />
              {/* Manual-turn "hold" ring — a held, slowly-rotating dashed ring that
                  reads differently from auto pulse rings: this engine ends the turn
                  only when the user presses SEND (cascade STT, half-duplex). */}
              {canSendTurn && sendTurnEnabled && <div className="tb-orb-hold" />}
            </div>
            {(callState === "listening" || callState === "interrupted") && (
              <Bars callState={callState} count={10} />
            )}
            <div className="tb-call-state">
              <span className={`tb-call-state-dot tb-state-${callState}`} />
              <span className="tb-call-state-l">{t(`call.state.${callState}`)}</span>
              {live && (
                <span className="tb-call-state-sub">
                  — {persona.name.toLowerCase()} · {provider.name.toLowerCase()}
                </span>
              )}
            </div>
            {canSendTurn && sendTurnEnabled && (
              <div className="tb-call-manual-hint">{t("call.manualHint")}</div>
            )}
          </div>

          {tweaks.transcript !== "off" && (
            <div className="tb-caption-area">
              <ScrollArea className="tb-caption-scroll" dark={tweaks.dark}>
                <div className="tb-caption" key={captionKey}>
                  <span className="tb-caption-q">“</span>
                  <span className="tb-caption-t">
                    <StreamingText text={caption} />
                  </span>
                  <span className="tb-caption-q">”</span>
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="tb-controls">
          <Btn
            small
            onClick={session.toggleMute}
            active={muted}
            aria-label={t(muted ? "aria.unmute" : "aria.mute")}
          >
            <MicGlyph muted={muted} />
          </Btn>
          <Btn
            small
            onClick={session.interrupt}
            disabled={callState !== "speaking"}
            aria-label={t("aria.interrupt")}
          >
            <InterruptGlyph />
          </Btn>
          {canSendTurn && (
            <Btn
              small
              primed={sendTurnEnabled}
              onClick={session.sendTurn}
              disabled={!sendTurnEnabled}
              aria-label={t("aria.send")}
            >
              <SendGlyph />
            </Btn>
          )}
          <Btn
            primary
            onClick={live ? session.hangup : session.start}
            danger={live}
            aria-label={t(live ? "aria.hangup" : "aria.call")}
          >
            {live ? <PhoneHangGlyph /> : <WaveGlyph />}
          </Btn>
          {tweaks.transcript === "drawer" && (
            <Btn
              small
              onClick={() => setTranscriptOpen((o) => !o)}
              active={transcriptOpen}
              aria-label={t(transcriptOpen ? "aria.hideTranscript" : "aria.showTranscript")}
            >
              <ScrollGlyph />
            </Btn>
          )}
          <ToolsButton tools={tools} open={toolsOpen} setOpen={setToolsOpen} />
        </div>
      </div>

      {tweaks.transcript === "drawer" && (
        <TranscriptDrawer
          open={transcriptOpen}
          turns={session.turns}
          personaName={persona.name}
          providerModel={providerModel}
          callState={callState}
          dark={tweaks.dark}
        />
      )}
    </div>
  );
}
