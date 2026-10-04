"use client";

import { useState } from "react";
import { TopBar } from "./top-bar";
import { Sidebar, MobileTabs, type NavId } from "./nav";
import { CallView } from "./call-view";
import { PersonasView } from "./personas-view";
import { ProvidersView } from "./providers-view";
import { SettingsView } from "./settings-view";
import { TweaksPanel } from "./tweaks-panel";
import { RoutingNotice } from "./routing-notice";
import {
  PERSONAS,
  TOOLS_DEFAULT,
  resolvePersona,
  type Persona,
  type Provider,
  type Tool,
} from "@/lib/data";
import type { Lang } from "@/lib/lang";
import { useRestartAfterRoute, useSessionRouting } from "@/hooks/use-session-routing";
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
  // Transport + session language, and what happens when either changes
  // (JA failover, EN downgrade, new session on a live change).
  const routing = useSessionRouting();
  const { lang, provider } = routing;
  const [tools, setTools] = useState<Tool[]>(TOOLS_DEFAULT);
  const isMobile = useMediaQuery("(max-width: 760px)");
  // Bind the C/P/V/S section keys the sidebar advertises.
  useNavKeys(setNav);

  const session = useRealtimeSession({
    provider,
    persona,
    lang,
    lmModelId,
    voiceBargeIn: tweaks.voiceBargeIn,
    pushToTalk: tweaks.pushToTalk,
  });
  // What the UI shows as the active model — tracks the LM picker for cascade.
  const providerModel = providerModelLabel(provider, lmModelId);
  // Execution mode — for cascade, computed from the resolved backends.
  const providerExec = providerExecLabel(provider, resolveLmModel(lmModelId).backend);
  useRestartAfterRoute(session, routing);
  const setLang = (next: Lang) => routing.changeLang(next, session);
  const setProvider = (next: Provider) => routing.changeProvider(next, session);
  // The persona as displayed in the session language (engines key off persona.id).
  const shown = resolvePersona(persona, lang);

  return (
    <div
      className={`tsubaki ${tweaks.dark ? "tsubaki-dark" : ""} ${isMobile ? "tb-mobile" : ""}`}
      data-lang={lang}
    >
      <TopBar callState={session.callState} compact={isMobile} />
      <div className="tb-shell">
        {!isMobile && (
          <Sidebar
            nav={nav}
            setNav={setNav}
            persona={shown}
            provider={provider}
            providerModel={providerModel}
            providerExec={providerExec}
          />
        )}
        <main className="tb-main">
          <RoutingNotice notice={routing.notice} personaId={persona.id} />
          {nav === "call" && (
            <CallView
              tweaks={tweaks}
              session={session}
              persona={shown}
              provider={provider}
              providerModel={providerModel}
              lang={lang}
              setLang={setLang}
              compact={isMobile}
              tools={tools}
            />
          )}
          {nav === "personas" && (
            <PersonasView
              persona={persona}
              setPersona={setPersona}
              provider={provider}
              lang={lang}
              setLang={setLang}
              accent={tweaks.accent}
            />
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
              lang={lang}
              setLang={setLang}
              tools={tools}
              setTools={setTools}
              muted={session.muted}
              onMutedChange={(m) => {
                if (m !== session.muted) session.toggleMute();
              }}
              bargeIn={tweaks.voiceBargeIn}
              onBargeInChange={(v) => setTweak("voiceBargeIn", v)}
              pushToTalk={tweaks.pushToTalk}
              onPushToTalkChange={(v) => setTweak("pushToTalk", v)}
            />
          )}
        </main>
      </div>
      {isMobile && <MobileTabs nav={nav} setNav={setNav} />}
      <TweaksPanel tweaks={tweaks} setTweak={setTweak} />
    </div>
  );
}
