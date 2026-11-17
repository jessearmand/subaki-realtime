import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
// Japanese families are per-glyph fallbacks behind Plex Mono / Newsreader (which
// carry no CJK). They are self-hosted from Fontsource rather than next/font:
// next/font/google downloads every unicode-range slice from Google at build
// time (~620 faces for these two families), and that fetch has failed CI builds.
// Fontsource ships the same slices (124 per weight) with their unicode-range
// rules, so a browser still fetches only the slices for characters on screen,
// and plain @font-face rules are never preloaded, so English sessions load none.
// The families are bound to --font-noto-sans-jp / --font-noto-serif-jp in
// app/globals.css.
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/600.css";
import "@fontsource/noto-serif-jp/400.css";
import "@fontsource/noto-serif-jp/500.css";
import "./globals.css";
import "./styles/conversations.css";
import "./styles/tweaks-dock.css";

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "TSUBAKI — realtime voice console",
  description: "Brutalist editorial realtime voice console.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `lang` follows the session language at runtime (use-session-routing).
    <html lang="en" className={`${plexMono.variable} ${newsreader.variable} h-full`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
