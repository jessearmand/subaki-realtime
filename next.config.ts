import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev badge (bottom-left build/route indicator).
  // It only ever renders under `next dev` — never in a production build.
  devIndicators: false,
  // `next dev` refuses its scripts and HMR socket to any origin but localhost,
  // so a phone on the tailnet (`tailscale serve` → *.ts.net) or the LAN
  // (Bonjour → *.local) gets the server render with no hydration: the desktop
  // layout squeezed to phone width. Dev-only; production builds ignore it.
  allowedDevOrigins: ["**.ts.net", "*.local"],
};

export default nextConfig;
