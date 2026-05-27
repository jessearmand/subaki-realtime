"use client";

import { useState } from "react";
import { TopBar } from "./top-bar";
import { Sidebar, MobileTabs, type NavId } from "./nav";
import { CallView } from "./call-view";
import { PersonasView } from "./personas-view";
import { ProvidersView } from "./providers-view";
import { SettingsView } from "./settings-view";
import { TweaksPanel } from "./tweaks-panel";
import {
  PERSONAS,
  PROVIDERS,
  TOOLS_DEFAULT,
  type Persona,
  type Provider,
  type Tool,
} from "@/lib/data";
import { useTweaks } from "@/hooks/use-tweaks";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useRealtimeSession } from "@/lib/realtime/use-realtime-session";

export function AppShell() {
  const [tweaks, setTweak] = useTweaks();
  const [nav, setNav] = useState<NavId>("call");
  const [persona, setPersona] = useState<Persona>(PERSONAS[0]);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0]);
  const [tools, setTools] = useState<Tool[]>(TOOLS_DEFAULT);
  const isMobile = useMediaQuery("(max-width: 760px)");

  const session = useRealtimeSession({ provider });

  return (
    <div className={`tsubaki ${tweaks.dark ? "tsubaki-dark" : ""} ${isMobile ? "tb-mobile" : ""}`}>
      <TopBar callState={session.callState} compact={isMobile} />
      <div className="tb-shell">
        {!isMobile && <Sidebar nav={nav} setNav={setNav} persona={persona} provider={provider} />}
        <main className="tb-main">
          {nav === "call" && (
            <CallView
              tweaks={tweaks}
              session={session}
              persona={persona}
              provider={provider}
              tools={tools}
            />
          )}
          {nav === "personas" && (
            <PersonasView persona={persona} setPersona={setPersona} accent={tweaks.accent} />
          )}
          {nav === "providers" && (
            <ProvidersView provider={provider} setProvider={setProvider} accent={tweaks.accent} />
          )}
          {nav === "settings" && (
            <SettingsView
              accent={tweaks.accent}
              tools={tools}
              setTools={setTools}
              muted={session.muted}
              onMutedChange={(m) => {
                if (m !== session.muted) session.toggleMute();
              }}
            />
          )}
        </main>
      </div>
      {isMobile && <MobileTabs nav={nav} setNav={setNav} />}
      <TweaksPanel tweaks={tweaks} setTweak={setTweak} />
    </div>
  );
}
