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
import { useLmModel } from "@/hooks/use-lm-model";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNavKeys } from "@/hooks/use-nav-keys";
import { providerModelLabel, resolveLmModel } from "@/lib/realtime/lm-config";
import { providerExecLabel } from "@/lib/realtime/voice-config";
import { useRealtimeSession } from "@/lib/realtime/use-realtime-session";

export function AppShell() {
  const [tweaks, setTweak] = useTweaks();
  const [lmModelId, setLmModelId] = useLmModel();
  const [nav, setNav] = useState<NavId>("call");
  const [persona, setPersona] = useState<Persona>(PERSONAS[0]);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0]);
  const [tools, setTools] = useState<Tool[]>(TOOLS_DEFAULT);
  const isMobile = useMediaQuery("(max-width: 760px)");
  // Bind the C/P/V/S section keys the sidebar advertises.
  useNavKeys(setNav);

  const session = useRealtimeSession({
    provider,
    persona,
    lmModelId,
    voiceBargeIn: tweaks.voiceBargeIn,
  });
  // What the UI shows as the active model — tracks the LM picker for cascade.
  const providerModel = providerModelLabel(provider, lmModelId);
  // Execution mode — for cascade, computed from the resolved backends.
  const providerExec = providerExecLabel(provider, resolveLmModel(lmModelId).backend);

  return (
    <div className={`tsubaki ${tweaks.dark ? "tsubaki-dark" : ""} ${isMobile ? "tb-mobile" : ""}`}>
      <TopBar callState={session.callState} compact={isMobile} />
      <div className="tb-shell">
        {!isMobile && (
          <Sidebar
            nav={nav}
            setNav={setNav}
            persona={persona}
            provider={provider}
            providerModel={providerModel}
            providerExec={providerExec}
          />
        )}
        <main className="tb-main">
          {nav === "call" && (
            <CallView
              tweaks={tweaks}
              session={session}
              persona={persona}
              provider={provider}
              providerModel={providerModel}
              tools={tools}
            />
          )}
          {nav === "personas" && (
            <PersonasView persona={persona} setPersona={setPersona} accent={tweaks.accent} />
          )}
          {nav === "providers" && (
            <ProvidersView
              provider={provider}
              setProvider={setProvider}
              accent={tweaks.accent}
              lmModelId={lmModelId}
              setLmModelId={setLmModelId}
            />
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
              bargeIn={tweaks.voiceBargeIn}
              onBargeInChange={(v) => setTweak("voiceBargeIn", v)}
            />
          )}
        </main>
      </div>
      {isMobile && <MobileTabs nav={nav} setNav={setNav} />}
      <TweaksPanel tweaks={tweaks} setTweak={setTweak} />
    </div>
  );
}
