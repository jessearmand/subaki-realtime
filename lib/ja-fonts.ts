// Japanese font catalog for the Tweaks panel. Each family is only the CJK
// fallback behind Plex Mono (sans) / Newsreader (serif), so Latin text never
// changes.
//
// Noto is the default and is self-hosted through next/font (app/layout.tsx).
// The alternatives are for auditioning type: they load from Google Fonts on
// demand, only when picked, so they add nothing to the bundle.

export type JaSans = "noto" | "zen-kaku" | "biz-ud";
export type JaSerif = "noto" | "shippori" | "zen-old";

export interface JaFont<V extends string> {
  value: V;
  label: string;
  /** CSS font-family value; undefined ⇒ the self-hosted Noto default. */
  family?: string;
  /** Google Fonts css2 `family=` spec for the on-demand stylesheet. */
  google?: string;
}

export const JA_SANS: JaFont<JaSans>[] = [
  { value: "noto", label: "Noto Sans JP" },
  {
    value: "zen-kaku",
    label: "Zen Kaku Gothic New",
    family: '"Zen Kaku Gothic New"',
    google: "Zen+Kaku+Gothic+New:wght@400;500;700",
  },
  {
    value: "biz-ud",
    label: "BIZ UDPGothic",
    family: '"BIZ UDPGothic"',
    google: "BIZ+UDPGothic:wght@400;700",
  },
];

export const JA_SERIF: JaFont<JaSerif>[] = [
  { value: "noto", label: "Noto Serif JP" },
  {
    value: "shippori",
    label: "Shippori Mincho",
    family: '"Shippori Mincho"',
    google: "Shippori+Mincho:wght@400;500",
  },
  {
    value: "zen-old",
    label: "Zen Old Mincho",
    family: '"Zen Old Mincho"',
    google: "Zen+Old+Mincho:wght@400;500",
  },
];
