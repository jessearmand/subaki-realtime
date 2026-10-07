"use client";

import { useEffect } from "react";
import { JA_SANS, JA_SERIF, type JaFont, type JaSans, type JaSerif } from "@/lib/ja-fonts";

const LINK_ID_PREFIX = "tb-ja-font-";

// Load an alternative family's stylesheet once, the first time it is picked.
function ensureStylesheet(font: JaFont<string>) {
  if (!font.google) return;
  const id = LINK_ID_PREFIX + font.value;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  document.head.appendChild(link);
}

function apply(variable: string, font: JaFont<string> | undefined) {
  const root = document.documentElement.style;
  if (font?.family) {
    ensureStylesheet(font);
    root.setProperty(variable, font.family);
  } else {
    // Back to the self-hosted Noto default (the var() fallback in globals.css).
    root.removeProperty(variable);
  }
}

/**
 * Applies the Tweaks-picked Japanese font pairing. The variables live on
 * <html> because that is where --tb-mono / --tb-serif are resolved.
 */
export function useJaFonts(sans: JaSans, serif: JaSerif) {
  useEffect(() => {
    apply(
      "--tb-ja-sans",
      JA_SANS.find((f) => f.value === sans),
    );
  }, [sans]);
  useEffect(() => {
    apply(
      "--tb-ja-serif",
      JA_SERIF.find((f) => f.value === serif),
    );
  }, [serif]);
}
