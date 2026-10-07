// Session language. One switch drives both the voice language (which agent /
// which prompt the session runs on) and the UI locale.

export type Lang = "en" | "ja";

export const LANGS: Lang[] = ["en", "ja"];

/** Endonyms — each language named in itself, so its speakers can find it. */
export const LANG_LABEL: Record<Lang, string> = { en: "EN", ja: "日本語" };
