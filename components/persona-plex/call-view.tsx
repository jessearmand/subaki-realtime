import { useEffect, useState } from "react";
import { Btn, Tag } from "./primitives";
import { MicGlyph, InterruptGlyph, PhoneGlyph, PhoneHangGlyph, ScrollGlyph } from "./glyphs";
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
  const { callState, caption, muted, elapsed } = session;
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
    <div className="pp-call">
      <div className="pp-call-stage">
        <div className="pp-call-meta">
          <div className="pp-call-meta-l">
            <Tag mono dot>
              SESSION · {mm}:{ss}
            </Tag>
            {tweaks.providerPreview && (
              <Tag mono>
                VIA {provider.name} · {provider.model}
              </Tag>
            )}
          </div>
          <div className="pp-call-meta-r">
            <Tag mono>PERSONA · {persona.name}</Tag>
          </div>
        </div>

        {/* 50/50 vertical split: orb half on top, caption half on bottom. */}
        <div className="pp-call-body">
          <div className="pp-orb-area">
            <div className="pp-orb-fit">
              <OrbVisualizer
                orbStyle={tweaks.orbStyle}
                callState={callState}
                accent={tweaks.accent}
                dark={tweaks.dark}
                getInputVolume={session.getInputVolume}
                getOutputVolume={session.getOutputVolume}
              />
            </div>
            {(callState === "listening" || callState === "interrupted") && (
              <Bars callState={callState} count={10} />
            )}
            <div className="pp-call-state">
              <span className={`pp-call-state-dot pp-state-${callState}`} />
              <span className="pp-call-state-l">{STATE_LABEL[callState]}</span>
              {live && (
                <span className="pp-call-state-sub">
                  — {persona.name.toLowerCase()} · {provider.name.toLowerCase()}
                </span>
              )}
            </div>
          </div>

          {tweaks.transcript !== "off" && (
            <div className="pp-caption-area">
              <ScrollArea className="pp-caption-scroll" dark={tweaks.dark}>
                <div className="pp-caption" key={caption}>
                  <span className="pp-caption-q">“</span>
                  <span className="pp-caption-t">{caption}</span>
                  <span className="pp-caption-q">”</span>
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="pp-controls">
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
