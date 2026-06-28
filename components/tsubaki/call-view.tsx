import { useEffect, useState } from "react";
import { Btn, Tag } from "./primitives";
import {
  MicGlyph,
  InterruptGlyph,
  PhoneGlyph,
  PhoneHangGlyph,
  ScrollGlyph,
  SendGlyph,
} from "./glyphs";
import { OrbVisualizer } from "./orb-visualizer";
import { Bars } from "./bars";
import { ScrollArea } from "./scroll-area";
import { ToolsButton } from "./tools-button";
import { TranscriptDrawer } from "./transcript-drawer";
import { STATE_LABEL, isLive, type SessionApi } from "@/lib/realtime/types";
import type { Persona, Provider, Tool } from "@/lib/data";
import type { Tweaks } from "@/hooks/use-tweaks";

export function CallView({
  tweaks,
  session,
  persona,
  provider,
  tools,
}: {
  tweaks: Tweaks;
  session: SessionApi;
  persona: Persona;
  provider: Provider;
  tools: Tool[];
}) {
  const { callState, caption, muted, elapsed, canSendTurn } = session;
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
              SESSION · {mm}:{ss}
            </Tag>
            {tweaks.providerPreview && (
              <Tag mono>
                VIA {provider.name} · {provider.model}
              </Tag>
            )}
          </div>
          <div className="tb-call-meta-r">
            <Tag mono>PERSONA · {persona.name}</Tag>
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
              {canSendTurn && callState === "listening" && <div className="tb-orb-hold" />}
            </div>
            {(callState === "listening" || callState === "interrupted") && (
              <Bars callState={callState} count={10} />
            )}
            <div className="tb-call-state">
              <span className={`tb-call-state-dot tb-state-${callState}`} />
              <span className="tb-call-state-l">{STATE_LABEL[callState]}</span>
              {live && (
                <span className="tb-call-state-sub">
                  — {persona.name.toLowerCase()} · {provider.name.toLowerCase()}
                </span>
              )}
            </div>
            {canSendTurn && callState === "listening" && (
              <div className="tb-call-manual-hint">MANUAL TURN · PRESS SEND TO REPLY</div>
            )}
          </div>

          {tweaks.transcript !== "off" && (
            <div className="tb-caption-area">
              <ScrollArea className="tb-caption-scroll" dark={tweaks.dark}>
                <div className="tb-caption" key={caption}>
                  <span className="tb-caption-q">“</span>
                  <span className="tb-caption-t">{caption}</span>
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
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            <MicGlyph muted={muted} />
          </Btn>
          <Btn
            small
            onClick={session.interrupt}
            disabled={callState !== "speaking"}
            aria-label="Interrupt agent"
          >
            <InterruptGlyph />
          </Btn>
          {canSendTurn && (
            <Btn
              small
              primed={callState === "listening"}
              onClick={session.sendTurn}
              disabled={callState !== "listening"}
              aria-label="Send turn"
            >
              <SendGlyph />
            </Btn>
          )}
          <Btn
            primary
            onClick={live ? session.hangup : session.start}
            danger={live}
            aria-label={live ? "Hang up" : "Call"}
          >
            {live ? <PhoneHangGlyph /> : <PhoneGlyph />}
          </Btn>
          {tweaks.transcript === "drawer" && (
            <Btn
              small
              onClick={() => setTranscriptOpen((o) => !o)}
              active={transcriptOpen}
              aria-label={transcriptOpen ? "Hide transcript" : "Show transcript"}
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
          providerModel={provider.model}
          callState={callState}
          dark={tweaks.dark}
        />
      )}
    </div>
  );
}
