import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
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
    <html lang="en" className={`${plexMono.variable} ${newsreader.variable} h-full`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
