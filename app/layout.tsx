import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader, Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import "./globals.css";

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

// Japanese families are per-glyph fallbacks behind Plex Mono / Newsreader (which
// carry no CJK). next/font slices them by unicode-range, so a browser only
// fetches the slices for characters actually on screen; `preload: false` keeps
// them out of the first load for English sessions.
const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

const notoSerifJp = Noto_Serif_JP({
  variable: "--font-noto-serif-jp",
  weight: ["400", "500"],
  display: "swap",
  preload: false,
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
    <html
      lang="en"
      className={`${plexMono.variable} ${newsreader.variable} ${notoSansJp.variable} ${notoSerifJp.variable} h-full`}
    >
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
