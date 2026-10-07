"use client";

// Session routing: which transport + which language the session runs on, and
// what happens when either changes.
//
// - Japanese support has levels (Provider.ja): "agent" — a dedicated JA agent
//   per persona (ElevenLabs); "prompt" — Japanese through the instructions
//   (xAI, OpenAI, Gemini); absent — no Japanese path.
// - Failover is a transport concern, and a mid-call handover doesn't work
//   upstream. Any change that re-points the session at a different agent or
//   prompt (transport OR language) ends a live call and opens a NEW session;
//   the old one is never kept alive.
// - The two directions are separate, never one symmetric effect:
//   · Japanese picked on a transport with no JA path → the transport moves to
//     the last one a Japanese session ran on, else the best available (a
//     dedicated-agent transport first).
//   · A transport with no JA path picked while Japanese is on → the language
//     drops to EN immediately; the user's transport choice wins.

import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDERS, type JaSupport, type Provider } from "@/lib/data";
import type { Lang } from "@/lib/lang";
import { isLive, type SessionApi } from "@/lib/realtime/types";

/** Why the session was re-routed — drives the notice copy. */
export type RouteKind = "failover" | "downgrade" | "switch" | "unavailable";

export interface RouteNotice {
  kind: RouteKind;
  /** "switching" while a live call is being replaced; "done" once settled. */
  phase: "switching" | "done";
  /** Whether a live call was replaced (vs. a change made while idle). */
  live: boolean;
  from: string;
  to: string;
  lang: Lang;
  /** How the target transport speaks Japanese (undefined ⇒ it doesn't). */
  level?: JaSupport;
}

export interface SessionRouting {
  lang: Lang;
  provider: Provider;
  notice: RouteNotice | null;
  /** True while a replaced live call is waiting to be reopened. */
  restartPending: boolean;
  changeLang: (next: Lang, session: SessionApi) => void;
  changeProvider: (next: Provider, session: SessionApi) => void;
  /** Called by useRestartAfterRoute once the new session has been opened (or abandoned). */
  settleRestart: () => void;
}

// Give the old session a beat to release the socket/mic before the new one
// opens. Not a correctness guard: each engine hook tags its setup with a
// per-start attempt token, so setup still in flight from the replaced call
// backs off on its own however late it resolves.
const RESTART_DELAY_MS = 600;
const NOTICE_MS = { live: 5600, idle: 4200 };

/** The best available JA transport: a dedicated-agent one first, then prompt-level. */
export function bestJaProvider(): Provider | undefined {
  return PROVIDERS.find((p) => p.ja === "agent") ?? PROVIDERS.find((p) => p.ja === "prompt");
}

export function useSessionRouting(): SessionRouting {
  const [lang, setLang] = useState<Lang>("en");
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0]);
  const [notice, setNotice] = useState<RouteNotice | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  // Last transport a Japanese session actually ran on — the preferred failover
  // target. Null until then, so the first failover goes to the best available.
  const lastJaRef = useRef<string | null>(null);
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((next: RouteNotice | null, clearAfterMs?: number) => {
    if (clearRef.current) clearTimeout(clearRef.current);
    clearRef.current = null;
    setNotice(next);
    if (next && clearAfterMs) clearRef.current = setTimeout(() => setNotice(null), clearAfterMs);
  }, []);
  useEffect(
    () => () => {
      if (clearRef.current) clearTimeout(clearRef.current);
    },
    [],
  );

  // The UI mirrors the session language (font fallback, CJK line-breaking,
  // screen-reader voice all key off the document language).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Apply a new (transport, language) pair. `kind` names why, for the notice.
  const route = useCallback(
    (next: { provider: Provider; lang: Lang }, kind: RouteKind, session: SessionApi) => {
      const live = isLive(session.callState);
      const info: RouteNotice = {
        kind,
        live,
        phase: live ? "switching" : "done",
        from: provider.name,
        to: next.provider.name,
        lang: next.lang,
        level: next.provider.ja,
      };
      setProvider(next.provider);
      setLang(next.lang);
      if (next.lang === "ja" && next.provider.ja) lastJaRef.current = next.provider.id;

      if (live) {
        // Hang up the old session; useRestartAfterRoute opens the new one.
        session.hangup();
        setRestartPending(true);
        showNotice(info);
        return;
      }
      // Nothing to tear down. A plain switch needs no explanation; the forced
      // ones (failover / downgrade) do.
      if (kind === "switch") showNotice(null);
      else showNotice(info, NOTICE_MS.idle);
    },
    [provider, showNotice],
  );

  const changeLang = useCallback(
    (nextLang: Lang, session: SessionApi) => {
      if (nextLang === lang) return;
      if (nextLang === "ja" && !provider.ja) {
        const target =
          PROVIDERS.find((p) => p.id === lastJaRef.current && p.ja) ?? bestJaProvider();
        if (!target) {
          showNotice(
            { kind: "unavailable", phase: "done", live: false, from: "", to: "", lang },
            NOTICE_MS.idle,
          );
          return;
        }
        route({ provider: target, lang: "ja" }, "failover", session);
        return;
      }
      // Same transport, different agent or prompt.
      route({ provider, lang: nextLang }, "switch", session);
    },
    [lang, provider, route, showNotice],
  );

  const changeProvider = useCallback(
    (nextProvider: Provider, session: SessionApi) => {
      if (nextProvider.id === provider.id) return;
      if (lang === "ja" && !nextProvider.ja) {
        route({ provider: nextProvider, lang: "en" }, "downgrade", session);
        return;
      }
      route({ provider: nextProvider, lang }, "switch", session);
    },
    [lang, provider, route],
  );

  const settleRestart = useCallback(() => {
    setRestartPending(false);
    setNotice((n) => {
      if (!n) return n;
      if (clearRef.current) clearTimeout(clearRef.current);
      clearRef.current = setTimeout(() => setNotice(null), NOTICE_MS.live);
      return { ...n, phase: "done" };
    });
  }, []);

  return { lang, provider, notice, restartPending, changeLang, changeProvider, settleRestart };
}

/**
 * Reopens the call after a route change replaced a live session: waits for the
 * old session to end, then starts the new one on the new transport/language.
 * If the user starts a call themselves in the meantime, the pending restart is
 * dropped rather than firing later.
 */
export function useRestartAfterRoute(session: SessionApi, routing: SessionRouting) {
  const { restartPending, settleRestart } = routing;
  const startRef = useRef(session.start);
  startRef.current = session.start;
  const sawEndedRef = useRef(false);
  const live = isLive(session.callState);

  useEffect(() => {
    if (!restartPending) {
      sawEndedRef.current = false;
      return;
    }
    if (live) {
      // Still the old call winding down — or, once it has ended, a call the
      // user started on their own: that one supersedes the pending restart.
      if (sawEndedRef.current) settleRestart();
      return;
    }
    sawEndedRef.current = true;
    const timer = setTimeout(() => {
      startRef.current();
      settleRestart();
    }, RESTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [restartPending, live, settleRestart]);
}
