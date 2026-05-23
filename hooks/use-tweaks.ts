"use client";

import { useCallback, useEffect, useState } from "react";

export type OrbStyle = "gradient" | "mono" | "particles";
export type TranscriptMode = "caption" | "drawer" | "off";

export interface Tweaks {
  dark: boolean;
  accent: string;
  orbStyle: OrbStyle;
  transcript: TranscriptMode;
  providerPreview: boolean;
}

export const TWEAK_DEFAULTS: Tweaks = {
  dark: false,
  accent: "#C2410C",
  orbStyle: "gradient",
  transcript: "drawer",
  providerPreview: true,
};

export const ACCENTS = ["#C2410C", "#2563EB", "#16A34A", "#9333EA", "#0A0A09"];

const KEY = "persona-plex.tweaks";

export function useTweaks(): [Tweaks, <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void] {
  const [tweaks, setTweaks] = useState<Tweaks>(TWEAK_DEFAULTS);

  // Hydrate from localStorage after mount to avoid SSR mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setTweaks((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch {
      // ignore malformed storage
    }
  }, []);

  // Mirror dark mode to the <html> class so ElevenLabs/shadcn components follow.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", tweaks.dark);
  }, [tweaks.dark]);

  const setTweak = useCallback(<K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setTweaks((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // ignore quota / privacy-mode errors
      }
      return next;
    });
  }, []);

  return [tweaks, setTweak];
}
