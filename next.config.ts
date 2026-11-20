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
  // The Archil SDK (`disk`) loads optional Node modules with dynamic requires
  // that Turbopack can't bundle ("expression is too dynamic"); load it from
  // node_modules at runtime instead (server routes only).
  serverExternalPackages: ["disk"],
};

export default nextConfig;
